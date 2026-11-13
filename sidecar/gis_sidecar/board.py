"""board.py: read-only queries on the board state sent by the web app.

The state is the app's agent state: `objects` (id, object, label, and `role` for
texts), `connections`, `groups` (id, label, members) and `recent_utterances`.
Labels are free content and are never translated here.
"""
from __future__ import annotations

import re
from typing import Any, Iterable

NO_TEXT = "(no text)"
MAX_SHORT_WORDS = 8
MAX_GROUP_LINES = 3
MAX_HEADINGS = 8

# Paragraph limits: with 4 sentences or ~45 words the next body line opens a new
# paragraph; from 3 sentences on, the text model is told the paragraph is long.
PARAGRAPH_MAX_SENTENCES = 4
PARAGRAPH_MAX_WORDS = 45
PARAGRAPH_LONG_SENTENCES = 3

# Contract role literals (the contract is in Spanish).
CONTRACT_ROLES = ("titulo", "subtitulo", "cuerpo", "lista", "enumeracion", "nota")

_RE_ENDS_IN_QUESTION = re.compile(r"\?[\s\"'»)\]*]*$")
_RE_SENTENCE_END = re.compile(r"[.!?;]+")


def shorten(text: str | None, n: int = MAX_SHORT_WORDS) -> str:
    """Cut a text to about n words, adding an ellipsis if it was cut."""
    if not text:
        return NO_TEXT
    words = text.split()
    if len(words) <= n:
        return text
    return " ".join(words[:n]) + "…"


def ends_in_question(text: str) -> bool:
    return bool(_RE_ENDS_IN_QUESTION.search(text.strip()))


def find_group(state: dict[str, Any], group_id: str) -> dict[str, Any] | None:
    return next((g for g in state.get("groups", []) if g["id"] == group_id), None)


def group_label(state: dict[str, Any], group_id: str) -> str | None:
    """Descriptive label of an existing group. Groups usually have no label, so
    the label of the first member is used: every group opens with its heading."""
    for g in state.get("groups", []):
        if g["id"] == group_id:
            if g.get("label"):
                return g["label"]
            members = g.get("members") or []
            if members:
                for o in state.get("objects", []):
                    if o["id"] == members[0]:
                        return o.get("label")
            return None
    return None


def count_sentences(text: str | None) -> int:
    """Sentences in a paragraph: non-empty chunks between `. ! ? ;`. It ignores
    abbreviations on purpose: an off-by-one only moves the length warning."""
    return sum(1 for chunk in _RE_SENTENCE_END.split(text or "") if chunk.strip())


def paragraph_is_long(text: str | None) -> bool:
    return count_sentences(text) >= PARAGRAPH_LONG_SENTENCES


def paragraph_is_full(text: str | None) -> bool:
    return (
        count_sentences(text) >= PARAGRAPH_MAX_SENTENCES
        or len((text or "").split()) >= PARAGRAPH_MAX_WORDS
    )


def state_exposes_roles(state: dict[str, Any]) -> bool:
    """Whether any text carries a `role`. Older states do not, and then roles are
    guessed from position (see `role_of`)."""
    return any(
        o.get("object") == "texto" and o.get("role") in CONTRACT_ROLES for o in state.get("objects", [])
    )


def role_of(obj: dict[str, Any], state: dict[str, Any]) -> str | None:
    """Contract role of a state object: None if it is not a text; its `role` if
    the state exposes it; otherwise a guess: the first text of the page is the
    title, the first text of each group is its subtitle, a multi-line label is a
    list and anything else is body."""
    if obj.get("object") != "texto":
        return None
    if obj.get("role") in CONTRACT_ROLES:
        return obj["role"]
    objects = state.get("objects", [])
    first = next((o for o in objects if o.get("object") == "texto" and o.get("label")), None)
    if first is not None and first["id"] == obj["id"]:
        return "titulo"
    by_id = {o["id"]: o for o in objects}
    for g in state.get("groups", []):
        members = g.get("members") or []
        if obj["id"] in members:
            texts = [m for m in members if by_id.get(m, {}).get("object") == "texto"]
            if texts and texts[0] == obj["id"]:
                return "subtitulo"
            break
    return "lista" if "\n" in (obj.get("label") or "") else "cuerpo"


def group_subtitle(state: dict[str, Any], group_id: str) -> str | None:
    """Label of the group's subtitle member, falling back to `group_label`."""
    g = find_group(state, group_id)
    if g is None:
        return None
    by_id = {o["id"]: o for o in state.get("objects", [])}
    for m in g.get("members") or []:
        o = by_id.get(m)
        if o and o.get("label") and role_of(o, state) == "subtitulo":
            return o["label"]
    return group_label(state, group_id)


def open_paragraph(state: dict[str, Any], group_id: str) -> dict[str, Any] | None:
    """The open paragraph of an existing section: its LAST member, if it is a
    body text that is not full. A concept, list or numbered list as last block
    closes the paragraph; arrows and highlights are not members, so they do not."""
    g = find_group(state, group_id)
    members = (g or {}).get("members") or []
    if not members:
        return None
    last = next((o for o in state.get("objects", []) if o["id"] == members[-1]), None)
    if last is None or role_of(last, state) != "cuerpo":
        return None
    if paragraph_is_full(last.get("label")):
        return None
    return last


def group_lines(state: dict[str, Any], group_id: str) -> list[str]:
    """Last `MAX_GROUP_LINES` labels (shortened) of an existing group."""
    by_id = {o["id"]: o for o in state.get("objects", [])}
    g = find_group(state, group_id)
    if g is None:
        return []
    lines = [
        shorten(by_id[m]["label"])
        for m in (g.get("members") or [])
        if m in by_id and by_id[m].get("label")
    ]
    return lines[-MAX_GROUP_LINES:]


def headings(state: dict[str, Any]) -> list[str]:
    """Title and subtitles already on the page (shortened, deduplicated, at most
    `MAX_HEADINGS`; if there are more, the title and the most recent ones)."""
    objects = state.get("objects", [])
    by_id = {o["id"]: o for o in objects}
    found: list[str] = []
    if state_exposes_roles(state):
        for role in ("titulo", "subtitulo"):
            found.extend(o["label"] for o in objects if o.get("label") and role_of(o, state) == role)
    else:
        first_text = next((o for o in objects if o.get("object") == "texto" and o.get("label")), None)
        if first_text:
            found.append(first_text["label"])
        for g in state.get("groups", []):
            members = g.get("members") or []
            o = by_id.get(members[0]) if members else None
            if o and o.get("object") == "texto" and o.get("label"):
                found.append(o["label"])
    seen: set[str] = set()
    unique: list[str] = []
    for label in found:
        key = " ".join(label.lower().split())
        if key not in seen:
            seen.add(key)
            unique.append(shorten(label))
    if len(unique) > MAX_HEADINGS:
        unique = unique[:1] + unique[-(MAX_HEADINGS - 1):]
    return unique


def has_title(state: dict[str, Any]) -> bool:
    """Whether the page already has a title. With roles: some text has the title
    role. Without roles: any text counts, since the first text is the title."""
    if state_exposes_roles(state):
        return any(role_of(o, state) == "titulo" for o in state.get("objects", []))
    return any(o.get("object") == "texto" for o in state.get("objects", []))


def open_questions(state: dict[str, Any], extra_connected: Iterable[str] = ()) -> list[dict[str, Any]]:
    """Texts ending in «?» that no arrow touches yet (neither in the state nor in
    `extra_connected`), oldest first."""
    connected: set[str | None] = set(extra_connected)
    for c in state.get("connections", []):
        connected.add(c.get("from"))
        connected.add(c.get("to"))
    return [
        o
        for o in state.get("objects", [])
        if o.get("object") == "texto"
        and o.get("label")
        and o["id"] not in connected
        and ends_in_question(o["label"])
    ]


def open_question(state: dict[str, Any], extra_connected: Iterable[str] = ()) -> dict[str, Any] | None:
    """The most recent open question, or None."""
    found = open_questions(state, extra_connected)
    return found[-1] if found else None
