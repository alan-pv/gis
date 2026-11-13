"""Minimal stderr logging shared by the sidecar modules."""
from __future__ import annotations

import sys


def log(message: str) -> None:
    # sys.stderr is looked up at call time so redirection (tests, harnesses) works.
    print(f"[sidecar] {message}", file=sys.stderr)
