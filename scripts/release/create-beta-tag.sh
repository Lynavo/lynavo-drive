#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
WORKSPACE="$ROOT_DIR/apps/mobile/ios/SyncFlowMobile.xcworkspace"
SCHEME="SyncFlowMobile"

if [[ ! -d "$ROOT_DIR/.git" && ! -f "$ROOT_DIR/.git" ]]; then
  echo "Not in git repository root: $ROOT_DIR" >&2
  exit 1
fi

pushd "$ROOT_DIR" >/dev/null

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree is dirty. Commit or stash before tagging." >&2
  exit 1
fi

BUILD_SETTINGS="$(xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -showBuildSettings 2>/dev/null)"
MARKETING_VERSION="$(printf '%s\n' "$BUILD_SETTINGS" | awk -F' = ' '/MARKETING_VERSION/ {print $2; exit}')"
BUILD_NUMBER="$(printf '%s\n' "$BUILD_SETTINGS" | awk -F' = ' '/CURRENT_PROJECT_VERSION/ {print $2; exit}')"

if [[ -z "$MARKETING_VERSION" || -z "$BUILD_NUMBER" ]]; then
  echo "Failed to resolve MARKETING_VERSION/CURRENT_PROJECT_VERSION from Xcode build settings." >&2
  exit 1
fi

DEFAULT_TAG="beta/v${MARKETING_VERSION}-b${BUILD_NUMBER}"
TAG_NAME="$DEFAULT_TAG"
PUSH_TAG="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)
      PUSH_TAG="true"
      shift
      ;;
    *)
      TAG_NAME="$1"
      shift
      ;;
  esac
done

if git rev-parse -q --verify "refs/tags/$TAG_NAME" >/dev/null; then
  echo "Tag already exists: $TAG_NAME" >&2
  exit 1
fi

git tag -a "$TAG_NAME" -m "SyncFlow beta ${MARKETING_VERSION} (${BUILD_NUMBER})"
echo "Created tag: $TAG_NAME"

if [[ "$PUSH_TAG" == "true" ]]; then
  git push origin "$TAG_NAME"
  echo "Pushed tag: $TAG_NAME"
fi

popd >/dev/null
