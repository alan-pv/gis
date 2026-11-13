"""decider.py: the decision loop that drives Laya through one turn.

For each action the loop asks Laya a sequence of multiple-choice questions
(pass A: which action; pass B: its details; pass S: refs to point at) and builds
the plan. An invalid answer never raises: the step is skipped or the turn ends.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Callable

from . import protocol
from .protocol import PlanStep

VALID_ACTIONS = frozenset({"done", "text", "concept", "connect", "point"})

# Sequence length handed to Laya on every call, so that boards of ~30 objects
# plus the candidates fit.
LAYA_MAX_LEN = 2048
LAYA_HEAD_MAX_LEN = 768


class LayaPredictor:
    """Adapts a loaded `laya` agent to the `predict(state_text, questions)`
    interface the decision loop uses: it returns only the chosen label of each
    question (`answers[qid]["choice"]`)."""

    def __init__(self, agent: Any):
        self.agent = agent
        if agent is not None:
            _use_fp32(agent)

    def predict(self, state_text: str, questions: dict[str, Any]) -> dict[str, str]:
        result = self.agent.predict(
            state_text, questions, max_len=LAYA_MAX_LEN, head_max_len=LAYA_HEAD_MAX_LEN
        )
        answers = result.get("answers", {}) if isinstance(result, dict) else {}
        out: dict[str, str] = {}
        for qid in questions:
            choice = (answers.get(qid) or {}).get("choice")
            if choice is not None:
                out[qid] = choice
        return out


def _use_fp32(agent: Any) -> None:
    """Run the model in plain fp32. `laya` defaults to fp16 autocast on GPUs with
    compute capability below 8, which re-casts the fp32 weights on every forward
    and measured 3-6x slower than fp32 (with no memory saving) on a GTX 1650."""
    import torch

    agent.model.float()
    agent.dtype, agent.amp_enabled = torch.float32, False


@dataclass
class DecisionResult:
    """Outcome of deciding a turn.

    `steps` counts predictor calls (one Laya forward each); `questions` counts
    the questions asked through them; `ms` is the loop duration (the text model
    runs afterwards). `cut_by_budget` is True when the time budget ran out
    mid-turn: the step being decided at that moment is dropped whole, never
    emitted half done.
    """

    plan: list[PlanStep] = field(default_factory=list)
    steps: int = 0
    questions: int = 0
    ms: float = 0.0
    cut_by_budget: bool = False
    restrictions_applied: int = 0


class _BudgetExhausted(Exception):
    """The time budget ran out right before a predictor call."""


def _answer(response: dict[str, Any], key: str) -> str | None:
    value = response.get(key)
    return None if value is None else str(value)


def _valid_or_default(value: str | None, criteria: dict[str, str], default: str) -> str:
    return value if value is not None and value in criteria else default


class _TurnLoop:
    def __init__(
        self,
        predictor: Any,
        state: dict[str, Any],
        utterance: str,
        budget_ms: float | None,
        clock: Callable[[], float],
    ):
        self.predictor = predictor
        self.state = state
        self.utterance = utterance
        self.plan: list[PlanStep] = []
        self.steps = 0
        self.questions = 0
        self.restrictions_applied = 0
        self.budget_ms = budget_ms
        self.clock = clock
        self.t0 = clock()
        self.cut_by_budget = False

    def ask(self, questions: dict[str, Any], in_progress: str | None = None) -> dict[str, str]:
        if self.budget_ms is not None and (self.clock() - self.t0) * 1000.0 >= self.budget_ms:
            # Checked before the call, never in the middle of one.
            self.cut_by_budget = True
            raise _BudgetExhausted()
        state_text = protocol.serialize_state(
            self.state, self.utterance, self.plan, in_progress=in_progress
        )
        self.steps += 1
        self.questions += len(questions)
        return self.predictor.predict(state_text, questions) or {}

    def _decide_text(self) -> PlanStep:
        q = {"role": protocol.role_question(), "group": protocol.group_question(self.state, self.plan)}
        resp = self.ask(q)
        role = _valid_or_default(_answer(resp, "role"), q["role"]["criteria"], "body")
        group = _valid_or_default(_answer(resp, "group"), q["group"]["criteria"], "none")
        role, group = self._enforce_role_group(q, role, group)
        return PlanStep(op="text", role=role, group=group)

    def _enforce_role_group(self, q: dict[str, Any], role: str, group: str) -> tuple[str, str]:
        """Fix (role, group) so they never break the board's invariants.

        Role and group are answered in the same call, so the group cannot be
        masked before the role is chosen; it is fixed afterwards:
          1. A new group's first member is its subtitle.
          2. A subtitle never joins an existing group (it opens a new one).
          3. `title` only if the page has none: otherwise the question is asked
             again without that option. Only the new role is kept.
        """
        if group == "new" and role != "subtitle":
            role = "subtitle"
            self.restrictions_applied += 1
        if role == "subtitle" and group not in ("new", "none"):
            group = "new"
            self.restrictions_applied += 1
        if role == "title" and protocol.page_has_title(self.state, self.plan):
            self.restrictions_applied += 1
            criteria = {k: v for k, v in q["role"]["criteria"].items() if k != "title"}
            q2 = dict(q)
            q2["role"] = dict(q["role"], criteria=criteria)
            resp2 = self.ask(q2)
            new_role = _valid_or_default(_answer(resp2, "role"), criteria, "")
            if not new_role:
                new_role = "body" if group not in ("none", "new") else "subtitle"
            role = new_role
            # The new role can clash with the group again (rules 1 and 2).
            if group == "new" and role != "subtitle":
                role = "subtitle"
            if role == "subtitle" and group not in ("new", "none"):
                group = "new"
        return role, group

    def _decide_concept(self) -> PlanStep:
        q = {"group": protocol.group_question(self.state, self.plan)}
        resp = self.ask(q)
        group = _valid_or_default(_answer(resp, "group"), q["group"]["criteria"], "none")
        return PlanStep(op="concept", group=group)

    def _decide_connect(self) -> PlanStep | None:
        cands = protocol.candidates(self.state, self.plan)
        if not cands:
            return None
        cand_ids = {c for c, _ in cands}
        origin = _answer(self.ask({"from": protocol.origin_question(cands)}), "from")
        if origin not in cand_ids:
            return None

        cands_to = protocol.candidates_without(cands, {origin})
        if not cands_to:
            return None
        origin_desc = protocol.describe_candidate(cands, origin)
        in_progress = f"arrow from {origin_desc} → ?" if origin_desc else None
        resp_to = self.ask(
            {"to": protocol.destination_question(cands_to, origin_desc)}, in_progress=in_progress
        )
        destination = _answer(resp_to, "to")
        if destination not in {c for c, _ in cands_to}:
            return None
        return PlanStep(op="connect", origin=origin, destination=destination)

    def _decide_point(self) -> PlanStep | None:
        # Each question offers the candidates minus the refs already chosen in
        # this step, so a repeat is impossible by construction.
        cands = protocol.candidates(self.state, self.plan)
        if not cands:
            return None
        refs: list[str] = []
        while True:
            allow_end = len(refs) > 0
            cands_ref = protocol.candidates_without(cands, refs)
            if not cands_ref:
                break
            cand_ids_ref = {c for c, _ in cands_ref}
            in_progress = protocol.point_in_progress(cands, refs)
            resp = self.ask({"ref": protocol.ref_question(cands_ref, allow_end)}, in_progress=in_progress)
            label = _answer(resp, "ref")
            if allow_end and label == "done_pointing":
                break
            if label is None or label not in cand_ids_ref:
                break
            refs.append(label)
            if len(refs) >= protocol.MAX_POINT_REFS:
                # Hard cap: the closing question is still asked once and its
                # answer ignored, as in every other loop of the protocol.
                self.ask(
                    {"ref": protocol.ref_question(protocol.candidates_without(cands, refs), allow_end=True)},
                    in_progress=protocol.point_in_progress(cands, refs),
                )
                break
        if not refs:
            return None
        return PlanStep(op="point", refs=refs)

    def run(self, max_steps: int) -> None:
        """Up to `max_steps` real actions plus one final question that only
        detects `done`. The budget error can surface from any `ask`, and the step
        being decided is then dropped whole."""
        try:
            for step in range(1, max_steps + 2):
                resp = self.ask({"next": protocol.next_action_question(step)})
                label = _answer(resp, "next")
                if label not in VALID_ACTIONS or label == "done":
                    break
                if len(self.plan) >= max_steps:
                    break

                chosen: PlanStep | None
                if label == "text":
                    chosen = self._decide_text()
                elif label == "concept":
                    chosen = self._decide_concept()
                elif label == "connect":
                    chosen = self._decide_connect()
                else:  # "point"
                    chosen = self._decide_point()
                if chosen is not None:
                    self.plan.append(chosen)
                # A dropped step leaves the plan unchanged and the loop goes on.
        except _BudgetExhausted:
            pass


def decide_turn(
    predictor: Any,
    state: dict[str, Any],
    utterance: str,
    max_steps: int = protocol.MAX_STEPS_PER_TURN,
    *,
    budget_ms: float | None = None,
    clock: Callable[[], float] = time.perf_counter,
) -> DecisionResult:
    """Decide a whole turn by asking `predictor` (an object with
    `predict(state_text, questions) -> {question_id: label}`).

    `budget_ms`: if given, the turn is closed with what is already decided once
    it is exceeded. `clock` is injectable so tests need no real waiting. A
    response with no actions is a valid no-op turn.
    """
    loop = _TurnLoop(predictor, state, utterance, budget_ms, clock)
    loop.run(max_steps)
    return DecisionResult(
        plan=loop.plan,
        steps=loop.steps,
        questions=loop.questions,
        ms=(clock() - loop.t0) * 1000.0,
        cut_by_budget=loop.cut_by_budget,
        restrictions_applied=loop.restrictions_applied,
    )
