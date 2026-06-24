#!/bin/bash
set -euo pipefail

# Find workspace root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Workspace Root: $WORKSPACE_ROOT"
cd "$WORKSPACE_ROOT/services/sidecar-go"

# Ensure output directory for iOS exists
mkdir -p "$WORKSPACE_ROOT/apps/mobile/ios/Frameworks"

# Ensure output directory for Android exists
mkdir -p "$WORKSPACE_ROOT/apps/mobile/android/app/libs"

echo "Building iOS framework using gomobile bind..."
gomobile bind -ldflags="-checklinkname=0" -target ios -o "$WORKSPACE_ROOT/apps/mobile/ios/Frameworks/SyncFlowMobileTunnel.xcframework" ./mobiletunnel

echo "Building Android AAR using gomobile bind..."
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"
ANDROID_NDK_HOME="${ANDROID_NDK_HOME:-$ANDROID_SDK_ROOT/ndk/28.2.13676358}"
export ANDROID_HOME="$ANDROID_SDK_ROOT"
export ANDROID_NDK_HOME

gomobile bind \
  -androidapi 21 \
  -ldflags="-checklinkname=0 -extldflags=-Wl,-z,max-page-size=16384 -extldflags=-Wl,-z,common-page-size=16384" \
  -target android/arm64,android/amd64 \
  -o "$WORKSPACE_ROOT/apps/mobile/android/app/libs/SyncFlowMobileTunnel.aar" \
  ./mobiletunnel

echo "Gomobile builds completed successfully!"
