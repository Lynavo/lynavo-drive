#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../../.." && pwd)"
TARGET="${1:-dmg}"
IOS_WORKSPACE="${REPO_ROOT}/apps/mobile/ios/SyncFlowMobile.xcworkspace"
IOS_SCHEME="SyncFlowMobile"
DESKTOP_PACKAGE_JSON="${REPO_ROOT}/apps/desktop/package.json"
ELECTRON_BUILDER_CONFIG="electron-builder.yml"

DEFAULT_API_KEY_ID="AMY9XVV3LD"
DEFAULT_API_ISSUER="8de17ec0-4bff-4ab2-8c01-ace1f9307147"
DEFAULT_CSC_TEAM_ID="S44ANBLMF9"

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
  ELECTRON_BUILDER_CONFIG is intentionally ignored; this script always uses
                    electron-builder.yml.
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

list_codesigning_identities_for_team() {
  local team_id="$1"

  security find-identity -v -p codesigning \
    | sed -n 's/.*"\(.*(\(.*\))\)"/\1/p' \
    | grep -F "(${team_id})" || true
}

list_certificates_for_team() {
  local team_id="$1"

  security find-certificate -a -p 2>/dev/null \
    | openssl crl2pkcs7 -nocrl -certfile /dev/stdin 2>/dev/null \
    | openssl pkcs7 -print_certs -text -noout 2>/dev/null \
    | sed -n 's/^[[:space:]]*Subject: UID=.*CN=\(.*\), OU=.*$/\1/p' \
    | grep -F "(${team_id})" || true
}

detect_identity_for_team() {
  local team_id="$1"
  local identities
  identities="$(list_developer_identities)"

  grep -F "(${team_id})" <<<"${identities}" | head -n 1
}

resolve_expected_csc_team_id() {
  echo "${CSC_TEAM_ID:-${DEFAULT_CSC_TEAM_ID}}"
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

configure_app_store_connect_key() {
  APPLE_API_KEY_ID="${APPLE_API_KEY_ID:-${DEFAULT_API_KEY_ID}}"
  APPLE_API_ISSUER="${APPLE_API_ISSUER:-${DEFAULT_API_ISSUER}}"

  if [[ -z "${APPLE_API_KEY:-}" ]]; then
    if [[ -f "${REPO_ROOT}/AuthKey_${APPLE_API_KEY_ID}.p8" ]]; then
      APPLE_API_KEY="${REPO_ROOT}/AuthKey_${APPLE_API_KEY_ID}.p8"
    elif [[ -f "${REPO_ROOT}/AuthKey_Lynavo_${APPLE_API_KEY_ID}.p8" ]]; then
      APPLE_API_KEY="${REPO_ROOT}/AuthKey_Lynavo_${APPLE_API_KEY_ID}.p8"
    else
      APPLE_API_KEY="${REPO_ROOT}/AuthKey_${APPLE_API_KEY_ID}.p8"
    fi
  elif [[ "${APPLE_API_KEY}" != /* ]]; then
    APPLE_API_KEY="${REPO_ROOT}/${APPLE_API_KEY}"
  fi

  export APPLE_API_KEY
  export APPLE_API_KEY_ID
  export APPLE_API_ISSUER
}

configure_app_store_connect_key
EXPECTED_CSC_TEAM_ID="$(resolve_expected_csc_team_id)"
export CSC_NAME="${CSC_NAME:-$(detect_identity_for_team "${EXPECTED_CSC_TEAM_ID}")}"
export SYNCFLOW_BUILD_NUMBER="${SYNCFLOW_BUILD_NUMBER:-$(resolve_ios_build_number)}"
DESKTOP_PRODUCT_NAME="$(resolve_desktop_package_field productName)"
DESKTOP_VERSION="$(resolve_desktop_package_field version)"
DMG_CREATE_VOLUME_NAME="${DESKTOP_PRODUCT_NAME} DMG"

if [[ -z "${CSC_NAME}" ]]; then
  echo "No Developer ID Application identity for Team ID ${EXPECTED_CSC_TEAM_ID} found in keychain." >&2
  matching_codesigning_identities="$(list_codesigning_identities_for_team "${EXPECTED_CSC_TEAM_ID}")"
  if [[ -n "${matching_codesigning_identities}" ]]; then
    echo "Found other codesigning identities for Team ID ${EXPECTED_CSC_TEAM_ID}, but macOS DMG requires Developer ID Application:" >&2
    echo "${matching_codesigning_identities}" >&2
  fi
  matching_certificates="$(list_certificates_for_team "${EXPECTED_CSC_TEAM_ID}")"
  if [[ -n "${matching_certificates}" ]]; then
    echo "Found certificates for Team ID ${EXPECTED_CSC_TEAM_ID}, but not a usable Developer ID Application signing identity:" >&2
    echo "${matching_certificates}" >&2
  fi
  echo "Install the certificate first or export CSC_NAME manually with the matching team." >&2
  echo "Available Developer ID Application identities:" >&2
  list_developer_identities >&2
  exit 1
fi

if [[ "${CSC_NAME}" != *"(${EXPECTED_CSC_TEAM_ID})"* ]]; then
  echo "Selected CSC_NAME does not match expected Team ID ${EXPECTED_CSC_TEAM_ID}: ${CSC_NAME}" >&2
  echo "Install/export a matching Developer ID Application identity or set CSC_TEAM_ID/CSC_NAME explicitly." >&2
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
echo "Expected Team ID: ${EXPECTED_CSC_TEAM_ID}"
echo "API key path: ${APPLE_API_KEY}"
echo "Build number: ${SYNCFLOW_BUILD_NUMBER}"
echo "Target: ${TARGET}"
echo "Electron builder config: ${ELECTRON_BUILDER_CONFIG}"

cd "${REPO_ROOT}"

pnpm --filter @lynavo-drive/desktop build
pnpm --filter @lynavo-drive/desktop build:sidecar:mac

BUILD_ARGS=(
  "--config"
  "${ELECTRON_BUILDER_CONFIG}"
  "-c.buildVersion=${SYNCFLOW_BUILD_NUMBER}"
  "-c.extraMetadata.syncflowBuildNumber=${SYNCFLOW_BUILD_NUMBER}"
)

build_macos_arch() {
  local target="$1"
  local arch="$2"
  local arch_build_args=("${BUILD_ARGS[@]}")

  if [[ "${target}" == "dir" ]]; then
    pnpm --filter @lynavo-drive/desktop exec electron-builder --mac "${target}" "--${arch}" -c.mac.notarize=false "${arch_build_args[@]}"
  else
    arch_build_args+=("-c.dmg.title=${DMG_CREATE_VOLUME_NAME}")
    pnpm --filter @lynavo-drive/desktop exec electron-builder --mac "${target}" "--${arch}" "${arch_build_args[@]}"
  fi
}

validate_dmg_payload() {
  local arch="$1"
  local dmg_path="${REPO_ROOT}/apps/desktop/release/LynavoDrive-${DESKTOP_VERSION}-${arch}.dmg"
  local mount_dir
  local app_path
  local volume_name

  if [[ ! -f "${dmg_path}" ]]; then
    echo "Missing DMG artifact: ${dmg_path}" >&2
    return 1
  fi

  if [[ "$(stat -f%z "${dmg_path}")" -lt 100000000 ]]; then
    echo "DMG artifact is unexpectedly small: ${dmg_path}" >&2
    return 1
  fi

  mount_dir="$(mktemp -d "${TMPDIR:-/tmp}/lynavo-drive-dmg-${arch}.XXXXXX")"
  app_path="${mount_dir}/${DESKTOP_PRODUCT_NAME}.app"

  if ! hdiutil attach -quiet -nobrowse -readonly -mountpoint "${mount_dir}" "${dmg_path}"; then
    rm -rf "${mount_dir}"
    echo "Failed to mount DMG artifact: ${dmg_path}" >&2
    return 1
  fi

  volume_name="$(diskutil info "${mount_dir}" | awk -F': *' '/Volume Name/ {print $2; exit}')"
  if [[ "${volume_name}" != "${DESKTOP_PRODUCT_NAME}" ]]; then
    echo "DMG volume name is ${volume_name}, expected ${DESKTOP_PRODUCT_NAME}: ${dmg_path}" >&2
    hdiutil detach "${mount_dir}" >/dev/null || true
    rm -rf "${mount_dir}"
    return 1
  fi

  if [[ ! -d "${app_path}" ]]; then
    echo "DMG artifact does not contain ${DESKTOP_PRODUCT_NAME}.app: ${dmg_path}" >&2
    find "${mount_dir}" -maxdepth 1 -print >&2
    hdiutil detach "${mount_dir}" >/dev/null || true
    rm -rf "${mount_dir}"
    return 1
  fi

  if [[ ! -L "${mount_dir}/Applications" ]]; then
    echo "DMG artifact does not contain Applications symlink: ${dmg_path}" >&2
    find "${mount_dir}" -maxdepth 1 -print >&2
    hdiutil detach "${mount_dir}" >/dev/null || true
    rm -rf "${mount_dir}"
    return 1
  fi

  hdiutil detach "${mount_dir}" >/dev/null
  rm -rf "${mount_dir}"
  echo "Validated DMG payload: ${dmg_path}"
}

remove_stale_dmg_blockmap() {
  local arch="$1"
  local blockmap_path="${REPO_ROOT}/apps/desktop/release/LynavoDrive-${DESKTOP_VERSION}-${arch}.dmg.blockmap"

  if [[ -f "${blockmap_path}" ]]; then
    rm -f "${blockmap_path}"
    echo "Removed stale DMG blockmap after post-processing: ${blockmap_path}"
  fi
}

finalize_dmg_volume_name() (
  local arch="$1"
  local dmg_path="${REPO_ROOT}/apps/desktop/release/LynavoDrive-${DESKTOP_VERSION}-${arch}.dmg"
  local staging_dir
  local rw_dmg
  local renamed_dmg
  local mount_dir="/Volumes/${DMG_CREATE_VOLUME_NAME}"

  if [[ ! -f "${dmg_path}" ]]; then
    echo "Missing DMG artifact for volume finalization: ${dmg_path}" >&2
    exit 1
  fi

  staging_dir="$(mktemp -d "${TMPDIR:-/tmp}/lynavo-drive-dmg-finalize-${arch}.XXXXXX")"
  rw_dmg="${staging_dir}/LynavoDrive-${DESKTOP_VERSION}-${arch}.rw.dmg"
  renamed_dmg="${staging_dir}/LynavoDrive-${DESKTOP_VERSION}-${arch}.dmg"

  cleanup_finalize_dmg() {
    hdiutil detach "${mount_dir}" >/dev/null 2>&1 || true
    hdiutil detach "/Volumes/${DESKTOP_PRODUCT_NAME}" >/dev/null 2>&1 || true
    rm -rf "${staging_dir}"
  }
  trap cleanup_finalize_dmg EXIT

  hdiutil detach "/Volumes/${DMG_CREATE_VOLUME_NAME}" >/dev/null 2>&1 || true
  hdiutil detach "/Volumes/${DESKTOP_PRODUCT_NAME}" >/dev/null 2>&1 || true
  hdiutil convert "${dmg_path}" -quiet -format UDRW -o "${rw_dmg}"
  hdiutil attach -quiet -nobrowse -owners off "${rw_dmg}"
  diskutil rename "${mount_dir}" "${DESKTOP_PRODUCT_NAME}"
  hdiutil detach "/Volumes/${DESKTOP_PRODUCT_NAME}" >/dev/null
  hdiutil convert "${rw_dmg}" -quiet -format UDZO -imagekey zlib-level=9 -o "${renamed_dmg}"
  mv "${renamed_dmg}" "${dmg_path}"
)

rebuild_dmg_from_app() (
  local arch="$1"
  local release_dir="${REPO_ROOT}/apps/desktop/release"
  local app_dir="${release_dir}/mac/${DESKTOP_PRODUCT_NAME}.app"
  local dmg_path="${release_dir}/LynavoDrive-${DESKTOP_VERSION}-${arch}.dmg"
  local rw_dmg
  local staging_dir
  local mount_dir

  if [[ "${arch}" == "arm64" ]]; then
    app_dir="${release_dir}/mac-arm64/${DESKTOP_PRODUCT_NAME}.app"
  fi

  if [[ ! -d "${app_dir}" ]]; then
    echo "Missing signed app bundle for DMG rebuild: ${app_dir}" >&2
    exit 1
  fi

  staging_dir="$(mktemp -d "${TMPDIR:-/tmp}/lynavo-drive-dmg-rebuild-${arch}.XXXXXX")"
  rw_dmg="${staging_dir}/LynavoDrive-${DESKTOP_VERSION}-${arch}.rw.dmg"
  mount_dir="/Volumes/${DMG_CREATE_VOLUME_NAME}"

  cleanup_rebuild_dmg() {
    hdiutil detach "${mount_dir}" >/dev/null 2>&1 || true
    hdiutil detach "/Volumes/${DESKTOP_PRODUCT_NAME}" >/dev/null 2>&1 || true
    rm -rf "${staging_dir}"
  }
  trap cleanup_rebuild_dmg EXIT

  echo "Rebuilding DMG payload from signed app: ${dmg_path}"
  hdiutil detach "/Volumes/${DMG_CREATE_VOLUME_NAME}" >/dev/null 2>&1 || true
  hdiutil detach "/Volumes/${DESKTOP_PRODUCT_NAME}" >/dev/null 2>&1 || true

  hdiutil create -quiet -size 900m -fs HFS+ -volname "${DMG_CREATE_VOLUME_NAME}" "${rw_dmg}"
  hdiutil attach -quiet -nobrowse -owners off "${rw_dmg}"
  ditto "${app_dir}" "${mount_dir}/${DESKTOP_PRODUCT_NAME}.app"
  ln -s /Applications "${mount_dir}/Applications"
  diskutil rename "${mount_dir}" "${DESKTOP_PRODUCT_NAME}"
  hdiutil detach "/Volumes/${DESKTOP_PRODUCT_NAME}" >/dev/null
  hdiutil convert "${rw_dmg}" -quiet -format UDZO -imagekey zlib-level=9 -o "${dmg_path}"
)

for arch in x64 arm64; do
  build_macos_arch "${TARGET}" "${arch}"
  if [[ "${TARGET}" == "dmg" ]]; then
    finalize_dmg_volume_name "${arch}"
    if ! validate_dmg_payload "${arch}"; then
      rebuild_dmg_from_app "${arch}"
      validate_dmg_payload "${arch}"
    fi
    remove_stale_dmg_blockmap "${arch}"
  fi
done
