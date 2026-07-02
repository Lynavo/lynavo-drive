# Lynavo Drive OSS Verification Matrix

This document records the long-term OSS baseline verification scope, execution
method, and acceptance criteria. It is not a product spec; actual behavior
follows the current code and `@lynavo-drive/contracts`.

## 1. Goals

The OSS baseline must continuously verify four capability groups:

1. Basic availability: discovery, pairing, scan, upload, completion.
2. Error recovery: disconnect, reconnect, resume, and continue after process
   restart.
3. OSS boundaries: guest/local foreground LAN sync is fail-open; remote access,
   official tunnel, silent background continuation, and other non-OSS
   capabilities remain off.
4. Local buildability: shared packages, sidecar, mobile typecheck, native mobile
   builds, and desktop package verification are reproducible.

## 2. Automated Verification

### 2.1 Sidecar

Command:

```bash
cd services/sidecar-go
go test ./...
```

Key cases:

| Case                   | Location                              | Coverage                                             |
| ---------------------- | ------------------------------------- | ---------------------------------------------------- |
| Default config loading | `internal/config/config_test.go`      | Default ports, directories, device name              |
| Full pairing+transfer  | `internal/server/connection_test.go`  | `HELLO -> PAIR -> SYNC -> FILE_END`                  |
| Resume after drop      | `internal/server/connection_test.go`  | Partial write, reconnect, `RESUME`, final hash       |
| Timed ACK flush        | `internal/server/connection_test.go`  | ACK still flushes on interval with no new frame      |
| Error paths            | `internal/server/connection_test.go`  | Wrong connection code, duplicate file, hash mismatch |
| FileWriter resume seek | `internal/server/file_writer_test.go` | Write pointer is correct after `.part` resume        |

### 2.2 Mobile Types And Native Builds

Commands:

```bash
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit

cd apps/mobile/ios
xcodebuild -workspace LynavoDrive.xcworkspace -scheme LynavoDrive -configuration Debug -destination 'generic/platform=iOS' build
xcodebuild -workspace LynavoDrive.xcworkspace -scheme LynavoDrive -configuration Release -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build

cd ../android
./gradlew assembleDebug
./gradlew assembleRelease
```

Acceptance criteria:

1. TypeScript passes.
2. iOS Debug build passes.
3. iOS generic Release source build passes.
4. Android Debug / Release builds pass.

### 2.3 OSS Release Gate

Command:

```bash
pnpm gate:release
```

The gate covers:

1. Version manifest consistency.
2. Source package boundaries.
3. OSS boundary scan for account, remote access, and background capability.
4. Legacy name allowlist.
5. Release/dev script tests.
6. Release profile dry-run.

Acceptance criteria:

1. Dry-run shows only local iOS / Android / desktop build/package commands.
2. Dry-run does not show API base, remote diagnostics submission endpoints,
   desktop auto-update endpoints, upload commands, or historical markets.
3. GitHub Actions `OSS Release Gate` runs only `pnpm gate:release`, not native
   builds or desktop package jobs.
4. Source package scans include no secrets, diagnostics packages, local
   databases, generated packages, or third-party proprietary binaries.

## 3. Device Script Regression

Script:

- [scripts/ios/lynavo_upload_eval.sh](../../scripts/ios/lynavo_upload_eval.sh)

Basic invocation:

```bash
bash scripts/ios/lynavo_upload_eval.sh \
  --mode <MODE> \
  --device <DEVICE_UDID> \
  --app com.lynavo.drive.mobile \
  --file-key <FILE_KEY>
```

Repeatable modes:

| Mode                     | Purpose                    | Notes                                                        |
| ------------------------ | -------------------------- | ------------------------------------------------------------ |
| `batch`                  | Standard upload regression | Single or multiple rounds; observe throughput and completion |
| `recovery-app`           | App restart recovery       | Kill app during transfer, relaunch, and check for `RESUME`   |
| `recovery-sidecar`       | Sidecar restart recovery   | Restart sidecar during transfer and check automatic resume   |
| `recovery-late-sidecar`  | Late sidecar start         | App enters backoff first; start sidecar and check recovery   |
| `recovery-sidecar-pause` | ACK black hole/link freeze | `SIGSTOP` sidecar for a period, then resume                  |
| `recovery-app-suspend`   | App suspend recovery       | Suspend app during transfer, then resume                     |
| `all`                    | Full serial run            | Run all modes above in order                                 |

Suggested minimum regression set:

1. `batch`
2. `recovery-sidecar`
3. `recovery-late-sidecar`
4. `recovery-sidecar-pause`
5. `recovery-app`

If changes touch mobile lifecycle, thermal control, or platform-native transfer,
also run `recovery-app-suspend` and matching manual regression.

## 4. Manual Smoke Checklist

### 4.1 First Install And Pairing

1. Start desktop (macOS / Windows local package or development mode) and
   sidecar.
2. Install the mobile app (iOS / Android).
3. Mobile can discover the desktop.
4. Pairing succeeds.
5. Home and settings pages show connected or reachable state.

### 4.2 Basic Upload

1. Trigger one real media sync round.
2. Home progress, speed, and queue items update normally.
3. The sidecar receives and writes files.
4. Home enters completed state after completion.
5. History is bucketed by sidecar / desktop completion day.

### 4.3 Error Recovery

1. Turn off Wi-Fi or block the sidecar during transfer.
2. Home shows reconnecting or waiting-for-network semantics.
3. After restoring network or sidecar, upload automatically `RESUME`s.
4. It does not retransmit from 0.
5. The pending queue is not cleared, reordered, or skipped.

### 4.4 Foreground LAN And Lifecycle Compensation

The OSS baseline only promises foreground LAN automatic sync. Backgrounding,
locking, or system suspension may pause safely; after foreground return, sync
should continue through the pending queue.

1. Background or lock during transfer.
2. Observe the current file safely pause or enter a recoverable state.
3. After foreground return, continue scanning the pending queue.
4. Completed files are not rewritten badly; unfinished files continue with
   `RESUME`.
5. Official silent background continuation or remote tunnel paths are not
   enabled.

### 4.5 Guest Local LAN Mode

1. Mobile is not signed in, has no subscription, and has no server entitlement.
2. Desktop and mobile are on the same LAN.
3. Mobile can discover desktop, complete pairing, and trigger foreground
   automatic sync.
4. The upload set comes from the mobile local pending queue.
5. The UI does not provide manual file checkboxes, skip, or delete queue actions
   as alternate paths.
6. After network recovery, upload continues with `RESUME` and does not clear sync
   identity or pending queue because of guest state.

### 4.6 Non-OSS Capability Boundaries

This section is a negative boundary sanity check, not positive feature
acceptance.

1. OSS runtime does not request official tunnel credentials.
2. OSS runtime does not show an official tunnel activation entry and does not
   send credentials to the sidecar.
3. Without official platform capability, silent background continuation entry
   points remain off.
4. Foreground LAN sync remains available and compensates through the pending
   queue after foreground return.

### 4.7 Windows Desktop

1. Fresh install from a local Windows package.
2. Confirm `Lynavo Drive Sidecar TCP`, `Lynavo Drive Sidecar HTTP`, and
   `Lynavo Drive mDNS UDP` firewall rules exist and cover `39393/TCP`,
   `39394/TCP`, and `5353/UDP`.
3. The settings page shows Bonjour available state or zeroconf-compatible
   fallback state.
4. Mobile can discover and pair.
5. Trigger one real media sync round.

### 4.8 Linux Package Verification

Linux is not a current user support platform. The OSS baseline keeps only local
source-build / package verification; device pairing is maintainer experimental
and not a default acceptance gate.

Local package verification:

1. Run `pnpm package:desktop:linux` on a Linux host.
2. Confirm a `.deb` artifact is generated.
3. Fresh install and launch the app.
4. Confirm sidecar health becomes healthy.
5. Confirm `39393/TCP` and `39394/TCP` are listening, and the `5353/UDP`
   discovery path works according to current implementation.

Maintainer experimental:

1. Maintainers may verify iOS / Android discovery, pairing, and upload with
   Linux desktop in records clearly marked experimental.
2. Failure does not block macOS / Windows desktop OSS baseline acceptance.
3. Do not document Linux device pairing as a user support promise.

### 4.9 iOS Thermal

If changes touch iOS thermal control or upload tuning, add these manual checks:

1. Use a long video or large file to trigger sustained upload.
2. Create a high-thermal scenario and confirm sync does not interrupt but slows
   down.
3. Under serious / critical thermal state, logs show `THERMAL_THROTTLE`,
   `THERMAL_PAUSE`, or `THERMAL_RESUME`.
4. After thermal recovery, the pending queue continues and is not reported as
   final failure.
5. Newly captured assets are discovered and queued after returning to a
   scannable state.

### 4.10 Same-LAN Wake-on-LAN

This section verifies same-LAN wake only. VPN is only a fallback scenario, not
the main flow. OSS builds do not provide public Wake-on-WAN, router helpers, or
relay wake.

Prerequisites:

1. Mobile and desktop are paired, and while desktop was awake the sidecar sent
   wake metadata.
2. Mobile and desktop are on the same LAN.
3. macOS has `Wake for network access` enabled, or Windows has BIOS/UEFI WoL and
   NIC magic packet wake enabled.

Acceptance criteria:

1. Bounded LAN wake may be attempted only when opening the `My Computer` root
   directory or clicking `Reconnect`.
2. App launch, foreground return, or simply showing offline must not send a wake
   packet.
3. On success, `/health` recovers and connection state returns to reachable.
4. On failure, show unavailable / offline / backoff and do not modify the pending
   queue.
5. Without VPN-LAN fallback on an external network, do not describe this
   capability as public Wake-on-WAN.

## 5. Long-Term Acceptance Gates

Regular changes must at least satisfy:

1. Relevant unit tests or script tests pass.
2. `pnpm gate:release` passes.
3. Run `go test ./...` when touching sidecar.
4. Run TypeScript checks and relevant platform builds when touching mobile.
5. Run target platform package verification when touching desktop packaging.
6. Complete at least one device or script regression round when touching sync
   state, queue, or recovery paths.

Platform additions:

1. Windows packaging changes require at least fresh install plus pairing/upload
   smoke test.
2. Linux only requires local package verification; device pairing is maintainer
   experimental.
3. iOS thermal or lifecycle changes require additional thermal and
   foreground/background compensation verification.
4. Wake-on-LAN changes must confirm same-LAN wake is explicitly user-triggered
   and failures do not affect the pending queue.

## 6. Logs And Temporary Artifacts

Device scripts output by default:

1. Result CSV: `/tmp/lynavo-drive-upload-eval`
2. App / sidecar logs: `/tmp/lynavo-drive-upload-eval-logs`

These directories are temporary artifacts. Do not save them as versioned test
records or upload them to public issues without redaction.
