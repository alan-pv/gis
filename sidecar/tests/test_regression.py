"""Regression test: a sample of 80 turns (built from the demo lessons, plus edge
cases) is replayed through the whole turn path with the deterministic fakes of
`fakes.py`. For each turn it checks the final response AND a digest of every
question sent to Laya and every request sent to ollama, so any change in the
wording, order or content of what the models see fails here.

If a change is intentional (and the models were retrained for it), regenerate
`fixtures/turns.json`.
"""
from __future__ import annotations

import contextlib
import copy
import hashlib
import io
import json
import sys
import time
import unittest
import urllib.request
from pathlib import Path
from unittest import mock

SIDECAR_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SIDECAR_DIR))

from gis_sidecar.turn import Context, handle_turn  # noqa: E402
from tests.fakes import FakeLaya, FakeOllama  # noqa: E402

FIXTURE = Path(__file__).with_name("fixtures") / "turns.json"


def _digest(calls, records) -> str:
    return hashlib.sha256(json.dumps([calls, records], sort_keys=True, ensure_ascii=False).encode()).hexdigest()


class TestTurnRegression(unittest.TestCase):
    def test_sampled_turns_are_unchanged(self):
        rows = json.loads(FIXTURE.read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(rows), 50)
        laya, ollama = FakeLaya(), FakeOllama()
        ctx = Context(laya, "fake", "cpu")
        with mock.patch.object(urllib.request, "urlopen", ollama.urlopen):
            for row in rows:
                with self.subTest(turn=row["key"]):
                    laya.calls.clear()
                    ollama.records.clear()
                    laya.turn_key = ollama.turn_key = row["key"]
                    ollama.board = row["state"]
                    with contextlib.redirect_stderr(io.StringIO()):
                        response = handle_turn(
                            ctx,
                            {"state": copy.deepcopy(row["state"]), "utterance": row["utterance"]},
                            time.perf_counter(),
                        )
                    for key in ("deciderMs", "textMs", "waitMs", "vramMiB"):
                        response["metrics"].pop(key, None)
                    self.assertEqual(response, row["response"])
                    self.assertEqual(_digest(laya.calls, ollama.records), row["digest"])


if __name__ == "__main__":
    unittest.main()
