#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../../.." && pwd)"
IOS_WORKSPACE="${REPO_ROOT}/apps/mobile/ios/LynavoDrive.xcworkspace"
IOS_SCHEME="LynavoDrive"

# Default Lynavo MAS Apple API Key (same as Developer ID for simplicity)
DEFAULT_API_KEY="${REPO_ROOT}/AuthKey_AMY9XVV3LD.p8"
DEFAULT_API_KEY_ID="AMY9XVV3LD"
DEFAULT_API_ISSUER="8de17ec0-4bff-4ab2-8c01-ace1f9307147"

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
pnpm --filter @lynavo-drive/desktop build:sidecar

echo "Packaging for Mac App Store (MAS)..."
# No explicit identities passed - letting electron-builder auto-detect
pnpm --filter @lynavo-drive/desktop exec electron-builder --mac mas \
  "-c.buildVersion=${SYNCFLOW_BUILD_NUMBER}" \
  "-c.mas.bundleVersion=${SYNCFLOW_BUILD_NUMBER}" \
  "-c.extraMetadata.syncflowBuildNumber=${SYNCFLOW_BUILD_NUMBER}" \
  -c.mac.notarize=false

echo "MAS Packaging complete. PKG should be in apps/desktop/release/"
