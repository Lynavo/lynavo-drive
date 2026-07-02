# Environment And Local Build Inputs

This OSS repository documents local development and source-build inputs only.

## Local Prerequisites

1. Node.js >= 20
2. pnpm >= 10
3. Go >= 1.25.x
4. Xcode + CocoaPods for iOS builds on macOS
5. Android SDK / NDK for Android builds

Install and build shared packages:

```bash
pnpm install
pnpm build
```

## Build Commands

```bash
pnpm dev:desktop
pnpm dev:mobile
pnpm dev:sidecar

pnpm build:mobile
pnpm build:mobile:ios:release
pnpm build:mobile:android
pnpm package:desktop
pnpm package:desktop:win
pnpm package:desktop:linux
```

Linux packaging must run on a Linux host.

## Debug And Performance Flags

Sidecar:

- `LYNAVO_UPLOAD_PERF_LOG=1`

Mobile debug-only behaviors include upload parameter overrides, force host /
force port, perf logging, and manual stress switches. These must remain
debug-only and must not become product paths.

## Never Commit

1. `.env` files
2. API keys or private keys
3. certificate or keystore exports
4. diagnostic zip files
5. local databases or logs
6. generated release artifacts
