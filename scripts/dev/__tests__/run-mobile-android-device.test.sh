#!/usr/bin/env bash
set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_UNDER_TEST="$TEST_DIR/../run-mobile-android-device.sh"

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

mkdir -p "$tmp_dir/repo/scripts/dev" "$tmp_dir/repo/apps/mobile/android" "$tmp_dir/bin"
cp "$SCRIPT_UNDER_TEST" "$tmp_dir/repo/scripts/dev/run-mobile-android-device.sh"

cat >"$tmp_dir/bin/adb" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" == "-s" ]]; then
  device="$2"
  shift 2
  case "$1" in
    get-state)
      echo "device"
      ;;
    shell)
      if [[ "$2" == "getprop" ]]; then
        echo "PEGM10"
      else
        echo "$device $*" >>"$LYNAVO_ANDROID_TEST_ADB_LOG"
      fi
      ;;
    reverse)
      echo "$device reverse $2 $3" >>"$LYNAVO_ANDROID_TEST_ADB_LOG"
      ;;
    *)
      echo "unexpected adb command: $*" >&2
      exit 1
      ;;
  esac
  exit 0
fi

if [[ "$1" == "devices" ]]; then
  echo "List of devices attached"
  echo "15977ea9	device"
  exit 0
fi

echo "unexpected adb command: $*" >&2
exit 1
STUB

cat >"$tmp_dir/bin/curl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
echo "packager-status:running"
STUB

cat >"$tmp_dir/repo/apps/mobile/android/gradlew" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >"$LYNAVO_ANDROID_TEST_GRADLE_LOG"
STUB

chmod +x "$tmp_dir/bin/adb" "$tmp_dir/bin/curl" "$tmp_dir/repo/apps/mobile/android/gradlew"

export PATH="$tmp_dir/bin:$PATH"
export LYNAVO_ANDROID_DEVICE="15977ea9"
export LYNAVO_ANDROID_TEST_ADB_LOG="$tmp_dir/adb.log"
export LYNAVO_ANDROID_TEST_GRADLE_LOG="$tmp_dir/gradle.log"

bash "$tmp_dir/repo/scripts/dev/run-mobile-android-device.sh" >/dev/null

actual_gradle_args="$(cat "$LYNAVO_ANDROID_TEST_GRADLE_LOG")"
expected_gradle_args=":app:installDebug"

if [[ "$actual_gradle_args" != "$expected_gradle_args" ]]; then
  echo "Expected Gradle args: $expected_gradle_args" >&2
  echo "Actual Gradle args:   $actual_gradle_args" >&2
  exit 1
fi

actual_adb_log="$(cat "$LYNAVO_ANDROID_TEST_ADB_LOG")"
expected_launch="15977ea9 shell am start -n com.lynavo.drive.mobile.demo/com.lynavo.drive.mobile.demo.MainActivity"

if ! grep -Fq "$expected_launch" <<<"$actual_adb_log"; then
  echo "Expected adb launch: $expected_launch" >&2
  echo "Actual adb log:" >&2
  cat "$LYNAVO_ANDROID_TEST_ADB_LOG" >&2
  exit 1
fi

: >"$LYNAVO_ANDROID_TEST_ADB_LOG"
: >"$LYNAVO_ANDROID_TEST_GRADLE_LOG"
LYNAVO_ANDROID_APP_ID="com.example.override" \
  LYNAVO_ANDROID_MAIN_ACTIVITY=".MainActivity" \
  bash "$tmp_dir/repo/scripts/dev/run-mobile-android-device.sh" >/dev/null

actual_adb_log="$(cat "$LYNAVO_ANDROID_TEST_ADB_LOG")"
expected_override_launch="15977ea9 shell am start -n com.example.override/com.example.override.MainActivity"

if ! grep -Fq "$expected_override_launch" <<<"$actual_adb_log"; then
  echo "Expected override adb launch: $expected_override_launch" >&2
  echo "Actual adb log:" >&2
  cat "$LYNAVO_ANDROID_TEST_ADB_LOG" >&2
  exit 1
fi
