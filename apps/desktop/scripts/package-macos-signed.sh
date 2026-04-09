#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../../.." && pwd)"
TARGET="${1:-dmg}"
IOS_WORKSPACE="${REPO_ROOT}/apps/mobile/ios/SyncFlowMobile.xcworkspace"
IOS_SCHEME="SyncFlowMobile"

DEFAULT_API_KEY="${REPO_ROOT}/AuthKey_49NX53FQZT.p8"
DEFAULT_API_KEY_ID="49NX53FQZT"
DEFAULT_API_ISSUER="a4c17482-b579-4670-8d58-dec6ec282e36"

usage() {
  cat <<'EOF'
Usage:
  apps/desktop/scripts/package-macos-signed.sh [dmg|dir]

Defaults:
  dmg  Build signed + notarized release artifacts
  dir  Build a signed .app directory without notarization, for local verification

Environment overrides:
  CSC_NAME           Preferred Developer ID identity name without the "Developer ID Application:" prefix
  APPLE_API_KEY      Path to App Store Connect API key (.p8)
  APPLE_API_KEY_ID   App Store Connect API key id
  APPLE_API_ISSUER   App Store Connect issuer id
EOF
}

if [[ "${TARGET}" != "dmg" && "${TARGET}" != "dir" ]]; then
  usage >&2
  exit 1
fi

detect_identity() {
  security find-identity -v -p codesigning \
    | sed -n 's/.*"Developer ID Application: \(.*\)"/\1/p' \
    | head -n 1
}

resolve_ios_build_number() {
  xcodebuild -workspace "${IOS_WORKSPACE}" -scheme "${IOS_SCHEME}" -showBuildSettings 2>/dev/null \
    | awk -F' = ' '/CURRENT_PROJECT_VERSION/ {print $2; exit}'
}

export CSC_NAME="${CSC_NAME:-$(detect_identity)}"
export APPLE_API_KEY="${APPLE_API_KEY:-${DEFAULT_API_KEY}}"
export APPLE_API_KEY_ID="${APPLE_API_KEY_ID:-${DEFAULT_API_KEY_ID}}"
export APPLE_API_ISSUER="${APPLE_API_ISSUER:-${DEFAULT_API_ISSUER}}"
export SYNCFLOW_BUILD_NUMBER="${SYNCFLOW_BUILD_NUMBER:-$(resolve_ios_build_number)}"

if [[ -z "${CSC_NAME}" ]]; then
  echo "No Developer ID Application identity found in keychain." >&2
  echo "Install the certificate first or export CSC_NAME manually." >&2
  exit 1
fi

if [[ -z "${SYNCFLOW_BUILD_NUMBER}" ]]; then
  echo "Failed to resolve desktop build number from iOS CURRENT_PROJECT_VERSION." >&2
  exit 1
fi

if [[ ! -f "${APPLE_API_KEY}" ]]; then
  echo "Missing App Store Connect API key: ${APPLE_API_KEY}" >&2
  echo "Copy AuthKey_*.p8 into the repo root or export APPLE_API_KEY manually." >&2
  exit 1
fi

chmod 600 "${APPLE_API_KEY}" 2>/dev/null || true

echo "Signing identity: ${CSC_NAME}"
echo "API key path: ${APPLE_API_KEY}"
echo "Build number: ${SYNCFLOW_BUILD_NUMBER}"
echo "Target: ${TARGET}"

cd "${REPO_ROOT}"

pnpm --filter @syncflow/desktop build
pnpm --filter @syncflow/desktop build:sidecar:mac

BUILD_ARGS=(
  "-c.buildVersion=${SYNCFLOW_BUILD_NUMBER}"
  "-c.extraMetadata.syncflowBuildNumber=${SYNCFLOW_BUILD_NUMBER}"
)

if [[ "${TARGET}" == "dir" ]]; then
  pnpm --filter @syncflow/desktop exec electron-builder --mac dir --arm64 --x64 -c.mac.notarize=false "${BUILD_ARGS[@]}"
else
  pnpm --filter @syncflow/desktop exec electron-builder --mac dmg --arm64 --x64 "${BUILD_ARGS[@]}"
fi
