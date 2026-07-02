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
2. OSS source-package boundaries
3. commercial/account/remote-access boundary allowlist
4. legacy-name allowlist
5. release/dev script tests
6. `review` and `prod` release profile dry-runs

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
`CODE_SIGNING_ALLOWED=NO`.

## Release Profile Commands

Use dry-run first:

```bash
pnpm release --profile review --targets ios,android,mac,win,linux --dry-run
pnpm release --profile prod --targets ios,android,mac,win,linux --dry-run
```

Profiles only set `LYNAVO_RELEASE_CHANNEL` and the neutral Electron builder
config.

Target commands:

- `ios`: `pnpm --filter @lynavo-drive/mobile build:ios:release`
- `android`: `cd apps/mobile/android && ./gradlew assembleRelease bundleRelease -PreactNativeArchitectures=arm64-v8a,x86_64`
- `mac`: `pnpm package:desktop`
- `win`: `pnpm --filter @lynavo-drive/desktop package:win`
- `linux`: `pnpm --filter @lynavo-drive/desktop package:linux`

## Desktop Packages

macOS:

```bash
pnpm package:desktop
```

Expected local artifacts:

- `apps/desktop/release/LynavoDrive-<version>-arm64.dmg`
- `apps/desktop/release/LynavoDrive-<version>-x64.dmg`

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

Linux must run on a Linux host:

```bash
pnpm package:desktop:linux
```

Expected local artifacts:

- `apps/desktop/release/LynavoDrive-<version>-linux-x64.deb`
- `apps/desktop/release/LynavoDrive-<version>-linux-arm64.deb`

## Android Release Variant

The Android release variant is kept as an unsigned source-build target. It does
not define release keystore inputs or shared signing material.

## Source Package Rehearsal

A real source package rehearsal should use a tracked-source archive, extract it
outside the repository, install dependencies, and run the release gate:

```bash
git archive --format=tar --output /tmp/lynavo-drive-oss-source.tar HEAD
mkdir -p /tmp/lynavo-drive-oss-source
tar -xf /tmp/lynavo-drive-oss-source.tar -C /tmp/lynavo-drive-oss-source
cd /tmp/lynavo-drive-oss-source
pnpm install --frozen-lockfile
pnpm gate:release
```
