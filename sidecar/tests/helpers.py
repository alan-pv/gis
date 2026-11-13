"""Small builders for board states used across the tests."""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

SIDECAR_DIR = Path(__file__).resolve().parents[1]
if str(SIDECAR_DIR) not in sys.path:
    sys.path.insert(0, str(SIDECAR_DIR))


def make_state(objects=(), groups=(), connections=(), recent=()) -> dict[str, Any]:
    return {
        "schema_version": "1.0",
        "objects": list(objects),
        "connections": list(connections),
        "groups": list(groups),
        "recent_utterances": list(recent),
    }


def text_obj(oid: str, label: str | None, role: str | None = "cuerpo") -> dict[str, Any]:
    obj: dict[str, Any] = {"id": oid, "object": "texto", "label": label}
    if role is not None:
        obj["role"] = role
    return obj


def concept_obj(oid: str, label: str) -> dict[str, Any]:
    return {"id": oid, "object": "concepto", "label": label}


def group(gid: str, members: list[str], label: str | None = None) -> dict[str, Any]:
    return {"id": gid, "label": label, "members": members}


def connection(cid: str, origin: str, destination: str, label: str | None = None) -> dict[str, Any]:
    return {"id": cid, "from": origin, "to": destination, "style": "arrow", "label": label}


def sample_state() -> dict[str, Any]:
    """A small lesson: a title, one section (subtitle + paragraph) and a concept."""
    return make_state(
        objects=[
            text_obj("texto_1", "Water cycle", "titulo"),
            text_obj("texto_2", "Evaporation", "subtitulo"),
            text_obj("texto_3", "The sun heats the sea", "cuerpo"),
            concept_obj("concepto_1", "Sun"),
        ],
        groups=[group("grupo_1", ["texto_2", "texto_3"])],
        recent=["First sentence.", "Second sentence."],
    )
