# Legacy Name Allowlist

This file tracks temporary compatibility uses of legacy product names during the Lynavo Drive rename.

The strict scanner is now intended to be CI-blocking: every remaining legacy hit must either be removed or match a narrow compatibility rationale in `scripts/verify-legacy-name-allowlist.mjs`.

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

| Path                                                           | Rationale                                                                                                 |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `docs/product/lynavo-drive-global-only-oss-commercial-plan.md` | Product rename source plan; legacy names are quoted for migration scope.                                  |
| `docs/rename/legacy-name-allowlist.md`                         | This allowlist document necessarily names legacy forms.                                                   |
| `scripts/verify-legacy-name-allowlist.mjs`                     | The verifier owns the legacy-name pattern and compatibility allowlist.                                    |
| `scripts/release/__tests__/legacy-name-allowlist.test.mjs`     | Regression test fixture for unallowlisted legacy-name detection.                                          |
| `scripts/release/__tests__/desktop-branding.test.mjs`          | Regression tests assert old packaged sidecar exe paths do not return.                                     |
| `AGENTS.md`                                                    | Repository handoff instructions quote external historical repo paths.                                     |
| `scripts/dev/oss-env-scrubber.cjs`                             | OSS env scrubber must name legacy commercial env vars to remove them.                                     |
| `scripts/dev/__tests__/release-profile-dev.test.mjs`           | Regression test fixture asserts legacy release/profile envs stay scrubbed.                                |
| `scripts/release/__tests__/release-cli.test.mjs`               | Regression test fixture asserts release CLI ignores legacy envs.                                          |
| `apps/desktop/scripts/__tests__/*.mjs`                         | Regression fixtures assert legacy package/env names do not return.                                        |
| `scripts/ios/build-mobile-tunnel.sh`                           | Tunnel build script still references current prebuilt tunnel framework names before tunnel binary rename. |
| `apps/mobile/android/app/build.gradle`                         | Android still links the current prebuilt tunnel AAR before tunnel binary rename.                          |
| `apps/mobile/ios/LynavoDrive.xcodeproj/project.pbxproj`        | iOS still links the current prebuilt tunnel xcframework before tunnel binary rename.                      |
| `apps/mobile/ios/SyncEngine/LocalTCPProxy.swift`               | LocalTCPProxy imports the current prebuilt tunnel framework before tunnel binary rename.                  |

## Temporary Historical-Doc Exceptions

The following exact `docs/superpowers` paths are temporarily allowlisted because they are historical implementation plans and specs written before the rename. The exception is intentionally exact rather than directory-wide so new rename work remains visible to the advisory scanner.

`docs/superpowers/plans/2026-06-29-lynavo-drive-global-only-oss.md` is allowlisted as the current rename source plan and remains exact-path scoped.

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
