#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../../.." && pwd)"

PKG_PATH="${1:-}"

if [[ -z "${PKG_PATH}" ]]; then
  # Try to find the latest .pkg in the release folder, including subdirectories
  PKG_PATH=$(find "${REPO_ROOT}/apps/desktop/release" -name "*.pkg" -type f -print0 | xargs -0 ls -t 2>/dev/null | head -n 1)
fi

if [[ -z "${PKG_PATH}" || ! -f "${PKG_PATH}" ]]; then
  echo "Error: No .pkg file found to upload." >&2
  echo "Usage: scripts/upload-macos-testflight.sh [path/to/app.pkg]" >&2
  exit 1
fi

# Default Lynavo MAS Apple API Key
DEFAULT_API_KEY="${REPO_ROOT}/AuthKey_AMY9XVV3LD.p8"
DEFAULT_API_KEY_ID="AMY9XVV3LD"
DEFAULT_API_ISSUER="8de17ec0-4bff-4ab2-8c01-ace1f9307147"

export APPLE_API_KEY="${APPLE_API_KEY:-${DEFAULT_API_KEY}}"
export APPLE_API_KEY_ID="${APPLE_API_KEY_ID:-${DEFAULT_API_KEY_ID}}"
export APPLE_API_ISSUER="${APPLE_API_ISSUER:-${DEFAULT_API_ISSUER}}"

echo "Uploading ${PKG_PATH} to TestFlight..."

xcrun altool --upload-app \
  --type macos \
  --file "${PKG_PATH}" \
  --apiKey "${APPLE_API_KEY_ID}" \
  --apiIssuer "${APPLE_API_ISSUER}"

echo "Upload submitted. Check App Store Connect for processing status."
