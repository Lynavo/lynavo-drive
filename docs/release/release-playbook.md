# Lynavo Drive OSS Build Playbook

This repository is the global-only open-source baseline. The release playbook
documents local source-build and package verification only.

## Release Gate

Run from the repository root:

```bash
pnpm gate:release
```

The gate checks:

1. version manifest consistency
2. OSS source-package boundaries for tracked and non-ignored untracked worktree files
3. release/dev script tests
4. release profile dry-runs

## Local Prerequisites

1. Node.js >= 22.12.0
2. pnpm >= 10
3. Go >= 1.25.6
4. Xcode + CocoaPods for iOS builds on macOS
5. Android Studio + Android SDK / NDK for Android builds

Install dependencies and build shared packages:

```bash
pnpm install
pnpm build
```

Never commit `.env` files, API/private keys, certificate exports, keystores,
diagnostic archives, local databases, logs, or generated release artifacts.

## Repository Hygiene

Public changes should be reviewable from source without local secrets,
proprietary binaries, diagnostic archives, local databases, or generated build
outputs. If a contributor accidentally adds sensitive material, remove it from
the change before review and use the private vulnerability reporting path in
`SECURITY.md`.

## Local Native Builds

```bash
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
pnpm build:mobile
pnpm build:mobile:ios:release
pnpm build:mobile:android
cd services/sidecar-go && go test ./...
cd services/sidecar-go && go build -o /tmp/lynavo-drive-sidecar ./cmd/lynavo-drive-sidecar
```

`build:mobile:ios:release` is a generic iOS device build with
`CODE_SIGNING_ALLOWED=NO`. `build:mobile:android` is an Android Debug build
(`assembleDebug`) for local smoke verification; it is not the Android Release
source-build check.

For Android Release source-build verification, use the release profile from the
repository root:

```bash
pnpm release --profile review --targets android --dry-run
pnpm release --profile review --targets android
```

Or run the underlying Gradle command directly from the repository root:

```bash
cd apps/mobile/android && ./gradlew assembleRelease bundleRelease -PreactNativeArchitectures=arm64-v8a,x86_64
```

## Release Profile Commands

Use dry-run first:

```bash
pnpm release --profile review --targets ios,android,mac,win,linux --dry-run
```

Release profiles are build-channel selectors for local verification only:

1. `review` sets `LYNAVO_RELEASE_CHANNEL=review`.
2. Other configured local profiles follow the same source-build-only rules.
3. Profiles do not inject support, update, diagnostics, auth, server-side
   capability, signing, upload, or external service environment variables.
4. Profiles resolve to local build/package commands only.

Target commands:

- `ios`: `pnpm --filter @lynavo-drive/mobile build:ios:release`
- `android`: `cd apps/mobile/android && ./gradlew assembleRelease bundleRelease -PreactNativeArchitectures=arm64-v8a,x86_64`
- `mac`: `pnpm package:desktop`
- `win`: `pnpm --filter @lynavo-drive/desktop package:win`
- `linux`: `pnpm --filter @lynavo-drive/desktop package:linux`

Target rules:

1. `ios` is a generic Release build with `CODE_SIGNING_ALLOWED=NO`.
2. `android` is a Gradle `assembleRelease bundleRelease` source build.
3. `mac` is a local macOS DMG package.
4. `win` is a local Windows NSIS/ZIP package.
5. `linux` is a host-arch local `.deb` package and must run on Linux hosts.

## Desktop Packages

macOS:

```bash
pnpm package:desktop
```

Expected local artifacts:

- `apps/desktop/release/LynavoDrive-<version>-arm64.dmg`
- `apps/desktop/release/LynavoDrive-<version>-x64.dmg`
- `apps/desktop/release/mac*/Lynavo Drive.app`

Minimum local checks:

```bash
hdiutil verify apps/desktop/release/LynavoDrive-<version>-arm64.dmg
hdiutil verify apps/desktop/release/LynavoDrive-<version>-x64.dmg
file apps/desktop/release/mac*/Lynavo\ Drive.app/Contents/Resources/lynavo-drive-sidecar
```

OSS desktop packages are local build artifacts only. The builder wrapper
disables local code-signing identity discovery, and Windows packaging excludes
`.exe` signing so contributor machines do not accidentally inject private
certificates into release rehearsal outputs.

Windows:

```bash
pnpm package:desktop:win
```

Expected local artifacts:

- `apps/desktop/release/LynavoDrive-<version>-x64.exe`
- `apps/desktop/release/LynavoDrive-<version>-x64.zip`

Minimum local checks:

1. `apps/desktop/release/win-unpacked/resources\lynavo-drive-sidecar.exe`
   exists in the unpacked app.
2. The installer writes `Lynavo Drive Sidecar TCP`,
   `Lynavo Drive Sidecar HTTP`, and `Lynavo Drive mDNS UDP` firewall rules
   for ports `39393/TCP`, `39394/TCP`, and `5353/UDP`.

The OSS source package does not redistribute Apple Bonjour runtime binaries.
Windows builds may include `dns-sd.exe` and `dnssd.dll` only when those files are
available from the user's local Bonjour installation or another locally
permitted source configured through `apps/desktop/resources-vendor/bonjour/` or
`LYNAVO_BONJOUR_DIR`. Without those files, the sidecar uses its built-in
zeroconf-compatible broadcaster.

Do not commit Apple Bonjour binaries to the source repository. If an official
Windows package later bundles them, first confirm redistribution rights, record
the source URL, version, and hashes, and add the required third-party notice.

Linux must run on a Linux host:

```bash
pnpm package:desktop:linux
```

The wrapper builds one Linux architecture per invocation: the host architecture
by default, or an explicit architecture when called through the desktop package
script:

```bash
pnpm --filter @lynavo-drive/desktop package:linux -- --arch=x64
pnpm --filter @lynavo-drive/desktop package:linux -- --arch=arm64
```

Expected local artifact for the selected architecture:

- `--arch=x64`: `apps/desktop/release/LynavoDrive-<version>-linux-x64.deb`
- `--arch=arm64`: `apps/desktop/release/LynavoDrive-<version>-linux-arm64.deb`

## Android Release Variant

The Android release variant is kept as a source-build target. It does not define
repository-owned keystore inputs or shared signing material.

## Debug Flags

Sidecar:

- `LYNAVO_UPLOAD_PERF_LOG=1`

Mobile debug-only behaviors include upload parameter overrides, force host /
force port, perf logging, and manual stress switches. They must remain
debug-only and must not become product paths.

## Source Package Rehearsal

A real source package rehearsal should run after the cleanup commits are in the
Git tree. First audit `HEAD`, then archive that same tree, extract it outside
the repository, install dependencies, and run the release gate:

```bash
pnpm verify:oss-source-package:head
git archive --format=tar --output /tmp/lynavo-drive-oss-source.tar HEAD
mkdir -p /tmp/lynavo-drive-oss-source
tar -xf /tmp/lynavo-drive-oss-source.tar -C /tmp/lynavo-drive-oss-source
cd /tmp/lynavo-drive-oss-source
pnpm install --frozen-lockfile
pnpm gate:release
```

`scripts/verify-oss-source-package.mjs` uses `git ls-files` in a normal clone
and automatically falls back to a filesystem walk when the extracted rehearsal
directory has no `.git` metadata. The fallback ignores `node_modules` so the
gate can run after dependency installation.

Do not use `git archive HEAD` as evidence for uncommitted cleanup work. If a
file was deleted locally but the deletion has not been committed, it still
exists in `HEAD` and will be included in that archive.
