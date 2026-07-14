# Network Port Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Lynavo Drive to protocol port `39593` and sidecar HTTP port `39594` while retaining `_lynavodrive._tcp`.

**Architecture:** Keep `@lynavo-drive/contracts` authoritative for TypeScript consumers and update the Go, Swift, and Kotlin native defaults atomically. Align installer firewall rules, checked-in configuration, tests, i18n guidance, and current operational documentation with the new ports.

**Tech Stack:** TypeScript/Vitest, Go, Swift, Kotlin/JUnit, Electron NSIS, React Native, Markdown

---

### Task 1: Lock the approved defaults with failing tests

**Files:**

- Modify: `packages/contracts/src/__tests__/exports.test.ts`
- Modify: `services/sidecar-go/internal/config/config_test.go`
- Modify: `scripts/release/__tests__/desktop-branding.test.mjs`

- [x] Change the expected protocol and HTTP constants to `39593` and `39594`.
- [x] Run the focused contracts, Go config, and desktop branding tests.
- [x] Confirm each test fails because production defaults still use `39393` or `39394`.

### Task 2: Update runtime defaults and packaged configuration

**Files:**

- Modify: `packages/contracts/src/protocol.ts`
- Modify: `services/sidecar-go/internal/config/config.go`
- Modify: `services/sidecar-go/lynavo-drive-sidecar.yml`
- Modify: `apps/desktop/resources/installer.nsh`
- Modify: `apps/mobile/ios/SyncEngine/DiscoveryService.swift`
- Modify: `apps/mobile/ios/SyncEngine/SyncEngineManager.swift`
- Modify: `apps/mobile/ios/SyncEngine/SharedFilesService.swift`
- Modify: `apps/mobile/android/app/src/main/java/com/lynavo/drive/mobile/sync/NativeSyncEngineModule.kt`
- Modify: mobile renderer fallback files under `apps/mobile/src/screens/`

- [x] Set every protocol fallback/listener to `39593`.
- [x] Set every HTTP health, presence, and resource endpoint to `39594`.
- [x] Preserve `_lynavodrive._tcp` without adding an occupied service alias.
- [x] Update Windows firewall rules and descriptions to the new ports.

### Task 3: Align tests, localization guidance, and current docs

**Files:**

- Modify: affected tests under `packages/contracts`, `services/sidecar-go`, `apps/desktop`, `apps/mobile`, and `scripts/release`
- Modify: `apps/mobile/src/i18n/locales/*/deviceDiscovery.json`
- Modify: current README, architecture, operations, release, and verification documents

- [x] Replace old-port fixtures with `39593` and `39594` so examples match current runtime behavior.
- [x] Update all three localized manual-entry hints without removing i18n.
- [x] Leave completed historical design and plan records unchanged.

### Task 4: Verify and review the atomic migration

**Files:**

- Review all modified files from Tasks 1-3.

- [x] Run focused tests, then repository-wide type checks/builds and Go tests.
- [x] Run Android and iOS verification supported by the local environment.
- [x] Scan current code, config, tests, localization, and operational docs for all six occupied identifiers.
- [x] Run `git diff --check` and review the diff for unrelated behavior changes.
- [x] Confirm DTOs, persistence, queue semantics, sync state, account gates, and non-OSS capability gates are unchanged.
