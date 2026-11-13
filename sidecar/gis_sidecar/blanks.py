"""blanks.py: the blanks the text model has to fill, one per piece of text.

A plan fixes the structure of a turn; the strings are still missing. Each text,
concept and arrow label becomes a blank with the context the text model needs.
Body texts follow paragraph rules: a body line aimed at a section whose last
block is an open paragraph becomes an `extend` blank (the model continues the
paragraph) instead of a new line.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from . import board
from .protocol import PlanStep


@dataclass
class Blank:
    """One blank of the turn.

    `n` is its 1-based position. `kind` is 'text', 'extend' (continue a
    paragraph), 'concept' or 'arrow_label'. `group_label` and `group_lines`
    describe the section; `headings` are the titles already on the board;
    `from_label`/`to_label` describe the ends of an arrow. For 'extend' blanks:
    `paragraph` is the full open paragraph (None when the blank chains onto
    another blank of this turn), `long` says it is already long, `target` is the
    paragraph's object id and `continues` is the `n` of the first blank of the
    chain in this turn. `subtitle` is the section heading, for body texts.
    """

    n: int
    kind: str
    role: str | None = None
    group_label: str | None = None
    from_label: str | None = None
    to_label: str | None = None
    group_lines: list[str] = field(default_factory=list)
    headings: list[str] = field(default_factory=list)
    subtitle: str | None = None
    paragraph: str | None = None
    long: bool = False
    target: str | None = None
    continues: int | None = None


class SectionTails:
    """The last block of each section while a turn is walked.

    A tail is None (closed: the next body line opens a paragraph) or a dict
    `{"kind": "state"|"turn", "n": blank that opened it, "ref": id, "object": ...}`:
    "state" is a paragraph already on the board (the next body line EXTENDS it),
    "turn" is a paragraph created or extended by a step of this same turn (the
    next body line is MERGED into it). Keys are the plan's group keys.
    """

    def __init__(self, state: dict[str, Any]):
        self.state = state
        self._tails: dict[str, dict[str, Any] | None] = {}

    def tail(self, key: str) -> dict[str, Any] | None:
        if key not in self._tails:
            opened = board.open_paragraph(self.state, key)
            self._tails[key] = (
                {"kind": "state", "n": None, "ref": opened["id"], "object": opened} if opened else None
            )
        return self._tails[key]

    def open_in_turn(self, key: str, n: int | None, ref: str | None = None) -> None:
        self._tails[key] = {"kind": "turn", "n": n, "ref": ref}

    def close(self, key: str) -> None:
        self._tails[key] = None


def section_keys(plan: list[PlanStep]) -> list[str | None]:
    """Section key of each step (parallel to `plan`): an existing group id,
    `group_turn_K` (also for the step that opens it) or None."""
    keys: list[str | None] = []
    k = 0
    for step in plan:
        key: str | None = None
        if step.op in ("text", "concept"):
            if step.group == "new":
                k += 1
                key = f"group_turn_{k}"
            elif step.group and step.group != "none":
                key = step.group
        keys.append(key)
    return keys


def _existing_group(group: str | None) -> str | None:
    """The group id when it names an existing group; None for none/new and for
    `group_turn_K` (a group opened in this turn has no heading yet)."""
    if not group or group in ("none", "new") or group.startswith("group_turn_"):
        return None
    return group


def _describe_key(state: dict[str, Any], key: str | None) -> str | None:
    """Label of a candidate key, as context for arrow labels. Entities created
    in this turn have no text yet, so they describe as None."""
    if not key or key.startswith("new_"):
        return None
    for o in state.get("objects", []):
        if o["id"] == key:
            return o.get("label")
    for c in state.get("connections", []):
        if c["id"] == key:
            return c.get("label")
    for g in state.get("groups", []):
        if g["id"] == key:
            return board.group_label(state, key)
    return None


def _section_subtitle(state: dict[str, Any], group: str | None) -> str | None:
    existing = _existing_group(group)
    return board.group_subtitle(state, existing) if existing else None


def blanks_for_plan(state: dict[str, Any], plan: list[PlanStep]) -> list[Blank]:
    """Enumerate the blanks of the plan, in the order `build_envelope` consumes
    them. Highlights have none.

    A body step aimed at a section with an open paragraph becomes `extend`:
      - paragraph already on the board: `extend` with the full paragraph;
      - second or later body line of the same section in this turn: `extend`
        that continues the first blank of the chain, and their texts are merged;
      - section without an open paragraph (new group, after a concept or list, or
        no group): a `text` blank that also carries the section's `subtitle`.
    Lists, numbered lists, subtitles and titles close the paragraph.
    """
    blanks: list[Blank] = []
    headings = board.headings(state)
    keys = section_keys(plan)
    tails = SectionTails(state)
    n = 0
    for i, step in enumerate(plan):
        key = keys[i]
        existing = _existing_group(step.group)
        if step.op == "text":
            n += 1
            blank = Blank(
                n=n,
                kind="text",
                role=step.role,
                group_label=board.group_label(state, existing) if existing else None,
                group_lines=board.group_lines(state, existing) if existing else [],
                headings=list(headings),
            )
            if step.role == "body":
                subtitle = _section_subtitle(state, step.group)
                tail = tails.tail(key) if key else None
                if tail is None:
                    blank.subtitle = subtitle
                    if key:
                        tails.open_in_turn(key, n)
                elif tail["kind"] == "state":
                    paragraph = tail["object"]
                    blank.kind = "extend"
                    blank.group_label = subtitle or blank.group_label
                    blank.subtitle = subtitle
                    blank.paragraph = paragraph.get("label") or ""
                    blank.long = board.paragraph_is_long(paragraph.get("label"))
                    blank.target = paragraph["id"]
                    blank.group_lines = []
                    tails.open_in_turn(key, n)
                else:  # tail of this turn: merge into the first blank of the chain
                    blank.kind = "extend"
                    blank.group_label = subtitle or blank.group_label
                    blank.subtitle = subtitle
                    blank.continues = tail["n"]
                    blank.group_lines = []
            elif key:
                tails.close(key)
            blanks.append(blank)
        elif step.op == "concept":
            if key:
                tails.close(key)
            n += 1
            blanks.append(
                Blank(
                    n=n,
                    kind="concept",
                    group_label=board.group_label(state, existing) if existing else None,
                    group_lines=board.group_lines(state, existing) if existing else [],
                    headings=list(headings),
                )
            )
        elif step.op == "connect":
            n += 1
            blanks.append(
                Blank(
                    n=n,
                    kind="arrow_label",
                    from_label=_describe_key(state, step.origin),
                    to_label=_describe_key(state, step.destination),
                    headings=list(headings),
                )
            )
    return blanks
