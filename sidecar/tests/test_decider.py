"""The decision loop: degradation on invalid answers, the two-call arrow, the
highlight sub-loop, role/group restrictions, the time budget and the Laya
adapter."""
from __future__ import annotations

import sys
import unittest
from typing import Any
from unittest import mock

from tests.helpers import make_state, sample_state, text_obj

from gis_sidecar import decider
from gis_sidecar.decider import LayaPredictor, decide_turn


class Scripted:
    """Answers from a script: one dict per call (the last one repeats)."""

    def __init__(self, *answers: dict[str, str]):
        self.answers = list(answers)
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def predict(self, state_text: str, questions: dict[str, Any]) -> dict[str, str]:
        self.calls.append((state_text, questions))
        i = min(len(self.calls) - 1, len(self.answers) - 1)
        return self.answers[i]


def plan_of(result):
    return [(s.op, s.role, s.group, s.origin, s.destination, s.refs) for s in result.plan]


class TestDegradation(unittest.TestCase):
    def test_invalid_next_label_is_a_noop(self):
        result = decide_turn(Scripted({"next": "dance"}), make_state(), "hi")
        self.assertEqual(result.plan, [])
        self.assertEqual((result.steps, result.questions), (1, 1))

    def test_missing_answer_and_done_are_noops(self):
        self.assertEqual(decide_turn(Scripted({}), make_state(), "hi").plan, [])
        self.assertEqual(decide_turn(Scripted({"next": "done"}), make_state(), "hi").plan, [])

    def test_removed_actions_are_invalid(self):
        for label in ("figure", "name"):
            self.assertEqual(decide_turn(Scripted({"next": label}), make_state(), "hi").plan, [])

    def test_connect_and_point_without_candidates_are_skipped(self):
        for label in ("connect", "point"):
            result = decide_turn(Scripted({"next": label}, {"next": "done"}), make_state(), "hi")
            self.assertEqual(result.plan, [])

    def test_invalid_role_and_group_use_defaults(self):
        script = Scripted({"next": "text"}, {"role": "poem", "group": "nowhere"}, {"next": "done"})
        result = decide_turn(script, make_state(), "hi")
        self.assertEqual(plan_of(result), [("text", "body", "none", None, None, [])])

    def test_concept_asks_only_for_the_group(self):
        script = Scripted({"next": "concept"}, {"group": "new"}, {"next": "done"})
        result = decide_turn(script, make_state(), "hi")
        self.assertEqual(list(script.calls[1][1]), ["group"])
        self.assertEqual(plan_of(result), [("concept", None, "new", None, None, [])])

    def test_step_cap(self):

        class Alternating:
            def predict(self, state_text, questions):
                return {"group": "none"} if "group" in questions else {"next": "concept"}

        result = decide_turn(Alternating(), make_state(), "hi", max_steps=3)
        self.assertEqual(len(result.plan), 3)


class TestArrow(unittest.TestCase):
    def test_origin_and_destination_are_two_calls(self):
        script = Scripted({"next": "connect"}, {"from": "texto_1"}, {"to": "concepto_1"}, {"next": "done"})
        result = decide_turn(script, sample_state(), "hi")
        self.assertEqual(plan_of(result), [("connect", None, None, "texto_1", "concepto_1", [])])
        self.assertEqual(list(script.calls[1][1]), ["from"])
        self.assertEqual(list(script.calls[2][1]), ["to"])
        self.assertIn("arrow from «Water cycle» (texto) → ?", script.calls[2][0])

    def test_destination_never_offers_the_origin(self):
        script = Scripted({"next": "connect"}, {"from": "texto_1"}, {"to": "concepto_1"}, {"next": "done"})
        decide_turn(script, sample_state(), "hi")
        self.assertNotIn("texto_1", script.calls[2][1]["to"]["criteria"])

    def test_invalid_origin_skips_the_destination_question(self):
        script = Scripted({"next": "connect"}, {"from": "nope"}, {"next": "done"})
        result = decide_turn(script, sample_state(), "hi")
        self.assertEqual(result.plan, [])
        self.assertEqual(script.calls[2][1].keys(), {"next"})

    def test_invalid_destination_drops_the_step(self):
        script = Scripted({"next": "connect"}, {"from": "texto_1"}, {"to": "texto_1"}, {"next": "done"})
        self.assertEqual(decide_turn(script, sample_state(), "hi").plan, [])


class TestPoint(unittest.TestCase):
    def test_refs_already_chosen_are_not_offered_again(self):
        script = Scripted(
            {"next": "point"}, {"ref": "texto_1"}, {"ref": "concepto_1"}, {"ref": "done_pointing"}, {"next": "done"}
        )
        result = decide_turn(script, sample_state(), "hi")
        self.assertEqual(plan_of(result), [("point", None, None, None, None, ["texto_1", "concepto_1"])])
        second = script.calls[2][1]["ref"]["criteria"]
        self.assertNotIn("texto_1", second)
        self.assertIn("done_pointing", second)
        self.assertNotIn("done_pointing", script.calls[1][1]["ref"]["criteria"])
        self.assertIn("point at «Water cycle» (texto) → ?", script.calls[2][0])

    def test_repeated_ref_closes_the_sub_loop(self):
        script = Scripted({"next": "point"}, {"ref": "texto_1"}, {"ref": "texto_1"}, {"next": "done"})
        result = decide_turn(script, sample_state(), "hi")
        self.assertEqual(result.plan[0].refs, ["texto_1"])

    def test_no_valid_ref_drops_the_step(self):
        script = Scripted({"next": "point"}, {"ref": "nope"}, {"next": "done"})
        self.assertEqual(decide_turn(script, sample_state(), "hi").plan, [])

    def test_the_cap_asks_one_closing_question_and_ignores_it(self):
        state = make_state(objects=[text_obj(f"t{i}", f"line {i}") for i in range(8)])
        script = Scripted({"next": "point"}, *[{"ref": f"t{i}"} for i in range(5)], {"ref": "t7"}, {"next": "done"})
        result = decide_turn(script, state, "hi")
        self.assertEqual(result.plan[0].refs, ["t0", "t1", "t2", "t3", "t4"])
        self.assertIn("done_pointing", script.calls[6][1]["ref"]["criteria"])


class TestRestrictions(unittest.TestCase):
    def run_text(self, state, role, group_label, extra=()):
        script = Scripted({"next": "text"}, {"role": role, "group": group_label}, *extra, {"next": "done"})
        return decide_turn(script, state, "hi"), script

    def test_new_group_forces_subtitle(self):
        result, _ = self.run_text(make_state(), "body", "new")
        self.assertEqual((result.plan[0].role, result.plan[0].group), ("subtitle", "new"))
        self.assertEqual(result.restrictions_applied, 1)

    def test_subtitle_in_existing_group_opens_a_new_one(self):
        result, _ = self.run_text(sample_state(), "subtitle", "grupo_1")
        self.assertEqual((result.plan[0].role, result.plan[0].group), ("subtitle", "new"))

    def test_subtitle_in_a_group_of_this_turn_opens_a_new_one(self):
        script = Scripted(
            {"next": "text"}, {"role": "subtitle", "group": "new"},
            {"next": "text"}, {"role": "subtitle", "group": "group_turn_1"},
            {"next": "done"},
        )
        result = decide_turn(script, make_state(), "hi")
        self.assertEqual([s.group for s in result.plan], ["new", "new"])

    def test_body_in_existing_group_is_untouched(self):
        result, _ = self.run_text(sample_state(), "body", "grupo_1")
        self.assertEqual((result.plan[0].role, result.plan[0].group), ("body", "grupo_1"))
        self.assertEqual(result.restrictions_applied, 0)

    def test_second_title_is_asked_again_without_the_option(self):
        result, script = self.run_text(sample_state(), "title", "none", extra=[{"role": "list"}])
        self.assertEqual(result.plan[0].role, "list")
        retry = script.calls[2][1]["role"]["criteria"]
        self.assertNotIn("title", retry)
        self.assertEqual(result.restrictions_applied, 1)

    def test_title_on_an_empty_page_is_kept(self):
        result, _ = self.run_text(make_state(), "title", "none")
        self.assertEqual(result.plan[0].role, "title")

    def test_second_title_in_the_same_turn_is_masked(self):
        script = Scripted(
            {"next": "text"}, {"role": "title", "group": "none"},
            {"next": "text"}, {"role": "title", "group": "none"}, {"role": "body"},
            {"next": "done"},
        )
        result = decide_turn(script, make_state(), "hi")
        self.assertEqual([s.role for s in result.plan], ["title", "body"])

    def test_invalid_retry_falls_back(self):
        result, _ = self.run_text(sample_state(), "title", "grupo_1", extra=[{"role": "title"}])
        self.assertEqual(result.plan[0].role, "body")
        result2, _ = self.run_text(sample_state(), "title", "new", extra=[{"role": "poem"}])
        self.assertEqual(result2.plan[0].role, "subtitle")


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


class TestBudget(unittest.TestCase):
    def test_no_budget_never_cuts(self):
        script = Scripted({"next": "text"}, {"role": "body", "group": "none"}, {"next": "done"})
        self.assertFalse(decide_turn(script, make_state(), "hi").cut_by_budget)

    def test_cut_mid_step_drops_the_step_whole(self):
        clock = FakeClock()

        class Slow:
            def predict(self, state_text, questions):
                clock.now += 1.0  # each call takes 1000 ms
                return {"next": "text"} if "next" in questions else {"role": "body", "group": "none"}

        result = decide_turn(Slow(), make_state(), "hi", budget_ms=1500, clock=clock)
        # first call (next=text) took 1000 ms; the role/group call started at 1000 ms
        # and ended at 2000 ms; the next question is refused.
        self.assertTrue(result.cut_by_budget)
        self.assertEqual([s.op for s in result.plan], ["text"])
        self.assertEqual(result.steps, 2)

    def test_first_step_kept_second_dropped_whole(self):
        clock = FakeClock()

        class Fast:
            def __init__(self):
                self.n = 0

            def predict(self, state_text, questions):
                self.n += 1
                if self.n == 3:
                    clock.now += 10.0
                return {"next": "text"} if "next" in questions else {"role": "body", "group": "none"}

        result = decide_turn(Fast(), make_state(), "hi", budget_ms=5000, clock=clock)
        self.assertTrue(result.cut_by_budget)
        self.assertEqual(len(result.plan), 1)

    def test_generous_budget_does_not_cut(self):
        script = Scripted({"next": "done"})
        self.assertFalse(decide_turn(script, make_state(), "hi", budget_ms=60_000).cut_by_budget)


class FakeAgent:
    def __init__(self, answers):
        self.answers = answers
        self.kwargs = None
        self.model = mock.Mock()

    def predict(self, state_text, questions, **kwargs):
        self.kwargs = kwargs
        return {"answers": self.answers}


class TestLayaPredictor(unittest.TestCase):
    def test_returns_only_the_chosen_labels_with_fixed_lengths(self):
        agent = FakeAgent({"next": {"choice": "text", "confidence": 0.9}, "other": {"probabilities": {}}})
        fake_torch = mock.Mock(float32="fp32-marker")
        with mock.patch.dict(sys.modules, {"torch": fake_torch}):
            predictor = LayaPredictor(agent)
        out = predictor.predict("state", {"next": {}, "other": {}, "third": {}})
        self.assertEqual(out, {"next": "text"})
        self.assertEqual(agent.kwargs, {"max_len": 2048, "head_max_len": 768})

    def test_the_model_runs_in_fp32(self):
        agent = FakeAgent({})
        fake_torch = mock.Mock(float32="fp32-marker")
        with mock.patch.dict(sys.modules, {"torch": fake_torch}):
            LayaPredictor(agent)
        agent.model.float.assert_called_once_with()
        self.assertEqual(agent.dtype, "fp32-marker")
        self.assertFalse(agent.amp_enabled)

    def test_non_dict_result_gives_no_answers(self):
        agent = FakeAgent({})
        agent.predict = lambda *a, **k: None
        with mock.patch.dict(sys.modules, {"torch": mock.Mock()}):
            predictor = LayaPredictor(agent)
        self.assertEqual(predictor.predict("s", {"next": {}}), {})


if __name__ == "__main__":
    unittest.main()
