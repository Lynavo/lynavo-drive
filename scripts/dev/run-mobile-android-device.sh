#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ANDROID_DIR="$ROOT_DIR/apps/mobile/android"
METRO_PORT="${METRO_PORT:-${RCT_METRO_PORT:-8081}}"
APP_ID="${SYNCFLOW_ANDROID_APP_ID:-com.vividrop.mobile.china}"
MAIN_ACTIVITY="${SYNCFLOW_ANDROID_MAIN_ACTIVITY:-.MainActivity}"

unset NODE_OPTIONS
unset VSCODE_INSPECTOR_OPTIONS
unset VSCODE_JS_DEBUG_BOOTLOADER
unset VSCODE_DEBUGGING

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

trim_carriage_return() {
  tr -d '\r'
}

require_command adb
require_command curl

metro_status="$(curl -fsS --max-time 2 "http://127.0.0.1:$METRO_PORT/status" 2>/dev/null || true)"
if [[ "$metro_status" != "packager-status:running" ]]; then
  echo "Metro is not running on port $METRO_PORT."
  echo "Start Metro with the VS Code 'Mobile: Metro (macOS)' launch target or run:"
  echo "  corepack pnpm --filter @syncflow/mobile start"
  exit 1
fi

selected_device="${SYNCFLOW_ANDROID_DEVICE:-${ANDROID_SERIAL:-}}"
if [[ -n "$selected_device" ]]; then
  if [[ "$(adb -s "$selected_device" get-state 2>/dev/null || true)" != "device" ]]; then
    echo "Android device is not available: $selected_device" >&2
    adb devices -l
    exit 1
  fi
else
  devices=()
  while read -r serial state _; do
    if [[ "$state" == "device" ]]; then
      devices+=("$serial")
    fi
  done < <(adb devices | tail -n +2)

  if [[ "${#devices[@]}" -eq 0 ]]; then
    echo "No Android device is connected." >&2
    adb devices -l
    exit 1
  fi

  selected_device="${devices[0]}"
  if [[ "${#devices[@]}" -gt 1 ]]; then
    echo "Multiple Android devices are connected; using $selected_device."
    echo "Set SYNCFLOW_ANDROID_DEVICE to choose a different device."
  fi
fi

device_model="$(adb -s "$selected_device" shell getprop ro.product.model 2>/dev/null | trim_carriage_return || true)"
if [[ -z "$device_model" ]]; then
  device_model="$selected_device"
fi

if [[ "${SYNCFLOW_ANDROID_PRINT_DEVICE_ONLY:-}" == "1" ]]; then
  echo "$selected_device"
  exit 0
fi

echo "Installing SyncFlowMobile Android debug build on $device_model ($selected_device)..."
(
  cd "$ANDROID_DIR"
  ANDROID_SERIAL="$selected_device" ./gradlew :app:installDebug
)

echo "Configuring Metro reverse port $METRO_PORT..."
if ! adb -s "$selected_device" reverse "tcp:$METRO_PORT" "tcp:$METRO_PORT"; then
  echo "Warning: adb reverse failed. The app may not reach Metro over USB." >&2
fi

echo "Launching SyncFlowMobile Android on $device_model ($selected_device)..."
adb -s "$selected_device" shell am start -n "$APP_ID/$MAIN_ACTIVITY"
