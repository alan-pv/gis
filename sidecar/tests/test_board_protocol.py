"""Board queries (board.py) and what Laya sees (protocol.py)."""
from __future__ import annotations

import unittest

from tests.helpers import concept_obj, connection, group, make_state, sample_state, text_obj

from gis_sidecar import board, protocol
from gis_sidecar.protocol import PlanStep


class TestShorten(unittest.TestCase):
    def test_short_text_is_unchanged(self):
        self.assertEqual(board.shorten("one two three"), "one two three")

    def test_long_text_is_cut_to_eight_words(self):
        self.assertEqual(board.shorten("a b c d e f g h i j"), "a b c d e f g h…")

    def test_none_and_empty(self):
        self.assertEqual(board.shorten(None), "(no text)")
        self.assertEqual(board.shorten(""), "(no text)")


class TestRoles(unittest.TestCase):
    def test_uses_the_role_of_the_state(self):
        state = make_state(objects=[text_obj("t1", "x", "subtitulo"), text_obj("t2", "y", "lista")])
        self.assertEqual(board.role_of(state["objects"][0], state), "subtitulo")
        self.assertEqual(board.role_of(state["objects"][1], state), "lista")

    def test_concept_has_no_role(self):
        state = make_state(objects=[concept_obj("c1", "Sun")])
        self.assertIsNone(board.role_of(state["objects"][0], state))

    def test_fallback_without_roles(self):
        state = make_state(
            objects=[
                text_obj("t1", "Title", None),
                text_obj("t2", "Heading", None),
                text_obj("t3", "Body", None),
                text_obj("t4", "a\nb", None),
            ],
            groups=[group("g1", ["t2", "t3", "t4"])],
        )
        roles = [board.role_of(o, state) for o in state["objects"]]
        self.assertEqual(roles, ["titulo", "subtitulo", "cuerpo", "lista"])

    def test_unknown_role_falls_back(self):
        state = make_state(objects=[text_obj("t1", "x", "weird")])
        self.assertEqual(board.role_of(state["objects"][0], state), "titulo")


class TestParagraphs(unittest.TestCase):
    def test_count_sentences(self):
        self.assertEqual(board.count_sentences(""), 0)
        self.assertEqual(board.count_sentences("One. Two! Three?"), 3)
        self.assertEqual(board.count_sentences("A; b"), 2)

    def test_long_and_full(self):
        self.assertFalse(board.paragraph_is_long("One. Two."))
        self.assertTrue(board.paragraph_is_long("One. Two. Three."))
        self.assertFalse(board.paragraph_is_full("One. Two. Three."))
        self.assertTrue(board.paragraph_is_full("One. Two. Three. Four."))
        self.assertTrue(board.paragraph_is_full(" ".join(["word"] * 45)))

    def test_open_paragraph_is_the_last_body_member(self):
        state = sample_state()
        self.assertEqual(board.open_paragraph(state, "grupo_1")["id"], "texto_3")

    def test_list_or_concept_as_last_member_closes_it(self):
        state = sample_state()
        state["objects"].append(text_obj("texto_4", "a\nb", "lista"))
        state["groups"][0]["members"].append("texto_4")
        self.assertIsNone(board.open_paragraph(state, "grupo_1"))

    def test_full_paragraph_is_not_open(self):
        state = sample_state()
        state["objects"][2]["label"] = "One. Two. Three. Four."
        self.assertIsNone(board.open_paragraph(state, "grupo_1"))

    def test_arrows_do_not_interrupt(self):
        state = sample_state()
        state["connections"].append(connection("connect_1", "concepto_1", "texto_3"))
        self.assertIsNotNone(board.open_paragraph(state, "grupo_1"))

    def test_group_subtitle(self):
        state = sample_state()
        self.assertEqual(board.group_subtitle(state, "grupo_1"), "Evaporation")
        self.assertIsNone(board.group_subtitle(state, "missing"))


class TestHeadingsAndTitle(unittest.TestCase):
    def test_headings_with_roles(self):
        self.assertEqual(board.headings(sample_state()), ["Water cycle", "Evaporation"])

    def test_headings_are_deduplicated_and_capped(self):
        objects = [text_obj("t0", "Title", "titulo")] + [
            text_obj(f"t{i}", f"Heading {i}", "subtitulo") for i in range(1, 12)
        ]
        headings = board.headings(make_state(objects=objects))
        self.assertEqual(len(headings), board.MAX_HEADINGS)
        self.assertEqual(headings[0], "Title")
        self.assertEqual(headings[-1], "Heading 11")
        dup = make_state(objects=[text_obj("a", "Sun", "titulo"), text_obj("b", " sun ", "subtitulo")])
        self.assertEqual(board.headings(dup), ["Sun"])

    def test_has_title(self):
        self.assertFalse(board.has_title(make_state()))
        self.assertTrue(board.has_title(sample_state()))
        no_title = make_state(objects=[text_obj("t1", "x", "cuerpo")])
        self.assertFalse(board.has_title(no_title))
        legacy = make_state(objects=[text_obj("t1", "x", None)])
        self.assertTrue(board.has_title(legacy))


class TestOpenQuestion(unittest.TestCase):
    def test_format_and_most_recent_wins(self):
        state = make_state(objects=[text_obj("t1", "Why?", "subtitulo"), text_obj("t2", "How **so**?", "cuerpo")])
        self.assertEqual(board.open_question(state)["id"], "t2")

    def test_connected_question_is_closed(self):
        state = make_state(
            objects=[text_obj("t1", "Why?"), concept_obj("c1", "Sun")],
            connections=[connection("k1", "c1", "t1")],
        )
        self.assertIsNone(board.open_question(state))
        open_state = make_state(objects=[text_obj("t1", "Why?")])
        self.assertIsNotNone(board.open_question(open_state))
        self.assertIsNone(board.open_question(open_state, extra_connected=["t1"]))

    def test_trailing_quotes_count_but_plain_text_does_not(self):
        self.assertTrue(board.ends_in_question('Why "now"?"'))
        self.assertFalse(board.ends_in_question("Why? Because."))


class TestSerializeState(unittest.TestCase):
    def test_empty_board(self):
        text = protocol.serialize_state(make_state(), "hello", [])
        self.assertEqual(
            text,
            "\n".join(
                [
                    'utterance: "hello"',
                    "previous utterances: (none)",
                    "title: no",
                    "open question: none",
                    "board (oldest → newest):",
                    "  (empty)",
                    "groups:",
                    "  (none)",
                    "already decided this turn: (none yet)",
                ]
            ),
        )

    def test_board_groups_and_hints(self):
        text = protocol.serialize_state(sample_state(), "hi", [])
        self.assertIn("previous utterances: First sentence.; Second sentence.", text)
        self.assertIn("title: yes", text)
        self.assertIn("  texto_3 · texto · «The sun heats the sea»", text)
        self.assertIn("  concepto_1 · concepto · «Sun»", text)
        self.assertIn("  grupo_1 «Evaporation»: 2 members", text)
        # the hints come before the board: the encoder truncates the tail
        self.assertLess(text.index("title:"), text.index("board ("))

    def test_open_question_hint_is_shortened(self):
        state = make_state(objects=[text_obj("t1", "one two three four five six seven eight nine ten?")])
        text = protocol.serialize_state(state, "x", [])
        self.assertIn('open question: t1 "one two three four five six seven eight…"', text)

    def test_roles_are_invisible_to_laya(self):
        with_roles = sample_state()
        without = sample_state()
        for o in without["objects"]:
            o.pop("role", None)
        a = protocol.serialize_state(with_roles, "u", [])
        b = protocol.serialize_state(without, "u", [])
        self.assertEqual(a.replace("title: yes", "title: x"), b.replace("title: yes", "title: x"))

    def test_decided_steps_and_in_progress(self):
        plan = [PlanStep(op="text", role="subtitle", group="new"), PlanStep(op="concept", group="group_turn_1")]
        text = protocol.serialize_state(make_state(), "u", plan, in_progress="arrow from X → ?")
        self.assertIn(
            "already decided this turn: 1. text subtitle group=new · 2. concept group=group_turn_1 · 3. arrow from X → ?",
            text,
        )

    def test_decided_point_lists_its_refs(self):
        state = sample_state()
        plan = [PlanStep(op="point", refs=["texto_1", "concepto_1"])]
        text = protocol.serialize_state(state, "u", plan)
        self.assertIn("1. point at «Water cycle» (texto), «Sun» (concepto)", text)

    def test_title_hint_sees_the_turn_plan(self):
        plan = [PlanStep(op="text", role="title", group="none")]
        self.assertIn("title: yes", protocol.serialize_state(make_state(), "u", plan))

    def test_board_is_cut_to_the_last_30_objects(self):
        state = make_state(objects=[text_obj(f"t{i}", f"line {i}") for i in range(40)])
        text = protocol.serialize_state(state, "u", [])
        self.assertNotIn("  t9 ·", text)
        self.assertIn("  t10 ·", text)


class TestCandidates(unittest.TestCase):
    def test_state_entities_and_groups(self):
        state = sample_state()
        state["connections"].append(connection("connect_1", "concepto_1", "texto_3", "heats"))
        keys = [k for k, _ in protocol.candidates(state, [])]
        self.assertEqual(keys, ["texto_1", "texto_2", "texto_3", "concepto_1", "connect_1", "grupo_1"])
        self.assertIn(("grupo_1", "«Evaporation» (group)"), protocol.candidates(state, []))

    def test_entities_created_in_the_turn_are_new_n(self):
        plan = [PlanStep(op="text", role="body"), PlanStep(op="point", refs=["texto_1"]), PlanStep(op="concept")]
        cands = protocol.candidates(make_state(), plan)
        self.assertEqual(cands, [("new_1", "«(no text)» (text)"), ("new_2", "«(no text)» (concept)")])

    def test_cap_is_40_and_keeps_the_opening(self):
        state = make_state(objects=[text_obj(f"t{i}", f"line {i}") for i in range(60)])
        cands = protocol.candidates(state, [])
        self.assertEqual(len(cands), 40)
        self.assertEqual([k for k, _ in cands[:2]], ["t0", "t1"])
        self.assertEqual(cands[-1][0], "t59")

    def test_under_the_cap_nothing_changes(self):
        state = make_state(objects=[text_obj(f"t{i}", "x") for i in range(40)])
        self.assertEqual(len(protocol.candidates(state, [])), 40)

    def test_without_and_describe(self):
        cands = [("a", "A"), ("b", "B"), ("c", "C")]
        self.assertEqual(protocol.candidates_without(cands, ["a", "c"]), [("b", "B")])
        self.assertEqual(protocol.candidates_without(cands, None), cands)
        self.assertEqual(protocol.candidates_without(cands, []), cands)
        self.assertEqual(protocol.describe_candidate(cands, "b"), "B")
        self.assertIsNone(protocol.describe_candidate(cands, "zz"))
        self.assertIsNone(protocol.describe_candidate(cands, None))

    def test_point_in_progress(self):
        cands = [("a", "«A» (texto)"), ("b", "«B» (texto)")]
        self.assertEqual(protocol.point_in_progress(cands, []), "point at → ?")
        self.assertEqual(protocol.point_in_progress(cands, ["a", "b"]), "point at «A» (texto), «B» (texto) → ?")
        self.assertEqual(protocol.point_in_progress(cands, ["zz"]), "point at zz → ?")


class TestQuestions(unittest.TestCase):
    def test_next_action_has_five_options(self):
        q = protocol.next_action_question()
        self.assertEqual(q["type"], "choice")
        self.assertEqual(list(q["criteria"]), ["done", "text", "concept", "connect", "point"])
        self.assertIn("first action", q["instructions"])
        self.assertIn("next action", protocol.next_action_question(2)["instructions"])

    def test_role_question_has_no_note(self):
        self.assertEqual(
            list(protocol.role_question()["criteria"]), ["title", "subtitle", "body", "list", "numbered"]
        )

    def test_group_question(self):
        plan = [PlanStep(op="text", role="subtitle", group="new"), PlanStep(op="concept", group="new")]
        criteria = protocol.group_question(sample_state(), plan)["criteria"]
        self.assertEqual(list(criteria), ["none", "new", "grupo_1", "group_turn_1", "group_turn_2"])
        self.assertEqual(criteria["grupo_1"], 'joins the existing group "Evaporation"')
        self.assertEqual(criteria["group_turn_1"], "joins a group opened this turn")

    def test_arrow_questions(self):
        cands = [("a", "A"), ("b", "B")]
        self.assertEqual(protocol.origin_question(cands)["criteria"], dict(cands))
        self.assertEqual(
            protocol.destination_question(cands)["instructions"], "Choose the arrow's DESTINATION element."
        )
        self.assertEqual(
            protocol.destination_question(cands, "«A» (texto)")["instructions"],
            "The arrow starts at «A» (texto); choose where it points to.",
        )

    def test_ref_question_offers_the_end_only_after_the_first_ref(self):
        cands = [("a", "A")]
        self.assertNotIn("done_pointing", protocol.ref_question(cands, allow_end=False)["criteria"])
        self.assertIn("done_pointing", protocol.ref_question(cands, allow_end=True)["criteria"])


if __name__ == "__main__":
    unittest.main()
