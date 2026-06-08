#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../../.." && pwd)"
TARGET="${1:-dmg}"
IOS_WORKSPACE="${REPO_ROOT}/apps/mobile/ios/SyncFlowMobile.xcworkspace"
IOS_SCHEME="SyncFlowMobile"
DESKTOP_PACKAGE_JSON="${REPO_ROOT}/apps/desktop/package.json"

DEFAULT_API_KEY_ID="HY8CAHGPW9"
DEFAULT_API_KEY="${REPO_ROOT}/AuthKey_${DEFAULT_API_KEY_ID}.p8"
DEFAULT_API_ISSUER="54cad458-4184-4fc6-a1c7-cb4b0c6ded0e"
DEFAULT_CSC_NAME="Shenzhen Kaiyun Information Technology Co., Ltd. (GKN7JQNCMC)"

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
  ELECTRON_BUILDER_CONFIG
                    Optional electron-builder config file, e.g. electron-builder.global.yml
EOF
}

if [[ "${TARGET}" != "dmg" && "${TARGET}" != "dir" ]]; then
  usage >&2
  exit 1
fi

list_developer_identities() {
  security find-identity -v -p codesigning \
    | sed -n 's/.*"Developer ID Application: \(.*\)"/\1/p'
}

detect_identity() {
  local identities
  identities="$(list_developer_identities)"

  if [[ -n "${DEFAULT_CSC_NAME}" ]] && grep -Fxq "${DEFAULT_CSC_NAME}" <<<"${identities}"; then
    echo "${DEFAULT_CSC_NAME}"
    return 0
  fi

  echo "${identities}" | head -n 1
}

resolve_ios_build_number() {
  xcodebuild -workspace "${IOS_WORKSPACE}" -scheme "${IOS_SCHEME}" -showBuildSettings 2>/dev/null \
    | awk -F' = ' '/CURRENT_PROJECT_VERSION/ {print $2; exit}'
}

resolve_desktop_package_field() {
  local field="$1"

  node -e 'const pkg = require(process.argv[1]); process.stdout.write(String(pkg[process.argv[2]] || ""));' \
    "${DESKTOP_PACKAGE_JSON}" "${field}"
}

export CSC_NAME="${CSC_NAME:-$(detect_identity)}"
export APPLE_API_KEY="${APPLE_API_KEY:-${DEFAULT_API_KEY}}"
export APPLE_API_KEY_ID="${APPLE_API_KEY_ID:-${DEFAULT_API_KEY_ID}}"
export APPLE_API_ISSUER="${APPLE_API_ISSUER:-${DEFAULT_API_ISSUER}}"
export SYNCFLOW_BUILD_NUMBER="${SYNCFLOW_BUILD_NUMBER:-$(resolve_ios_build_number)}"
DESKTOP_PRODUCT_NAME="$(resolve_desktop_package_field productName)"
DESKTOP_VERSION="$(resolve_desktop_package_field version)"

if [[ "${APPLE_API_KEY}" != /* ]]; then
  export APPLE_API_KEY="${REPO_ROOT}/${APPLE_API_KEY}"
fi

if [[ -z "${CSC_NAME}" ]]; then
  echo "No Developer ID Application identity found in keychain." >&2
  echo "Install the certificate first or export CSC_NAME manually." >&2
  exit 1
fi

if [[ -z "${SYNCFLOW_BUILD_NUMBER}" ]]; then
  echo "Failed to resolve desktop build number from iOS CURRENT_PROJECT_VERSION." >&2
  exit 1
fi

if [[ -z "${DESKTOP_PRODUCT_NAME}" || -z "${DESKTOP_VERSION}" ]]; then
  echo "Failed to resolve desktop productName/version from ${DESKTOP_PACKAGE_JSON}." >&2
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
if [[ -n "${ELECTRON_BUILDER_CONFIG:-}" ]]; then
  echo "Electron builder config: ${ELECTRON_BUILDER_CONFIG}"
fi

cd "${REPO_ROOT}"

pnpm --filter @syncflow/desktop build
pnpm --filter @syncflow/desktop build:sidecar:mac

BUILD_ARGS=(
  "-c.buildVersion=${SYNCFLOW_BUILD_NUMBER}"
  "-c.extraMetadata.syncflowBuildNumber=${SYNCFLOW_BUILD_NUMBER}"
)

if [[ -n "${ELECTRON_BUILDER_CONFIG:-}" ]]; then
  BUILD_ARGS=("--config" "${ELECTRON_BUILDER_CONFIG}" "${BUILD_ARGS[@]}")
fi

build_macos_arch() {
  local target="$1"
  local arch="$2"
  local arch_build_args=("${BUILD_ARGS[@]}")

  if [[ "${target}" == "dir" ]]; then
    pnpm --filter @syncflow/desktop exec electron-builder --mac "${target}" "--${arch}" -c.mac.notarize=false "${arch_build_args[@]}"
  else
    arch_build_args+=("-c.dmg.title=${DESKTOP_PRODUCT_NAME} ${DESKTOP_VERSION}-${arch}")
    pnpm --filter @syncflow/desktop exec electron-builder --mac "${target}" "--${arch}" "${arch_build_args[@]}"
  fi
}

validate_dmg_payload() {
  local arch="$1"
  local dmg_path="${REPO_ROOT}/apps/desktop/release/ViviDrop-${DESKTOP_VERSION}-${arch}.dmg"
  local mount_dir
  local app_path

  if [[ ! -f "${dmg_path}" ]]; then
    echo "Missing DMG artifact: ${dmg_path}" >&2
    exit 1
  fi

  mount_dir="$(mktemp -d "${TMPDIR:-/tmp}/vividrop-dmg-${arch}.XXXXXX")"
  app_path="${mount_dir}/${DESKTOP_PRODUCT_NAME}.app"

  if ! hdiutil attach -quiet -nobrowse -readonly -mountpoint "${mount_dir}" "${dmg_path}"; then
    rm -rf "${mount_dir}"
    echo "Failed to mount DMG artifact: ${dmg_path}" >&2
    exit 1
  fi

  if [[ ! -d "${app_path}" ]]; then
    echo "DMG artifact does not contain ${DESKTOP_PRODUCT_NAME}.app: ${dmg_path}" >&2
    find "${mount_dir}" -maxdepth 1 -print >&2
    hdiutil detach "${mount_dir}" >/dev/null || true
    rm -rf "${mount_dir}"
    exit 1
  fi

  hdiutil detach "${mount_dir}" >/dev/null
  rm -rf "${mount_dir}"
  echo "Validated DMG payload: ${dmg_path}"
}

for arch in x64 arm64; do
  build_macos_arch "${TARGET}" "${arch}"
  if [[ "${TARGET}" == "dmg" ]]; then
    validate_dmg_payload "${arch}"
  fi
done
