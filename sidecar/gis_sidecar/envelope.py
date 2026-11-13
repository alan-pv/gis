"""envelope.py: turn a plan plus the written texts into a contract envelope.

The plan uses English decision keys; the envelope uses the Spanish literals of
the contract (`texto`, `concepto`, `titulo`...), which are NOT translated.
"""
from __future__ import annotations

import re
from typing import Any

from .blanks import blanks_for_plan, section_keys
from .protocol import SCHEMA_VERSION, PlanStep

# Marker a text model reply starts with to open a new paragraph instead of
# continuing the open one.
NEW_PARAGRAPH_MARK = "¶"

ROLE_TO_CONTRACT: dict[str, str] = {
    "title": "titulo",
    "subtitle": "subtitulo",
    "body": "cuerpo",
    "list": "lista",
    "numbered": "enumeracion",
}

# Words that, at the start of a lowercase suffix, mean it continues the sentence.
CONTINUATION_CONNECTORS = frozenset(
    "and or but so then because while which who whose that where when as if until "
    "after before since although though unless whereas to into onto from by with "
    "without for of in on at through over under like than also too plus nor yet".split()
)

_SENTENCE_END = (".", "!", "?", ";", ":")


def interpret_extend_answer(answer: str) -> tuple[str, str]:
    """Interpret the reply to an `extend` blank as (action, text):
    ("nothing", "") for an empty reply or a bare mark (the sentence repeats what
    is written); ("new", sentence) when it starts with the paragraph mark;
    ("continue", suffix) otherwise."""
    reply = (answer or "").strip()
    if not reply:
        return "nothing", ""
    if reply.startswith(NEW_PARAGRAPH_MARK):
        rest = reply[len(NEW_PARAGRAPH_MARK):].strip()
        return ("new", rest) if rest else ("nothing", "")
    return "continue", reply


def _is_continuation(suffix: str) -> bool:
    """The first word of the suffix is a connector or ends in «-ing»."""
    word = re.sub(r"^[\W_]+|[\W_]+$", "", suffix.split(None, 1)[0].lower()) if suffix.strip() else ""
    return word in CONTINUATION_CONNECTORS or (len(word) > 3 and word.endswith("ing"))


def join_continuation(previous: str, suffix: str) -> str:
    """Paragraph text after appending `suffix`. It never touches `previous`:
    what is written is not rewritten, and the app animates only the suffix.

    - No previous text or empty suffix: plain concatenation.
    - Suffix starting with `, ; : . )`: no separator.
    - Lowercase suffix whose first word is a connector or ends in «-ing»: a
      continuation, one space.
    - Anything else (including a capitalized suffix) is a NEW SENTENCE: a period
      is added if `previous` does not end in terminal punctuation, and the first
      letter is capitalized.
    """
    if not previous or not suffix:
        return previous + suffix
    if suffix[0] in ",;:.)":
        return previous + suffix
    # A leading bold mark (`**because** ...`) does not count as the first letter.
    plain = suffix.lstrip("*")
    if plain[:1].islower() and _is_continuation(suffix):
        return previous + " " + suffix
    start = len(suffix) - len(plain)
    suffix = suffix[:start] + plain[:1].upper() + plain[1:]
    if previous.rstrip().endswith(_SENTENCE_END):
        return previous + " " + suffix
    return previous + ". " + suffix


def _resolve_group(decision: str | None, group_to_real: dict[str, str], new_id) -> str | None:
    if not decision or decision == "none":
        return None
    if decision == "new":
        gid = new_id("grupo")
        k = 1
        while f"group_turn_{k}" in group_to_real:
            k += 1
        group_to_real[f"group_turn_{k}"] = gid
        return gid
    if decision in group_to_real:
        return group_to_real[decision]
    # An existing group id that came straight from the state.
    return decision


def build_envelope(state: dict[str, Any], plan: list[PlanStep], texts: list[str]) -> dict[str, Any]:
    """Build the envelope from the plan (Laya's decisions) and the texts (one per
    blank, in the order of `blanks_for_plan`).

    - ids `<object>_<n>` are unique against the state; new groups are `grupo_<n>`.
    - `connect` always has style `arrow`; empty labels and texts are omitted.
    - `extend` blanks: an empty reply emits nothing; `¶ <sentence>` adds a new body
      line in the same section; any other reply is an `update` of the paragraph
      with the previous text plus the joined suffix. A blank that continues
      another one adds to the block that blank left, so a turn emits ONE block per
      section.
    """
    blanks = blanks_for_plan(state, plan)
    if len(blanks) != len(texts):
        raise ValueError(
            f"build_envelope: expected {len(blanks)} texts ({[b.kind for b in blanks]}), "
            f"got {len(texts)}"
        )
    pairs = iter(zip(blanks, texts))
    keys = section_keys(plan)
    # Block each section left in this turn (to merge into it):
    # {"kind": "add", "op": <add>} or {"kind": "target", "ref", "text", "op": <update>|None}.
    section_blocks: dict[str, dict[str, Any]] = {}

    used_ids: set[str] = set()
    used_ids.update(o["id"] for o in state.get("objects", []))
    used_ids.update(c["id"] for c in state.get("connections", []))
    used_ids.update(g["id"] for g in state.get("groups", []))

    def new_id(prefix: str) -> str:
        i = 1
        while f"{prefix}_{i}" in used_ids:
            i += 1
        candidate = f"{prefix}_{i}"
        used_ids.add(candidate)
        return candidate

    candidate_to_real: dict[str, str] = {}
    for o in state.get("objects", []):
        candidate_to_real[o["id"]] = o["id"]
    for c in state.get("connections", []):
        candidate_to_real[c["id"]] = c["id"]
    n_candidate = 0

    group_to_real: dict[str, str] = {g["id"]: g["id"] for g in state.get("groups", [])}
    operations: list[dict[str, Any]] = []

    def add_text(step: PlanStep, text: str) -> dict[str, Any]:
        oid = new_id("texto")
        op: dict[str, Any] = {
            "op": "add",
            "id": oid,
            "object": "texto",
            "text": text,
            "role": ROLE_TO_CONTRACT.get(step.role or "body", "cuerpo"),
        }
        group = _resolve_group(step.group, group_to_real, new_id)
        if group is not None:
            op["group"] = group
        operations.append(op)
        return op

    def apply_extension(key: str | None, step: PlanStep, blank, reply: str) -> str | None:
        """Apply an `extend` blank; return the real id of the block that got the
        text (to resolve `new_N`), or None if nothing was written."""
        action, content = interpret_extend_answer(reply)
        if blank.continues is not None:
            # The mark does not open a paragraph here: the whole chain is one block.
            if action == "new":
                action = "continue"
            block = section_blocks.get(key) if key else None
            if action == "nothing":
                return (block.get("ref") or block["op"]["id"]) if block else None
            if block is None:
                op = add_text(step, content)
                if key:
                    section_blocks[key] = {"kind": "add", "op": op}
                return op["id"]
            if block["kind"] == "add":
                block["op"]["text"] = join_continuation(block["op"]["text"], content)
                return block["op"]["id"]
            new_text = join_continuation(block["text"], content)
            if block["op"] is None:
                block["op"] = {"op": "update", "ref": block["ref"], "set": {"text": new_text}}
                operations.append(block["op"])
            else:
                block["op"]["set"]["text"] = new_text
            block["text"] = new_text
            return block["ref"]
        target, paragraph = blank.target, blank.paragraph or ""
        if action == "new":
            op = add_text(step, content)
            section_blocks[key] = {"kind": "add", "op": op}
            return op["id"]
        block = {"kind": "target", "ref": target, "text": paragraph, "op": None}
        if action == "continue":
            block["text"] = join_continuation(paragraph, content)
            block["op"] = {"op": "update", "ref": target, "set": {"text": block["text"]}}
            operations.append(block["op"])
        section_blocks[key] = block
        return target

    for i, step in enumerate(plan):
        key = keys[i]
        if step.op == "text":
            blank, text = next(pairs)
            if blank.kind == "extend":
                real = apply_extension(key, step, blank, text)
                n_candidate += 1
                if real is not None:
                    candidate_to_real[f"new_{n_candidate}"] = real
                continue
            op = add_text(step, text)
            if key:
                if step.role == "body":
                    section_blocks[key] = {"kind": "add", "op": op}
                else:
                    section_blocks.pop(key, None)
            n_candidate += 1
            candidate_to_real[f"new_{n_candidate}"] = op["id"]

        elif step.op == "concept":
            name = next(pairs)[1].replace("**", "").strip()
            if key:
                section_blocks.pop(key, None)
            oid = new_id("concepto")
            op = {"op": "add", "id": oid, "object": "concepto"}
            if name:
                op["label"] = name
            group = _resolve_group(step.group, group_to_real, new_id)
            if group is not None:
                op["group"] = group
            operations.append(op)
            n_candidate += 1
            candidate_to_real[f"new_{n_candidate}"] = oid

        elif step.op == "connect":
            label = next(pairs)[1]
            oid = new_id("connect")
            origin = candidate_to_real.get(step.origin, step.origin)
            destination = candidate_to_real.get(step.destination, step.destination)
            op = {"op": "connect", "id": oid, "from": origin, "to": destination, "style": "arrow"}
            if label:
                op["label"] = label
            operations.append(op)
            n_candidate += 1
            candidate_to_real[f"new_{n_candidate}"] = oid

        elif step.op == "point":
            refs = [candidate_to_real.get(r, r) for r in step.refs]
            operations.append({"op": "highlight", "refs": refs})

    return {"schema_version": SCHEMA_VERSION, "operations": operations}
