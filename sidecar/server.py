#!/usr/bin/env python3
"""server.py: local HTTP sidecar of Gis.

Listens on 127.0.0.1 and exposes `POST /turn` (board state + teacher sentence
in, envelope out) and `GET /health`. Laya decides the structure of each turn and
a small ollama text model writes the strings; see `gis_sidecar/turn.py`. The
web app reaches this server through the Vite dev proxy at `/api/sidecar`.

Environment (all optional):
  GIS_SIDECAR_PORT        port to listen on (default 8731)
  GIS_SIDECAR_CHECKPOINT  Laya checkpoint folder (default <repo>/models/laya-v1)
  GIS_SIDECAR_DEVICE      'cuda' or 'cpu' (default: cuda if available, else cpu)
  GIS_OLLAMA_URL          ollama base URL (default http://127.0.0.1:11434)
  GIS_TEXT_MODEL          ollama model that writes the texts (default gis-texto-v1)

Usage:
  sidecar/.venv/bin/python sidecar/server.py          # real Laya
  python3 sidecar/server.py --fake                    # no torch: every turn is a no-op
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

# Must be set before torch is imported: otherwise the first GPU pass tries to
# compile a Triton kernel, which fails on some machines.
os.environ.setdefault("TORCH_DISABLE_NATIVE_JIT", "1")

SIDECAR_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SIDECAR_DIR))

from gis_sidecar.decider import LayaPredictor  # noqa: E402
from gis_sidecar.text_writer import DEFAULT_MODEL, DEFAULT_URL  # noqa: E402
from gis_sidecar.turn import (  # noqa: E402
    Context,
    handle_turn,
    live_device,
    peak_vram_mib,
    start_preload,
)

HOST = "127.0.0.1"
DEFAULT_PORT = 8731
DEFAULT_CHECKPOINT = SIDECAR_DIR.parent / "models" / "laya-v1"


class FakePredictor:
    """Answers 'done' to the first question, so every turn is a no-op. It lets
    the web app be developed without a GPU and without importing torch."""

    def predict(self, state_text: str, questions: dict[str, Any]) -> dict[str, str]:
        return {"next": "done"} if "next" in questions else {}


def resolve_device(override: str | None, cuda_available: bool) -> str:
    """`override` wins if it is 'cuda' or 'cpu'; otherwise cuda when available.
    Forcing CPU on a small GPU avoids a failed CUDA allocation at startup."""
    if override not in (None, "", "cuda", "cpu"):
        raise ValueError(f"invalid GIS_SIDECAR_DEVICE: {override!r}; valid values: 'cuda', 'cpu'")
    return override or ("cuda" if cuda_available else "cpu")


def load_laya(checkpoint: Path, device_override: str | None) -> tuple[LayaPredictor, str]:
    """Load the Laya checkpoint (a local folder). Returns (predictor, device)."""
    import torch

    import laya

    if not checkpoint.is_dir():
        raise FileNotFoundError(
            f"Laya checkpoint not found at {checkpoint}. Run `npm run setup`, "
            "or point GIS_SIDECAR_CHECKPOINT to the checkpoint folder."
        )
    device = resolve_device(device_override, torch.cuda.is_available())
    return LayaPredictor(laya.load(str(checkpoint), device=device)), device


class Handler(BaseHTTPRequestHandler):
    ctx: Context  # set in main() before serving

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 — name fixed by BaseHTTPRequestHandler
        if self.path != "/health":
            self._send_json(404, {"error": f"route not found: {self.path}"})
            return
        payload: dict[str, Any] = {
            "ok": True,
            "checkpoint": self.ctx.checkpoint,
            "device": live_device(self.ctx),
            "textReady": self.ctx.text_ready,
        }
        if self.ctx.text_error:
            payload["textError"] = self.ctx.text_error
        vram_mib = peak_vram_mib()
        if vram_mib is not None:
            payload["vramMiB"] = round(vram_mib, 1)
        self._send_json(200, payload)

    def do_POST(self) -> None:  # noqa: N802
        # Taken before anything else: it is the start of the request's real wait
        # for the inference lock.
        arrival_ts = time.perf_counter()
        if self.path != "/turn":
            self._send_json(404, {"error": f"route not found: {self.path}"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length > 0 else b"{}"
            self._send_json(200, handle_turn(self.ctx, json.loads(raw.decode("utf-8")), arrival_ts))
        except Exception as exc:  # noqa: BLE001 — a failed turn must never kill the process
            self._send_json(500, {"error": str(exc)})

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 — stdlib signature
        pass  # quiet: the sidecar runs behind the Vite proxy


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--fake", action="store_true", help="no Laya, no torch: every turn is a no-op")
    args = parser.parse_args()

    port = int(os.environ.get("GIS_SIDECAR_PORT") or DEFAULT_PORT)
    text_model = os.environ.get("GIS_TEXT_MODEL") or DEFAULT_MODEL
    ollama_url = (os.environ.get("GIS_OLLAMA_URL") or DEFAULT_URL).rstrip("/")

    if args.fake:
        predictor: Any = FakePredictor()
        checkpoint, device = "fake", "cpu"
    else:
        checkpoint_path = Path(os.environ.get("GIS_SIDECAR_CHECKPOINT") or DEFAULT_CHECKPOINT)
        predictor, device = load_laya(checkpoint_path, os.environ.get("GIS_SIDECAR_DEVICE"))
        checkpoint = str(checkpoint_path)

    ctx = Context(predictor, checkpoint, device, text_model=text_model, ollama_url=ollama_url)
    Handler.ctx = ctx
    if not args.fake:
        start_preload(ctx)  # daemon thread: does not block /health

    server = ThreadingHTTPServer((HOST, port), Handler)
    print(
        f"[sidecar] listening on http://{HOST}:{port} "
        f"(checkpoint={checkpoint}, device={device}, text model={text_model})",
        file=sys.stderr,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
