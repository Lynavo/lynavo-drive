#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${METRO_PORT:-8081}"
STATUS_URL="http://127.0.0.1:${PORT}/status"

metro_ready() {
  local body
  body="$(curl -fsS --max-time 1 "${STATUS_URL}" 2>/dev/null || true)"
  [[ "${body}" == *"packager-status:running"* ]]
}

port_pid() {
  lsof -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

if metro_ready; then
  echo "Metro already running on port ${PORT}."
  echo "Metro launch requested"
  exit 0
fi

existing_pid="$(port_pid)"
if [[ -n "${existing_pid}" ]]; then
  echo "Port ${PORT} is already in use by PID ${existing_pid}, but it is not responding as Metro."
  echo "Stop it first, then run F5 again:"
  echo "  lsof -ti tcp:${PORT} | xargs kill"
  exit 1
fi

echo "Starting Metro on port ${PORT}..."
cd "${ROOT}"

unset NODE_OPTIONS
unset VSCODE_INSPECTOR_OPTIONS
unset VSCODE_JS_DEBUG_BOOTLOADER
unset VSCODE_DEBUGGING

corepack pnpm --filter @syncflow/mobile start &
metro_pid="$!"

cleanup() {
  if kill -0 "${metro_pid}" 2>/dev/null; then
    kill "${metro_pid}" 2>/dev/null || true
  fi
}

trap cleanup INT TERM

sleep 1
if ! kill -0 "${metro_pid}" 2>/dev/null; then
  wait "${metro_pid}"
  exit $?
fi

echo "Metro launch requested"
wait "${metro_pid}"
