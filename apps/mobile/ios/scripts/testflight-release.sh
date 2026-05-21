#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd -- "${IOS_DIR}/../../.." && pwd)"
MODE="${1:-archive-upload}"

WORKSPACE="${IOS_DIR}/SyncFlowMobile.xcworkspace"
SCHEME="${SCHEME:-SyncFlowMobile}"
CONFIGURATION="${CONFIGURATION:-Release}"

if [[ -z "${EXPORT_OPTIONS:-}" ]]; then
  if [[ "${SCHEME}" == "SyncFlowMobileGlobal" ]]; then
    EXPORT_OPTIONS="${IOS_DIR}/ExportOptions-TestFlightGlobal.plist"
  else
    EXPORT_OPTIONS="${IOS_DIR}/ExportOptions-TestFlight.plist"
  fi
fi
ARCHIVES_DIR="${IOS_DIR}/build/archives"
EXPORT_DIR="/tmp/syncflow-export"
IOS_EXPORT_SIGNING_CERTIFICATE="${IOS_EXPORT_SIGNING_CERTIFICATE:-Apple Distribution}"

# App Store Connect API key for Shenzhen Kaiyun (GKN7JQNCMC) — altool upload path.
APPLE_API_KEY_ID="${APPLE_API_KEY_ID:-HY8CAHGPW9}"
APPLE_API_ISSUER="${APPLE_API_ISSUER:-54cad458-4184-4fc6-a1c7-cb4b0c6ded0e}"
APPLE_API_KEY="${APPLE_API_KEY:-${REPO_ROOT}/AuthKey_${APPLE_API_KEY_ID}.p8}"

PROJECT_FILE="${IOS_DIR}/SyncFlowMobile.xcodeproj/project.pbxproj"
MOBILE_CONFIG_FILE="${MOBILE_CONFIG_FILE:-${REPO_ROOT}/apps/mobile/src/services/config.ts}"
MARKETING_VERSION="$(sed -n 's/.*MARKETING_VERSION = \([^;]*\);/\1/p' "${PROJECT_FILE}" | head -n 1 | tr -d '[:space:]')"
BUILD_NUMBER="$(sed -n 's/.*CURRENT_PROJECT_VERSION = \([^;]*\);/\1/p' "${PROJECT_FILE}" | head -n 1 | tr -d '[:space:]')"

ORIGINAL_BUILD_NUMBER="${BUILD_NUMBER}"
NEED_ROLLBACK=false
ARCHIVE_PATH="${ARCHIVES_DIR}/SyncFlow-${MARKETING_VERSION}-b${BUILD_NUMBER}.xcarchive"

usage() {
  cat <<EOF
Usage:
  ${IOS_DIR}/scripts/testflight-release.sh [archive|upload|archive-upload|check-review-phone]

Modes:
  archive         Build a Release xcarchive (auto-increments build number)
  upload          Upload an existing archive at ARCHIVE_PATH to TestFlight
  archive-upload  Increment, archive, and upload to TestFlight
  check-review-phone
                  Verify mobile APP_REVIEW_PHONE matches SERVER_ENV_FILE

Note: If archive or upload fails, the build number will be rolled back automatically.
Set SERVER_ENV_FILE=/path/to/server/.env.prod before TestFlight packaging.

Defaults:
  BUILD_NUMBER=${BUILD_NUMBER}
  ARCHIVE_PATH=${ARCHIVE_PATH}
EOF
}

if [[ "${MODE}" != "archive" && "${MODE}" != "upload" && "${MODE}" != "archive-upload" && "${MODE}" != "check-review-phone" ]]; then
  usage >&2
  exit 1
fi

ensure_prereqs() {
  if [[ ! -d "${WORKSPACE}" ]]; then
    echo "Missing workspace: ${WORKSPACE}" >&2
    exit 1
  fi

  if [[ ! -f "${EXPORT_OPTIONS}" ]]; then
    echo "Missing export options: ${EXPORT_OPTIONS}" >&2
    exit 1
  fi
}

mask_phone() {
  local phone="$1"
  local len=${#phone}
  if [[ "${len}" -le 4 ]]; then
    echo "****"
    return
  fi
  echo "${phone:0:3}****${phone: -4}"
}

extract_server_review_phone() {
  local env_file="$1"
  awk '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    {
      split($0, parts, "=")
      key = parts[1]
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
      if (key == "APP_REVIEW_PHONE") {
        val = substr($0, index($0, "=") + 1)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", val)
        gsub(/^'\''|'\''$/, "", val)
        gsub(/^"|"$/, "", val)
        print val
        exit
      }
    }
  ' "${env_file}"
}

extract_mobile_review_phone() {
  local config_file="$1"
  sed -n "s/^[[:space:]]*export const APP_REVIEW_PHONE[[:space:]]*=[[:space:]]*['\"]\\([^'\"]*\\)['\"].*/\\1/p" "${config_file}" | head -n 1
}

ensure_review_phone_matches() {
  if [[ -z "${SERVER_ENV_FILE:-}" ]]; then
    echo "ERROR: SERVER_ENV_FILE is required for TestFlight review-phone check." >&2
    echo "Example: SERVER_ENV_FILE=/path/to/vivi-drop-server/.env.prod pnpm package:mobile:testflight" >&2
    exit 1
  fi

  if [[ ! -f "${SERVER_ENV_FILE}" ]]; then
    echo "ERROR: SERVER_ENV_FILE not found: ${SERVER_ENV_FILE}" >&2
    exit 1
  fi

  if [[ ! -f "${MOBILE_CONFIG_FILE}" ]]; then
    echo "ERROR: mobile config file not found: ${MOBILE_CONFIG_FILE}" >&2
    exit 1
  fi

  local server_phone mobile_phone
  server_phone="$(extract_server_review_phone "${SERVER_ENV_FILE}")"
  mobile_phone="$(extract_mobile_review_phone "${MOBILE_CONFIG_FILE}")"

  if [[ -z "${server_phone}" ]]; then
    echo "ERROR: APP_REVIEW_PHONE is missing from SERVER_ENV_FILE." >&2
    exit 1
  fi

  if [[ -z "${mobile_phone}" ]]; then
    echo "ERROR: APP_REVIEW_PHONE is missing from mobile config." >&2
    exit 1
  fi

  if [[ "${server_phone}" != "${mobile_phone}" ]]; then
    echo "ERROR: APP_REVIEW_PHONE mismatch." >&2
    echo "Server: $(mask_phone "${server_phone}")" >&2
    echo "Mobile: $(mask_phone "${mobile_phone}")" >&2
    exit 1
  fi

  echo "Review phone check passed: $(mask_phone "${mobile_phone}")"
}

increment_build_number() {
  local NEW_BUILD_NUMBER=$((ORIGINAL_BUILD_NUMBER + 1))
  echo "Incrementing build number: ${ORIGINAL_BUILD_NUMBER} -> ${NEW_BUILD_NUMBER}"
  
  # Use -i '' for macOS compatibility
  sed -i '' "s/CURRENT_PROJECT_VERSION = ${ORIGINAL_BUILD_NUMBER};/CURRENT_PROJECT_VERSION = ${NEW_BUILD_NUMBER};/g" "${PROJECT_FILE}"
  
  BUILD_NUMBER="${NEW_BUILD_NUMBER}"
  # Update archive path to use the new build number
  ARCHIVE_PATH="${ARCHIVES_DIR}/SyncFlow-${MARKETING_VERSION}-b${BUILD_NUMBER}.xcarchive"
  NEED_ROLLBACK=true
}

rollback_build_number() {
  if [[ "${NEED_ROLLBACK}" == "true" ]]; then
    echo "Rolling back build number: ${BUILD_NUMBER} -> ${ORIGINAL_BUILD_NUMBER}"
    sed -i '' "s/CURRENT_PROJECT_VERSION = ${BUILD_NUMBER};/CURRENT_PROJECT_VERSION = ${ORIGINAL_BUILD_NUMBER};/g" "${PROJECT_FILE}"
    NEED_ROLLBACK=false
  fi
}

cleanup() {
  local EXIT_CODE=$?
  if [[ ${EXIT_CODE} -ne 0 && "${NEED_ROLLBACK}" == "true" ]]; then
    echo "Error detected (exit code: ${EXIT_CODE}). Triggering rollback..."
    rollback_build_number
  fi
}

# Register rollback on crash or failure
trap cleanup EXIT

archive_build() {
  increment_build_number
  
  mkdir -p "${ARCHIVES_DIR}"
  rm -rf "${ARCHIVE_PATH}"

  echo "Archiving ${SCHEME} ${MARKETING_VERSION} (${BUILD_NUMBER})"
  echo "Archive path: ${ARCHIVE_PATH}"

  xcodebuild \
    -workspace "${WORKSPACE}" \
    -scheme "${SCHEME}" \
    -configuration "${CONFIGURATION}" \
    -destination "generic/platform=iOS" \
    -archivePath "${ARCHIVE_PATH}" \
    -allowProvisioningUpdates \
    archive
}

verify_export_signing() {
  local summary="${EXPORT_DIR}/DistributionSummary.plist"
  if [[ ! -f "${summary}" ]]; then
    echo "Distribution summary not found: ${summary}" >&2
    exit 1
  fi

  local cert_type
  cert_type="$(/usr/libexec/PlistBuddy -c 'Print :SyncFlowMobile.ipa:0:certificate:type' "${summary}")"
  if [[ "${cert_type}" != "${IOS_EXPORT_SIGNING_CERTIFICATE}" ]]; then
    echo "ERROR: exported IPA signing certificate mismatch." >&2
    echo "Expected: ${IOS_EXPORT_SIGNING_CERTIFICATE}" >&2
    echo "Actual: ${cert_type}" >&2
    exit 1
  fi

  echo "Export signing certificate verified: ${cert_type}"
}

export_ipa() {
  if [[ ! -d "${ARCHIVE_PATH}" ]]; then
    echo "Archive not found: ${ARCHIVE_PATH}" >&2
    exit 1
  fi

  rm -rf "${EXPORT_DIR}"
  mkdir -p "${EXPORT_DIR}"

  echo "Exporting IPA from archive"
  echo "Archive path: ${ARCHIVE_PATH}"
  echo "Export options: ${EXPORT_OPTIONS}"

  xcodebuild \
    -exportArchive \
    -archivePath "${ARCHIVE_PATH}" \
    -exportPath "${EXPORT_DIR}" \
    -exportOptionsPlist "${EXPORT_OPTIONS}" \
    -allowProvisioningUpdates

  verify_export_signing
}

ensure_altool_key() {
  local dir="${HOME}/.appstoreconnect/private_keys"
  local target="${dir}/AuthKey_${APPLE_API_KEY_ID}.p8"
  if [[ -f "${target}" ]]; then
    return 0
  fi
  if [[ ! -f "${APPLE_API_KEY}" ]]; then
    echo "Missing API key file: ${APPLE_API_KEY}" >&2
    exit 1
  fi
  mkdir -p "${dir}"
  cp "${APPLE_API_KEY}" "${target}"
  chmod 600 "${target}"
  echo "Staged API key at ${target}"
}

upload_ipa() {
  local ipa
  ipa="$(find "${EXPORT_DIR}" -maxdepth 2 -name '*.ipa' -type f | head -n 1)"
  if [[ -z "${ipa}" ]]; then
    echo "IPA not found in ${EXPORT_DIR}" >&2
    exit 1
  fi

  ensure_altool_key

  echo "Uploading to TestFlight via altool"
  echo "IPA: ${ipa}"

  # Once altool starts transferring, a partial upload may already reach ASC.
  # Suppress automatic rollback from here on — on failure the operator must
  # verify in App Store Connect whether the build was accepted before retrying.
  NEED_ROLLBACK=false

  xcrun altool --upload-app \
    -f "${ipa}" \
    -t ios \
    --apiKey "${APPLE_API_KEY_ID}" \
    --apiIssuer "${APPLE_API_ISSUER}"
}

if [[ "${MODE}" == "check-review-phone" ]]; then
  ensure_review_phone_matches
  exit 0
fi

ensure_prereqs
ensure_review_phone_matches

case "${MODE}" in
  archive)
    archive_build
    ;;
  upload)
    export_ipa
    upload_ipa
    ;;
  archive-upload)
    archive_build
    export_ipa
    upload_ipa
    ;;
esac
