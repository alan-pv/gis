#!/usr/bin/env bash
# One-time (and idempotent) setup for Gis:
#   1. checks Node, ollama and Python
#   2. npm install
#   3. creates sidecar/.venv and installs sidecar/requirements.txt
#   4. downloads the models into models/ (GitHub release assets) and verifies SHA256
#   5. registers the text model in ollama
#   6. smoke-tests the Laya sidecar
#
#   npm run setup        (or: bash scripts/setup.sh)
#
# Environment:
#   GIS_RELEASE_URL      base URL of the release assets
#   GIS_MODELS_DIR       copy the assets from this local folder instead of downloading
#   GIS_TEXT_MODEL       ollama name for the text model (default: gis-texto-v1)
#
# Support: Linux (tested). macOS is best-effort (no CUDA; torch comes from PyPI and
# start.sh needs `ss`, from iproute2, which macOS lacks). Windows: use WSL2.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

GIS_RELEASE_URL="${GIS_RELEASE_URL:-https://github.com/alan-pv/gis/releases/download/v1.0.0}"
TEXT_MODEL="${GIS_TEXT_MODEL:-gis-texto-v1}"
MODELS="${REPO}/models"
VENV="${REPO}/sidecar/.venv"
OLLAMA_URL="http://127.0.0.1:11434"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/gis/logs"

LAYA_TAR="laya-v1.tar"
LAYA_TAR_SHA="b2b88740d0a4cd37098b1b086fe4c044ab4bcb7d73ec35aa1aed53ad537ef69c"
GGUF="gis-texto-v1.gguf"
GGUF_SHA="68b5b34093edd3274855da6d5fb8d832d1326a02a2177e3faae42ead88cda9ef"

OLLAMA_PID=""
SIDECAR_PID=""
step() { printf '\n==> %s\n' "$*"; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
cleanup() {
  [ -n "$SIDECAR_PID" ] && kill "$SIDECAR_PID" 2>/dev/null || true
  [ -n "$OLLAMA_PID" ] && kill "$OLLAMA_PID" 2>/dev/null || true
}
trap cleanup EXIT

sha_of() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
verify() {  # verify <file> <expected sha>
  local got; got="$(sha_of "$1")"
  [ "$got" = "$2" ]
}

# ── 1. Prerequisites ──
step "Checking prerequisites"
command -v node >/dev/null 2>&1 || die "Node.js is not installed. Install Node 22 or newer (see .nvmrc): https://nodejs.org"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || die "Node $(node -v) is too old; Node 22 or newer is required (see .nvmrc; with nvm: nvm install)."
command -v npm >/dev/null 2>&1 || die "npm is not installed (it ships with Node)."
command -v ollama >/dev/null 2>&1 || die "ollama is not installed. Download it from https://ollama.com/download and re-run 'npm run setup'."
command -v curl >/dev/null 2>&1 || die "curl is not installed."
command -v tar >/dev/null 2>&1 || die "tar is not installed."

PY_SYSTEM=""
for cand in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$cand" >/dev/null 2>&1 \
     && "$cand" -c 'import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,13) else 1)' 2>/dev/null; then
    PY_SYSTEM="$(command -v "$cand")"; break
  fi
done
[ -n "$PY_SYSTEM" ] || die "No Python 3.10-3.13 found (laya/torch have no wheels for newer versions yet). Install python3.12 (e.g. 'sudo dnf install python3.12' or 'sudo apt install python3.12 python3.12-venv') and re-run."
"$PY_SYSTEM" -c 'import venv, ensurepip' 2>/dev/null || die "$PY_SYSTEM cannot create virtual environments. On Debian/Ubuntu: sudo apt install python3-venv"
echo "  node $(node -v), $(ollama --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 | sed 's/^/ollama /'), $("$PY_SYSTEM" --version)"

# ── 2. npm install ──
step "Node dependencies"
if [ -d node_modules ]; then echo "  node_modules present, skipping"; else npm install; fi

# ── 3. Python venv ──
step "Python environment (sidecar/.venv)"
if [ -x "$VENV/bin/python" ] && "$VENV/bin/python" -c 'import sys' 2>/dev/null; then
  echo "  reusing existing venv"
else
  rm -rf "$VENV"
  "$PY_SYSTEM" -m venv "$VENV"
fi
PIP="$VENV/bin/pip"
"$PIP" install --quiet --upgrade pip
TORCH_VER="$(sed -n 's/^torch==\(.*\)$/\1/p' sidecar/requirements.txt)"
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
  echo "  NVIDIA GPU detected: installing torch with CUDA support (large download)"
  "$PIP" install "torch==${TORCH_VER}"
elif [ "$(uname -s)" = "Darwin" ]; then
  echo "  macOS: installing torch from PyPI (no CUDA; Laya will run on CPU/MPS)"
  "$PIP" install "torch==${TORCH_VER}"
else
  echo "  WARNING: no NVIDIA GPU detected. Installing the CPU build of torch;"
  echo "           Laya will run, but each turn will be much slower."
  "$PIP" install "torch==${TORCH_VER}" --index-url https://download.pytorch.org/whl/cpu
fi
"$PIP" install --quiet -r sidecar/requirements.txt

# ── 4. Models ──
step "Models (${MODELS})"
mkdir -p "$MODELS"
fetch() {  # fetch <asset> <sha>  -> leaves a verified file in $MODELS/<asset>
  local asset=$1 sha=$2 dest="${MODELS}/$1"
  if [ -f "$dest" ] && verify "$dest" "$sha"; then echo "  ${asset}: present and verified"; return 0; fi
  if [ -n "${GIS_MODELS_DIR:-}" ]; then
    [ -f "${GIS_MODELS_DIR}/${asset}" ] || die "${GIS_MODELS_DIR}/${asset} not found."
    echo "  ${asset}: copying from ${GIS_MODELS_DIR}"
    cp "${GIS_MODELS_DIR}/${asset}" "${dest}.part"
  else
    echo "  ${asset}: downloading from ${GIS_RELEASE_URL}"
    [ -f "${dest}.part" ] || : > "${dest}.part"
    curl -fL -C - --retry 3 --progress-bar -o "${dest}.part" "${GIS_RELEASE_URL}/${asset}" \
      || die "download of ${asset} failed. Check your connection or GIS_RELEASE_URL (re-running resumes the download)."
  fi
  if ! verify "${dest}.part" "$sha"; then
    rm -f "${dest}.part"
    die "SHA256 mismatch for ${asset}: the file is corrupt or not the expected release. It was deleted; re-run to try again."
  fi
  mv "${dest}.part" "$dest"
  echo "  ${asset}: verified"
}

if [ -f "${MODELS}/laya-v1/model.safetensors" ] && [ "$(cat "${MODELS}/laya-v1/.sha256" 2>/dev/null)" = "$LAYA_TAR_SHA" ]; then
  echo "  laya-v1: already extracted"
else
  fetch "$LAYA_TAR" "$LAYA_TAR_SHA"
  rm -rf "${MODELS}/laya-v1"
  tar -xf "${MODELS}/${LAYA_TAR}" -C "$MODELS"
  [ -f "${MODELS}/laya-v1/model.safetensors" ] || die "${LAYA_TAR} did not contain laya-v1/model.safetensors."
  echo "$LAYA_TAR_SHA" > "${MODELS}/laya-v1/.sha256"
  rm -f "${MODELS}/${LAYA_TAR}"
  echo "  laya-v1: extracted"
fi
fetch "$GGUF" "$GGUF_SHA"

# ── 5. ollama model ──
step "Registering ${TEXT_MODEL} in ollama"
ollama_up() { curl -sf --max-time 2 "${OLLAMA_URL}/api/version" >/dev/null 2>&1; }
if ollama_up; then
  echo "  ollama already running"
else
  mkdir -p "$STATE_DIR"
  nohup ollama serve > "${STATE_DIR}/ollama-setup.log" 2>&1 &
  OLLAMA_PID=$!
  for _ in $(seq 1 30); do ollama_up && break; sleep 1; done
  ollama_up || die "ollama did not start. See ${STATE_DIR}/ollama-setup.log"
  echo "  started a temporary ollama (it will be stopped at the end)"
fi
if ollama list | awk 'NR>1{print $1}' | grep -qE "^${TEXT_MODEL}(:latest)?\$"; then
  echo "  ${TEXT_MODEL} already registered, skipping"
else
  ollama create "$TEXT_MODEL" -f sidecar/Modelfile
fi
if [ -n "$OLLAMA_PID" ]; then
  kill "$OLLAMA_PID" 2>/dev/null || true
  wait "$OLLAMA_PID" 2>/dev/null || true
  OLLAMA_PID=""
fi

# ── 6. Smoke test ──
step "Smoke test: loading the Laya checkpoint"
PORT="$("$VENV/bin/python" -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')"
mkdir -p "$STATE_DIR"
GIS_SIDECAR_PORT="$PORT" PYTORCH_CUDA_ALLOC_CONF="${PYTORCH_CUDA_ALLOC_CONF:-expandable_segments:True}" \
  "$VENV/bin/python" sidecar/server.py > "${STATE_DIR}/setup-smoke.log" 2>&1 &
SIDECAR_PID=$!
ok=0
for _ in $(seq 1 240); do
  kill -0 "$SIDECAR_PID" 2>/dev/null || break
  if curl -sf --max-time 2 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
if [ "$ok" = 1 ]; then
  echo "  /health: $(curl -s "http://127.0.0.1:${PORT}/health")"
else
  die "the sidecar did not come up. See ${STATE_DIR}/setup-smoke.log"
fi
kill "$SIDECAR_PID" 2>/dev/null || true
wait "$SIDECAR_PID" 2>/dev/null || true
SIDECAR_PID=""

printf '\nSetup complete. Run: npm start\n'
