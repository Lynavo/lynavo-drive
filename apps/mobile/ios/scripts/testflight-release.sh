#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd -- "${IOS_DIR}/../../.." && pwd)"
MODE="${1:-archive-upload}"
if [[ $# -gt 1 ]]; then
  echo "Ignoring deprecated iOS profile argument: $2" >&2
fi

WORKSPACE="${IOS_DIR}/LynavoDrive.xcworkspace"
SCHEME="${SCHEME:-LynavoDrive}"
CONFIGURATION="${CONFIGURATION:-Release}"
APPLE_API_KEY_ID="${APPLE_API_KEY_ID:-AMY9XVV3LD}"
APPLE_API_ISSUER="${APPLE_API_ISSUER:-8de17ec0-4bff-4ab2-8c01-ace1f9307147}"
EXPORT_OPTIONS="${EXPORT_OPTIONS:-${IOS_DIR}/ExportOptions-TestFlight.plist}"
ARCHIVES_DIR="${IOS_DIR}/build/archives"
EXPORT_DIR="/tmp/syncflow-export"
IOS_EXPORT_SIGNING_CERTIFICATE="${IOS_EXPORT_SIGNING_CERTIFICATE:-Apple Distribution}"

# Resolve App Store Connect API Key path
if [[ -z "${APPLE_API_KEY:-}" ]]; then
  APPLE_API_KEY="${REPO_ROOT}/AuthKey_${APPLE_API_KEY_ID}.p8"
fi

PROJECT_FILE="${IOS_DIR}/LynavoDrive.xcodeproj/project.pbxproj"
MOBILE_CONFIG_FILE="${MOBILE_CONFIG_FILE:-${REPO_ROOT}/apps/mobile/src/config/app-config.ts}"
CONTRACTS_ENDPOINTS_FILE="${CONTRACTS_ENDPOINTS_FILE:-${REPO_ROOT}/packages/contracts/src/service-endpoints.ts}"
MARKETING_VERSION="$(sed -n 's/.*MARKETING_VERSION = \([^;]*\);/\1/p' "${PROJECT_FILE}" | head -n 1 | tr -d '[:space:]')"
BUILD_NUMBER="$(sed -n 's/.*CURRENT_PROJECT_VERSION = \([^;]*\);/\1/p' "${PROJECT_FILE}" | head -n 1 | tr -d '[:space:]')"

ORIGINAL_BUILD_NUMBER="${BUILD_NUMBER}"
NEED_ROLLBACK=false
ARCHIVE_PATH="${ARCHIVES_DIR}/SyncFlow-${MARKETING_VERSION}-b${BUILD_NUMBER}.xcarchive"

usage() {
  cat <<EOF
Usage:
  ${IOS_DIR}/scripts/testflight-release.sh [mode]

Modes:
  archive         Build a Release xcarchive (auto-increments build number)
  upload          Upload an existing archive at ARCHIVE_PATH to TestFlight
  archive-upload  Increment, archive, and upload to TestFlight
  check-review-phone
                  Verify mobile APP_REVIEW_PHONE/APP_REVIEW_EMAIL matches SERVER_ENV_FILE

Note: If archive or upload fails, the build number will be rolled back automatically.
Set SERVER_ENV_FILE=/path/to/server/.env.prod before TestFlight packaging.

Defaults:
  SCHEME=${SCHEME}
  CONFIGURATION=${CONFIGURATION}
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

  ensure_altool_key
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
  local raw_val
  raw_val="$(sed -n "s/^[[:space:]]*export const APP_REVIEW_PHONE[[:space:]]*=[[:space:]]*['\"]\\([^'\"]*\\)['\"].*/\\1/p" "${config_file}" | head -n 1)"

  if [[ -z "${raw_val}" ]]; then
    raw_val="$(sed -n "s/^[[:space:]]*phone[[:space:]]*:[[:space:]]*['\"]\\([^'\"]*\\)['\"].*/\\1/p" "${config_file}" | head -n 1)"
  fi
  echo "${raw_val}"
}

extract_contract_review_email() {
  local endpoints_file="$1"
  local raw_val
  raw_val="$(sed -n "s/^[[:space:]]*export const LYNAVO_REVIEW_EMAIL[[:space:]]*=[[:space:]]*['\"]\\([^'\"]*\\)['\"].*/\\1/p" "${endpoints_file}" | head -n 1)"

  if [[ -z "${raw_val}" ]]; then
    local root_domain
    root_domain="$(sed -n "s/^[[:space:]]*export const LYNAVO_ROOT_DOMAIN[[:space:]]*=[[:space:]]*['\"]\\([^'\"]*\\)['\"].*/\\1/p" "${endpoints_file}" | head -n 1)"
    if [[ -n "${root_domain}" ]]; then
      raw_val="review@${root_domain}"
    fi
  fi

  echo "${raw_val}"
}

extract_server_review_email() {
  local env_file="$1"
  awk '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    {
      split($0, parts, "=")
      key = parts[1]
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
      if (key == "APP_REVIEW_EMAIL") {
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

extract_mobile_review_email() {
  local config_file="$1"
  local raw_val
  raw_val="$(sed -n "s/^[[:space:]]*export const APP_REVIEW_EMAIL[[:space:]]*=[[:space:]]*['\"]\\([^'\"]*\\)['\"].*/\\1/p" "${config_file}" | head -n 1)"

  if [[ -z "${raw_val}" ]]; then
    raw_val="$(sed -n "s/^[[:space:]]*email[[:space:]]*:[[:space:]]*['\"]\\([^'\"]*\\)['\"].*/\\1/p" "${config_file}" | head -n 1)"
  fi
  if [[ -z "${raw_val}" && -f "${CONTRACTS_ENDPOINTS_FILE}" ]] && grep -Eq 'LYNAVO_ENDPOINTS\.reviewEmail|LYNAVO_REVIEW_EMAIL' "${config_file}"; then
    raw_val="$(extract_contract_review_email "${CONTRACTS_ENDPOINTS_FILE}")"
  fi
  echo "${raw_val}"
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

  local server_email mobile_email
  server_email="$(extract_server_review_email "${SERVER_ENV_FILE}")"
  mobile_email="$(extract_mobile_review_email "${MOBILE_CONFIG_FILE}")"

  if [[ -z "${server_phone}" && -z "${server_email}" ]]; then
    echo "ERROR: Both APP_REVIEW_PHONE and APP_REVIEW_EMAIL are missing from SERVER_ENV_FILE." >&2
    exit 1
  fi

  # Verify phone if it is configured
  if [[ -n "${server_phone}" || -n "${mobile_phone}" ]]; then
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
  fi

  # Verify email if it is configured
  if [[ -n "${server_email}" || -n "${mobile_email}" ]]; then
    if [[ -z "${server_email}" ]]; then
      echo "ERROR: APP_REVIEW_EMAIL is missing from SERVER_ENV_FILE." >&2
      exit 1
    fi
    if [[ -z "${mobile_email}" ]]; then
      echo "ERROR: APP_REVIEW_EMAIL is missing from mobile config." >&2
      exit 1
    fi
    if [[ "${server_email}" != "${mobile_email}" ]]; then
      echo "ERROR: APP_REVIEW_EMAIL mismatch." >&2
      echo "Server: ${server_email}" >&2
      echo "Mobile: ${mobile_email}" >&2
      exit 1
    fi
    echo "Review email check passed: ${mobile_email}"
  fi
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
    -authenticationKeyPath "${APPLE_API_KEY}" \
    -authenticationKeyID "${APPLE_API_KEY_ID}" \
    -authenticationKeyIssuerID "${APPLE_API_ISSUER}" \
    archive
}

verify_export_signing() {
  local summary="${EXPORT_DIR}/DistributionSummary.plist"
  if [[ ! -f "${summary}" ]]; then
    echo "Distribution summary not found: ${summary}" >&2
    exit 1
  fi

  local ipa_key
  ipa_key="$(/usr/libexec/PlistBuddy -c "Print" "${summary}" | grep " = Array" | head -n 1 | sed 's/^[[:space:]]*//;s/[[:space:]]*=.*//')"
  if [[ -z "${ipa_key}" ]]; then
    echo "ERROR: Could not resolve IPA key from DistributionSummary.plist" >&2
    exit 1
  fi

  local cert_type
  cert_type="$(/usr/libexec/PlistBuddy -c "Print :\"${ipa_key}\":0:certificate:type" "${summary}")"
  if [[ "${cert_type}" != "${IOS_EXPORT_SIGNING_CERTIFICATE}" && ! ("${cert_type}" == "Cloud Managed Apple Distribution" && "${IOS_EXPORT_SIGNING_CERTIFICATE}" == "Apple Distribution") ]]; then
    echo "ERROR: exported IPA signing certificate mismatch." >&2
    echo "Expected: ${IOS_EXPORT_SIGNING_CERTIFICATE}" >&2
    echo "Actual: ${cert_type}" >&2
    exit 1
  fi

  echo "Export signing certificate verified: ${cert_type} (for ${ipa_key})"
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
    -allowProvisioningUpdates \
    -authenticationKeyPath "${APPLE_API_KEY}" \
    -authenticationKeyID "${APPLE_API_KEY_ID}" \
    -authenticationKeyIssuerID "${APPLE_API_ISSUER}"

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
