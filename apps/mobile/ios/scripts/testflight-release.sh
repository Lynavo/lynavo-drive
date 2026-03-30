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
EXPORT_DIR="${IOS_DIR}/build/testflight-export"

MARKETING_VERSION="$(sed -n 's/.*MARKETING_VERSION = \([^;]*\);/\1/p' "${IOS_DIR}/SyncFlowMobile.xcodeproj/project.pbxproj" | head -n 1)"
BUILD_NUMBER="$(sed -n 's/.*CURRENT_PROJECT_VERSION = \([^;]*\);/\1/p' "${IOS_DIR}/SyncFlowMobile.xcodeproj/project.pbxproj" | head -n 1)"
ARCHIVE_PATH="${ARCHIVE_PATH:-${ARCHIVES_DIR}/SyncFlow-${MARKETING_VERSION}-b${BUILD_NUMBER}.xcarchive}"

usage() {
  cat <<EOF
Usage:
  ${IOS_DIR}/scripts/testflight-release.sh [archive|upload|archive-upload]

Modes:
  archive         Build a Release xcarchive only
  upload          Upload an existing archive at ARCHIVE_PATH to TestFlight
  archive-upload  Archive first, then upload to TestFlight

Defaults:
  ARCHIVE_PATH=${ARCHIVE_PATH}
  EXPORT_OPTIONS=${EXPORT_OPTIONS}

Overrides:
  ARCHIVE_PATH=/absolute/path/to/SyncFlow.xcarchive
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

archive_build() {
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
    -exportOptionsPlist "${EXPORT_OPTIONS}"
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
