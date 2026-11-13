"""One turn end to end (turn.py) and the HTTP server in `--fake` mode."""
from __future__ import annotations

import contextlib
import io
import json
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest import mock

from tests.helpers import SIDECAR_DIR, make_state, sample_state  # noqa: F401  (sets up sys.path)

import server
from gis_sidecar import turn
from gis_sidecar.text_writer import OUT_OF_MEMORY_MESSAGE, TextOllamaError, TextResult, TextTimeoutError
from gis_sidecar.turn import Context, handle_turn


class Scripted:
    """Laya stand-in that answers from a list of dicts, in order."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.n = 0

    def predict(self, state_text, questions):
        answer = self.answers[min(self.n, len(self.answers) - 1)]
        self.n += 1
        return answer


def text_turn(role="body", group="none"):
    return Scripted({"next": "text"}, {"role": role, "group": group}, {"next": "done"})


def concept_and_text():
    return Scripted(
        {"next": "concept"}, {"group": "none"},
        {"next": "text"}, {"role": "list", "group": "none"},
        {"next": "done"},
    )


def run(ctx, state, utterance="hello", arrival=None):
    with contextlib.redirect_stderr(io.StringIO()):
        return handle_turn(ctx, {"state": state, "utterance": utterance}, arrival or time.perf_counter())


def written(*texts, raw="raw"):
    return mock.patch.object(turn, "write_texts", return_value=TextResult(list(texts), 12.0, raw))


class TestHandleTurn(unittest.TestCase):
    def test_noop_turn_has_no_debug_and_no_error(self):
        ctx = Context(Scripted({"next": "done"}), "fake", "cpu")
        out = run(ctx, make_state())
        self.assertEqual(out["envelope"], {"schema_version": "1.0", "operations": []})
        self.assertNotIn("debug", out)
        self.assertNotIn("textError", out)
        self.assertEqual((out["metrics"]["steps"], out["metrics"]["questions"]), (1, 1))
        self.assertEqual(out["metrics"]["device"], "cpu")

    def test_text_turn_emits_the_written_text_and_debug(self):
        ctx = Context(text_turn("list"), "fake", "cpu")
        with written("A short list item that is long enough", raw="1: A short list item that is long enough") as w:
            out = run(ctx, make_state(), "one two")
        self.assertEqual(
            out["envelope"]["operations"],
            [{"op": "add", "id": "texto_1", "object": "texto", "text": "A short list item that is long enough", "role": "lista"}],
        )
        self.assertEqual(out["debug"]["blanks"], [{"kind": "text", "role": "list", "group_label": None}])
        self.assertEqual(out["debug"]["raw"], "1: A short list item that is long enough")
        self.assertTrue(ctx.text_ready)
        self.assertEqual(w.call_args.args[1:3], ("one two", []))
        self.assertEqual(w.call_args.kwargs, {"model": "gis-texto-v1", "url": "http://127.0.0.1:11434"})

    def test_model_and_url_come_from_the_context(self):
        ctx = Context(text_turn(), "fake", "cpu", text_model="other", ollama_url="http://h:9")
        with written("Plenty of words to be kept here") as w:
            run(ctx, make_state())
        self.assertEqual(w.call_args.kwargs, {"model": "other", "url": "http://h:9"})

    def test_previous_utterances_reach_the_text_model(self):
        ctx = Context(text_turn(), "fake", "cpu")
        with written("Plenty of words to be kept here") as w:
            run(ctx, sample_state())
        self.assertEqual(w.call_args.args[2], ["First sentence.", "Second sentence."])

    def test_loose_body_goes_to_the_open_section_and_extends_its_paragraph(self):
        ctx = Context(text_turn("body", "none"), "fake", "cpu")
        with written("because it is hot"):
            out = run(ctx, sample_state())
        self.assertEqual(
            out["envelope"]["operations"],
            [{"op": "update", "ref": "texto_3", "set": {"text": "The sun heats the sea because it is hot"}}],
        )
        self.assertEqual(out["debug"]["blanks"][0]["kind"], "extend")

    def test_filters_run_and_report_counts(self):
        ctx = Context(text_turn("list"), "fake", "cpu")
        with written("mountains"):
            out = run(ctx, make_state())
        self.assertEqual(out["envelope"]["operations"], [])
        self.assertEqual(out["metrics"]["fragmentsDropped"], 1)

    def test_a_concept_without_a_name_is_not_emitted(self):
        ctx = Context(Scripted({"next": "concept"}, {"group": "none"}, {"next": "done"}), "fake", "cpu")
        with written(""):
            out = run(ctx, make_state())
        self.assertEqual(out["envelope"]["operations"], [])
        self.assertEqual(out["metrics"]["emptyConceptsDropped"], 1)

    def test_text_model_timeout_flags_the_turn_and_drops_text_and_concepts(self):
        ctx = Context(concept_and_text(), "fake", "cpu")
        with mock.patch.object(turn, "write_texts", side_effect=TextTimeoutError("slow")):
            out = run(ctx, make_state())
        self.assertEqual(out["envelope"]["operations"], [])
        self.assertTrue(out["metrics"]["textTimeout"])
        self.assertIn("timeout", out["textError"])
        self.assertEqual(out["metrics"]["textError"], out["textError"])
        self.assertFalse(ctx.text_ready)
        self.assertEqual(ctx.text_error, out["textError"])
        self.assertEqual(out["debug"]["texts"], [])  # nothing left to write

    def test_arrows_survive_a_text_failure_without_their_label(self):
        script = Scripted(
            {"next": "connect"}, {"from": "concepto_1"}, {"to": "texto_3"},
            {"next": "done"},
        )
        ctx = Context(script, "fake", "cpu")
        with mock.patch.object(turn, "write_texts", side_effect=TextOllamaError("boom")):
            out = run(ctx, sample_state())
        self.assertEqual(
            out["envelope"]["operations"],
            [{"op": "connect", "id": "connect_1", "from": "concepto_1", "to": "texto_3", "style": "arrow"}],
        )
        self.assertEqual(out["textError"], "boom")
        self.assertNotIn("textTimeout", out["metrics"])

    def test_ollama_and_generic_errors(self):
        ctx = Context(text_turn(), "fake", "cpu")
        with mock.patch.object(turn, "write_texts", side_effect=TextOllamaError(OUT_OF_MEMORY_MESSAGE)):
            self.assertEqual(run(ctx, make_state())["textError"], OUT_OF_MEMORY_MESSAGE)
        ctx = Context(text_turn(), "fake", "cpu")
        with mock.patch.object(turn, "write_texts", side_effect=RuntimeError("net down")):
            self.assertEqual(run(ctx, make_state())["textError"], "the text model call failed: net down")

    def test_recovery_clears_the_error(self):
        ctx = Context(text_turn(), "fake", "cpu")
        ctx.text_ready, ctx.text_error = False, "old failure"
        with written("Plenty of words to be kept here"):
            run(ctx, make_state())
        self.assertEqual((ctx.text_ready, ctx.text_error), (True, None))

    def test_a_legitimate_noop_does_not_touch_the_text_model(self):
        ctx = Context(Scripted({"next": "done"}), "fake", "cpu")
        with mock.patch.object(turn, "write_texts") as w:
            run(ctx, make_state())
        w.assert_not_called()

    def test_invalid_body_raises(self):
        ctx = Context(Scripted({}), "fake", "cpu")
        with self.assertRaisesRegex(ValueError, "state"):
            handle_turn(ctx, {"state": [], "utterance": "x"}, time.perf_counter())
        with self.assertRaisesRegex(ValueError, "utterance"):
            handle_turn(ctx, {"state": {}, "utterance": 3}, time.perf_counter())


class TestStaleRequests(unittest.TestCase):
    def test_old_arrival_is_discarded_without_calling_laya(self):
        predictor = mock.Mock()
        ctx = Context(predictor, "fake", "cpu", max_wait_ms=3000.0)
        out = run(ctx, make_state(), arrival=time.perf_counter() - 10.0)
        predictor.predict.assert_not_called()
        self.assertEqual(out["envelope"], {"schema_version": "1.0", "operations": []})
        self.assertEqual(out["metrics"]["dropped"], "stale")
        self.assertGreater(out["metrics"]["waitMs"], 3000)

    def test_recent_arrival_is_processed(self):
        ctx = Context(Scripted({"next": "done"}), "fake", "cpu")
        self.assertNotIn("dropped", run(ctx, make_state())["metrics"])

    def test_waiting_for_the_lock_is_bounded_by_max_wait_not_by_the_stuck_turn(self):
        ctx = Context(Scripted({"next": "done"}), "fake", "cpu", max_wait_ms=150.0)
        ctx.lock.acquire()  # a stuck turn holds the lock
        try:
            t0 = time.perf_counter()
            out = run(ctx, make_state())
            elapsed = time.perf_counter() - t0
        finally:
            ctx.lock.release()
        self.assertEqual(out["metrics"]["dropped"], "stale")
        self.assertLess(elapsed, 2.0)


class TestTimeBudget(unittest.TestCase):
    def test_exhausted_budget_never_emits_half_a_step(self):
        class Slow:
            def predict(self, state_text, questions):
                time.sleep(0.03)
                return {"next": "text"} if "next" in questions else {"role": "body", "group": "none"}

        ctx = Context(Slow(), "fake", "cpu", budget_ms=40.0)
        with written("Plenty of words to be kept here"):
            out = run(ctx, make_state())
        self.assertTrue(out["metrics"]["budgetCut"])
        for op in out["envelope"]["operations"]:
            self.assertIn("text", op)

    def test_generous_budget_does_not_cut(self):
        ctx = Context(Scripted({"next": "done"}), "fake", "cpu", budget_ms=60_000.0)
        self.assertNotIn("budgetCut", run(ctx, make_state())["metrics"])


class TestPreload(unittest.TestCase):
    def preload(self, **kwargs):
        ctx = Context(Scripted({}), "fake", "cpu")
        with mock.patch.object(turn, "preload_model", **kwargs), contextlib.redirect_stderr(io.StringIO()):
            turn.preload_text_model(ctx)
        return ctx

    def test_ok(self):
        ctx = self.preload(return_value=123.0)
        self.assertEqual((ctx.text_ready, ctx.text_error), (True, None))

    def test_out_of_memory_is_visible_in_health(self):
        ctx = self.preload(side_effect=TextOllamaError(OUT_OF_MEMORY_MESSAGE))
        self.assertEqual((ctx.text_ready, ctx.text_error), (False, OUT_OF_MEMORY_MESSAGE))

    def test_timeout(self):
        ctx = self.preload(side_effect=TextTimeoutError("slow"))
        self.assertFalse(ctx.text_ready)
        self.assertIn("timeout", ctx.text_error)

    def test_ollama_down_never_raises(self):
        ctx = self.preload(side_effect=ConnectionRefusedError("refused"))
        self.assertFalse(ctx.text_ready)
        self.assertIn("refused", ctx.text_error)

    def test_start_preload_uses_a_separate_thread(self):
        ctx = Context(Scripted({}), "fake", "cpu")
        with mock.patch.object(turn, "preload_model", return_value=1.0), contextlib.redirect_stderr(io.StringIO()):
            thread = turn.start_preload(ctx)
            thread.join(timeout=5)
        self.assertTrue(thread.daemon)
        self.assertTrue(ctx.text_ready)


class TestResolveDevice(unittest.TestCase):
    def test_autodetect(self):
        self.assertEqual(server.resolve_device(None, True), "cuda")
        self.assertEqual(server.resolve_device(None, False), "cpu")
        self.assertEqual(server.resolve_device("", True), "cuda")

    def test_override_wins(self):
        self.assertEqual(server.resolve_device("cpu", True), "cpu")
        self.assertEqual(server.resolve_device("cuda", False), "cuda")

    def test_invalid_override_raises(self):
        with self.assertRaises(ValueError):
            server.resolve_device("tpu", True)


class TestServerFake(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.Handler.ctx = Context(server.FakePredictor(), "fake", "cpu")
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=5)

    def url(self, path):
        return f"http://127.0.0.1:{self.port}{path}"

    def post(self, body, path="/turn"):
        request = urllib.request.Request(
            self.url(path), data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}
        )
        return urllib.request.urlopen(request, timeout=5)

    def test_health(self):
        with urllib.request.urlopen(self.url("/health"), timeout=5) as resp:
            data = json.loads(resp.read())
        self.assertEqual((data["ok"], data["checkpoint"], data["device"], data["textReady"]), (True, "fake", "cpu", False))
        self.assertNotIn("vramMiB", data)  # no torch loaded in fake mode
        self.assertNotIn("textError", data)

    def test_turn_is_a_noop_in_fake_mode(self):
        with self.post({"state": make_state(), "utterance": "hello there"}) as resp:
            data = json.loads(resp.read())
        self.assertEqual(data["envelope"], {"schema_version": "1.0", "operations": []})

    def test_missing_state_is_a_500_with_an_error(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.post({"utterance": "hello"})
        self.assertEqual(ctx.exception.code, 500)
        self.assertIn("state", json.loads(ctx.exception.read())["error"])
        ctx.exception.close()

    def test_unknown_routes_are_404(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(self.url("/nope"), timeout=5)
        self.assertEqual(ctx.exception.code, 404)
        ctx.exception.close()
        with self.assertRaises(urllib.error.HTTPError) as ctx2:
            self.post({}, "/nope")
        self.assertEqual(ctx2.exception.code, 404)
        ctx2.exception.close()


class TestMainConfiguration(unittest.TestCase):
    """`main()` with the HTTP server replaced: checks what the environment sets."""

    def run_main(self, env, argv=("server.py", "--fake")):
        captured = {}

        class FakeHTTP:
            def __init__(self, addr, handler):
                captured["addr"] = addr

            def serve_forever(self):
                raise KeyboardInterrupt

            def shutdown(self):
                pass

        with mock.patch.dict("os.environ", env, clear=False), mock.patch.object(
            server, "ThreadingHTTPServer", FakeHTTP
        ), mock.patch.object(sys, "argv", list(argv)), contextlib.redirect_stderr(io.StringIO()):
            server.main()
        return captured["addr"], server.Handler.ctx

    def test_defaults(self):
        env = {k: "" for k in ("GIS_SIDECAR_PORT", "GIS_TEXT_MODEL", "GIS_OLLAMA_URL")}
        addr, ctx = self.run_main(env)
        self.assertEqual(addr, ("127.0.0.1", 8731))
        self.assertEqual((ctx.text_model, ctx.ollama_url), ("gis-texto-v1", "http://127.0.0.1:11434"))
        self.assertEqual((ctx.budget_ms, ctx.max_wait_ms), (1500.0, 3000.0))

    def test_environment_overrides(self):
        env = {"GIS_SIDECAR_PORT": "9001", "GIS_TEXT_MODEL": "m", "GIS_OLLAMA_URL": "http://h:5/"}
        addr, ctx = self.run_main(env)
        self.assertEqual(addr, ("127.0.0.1", 9001))
        self.assertEqual((ctx.text_model, ctx.ollama_url), ("m", "http://h:5"))

    def test_default_checkpoint_is_models_laya_v1_at_the_repo_root(self):
        self.assertEqual(server.DEFAULT_CHECKPOINT, SIDECAR_DIR.parent / "models" / "laya-v1")

    def test_missing_checkpoint_gives_a_helpful_error(self):
        with mock.patch.dict(sys.modules, {"torch": mock.Mock(), "laya": mock.Mock()}):
            with self.assertRaisesRegex(FileNotFoundError, "npm run setup"):
                server.load_laya(SIDECAR_DIR / "no-such-folder", None)


if __name__ == "__main__":
    unittest.main()
