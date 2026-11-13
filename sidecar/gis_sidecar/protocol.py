"""protocol.py: what Laya sees and is asked.

Laya was fine-tuned on exactly these strings, so wording, ordering and limits
here must not change without retraining. This module holds the plan step type,
the compact text rendering of the board state, the candidate lists for arrows
and highlights, and the builders of the multiple-choice questions.

Decisions use English keys; `envelope.py` translates them to the Spanish
literals of the contract.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

from . import board
from .board import shorten

# Contract version emitted in every envelope.
SCHEMA_VERSION = "1.0"

MAX_BOARD_OBJECTS = 30
MAX_CANDIDATES = 40
# The first texts of the page (title and guiding question) always stay among
# the candidates, even on dense boards where they are no longer recent.
PINNED_OPENING_CANDIDATES = 2
MAX_POINT_REFS = 5
# Sanity cap on the number of actions in one turn.
MAX_STEPS_PER_TURN = 6

ROLE_DESCRIPTIONS: dict[str, str] = {
    "title": "the title of the class",
    "subtitle": "the heading of a section",
    "body": "an idea, definition or explanation",
    "list": "several items, one per line",
    "numbered": "numbered steps or items",
}


@dataclass
class PlanStep:
    """One decided action of a turn.

    `op` is 'text', 'concept', 'connect' or 'point'. `role` (text only) is one
    of `ROLE_DESCRIPTIONS`. `group` is 'none', 'new', the id of an existing
    group or 'group_turn_K' (the K-th group opened in this turn). `origin`,
    `destination` and `refs` are candidate keys: a real id or 'new_N' (the N-th
    entity created in this turn). The text itself is written later.
    """

    op: str
    role: str | None = None
    group: str | None = None
    origin: str | None = None
    destination: str | None = None
    refs: list[str] = field(default_factory=list)


# ── State rendering ─────────────────────────────────────────────────────────


def _step_summary(state: dict[str, Any], previous: list[PlanStep], step: PlanStep) -> str:
    """Summary of one already decided step. `previous` is the plan before it, so
    that `new_N` keys resolve as they did when Laya picked them."""
    if step.op == "text":
        parts = ["text", step.role or "body"]
    elif step.op == "concept":
        parts = ["concept"]
    elif step.op == "connect":
        parts = ["connect"]
    else:  # point
        prev_cands = candidates(state, previous)
        descriptions = [describe_candidate(prev_cands, r) or r for r in step.refs]
        parts = ["point", "at", ", ".join(descriptions)] if descriptions else ["point"]
    if step.op in ("text", "concept") and step.group and step.group != "none":
        parts.append(f"group={step.group}")
    return " ".join(parts)


def page_has_title(state: dict[str, Any], plan: list[PlanStep]) -> bool:
    """Whether the page, or a step already decided in this turn, has a title."""
    return board.has_title(state) or any(p.op == "text" and p.role == "title" for p in plan)


def _connected_in_plan(plan: list[PlanStep]) -> list[str | None]:
    out: list[str | None] = []
    for step in plan:
        if step.op == "connect":
            out.extend((step.origin, step.destination))
    return out


def _hint_lines(state: dict[str, Any], plan: list[PlanStep]) -> list[str]:
    """The two deterministic hints: whether the page has a title, and the most
    recent open question."""
    lines = ["title: " + ("yes" if page_has_title(state, plan) else "no")]
    question = board.open_question(state, _connected_in_plan(plan))
    if question is None:
        lines.append("open question: none")
    else:
        lines.append(f'open question: {question["id"]} "{shorten(question.get("label"))}"')
    return lines


def serialize_state(
    state: dict[str, Any],
    utterance: str,
    plan: list[PlanStep],
    in_progress: str | None = None,
) -> str:
    """Compact text rendering of the turn state that Laya sees.

    `in_progress` describes one step that is half decided (an arrow whose origin
    was chosen but not its destination, or a highlight with some refs); it is
    appended as the last numbered item of "already decided this turn". The hints
    go before the board: the encoder truncates the tail of long states, never
    the head.
    """
    lines = [f'utterance: "{utterance}"']

    previous = state.get("recent_utterances", [])
    lines.append("previous utterances: " + ("; ".join(previous) if previous else "(none)"))
    lines.extend(_hint_lines(state, plan))

    objects = state.get("objects", [])[-MAX_BOARD_OBJECTS:]
    lines.append("board (oldest → newest):")
    if objects:
        for o in objects:
            lines.append(f"  {o['id']} · {o['object']} · «{shorten(o.get('label'))}»")
    else:
        lines.append("  (empty)")

    groups = state.get("groups", [])
    lines.append("groups:")
    if groups:
        for g in groups:
            n_members = len(g.get("members") or [])
            label = board.group_label(state, g["id"]) or g["id"]
            lines.append(f"  {g['id']} «{shorten(label)}»: {n_members} members")
    else:
        lines.append("  (none)")

    if plan or in_progress:
        pieces = [
            f"{i}. {_step_summary(state, plan[: i - 1], step)}" for i, step in enumerate(plan, start=1)
        ]
        if in_progress:
            pieces.append(f"{len(plan) + 1}. {in_progress}")
        lines.append("already decided this turn: " + " · ".join(pieces))
    else:
        lines.append("already decided this turn: (none yet)")

    return "\n".join(lines)


# ── Candidates (they go in the options, not in the state) ───────────────────


def _created_entity_types(plan: list[PlanStep]) -> list[str]:
    """Types of the entities created in the turn, in order: they are numbered
    `new_1`, `new_2`... Highlights create nothing."""
    types: list[str] = []
    for step in plan:
        if step.op == "text":
            types.append("text")
        elif step.op == "concept":
            types.append("concept")
        elif step.op == "connect":
            types.append("connection")
    return types


def candidates(state: dict[str, Any], plan: list[PlanStep]) -> list[tuple[str, str]]:
    """(key, description) of every object, connection and group of the page, plus
    what the turn created so far (`new_N`).

    At most `MAX_CANDIDATES`, oldest to newest: the first
    `PINNED_OPENING_CANDIDATES` texts of the page stay and the rest of the cap is
    filled with the most recent entries.
    """
    entries: list[tuple[str, str]] = []

    for o in state.get("objects", []):
        entries.append((o["id"], f"«{shorten(o.get('label'))}» ({o['object']})"))
    for c in state.get("connections", []):
        entries.append((c["id"], f"«{shorten(c.get('label'))}» (connection)"))
    for g in state.get("groups", []):
        label = board.group_label(state, g["id"]) or g["id"]
        entries.append((g["id"], f"«{shorten(label)}» (group)"))

    for n, kind in enumerate(_created_entity_types(plan), start=1):
        entries.append((f"new_{n}", f"«{shorten(None)}» ({kind})"))

    if len(entries) <= MAX_CANDIDATES:
        return entries

    pinned: list[int] = []
    for i, o in enumerate(state.get("objects", [])):
        if o.get("object") == "texto":
            pinned.append(i)
            if len(pinned) >= PINNED_OPENING_CANDIDATES:
                break
    # Objects come first in `entries`, so their state index is their index here.
    rest = MAX_CANDIDATES - len(pinned)
    recent_start = len(entries) - rest
    indices = [i for i in pinned if i < recent_start] + list(range(recent_start, len(entries)))
    return [entries[i] for i in indices]


def candidates_without(
    cands: list[tuple[str, str]], excluded: Iterable[str] | None
) -> list[tuple[str, str]]:
    """`cands` minus the excluded keys. Offering an option that was already used
    in the same step makes the model repeat it, so it is removed up front."""
    excl = set(excluded) if excluded else set()
    if not excl:
        return list(cands)
    return [(k, v) for k, v in cands if k not in excl]


def describe_candidate(cands: list[tuple[str, str]], key: str | None) -> str | None:
    """The ready-made description of `key` in `cands`, or None."""
    if not key:
        return None
    for k, desc in cands:
        if k == key:
            return desc
    return None


def point_in_progress(cands: list[tuple[str, str]], refs: list[str]) -> str:
    """Description of a highlight whose refs are only partly chosen."""
    descriptions = [describe_candidate(cands, r) or r for r in refs]
    if not descriptions:
        return "point at → ?"
    return "point at " + ", ".join(descriptions) + " → ?"


def groups_opened_in_turn(plan: list[PlanStep]) -> int:
    """How many groups the plan opens (`group_turn_1` ... `group_turn_K`)."""
    return sum(1 for step in plan if step.op in ("text", "concept") and step.group == "new")


# ── Question builders ───────────────────────────────────────────────────────


def _choice(instructions: str, criteria: dict[str, str]) -> dict[str, Any]:
    return {"type": "choice", "instructions": instructions, "criteria": dict(criteria)}


def next_action_question(step: int = 1) -> dict[str, Any]:
    """Pass A: what to do next. At step 1, `done` means nothing at all."""
    if step <= 1:
        instructions = (
            "Based on the teacher's new utterance and what is already on the "
            "board, choose the first action for this turn."
        )
    else:
        instructions = (
            "Previous actions were already decided this turn (see "
            '"already decided this turn"). Choose the next action, or finish.'
        )
    return _choice(
        instructions,
        {
            "done": "nothing else to put on the board for this utterance",
            "text": "write a new text",
            "concept": "draw a concept: a circle with its name inside",
            "connect": "draw an arrow between two elements",
            "point": "point at something already on the board",
        },
    )


def role_question() -> dict[str, Any]:
    return _choice("Choose the semantic role of this text on the board.", dict(ROLE_DESCRIPTIONS))


def group_question(state: dict[str, Any], plan: list[PlanStep]) -> dict[str, Any]:
    """`none`, `new`, the existing groups and the ones opened in this turn."""
    criteria: dict[str, str] = {
        "none": "does not belong to any group",
        "new": "opens a new group",
    }
    for g in state.get("groups", []):
        label = board.group_label(state, g["id"]) or g["id"]
        criteria[g["id"]] = f'joins the existing group "{shorten(label)}"'
    for idx in range(1, groups_opened_in_turn(plan) + 1):
        # The group's heading is not written yet, so it cannot be named here.
        criteria[f"group_turn_{idx}"] = "joins a group opened this turn"
    return _choice("Choose the group this element belongs to.", criteria)


def origin_question(cands: list[tuple[str, str]]) -> dict[str, Any]:
    """Arrow origin. Asked apart from the destination: with both in one call the
    model answered the destination to both."""
    return _choice("Choose the arrow's ORIGIN element.", dict(cands))


def destination_question(cands: list[tuple[str, str]], origin_desc: str | None = None) -> dict[str, Any]:
    """Arrow destination. `cands` must already exclude the origin; the origin's
    description anchors the instruction."""
    if origin_desc:
        instructions = f"The arrow starts at {origin_desc}; choose where it points to."
    else:
        instructions = "Choose the arrow's DESTINATION element."
    return _choice(instructions, dict(cands))


def ref_question(cands: list[tuple[str, str]], allow_end: bool) -> dict[str, Any]:
    """One element to point at. The first one cannot be `done_pointing` (a
    highlight needs at least one ref); from the second on it can."""
    criteria = dict(cands)
    if allow_end:
        criteria["done_pointing"] = "stop pointing; there is nothing else to point at"
        instructions = "Choose another element to point at, or stop pointing."
    else:
        instructions = "Choose which element to point at."
    return _choice(instructions, criteria)
