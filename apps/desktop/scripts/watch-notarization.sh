#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../../.." && pwd)"

SUBMISSION_ID="${1:-}"
POLL_SECONDS="${POLL_SECONDS:-30}"

DEFAULT_API_KEY="${REPO_ROOT}/AuthKey_AMY9XVV3LD.p8"
DEFAULT_API_KEY_ID="AMY9XVV3LD"
DEFAULT_API_ISSUER="8de17ec0-4bff-4ab2-8c01-ace1f9307147"

usage() {
  cat <<'EOF'
Usage:
  apps/desktop/scripts/watch-notarization.sh <submission-id>

Environment overrides:
  APPLE_API_KEY      Path to App Store Connect API key (.p8)
  APPLE_API_KEY_ID   App Store Connect API key id
  APPLE_API_ISSUER   App Store Connect issuer id
  POLL_SECONDS       Poll interval in seconds (default: 30)
EOF
}

if [[ -z "${SUBMISSION_ID}" ]]; then
  usage >&2
  exit 1
fi

export APPLE_API_KEY="${APPLE_API_KEY:-${DEFAULT_API_KEY}}"
export APPLE_API_KEY_ID="${APPLE_API_KEY_ID:-${DEFAULT_API_KEY_ID}}"
export APPLE_API_ISSUER="${APPLE_API_ISSUER:-${DEFAULT_API_ISSUER}}"

if [[ ! -f "${APPLE_API_KEY}" ]]; then
  echo "Missing App Store Connect API key: ${APPLE_API_KEY}" >&2
  exit 1
fi

LOG_DIR="${REPO_ROOT}/apps/desktop/release/notarization-logs"
mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/${SUBMISSION_ID}.log"

log_line() {
  local message="$1"
  local line
  line="$(date '+%Y-%m-%d %H:%M:%S %z') ${message}"
  echo "${line}" | tee -a "${LOG_FILE}"
}

log_line "watch start submission=${SUBMISSION_ID} poll_seconds=${POLL_SECONDS}"
log_line "using key_id=${APPLE_API_KEY_ID} issuer=${APPLE_API_ISSUER}"

last_status=""

while true; do
  info_output="$(
    xcrun notarytool info "${SUBMISSION_ID}" \
      --key "${APPLE_API_KEY}" \
      --key-id "${APPLE_API_KEY_ID}" \
      --issuer "${APPLE_API_ISSUER}" 2>&1
  )"

  status="$(printf '%s\n' "${info_output}" | awk -F': ' '/^[[:space:]]*status:/ {print $2; exit}')"

  if [[ -z "${status}" ]]; then
    log_line "status=unknown"
    printf '%s\n' "${info_output}" >> "${LOG_FILE}"
    sleep "${POLL_SECONDS}"
    continue
  fi

  if [[ "${status}" != "${last_status}" ]]; then
    log_line "status=${status}"
    last_status="${status}"
  fi

  case "${status}" in
    Accepted)
      log_line "watch end submission=${SUBMISSION_ID} result=success"
      exit 0
      ;;
    Invalid|Rejected)
      log_line "watch end submission=${SUBMISSION_ID} result=${status}"
      printf '%s\n' "${info_output}" >> "${LOG_FILE}"
      exit 1
      ;;
  esac

  sleep "${POLL_SECONDS}"
done
