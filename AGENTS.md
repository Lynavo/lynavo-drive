# AGENTS.md - Lynavo Drive

## Project Overview

Lynavo Drive is a local-LAN incremental media sync tool from mobile
(iOS / Android) to Desktop (macOS / Windows). The monorepo currently contains
the Electron desktop app, Go sidecar, React Native mobile app, and native iOS /
Android sync capabilities.

This repository is the global-only OSS baseline. It maintains one public local
source-build and package-verification path only. It does not include
multi-market, official signing, upload, auto-update, non-OSS distribution,
or other non-OSS product paths. Linux is kept only for local source-build /
package verification; it is not a current user support surface.

## Current Development Baseline

The repository currently has no separately maintained product spec file. Make
development and cleanup decisions in this priority order:

1. **Current committed code**: actual behavior follows the implementation in
   this repository.
2. **`@lynavo-drive/contracts`**: the single source of truth for shared DTOs,
   constants, event names, and port definitions.
3. **Architecture, operations, and release docs**: use them to explain the
   current implementation, not to override code.
4. **`docs/testing/oss-verification-matrix.md`**: the long-term OSS validation
   matrix, regression scenarios, and release gates.

If historical specs are restored later, treat them as background only until a
new source of truth is explicitly established. Do not assume a deleted spec
file still applies.

Project files must not contain Chinese text outside explicit localization or
i18n resources.

## New Session Handoff Order

For a new AI coding session, establish context in this order:

1. [README.md](./README.md)
2. [docs/architecture/system-overview.md](./docs/architecture/system-overview.md)
3. [docs/architecture/sync-state-machine.md](./docs/architecture/sync-state-machine.md)
4. [docs/architecture/data-model.md](./docs/architecture/data-model.md)
5. [docs/operations/troubleshooting.md](./docs/operations/troubleshooting.md)
6. [docs/release/release-playbook.md](./docs/release/release-playbook.md)

If the task clearly touches a specific area, also read the relevant document:

- mobile diagnostics: [docs/operations/mobile-diagnostics.md](./docs/operations/mobile-diagnostics.md)
- sidecar operations: [docs/operations/sidecar-runbook.md](./docs/operations/sidecar-runbook.md)
- product boundaries: [docs/product/constraints.md](./docs/product/constraints.md)
- build / package verification: [docs/release/release-playbook.md](./docs/release/release-playbook.md)

## Parallel Agent Dispatch Rules

Prefer dispatching multiple agents in parallel when an engineering task can be
split cleanly. Good candidates include cross-module investigation, frontend and
backend or multiplatform changes, independent validation, and docs/code updates
that do not overlap.

Before dispatching, define each agent's responsibility boundary, allowed files,
and expected output. Different agents must not modify the same files or
overwrite each other's work. The main agent remains responsible for final
integration, conflict handling, self-review, and validation summary.

Do not force multi-agent work when the task is small, blocked by one key
conclusion, highly coupled, or likely to increase risk around protocol, state
machine, persistence, or sync semantics.

## Key Architecture Constraints

- **Desktop currently covers macOS / Windows**. Handle platform differences,
  such as sharing checks and packaging, according to current code and the
  relevant docs. The OSS repository provides local source-build and package
  verification only.
- **No official non-OSS release path is available here**. Do not add or assume
  official signing, notarization, upload, auto-update, non-OSS market,
  server-side capability, support, or hosted release infrastructure in this public
  baseline.
- **Linux is verification-only**. Keep Linux local source-build and package
  verification paths working where documented, but do not treat Linux as a
  supported desktop user surface.
- **The OSS source package does not redistribute Apple Bonjour for Windows
  binaries**. Windows native Bonjour can only use files from the user's local
  installation or another locally permitted configured source. If unavailable,
  use the zeroconf-compatible fallback.
- **The queue is strictly read-only**. Users must not be able to delete,
  reorder, or skip queue items in the UI.
- **Fully automatic incremental sync**. Do not add manual file checkboxes.
- **No manual file-selection fallback**. Do not add manual picking to bypass the
  mobile local scan and pending queue.
- **Single-file serial upload**. A given phone uploads only one file at a time.
- **Guest local LAN mode**. Users without sign-in or account-service state can
  still discover, pair, and automatically sync in foreground LAN scenarios.
- **Non-OSS remote / background capabilities fail closed**. Silent background
  resume, remote access, and tunnel credentials require official capability and
  valid server-side capability. If missing, expired, or unconfirmed, keep them
  disabled.
- **Import all DTO types from `@lynavo-drive/contracts`**. Do not redefine them
  in desktop or mobile packages.
- **Renderer must not access sidecar, filesystem, or SQLite directly**. Route
  everything through the preload bridge.
- **Builds must run locally**. All code builds, binary compilation, and image or
  package creation must run on the local machine, not a remote compile/package
  environment.

Additional clarifications:

- Device identity is based on mobile `clientId`, not device name, IP address, or
  directory name.
- Historical "which day" grouping is based on sidecar / desktop completion day.
- The actual upload set must come from the mobile local pending queue, not only
  newly scanned assets from the current round.
- iCloud assets enter the queue during scanning; cloud download happens during
  export.
- Foreground LAN sync is fail-open and must not be blocked by login state,
  account-service state, or missing non-OSS modules.
- Remote / background capabilities fail closed. Do not turn non-OSS
  capabilities on through local defaults.
- mDNS service names, legacy data directories, native package / bundle IDs, and
  package scope rename are migration boundaries for later work. Do not perform
  migrations in documentation-only tasks unless explicitly requested.

## Development Workflow

```bash
# Daily development
pnpm install           # install dependencies
pnpm build             # build contracts + design-tokens; required after shared package changes
pnpm --filter @lynavo-drive/desktop dev   # start Electron development mode

# Validation
pnpm test              # full test suite
pnpm typecheck         # type checks
pnpm format:check      # formatting check
```

## Mandatory Review After Code Changes

If a task changes code, perform a self-review before delivery and include these
items in the final response:

1. **Impact scope**: directly modified modules, call chains, user-visible
   behavior, and possibly affected platforms.
2. **Contamination check**: confirm whether adjacent logic, shared state,
   DTO/protocol, persistence, queue semantics, sync state machine,
   permission/account-service gates, history statistics, or other non-target
   paths were changed.
3. **Validation results**: list tests, type checks, builds, or explain why they
   could not be run.

If a change might affect non-target paths, narrow the implementation or clearly
state the remaining risk. Do not hand off only a diff.

## Package Dependencies

```text
@lynavo-drive/contracts       <- no dependencies; pure types + constants
@lynavo-drive/design-tokens   <- no dependencies; pure token values
@lynavo-drive/desktop         <- depends on contracts + design-tokens
```

After changing `contracts` or `design-tokens`, run `pnpm build` before starting
desktop dev.

## Coding Standards

### TypeScript

- Use strict mode. Do not use `any`.
- Import all shared types from `@lynavo-drive/contracts`.
- In renderer code, use the `@renderer/` path alias.
- Components use named exports, not default exports.

### React (Desktop Renderer)

- React 18.3, not React 19.
- shadcn/ui new-york style; install components with `npx shadcn@latest add`.
- State management uses zustand, not Context or Redux.
- Navigation uses simple view-state switching through `app-store.currentView`,
  not react-router.
- Page-level components live in `features/<page>/`.
- Shared components live in `components/shared/`.
- Glass effects use the `<GlassCard>` component plus
  `@lynavo-drive/design-tokens` elevation/glass tokens.

### Electron

- Keep main, preload, and renderer strictly isolated.
- Define IPC channel names in the `IPC` constant object in
  `src/main/ipc-handlers.ts`.
- Expose APIs through `contextBridge.exposeInMainWorld('electronAPI', ...)` in
  preload.
- Renderer must not access sidecar, filesystem, or SQLite directly. Always go
  through the preload bridge / main process.

### Go Sidecar

- It has its own `go.mod` and is not managed by turbo.
- Prefer the standard library (`net/http`, `log/slog`).
- SQLite uses `mattn/go-sqlite3` with CGO.
- Migrations use `go:embed`.
- All SQL queries must be parameterized.

### Tests

- vitest 4.1 for TypeScript with jsdom environment.
- Place test files in `__tests__/` directories next to the tested modules.
- Store tests verify state transitions and action behavior.
- Component tests use `@testing-library/react` and verify rendering and
  interaction.
- Go uses standard `go test`.

## Current Status

- **Monorepo / Desktop / Sidecar / Mobile SyncEngine**: implemented; this is no
  longer a greenfield project.
- **Current focus**: error recovery, connection-state messaging, OSS boundary
  tightening, and local build / package verification.
- **Regression baseline**: `go test ./...`,
  `pnpm --filter @lynavo-drive/mobile exec tsc --noEmit`, iOS build, Android
  Debug/Release builds, and `docs/testing/oss-verification-matrix.md`.
- **Handoff baseline**: new contributors should rely first on
  `docs/architecture/*`, `docs/operations/*`, and
  `docs/release/release-playbook.md`.

## Troubleshooting And Build Verification Entry Points

For troubleshooting, start with:

1. [docs/operations/troubleshooting.md](./docs/operations/troubleshooting.md)
2. [docs/operations/mobile-diagnostics.md](./docs/operations/mobile-diagnostics.md)
3. [docs/operations/sidecar-runbook.md](./docs/operations/sidecar-runbook.md)

For build / package verification, start with:

1. [docs/release/release-playbook.md](./docs/release/release-playbook.md)

Windows desktop packages currently follow the Windows section in
`docs/release/release-playbook.md` and the root script
`pnpm package:desktop:win`.

## Release Profile Build Rules

When AI or humans run OSS build verification, prefer the single root entry point
for viewing or executing local build paths:

```bash
pnpm release --profile review --targets ios,android,mac,win,linux
```

Do not manually concatenate market or API base URL environment variables as a
replacement for release profiles. Other local profiles must also resolve only
to local build / package commands. Use `--dry-run` when you only need to inspect
what would run.

## Sidecar HTTP API Ports

- TCP/LMUP protocol port: **39593**
- Sidecar HTTP API port: **39594**
- Both ports are defined in `@lynavo-drive/contracts` as `PROTOCOL_PORT` and
  `SIDECAR_HTTP_PORT`.

## Event Naming Convention

SidecarEvent uses **dot-notation**, such as `device.state.changed`; do not use
underscore notation.
