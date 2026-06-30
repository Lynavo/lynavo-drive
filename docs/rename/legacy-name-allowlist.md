# Legacy Name Allowlist

This file tracks temporary compatibility uses of legacy product names during the Lynavo Drive rename.

The scanner is advisory in Task 0. Later rename tasks should remove broad hits and make the check CI-blocking.

## Scanner

Run:

```bash
pnpm verify:legacy-names
```

The scanner searches for:

- `Vivi Drop`
- `vividrop`
- `SyncFlow`
- `syncflow`
- `SYNCFLOW`
- `VIVIDROP`
- `@syncflow`

It scans hidden files and directories, while explicitly skipping generated build artifacts such as `node_modules`, `dist`, `build`, `out`, `release`, coverage output, `.git`, and `.turbo`.

## Allowed Compatibility Paths

| Path                                                             | Rationale                                                                   |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `docs/product/lynavo-drive-global-only-oss-commercial-plan.md`   | Product rename source plan; legacy names are quoted for migration scope.    |
| `docs/rename/legacy-name-allowlist.md`                           | This allowlist document necessarily names legacy forms.                     |
| `scripts/verify-legacy-name-allowlist.mjs`                       | The verifier owns the legacy-name pattern and compatibility allowlist.      |
| `scripts/release/__tests__/legacy-name-allowlist.test.mjs`       | Regression test fixture for unallowlisted legacy-name detection.            |
| `apps/desktop/electron-builder.yml`                              | Packaged sidecar resource remains `syncflow-sidecar` until sidecar binary migration. |
| `apps/desktop/resources/installer.nsh`                           | Installer targets `syncflow-sidecar.exe` and deletes legacy firewall rules during upgrade. |
| `apps/desktop/scripts/build-sidecar-linux.cjs`                   | Sidecar build output remains `syncflow-sidecar` until sidecar binary migration. |
| `apps/desktop/scripts/build-sidecar-mac.cjs`                     | Sidecar build output remains `syncflow-sidecar` until sidecar binary migration. |
| `apps/desktop/scripts/build-sidecar-win.cjs`                     | Sidecar build output remains `syncflow-sidecar.exe` until sidecar binary migration. |
| `apps/desktop/scripts/verify-windows-resources.cjs`              | Windows packaging still verifies `syncflow-sidecar.exe` until sidecar binary migration. |
| `apps/desktop/scripts/__tests__/build-sidecar-linux.test.mjs`    | Test coverage for retained Linux sidecar packaging path.                    |
| `apps/desktop/scripts/__tests__/package-linux.test.mjs`          | Test coverage for retained Linux sidecar packaging resource.                |
| `scripts/release/__tests__/desktop-branding.test.mjs`            | Test coverage for retained desktop sidecar packaging compatibility name.    |
| `services/sidecar-go/go.mod`                                     | Go module path before sidecar module rename.                                |
| `services/sidecar-go/go.sum`                                     | Go module path checksums before sidecar module rename.                      |
| `services/sidecar-go/Makefile`                                   | Sidecar binary and Go module path before sidecar rename.                    |
| `packages/contracts/src/protocol.ts`                             | Protocol service type remains `_syncflow._tcp` for LAN compatibility.       |
| `packages/contracts/src/service-endpoints.ts`                    | Protocol service type and sidecar health service compatibility constants.   |
| `services/sidecar-go/internal/mdns/broadcast.go`                 | Protocol service type remains `_syncflow._tcp` for LAN compatibility.       |
| `services/sidecar-go/internal/mdns/broadcast_test.go`            | Protocol service type compatibility test coverage.                          |
| `services/sidecar-go/internal/api/handlers_health.go`            | Sidecar health service name remains `syncflow-sidecar` for compatibility.   |
| `services/sidecar-go/internal/api/router_test.go`                | Sidecar health service compatibility test coverage.                         |
| `apps/mobile/ios/SyncFlowMobile/AuthKeychainCleaner.swift`       | Keychain migration strings preserve access to existing credentials.         |
| `apps/mobile/ios/SyncFlowMobile/AppleAuthModule.swift`           | Keychain migration strings and build settings preserve existing installs.   |
| `apps/mobile/src/utils/clearUserScopedStorage.ts`                | Shared-preference and storage migration strings preserve existing installs. |
| `apps/mobile/src/utils/__tests__/clearUserScopedStorage.test.ts` | Shared-preference migration test coverage.                                  |
| `apps/mobile/src/screens/*GlobalScreen.tsx`                      | Temporary post-market-removal filenames retained to avoid broad mobile UI import churn; follow-up rename can drop the suffix. |
| `services/sidecar-go/internal/config/config.go`                  | Old data-dir migration paths preserve existing desktop installs.            |
| `services/sidecar-go/internal/config/config_test.go`             | Old data-dir migration test coverage.                                       |
| `services/sidecar-go/cmd/syncflow-sidecar/main.go`               | Sidecar binary, Go module path, and old data-dir migration compatibility.   |
| `services/sidecar-go/cmd/syncflow-sidecar/main_test.go`          | Sidecar compatibility and old data-dir migration test coverage.             |

## Temporary Historical-Doc Exceptions

The following exact `docs/superpowers` paths are temporarily allowlisted because they are historical implementation plans and specs written before the rename. The exception is intentionally exact rather than directory-wide so new rename work remains visible to the advisory scanner.

`docs/superpowers/plans/2026-06-29-lynavo-drive-global-only-oss.md` is not allowlisted by this historical-doc exception.

- `docs/superpowers/plans/2026-04-17-apple-iap.md`
- `docs/superpowers/plans/2026-04-17-mobile-i18n.md`
- `docs/superpowers/plans/2026-04-20-album-preview-and-select-redesign.md`
- `docs/superpowers/plans/2026-04-23-multi-device-upload-scheduler.md`
- `docs/superpowers/plans/2026-04-23-switch-device.md`
- `docs/superpowers/plans/2026-04-28-mobile-onboarding-guide.md`
- `docs/superpowers/plans/2026-04-29-market-branching-plan.md`
- `docs/superpowers/plans/2026-05-25-p2p-tunnel-shared-download.md`
- `docs/superpowers/plans/2026-05-26-android-cn-review-apk-plan.md`
- `docs/superpowers/plans/2026-05-26-device-pairing-version-compatibility-alert.md`
- `docs/superpowers/plans/2026-06-03-team-personal-directories.md`
- `docs/superpowers/plans/2026-06-09-sleep-wake-optimization.md`
- `docs/superpowers/plans/2026-06-09-wake-bound-desktop.md`
- `docs/superpowers/plans/2026-06-10-connection-device-management.md`
- `docs/superpowers/plans/2026-06-15-vividrop-desktop-local-product-expansion.md`
- `docs/superpowers/plans/2026-06-16-global-connection-feature-guide-plan.md`
- `docs/superpowers/plans/2026-06-16-global-real-business-integration-plan.md`
- `docs/superpowers/plans/2026-06-17-global-remote-access-personal-root.md`
- `docs/superpowers/plans/2026-06-22-linux-desktop-release.md`
- `docs/superpowers/plans/2026-06-22-received-library-deleted-status.md`
- `docs/superpowers/plans/2026-06-22-video-thumbnails.md`
- `docs/superpowers/plans/2026-06-23-desktop-received-library-pairing-access.md`
- `docs/superpowers/plans/2026-06-24-mobile-pairing-invalidation.md`
- `docs/superpowers/specs/2026-04-17-apple-iap-design.md`
- `docs/superpowers/specs/2026-04-17-mobile-i18n-design.md`
- `docs/superpowers/specs/2026-04-18-account-identity-reset-design.md`
- `docs/superpowers/specs/2026-04-20-album-preview-and-select-redesign-design.md`
- `docs/superpowers/specs/2026-04-23-switch-device-design.md`
- `docs/superpowers/specs/2026-05-22-rename-app-run-ios-design.md`
- `docs/superpowers/specs/2026-05-26-android-cn-review-apk-design.md`
- `docs/superpowers/specs/2026-05-26-device-pairing-version-compatibility-alert-design.md`
- `docs/superpowers/specs/2026-05-26-global-country-code-picker-design.md`
- `docs/superpowers/specs/2026-06-03-team-personal-directories-design.md`
- `docs/superpowers/specs/2026-06-09-public-wake-design.md`
- `docs/superpowers/specs/2026-06-10-connection-device-management-design.md`
- `docs/superpowers/specs/2026-06-15-vividrop-desktop-local-product-expansion-design.md`
- `docs/superpowers/specs/2026-06-15-vividrop-mobile-ui-v0-alignment-design.md`
- `docs/superpowers/specs/2026-06-16-global-connection-feature-guide-design.md`
- `docs/superpowers/specs/2026-06-17-global-remote-access-personal-root-design.md`
- `docs/superpowers/specs/2026-06-22-linux-desktop-release-design.md`
- `docs/superpowers/specs/2026-06-22-video-thumbnails-design.md`

Any other hit is intentionally reported as unallowlisted until a later rename task removes it or adds a narrower compatibility rationale.
