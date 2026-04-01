#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../../.." && pwd)"
IOS_WORKSPACE="${REPO_ROOT}/apps/mobile/ios/SyncFlowMobile.xcworkspace"
IOS_SCHEME="SyncFlowMobile"

# Default MAS Apple API Key (same as Developer ID for simplicity)
DEFAULT_API_KEY="${REPO_ROOT}/AuthKey_49NX53FQZT.p8"
DEFAULT_API_KEY_ID="49NX53FQZT"
DEFAULT_API_ISSUER="a4c17482-b579-4670-8d58-dec6ec282e36"

resolve_build_number() {
  xcodebuild -workspace "${IOS_WORKSPACE}" -scheme "${IOS_SCHEME}" -showBuildSettings 2>/dev/null \
    | awk -F' = ' '/CURRENT_PROJECT_VERSION/ {print $2; exit}'
}

export APPLE_API_KEY="${APPLE_API_KEY:-${DEFAULT_API_KEY}}"
export APPLE_API_KEY_ID="${APPLE_API_KEY_ID:-${DEFAULT_API_KEY_ID}}"
export APPLE_API_ISSUER="${APPLE_API_ISSUER:-${DEFAULT_API_ISSUER}}"
export SYNCFLOW_BUILD_NUMBER="${SYNCFLOW_BUILD_NUMBER:-$(resolve_build_number)}"

if [[ -z "${SYNCFLOW_BUILD_NUMBER}" ]]; then
  echo "Failed to resolve build number from iOS project." >&2
  exit 1
fi

echo "Build number: ${SYNCFLOW_BUILD_NUMBER}"
echo "Building sidecar..."

cd "${REPO_ROOT}"
pnpm --filter @syncflow/desktop build:sidecar

echo "Packaging for Mac App Store (MAS)..."
# No explicit identities passed - letting electron-builder auto-detect
pnpm --filter @syncflow/desktop exec electron-builder --mac mas \
  "-c.buildVersion=${SYNCFLOW_BUILD_NUMBER}" \
  "-c.mas.bundleVersion=${SYNCFLOW_BUILD_NUMBER}" \
  "-c.extraMetadata.syncflowBuildNumber=${SYNCFLOW_BUILD_NUMBER}" \
  -c.mac.notarize=false

echo "MAS Packaging complete. PKG should be in apps/desktop/release/"
