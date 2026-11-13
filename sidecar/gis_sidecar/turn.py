"""turn.py: handle one `/turn` request from start to finish.

Laya decides the plan (`decider.py`), the text model writes the blanks
(`text_writer.py`), the envelope is assembled (`envelope.py`) and corrected
(`filters.py`). The response field names (`envelope`, `metrics`, `textError`,
`debug`...) are read by the web app and must not change.
"""
from __future__ import annotations

import sys
import threading
import time
from typing import Any

from . import filters
from .blanks import blanks_for_plan
from .decider import decide_turn
from .envelope import build_envelope
from .log import log
from .protocol import SCHEMA_VERSION
from .text_writer import (
    DEFAULT_MODEL,
    DEFAULT_URL,
    TextOllamaError,
    TextTimeoutError,
    preload_model,
    write_texts,
)

# A slow turn holds `Context.lock` past the client's own timeout (the client
# aborts, but Laya keeps computing), and every later request would queue behind
# work nobody is waiting for. Two independent guards break that cascade.
# `TURN_BUDGET_MS` closes Laya's own loop with what it has decided; a request
# that waited more than `MAX_WAIT_MS` for the lock is discarded as stale.
TURN_BUDGET_MS = 1500.0
MAX_WAIT_MS = 3000.0


class Context:
    """State shared by all requests: the loaded predictor, the lock that
    serializes inference (one Laya forward at a time) and the text model's
    status, which `/health` exposes as `textReady` / `textError`."""

    def __init__(
        self,
        predictor: Any,
        checkpoint: str,
        device: str,
        text_model: str = DEFAULT_MODEL,
        ollama_url: str = DEFAULT_URL,
        budget_ms: float = TURN_BUDGET_MS,
        max_wait_ms: float = MAX_WAIT_MS,
    ):
        self.predictor = predictor
        self.checkpoint = checkpoint
        self.device = device
        self.text_model = text_model
        self.ollama_url = ollama_url
        self.budget_ms = budget_ms
        self.max_wait_ms = max_wait_ms
        self.lock = threading.Lock()
        self.text_ready = False
        self.text_error: str | None = None


def live_device(ctx: Context) -> str:
    """The predictor's CURRENT device. `laya` permanently falls back to CPU if a
    call runs out of VRAM, so this can differ from the device chosen at startup;
    a switch from 'cuda' to 'cpu' between turns explains a sudden latency jump."""
    agent = getattr(ctx.predictor, "agent", None)
    device = getattr(agent, "device", None)
    if device is not None:
        return str(getattr(device, "type", device))
    return ctx.device


def peak_vram_mib() -> float | None:
    """Peak CUDA memory allocated since the process started (never reset between
    turns), or None when torch is not loaded (`--fake`) or there is no CUDA."""
    if "torch" not in sys.modules:
        return None
    import torch

    if not torch.cuda.is_available():
        return None
    return torch.cuda.max_memory_allocated() / (1024 * 1024)


def preload_text_model(ctx: Context) -> None:
    """Warm the text model up. Never raises: the result goes to
    `ctx.text_ready` / `ctx.text_error`. If it fails, the first turn that needs
    text tries again on its own."""
    try:
        ms = preload_model(ctx.text_model, ctx.ollama_url)
    except TextTimeoutError as exc:
        ctx.text_ready, ctx.text_error = False, "timeout while preloading the text model in ollama"
        log(f"text model preload failed (timeout): {exc}")
    except TextOllamaError as exc:
        ctx.text_ready, ctx.text_error = False, exc.cause
        log(f"text model preload failed: {exc}")
    except Exception as exc:  # noqa: BLE001 — ollama not running, etc.
        ctx.text_ready, ctx.text_error = False, f"ollama is not responding: {exc}"
        log(f"text model preload failed: {exc}")
    else:
        ctx.text_ready, ctx.text_error = True, None
        log(f"text model preloaded ({ms:.0f} ms)")


def start_preload(ctx: Context) -> threading.Thread:
    """Run `preload_text_model` in a daemon thread so startup is not blocked."""
    thread = threading.Thread(target=preload_text_model, args=(ctx,), name="text-preload", daemon=True)
    thread.start()
    return thread


def _stale_response(ctx: Context, waited_ms: float) -> dict[str, Any]:
    return {
        "envelope": {"schema_version": SCHEMA_VERSION, "operations": []},
        "metrics": {
            "deciderMs": 0.0,
            "textMs": 0.0,
            "steps": 0,
            "questions": 0,
            "device": live_device(ctx),
            "dropped": "stale",
            "waitMs": round(waited_ms, 2),
        },
    }


def handle_turn(ctx: Context, body: dict[str, Any], arrival_ts: float) -> dict[str, Any]:
    state = body.get("state")
    utterance = body.get("utterance")
    if not isinstance(state, dict):
        raise ValueError("'state' must be an object (the board state)")
    if not isinstance(utterance, str):
        raise ValueError("'utterance' must be a string")

    # The timeout goes on `acquire` itself: checking the wait only AFTER getting
    # the lock would detect staleness once the whole wait was already paid. Each
    # request thread gives up on its own after `max_wait_ms`, so a stuck turn
    # does not make N requests queue for its full duration.
    if not ctx.lock.acquire(timeout=ctx.max_wait_ms / 1000.0):
        return _stale_response(ctx, (time.perf_counter() - arrival_ts) * 1000.0)
    try:
        # The lock may have been freed just in time: check once more before
        # computing an answer the client may have abandoned.
        waited_ms = (time.perf_counter() - arrival_ts) * 1000.0
        if waited_ms > ctx.max_wait_ms:
            return _stale_response(ctx, waited_ms)
        decision = decide_turn(ctx.predictor, state, utterance, budget_ms=ctx.budget_ms)
    finally:
        ctx.lock.release()

    plan, _n_loose = filters.assign_loose_body(state, decision.plan)
    blanks = blanks_for_plan(state, plan)
    text_ms = 0.0
    text_error: str | None = None
    text_timeout = False
    texts: list[str] = []
    raw = ""
    if blanks:
        previous = state.get("recent_utterances", [])
        try:
            written = write_texts(blanks, utterance, previous, model=ctx.text_model, url=ctx.ollama_url)
            texts, text_ms, raw = written.texts, written.ms, written.raw
            ctx.text_ready, ctx.text_error = True, None
        except TextTimeoutError:
            # Not a legitimate no-op: flag it so the app shows it.
            text_timeout = True
            text_error = (
                "the text model did not answer in time (timeout); "
                "it may be loading or the GPU may have no free VRAM"
            )
        except TextOllamaError as exc:
            text_error = exc.cause
        except RuntimeError as exc:
            text_error = f"the text model call failed: {exc}"
        if text_error is not None:
            ctx.text_ready, ctx.text_error = False, text_error

    if text_error is not None:
        # Without text there is no valid partial text, so every text and concept
        # step is dropped; arrows are still emitted, without their label. An arrow
        # of this same turn that pointed at a dropped step ends up with an
        # unresolved end, and the app's validator discards it like any bad ref.
        emitted = [step for step in plan if step.op not in ("text", "concept")]
        texts = [""] * len(blanks_for_plan(state, emitted))
    else:
        emitted = plan

    envelope = build_envelope(state, emitted, texts)
    envelope, n_duplicates = filters.drop_duplicate_texts(state, envelope)
    envelope, n_fragments = filters.drop_short_fragments(envelope)
    envelope, n_empty_concepts = filters.drop_empty_concepts(envelope)
    envelope, n_connections = filters.clean_connections(state, envelope)
    envelope, _n_headings = filters.drop_orphan_headings(state, envelope)
    envelope, _n_words = filters.highlight_words(state, envelope, utterance)

    vram_mib = peak_vram_mib()
    metrics: dict[str, Any] = {
        "deciderMs": round(decision.ms, 2),
        "textMs": round(text_ms, 2),
        "steps": decision.steps,
        "questions": decision.questions,
        "device": live_device(ctx),
        "waitMs": round(waited_ms, 2),
    }
    if decision.restrictions_applied or n_duplicates:
        metrics["constraints"] = decision.restrictions_applied
        metrics["duplicatesDropped"] = n_duplicates
    if n_fragments:
        metrics["fragmentsDropped"] = n_fragments
    if n_connections:
        metrics["connectionsCleaned"] = n_connections
    if n_empty_concepts:
        metrics["emptyConceptsDropped"] = n_empty_concepts
    if decision.cut_by_budget:
        metrics["budgetCut"] = True
    if text_timeout:
        metrics["textTimeout"] = True
    if text_error is not None:
        metrics["textError"] = text_error
    if vram_mib is not None:
        metrics["vramMiB"] = round(vram_mib, 1)

    response: dict[str, Any] = {"envelope": envelope, "metrics": metrics}
    if text_error is not None:
        # Also at the top level: this is the field the client displays.
        response["textError"] = text_error
    if blanks:
        # What the text model really said and a compact context of each blank.
        response["debug"] = {
            "texts": list(texts),
            "raw": raw,
            "blanks": [{"kind": b.kind, "role": b.role, "group_label": b.group_label} for b in blanks],
        }
    return response
