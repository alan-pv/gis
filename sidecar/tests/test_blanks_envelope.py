"""Blanks (what the text model fills) and the envelope assembled from a plan."""
from __future__ import annotations

import unittest

from tests.helpers import group, make_state, sample_state, text_obj

from gis_sidecar.blanks import blanks_for_plan, section_keys
from gis_sidecar.envelope import build_envelope, interpret_extend_answer, join_continuation
from gis_sidecar.protocol import SCHEMA_VERSION, PlanStep


def body(group_id="grupo_1") -> PlanStep:
    return PlanStep(op="text", role="body", group=group_id)


class TestBlanks(unittest.TestCase):
    def test_empty_plan_and_point_have_no_blanks(self):
        self.assertEqual(blanks_for_plan(make_state(), []), [])
        self.assertEqual(blanks_for_plan(sample_state(), [PlanStep(op="point", refs=["texto_1"])]), [])

    def test_text_blank_carries_its_context(self):
        state = sample_state()
        plan = [PlanStep(op="text", role="list", group="grupo_1")]
        (blank,) = blanks_for_plan(state, plan)
        self.assertEqual((blank.n, blank.kind, blank.role), (1, "text", "list"))
        self.assertEqual(blank.group_label, "Evaporation")
        self.assertEqual(blank.group_lines, ["Evaporation", "The sun heats the sea"])
        self.assertEqual(blank.headings, ["Water cycle", "Evaporation"])

    def test_group_lines_keep_the_last_three(self):
        objects = [text_obj("s", "Heading", "subtitulo")] + [text_obj(f"b{i}", f"line {i}", "lista") for i in range(4)]
        state = make_state(objects=objects, groups=[group("g", ["s", "b0", "b1", "b2", "b3"])])
        (blank,) = blanks_for_plan(state, [PlanStep(op="text", role="list", group="g")])
        self.assertEqual(blank.group_lines, ["line 1", "line 2", "line 3"])

    def test_none_new_and_group_turn_have_no_group_context(self):
        plan = [
            PlanStep(op="text", role="subtitle", group="new"),
            PlanStep(op="text", role="list", group="group_turn_1"),
            PlanStep(op="text", role="list", group="none"),
        ]
        for blank in blanks_for_plan(sample_state(), plan):
            self.assertIsNone(blank.group_label)
            self.assertEqual(blank.group_lines, [])

    def test_body_in_a_section_with_an_open_paragraph_is_extend(self):
        (blank,) = blanks_for_plan(sample_state(), [body()])
        self.assertEqual(blank.kind, "extend")
        self.assertEqual(blank.paragraph, "The sun heats the sea")
        self.assertEqual(blank.target, "texto_3")
        self.assertFalse(blank.long)
        self.assertIsNone(blank.continues)
        self.assertEqual(blank.subtitle, "Evaporation")
        self.assertEqual(blank.group_lines, [])

    def test_long_paragraph_is_flagged_and_not_cut(self):
        state = sample_state()
        state["objects"][2]["label"] = "One two three four five six seven eight nine. Ten. Eleven."
        (blank,) = blanks_for_plan(state, [body()])
        self.assertTrue(blank.long)
        self.assertEqual(blank.paragraph, state["objects"][2]["label"])

    def test_full_paragraph_opens_a_new_one(self):
        state = sample_state()
        state["objects"][2]["label"] = "One. Two. Three. Four."
        (blank,) = blanks_for_plan(state, [body()])
        self.assertEqual(blank.kind, "text")
        self.assertEqual(blank.subtitle, "Evaporation")

    def test_a_concept_or_list_in_between_closes_the_paragraph(self):
        plan = [PlanStep(op="concept", group="grupo_1"), body()]
        blanks = blanks_for_plan(sample_state(), plan)
        self.assertEqual([b.kind for b in blanks], ["concept", "text"])
        plan = [PlanStep(op="text", role="list", group="grupo_1"), body()]
        self.assertEqual([b.kind for b in blanks_for_plan(sample_state(), plan)], ["text", "text"])

    def test_new_group_second_body_continues_the_first_blank(self):
        plan = [PlanStep(op="text", role="subtitle", group="new"), body("group_turn_1"), body("group_turn_1")]
        blanks = blanks_for_plan(make_state(), plan)
        self.assertEqual([b.kind for b in blanks], ["text", "text", "extend"])
        self.assertEqual(blanks[2].continues, 2)
        self.assertIsNone(blanks[2].paragraph)

    def test_existing_section_first_extends_then_chains(self):
        blanks = blanks_for_plan(sample_state(), [body(), body()])
        self.assertEqual([b.kind for b in blanks], ["extend", "extend"])
        self.assertIsNone(blanks[0].continues)
        self.assertEqual(blanks[1].continues, 1)

    def test_arrow_blank_describes_its_ends(self):
        plan = [PlanStep(op="connect", origin="texto_1", destination="concepto_1")]
        (blank,) = blanks_for_plan(sample_state(), plan)
        self.assertEqual((blank.kind, blank.from_label, blank.to_label), ("arrow_label", "Water cycle", "Sun"))

    def test_ends_created_in_the_turn_have_no_text_yet(self):
        plan = [PlanStep(op="concept"), PlanStep(op="connect", origin="new_1", destination="texto_1")]
        blanks = blanks_for_plan(sample_state(), plan)
        self.assertIsNone(blanks[1].from_label)
        self.assertEqual(blanks[1].to_label, "Water cycle")

    def test_section_keys(self):
        plan = [
            PlanStep(op="text", role="subtitle", group="new"),
            PlanStep(op="concept", group="group_turn_1"),
            PlanStep(op="text", role="body", group="grupo_1"),
            PlanStep(op="point", refs=["x"]),
            PlanStep(op="text", role="body", group="none"),
        ]
        self.assertEqual(section_keys(plan), ["group_turn_1", "group_turn_1", "grupo_1", None, None])

    def test_roleless_state_uses_the_heuristic(self):
        state = sample_state()
        for o in state["objects"]:
            o.pop("role", None)
        (blank,) = blanks_for_plan(state, [body()])
        self.assertEqual(blank.kind, "extend")


class TestJoinContinuation(unittest.TestCase):
    def test_punctuation_needs_no_separator(self):
        self.assertEqual(join_continuation("The sun heats", ", which lifts it"), "The sun heats, which lifts it")
        self.assertEqual(join_continuation("A", "."), "A.")

    def test_connector_or_ing_continues_the_sentence(self):
        self.assertEqual(join_continuation("The sun heats", "because it is hot"), "The sun heats because it is hot")
        self.assertEqual(join_continuation("The sun heats", "warming the sea"), "The sun heats warming the sea")

    def test_anything_else_is_a_new_sentence(self):
        self.assertEqual(join_continuation("The sun heats", "hail falls"), "The sun heats. Hail falls")
        self.assertEqual(join_continuation("The sun heats.", "Rain falls"), "The sun heats. Rain falls")
        # capitalized, even if it starts with a connector
        self.assertEqual(join_continuation("Sun", "With light"), "Sun. With light")

    def test_leading_bold_mark_does_not_count_as_the_first_letter(self):
        self.assertEqual(join_continuation("Sun", "**because** it shines"), "Sun **because** it shines")
        self.assertEqual(join_continuation("Sun", "**hail** falls"), "Sun. **Hail** falls")

    def test_empty_parts(self):
        self.assertEqual(join_continuation("", "x"), "x")
        self.assertEqual(join_continuation("x", ""), "x")

    def test_interpret_extend_answer(self):
        self.assertEqual(interpret_extend_answer(""), ("nothing", ""))
        self.assertEqual(interpret_extend_answer("¶"), ("nothing", ""))
        self.assertEqual(interpret_extend_answer("¶ New idea."), ("new", "New idea."))
        self.assertEqual(interpret_extend_answer("¶New idea."), ("new", "New idea."))
        self.assertEqual(interpret_extend_answer(" and more "), ("continue", "and more"))


class TestBuildEnvelope(unittest.TestCase):
    def test_empty_plan(self):
        self.assertEqual(build_envelope(make_state(), [], []), {"schema_version": SCHEMA_VERSION, "operations": []})
        self.assertEqual(SCHEMA_VERSION, "1.0")

    def test_text_with_a_new_group_and_a_concept(self):
        plan = [PlanStep(op="text", role="subtitle", group="new"), PlanStep(op="concept", group="group_turn_1")]
        env = build_envelope(make_state(), plan, ["Heading", "The **sun**"])
        self.assertEqual(
            env["operations"],
            [
                {"op": "add", "id": "texto_1", "object": "texto", "text": "Heading", "role": "subtitulo", "group": "grupo_1"},
                {"op": "add", "id": "concepto_1", "object": "concepto", "label": "The sun", "group": "grupo_1"},
            ],
        )

    def test_roles_map_to_contract_literals(self):
        roles = ["title", "subtitle", "body", "list", "numbered"]
        plan = [PlanStep(op="text", role=r, group="none") for r in roles]
        env = build_envelope(make_state(), plan, ["x"] * 5)
        self.assertEqual(
            [o["role"] for o in env["operations"]], ["titulo", "subtitulo", "cuerpo", "lista", "enumeracion"]
        )

    def test_ids_are_unique_against_the_state(self):
        plan = [PlanStep(op="text", role="body", group="none")]
        env = build_envelope(sample_state(), plan, ["x"])
        self.assertEqual(env["operations"][0]["id"], "texto_4")

    def test_empty_labels_and_names_are_omitted(self):
        plan = [PlanStep(op="concept"), PlanStep(op="connect", origin="new_1", destination="texto_1")]
        env = build_envelope(sample_state(), plan, ["  ", ""])
        self.assertEqual(env["operations"][0], {"op": "add", "id": "concepto_2", "object": "concepto"})
        self.assertEqual(
            env["operations"][1],
            {"op": "connect", "id": "connect_1", "from": "concepto_2", "to": "texto_1", "style": "arrow"},
        )

    def test_new_n_resolves_in_arrows_and_highlights(self):
        plan = [
            PlanStep(op="concept"),
            PlanStep(op="concept"),
            PlanStep(op="connect", origin="new_1", destination="new_2"),
            PlanStep(op="point", refs=["new_3", "texto_1"]),
        ]
        env = build_envelope(make_state(), plan, ["A", "B", "pulls"])
        self.assertEqual(env["operations"][2]["from"], "concepto_1")
        self.assertEqual(env["operations"][2]["label"], "pulls")
        self.assertEqual(env["operations"][3], {"op": "highlight", "refs": ["connect_1", "texto_1"]})

    def test_wrong_number_of_texts_raises(self):
        with self.assertRaises(ValueError):
            build_envelope(make_state(), [PlanStep(op="concept")], [])

    def test_continuation_is_an_update_with_the_previous_text_plus_the_suffix(self):
        env = build_envelope(sample_state(), [body()], ["because it is hot"])
        self.assertEqual(
            env["operations"],
            [{"op": "update", "ref": "texto_3", "set": {"text": "The sun heats the sea because it is hot"}}],
        )

    def test_empty_reply_writes_nothing(self):
        self.assertEqual(build_envelope(sample_state(), [body()], [""])["operations"], [])

    def test_paragraph_mark_adds_a_new_body_line_in_the_same_section(self):
        env = build_envelope(sample_state(), [body()], ["¶ Rain falls."])
        self.assertEqual(
            env["operations"],
            [{"op": "add", "id": "texto_4", "object": "texto", "text": "Rain falls.", "role": "cuerpo", "group": "grupo_1"}],
        )

    def test_chained_blanks_merge_into_one_update(self):
        env = build_envelope(sample_state(), [body(), body()], ["because it is hot", "and it rises"])
        self.assertEqual(len(env["operations"]), 1)
        self.assertEqual(
            env["operations"][0]["set"]["text"], "The sun heats the sea because it is hot and it rises"
        )

    def test_chained_blanks_in_a_new_group_merge_into_one_add(self):
        plan = [PlanStep(op="text", role="subtitle", group="new"), body("group_turn_1"), body("group_turn_1")]
        env = build_envelope(make_state(), plan, ["Heading", "Sun heats water", "because it is hot"])
        self.assertEqual(len(env["operations"]), 2)
        self.assertEqual(env["operations"][1]["text"], "Sun heats water because it is hot")

    def test_chain_with_an_empty_first_reply_extends_through_the_second(self):
        env = build_envelope(sample_state(), [body(), body()], ["", "and it rises"])
        self.assertEqual(env["operations"][0]["set"]["text"], "The sun heats the sea and it rises")

    def test_new_n_of_an_extend_step_points_at_the_paragraph(self):
        plan = [body(), PlanStep(op="point", refs=["new_1"])]
        env = build_envelope(sample_state(), plan, ["because it is hot"])
        self.assertEqual(env["operations"][1], {"op": "highlight", "refs": ["texto_3"]})

    def test_new_numbering_counts_extend_steps(self):
        plan = [body(), PlanStep(op="concept"), PlanStep(op="point", refs=["new_2"])]
        env = build_envelope(sample_state(), plan, ["", "Cloud"])
        self.assertEqual(env["operations"][-1], {"op": "highlight", "refs": ["concepto_2"]})


if __name__ == "__main__":
    unittest.main()
