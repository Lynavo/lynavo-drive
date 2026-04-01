#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd -- "${IOS_DIR}/../../.." && pwd)"
MODE="${1:-archive-upload}"

WORKSPACE="${IOS_DIR}/SyncFlowMobile.xcworkspace"
SCHEME="SyncFlowMobile"
CONFIGURATION="Release"
EXPORT_OPTIONS="${IOS_DIR}/ExportOptions-TestFlight.plist"
ARCHIVES_DIR="${IOS_DIR}/build/archives"
EXPORT_DIR="/tmp/syncflow-export"

PROJECT_FILE="${IOS_DIR}/SyncFlowMobile.xcodeproj/project.pbxproj"
MARKETING_VERSION="$(sed -n 's/.*MARKETING_VERSION = \([^;]*\);/\1/p' "${PROJECT_FILE}" | head -n 1 | tr -d '[:space:]')"
BUILD_NUMBER="$(sed -n 's/.*CURRENT_PROJECT_VERSION = \([^;]*\);/\1/p' "${PROJECT_FILE}" | head -n 1 | tr -d '[:space:]')"

ORIGINAL_BUILD_NUMBER="${BUILD_NUMBER}"
NEED_ROLLBACK=false
ARCHIVE_PATH="${ARCHIVES_DIR}/SyncFlow-${MARKETING_VERSION}-b${BUILD_NUMBER}.xcarchive"

usage() {
  cat <<EOF
Usage:
  ${IOS_DIR}/scripts/testflight-release.sh [archive|upload|archive-upload]

Modes:
  archive         Build a Release xcarchive (auto-increments build number)
  upload          Upload an existing archive at ARCHIVE_PATH to TestFlight
  archive-upload  Increment, archive, and upload to TestFlight

Note: If archive or upload fails, the build number will be rolled back automatically.

Defaults:
  BUILD_NUMBER=${BUILD_NUMBER}
  ARCHIVE_PATH=${ARCHIVE_PATH}
EOF
}

if [[ "${MODE}" != "archive" && "${MODE}" != "upload" && "${MODE}" != "archive-upload" ]]; then
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
  if [ ${EXIT_CODE} -ne 0 ]; then
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

upload_archive() {
  if [[ ! -d "${ARCHIVE_PATH}" ]]; then
    echo "Archive not found: ${ARCHIVE_PATH}" >&2
    exit 1
  fi

  rm -rf "${EXPORT_DIR}"
  mkdir -p "${EXPORT_DIR}"

  echo "Uploading archive to TestFlight"
  echo "Archive path: ${ARCHIVE_PATH}"
  echo "Export options: ${EXPORT_OPTIONS}"

  xcodebuild \
    -exportArchive \
    -archivePath "${ARCHIVE_PATH}" \
    -exportPath "${EXPORT_DIR}" \
    -exportOptionsPlist "${EXPORT_OPTIONS}" \
    -allowProvisioningUpdates
}

ensure_prereqs

case "${MODE}" in
  archive)
    archive_build
    ;;
  upload)
    upload_archive
    ;;
  archive-upload)
    archive_build
    upload_archive
    ;;
esac
