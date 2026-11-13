#!/usr/bin/env bash
# Starts everything Gis needs: ollama, the sidecar (Laya + text model) and the Vite dev server.
#
#   bash scripts/start.sh      (or: npm start)
#
# Stops only what it started when you press Ctrl+C. Logs go to
# ${XDG_STATE_HOME:-$HOME/.local/state}/gis/logs/.
# Processes are stopped by PID or by listening port, never with `pkill -f <pattern>`
# (a pattern that appears in the shell's own argv ends up killing the shell).
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS="${XDG_STATE_HOME:-$HOME/.local/state}/gis/logs"
PY="${REPO}/sidecar/.venv/bin/python"
CHECKPOINT="${GIS_SIDECAR_CHECKPOINT:-${REPO}/models/laya-v1}"
PORT_OLLAMA=11434
PORT_SIDECAR="${GIS_SIDECAR_PORT:-8731}"
PORT_VITE=5173
TEXT_MODEL="${GIS_TEXT_MODEL:-gis-texto-v1}"

mkdir -p "$LOGS"
cd "$REPO" || exit 1

STARTED_PIDS=()

port_up() {  # ss (Linux) with a bash /dev/tcp fallback (macOS has no ss)
  if command -v ss >/dev/null 2>&1; then ss -ltn 2>/dev/null | grep -q ":${1}\b"
  else (exec 3<>"/dev/tcp/127.0.0.1/${1}") 2>/dev/null; fi
}

wait_for() {  # wait_for <seconds> <command...>
  local max=$1; shift
  local i
  for i in $(seq 1 "$max"); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

fail() { echo "ERROR: $*" >&2; cleanup; exit 1; }

launch() {  # launch <name> <command...>
  local name=$1; shift
  nohup "$@" > "${LOGS}/${name}.log" 2>&1 &
  STARTED_PIDS+=("$!")
  echo "  started ${name} (log: ${LOGS}/${name}.log)"
}

cleanup() {
  trap - INT TERM EXIT
  local pid
  for pid in "${STARTED_PIDS[@]:-}"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null
  done
  # `npm run dev` and `ollama serve` spawn children: free the ports we opened.
  local port pids
  for port in "${STARTED_PORTS[@]:-}"; do
    [ -n "$port" ] || continue
    pids=$(ss -ltnp 2>/dev/null | grep ":${port}\b" | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u)
    for pid in $pids; do kill "$pid" 2>/dev/null; done
  done
}
STARTED_PORTS=()
trap 'echo; echo "Stopping..."; cleanup; exit 0' INT TERM
trap cleanup EXIT

[ -d "${REPO}/node_modules" ] || fail "node_modules is missing. Run: npm install"
command -v ollama >/dev/null 2>&1 || fail "ollama is not installed (https://ollama.com). Install it and run 'npm run setup'."

# ── ollama ──
if port_up "$PORT_OLLAMA"; then
  echo "  ollama already running (port ${PORT_OLLAMA}); using it as is"
else
  launch ollama env OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 ollama serve
  STARTED_PORTS+=("$PORT_OLLAMA")
  wait_for 30 port_up "$PORT_OLLAMA" || fail "ollama did not start. See ${LOGS}/ollama.log"
fi

# ── Sidecar ──
if [ -x "$PY" ] && [ -e "$CHECKPOINT" ]; then
  if ! ollama list 2>/dev/null | awk 'NR>1{print $1}' | grep -qE "^${TEXT_MODEL}(:latest)?\$"; then
    echo "  WARNING: the ollama model '${TEXT_MODEL}' is not installed. Run 'npm run setup'."
  else
    echo "  preloading ${TEXT_MODEL} in ollama..."
    curl -s --max-time 120 "http://127.0.0.1:${PORT_OLLAMA}/api/chat" \
      -d "{\"model\":\"${TEXT_MODEL}\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"stream\":false,\"think\":false,\"keep_alive\":-1}" >/dev/null \
      || echo "  WARNING: preloading ${TEXT_MODEL} failed (the first turn will be slow)."
  fi
  if port_up "$PORT_SIDECAR"; then
    echo "  sidecar already running (port ${PORT_SIDECAR})"
  else
    # expandable_segments reduces CUDA memory fragmentation on small GPUs.
    launch sidecar env PYTORCH_CUDA_ALLOC_CONF="${PYTORCH_CUDA_ALLOC_CONF:-expandable_segments:True}" \
      "$PY" "${REPO}/sidecar/server.py"
    STARTED_PORTS+=("$PORT_SIDECAR")
    echo "  waiting for the sidecar (loading Laya, 20-40 s)..."
    wait_for 180 curl -sf --max-time 2 "http://127.0.0.1:${PORT_SIDECAR}/health" \
      || fail "the sidecar did not respond. See ${LOGS}/sidecar.log"
  fi
else
  echo "  The sidecar is NOT started: the Python environment (sidecar/.venv)"
  echo "  or the Laya checkpoint (${CHECKPOINT}) is missing. Run: npm run setup"
fi

# ── Vite ──
if port_up "$PORT_VITE"; then
  echo "  vite already running (port ${PORT_VITE})"
else
  launch vite npm run dev
  STARTED_PORTS+=("$PORT_VITE")
  wait_for 60 port_up "$PORT_VITE" || fail "vite did not start. See ${LOGS}/vite.log"
fi

echo
echo "Gis is ready: http://localhost:${PORT_VITE}/   (use Chrome or Edge: Web Speech API)"
echo "Press Ctrl+C to stop everything this script started."
while true; do sleep 3600 & wait $!; done
