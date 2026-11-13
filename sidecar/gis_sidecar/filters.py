"""filters.py: corrections applied to the plan and to the finished envelope.

Laya and the text model make a few recurring mistakes on a live board
(repeated texts, one-word fragments, duplicated concepts, arrows to nowhere,
orphan subtitles...). Each filter here removes one of them. They are pure
functions: they return a new envelope and how many operations were dropped, and
every removal cascades to whatever referenced the dropped operation, so the
envelope never keeps a dangling reference.
"""
from __future__ import annotations

import re
from dataclasses import replace
from typing import Any

from . import board
from .log import log
from .protocol import PlanStep

# A new body or list line with fewer words than this is a fragment ("mountains").
MIN_FRAGMENT_WORDS = 4

_BODY_ROLES = ("body", "list", "numbered")


def _cascade_dropped(ops: list[dict[str, Any]], dropped: set[str]) -> tuple[list[dict[str, Any]], int]:
    """Remove the `add`s whose id is in `dropped`, then (cascading, adding their
    ids to `dropped`) the `connect`/`update` that reference them, and the refs of
    `highlight`s (a highlight left with no refs goes too)."""
    out: list[dict[str, Any]] = []
    n = 0
    for op in ops:
        if op.get("op") == "add" and op.get("id") in dropped:
            n += 1
            continue
        if op.get("op") in ("connect", "update") and ({op.get("from"), op.get("to"), op.get("ref")} & dropped):
            if op.get("id"):
                dropped.add(op["id"])
            n += 1
            continue
        if op.get("op") == "highlight":
            refs = [r for r in op.get("refs", []) if (r if isinstance(r, str) else r.get("ref")) not in dropped]
            if not refs:
                n += 1
                continue
            op = dict(op, refs=refs)
        out.append(op)
    return out, n


def _plain_words(text: str | None) -> int:
    """Words of a text, not counting `**` bold marks."""
    return len((text or "").replace("**", " ").split())


def normalize_heading(text: str) -> str:
    """Case-, punctuation- and article-insensitive form of a text, for comparing
    headings and duplicates."""
    t = re.sub(r"[’‘`]", "'", text).lower()
    t = re.sub(r"[\W_]+", " ", t).strip()
    t = re.sub(r"\s+", " ", t)
    return re.sub(r"^(the|a|an) ", "", t)


# ── Plan filter ─────────────────────────────────────────────────────────────


def assign_loose_body(state: dict[str, Any], plan: list[PlanStep]) -> tuple[list[PlanStep], int]:
    """A body, list or numbered text with no group goes to the MOST RECENT section
    (the last one that received a member) when at least one section is already
    open, on the board or earlier in this plan. It runs before the paragraph
    rules, so the step is then seen as inside the section and continues its open
    paragraph. Titles, subtitles and concepts are left alone. Returns a new plan
    and how many steps it reassigned."""
    objects = state.get("objects", [])
    index = {o["id"]: i for i, o in enumerate(objects)}
    recent: str | None = None
    best = -1
    for g in state.get("groups", []):
        pos = max((index.get(m, -1) for m in (g.get("members") or [])), default=-1)
        if pos >= best:
            best, recent = pos, g.get("id")
    k = 0
    new_plan: list[PlanStep] = []
    n = 0
    for step in plan:
        if step.op in ("text", "concept"):
            if step.group == "new":
                k += 1
                recent = f"group_turn_{k}"
            elif step.group and step.group != "none":
                recent = step.group
            elif step.op == "text" and step.role in _BODY_ROLES and recent is not None:
                log(f"assign_loose_body: {step.role} without group -> {recent!r}")
                step = replace(step, group=recent)
                n += 1
        new_plan.append(step)
    return new_plan, n


# ── Envelope filters ────────────────────────────────────────────────────────


def drop_duplicate_texts(state: dict[str, Any], envelope: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """Drop a new `texto` whose normalized text equals another text of the same
    turn (the first is kept) or one already on the board; also an `update`
    that adds nothing new to its paragraph. Cascade: `connect`s to a dropped text
    go, its id leaves the `highlight`s, and if it opened a new group the rest of
    that group's members in this turn go too (a group without its subtitle is
    invalid).

    Exception: if the dropped subtitle of a new group repeats the heading of an
    EXISTING group, the other members are moved into that group instead (the
    teacher went back to that topic). If it repeats the page title or a loose
    text there is no section to move them to, and the whole group is dropped.
    """
    ops = envelope.get("operations", [])
    seen = {
        normalize_heading(o["label"])
        for o in state.get("objects", [])
        if o.get("object") == "texto" and o.get("label")
    }
    seen.discard("")
    previous_groups = {g["id"] for g in state.get("groups", [])}
    by_id = {o["id"]: o for o in state.get("objects", [])}
    # normalized heading -> id of the existing group that has it (to relocate).
    group_by_heading: dict[str, str] = {}
    for g in state.get("groups", []):
        h = normalize_heading(board.group_subtitle(state, g["id"]) or "")
        if h:
            group_by_heading.setdefault(h, g["id"])
    relocated: dict[str, str] = {}  # new group of the turn -> existing group
    dropped: set[str] = set()
    fallen_groups: set[str] = set()
    out: list[dict[str, Any]] = []
    n = 0
    for op in ops:
        if op.get("op") == "add" and op.get("group") in relocated:
            op = dict(op, group=relocated[op["group"]])
        if op.get("op") == "add" and op.get("object") == "texto":
            key = normalize_heading(op.get("text") or "")
            g = op.get("group")
            if (key and key in seen) or (g in fallen_groups):
                dropped.add(op["id"])
                if (
                    key in group_by_heading
                    and op.get("role") == "subtitulo"
                    and g
                    and g not in previous_groups
                    and g not in fallen_groups
                ):
                    relocated[g] = group_by_heading[key]
                elif g and g not in previous_groups and not any(x.get("group") == g for x in out):
                    fallen_groups.add(g)
                n += 1
                continue
            if key:
                seen.add(key)
        elif op.get("op") == "add" and op.get("group") in fallen_groups:
            dropped.add(op["id"])
            n += 1
            continue
        elif op.get("op") == "connect" and ({op.get("from"), op.get("to"), op.get("ref")} & dropped):
            if op.get("id"):
                dropped.add(op["id"])
            n += 1
            continue
        elif op.get("op") == "update":
            obj = by_id.get(op.get("ref"))
            new_text = (op.get("set") or {}).get("text")
            if obj and obj.get("object") == "texto" and isinstance(new_text, str) and set(op["set"]) == {"text"}:
                current = obj.get("label") or ""
                if new_text.startswith(current):
                    suffix = normalize_heading(new_text[len(current):])
                    if not suffix or f" {suffix} " in f" {normalize_heading(current)} ":
                        n += 1
                        continue
        elif op.get("op") == "highlight" and dropped:
            refs = [r for r in op.get("refs", []) if r not in dropped]
            if not refs:
                n += 1
                continue
            op = dict(op, refs=refs)
        out.append(op)
    return dict(envelope, operations=out), n


def drop_short_fragments(envelope: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """Drop a NEW body or list `texto` of fewer than `MIN_FRAGMENT_WORDS` words.
    It is judged on the final text, so a merged chain counts whole. Titles,
    subtitles, numbered lists and `update`s are left alone (a short suffix is
    valid)."""
    ops = envelope.get("operations", [])
    dropped = {
        o["id"]
        for o in ops
        if o.get("op") == "add"
        and o.get("object") == "texto"
        and o.get("role", "cuerpo") in ("cuerpo", "lista")
        and _plain_words(o.get("text")) < MIN_FRAGMENT_WORDS
    }
    if not dropped:
        return envelope, 0
    out, n = _cascade_dropped(ops, dropped)
    return dict(envelope, operations=out), n


def drop_empty_concepts(envelope: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """A `concepto` with no name cannot be drawn (the contract requires a label)."""
    ops = envelope.get("operations", [])
    empty = {
        o["id"]
        for o in ops
        if o.get("op") == "add" and o.get("object") == "concepto" and not (o.get("label") or "").strip()
    }
    if not empty:
        return envelope, 0
    out, n = _cascade_dropped(ops, empty)
    return dict(envelope, operations=out), n


def drop_orphan_headings(state: dict[str, Any], envelope: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """Drop headings that would look wrong; `state` is the board BEFORE the turn.

    1. A `subtitulo` with no group is dropped, unless it ends in «?» and the board
       has no open question yet: then it is kept as the guiding question.
    2. A `subtitulo` that opens a NEW group (not on the board by id or label) with
       no other `add` in that group within the envelope is dropped: a heading
       without content looks bad, even if it sometimes loses content that would
       have arrived a turn or two later.
    3. A `connect` from or to the title, or to the guiding question, is dropped:
       neither carries arrows.
    Cascade to whatever references a dropped id. Returns (envelope, n_dropped).
    """
    ops = envelope.get("operations", [])
    has_open_question = board.open_question(state) is not None
    state_groups = {g.get("id") for g in state.get("groups", [])}
    state_groups |= {g.get("label") for g in state.get("groups", []) if g.get("label")}
    state_groups |= {g.get("name") for g in state.get("groups", []) if g.get("name")}
    no_arrows = {
        o["id"]
        for o in state.get("objects", [])
        if o.get("object") == "texto" and board.role_of(o, state) == "titulo"
    }
    question = board.open_question(state)
    if question is not None:
        no_arrows.add(question["id"])
    no_arrows |= {
        o["id"] for o in ops if o.get("op") == "add" and o.get("object") == "texto" and o.get("role") == "titulo"
    }
    dropped: set[str] = set()
    for o in ops:
        if not (o.get("op") == "add" and o.get("object") == "texto" and o.get("role") == "subtitulo"):
            continue
        group = o.get("group")
        if not group:
            if board.ends_in_question(o.get("text") or "") and not has_open_question:
                has_open_question = True
                no_arrows.add(o["id"])
                continue
            reason = "subtitle without group"
        elif group not in state_groups and not any(
            x is not o and x.get("op") == "add" and x.get("group") == group for x in ops
        ):
            reason = "subtitle of a new group without content"
        else:
            continue
        dropped.add(o["id"])
        log(f"drop_orphan_headings: {o['id']!r} ({o.get('text')!r}) dropped ({reason})")
    n_arrows = 0
    kept: list[dict[str, Any]] = []
    for o in ops:
        if o.get("op") == "connect" and {o.get("from"), o.get("to")} & no_arrows:
            n_arrows += 1
            if o.get("id"):
                dropped.add(o["id"])
            log(f"drop_orphan_headings: {o.get('id')!r} dropped (arrow from the title)")
            continue
        kept.append(o)
    if not dropped and not n_arrows:
        return envelope, 0
    out, n = _cascade_dropped(kept, dropped)
    return dict(envelope, operations=out), n + n_arrows


def _concept_key(label: str | None) -> str:
    """Normalized concept label: no `**`, lowercase, collapsed spaces."""
    return " ".join((label or "").replace("**", " ").lower().split())


def _remap_refs(op: dict[str, Any], mapping: dict[str, str]) -> dict[str, Any]:
    """Copy of `op` with its references (`from`/`to`/`ref`/`refs`) remapped."""
    if not mapping:
        return op
    new = dict(op)
    for field_name in ("from", "to", "ref"):
        if new.get(field_name) in mapping:
            new[field_name] = mapping[new[field_name]]
    if isinstance(new.get("refs"), list):
        refs = []
        for r in new["refs"]:
            if isinstance(r, str):
                refs.append(mapping.get(r, r))
            elif isinstance(r, dict) and r.get("ref") in mapping:
                refs.append(dict(r, ref=mapping[r["ref"]]))
            else:
                refs.append(r)
        new["refs"] = refs
    return new


def clean_connections(state: dict[str, Any], envelope: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """Remove junk arrows and concepts. `state` is the board BEFORE the turn. In
    order of appearance:
    1. A duplicated `concepto` (same normalized label as one on the board or
       earlier in the envelope): its `add` is dropped and references to it are
       remapped to the existing one.
    2. A `connect` whose end is not an existing or earlier-added object (e.g. an
       arrow pointing at another arrow), or that ends up A->A: dropped.
    3. A `connect` repeating an already connected pair (undirected): dropped; if it
       had a label and the kept one (from this envelope) had none, the label moves.
    4. A `connect` reusing an id: renamed to the next free `connect_N`, and later
       references to it are remapped.
    Returns (envelope, n_dropped); renames do not count.
    """
    ops = envelope.get("operations", [])
    objects: dict[str, str] = {}  # id -> normalized label ("" if it is not a concept)
    concepts: dict[str, str] = {}  # normalized label -> id
    for o in state.get("objects", []):
        if not o.get("id"):
            continue
        objects[o["id"]] = ""
        if o.get("object") == "concepto":
            key = _concept_key(o.get("label"))
            if key:
                concepts.setdefault(key, o["id"])
    pairs: set[frozenset[str]] = set()
    connection_ids: set[str] = set()
    for c in state.get("connections", []):
        if c.get("id"):
            connection_ids.add(c["id"])
        if c.get("from") and c.get("to"):
            pairs.add(frozenset((c["from"], c["to"])))
    used_ids = set(objects) | connection_ids
    for o in ops:
        if o.get("op") == "add" and o.get("id"):
            used_ids.add(o["id"])
        if o.get("op") == "connect" and o.get("id"):
            used_ids.add(o["id"])

    def number(i: str) -> int:
        m = re.fullmatch(r"connect_(\d+)", i)
        return int(m.group(1)) if m else 0

    next_number = max([number(i) for i in used_ids] + [0]) + 1

    mapping: dict[str, str] = {}
    dropped: set[str] = set()
    seen_connections: set[str] = set(connection_ids)
    kept_by_pair: dict[frozenset[str], dict[str, Any]] = {}
    out: list[dict[str, Any]] = []
    n = 0
    for op in ops:
        op = _remap_refs(op, mapping)
        kind = op.get("op")
        if kind == "add":
            if op.get("object") == "concepto":
                key = _concept_key(op.get("label"))
                if key and key in concepts:
                    mapping[op["id"]] = concepts[key]
                    n += 1
                    log(f"clean_connections: duplicate concept {op['id']!r} ({op.get('label')!r}) -> {concepts[key]!r}")
                    continue
                if key:
                    concepts[key] = op["id"]
            if op.get("id"):
                objects[op["id"]] = ""
            out.append(op)
            continue
        if kind == "connect":
            origin, destination = op.get("from"), op.get("to")
            reason = None
            if origin not in objects or destination not in objects:
                reason = "an end is not an object"
            elif origin == destination:
                reason = "arrow to itself"
            elif frozenset((origin, destination)) in pairs:
                reason = "pair already connected"
                previous = kept_by_pair.get(frozenset((origin, destination)))
                if previous is not None and op.get("label") and not previous.get("label"):
                    previous["label"] = op["label"]
            if reason:
                n += 1
                if op.get("id"):
                    dropped.add(op["id"])
                log(f"clean_connections: {op.get('id')!r} {origin!r}->{destination!r} dropped ({reason})")
                continue
            pairs.add(frozenset((origin, destination)))
            cid = op.get("id")
            if cid in seen_connections or cid in objects:
                new_cid = f"connect_{next_number}"
                next_number += 1
                mapping[cid] = new_cid
                op = dict(op, id=new_cid)
                cid = new_cid
            if cid:
                seen_connections.add(cid)
                used_ids.add(cid)
            op = dict(op)
            kept_by_pair[frozenset((origin, destination))] = op
            out.append(op)
            continue
        if kind == "update" and op.get("ref") in dropped:
            n += 1
            continue
        if kind == "highlight" and dropped:
            refs = [r for r in op.get("refs", []) if (r if isinstance(r, str) else r.get("ref")) not in dropped]
            if not refs:
                n += 1
                continue
            op = dict(op, refs=refs)
        out.append(op)
    if n == 0 and not mapping:
        return envelope, 0
    return dict(envelope, operations=out), n


# ── Highlight of a single word ──────────────────────────────────────────────

_STOPWORDS = frozenset(
    """a about above after again all also am an and any are as at be because been before being below between both
    but by can could did does doing down during each few for from further had has have having her here hers him his
    how into its itself just let like more most much must not now off once only other our ours out over own said same
    she should some such than that the their theirs them then there these they this those through too under until
    very was were what when where which while who whom why will with would you your yours remember called call
    says say know look see thing things going gonna want""".split()
)
_RE_WORD = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)?")


def _stem(word: str) -> str:
    w = word.lower()
    if w.endswith("es") and len(w) > 4:
        return w[:-2]
    if w.endswith("s") and len(w) > 3:
        return w[:-1]
    return w


def _stems_of(word: str) -> set[str]:
    w = word.lower()
    return {w, _stem(w), w[:-1] if w.endswith("s") else w}


def word_to_highlight(text: str, utterance: str) -> str | None:
    """The word of `text` (which may contain `**`) that the teacher names in
    `utterance`: a bold word that was said, else the longest content word (at
    least 4 letters, no stopword) in common, else None. It returns an EXACT
    substring of the text without `**`, with the board's capitalization."""
    said: set[str] = set()
    for w in _RE_WORD.findall(utterance or ""):
        said |= _stems_of(w)
    bold = [w for seg in re.findall(r"\*\*(.+?)\*\*", text, flags=re.S) for w in _RE_WORD.findall(seg)]
    clean = text.replace("**", "")

    def matches(w: str) -> bool:
        return w.lower() not in _STOPWORDS and bool(_stems_of(w) & said)

    candidates = [w for w in bold if len(w) >= 3 and matches(w)]
    if not candidates:
        candidates = [w for w in _RE_WORD.findall(clean) if len(w) >= 4 and matches(w)]
    if not candidates:
        return None
    best = max(candidates, key=len)  # max returns the first one on a tie
    return best if best in clean else None


def highlight_words(
    state: dict[str, Any], envelope: dict[str, Any], utterance: str
) -> tuple[dict[str, Any], int]:
    """In each `highlight`, a string ref that points at a body, list or numbered
    text (from the state or added/updated in the envelope) becomes
    `{"ref": id, "word": word}` when `word_to_highlight` finds a word; otherwise
    the whole object stays highlighted. It never invents a highlight. Returns
    (envelope, n_replaced)."""
    ops = envelope.get("operations", [])
    if not any(o.get("op") == "highlight" for o in ops):
        return envelope, 0
    texts: dict[str, str] = {}
    for o in state.get("objects", []):
        if o.get("object") == "texto" and o.get("label") and board.role_of(o, state) in ("cuerpo", "lista", "enumeracion"):
            texts[o["id"]] = o["label"]
    out: list[dict[str, Any]] = []
    n = 0
    for o in ops:
        if o.get("op") == "add" and o.get("object") == "texto":
            if o.get("role") in ("cuerpo", "lista", "enumeracion") and o.get("text"):
                texts[o["id"]] = o["text"]
            else:
                texts.pop(o.get("id"), None)
        elif o.get("op") == "update" and o.get("ref") in texts and (o.get("set") or {}).get("text"):
            texts[o["ref"]] = o["set"]["text"]
        elif o.get("op") == "highlight":
            refs = []
            for r in o.get("refs", []):
                word = word_to_highlight(texts[r], utterance) if isinstance(r, str) and r in texts else None
                if word:
                    refs.append({"ref": r, "word": word})
                    n += 1
                    log(f"highlight_words: {r!r} -> {word!r}")
                else:
                    refs.append(r)
            o = dict(o, refs=refs)
        out.append(o)
    if not n:
        return envelope, 0
    return dict(envelope, operations=out), n
