# Mobile UI 一比一还原 Coordinator 计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` for implementation tasks. The coordinator owns task splitting, waiting, review, integration, and verification. Page-level workers own isolated file scopes and must not edit outside their assigned scope.

**Goal:** Coordinate the one-to-one restoration of all ViviDrop mobile global UI/UX pages in `apps/mobile` against `/Volumes/workspace/work/vividrop-ui-mobile`, following `docs/operations/mobile-ui-restoration-workflow.md`.

**Architecture:** Keep current React Native business logic, native sync behavior, DTOs, auth gates, subscription gates, and sidecar protocol as source of truth. Use the reference project only for UI structure, visual states, icons, modal behavior, and interaction layout. Split workers by route/page cluster with disjoint write scopes; shared primitives and native blur are single-owner.

**Tech Stack:** React Native, React Navigation stack routes, TypeScript, Jest/React Native Testing Library, iOS native bridge, Android native bridge.

---

## Coordinator Rules

- Main agent acts as coordinator/integrator only for page-level UI work.
- Prefer subagents for implementation and verification when scopes are independent.
- Use iOS as the primary one-to-one visual acceptance platform for global UI
  restoration. Android is a secondary parity/regression platform used to catch
  market fallback, platform rendering, and native bridge differences.
- Do not infer CN/global from language alone. The reference global UI may use
  Chinese copy for easier comparison; judge by scheme/package, market config,
  route structure, login affordances, and reference global page structure.
- Do not let two workers edit the same file group at the same time.
- Do not close or supersede a running subagent just because it has not returned quickly.
- Default wait window for a worker is up to about 1 hour.
- If a worker must be stopped, first send it a close-out request asking for current findings, changed files, incomplete items, and risks.
- Completed workers may be closed only after their output has been reviewed and relevant changes have been integrated or rejected.
- Before dispatching each worker, coordinator must capture `git status --short -uall` as that worker's dirty baseline.
- Reviewers must evaluate the worker's assigned scope against the coordinator-provided baseline. Do not fail a worker solely because unrelated dirty files already existed before dispatch; fail only when the worker changed forbidden files, changed shared files without ownership, or left assigned files in a non-compliant state.
- Worker prompts must include:
  - assigned files and explicitly forbidden files
  - reference files and line ranges
  - business semantics to preserve
  - expected UI states
  - validation commands
  - final output format with status, changed files, tests, and risks

## Source Files

Primary workflow:

- `docs/operations/mobile-ui-restoration-workflow.md`

Reference UI:

- `/Volumes/workspace/work/vividrop-ui-mobile/components/global/mobile-app-global.tsx`
- `/Volumes/workspace/work/vividrop-ui-mobile/docs/rn-ui-reference.md`
- `/Volumes/workspace/work/vividrop-ui-mobile/lib/mock-data.ts`
- `/Volumes/workspace/work/vividrop-ui-mobile/public/assets/vividrop-logo.png`

Current RN entry points:

- `apps/mobile/src/App.tsx`
- `apps/mobile/src/navigation/RootNavigator.tsx`
- `apps/mobile/src/markets/index.ts`
- `apps/mobile/src/markets/cn/config.ts`
- `apps/mobile/src/markets/global/config.ts`

## Current Page Map

| Area                    | RN files                                                                                                                                                                          | Reference view/files                                                         | Global status                              | Preserve                                                                                                                       | Existing tests                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Global auth             | `apps/mobile/src/screens/LoginGlobalScreen.tsx`, `apps/mobile/src/components/auth/GlobalAuthScreenShell.tsx`                                                                      | `mobile-app-global.tsx` `auth` view                                          | global-only                                | Google/Apple provider auth, agreement gate, provider confirmation modal, no phone fallback                                     | `LoginGlobalScreen.test.tsx`                                                                                 |
| CN auth                 | `apps/mobile/src/screens/LoginScreen.tsx`, `apps/mobile/src/screens/SmsVerifyScreen.tsx`                                                                                          | not a global restoration target                                              | out of global scope                        | phone/SMS flow and latent email verify behavior                                                                                | `LoginScreen.test.tsx`, `SmsVerifyScreen.test.tsx`                                                           |
| Device discovery        | `apps/mobile/src/screens/DeviceDiscoveryScreen.tsx`, `apps/mobile/src/components/onboarding/UnconnectedGuide.tsx`                                                                 | `connectDesktop` and connection state previews                               | global-visible shared                      | native discovery, recent desktops, manual IP, reset/pairing logic, diagnostics                                                 | `DeviceDiscoveryScreen.*.test.tsx`, `deviceDiscoveryManualPairing.test.ts`, `deviceDiscoveryRefresh.test.ts` |
| QR/code/tutorial        | `apps/mobile/src/screens/QRScannerScreen.tsx`, `apps/mobile/src/screens/CodeVerifyScreen.tsx`, `apps/mobile/src/screens/ConnectionTutorialScreen.tsx`                             | connect modal, scanner, code input, tutorial references                      | global-visible shared                      | camera permission, QR parsing, `pairDevice`, recent desktop persistence, error handling                                        | `QRScannerScreen.test.tsx`, `CodeVerifyScreen.test.tsx`, `ConnectionTutorialScreen.visual.test.tsx`          |
| Home/sync workbench     | `apps/mobile/src/screens/SyncActivityScreen.tsx`, `apps/mobile/src/screens/components/SyncActivityHomeSections.tsx`, `apps/mobile/src/components/onboarding/SyncActivityTour.tsx` | `home` view and sync state previews                                          | global-visible shared                      | read-only queue, native binding/sync events, reconnect, auto upload gate, subscription overlay                                 | `SyncActivityScreen.*.test.tsx`, `syncActivityOverview.test.ts`, `syncPerformanceHint.test.tsx`              |
| Album library           | `apps/mobile/src/screens/AlbumWorkbenchScreen.tsx`, `apps/mobile/src/components/AssetPreviewModal.tsx`                                                                            | generic `album-page.tsx` only as secondary visual reference                  | global-visible shared                      | permissions, limited library browsing, preview modal; no manual file-selection upload path                                      | `AlbumWorkbenchScreen.test.tsx`, `AssetPreviewModal.test.tsx`                                                |
| Auto upload settings    | `apps/mobile/src/screens/AutoUploadSettingsScreen.tsx`                                                                                                                            | `autoUploadSettings` view                                                    | global-visible shared                      | current `enableAutoUpload` behavior; no file picker or selected-files submit fallback                                           | no direct screen test                                                                                        |
| Files entry             | `apps/mobile/src/screens/SharedFilesScreen.tsx`                                                                                                                                   | `files` view                                                                 | global-visible shared                      | navigation to phone sync space and remote access; route semantics                                                              | `SharedFilesDownloadGate.test.tsx`                                                                           |
| Phone sync space        | `apps/mobile/src/screens/PhoneSyncSpaceScreen.tsx`                                                                                                                                | `phoneSyncSpace` view                                                        | global-visible shared                      | binding host, sidecar HTTP `39394`, `listReceivedLibrary`, mock fallback isolated to UI preview                                | no direct screen test                                                                                        |
| Remote access           | `apps/mobile/src/screens/RemoteAccessScreen.tsx`                                                                                                                                  | `remoteAccess` view                                                          | global-visible shared                      | binding host, sidecar HTTP `39394`, `listSharedResources`, `downloadResource`, search/sort/layout/select states                | no direct screen test                                                                                        |
| History / sync records  | `apps/mobile/src/screens/HistoryScreen.tsx`                                                                                                                                       | `history` and recent downloads views                                         | global-visible shared                      | `listHistory`, desktop/sidecar completion-day grouping, no queue mutation                                                      | `HistoryScreen.test.tsx`                                                                                     |
| Settings/account        | `apps/mobile/src/screens/SettingsScreen.tsx`                                                                                                                                      | `settings`, `language`, settings modals                                      | global-visible shared with market branches | logout/delete, switch/forget desktop, reset sync, diagnostics, language, subscription/gift, public wake, CN keepalive branches | `SettingsScreen*.test.tsx`                                                                                   |
| Help center             | `apps/mobile/src/screens/HelpScreen.tsx`                                                                                                                                          | `helpCenter` view                                                            | global-visible shared                      | FAQ, gift-card config/redeem behavior, subscription reload                                                                     | `HelpScreen.test.tsx`                                                                                        |
| Subscription/membership | `apps/mobile/src/screens/SubscriptionScreen.tsx`, `apps/mobile/src/components/SubscriptionPlanCard.tsx`, `apps/mobile/src/components/SubscriptionStatusIcon.tsx`                  | `membership` view and generic `subscription-page.tsx` as secondary reference | global-visible gate                        | server plans, StoreKit/IAP, wallet routing, restore, verify/retry, gift cards, diagnostics, root paywall behavior              | `SubscriptionScreen.test.tsx`                                                                                |
| Shared chrome           | `BottomTabBar.tsx`, `GradientBackground.tsx`, `Icon.tsx`, `colors.ts`, modal blur components                                                                                      | style primitives, bottom nav, modal frame                                    | global-visible shared                      | tab routing, icon mapping, platform-safe modal backdrop                                                                        | component tests where present                                                                                |

## Single-Owner Files

These files must not be touched by page workers unless assigned explicitly:

- `apps/mobile/src/theme/colors.ts`
- `apps/mobile/src/components/Icon.tsx`
- `apps/mobile/src/components/GradientBackground.tsx`
- `apps/mobile/src/components/BottomTabBar.tsx`
- `apps/mobile/src/components/shared/ModalBlurBackdrop.tsx`
- `apps/mobile/src/components/shared/NativeModalBlurView.tsx`
- `apps/mobile/src/components/auth/GlobalAuthScreenShell.tsx`
- `apps/mobile/ios/SyncFlowMobile.xcodeproj/project.pbxproj`
- `apps/mobile/ios/SyncFlowMobile/VividropBlurViewManager.m`
- `apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/MainApplication.kt`
- `apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/ui/*`

Current coordination risk:

- Android native blur files under `apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/ui/` are currently ignored by `.gitignore` via a broad `UI/` pattern. The foundation/native worker must make those files trackable without broad unrelated ignore changes.

## Work Packages

### Package 0: Foundation / Native Modal / Shared Chrome

**Purpose:** Stabilize shared visual primitives before page workers rely on them.

**May touch:**

- `apps/mobile/src/theme/colors.ts`
- `apps/mobile/src/components/Icon.tsx`
- `apps/mobile/src/components/GradientBackground.tsx`
- `apps/mobile/src/components/BottomTabBar.tsx`
- `apps/mobile/src/components/shared/ModalBlurBackdrop.tsx`
- `apps/mobile/src/components/shared/NativeModalBlurView.tsx`
- `apps/mobile/src/components/auth/GlobalAuthScreenShell.tsx`
- `apps/mobile/src/components/__tests__/BottomTabBar.test.tsx`
- `apps/mobile/src/components/__tests__/Icon.test.tsx`
- `apps/mobile/src/assets/icons/vividrop-logo.png`
- `apps/mobile/ios/SyncFlowMobile.xcodeproj/project.pbxproj`
- `apps/mobile/ios/SyncFlowMobile/VividropBlurViewManager.m`
- `apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/MainApplication.kt`
- `apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/ui/*`
- `.gitignore`, only if needed to unignore the Android native UI package

**Must not touch:**

- page screens except mechanical import repair approved by coordinator
- `apps/mobile/src/screens/LoginScreen.tsx`
- `@lynavo-drive/contracts`, sidecar APIs, sync engine state, native sync behavior

**Acceptance:**

- Shared modal backdrop works through the RN wrapper on iOS and Android.
- Android native files are visible to git and not hidden by ignore rules.
- Shared primitives match reference tokens: light background, glass cards, bottom nav, icon sizes, modal overlay `rgba(23,25,28,0.22)`.

### Package 1: Global Auth

**May touch:**

- `apps/mobile/src/screens/LoginGlobalScreen.tsx`
- `apps/mobile/src/screens/__tests__/LoginGlobalScreen.test.tsx`

**Must not touch:**

- `apps/mobile/src/screens/LoginScreen.tsx`
- auth services, market config, native blur files, shared tokens unless the coordinator assigns a foundation follow-up

**Reference:**

- `mobile-app-global.tsx` `auth` view

**Acceptance:**

- Unauthenticated global build lands directly on global login.
- No `or phone`, phone fallback, or CN login affordance appears in global login.
- Agreement-required modal and provider-confirmation modal match reference structure, icon inventory, and backdrop behavior.

### Package 2: Remote Resources

**May touch:**

- `apps/mobile/src/screens/SharedFilesScreen.tsx`
- `apps/mobile/src/screens/PhoneSyncSpaceScreen.tsx`
- `apps/mobile/src/screens/RemoteAccessScreen.tsx`
- `apps/mobile/src/screens/__tests__/SharedFilesDownloadGate.test.tsx`

**Must not touch:**

- sidecar service implementations
- native sync modules
- `@lynavo-drive/contracts`
- history/help/settings/login files

**Reference:**

- `files`, `phoneSyncSpace`, `remoteAccess` views

**Acceptance:**

- Files entry, phone sync space, remote access, search, sort, layout switch, selection/share, empty folder, no files, search empty, and pagination/list-density states are visible.
- Mock data stays in UI preview/fallback only.
- Binding host and sidecar HTTP behavior remain unchanged.

### Package 3: History / Sync Records

**May touch:**

- `apps/mobile/src/screens/HistoryScreen.tsx`
- dedicated history tests if added

**Must not touch:**

- sidecar APIs, sync DTOs, queue state, files screens

**Reference:**

- `history` and `recentDownloads` views

**Acceptance:**

- Summary card, list density, multi-day mock fallback, empty/loading/error, and pagination affordances are visible.
- Completion-day grouping remains based on desktop/sidecar completion day.

### Package 4: Help / Settings / Account Modals

**May touch:**

- `apps/mobile/src/screens/HelpScreen.tsx`
- `apps/mobile/src/screens/__tests__/HelpScreen.test.tsx`
- `apps/mobile/src/screens/SettingsScreen.tsx`
- `apps/mobile/src/screens/__tests__/SettingsScreen*.test.tsx`

**Must not touch:**

- auth store cleanup semantics
- subscription services
- gift-card services
- CN-only keepalive behavior

**Reference:**

- `helpCenter`, `settings`, `language`, settings modals

**Acceptance:**

- Help page and all settings secondary flows match reference layout and modal/backdrop behavior.
- Logout, delete, switch device, edit device, restore purchase, diagnostic, language, gift card, and help entries are checked as secondary flows.

### Package 5: Home / Sync / Device Pairing

**May touch:**

- `apps/mobile/src/screens/SyncActivityScreen.tsx`
- `apps/mobile/src/screens/components/SyncActivityHomeSections.tsx`
- `apps/mobile/src/components/onboarding/SyncActivityTour.tsx`
- `apps/mobile/src/components/onboarding/UnconnectedGuide.tsx`
- `apps/mobile/src/screens/DeviceDiscoveryScreen.tsx`
- `apps/mobile/src/screens/QRScannerScreen.tsx`
- `apps/mobile/src/screens/CodeVerifyScreen.tsx`
- `apps/mobile/src/screens/ConnectionTutorialScreen.tsx`
- directly related tests

**Must not touch:**

- native sync engine implementations
- contracts
- queue mutation semantics
- remote files/history/settings/auth files

**Reference:**

- `home`, `connectDesktop`, scanner/code modals, connection/sync state preview matrices

**Acceptance:**

- Bound and unbound home states, auto-sync states, sync progress, reconnect/paused/failed/complete states, recent downloads, device discovery, QR/code/manual pairing, help/tutorial, and camera permission states are visible and reference-aligned.
- Queue remains absolutely read-only from UI.

### Package 6: Album / Auto Upload / Preview

**May touch:**

- `apps/mobile/src/screens/AlbumWorkbenchScreen.tsx`
- `apps/mobile/src/screens/AutoUploadSettingsScreen.tsx`
- `apps/mobile/src/components/AssetPreviewModal.tsx`
- directly related tests

**Must not touch:**

- native album module behavior
- upload queue mutation semantics
- subscription services

**Reference:**

- generic `album-page.tsx`, `autoUploadSettings` view, shared modal patterns

**Acceptance:**

- Grid/list controls, selection states, permission/limited-library states, preview modal, manual submit, and auto upload settings states are visually complete.
- Existing upload behavior and selection locks remain intact.

### Package 7: Subscription / Membership

**May touch:**

- `apps/mobile/src/screens/SubscriptionScreen.tsx`
- `apps/mobile/src/components/SubscriptionPlanCard.tsx`
- `apps/mobile/src/components/SubscriptionStatusIcon.tsx`
- `apps/mobile/src/screens/__tests__/SubscriptionScreen.test.tsx`
- component tests for subscription cards/icons

**Must not touch:**

- server plan parsing semantics
- IAP service behavior
- wallet routing semantics
- auth/subscription gate logic outside existing public APIs

**Reference:**

- `membership` view and generic `subscription-page.tsx` as secondary visual reference

**Acceptance:**

- Membership, restore, verify/retry, payment/gift-card states, expired/trial/subscribed states, modal/backdrop, and root paywall back behavior are visually complete.

## Validation Matrix

Minimum integration checks:

```bash
git diff --check
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
```

Targeted tests by package:

```bash
pnpm --filter @lynavo-drive/mobile test -- --runTestsByPath apps/mobile/src/screens/__tests__/LoginGlobalScreen.test.tsx
pnpm --filter @lynavo-drive/mobile test -- --runTestsByPath apps/mobile/src/screens/__tests__/SharedFilesDownloadGate.test.tsx
pnpm --filter @lynavo-drive/mobile test -- --runTestsByPath apps/mobile/src/screens/__tests__/HelpScreen.test.tsx
pnpm --filter @lynavo-drive/mobile test -- --runTestsByPath apps/mobile/src/screens/__tests__/SubscriptionScreen.test.tsx
pnpm --filter @lynavo-drive/mobile test -- --runTestsByPath apps/mobile/src/screens/__tests__/AlbumWorkbenchScreen.test.tsx apps/mobile/src/components/__tests__/AssetPreviewModal.test.tsx
pnpm --filter @lynavo-drive/mobile test -- --runTestsByPath apps/mobile/src/screens/__tests__/SyncActivityScreen.header.test.tsx apps/mobile/src/screens/__tests__/syncActivityOverview.test.ts apps/mobile/src/screens/__tests__/DeviceDiscoveryScreen.switchMode.test.tsx apps/mobile/src/screens/__tests__/QRScannerScreen.test.tsx apps/mobile/src/screens/__tests__/CodeVerifyScreen.test.tsx
```

Native/global build checks:

```bash
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
ANDROID_HOME="$HOME/Library/Android/sdk" \
ANDROID_SDK_ROOT="$HOME/Library/Android/sdk" \
./gradlew -p apps/mobile/android :app:assembleGlobalDebug --console=plain
```

iOS verification should use XcodeBuildMCP simulator workflows. Before the first iOS build/run in a session, call `session_show_defaults`; if project, scheme, and simulator are configured, use `build_run_sim`.

Visual checks:

- Reference screenshot from `/Volumes/workspace/work/vividrop-ui-mobile`
- iOS RN screenshot after cold start
- Android RN screenshot after cold start when emulator is available
- Compare first screen, scroll density, icon inventory, filter/tabs, modal backdrop vs content, secondary flows, empty/loading/error/pagination states

### Visual Evidence Matrix

This matrix is the remaining completion gate for the goal. Test/build rows can
be accepted independently, but no package is visually complete until the
reference, iOS, and Android evidence columns are filled or explicitly marked
not applicable with a reason.

Recommended authenticated QA setup:

- Use a clean debug global install.
- Restart Metro only to pick up the latest JS bundle; do not rely on Metro
  shell env for visual QA config.
- Primary platform: iOS Simulator using `SyncFlowMobileGlobal` +
  `DebugGlobal` + `com.vividrop.mobile.global`.
- Secondary platform: Android `globalDebug`; use it for parity/regression, not
  as the main visual acceptance source.
- iOS: pass visual QA values as app launch environment when launching
  `com.vividrop.mobile.global`.
- Android: pass visual QA values as activity intent extras via
  `adb shell am start -e ...`.
  The `globalDebug` package id is `com.vividrop.mobile.global`, while the
  historical Android activity class is
  `com.vividrop.mobile.china.MainActivity`; use the fully qualified component:
  `com.vividrop.mobile.global/com.vividrop.mobile.china.MainActivity`.
- Required QA flag:
  `SYNCFLOW_VISUAL_QA=1`.
- Optional email:
  `SYNCFLOW_VISUAL_QA_EMAIL=qa@example.com`.
- Optional route override:
  `SYNCFLOW_VISUAL_QA_ROUTE=History` where the value must be an existing
  authenticated root route; `Login`, `SmsVerify`, parameter-required routes,
  and unknown routes are ignored.
- Optional remote resource preview fallback:
  `SYNCFLOW_VISUAL_QA_REMOTE_PREVIEW=1`.
- The QA bootstrap seeds mock dev credentials only when the app has no existing
  persisted tokens:
  `{"access":"mock-sandbox-access-token:qa@example.com","refresh":"mock-sandbox-refresh-token"}`.
- Keep iOS on `SyncFlowMobileGlobal` + `DebugGlobal`.
- Keep Android on `globalDebug`.
- If iOS and Android disagree during restoration, first align the iOS global
  screen to the reference global screenshot, then decide whether Android needs
  a platform parity fix.
- Android global smoke must distinguish market from Java/Kotlin package names:
  `applicationId=com.vividrop.mobile.global` is the market package, while
  `com.vividrop.mobile.china.MainActivity` is only the historical Activity
  class path.
- Android global final visual evidence should run under the expected global
  review locale. Do not use language alone to infer market: the current
  reference global UI is mostly Chinese. CN-vs-global must be judged by market
  package/config, login entry, phone/SMS absence or presence, reference global
  screenshots, and business affordances.
- Do not fake native binding or queue state unless the row explicitly tests a
  mock preview surface; avoid changing sync state machine, DTOs, sidecar, or CN
  behavior for screenshots.
- If the app was already running, stop it before changing QA route values. iOS
  native constants come from launch env; Android constants come from the launch
  intent extras captured by `MainActivity`.
- Debug route-smoke screenshots may show the React Native
  `Open debugger to view warnings` overlay. Those screenshots are valid for
  route reachability, but not for final pixel comparison; final visual QA must
  remove the underlying warning or capture a build without the warning overlay.
- Reference, iOS, and Android screenshots should be tracked in a durable
  manifest before final goal completion. Temporary `/tmp` or
  `/var/folders/...` paths are acceptable for route-smoke triage, but the final
  pass must identify route, state, market, platform, build/configuration, date,
  and screenshot path for each evidence item.

| Area                      | Required states                                                                                                                                                                               | Reference evidence                                                                                                                                                                                                                                          | iOS evidence                                                                                                                                                                                                                                           | Android evidence                                                                                                                                                                                                                                   | Status  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Global auth               | cold-start login, no phone fallback, agreement modal, provider confirmation modal                                                                                                             | Reference captured: `/tmp/vividrop-ui-qa/reference-routes/auth-login.png`, `/tmp/vividrop-ui-qa/reference-routes/auth-agreement-provider-modal.png`, `/tmp/vividrop-ui-qa/reference-routes/auth-provider-authorization-modal.png`                           | login screenshot captured for `DebugGlobal`; modals pending                                                                                                                                                                                            | login screenshot captured for `globalDebug`; modals pending                                                                                                                                                                                        | partial |
| Shared chrome/native blur | bottom tab safe area, icon inventory, modal backdrop blur vs modal content on both platforms                                                                                                  | Reference modal/backdrop captured in auth/connect screenshots; bottom chrome visible in home/files/settings screenshots                                                                                                                                     | pending cold-start modal screenshots                                                                                                                                                                                                                   | pending cold-start modal screenshots                                                                                                                                                                                                               | partial |
| Home/sync activity        | bound/unbound home, reconnect/offline, paused/failed/complete, uploading, cloud-downloading, subscription overlay, recent downloads, read-only queue                                          | Reference captured: `/tmp/vividrop-ui-qa/reference-routes/home-sync-activity.png`, `/tmp/vividrop-ui-qa/reference-routes/home-sync-activity-uploading.png`                                                                                                  | iOS route smoke reached unconnected onboarding: `/tmp/vividrop-ui-qa/ios-routes/SyncActivity.png`; bound/sync states pending                                                                                                                           | Android route smoke reached SyncActivity but was blocked by nearby-devices permission prompt and RN warning overlay: `/tmp/vividrop-ui-qa/android-routes/syncactivity.png`; bound/sync states pending                                              | partial |
| Device pairing            | discovery empty/scanning/results, method modal, manual IP sheet, diagnostic modal, QR scanner, camera denied, code verify success/error, tutorial modal/backdrop                              | Reference captured: `/tmp/vividrop-ui-qa/reference-routes/connect-desktop-device-discovery.png`, `/tmp/vividrop-ui-qa/reference-routes/connect-method-modal.png`, `/tmp/vividrop-ui-qa/reference-routes/connect-code-modal.png`                             | iOS route smoke reached discovery empty/onboarding after resolving photo permission: `/tmp/vividrop-ui-qa/ios-routes/device-discovery.jpg`; tutorial first page: `/tmp/vividrop-ui-qa/ios-routes/ConnectionTutorial.png`; QR/code/modal states pending | pending                                                                                                                                                                                                                                            | partial |
| Files entry               | shared files cards, bottom tab alignment, entry navigation                                                                                                                                    | Reference captured: `/tmp/vividrop-ui-qa/reference-routes/files-remote-resources.png`                                                                                                                                                                       | iOS route smoke reached files entry: `/tmp/vividrop-ui-qa/ios-routes/SharedFiles.png`; bottom tab partly obscured by RN warning overlay                                                                                                                | pending                                                                                                                                                                                                                                            | partial |
| Phone sync space          | list density, filter/sort sheet, empty/search-empty, pagination or multi-page mock density                                                                                                    | Reference captured: `/tmp/vividrop-ui-qa/reference-routes/phone-sync-space.png`; phone sort is a bottom sheet, not centered modal                                                                                                                           | iOS route smoke reached dense multi-day mock list: `/tmp/vividrop-ui-qa/ios-routes/PhoneSyncSpace.png`; filter/sort/empty states pending                                                                                                               | pending                                                                                                                                                                                                                                            | partial |
| Remote access             | root grid/list, sort/filter control, folder navigation, empty folder, search-empty, selection/share sheet, pagination or multi-page mock density                                              | Reference captured: `/tmp/vividrop-ui-qa/reference-routes/remote-access-list.png`, `/tmp/vividrop-ui-qa/reference-routes/remote-access-grid.png`, `/tmp/vividrop-ui-qa/reference-routes/remote-access-selection-mode.png`; no pagination found in reference | iOS route smoke reached dense mock list: `/tmp/vividrop-ui-qa/ios-routes/RemoteAccess.png`; grid/folder/share/filter states pending                                                                                                                    | pending                                                                                                                                                                                                                                            | partial |
| History                   | loading, real empty, error, multi-day mock density, summary card, grouped records, pagination hint                                                                                            | Reference recent downloads captured: `/tmp/vividrop-ui-qa/reference-routes/recent-downloads.png`; direct `history` screenshot blocked because active reference app has no reachable `setView("history")` path                                               | iOS `DebugGlobal` launch-env smoke reached `History` empty state: `/var/folders/xx/zjxj2dw143xfd4xd1jf152b40000gn/T/screenshot_optimized_888a53db-4cf2-4c8a-8602-856be941c6ed.jpg`; remaining states pending                                           | Android route smoke reached History but remained in loading after 15s and showed RN warning overlay: `/tmp/vividrop-ui-qa/android-routes/history.png`, `/tmp/vividrop-ui-qa/android-routes/history-loading.png`; real empty/grouped states pending | partial |
| Album workbench           | permission denied/limited, loading, empty, error, grid/list density, filters, selection, disabled upload bar, preview modal/backdrop                                                          | Reference project has no dedicated global album screenshot in captured main view set; use secondary `album-page.tsx` reference if needed                                                                                                                    | iOS captured system full-photo permission prompt at `/tmp/vividrop-ui-qa/ios-routes/AlbumWorkbench.png` and grid state after permission at `/tmp/vividrop-ui-qa/ios-routes/album-workbench.jpg`; preview/error states pending                          | Android route smoke reached AlbumWorkbench but was blocked by nearby-devices permission prompt and RN warning overlay: `/tmp/vividrop-ui-qa/android-routes/albumworkbench.png`; grid/list/preview states pending                                   | partial |
| Auto-upload settings      | permission states, mock selected rows, custom date picker, save/disabled states                                                                                                               | Reference captured: `/tmp/vividrop-ui-qa/reference-routes/auto-upload-settings.png`                                                                                                                                                                         | iOS route smoke reached settings page: `/tmp/vividrop-ui-qa/ios-routes/AutoUploadSettings.png`; fixed mixed Chinese/English copy found during smoke                                                                                                    | Android route smoke reached AutoUploadSettings with RN warning overlay: `/tmp/vividrop-ui-qa/android-routes/autouploadsettings.png`; picker/save states pending                                                                                    | partial |
| Settings/account          | edit device name, restore purchase, gift card, language selector, diagnostics note, reset sync, forget/switch desktop, logout, delete account, public wake, global-vs-CN keepalive visibility | Reference captured: `/tmp/vividrop-ui-qa/reference-routes/settings.png`                                                                                                                                                                                     | iOS route smoke reached Settings account/device page: `/tmp/vividrop-ui-qa/ios-routes/settings.jpg`; secondary modals pending                                                                                                                          | Android route smoke reached Settings and showed `qa@example.com`, confirming mock login; RN warning overlay and zh-Hans system locale copy visible: `/tmp/vividrop-ui-qa/android-routes/settings.png`; secondary modals pending                    | partial |
| Help                      | FAQ/search, support mail action, diagnostics entry, gift-card switch and redeem modal/backdrop                                                                                                | Reference captured: `/tmp/vividrop-ui-qa/reference-routes/help.png`                                                                                                                                                                                         | iOS route smoke reached Help FAQ: `/tmp/vividrop-ui-qa/ios-routes/help.jpg`; gift-card/search/diagnostics states pending                                                                                                                               | Android route smoke reached Help with RN warning overlay: `/tmp/vividrop-ui-qa/android-routes/help.png`; gift-card/search/diagnostics states pending                                                                                               | partial |
| Subscription/membership   | member status, root paywall, catalog, retry/error banner, wallet/payment sheet, gift-card modal, restore flow, payment success, subscribed/trial/expired states                               | Reference captured: `/tmp/vividrop-ui-qa/reference-routes/membership-subscription.png`                                                                                                                                                                      | iOS route smoke reached subscribed gift-card member state: `/tmp/vividrop-ui-qa/ios-routes/subscription.jpg`; paywall/payment/restore/error states pending                                                                                             | Android route smoke reached Subscription but showed plan fetch failure banner and RN warning overlay: `/tmp/vividrop-ui-qa/android-routes/subscription.png`; paywall/payment/restore states pending                                                | partial |

Suggested screenshot batches:

1. Auth/no-login batch: cold-start login, agreement modal, provider modal, native
   backdrop on both platforms.
2. Shell batch: home, files entry, settings entry, bottom tab safe area and icon
   inventory on both platforms.
3. Pairing batch: device discovery, manual/code/QR/tutorial, permission denied
   and diagnostic modal states.
4. Remote resources batch: shared files, phone sync, remote access, filter/sort,
   empty/search-empty/folder/share states, and mock density.
5. Sync/history batch: sync activity cards, queue/read-only states, recent
   downloads, history loading/empty/error/grouped/pagination states.
6. Album batch: permission, grid/list, filters, selection, preview modal, and
   auto-upload settings.
7. Account/support/subscription batch: settings secondary modals, help/gift-card
   flows, membership/paywall/payment/restore/success states.

## Worker Final Output Contract

Every worker must finish with:

```text
STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
Changed files:
- path
Reference checked:
- path:line or component name
UI states covered:
- state
Validation:
- command: pass/fail/not run with reason
Risks:
- risk or none
Coordinator follow-up needed:
- item or none
```

## First Batch Recommendation

Start with Package 0 because it owns the shared primitives that every page consumes and because the Android native blur files are currently ignored. After Package 0 returns and is reviewed, Package 1, Package 2, Package 3, and Package 4 can run in parallel if their write scopes remain unchanged.

## Progress Ledger

| Package                                              | Status                                          | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Remaining coordinator action                                                                                                                |
| ---------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Package 0: Foundation / Native Modal / Shared Chrome | Integrated for next-page workers                | Spec review passed with baseline-aware scope review; code quality re-review passed; `git diff --check`, `pnpm --filter @lynavo-drive/mobile exec jest --runTestsByPath src/components/__tests__/BottomTabBar.test.tsx src/components/__tests__/Icon.test.tsx`, `pnpm --filter @lynavo-drive/mobile exec tsc --noEmit`, and Android `:app:compileGlobalDebugKotlin` passed. Android native `china/ui/*` files are no longer ignored.                                                                                                                                                                                                       | iOS cold-start visual check still required before final goal completion.                                                                    |
| Package 0B: Android Global Market Bridge             | Superseded by global-only OSS baseline          | Historical global-vs-CN market fallback issue. The current OSS baseline is global-only: Android `NativeMarketConfig`, iOS `AppleAuthModule`, market flavors, and third-party native auth resources have been removed. Runtime visual-QA launch flags now flow through the neutral `NativeAppRuntimeConfig` bridge.                                                                                                                                                                                                                                                                                                                        | Do not reintroduce native market/auth bridges in OSS. Future official builds must carry any account/social-login integration in an overlay. |
| Package 0C: Dev-only Visual QA Bootstrap             | Integrated for screenshot workers               | Added `SYNCFLOW_VISUAL_QA=1` mock-token bootstrap, authenticated route whitelist, and optional remote-resource preview flag. It is gated by `__DEV__`, leaves existing tokens untouched, and still uses normal profile bootstrap. Real iOS smoke initially proved Metro env is insufficient; follow-up moved QA config to native launch env / Android intent extras and added dev sandbox TURN/refresh mocks so startup requests do not clear mock auth. Targeted tests, mobile `tsc --noEmit`, iOS `DebugGlobal` build/run, Android `:app:compileGlobalDebugKotlin`, `git diff --check`, and iOS `History` launch-env screenshot passed. | Use this only for visual QA screenshot runs; never use it to simulate real sync binding, queue, or protocol behavior.                       |
| Package 1: Global Auth                               | Reviewed and accepted                           | Package review passed; `LoginGlobalScreen.test.tsx` passed; integrated mobile `tsc --noEmit` passed; first-batch Jest suite passed. iOS `SyncFlowMobileGlobal` with `DebugGlobal` and Android `globalDebug` cold-start screenshots both showed global Google/Apple login with no phone fallback.                                                                                                                                                                                                                                                                                                                                          | Provider/agreement modal screenshots still need to be captured in the full-page visual pass.                                                |
| Package 2: Remote Resources                          | Reviewed and accepted after fix                 | Initial review caught runtime mock fallback pollution; fix gated preview mocks and restored real empty/unbound states. Final re-review passed; `SharedFilesDownloadGate.test.tsx` passed with bound host, empty, search-empty, and download coverage.                                                                                                                                                                                                                                                                                                                                                                                     | Include files/phone sync/remote access screenshots and Android/iOS scroll-state checks.                                                     |
| Package 3: History / Sync Records                    | Reviewed and accepted after fix                 | Initial review caught desktop identity mapping; fix uses binding alias/name for real records and added grouped-summary regression coverage. Re-review passed; `HistoryScreen.test.tsx` passed.                                                                                                                                                                                                                                                                                                                                                                                                                                            | Ensure new `HistoryScreen.test.tsx` is included in final staged changes.                                                                    |
| Package 4A: Help Center                              | Reviewed and accepted after fix                 | Initial review caught inert support email and gift-card close regression; fix restored `mailto:` action and guarded/cleared gift-card modal close. Re-review passed; `HelpScreen.test.tsx` passed.                                                                                                                                                                                                                                                                                                                                                                                                                                        | Include help/gift-card modal screenshot pass.                                                                                               |
| Package 4B: Settings / Account                       | Reviewed and accepted with non-blocking concern | Review passed with concern about existing diagnostic test warnings from gift-card config mocks. Settings targeted tests passed; integrated first-batch Jest suite passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Keep test warning cleanup on backlog; include settings secondary flows in screenshot/manual QA.                                             |
| Package 5: Home / Sync / Device Pairing              | Reviewed and accepted after test-harness fix    | Review passed with concern that `SyncActivityScreen.onboarding.test.tsx` had a stale safe-area mock; follow-up fixed the mock. Package 5 targeted tests and the integrated targeted Jest suite passed. Queue UI remains read-only.                                                                                                                                                                                                                                                                                                                                                                                                        | Include home, pairing, QR/code, tutorial, camera-denied, and reconnect/sync-state screenshots.                                              |
| Package 6: Album / Auto Upload / Preview             | Reviewed and accepted after rework              | Initial review failed album error-state handling, mock-only auto-upload activation, disconnected file-selection affordance, and test depth. Follow-up fixed those; re-review passed. Package 6 targeted tests and integrated targeted Jest suite passed.                                                                                                                                                                                                                                                                                                                                                                                   | Include album grid/list, permission/error, preview modal, and auto-upload settings screenshots.                                             |
| Package 7: Subscription / Membership                 | Reviewed and accepted after polish              | Review passed with locale/test concerns; follow-up added `subscription.member.*` locale keys for `en`, `zh-Hans`, and `zh-Hant`, removed inline membership fallbacks, and added root paywall back/logout coverage. Follow-up review passed, mobile `tsc --noEmit` passed, and integrated targeted Jest suite passed.                                                                                                                                                                                                                                                                                                                      | Include membership, root paywall, payment, gift-card, restore, and success modal screenshots.                                               |

## Continuation Validation Log

2026-06-16 continuation pass:

- `pnpm --filter @lynavo-drive/mobile exec tsc --noEmit`: pass.
- `git diff --check`: pass.
- QA/bootstrap regression suite passed: `api-dev-sandbox.test.ts`, `visualQa.test.ts`, `auth-store-visual-qa.test.tsx`, and `RootNavigator.fail-open.test.tsx`; 4 suites / 18 tests.
- Integrated mobile UI targeted suite passed: 27 suites / 281 tests, covering market config, shared chrome/icons, global login, files/history/help/settings/sync/device pairing/album/auto-upload/subscription, and visual QA bootstrap tests.
- Known non-blocking Jest warnings remain: market debug logs, RN `InteractionManager`/`Clipboard` deprecation logs, expected `CodeVerifyScreen` native pairing error path, SyncActivity read-only queue mock warning, subscription StoreKit mock filtering, and subscription `act(...)` warnings.
- Android visual route smoke on `emulator-5554` (`Android 16`, `1080x2400`) built and installed `globalDebug`, then launched routes through `com.vividrop.mobile.global/com.vividrop.mobile.china.MainActivity`. This confirms mock login/bootstrap can reach post-login pages on Android, but it is not a final visual pass because screenshots include RN warning overlay, zh-Hans emulator locale copy, permission prompts, History loading, and Subscription network error.
- User review of the Android smoke identified a more important issue: several
  screenshots are not just noisy, they still show the older shared/CN-shaped
  page layouts instead of the latest global reference structures. Confirmed
  examples: reference Settings is `我的` with account/subscription/device cards
  and 3-tab shell, while RN Settings smoke shows `设置` and older account/device
  sections; reference Home is `同步工作台`, while RN SyncActivity smoke shows the
  older `同步动态` structure. Treat those pages as implementation gaps, not
  evidence gaps.
- Coordinator correction after user feedback: Android screenshots are useful for
  detecting market fallback and old shared/CN-shaped screens, but the ongoing
  restoration baseline is iOS global. Global may temporarily use Chinese copy
  for direct reference comparison; Chinese text alone is not evidence that the
  screen is CN.
- iOS primary route smoke has been re-established with `SyncFlowMobileGlobal`
  - `DebugGlobal` + visual QA launch env. The post-login Settings route reached
    the global account page (`我的`, mock `qa@example.com`) at
    `/tmp/vividrop-ui-qa/ios-routes-primary/settings.jpg`.

## Remaining Evidence / Restoration Risk Register

This section is the coordinator's active gap list. It exists because passing
tests and accepted package reviews are not enough to claim one-to-one visual
completion.

1. Reference screenshots are still pending for every matrix row. Current iOS
   screenshots are route-reachability evidence only; they do not prove visual
   parity until paired with reference screenshots from
   `/Volumes/workspace/work/vividrop-ui-mobile`.
2. Android route-smoke evidence exists for several post-login routes, but the
   pass is not clean. Before final comparison, rerun with a clean app state,
   the locale expected by the reference screenshot being compared, required
   Android permissions pre-granted or intentionally captured, and the RN
   warning overlay removed.
   2a. iOS route-smoke evidence is now the main acceptance input. Android evidence
   should not overrule an iOS/reference mismatch; it should create an Android
   parity follow-up after iOS is aligned.
3. Shared chrome and native modal blur remain the highest cross-cutting visual
   risk. Final evidence must separate backdrop behavior from modal content,
   because this was the main repeated login-page failure mode.
4. Route-level visual QA cannot force all hidden states by itself. Modal-open,
   filter-active, selected, paginated, payment-result, sync-progress, and
   folder-depth states still need page-specific instrumentation, manual
   interaction, or targeted fixtures.
5. Dirty simulator/emulator state can hide visual-QA failures because mock
   credentials are only seeded when no persisted tokens exist. Cold-start
   screenshot runs must explicitly reset auth state or reinstall/clear app
   data.
6. The remote-resource preview flag is valid only for UI density screenshots.
   It must not be used as proof of real sidecar binding, queue behavior, sync
   protocol, or DTO correctness.
7. The login-page retrospective remains mandatory for every page: check market
   boundary, reference source mapping, icon inventory, modal/backdrop layering,
   filter/segmented controls, pagination/mock density, and secondary flows
   before accepting a page.
8. Do not accept a page because it merely launches under the global package.
   The global package can still render an old shared/CN-shaped RN screen. Each
   route must be compared structurally against the captured reference global
   screenshot before it moves from route-smoke to visual-comparison status.

## Active Page Structure Gap Queue

These gaps were exposed by comparing Android route-smoke screenshots with the
captured reference global screenshots. They are implementation gaps, not merely
missing evidence.

| Route             | Reference screenshot                                                                                                                   | Current smoke screenshot                              | Gap                                                                                                                                                                                                              | Owner               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Settings          | `/tmp/vividrop-ui-qa/reference-routes/settings.png`                                                                                    | `/tmp/vividrop-ui-qa/android-routes/settings.png`     | Reference is `我的` account tab with account/subscription/device/general cards; RN smoke still shows older `设置` structure.                                                                                     | Settings worker     |
| SyncActivity/Home | `/tmp/vividrop-ui-qa/reference-routes/home-sync-activity.png`, `/tmp/vividrop-ui-qa/reference-routes/home-sync-activity-uploading.png` | `/tmp/vividrop-ui-qa/android-routes/syncactivity.png` | Reference is `同步工作台` with auto-sync and sync-status workbench cards; RN smoke still shows older `同步动态` structure and is additionally blocked by Android permission prompt.                              | SyncActivity worker |
| Help              | `/tmp/vividrop-ui-qa/reference-routes/help.png`                                                                                        | `/tmp/vividrop-ui-qa/android-routes/help.png`         | Must verify header/card density against reference and keep support/gift-card/diagnostic flows styled inside the same visual system.                                                                              | Help worker         |
| Subscription      | `/tmp/vividrop-ui-qa/reference-routes/membership-subscription.png`                                                                     | `/tmp/vividrop-ui-qa/android-routes/subscription.png` | Reference is compact membership status + benefits card + renew/gift-card actions; RN smoke shows current business page with network-error banner and needs visual alignment without changing purchase semantics. | Subscription worker |

After each owner returns, coordinator must run the relevant targeted tests,
re-run route smoke where feasible, and only then update the matrix row from
implementation-gap to visual-comparison status.
