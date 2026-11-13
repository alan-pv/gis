"""The text model client: prompt, reply parser, errors and the ollama payload."""
from __future__ import annotations

import hashlib
import io
import json
import unittest
import urllib.error
from unittest import mock

from tests.helpers import make_state  # noqa: F401  (sets up sys.path)

from gis_sidecar import text_writer as tw
from gis_sidecar.blanks import Blank

SYSTEM_PROMPT_SHA256 = "022c7fd038b30e5db86f0e652b1c0716baade6e8c0d6652a327e7e9402eec2e3"


class Reply:
    def __init__(self, body):
        self.raw = json.dumps(body).encode()

    def read(self):
        return self.raw

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def http_error(code, body: bytes):
    return urllib.error.HTTPError("http://x", code, "err", {}, io.BytesIO(body))


class TestPrompt(unittest.TestCase):
    def test_system_prompt_is_the_one_the_model_was_trained_on(self):
        system = tw.build_messages([Blank(n=1, kind="text")], "x", [])[0]
        self.assertEqual(system["role"], "system")
        self.assertEqual(hashlib.sha256(system["content"].encode()).hexdigest(), SYSTEM_PROMPT_SHA256)

    def test_user_message_without_context(self):
        user = tw.build_messages([Blank(n=1, kind="text", role="title")], "Hello class", [])[1]
        self.assertEqual(
            user["content"],
            'New sentence: "Hello class"\nPrevious sentences: (none)\nHeadings on the board: (none)\nBlanks:\n1. text · title',
        )

    def test_user_message_with_full_context(self):
        blanks = [
            Blank(n=1, kind="text", role="body", subtitle="The mouth", group_label="old", group_lines=["a", "b"],
                  headings=["Digestion", "The mouth"]),
            Blank(n=2, kind="extend", role="body", group_label="The mouth", subtitle="The mouth",
                  paragraph="Teeth grind food.", long=True, target="t1"),
            Blank(n=3, kind="extend", role="body", continues=2),
            Blank(n=4, kind="concept", group_label="The mouth"),
            Blank(n=5, kind="arrow_label", from_label="Sun", to_label="Water"),
        ]
        content = tw.build_messages(blanks, "Teeth grind.", ["One.", "Two."])[1]["content"]
        self.assertEqual(
            content.splitlines(),
            [
                'New sentence: "Teeth grind."',
                "Previous sentences: One.; Two.",
                'Headings on the board: "Digestion" | "The mouth"',
                "Blanks:",
                '1. text · body · group "The mouth" · last lines: "a" | "b"',
                '2. continue the paragraph · body · group "The mouth" · paragraph (already long): "Teeth grind food."',
                "3. continue the paragraph · body · continues blank 2",
                '4. concept · group "The mouth"',
                '5. label for an arrow · from "Sun" · to "Water"',
            ],
        )


class TestParseReply(unittest.TestCase):
    def test_well_formed(self):
        self.assertEqual(tw.parse_reply("1: Water cycle\n2: Evaporation", 2), ["Water cycle", "Evaporation"])

    def test_single_blank_without_prefix_takes_the_first_line(self):
        self.assertEqual(tw.parse_reply("Water cycle", 1), ["Water cycle"])
        self.assertEqual(tw.parse_reply('"Water cycle"', 1), ["Water cycle"])
        self.assertEqual(tw.parse_reply("```\nWater cycle\n```", 1), ["Water cycle"])
        self.assertEqual(tw.parse_reply('¶ "New idea."', 1), ["¶ New idea."])

    def test_missing_extra_and_out_of_range_lines(self):
        self.assertEqual(tw.parse_reply("2: B", 3), ["", "B", ""])
        self.assertEqual(tw.parse_reply("Sure!\n1: A\nnotes\n2: B\n\nDone.", 2), ["A", "B"])
        self.assertEqual(tw.parse_reply("1: A\n9: Z", 2), ["A", ""])
        self.assertEqual(tw.parse_reply("2: B\n1: A", 2), ["A", "B"])

    def test_empty_blank_is_valid(self):
        self.assertEqual(tw.parse_reply("1:\n2: B", 2), ["", "B"])

    def test_separators_and_the_literal_n_prefix(self):
        self.assertEqual(tw.parse_reply("1. A\n2) B", 2), ["A", "B"])
        self.assertEqual(tw.parse_reply("N: 1: A\nN: 2: B", 2), ["A", "B"])

    def test_empty_reply(self):
        self.assertEqual(tw.parse_reply("", 2), ["", ""])
        self.assertEqual(tw.parse_reply("", 0), [])

    def test_markdown_fence_does_not_break_it(self):
        self.assertEqual(tw.parse_reply("```\n1: A\n2: B\n```", 2), ["A", "B"])


class TestWriteTexts(unittest.TestCase):
    blanks = [Blank(n=1, kind="text", role="title"), Blank(n=2, kind="concept")]

    def write(self, reply, **kwargs):
        with mock.patch("urllib.request.urlopen", return_value=reply) as urlopen:
            result = tw.write_texts(self.blanks, "Hi", [], **kwargs)
        return result, urlopen

    def test_payload(self):
        result, urlopen = self.write(Reply({"message": {"content": "1: Water\n2: Sun"}}), model="m", url="http://h:1/")
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "http://h:1/api/chat")
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(urlopen.call_args.kwargs["timeout"], tw.TEXT_TIMEOUT_S)
        payload = json.loads(request.data)
        self.assertEqual(payload["model"], "m")
        self.assertEqual(payload["messages"], tw.build_messages(self.blanks, "Hi", []))
        self.assertIs(payload["stream"], False)
        self.assertIs(payload["think"], False)
        self.assertEqual(payload["keep_alive"], -1)
        self.assertEqual(payload["options"], {"temperature": 0, "num_predict": 16 + 30 * 2})
        self.assertEqual(result.texts, ["Water", "Sun"])
        self.assertEqual(result.raw, "1: Water\n2: Sun")

    def test_defaults(self):
        _, urlopen = self.write(Reply({"message": {"content": "1: A\n2: B"}}))
        self.assertEqual(urlopen.call_args.args[0].full_url, "http://127.0.0.1:11434/api/chat")
        self.assertEqual(json.loads(urlopen.call_args.args[0].data)["model"], "gis-texto-v1")

    def test_timeouts(self):
        for exc in (TimeoutError("t"), urllib.error.URLError(TimeoutError("t"))):
            with mock.patch("urllib.request.urlopen", side_effect=exc):
                with self.assertRaises(tw.TextTimeoutError):
                    tw.write_texts(self.blanks, "Hi", [])

    def test_other_network_failures_are_runtime_errors_but_not_timeouts(self):
        with mock.patch("urllib.request.urlopen", side_effect=urllib.error.URLError(ConnectionRefusedError())):
            with self.assertRaises(RuntimeError) as ctx:
                tw.write_texts(self.blanks, "Hi", [])
        self.assertNotIsInstance(ctx.exception, tw.TextTimeoutError)

    def test_http_out_of_memory_says_it_does_not_fit(self):
        body = b'{"error": "llama runner process has terminated: CUDA error: out of memory"}'
        with mock.patch("urllib.request.urlopen", side_effect=http_error(500, body)):
            with self.assertRaises(tw.TextOllamaError) as ctx:
                tw.write_texts(self.blanks, "Hi", [])
        self.assertEqual(ctx.exception.cause, tw.OUT_OF_MEMORY_MESSAGE)

    def test_http_error_includes_the_detail(self):
        with mock.patch("urllib.request.urlopen", side_effect=http_error(400, b'{"error": "bad request"}')):
            with self.assertRaises(tw.TextOllamaError) as ctx:
                tw.write_texts(self.blanks, "Hi", [])
        self.assertEqual(ctx.exception.cause, "ollama error: bad request")

    def test_unreadable_http_body_falls_back_to_the_status(self):
        with mock.patch("urllib.request.urlopen", side_effect=http_error(502, b"<html>")):
            with self.assertRaises(tw.TextOllamaError) as ctx:
                tw.write_texts(self.blanks, "Hi", [])
        self.assertEqual(ctx.exception.cause, "ollama error: HTTP 502")

    def test_error_field_in_a_200_body(self):
        with self.assertRaises(tw.TextOllamaError) as ctx:
            self.write(Reply({"error": "boom"}))
        self.assertEqual(ctx.exception.cause, "ollama error: boom")

    def test_empty_reply_is_an_error(self):
        with self.assertRaises(tw.TextOllamaError):
            self.write(Reply({"message": {"content": "  "}}))

    def test_invalid_json_is_a_runtime_error(self):
        bad = mock.MagicMock()
        bad.__enter__.return_value.read.return_value = b"<html>"
        with mock.patch("urllib.request.urlopen", return_value=bad):
            with self.assertRaises(RuntimeError):
                tw.write_texts(self.blanks, "Hi", [])


class TestPreload(unittest.TestCase):
    def test_keeps_the_model_resident_with_thinking_off(self):
        with mock.patch("urllib.request.urlopen", return_value=Reply({"message": {"content": "h"}})) as urlopen:
            ms = tw.preload_model("m", "http://h:1")
        payload = json.loads(urlopen.call_args.args[0].data)
        self.assertEqual((payload["model"], payload["keep_alive"], payload["think"]), ("m", -1, False))
        self.assertEqual(payload["options"]["num_predict"], 1)
        self.assertEqual(urlopen.call_args.kwargs["timeout"], tw.PRELOAD_TIMEOUT_S)
        self.assertGreaterEqual(ms, 0.0)

    def test_timeout_and_out_of_memory(self):
        with mock.patch("urllib.request.urlopen", side_effect=TimeoutError()):
            with self.assertRaises(tw.TextTimeoutError):
                tw.preload_model()
        with mock.patch("urllib.request.urlopen", return_value=Reply({"error": "CUDA error: out of memory"})):
            with self.assertRaises(tw.TextOllamaError) as ctx:
                tw.preload_model()
        self.assertEqual(ctx.exception.cause, tw.OUT_OF_MEMORY_MESSAGE)


if __name__ == "__main__":
    unittest.main()
