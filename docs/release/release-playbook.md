# Lynavo Drive OSS Build Playbook

This repository is the global-only open-source baseline. The release playbook
documents contributor-local verification and approved GitHub-hosted,
secret-free, unsigned source-build/package verification. Hosted outputs are
verification artifacts, not official signed distributions.

Third-party or external build services, code signing, notarization, store
upload, auto-update, and private distribution infrastructure remain
unavailable. Linux remains local build/package verification only.

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

GitHub-hosted Actions may invoke the same public source-build commands with no
repository secrets to produce unsigned verification artifacts. This does not
turn release profiles into hosted signing, upload, or distribution profiles.

## Hosted Native Verification

The `Native Builds` workflow provides secret-free GitHub-hosted verification
for the current iOS, Android, macOS, and Windows build surfaces. Pull requests
select only affected mobile or desktop jobs. Pushes to `main`, manual
dispatches, and reusable workflow calls run every hosted platform.

Expected jobs are:

- `iOS Build`: unsigned generic-device Debug and Release builds; no IPA is
  uploaded.
- `Android Build`: Debug and unsigned Release source builds.
- `macOS Package`: unsigned arm64 and x64 DMG packages.
- `Windows Package`: unsigned x64 NSIS and ZIP packages.
- `Native Builds`: the stable aggregate check for branch rules.

Successful package jobs upload these seven-day intermediate artifacts:

- `native-android`
- `native-macos-arm64`
- `native-macos-x64`
- `native-windows-x64`

A manual dispatch produces Actions artifacts only. It does not create a GitHub
Release, sign software, notarize a package, upload to a store, or publish an
update. These unsigned outputs may trigger macOS Gatekeeper, Windows
SmartScreen, or Android sideloading warnings and are suitable only for build
verification.

Fork pull requests remain safe because the workflow uses public source with no
repository secrets and read-only repository permissions. Review the workflow
diff before allowing a fork run when GitHub requires maintainer approval.

Linux remains local verification only: it has no hosted job and no release
artifact. The local Linux package commands below remain the sole Linux package
verification path.

## OSS Draft Release

The `OSS Draft Release` workflow rebuilds verification outputs from one
immutable commit. It accepts stable tags matching `vX.Y.Z` only. Before any
native runner starts, the workflow verifies that the tag version exactly
matches the desktop package, mobile package, iOS `MARKETING_VERSION`, and the
committed Android `versionName` source contract. After Gradle builds the
release APK, the Android job reads the effective `versionName` from its manifest
and fails before staging artifacts if that value differs from the tag version.

A manual dispatch is a build-only rehearsal and creates no GitHub Release. It
runs the release gate, TypeScript and Go CI, and every hosted native build, then
stops with seven-day Actions artifacts. iOS remains build-only: it performs
unsigned Debug and Release generic-device builds and produces no IPA.

A valid tag run waits for `OSS Release Gate`, `TS Quality`, `Go Tests`, and
`Native Builds` from the same commit. It then assembles exactly these files:

- `LynavoDriveDemo-<version>-macos-arm64.dmg`
- `LynavoDriveDemo-<version>-macos-x64.dmg`
- `LynavoDriveDemo-<version>-windows-x64.exe`
- `LynavoDriveDemo-<version>-windows-x64.zip`
- `LynavoDriveDemo-<version>-android-arm64-x86_64.apk`
- `LynavoDriveDemo-<version>-android-arm64-x86_64.aab`
- `SHA256SUMS`

`SHA256SUMS` contains one sorted SHA-256 entry for each of the six package
assets. Verify the matching entry in `SHA256SUMS` before testing an asset.
There is no hosted Linux release asset, and iOS does not produce a release
asset.

Release creation is draft-only. The job has read-only repository permissions
until the final tag-gated release job, which receives `contents: write`. A new
draft uses generated release notes and this warning:

> These files are unsigned OSS build-verification outputs, not an official
> signed distribution. macOS Gatekeeper, Windows SmartScreen, and Android
> sideloading controls may block installation or display warnings. Verify the
> matching entry in `SHA256SUMS` before testing an asset.

An existing draft may be updated idempotently. A rerun for the same tag
preserves its generated notes and replaces the seven allowlisted assets above
with the newly rebuilt set. Immediately before uploading, the workflow checks
again that the release is still a draft. GitHub does not provide one atomic
operation that both verifies draft state and replaces assets, so maintainers
must not publish the draft while the workflow is running. A published release
is treated as immutable when the workflow observes it: the workflow refuses to
start an upload in that state and never moves, deletes, or recreates the tag.

### Maintainer Procedure

1. Confirm all four version sources contain the intended stable version.
2. Run `pnpm gate:release` and the relevant local native checks.
3. Optionally dispatch `OSS Draft Release` manually. Confirm all reusable jobs
   pass, the four intermediate artifact groups exist, and no release is
   created.
4. Create and push one stable `vX.Y.Z` tag only after the target commit and
   repository checks are approved.
5. Do not publish the draft while the tag workflow or any rerun is in progress.
6. After the run completes, confirm the draft contains only the six versioned
   files and `SHA256SUMS`.
7. Download the files, verify their checksums, and record platform smoke-test
   results before any separate publication decision.
8. Publish only after the completed run, asset list, and checksums have been
   reviewed. Consider enabling GitHub immutable releases as an additional
   repository-level protection for published releases.

For a failed tag run, keep the tag fixed and address only transient workflow or
packaging failures that do not require source changes. Rerun the workflow to
replace the existing draft assets. If source or version metadata must change,
use a new version and tag. If the release is already published, do not rerun to
overwrite it; create a new stable version instead.

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

- `apps/desktop/release/LynavoDriveDemo-<version>-arm64.dmg`
- `apps/desktop/release/LynavoDriveDemo-<version>-x64.dmg`
- `apps/desktop/release/mac*/Lynavo Drive.app`

Minimum local checks:

```bash
hdiutil verify apps/desktop/release/LynavoDriveDemo-<version>-arm64.dmg
hdiutil verify apps/desktop/release/LynavoDriveDemo-<version>-x64.dmg
file apps/desktop/release/mac*/Lynavo\ Drive.app/Contents/Resources/lynavo-drive-sidecar
```

OSS desktop packages produced locally or by the GitHub-hosted workflows are
unsigned build-verification artifacts, not official signed distributions. The
builder wrapper disables local code-signing identity discovery, and Windows
packaging excludes `.exe` signing so contributor machines and hosted runners do
not inject private certificates into verification outputs.

Windows:

```bash
pnpm package:desktop:win
```

Expected local artifacts:

- `apps/desktop/release/LynavoDriveDemo-<version>-x64.exe`
- `apps/desktop/release/LynavoDriveDemo-<version>-x64.zip`

Minimum local checks:

1. `apps/desktop/release/win-unpacked/resources\lynavo-drive-sidecar.exe`
   exists in the unpacked app.
2. The installer writes `Lynavo Drive Sidecar TCP`,
   `Lynavo Drive Sidecar HTTP`, and `Lynavo Drive mDNS UDP` firewall rules
   for ports `39593/TCP`, `39594/TCP`, and `5353/UDP`.

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

- `--arch=x64`: `apps/desktop/release/LynavoDriveDemo-<version>-linux-x64.deb`
- `--arch=arm64`: `apps/desktop/release/LynavoDriveDemo-<version>-linux-arm64.deb`

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
