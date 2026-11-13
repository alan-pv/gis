"""text_writer.py: the text model (ollama) that writes the strings of a turn.

One call per turn to ollama's `/api/chat` (standard library only): it gets the
teacher's sentence, the previous sentences and the numbered list of blanks
(`blanks.py`), and answers one line per blank. The system prompt, the wording of
each blank and the user message are exactly what the model was fine-tuned on:
do not edit them without retraining.
"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from .blanks import Blank

DEFAULT_MODEL = "gis-texto-v1"
DEFAULT_URL = "http://127.0.0.1:11434"

TEXT_TIMEOUT_S = 5.0
PRELOAD_TIMEOUT_S = 120.0

# Keep the model resident in VRAM between calls (-1 = forever). With a time
# limit, ollama unloaded it mid-class and reloading it on a full 4 GB GPU
# exceeded the timeout.
KEEP_ALIVE = -1

# Output token cap: without it a small model can ramble until the context limit.
# Each blank needs at most one short line; bold marks add a few tokens per line.
TOKENS_PER_BLANK = 30
TOKENS_MARGIN = 16

SYSTEM_PROMPT = (
    "You write short pieces of text for a classroom whiteboard, based on what "
    "a teacher just said. You will be given the teacher's new sentence, the "
    "previous sentences for context, the headings and last lines already on "
    "the board, and a numbered list of blanks to fill. "
    "Reply with EXACTLY one line per blank: the blank's own number, a colon, "
    "a space, then the text. Example reply for two blanks:\n"
    "1: Water cycle\n"
    "2: The **sun** heats the sea\n"
    "Use the real blank numbers from the list below, never the letter N. No "
    "JSON, no extra commentary, no blank lines, and no markdown other than the "
    "**bold** marks described in the rules.\n"
    "Rules:\n"
    "- Write board text, not spoken sentences: no \"we\", \"you\", \"let's\", no filler.\n"
    "- A body line is a short complete clause (\"Sun heats the water\"), so that "
    "several lines chained together read as a paragraph. Never a bare noun or a "
    "list of nouns as a body line. Lists and numbered steps are the "
    "exception: one short item per line.\n"
    "- Key words: in a body line, a list item, a numbered step or a continuation, "
    "wrap the 1 or 2 key words of the topic in double asterisks "
    "(\"The **sun** heats the **sea**\"). Never bold more than 2 terms per line, "
    "never a whole line, and never anything in a title or in a subtitle of one or "
    "two words. Attach each mark to its word, with no space inside (\"**sun**\"). "
    "When you continue a paragraph, bold only words of your own new part.\n"
    "- A blank that says \"concept\" is the name of ONE thing the teacher mentions, "
    "which will be drawn as a circle with that name inside: 1 to 3 words, a noun "
    "phrase faithful to what the teacher said (\"Sun\", \"Water vapor\"), never a "
    "sentence, never with ** marks.\n"
    "- Never start a line with a pronoun (it, this, that, they...) unless the "
    "thing it refers to is already written in the group's last lines; name it instead.\n"
    "- Never repeat a heading that is already on the board (see the headings line).\n"
    "- A subtitle names the part or topic it opens (\"The mouth\"), never a "
    "sentence and never a copy of the title.\n"
    "- A blank that says \"continue the paragraph\" extends the paragraph shown "
    "in it. Reply ONLY with the new part, so that the paragraph followed by your "
    "reply reads as one text and the join is invisible (\", which...\", \"so...\", "
    "\"because...\", or a new sentence). Never repeat or rewrite the paragraph. If "
    "the new sentence only repeats what the paragraph already says, leave the "
    "blank empty.\n"
    "- Start the reply with \"¶ \" only if the new sentence changes function "
    "(describing to comparing, what to why, an idea to an example): then write "
    "one complete sentence after it and it opens a new paragraph. Otherwise "
    "always continue the paragraph. If the blank says the paragraph is already "
    "long, keep your part very short or open a new paragraph with \"¶ \".\n"
    "- Never write a paragraph of one or two words. A name (\"that's called "
    "X\") is attached to the previous clause (\", called X.\"), never a line of "
    "its own.\n"
    "- A blank that says \"continues blank N\" adds to the same paragraph as "
    "blank N: write only the new part, as a continuation of blank N's text.\n"
    "- Fidelity: write nothing the teacher did not say (new sentence, previous "
    "sentences or what is on the board). Do not add facts, examples or "
    "parentheses explaining garbled words.\n"
    "- If unsure, or nothing fits, leave the blank empty (just the number and a colon)."
)

# Appended to the system prompt, after a space.
INSTRUCTION = (
    "Condense the teacher's meaning into a clear whiteboard clause for each "
    "blank; you may rephrase into board register, but only with content the "
    "teacher said (new sentence, previous sentences or the board)."
)

_KIND_DESCRIPTION: dict[str, str] = {
    "text": "text",
    "arrow_label": "label for an arrow",
    "extend": "continue the paragraph",
    "concept": "concept",
}


def _describe_blank(blank: Blank) -> str:
    parts = [_KIND_DESCRIPTION.get(blank.kind, blank.kind)]
    if blank.role:
        parts.append(str(blank.role))
    # The section heading takes precedence over the group label.
    group = blank.subtitle or blank.group_label
    if group:
        parts.append(f'group "{group}"')
    if blank.kind == "extend":
        if blank.continues is not None:
            parts.append(f"continues blank {blank.continues}")
        elif blank.paragraph is not None:
            warning = " (already long)" if blank.long else ""
            parts.append(f'paragraph{warning}: "{blank.paragraph}"')
    if blank.group_lines:
        parts.append("last lines: " + " | ".join(f'"{x}"' for x in blank.group_lines))
    if blank.from_label:
        parts.append(f'from "{blank.from_label}"')
    if blank.to_label:
        parts.append(f'to "{blank.to_label}"')
    return " · ".join(parts)


def build_messages(blanks: list[Blank], utterance: str, previous: list[str]) -> list[dict[str, str]]:
    """The `messages` sent to ollama: system prompt plus the user turn."""
    lines = [f'New sentence: "{utterance}"']
    if previous:
        lines.append("Previous sentences: " + "; ".join(previous))
    else:
        lines.append("Previous sentences: (none)")
    headings = next((b.headings for b in blanks if b.headings), [])
    lines.append(
        "Headings on the board: " + (" | ".join(f'"{x}"' for x in headings) if headings else "(none)")
    )
    lines.append("Blanks:")
    for blank in blanks:
        lines.append(f"{blank.n}. {_describe_blank(blank)}")
    return [
        {"role": "system", "content": f"{SYSTEM_PROMPT} {INSTRUCTION}"},
        {"role": "user", "content": "\n".join(lines)},
    ]


class TextTimeoutError(RuntimeError):
    """The ollama call exceeded its timeout. The server drops the turn's texts
    instead of answering 500."""


class TextOllamaError(RuntimeError):
    """ollama answered with an error or an empty reply. `cause` is a readable
    message that the sidecar exposes as `textError`."""

    def __init__(self, cause: str, detail: str = ""):
        super().__init__(f"{cause}{' — ' + detail if detail else ''}")
        self.cause = cause


OUT_OF_MEMORY_MESSAGE = "the text model does not fit on the GPU; close other apps that use VRAM"
_OUT_OF_MEMORY_MARKS = (
    "out of memory", "cudamalloc", "cuda error", "insufficient memory",
    "not enough memory", "unable to allocate", "failed to allocate",
    "model requires more", "llama runner process has terminated",
    "runner terminated", "unable to load model",
)


def ollama_error(detail: str) -> TextOllamaError:
    """The right error for an ollama error message, with the out-of-memory text
    when it looks like a VRAM failure."""
    detail = (detail or "").strip()
    if any(mark in detail.lower() for mark in _OUT_OF_MEMORY_MARKS):
        return TextOllamaError(OUT_OF_MEMORY_MESSAGE, detail)
    return TextOllamaError(f"ollama error: {detail[:200]}" if detail else "ollama error", detail)


_RE_LINE = re.compile(r"^\s*(?:[A-Za-z]+\s*[:.\)]\s*)?(\d+)\s*[:.\)]\s*(.*?)\s*$")


def parse_reply(content: str, n_blanks: int) -> list[str]:
    """Lenient parser: a missing line becomes an empty string, lines that are not
    'N: text' (markdown, commentary) are ignored and an out-of-range index is
    dropped. Tiny models sometimes copy the literal letter «N» from the prompt
    before the number («N: 1: Light...»), which the optional alphabetic prefix
    absorbs."""
    result = [""] * n_blanks
    if n_blanks == 1 and not any(
        _RE_LINE.match(l.strip().strip("`")) for l in content.splitlines() if l.strip().strip("`")
    ):
        # A single blank whose reply omitted the «1: » prefix: take the first
        # useful line (no code fences or quotes), keeping a leading ¶.
        for raw_line in content.splitlines():
            line = raw_line.strip().strip("`").strip()
            if not line or line.startswith("```"):
                continue
            if len(line) >= 2 and line[0] == line[-1] and line[0] in "\"'":
                line = line[1:-1].strip()
            elif line.startswith("¶"):
                rest = line[1:].strip()
                if len(rest) >= 2 and rest[0] == rest[-1] and rest[0] in "\"'":
                    rest = rest[1:-1].strip()
                line = "¶ " + rest
            result[0] = line
            return result
        return result
    for raw_line in content.splitlines():
        line = raw_line.strip().strip("`")
        if not line:
            continue
        m = _RE_LINE.match(line)
        if not m:
            continue
        idx = int(m.group(1))
        if 1 <= idx <= n_blanks:
            result[idx - 1] = m.group(2).strip()
    return result


def _chat(url: str, payload: dict[str, Any], timeout_s: float) -> dict[str, Any]:
    """POST to ollama's `/api/chat` and return the decoded body. Raises
    `TextTimeoutError` on timeout, `TextOllamaError` on an HTTP error and
    `RuntimeError` on any other failure."""
    request = urllib.request.Request(
        f"{url}/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_s) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except TimeoutError as exc:
        raise TextTimeoutError(f"timeout of {timeout_s}s calling ollama at {url}: {exc!r}") from exc
    except urllib.error.HTTPError as exc:
        # Typical: HTTP 500 from a CUDA out-of-memory while loading the model.
        # HTTPError is a URLError subclass, so it must come first.
        try:
            raw = exc.read().decode("utf-8", errors="replace")
            detail = str((json.loads(raw) or {}).get("error", raw))
        except Exception:  # noqa: BLE001 — unreadable body: the status code will do
            detail = f"HTTP {exc.code}"
        raise ollama_error(detail or f"HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        # The timeout can also arrive wrapped, as `exc.reason`.
        if isinstance(exc.reason, TimeoutError):
            raise TextTimeoutError(f"timeout of {timeout_s}s calling ollama at {url}: {exc!r}") from exc
        raise RuntimeError(f"failed calling ollama at {url}: {exc!r}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"failed calling ollama at {url}: {exc!r}") from exc


@dataclass
class TextResult:
    texts: list[str]  # one per blank, in order
    ms: float
    raw: str  # what the model answered, unparsed (for debugging)


def write_texts(
    blanks: list[Blank],
    utterance: str,
    previous: list[str],
    *,
    model: str = DEFAULT_MODEL,
    url: str = DEFAULT_URL,
) -> TextResult:
    """Fill all the blanks of a turn with a single ollama call. Raises
    `TextTimeoutError`, `TextOllamaError` or `RuntimeError`; an empty reply is
    an error too (a healthy model always answers at least «N:» per blank)."""
    payload = {
        "model": model,
        "messages": build_messages(blanks, utterance, previous),
        "stream": False,
        "keep_alive": KEEP_ALIVE,
        # "Thinking" models spend the whole token budget inside <think> and leave
        # `content` empty unless this is off. Models without it ignore the field.
        "think": False,
        "options": {"temperature": 0, "num_predict": TOKENS_MARGIN + TOKENS_PER_BLANK * len(blanks)},
    }
    t0 = time.perf_counter()
    body = _chat(url.rstrip("/"), payload, TEXT_TIMEOUT_S)
    ms = (time.perf_counter() - t0) * 1000.0

    if isinstance(body, dict) and body.get("error"):
        raise ollama_error(str(body["error"]))
    content = ((body or {}).get("message") or {}).get("content", "")
    if not str(content).strip():
        raise TextOllamaError(
            "the text model returned an empty reply "
            "(does it fit on the GPU? check `ollama ps` and the free VRAM)"
        )
    return TextResult(parse_reply(content, len(blanks)), ms, content)


def preload_model(model: str = DEFAULT_MODEL, url: str = DEFAULT_URL) -> float:
    """Warm the model up with a minimal call so the first turn does not pay the
    cold load. Returns the milliseconds taken. Raises like `write_texts`."""
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "hello"}],
        "stream": False,
        "keep_alive": KEEP_ALIVE,
        "think": False,
        "options": {"temperature": 0, "num_predict": 1},
    }
    t0 = time.perf_counter()
    body = _chat(url.rstrip("/"), payload, PRELOAD_TIMEOUT_S)
    if isinstance(body, dict) and body.get("error"):
        raise ollama_error(str(body["error"]))
    return (time.perf_counter() - t0) * 1000.0
