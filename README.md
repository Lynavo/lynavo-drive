<p align="center">
  <strong>English</strong> | <a href="./README.zh-Hant.md">繁體中文</a>
</p>

<p align="center">
  <img src="./screenshots/banner.png" alt="Lynavo Drive Banner" width="100%">
</p>

<p align="center">
  <img src="./screenshots/logo.png" alt="Lynavo Drive Logo" width="120">
</p>

<h1 align="center">Lynavo Drive</h1>

<p align="center">
  <strong>A high-performance, local-LAN incremental media sync tool from mobile (iOS / Android) to desktop (macOS / Windows).</strong>
</p>

<p align="center">
  <a href="https://github.com/gpt-open/vividrop-client/actions/workflows/oss-release-gate.yml"><img src="https://github.com/gpt-open/vividrop-client/actions/workflows/oss-release-gate.yml/badge.svg" alt="OSS Release Gate"></a>
  <a href="https://github.com/gpt-open/vividrop-client/actions/workflows/ci.yml"><img src="https://github.com/gpt-open/vividrop-client/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/Node.js-%3E%3D%2022.12.0-blue?style=flat-square&logo=node.js" alt="Node Version">
  <img src="https://img.shields.io/badge/Go-%3E%3D%201.25.6-00ADD8?style=flat-square&logo=go" alt="Go Version">
  <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-lightgrey?style=flat-square" alt="Desktop Platform">
  <img src="https://img.shields.io/badge/Mobile-iOS%20%7C%20Android-lightgrey?style=flat-square" alt="Mobile Platform">
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License">
</p>

<p align="center">
  <a href="#-screenshots-preview">Screenshots</a> •
  <a href="#-key-features">Key Features</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-oss-boundaries">OSS Boundaries</a> •
  <a href="#-tech-stack">Tech Stack</a>
</p>

---

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

## 📸 Screenshots Preview

<table width="100%">
  <tr>
    <td width="33%" align="center">
      <strong>1. Device Discovery</strong><br>
      <img src="./screenshots/screenshot_1.png" alt="Device Discovery" width="100%"><br>
      <sub>Local LAN pairing via mDNS</sub>
    </td>
    <td width="33%" align="center">
      <strong>2. Mobile Media Scan</strong><br>
      <img src="./screenshots/screenshot_2.png" alt="Mobile Media Scan" width="100%"><br>
      <sub>Incremental scanner for photo libraries</sub>
    </td>
    <td width="33%" align="center">
      <strong>3. Active Sync Queue</strong><br>
      <img src="./screenshots/screenshot_3.png" alt="Sync Queue" width="100%"><br>
      <sub>Serial file upload tracking</sub>
    </td>
  </tr>
  <tr>
    <td width="33%" align="center">
      <strong>4. Sync History</strong><br>
      <img src="./screenshots/screenshot_4.png" alt="Sync History" width="100%"><br>
      <sub>Transfer logs and daily completion stats</sub>
    </td>
    <td width="33%" align="center">
      <strong>5. Desktop Settings</strong><br>
      <img src="./screenshots/screenshot_5.png" alt="Desktop Settings" width="100%"><br>
      <sub>Shared target directory configurations</sub>
    </td>
    <td width="33%" align="center">
      <!-- Empty cell for grid layout balance -->
    </td>
  </tr>
</table>

## 🛡️ OSS Boundaries

<a id="-key-features"></a>
<a id="-oss-boundaries"></a>

> [!IMPORTANT]
> **Open-Source Core & Sync Limitations**
>
> - **Guest Local LAN Mode**: Foreground automatic sync works out of the box without login or account-service state. Devices discover, pair, scan the pending queue, and upload over local LAN.
> - **Strictly Read-Only Queue**: Users cannot delete, reorder, or skip queue items in the UI.
> - **Automatic Incremental Sync Only**: No manual file-selection fallback or checkbox picking is provided. Sync is driven solely by local scans and the pending queue.
> - **Fail-Open LAN Sync**: Foreground LAN sync is never blocked by login, account-service state, or missing non-OSS modules.
> - **Single-Device Serial Upload**: A given mobile client uploads only one file at a time to the desktop.

> [!WARNING]
> **Closed-by-Default Capabilities & Licensing**
>
> - **Non-OSS Capabilities Fail Closed**: Silent background resume, remote access, and tunnel credentials require official capabilities and will fail closed (remain disabled) by default.
> - **No Redistribution of Apple Bonjour**: The OSS build does not redistribute Apple Bonjour for Windows binaries. Windows users must use their local Bonjour installation or default to the zeroconf-compatible fallback.
> - **Single Baseline**: No multi-market branches, dedicated account paths, or dual-market regression matrices are provided in this baseline.

> [!NOTE]
> **Future Migration Boundaries**
> Package scope, mDNS service names, legacy data directories, and native package/bundle ID renames are migration boundaries and do not require renames in this documentation pass.

## 🚀 Quick Start

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

## ❓ FAQs & Troubleshooting

<details>
<summary>🔍 View Troubleshooting Guide & Common FAQs</summary>

### 1. The mobile app cannot find my desktop client (mDNS discovery failure)

- **Check Network**: Ensure both mobile and desktop are on the same Local LAN (or VPN-LAN).
- **Windows Firewall**: Verify that Windows Defender Firewall allows incoming traffic for ports `39393` (TCP/LMUP file transport) and `39394` (HTTP API).
- **Bonjour Runtime**: The OSS build doesn't redistribute Apple Bonjour. Ensure Bonjour is installed on Windows, or rely on the zeroconf-compatible fallback.

### 2. Why are some of my iCloud photos stuck/not transferring?

- Photos marked with `iCloud` must be exported from the Apple Photos cloud repository before transfer.
- While in `cloud_downloading` or `preparing` states, the phone is downloading the high-res original asset to local storage. Transfer begins automatically once complete.

### 3. Can I manually select which photos/videos to sync?

- No. To ensure fully automatic incremental sync, Lynavo Drive relies entirely on mobile background/foreground scans and a strictly read-only pending queue. Checkbox picking is a non-goal for this baseline.

### 4. What happens when the desktop sleeps or connection drops?

- LAN transfers will interrupt. Once the desktop wakes and network connectivity is restored, the mobile app will automatically resume the unfinished queue without losing progress.
- Enable _"Prevent computer from sleeping while syncing"_ in the desktop app settings for uninterrupted transfers.

</details>

## 🛠️ Tech Stack

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

## 🏗️ Architecture Overview

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

## ⚙️ Prerequisites

- **macOS or Windows** (desktop currently supports macOS / Windows; Linux is
  only for local build / package verification; iOS builds still require macOS +
  Xcode)
- **Node.js** >= 22.12.0
- **pnpm** >= 10
- **Go** >= 1.25.6 (sidecar development and tests)

<details>
<summary>📱 View Mobile & Platform-Specific SDK Requirements</summary>

- **Xcode + CocoaPods** (iOS builds and device debugging, macOS only)
- **Android Studio + Android SDK / NDK** (Android builds and debugging)

</details>

## 💻 Common Commands

<details>
<summary>🛠️ View Developer Command Reference</summary>

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

</details>

## 📦 OSS Build & Package Verification

This OSS repository keeps contributor-local source-build paths and
GitHub-hosted, secret-free unsigned build/package verification. Hosted outputs
are verification artifacts, not official signed distributions. Linux remains
local verification only and is not a supported desktop user surface.

<details>
<summary>🔬 View Verification & Build Pipelines</summary>

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

</details>

`release` profiles only inject `LYNAVO_RELEASE_CHANNEL` and local build
configuration, and only select local build/package commands.

GitHub-hosted workflows may invoke these commands using public source and no
repository secrets. Third-party or external build services, code signing,
notarization, store upload, auto-update, and private distribution infrastructure
remain outside this OSS baseline.

## 📁 Project Structure

<details>
<summary>📂 View Directory Structure Map</summary>

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

</details>

## 🎯 Development Baseline

- Shared types, constants, event names, and port definitions come from
  `@lynavo-drive/contracts`.
- The renderer does not access the sidecar, filesystem, or SQLite directly; all
  access goes through the preload bridge / main process.
- The queue stays read-only. The UI cannot delete, reorder, or skip items.
- A given phone uploads only one file at a time.
- Guest/local foreground LAN sync is fail-open; remote access and background
  continuation fail closed.

## 📄 Documentation Reference

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

## 💡 Contributing

We welcome contributions from the community! To get started:

1. **Fork the Repository**: Create a personal fork and clone it locally.
2. **Setup Development Workspace**: Install dependencies and compile shared packages:
   ```bash
   pnpm install
   pnpm build
   ```
3. **Verify Tests**: Ensure all formatting, typescript checks, and unit tests pass before submitting a PR:
   ```bash
   pnpm test
   pnpm typecheck
   pnpm format:check
   ```

For detailed coding standards, project layouts, and process rules, check out our [Contributing Guidelines](./CONTRIBUTING.md) and [Code of Conduct](./CODE_OF_CONDUCT.md).

## ⚖️ License

MIT. See [`LICENSE`](./LICENSE).
