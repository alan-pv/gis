"""Corrections applied to the plan and to the finished envelope."""
from __future__ import annotations

import contextlib
import io
import unittest

from tests.helpers import concept_obj, connection, group, make_state, sample_state, text_obj

from gis_sidecar import filters
from gis_sidecar.protocol import PlanStep


def add_text(oid, text, role="cuerpo", grp=None):
    op = {"op": "add", "id": oid, "object": "texto", "text": text, "role": role}
    if grp:
        op["group"] = grp
    return op


def add_concept(oid, label, grp=None):
    op = {"op": "add", "id": oid, "object": "concepto", "label": label}
    if grp:
        op["group"] = grp
    return op


def connect(cid, origin, destination, label=None):
    op = {"op": "connect", "id": cid, "from": origin, "to": destination, "style": "arrow"}
    if label:
        op["label"] = label
    return op


def env(*ops):
    return {"schema_version": "1.0", "operations": list(ops)}


def quiet(fn, *args):
    with contextlib.redirect_stderr(io.StringIO()):
        return fn(*args)


class TestAssignLooseBody(unittest.TestCase):
    def test_loose_body_goes_to_the_most_recent_section(self):
        state = sample_state()
        plan = [PlanStep(op="text", role="body", group="none")]
        new_plan, n = quiet(filters.assign_loose_body, state, plan)
        self.assertEqual((n, new_plan[0].group), (1, "grupo_1"))
        self.assertEqual(plan[0].group, "none")  # the input is not modified

    def test_list_and_numbered_too(self):
        plan = [PlanStep(op="text", role="list", group="none"), PlanStep(op="text", role="numbered", group=None)]
        new_plan, n = quiet(filters.assign_loose_body, sample_state(), plan)
        self.assertEqual((n, [p.group for p in new_plan]), (2, ["grupo_1", "grupo_1"]))

    def test_title_subtitle_and_concept_are_left_alone(self):
        plan = [
            PlanStep(op="text", role="title", group="none"),
            PlanStep(op="text", role="subtitle", group="none"),
            PlanStep(op="concept", group="none"),
        ]
        new_plan, n = quiet(filters.assign_loose_body, sample_state(), plan)
        self.assertEqual((n, [p.group for p in new_plan]), (0, ["none", "none", "none"]))

    def test_without_sections_nothing_happens(self):
        plan = [PlanStep(op="text", role="body", group="none")]
        self.assertEqual(quiet(filters.assign_loose_body, make_state(), plan)[1], 0)

    def test_a_section_opened_in_the_same_turn_counts(self):
        plan = [PlanStep(op="text", role="subtitle", group="new"), PlanStep(op="text", role="body", group="none")]
        new_plan, n = quiet(filters.assign_loose_body, make_state(), plan)
        self.assertEqual((n, new_plan[1].group), (1, "group_turn_1"))

    def test_an_explicit_group_moves_the_recent_one(self):
        state = make_state(
            objects=[text_obj("a", "x", "subtitulo"), text_obj("b", "y", "subtitulo")],
            groups=[group("g1", ["a"]), group("g2", ["b"])],
        )
        plan = [PlanStep(op="text", role="body", group="g1"), PlanStep(op="text", role="body", group="none")]
        new_plan, _ = quiet(filters.assign_loose_body, state, plan)
        self.assertEqual(new_plan[1].group, "g1")


class TestDropDuplicateTexts(unittest.TestCase):
    def test_duplicate_of_the_turn_and_of_the_board(self):
        state = make_state(objects=[text_obj("t1", "The Sun", "titulo")])
        out, n = filters.drop_duplicate_texts(
            state, env(add_text("a", "the sun!"), add_text("b", "Rain"), add_text("c", "rain"))
        )
        self.assertEqual(n, 2)
        self.assertEqual([o["id"] for o in out["operations"]], ["b"])

    def test_cascade_to_arrows_highlights_and_the_new_group(self):
        state = make_state(objects=[text_obj("t1", "Water cycle", "titulo")])
        ops = [
            add_text("a", "Water cycle", "subtitulo", "g_new"),
            add_text("b", "Rain falls on the hills", "cuerpo", "g_new"),
            add_concept("c", "Rain"),
            connect("k1", "a", "c"),
            {"op": "highlight", "refs": ["a", "c"]},
            {"op": "highlight", "refs": ["a"]},
        ]
        out, n = filters.drop_duplicate_texts(state, env(*ops))
        ids = [o.get("id") or o["op"] for o in out["operations"]]
        self.assertEqual(ids, ["c", "highlight"])
        self.assertEqual(out["operations"][1]["refs"], ["c"])
        self.assertEqual(n, 4)

    def test_repeated_subtitle_of_an_existing_group_relocates_the_rest(self):
        state = sample_state()
        ops = [
            add_text("a", "Evaporation", "subtitulo", "g_new"),
            add_text("b", "Water rises as vapor", "cuerpo", "g_new"),
        ]
        out, n = filters.drop_duplicate_texts(state, env(*ops))
        self.assertEqual(n, 1)
        self.assertEqual(out["operations"][0]["group"], "grupo_1")

    def test_repeated_title_drops_the_whole_group(self):
        state = sample_state()
        ops = [add_text("a", "Water cycle", "subtitulo", "g_new"), add_text("b", "Rain falls here", "cuerpo", "g_new")]
        out, n = filters.drop_duplicate_texts(state, env(*ops))
        self.assertEqual((n, out["operations"]), (2, []))

    def test_extension_that_adds_nothing_is_dropped(self):
        state = sample_state()
        same = {"op": "update", "ref": "texto_3", "set": {"text": "The sun heats the sea. Heats!"}}
        contained = {"op": "update", "ref": "texto_3", "set": {"text": "The sun heats the sea the sun"}}
        new = {"op": "update", "ref": "texto_3", "set": {"text": "The sun heats the sea so clouds form"}}
        out, n = filters.drop_duplicate_texts(state, env(same, contained, new))
        self.assertEqual(n, 2)
        self.assertEqual(out["operations"], [new])

    def test_nothing_to_drop_changes_nothing(self):
        e = env(add_text("a", "Fresh text"))
        self.assertEqual(filters.drop_duplicate_texts(sample_state(), e), (e, 0))


class TestDropShortFragments(unittest.TestCase):
    def test_short_body_is_dropped_with_its_cascade(self):
        ops = [
            add_text("a", "mountains"),
            add_text("b", "Water flows down the mountains"),
            connect("k1", "a", "b"),
            {"op": "update", "ref": "a", "set": {"text": "x"}},
        ]
        out, n = filters.drop_short_fragments(env(*ops))
        self.assertEqual(n, 3)
        self.assertEqual([o["id"] for o in out["operations"]], ["b"])

    def test_titles_subtitles_numbered_and_updates_are_kept(self):
        ops = [
            add_text("a", "Sun", "titulo"),
            add_text("b", "Sun", "subtitulo"),
            add_text("c", "Sun", "enumeracion"),
            {"op": "update", "ref": "z", "set": {"text": "x"}},
        ]
        e = env(*ops)
        self.assertEqual(filters.drop_short_fragments(e), (e, 0))

    def test_bold_marks_do_not_count_as_words(self):
        out, n = filters.drop_short_fragments(env(add_text("a", "**Sun** ** **")))
        self.assertEqual(n, 1)
        out, n = filters.drop_short_fragments(env(add_text("a", "The **sun** heats **water**")))
        self.assertEqual(n, 0)


class TestDropEmptyConcepts(unittest.TestCase):
    def test_empty_concept_is_dropped_with_what_references_it(self):
        ops = [
            add_concept("c1", ""),
            add_concept("c2", "Sun"),
            connect("k1", "c1", "c2"),
            {"op": "highlight", "refs": ["c1"]},
        ]
        out, n = filters.drop_empty_concepts(env(*ops))
        self.assertEqual(n, 3)
        self.assertEqual([o["id"] for o in out["operations"]], ["c2"])

    def test_missing_label_counts_as_empty(self):
        out, n = filters.drop_empty_concepts(env({"op": "add", "id": "c1", "object": "concepto"}))
        self.assertEqual((n, out["operations"]), (1, []))


class TestCleanConnections(unittest.TestCase):
    def state(self):
        return make_state(
            objects=[concept_obj("c1", "Sun"), concept_obj("c2", "Sea"), text_obj("t1", "Heading", "subtitulo")],
            connections=[connection("connect_1", "c1", "c2")],
        )

    def test_arrow_to_an_arrow_or_to_itself_is_dropped(self):
        out, n = quiet(filters.clean_connections, self.state(), env(connect("connect_2", "c1", "connect_1"), connect("connect_3", "t1", "t1")))
        self.assertEqual((n, out["operations"]), (2, []))

    def test_reversed_and_repeated_pairs_are_dropped(self):
        ops = [connect("connect_2", "c2", "c1"), connect("connect_3", "t1", "c1"), connect("connect_4", "c1", "t1", "x")]
        out, n = quiet(filters.clean_connections, self.state(), env(*ops))
        self.assertEqual(n, 2)
        kept = out["operations"]
        self.assertEqual([o["id"] for o in kept], ["connect_3"])
        self.assertEqual(kept[0].get("label"), "x")  # the label moved to the kept arrow

    def test_reused_id_is_renamed_and_later_references_follow(self):
        ops = [connect("connect_1", "t1", "c2"), {"op": "highlight", "refs": ["connect_1"]}]
        out, n = quiet(filters.clean_connections, self.state(), env(*ops))
        self.assertEqual(n, 0)
        self.assertEqual(out["operations"][0]["id"], "connect_2")
        self.assertEqual(out["operations"][1]["refs"], ["connect_2"])

    def test_duplicate_concept_is_remapped_to_the_existing_one(self):
        ops = [add_concept("c9", "sun"), add_concept("c8", "**Moon**"), connect("connect_5", "c9", "c8")]
        out, n = quiet(filters.clean_connections, self.state(), env(*ops))
        self.assertEqual(n, 1)
        self.assertEqual(out["operations"][0]["id"], "c8")
        self.assertEqual(out["operations"][1]["from"], "c1")

    def test_highlight_of_a_dropped_arrow_loses_the_ref(self):
        ops = [connect("connect_2", "c1", "connect_1"), {"op": "highlight", "refs": ["connect_2", {"ref": "c1", "word": "w"}]}]
        out, n = quiet(filters.clean_connections, self.state(), env(*ops))
        self.assertEqual(out["operations"][0]["refs"], [{"ref": "c1", "word": "w"}])

    def test_clean_envelope_is_returned_as_is(self):
        e = env(connect("connect_2", "t1", "c2"))
        self.assertEqual(quiet(filters.clean_connections, self.state(), e), (e, 0))


class TestDropOrphanHeadings(unittest.TestCase):
    def test_subtitle_without_group_is_dropped(self):
        out, n = quiet(filters.drop_orphan_headings, sample_state(), env(add_text("a", "The rain cycle", "subtitulo")))
        self.assertEqual((n, out["operations"]), (1, []))

    def test_a_question_is_kept_once_and_gets_no_arrows(self):
        state = make_state(objects=[text_obj("t1", "Water", "titulo")])
        ops = [
            add_text("a", "Where does rain come from?", "subtitulo"),
            add_text("b", "Why is the sea salty?", "subtitulo"),
            connect("k", "a", "t1"),
        ]
        out, n = quiet(filters.drop_orphan_headings, state, env(*ops))
        self.assertEqual([o["id"] for o in out["operations"]], ["a"])
        self.assertEqual(n, 2)

    def test_no_second_question_when_one_is_already_open(self):
        state = make_state(objects=[text_obj("t1", "Is it hot?", "subtitulo")])
        out, n = quiet(filters.drop_orphan_headings, state, env(add_text("a", "Is it cold?", "subtitulo")))
        self.assertEqual(n, 1)

    def test_subtitle_of_a_new_group_without_content_is_dropped(self):
        out, n = quiet(filters.drop_orphan_headings, sample_state(), env(add_text("a", "Clouds", "subtitulo", "g_new")))
        self.assertEqual(n, 1)

    def test_subtitle_of_a_new_group_with_content_is_kept(self):
        ops = [add_text("a", "Clouds", "subtitulo", "g_new"), add_text("b", "Clouds hold water", "cuerpo", "g_new")]
        e = env(*ops)
        self.assertEqual(quiet(filters.drop_orphan_headings, sample_state(), e), (e, 0))

    def test_subtitle_of_an_existing_group_is_kept(self):
        e = env(add_text("a", "Evaporation again", "subtitulo", "grupo_1"))
        self.assertEqual(quiet(filters.drop_orphan_headings, sample_state(), e), (e, 0))

    def test_arrows_from_the_title_are_dropped(self):
        e = env(connect("k1", "texto_1", "concepto_1"), connect("k2", "concepto_1", "texto_3"))
        out, n = quiet(filters.drop_orphan_headings, sample_state(), e)
        self.assertEqual([o["id"] for o in out["operations"]], ["k2"])
        self.assertEqual(n, 1)


class TestHighlightWords(unittest.TestCase):
    def state(self):
        return make_state(objects=[text_obj("t1", "The **sun** heats the water", "cuerpo")])

    def hl(self, utterance, state=None, ops=None):
        e = env(*(ops or [{"op": "highlight", "refs": ["t1"]}]))
        return quiet(filters.highlight_words, state or self.state(), e, utterance)

    def test_bold_word_that_was_said(self):
        out, n = self.hl("so the sun is hot")
        self.assertEqual((n, out["operations"][0]["refs"]), (1, [{"ref": "t1", "word": "sun"}]))

    def test_bold_has_priority_over_a_longer_word(self):
        out, _ = self.hl("the water and the sun")
        self.assertEqual(out["operations"][0]["refs"], [{"ref": "t1", "word": "sun"}])

    def test_longest_content_word_with_plurals(self):
        state = make_state(objects=[text_obj("t1", "Plants drink water", "cuerpo")])
        out, _ = self.hl("remember that plant needs water", state)
        self.assertEqual(out["operations"][0]["refs"], [{"ref": "t1", "word": "Plants"}])

    def test_no_match_keeps_the_whole_object(self):
        out, n = self.hl("nothing in common here")
        self.assertEqual((n, out["operations"][0]["refs"]), (0, ["t1"]))

    def test_subtitles_and_concepts_stay_whole(self):
        state = make_state(objects=[text_obj("t1", "The sun", "subtitulo"), concept_obj("c1", "Sun")])
        out, n = self.hl("the sun", state, [{"op": "highlight", "refs": ["t1", "c1"]}])
        self.assertEqual((n, out["operations"][0]["refs"]), (0, ["t1", "c1"]))

    def test_text_added_in_the_same_envelope(self):
        ops = [add_text("n1", "Clouds carry **vapor**"), {"op": "highlight", "refs": ["n1"]}]
        out, n = self.hl("clouds carry vapor", make_state(), ops)
        self.assertEqual(out["operations"][1]["refs"], [{"ref": "n1", "word": "vapor"}])

    def test_it_never_invents_a_highlight(self):
        e = env(add_text("n1", "Clouds carry vapor"))
        self.assertEqual(quiet(filters.highlight_words, make_state(), e, "clouds"), (e, 0))

    def test_the_word_is_a_substring_of_the_displayed_text(self):
        out, _ = self.hl("so the sun is hot")
        word = out["operations"][0]["refs"][0]["word"]
        self.assertIn(word, "The sun heats the water")


if __name__ == "__main__":
    unittest.main()
