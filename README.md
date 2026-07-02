# Lynavo Drive

Lynavo Drive is a local-LAN incremental media sync tool from mobile
(iOS / Android) to desktop (macOS / Windows), built for global users and video
teams. The current open-source baseline maintains one OSS local build path only
and does not include multi-market distribution paths. Linux keeps only local
source-build / package verification paths and is not a current user support
surface.

## Current Status

- Desktop, Go sidecar, mobile, and native iOS / Android sync are implemented.
- iOS and Android mobile apps are both in scope.
- Current work focuses on error recovery, OSS boundary tightening, and local
  build / package verification.
- The repository currently has no separately maintained product spec; the
  baseline is the current code, `@lynavo-drive/contracts`, and the test matrix.
- Guest/local users can use foreground LAN automatic sync. Remote access and
  silent background continuation are not part of the OSS runtime and remain off
  without official capability.

## Prerequisites

- **macOS or Windows** (desktop currently supports macOS / Windows; Linux is
  only for local build / package verification; iOS builds still require macOS +
  Xcode)
- **Node.js** >= 22.12.0
- **pnpm** >= 10
- **Go** >= 1.25.6 (sidecar development and tests)
- **Xcode + CocoaPods** (iOS builds and device debugging, macOS only)
- **Android Studio + Android SDK / NDK** (Android builds and debugging)

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Build shared packages
pnpm --filter @lynavo-drive/contracts build
pnpm --filter @lynavo-drive/design-tokens build

# 3. Start desktop development mode
pnpm dev:desktop
```

The Electron window opens automatically, and the desktop app starts the sidecar.

## Common Commands

```bash
# Desktop
pnpm dev:desktop
pnpm build:desktop
pnpm package:desktop          # macOS local DMG
pnpm package:desktop:win      # Windows NSIS + zip (default desktop Windows package, no release profile)

# Mobile
pnpm dev:mobile
pnpm build:mobile
pnpm dev:mobile:android
pnpm build:mobile:android  # Android Debug build (assembleDebug)

# Sidecar
pnpm dev:sidecar
pnpm build:sidecar
pnpm test:sidecar

# Full repository validation
pnpm build
pnpm test
pnpm typecheck
pnpm format:check
pnpm check
```

## OSS Build And Package Verification

This OSS repository keeps local source-build and package verification paths.

```bash
# Inspect the local build / package commands that would run
pnpm release --profile review --targets ios,android,mac,win,linux --dry-run

# Local iOS / Android Debug / Desktop build verification
pnpm build:mobile
pnpm build:mobile:ios:release
pnpm build:mobile:android
pnpm package:desktop

# Android Release source-build verification
pnpm release --profile review --targets android --dry-run
pnpm release --profile review --targets android

# Local desktop platform package
pnpm package:desktop

# Linux package verification (Linux host, one arch per run)
pnpm --filter @lynavo-drive/desktop package:linux -- --arch=x64
pnpm --filter @lynavo-drive/desktop package:linux -- --arch=arm64
```

`release` profiles only inject `LYNAVO_RELEASE_CHANNEL` and local build
configuration, and only select local build/package commands.

## OSS Boundary

- Community/OSS builds are a single OSS baseline. They do not provide
  multi-market branches, dedicated payment paths, dedicated release profiles, or
  dual-market regression matrices.
- Guest local LAN mode must work. Without sign-in or subscription, users can
  discover the desktop, pair, scan the pending queue, and upload automatically
  over foreground LAN.
- No manual file-selection fallback is provided. The queue is driven by mobile
  local scans and the pending queue; the UI must not allow manual file
  checkboxes to bypass automatic incremental sync.
- Foreground LAN sync is fail-open. When local permissions, pairing, and LAN
  reachability are available, foreground sync is not blocked by sign-in,
  subscription, or missing non-OSS modules.
- Non-OSS remote/background capabilities fail closed. Remote access, tunnel
  credentials, and silent background continuation remain off without official
  capability or valid entitlement.
- The OSS source package does not redistribute Apple Bonjour for Windows
  binaries. Windows native Bonjour can only use the user's local installation or
  another locally permitted configured source; otherwise it uses the
  zeroconf-compatible fallback.
- Package scope, mDNS service, legacy data directory, and native package/bundle
  renames are future migration boundaries. This documentation pass does not
  require renames or data migration.

## Project Structure

```text
lynavo-drive/
├── apps/
│   ├── desktop/              # Electron desktop app
│   │   └── src/
│   │       ├── main/         # Main process (window, IPC, sidecar lifecycle)
│   │       ├── preload/      # Preload bridge
│   │       └── renderer/     # React 18 UI
│   └── mobile/               # React Native iOS/Android app + native sync
│       ├── ios/              # Xcode project and Swift native modules
│       ├── android/          # Android project, Kotlin bridge, native sync
│       ├── src/              # RN screens and hooks
│       └── __tests__/        # RN tests
├── packages/
│   ├── contracts/            # Shared DTOs / constants / events / error codes
│   └── design-tokens/        # Shared design tokens
├── services/
│   └── sidecar-go/           # Go sidecar (TCP/HTTP/SQLite/mDNS)
└── docs/
    ├── architecture/         # Architecture, state machine, data model
    ├── operations/           # Troubleshooting, diagnostics, sidecar runbook
    ├── product/              # Product constraints, OSS boundaries, non-goals
    ├── release/              # OSS build and package verification playbook
    └── testing/              # OSS verification matrix
```

## Tech Stack

| Layer          | Technology                                                 |
| -------------- | ---------------------------------------------------------- |
| Monorepo       | pnpm 10 + turborepo 2.8                                    |
| Desktop        | Electron 41 + electron-vite 5 + electron-builder 26        |
| Desktop UI     | React 18.3 + zustand 5 + Tailwind CSS v4                   |
| Mobile         | React Native 0.84.1 + React 19 (iOS / Android)             |
| iOS Native     | Swift `SyncEngine` + BGTask + PhotoKit + Network.framework |
| Android Native | Kotlin bridge + NativeSyncEngine / MediaStore / NsdManager |
| Sidecar        | Go 1.25.6 + SQLite + WebSocket                             |
| Shared         | `@lynavo-drive/contracts` + `@lynavo-drive/design-tokens`  |
| Test           | vitest 4.1 + jest + `go test`                              |

## Architecture Overview

```text
Mobile (RN UI on iOS / Android)
  ├── iOS: Swift SyncEngine
  └── Android: Kotlin NativeSyncEngine
  ├── Bonjour/mDNS discover
  ├── LMUP/TCP :39393
  └── Presence/HTTP :39394
                │
                ▼
Desktop (Electron + Go sidecar, macOS / Windows)
  ├── Electron: UI shell, window, bridge, sidecar lifecycle
  ├── Sidecar HTTP API / WebSocket
  ├── LMUP file receiver
  ├── SQLite
  └── Filesystem / shared directory detection
```

## Development Baseline

- Shared types, constants, event names, and port definitions come from
  `@lynavo-drive/contracts`.
- The renderer does not access the sidecar, filesystem, or SQLite directly; all
  access goes through the preload bridge / main process.
- The queue stays read-only. The UI cannot delete, reorder, or skip items.
- A given phone uploads only one file at a time.
- Guest/local foreground LAN sync is fail-open; remote access and background
  continuation fail closed.

## Files

- Development constraints and operating rules: [`AGENTS.md`](./AGENTS.md)
- System overview: [`docs/architecture/system-overview.md`](./docs/architecture/system-overview.md)
- Sync state machine: [`docs/architecture/sync-state-machine.md`](./docs/architecture/sync-state-machine.md)
- Data model and statistics semantics: [`docs/architecture/data-model.md`](./docs/architecture/data-model.md)
- Troubleshooting guide: [`docs/operations/troubleshooting.md`](./docs/operations/troubleshooting.md)
- Mobile diagnostics package: [`docs/operations/mobile-diagnostics.md`](./docs/operations/mobile-diagnostics.md)
- Sidecar runbook: [`docs/operations/sidecar-runbook.md`](./docs/operations/sidecar-runbook.md)
- Product constraints, OSS boundaries, and non-goals: [`docs/product/constraints.md`](./docs/product/constraints.md)
- OSS build verification playbook: [`docs/release/release-playbook.md`](./docs/release/release-playbook.md)
- OSS verification matrix: [`docs/testing/oss-verification-matrix.md`](./docs/testing/oss-verification-matrix.md)
- Security policy: [`SECURITY.md`](./SECURITY.md)
- Privacy notice: [`PRIVACY.md`](./PRIVACY.md)
- Contributing guide: [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- Code of conduct: [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)
- Third-party notices: [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)

## License

MIT. See [`LICENSE`](./LICENSE).
