#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

selection="$(
  xcrun xcdevice list --timeout 5 | /usr/bin/python3 -c '
import json
import os
import sys

requested = os.environ.get("SYNCFLOW_IOS_DEVICE", "").strip()

try:
    devices = json.load(sys.stdin)
except Exception as error:
    print(f"Failed to parse iOS device list: {error}", file=sys.stderr)
    sys.exit(1)

phones = [
    device
    for device in devices
    if device
    and device.get("simulator") is False
    and device.get("available") is True
    and device.get("platform") == "com.apple.platform.iphoneos"
]

if not phones:
    print("No available physical iPhone was detected.", file=sys.stderr)
    print(
        "Unlock the phone, trust this Mac, then confirm it appears in Xcode > Window > Devices and Simulators.",
        file=sys.stderr,
    )
    sys.exit(1)

selected = None
if requested:
    for device in phones:
        label = "{} ({})".format(device.get("name"), device.get("identifier"))
        if requested in (device.get("identifier"), device.get("name"), label):
            selected = device
            break
else:
    selected = phones[0]

if selected is None:
    print("Could not find requested iPhone: {}".format(requested), file=sys.stderr)
    print("Available physical iPhones:", file=sys.stderr)
    for device in phones:
        print("- {} ({})".format(device.get("name"), device.get("identifier")), file=sys.stderr)
    sys.exit(1)

if len(phones) > 1 and not requested:
    print(
        "Multiple physical iPhones are available; using {} ({}).".format(
            selected.get("name"), selected.get("identifier")
        ),
        file=sys.stderr,
    )
    print("Set SYNCFLOW_IOS_DEVICE to a device name or UDID to choose another one.", file=sys.stderr)

print("{}\t{}".format(selected.get("identifier"), selected.get("name")))
'
)"

device_id="${selection%%	*}"
device_name="${selection#*	}"

echo "Launching LynavoDrive on ${device_name} (${device_id})..."

if [[ "${SYNCFLOW_IOS_PRINT_DEVICE_ONLY:-}" == "1" ]]; then
  exit 0
fi

cd "${ROOT}"

unset NODE_OPTIONS
unset VSCODE_INSPECTOR_OPTIONS
unset VSCODE_JS_DEBUG_BOOTLOADER
unset VSCODE_DEBUGGING

exec corepack pnpm --filter @lynavo-drive/mobile exec react-native run-ios \
  --device "${device_id}" \
  --scheme "LynavoDrive" \
  --mode "Debug" \
  --no-packager \
  "$@"
