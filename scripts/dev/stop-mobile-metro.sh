#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${METRO_PORT:-8081}"
killed=0

looks_like_metro() {
  local command_line="$1"
  case "${command_line}" in
    *react-native/cli.js\ start*|*react-native/cli.js\ start\ --reset-cache*|*metro*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

kill_pid() {
  local pid="$1"
  if [[ -z "${pid}" ]] || ! kill -0 "${pid}" 2>/dev/null; then
    return
  fi

  command_line="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
  if ! looks_like_metro "${command_line}"; then
    echo "Skipping PID ${pid}; it does not look like Metro:"
    echo "  ${command_line}"
    return
  fi

  kill "${pid}" 2>/dev/null || true
  killed=1
}

while IFS= read -r pid; do
  [[ -z "${pid}" ]] && continue
  command_line="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
  if looks_like_metro "${command_line}"; then
    kill_pid "${pid}"
  else
    echo "Port ${PORT} is used by PID ${pid}, but it does not look like Metro:"
    echo "  ${command_line}"
  fi
done < <(lsof -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true)

if [[ "${killed}" == "1" ]]; then
  echo "Metro stop requested."
else
  echo "Metro is not running on port ${PORT}."
fi
