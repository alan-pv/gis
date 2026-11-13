"""Deterministic fakes used by the regression test: a stand-in for Laya that
answers by hashing its inputs, and a stand-in for ollama that writes texts (and
sometimes fails) by hashing the prompt. Same inputs always give the same turn,
so the full turn path can be pinned down without a GPU or a model."""
from __future__ import annotations

import copy
import hashlib
import io
import json
import urllib.error
from typing import Any


def stable_hash(*parts: Any) -> int:
    return int(hashlib.sha256("\x1f".join(map(str, parts)).encode()).hexdigest(), 16)


class FakeLaya:
    """Picks among the offered criteria by a hash of the call. A few answers are
    deliberately invalid or missing, to exercise the degradation paths."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.turn_key = ""

    def predict(self, state_text: str, questions: dict[str, Any]) -> dict[str, str]:
        self.calls.append({"state": state_text, "questions": copy.deepcopy(questions)})
        out: dict[str, str] = {}
        for qid, q in questions.items():
            crit = list(q.get("criteria", {}))
            hv = stable_hash(self.turn_key, state_text, qid, json.dumps(crit), len(self.calls))
            r = hv % 100
            if qid == "next":
                step_n = state_text.count(" · ") + (
                    1 if "already decided this turn: (none yet)" not in state_text else 0
                )
                if r < 6:
                    out[qid] = "bogus"
                elif r < 12:
                    continue
                elif (hv // 7) % 4:
                    out[qid] = crit[(hv // 100) % len(crit)]
                else:
                    out[qid] = "done" if step_n > 1 else crit[(hv // 100) % len(crit)]
                continue
            if r < 5:
                out[qid] = "bogus"
            elif r < 8:
                continue
            else:
                out[qid] = crit[(hv // 100) % len(crit)]
        return out


BOLD = ["The **sun** heats the **sea**", "Water **evaporates** and rises", "**Magma** flows under the crust",
        "Lava cools into **rock**"]
POOL = ["Water cycle", "Sun heats the water", "Evaporation", "Clouds", "rain falls on hills",
        "and then it cools down", ", which makes it rise", "because it is hot", "The mouth", "Volcano", "Sun",
        "Water vapor", "attracts", "**force**", "A paper clip sticks to the magnet",
        "Observe the sample carefully", "mountains", "heat", "it melts", "With light, plants grow",
        "hail precipitation", "Plants make food from light"]


class _Response:
    def __init__(self, raw: bytes):
        self.raw = raw

    def read(self) -> bytes:
        return self.raw

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _json_response(obj: Any) -> _Response:
    return _Response(json.dumps(obj).encode())


class FakeOllama:
    """Replaces `urllib.request.urlopen`. Records every request and answers with
    hash-derived texts in assorted shapes, or with a failure (timeouts, HTTP
    errors, empty or invalid bodies) for some prompts."""

    def __init__(self) -> None:
        self.records: list[dict[str, Any]] = []
        self.board: dict[str, Any] | None = None
        self.turn_key = ""

    def urlopen(self, req, timeout=None):
        payload = json.loads(req.data.decode())
        self.records.append({
            "url": req.full_url,
            "method": req.get_method(),
            "headers": dict(sorted(req.header_items())),
            "timeout": timeout,
            "payload": payload,
        })
        user = payload["messages"][-1]["content"]
        n_blanks = sum(1 for l in user.splitlines() if l[:1].isdigit() and ". " in l[:5])
        hv = stable_hash(self.turn_key, user)
        mode = hv % 40
        url = req.full_url
        if mode == 0:
            raise TimeoutError("fake timeout")
        if mode == 1:
            raise urllib.error.URLError(TimeoutError("fake wrapped timeout"))
        if mode == 2:
            raise urllib.error.URLError(ConnectionRefusedError("refused"))
        if mode == 3:
            raise urllib.error.HTTPError(
                url, 500, "err", {},
                io.BytesIO(b'{"error":"llama runner process has terminated: CUDA error: out of memory"}'),
            )
        if mode == 4:
            raise urllib.error.HTTPError(url, 400, "err", {}, io.BytesIO(b"not json"))
        if mode == 5:
            return _json_response({"message": {"content": "   "}})
        if mode == 6:
            return _json_response({"error": "boom"})
        if mode == 7:
            return _Response(b"<html>")
        board = [o["label"] for o in (self.board or {}).get("objects", []) if o.get("label")]
        lines: list[str] = []
        for n in range(1, n_blanks + 1):
            hv2 = stable_hash(self.turn_key, user, n)
            m = hv2 % 20
            blank_line = [l for l in user.splitlines() if l.startswith(f"{n}. ")][0]
            if m == 0:
                t = ""
            elif m == 1 and board:
                t = board[(hv2 // 20) % len(board)]
            elif m == 2 and lines:
                t = lines[0].split(": ", 1)[-1]
            elif m == 3:
                t = BOLD[(hv2 // 20) % len(BOLD)]
            elif m == 4:
                t = "¶ " + POOL[(hv2 // 20) % len(POOL)]
            elif m == 5:
                t = "¶"
            elif m == 6:
                t = "**" + POOL[(hv2 // 20) % len(POOL)] + "**"
            else:
                t = POOL[(hv2 // 20) % len(POOL)]
            if "continue the paragraph" in blank_line and m > 6 and (hv2 // 20) % 3 == 0:
                t = POOL[(hv2 // 20) % 5 + 5]
            lines.append(f"{n}: {t}")
        content = "\n".join(lines)
        style = (hv // 40) % 12
        if style == 0 and n_blanks == 1:
            content = lines[0].split(": ", 1)[1]
        elif style == 1 and n_blanks == 1:
            content = '"' + lines[0].split(": ", 1)[1] + '"'
        elif style == 2:
            content = "```\n" + content + "\n```"
        elif style == 3:
            content = "\n".join("N: " + l for l in lines)
        elif style == 4:
            content = "Sure!\n" + content + "\n\nDone."
        elif style == 5:
            content = content.replace(": ", ". ")
        return _json_response({"message": {"content": content}})
