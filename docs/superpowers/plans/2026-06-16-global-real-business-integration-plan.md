# Global Real Business Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace global mobile UI mock data with existing real Vivi Drop business logic while preserving the global-only UI split and leaving CN screens untouched.

**Architecture:** Global screens remain the presentation boundary. They should consume existing shared services, `SyncEngineModule` wrappers, auth store state, and `@lynavo-drive/contracts` DTOs rather than duplicating CN UI or redefining protocol types. Shared services can be touched only when a real business gap exists and must be verified against CN call sites.

**Tech Stack:** React Native, TypeScript strict mode, React Navigation, AsyncStorage, NativeSyncEngine bridge, `@lynavo-drive/contracts`, Jest/React Native Testing Library.

---

## Coordination Rules

- Main agent coordinates, reviews, integrates, and verifies. Implementation should be delegated to workers where scopes are independent.
- Workers must not edit CN screens: `DeviceDiscoveryScreen.tsx`, `SyncActivityScreen.tsx`, `SettingsScreen.tsx`, `RemoteAccessScreen.tsx`, `PhoneSyncSpaceScreen.tsx`, `HistoryScreen.tsx`, `AutoUploadSettingsScreen.tsx`, `SharedFilesScreen.tsx`.
- Workers must not edit `@lynavo-drive/contracts`, native SyncEngine, sidecar protocol, queue semantics, or sync state machine unless a later task explicitly scopes that work.
- No worker should revert existing edits made by the user or by another worker.
- Every worker must report changed files, tests run, and any risks or unimplemented edge cases.
- Completed subagents may be closed after returning. Running subagents should not be closed early; if a stop is unavoidable, ask them to wrap up first.

## Current Audit Summary

- Login global is already mostly real: Google/Apple/email auth uses existing auth service; only visual QA token hydration remains gated by `isVisualQaEnabled()`.
- Connection global still has mock/shortcut paths: visual QA LAN devices, fixed code success, direct `NativeModules.NativeSyncEngine.pairDevice` usage, and no recent-desktop token reconnect path.
- Home and sync sections still use fixed sync records, fixed upload progress, fixed totals, and visual QA download fallback.
- Auto upload global saves only UI state and calls `enableAutoUpload()` without persisting `timeRangeMode/customTimeFrom`.
- History global injects `MOCK_HISTORY_ITEMS` and fake duration fallback.
- Remote access and phone sync space still fallback to mock data when real lists are empty.
- Settings global still uses mock account/device/subscription/current desktop data and local-only actions.
- `desktop-local-service.downloadResource()` performs the request but returns `/mock/path/{resourceId}` instead of a real saved path.

## Integration Order

1. Global connection correctness: real pairing wrapper, recent-token reconnect, and mock containment.
2. Global settings real state/actions: auth, subscription, language, logout/delete, device name, app version.
3. Auto upload global config: hydrate/save real native config before enabling.
4. Sync activity global state: `getSyncOverview`, queue/history events, recent downloads from storage.
5. History/download records cleanup: remove production mock fallback and fake records.
6. Remote resources and phone sync space: remove production mock fallback and fix download persistence.
7. Shared bridge parity only if a real screen cannot be completed with existing JS/native APIs.

## Task 1: Global Connection Real Pairing

**Owner:** Worker, isolated.

**Files:**
- Modify: `apps/mobile/src/screens/DeviceDiscoveryGlobalScreen.tsx`
- Modify/Test: `apps/mobile/src/screens/__tests__/DeviceDiscoveryGlobalScreen.onboarding.test.tsx`

- [ ] Replace direct `NativeModules.NativeSyncEngine.pairDevice` calls in global connection UI with `pairDevice` from `apps/mobile/src/services/SyncEngineModule.ts`.
- [ ] Map `PairingError` codes to global UI states for wrong code, blocked, version incompatible, and unknown.
- [ ] For recent desktops, attempt token reconnect with empty `connectionCode` before showing manual pairing UI.
- [ ] Keep visual QA shortcuts gated by `isVisualQaEnabled()` only.
- [ ] Do not change CN `DeviceDiscoveryScreen.tsx` or `CodeVerifyScreen.tsx`.

**Verification:**

```bash
pnpm --filter @lynavo-drive/mobile test -- DeviceDiscoveryGlobalScreen
pnpm --filter @lynavo-drive/mobile test -- recent-desktops-store
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
```

## Task 2: Global Settings Real State And Account Actions

**Owner:** Worker, isolated after Task 7 wrapper decision if wrappers are needed.

**Files:**
- Modify: `apps/mobile/src/screens/SettingsGlobalScreen.tsx`
- Modify/Test: `apps/mobile/src/screens/__tests__/SettingsGlobalScreen.test.tsx`
- Optional helper: `apps/mobile/src/screens/settings-global/*`

- [ ] Replace account mock with `useAuth().user.primaryIdentity` / `identities`.
- [ ] Replace subscription mock with `useAuth().subscription` and existing subscription display utilities where suitable.
- [ ] Read/write device name via NativeSyncEngine wrapper or guarded `NativeModules.NativeSyncEngine.getClientDisplayName/setClientDisplayName`.
- [ ] Read app version via NativeSyncEngine `getAppInfo` or platform-safe fallback.
- [ ] Save language through `saveLanguagePreference`, `resolveLanguagePreference`, and `i18n.changeLanguage`.
- [ ] Restore purchases through existing global IAP/Subscription flow; do not enable unsupported Android restore.
- [ ] Logout with server `logout(refreshToken)` best-effort, sidecar reset best-effort, `wipeSyncIdentity`, `clearUserScopedStorage`, transition `logout`, then `clearAuth`.
- [ ] Delete account with server `deleteAccount()` first, then local cleanup; surface subscription-blocked errors.
- [ ] Do not change CN `SettingsScreen.tsx`.

**Verification:**

```bash
pnpm --filter @lynavo-drive/mobile test -- SettingsGlobalScreen
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
```

## Task 3: Global Auto Upload Real Config

**Owner:** Worker, isolated.

**Files:**
- Modify: `apps/mobile/src/screens/AutoUploadSettingsGlobalScreen.tsx`
- Modify/Test: `apps/mobile/src/screens/__tests__/AutoUploadSettingsGlobalScreen.test.tsx`

- [ ] Hydrate initial state from `getAutoUploadConfig()`.
- [ ] Save `enabled`, `timeRangeMode`, and `customTimeFrom` through `saveAutoUploadConfig()` before enabling.
- [ ] Call `enableAutoUpload()` only after successful config save.
- [ ] Keep arbitrary file-source selection as UI-only unless native queue support exists; do not imply unsupported manual file upload.
- [ ] Remove random mock file generation from production interaction paths.
- [ ] Do not change CN `AutoUploadSettingsScreen.tsx` or album queue semantics.

**Verification:**

```bash
pnpm --filter @lynavo-drive/mobile test -- AutoUploadSettingsGlobalScreen
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
```

## Task 4: Global Sync Activity Real State

**Owner:** Worker, isolated after Task 7 if typed wrappers are needed.

**Files:**
- Modify: `apps/mobile/src/screens/SyncActivityGlobalScreen.tsx`
- Modify: `apps/mobile/src/screens/components/GlobalSyncActivityHomeSections.tsx` only if section props need real-state shape changes
- Modify/Test: `apps/mobile/src/screens/__tests__/SyncActivityGlobalScreen.test.tsx`
- Modify/Test: `apps/mobile/src/screens/components/__tests__/GlobalSyncActivityHomeSections.test.tsx` only if touched

- [ ] Replace `ACTIVE_UPLOAD_PROGRESS` with `SyncSummaryDTO` derived state from `getSyncOverview()` and `onSyncStateChanged`.
- [ ] Replace fixed sync record days/totals with `listHistory()` or native history normalizer.
- [ ] Keep queue display read-only by using `getReadOnlyQueue()` / `onQueueUpdated`; do not add deletion, skip, or reorder controls.
- [ ] Keep recent downloads sourced from `download-records-service`.
- [ ] Remove production fallback to visual QA mock downloads; visual QA may remain gated explicitly.
- [ ] Do not change CN `SyncActivityScreen.tsx`, `SyncStatusScreen.tsx`, or `AlbumWorkbenchScreen.tsx`.

**Verification:**

```bash
pnpm --filter @lynavo-drive/mobile test -- SyncActivityGlobalScreen GlobalSyncActivityHomeSections
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
```

## Task 5: Global History And Download Records No Production Mock

**Owner:** Worker, isolated.

**Files:**
- Modify: `apps/mobile/src/screens/HistoryGlobalScreen.tsx`
- Modify: `apps/mobile/src/screens/DownloadRecordsGlobalScreen.tsx`
- Modify/Test: `apps/mobile/src/screens/__tests__/HistoryGlobalScreen.test.tsx`
- Modify/Test: `apps/mobile/src/screens/__tests__/DownloadRecordsGlobalScreen.test.tsx`

- [ ] Remove `MOCK_HISTORY_ITEMS` injection for production empty/error states.
- [ ] Remove fake duration fallback for real history rows.
- [ ] Preserve real `listHistory()` usage and show global empty/error UI when no records exist.
- [ ] Remove production fallback from download records to visual QA data.
- [ ] Keep visual QA data gated by `isVisualQaEnabled()` only if needed for visual tests.
- [ ] Do not change CN `HistoryScreen.tsx`.

**Verification:**

```bash
pnpm --filter @lynavo-drive/mobile test -- HistoryGlobalScreen DownloadRecordsGlobalScreen
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
```

## Task 6: Global Remote Resources And Phone Sync Space

**Owner:** Worker, isolated from Task 5, but may need shared service review.

**Files:**
- Modify: `apps/mobile/src/screens/RemoteAccessGlobalScreen.tsx`
- Modify: `apps/mobile/src/screens/PhoneSyncSpaceGlobalScreen.tsx`
- Modify: `apps/mobile/src/screens/SharedFilesGlobalScreen.tsx`
- Modify/Test: relevant global tests

- [ ] Remove production fallback to `MOCK_ROOT_ITEMS`, `MOCK_FOLDER_CONTENTS`, and `MOCK_RECEIVED_ITEMS`.
- [ ] Use `listSharedResources()` and `listReceivedLibrary()` as real list sources.
- [ ] For unsupported nested folder browse through sidecar, show a real limitation/empty state instead of mock folder contents.
- [ ] Wire item download actions to existing download service where real API is available.
- [ ] Do not change CN remote/shared/phone sync screens.

**Verification:**

```bash
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
pnpm --filter @lynavo-drive/mobile test -- SharedFilesDownloadGate
```

## Task 7: Shared JS Bridge Wrappers

**Owner:** Worker, isolated. Run before Tasks 2 and 4 only if those tasks need wrappers beyond existing exports.

**Files:**
- Modify: `apps/mobile/src/services/SyncEngineModule.ts`
- Modify/Test: `apps/mobile/src/services/__tests__/SyncEngineModule.*.test.ts`

- [ ] Add typed wrappers for existing native methods only: `getBindingState`, `getSyncOverview`, `getReadOnlyQueue`, `getHistoryDays`, `getClientDisplayName`, `setClientDisplayName`, `getAppInfo`.
- [ ] Add platform-safe guards only where the native method is optional.
- [ ] Do not redefine DTOs; import from `@lynavo-drive/contracts`.
- [ ] Do not modify native code, contracts, or CN pages in this task.

**Verification:**

```bash
pnpm --filter @lynavo-drive/mobile test -- SyncEngineModule
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
```

## Task 8: Download Persistence Gap

**Owner:** Worker, shared service task. Do after remote resource UI scope is clear.

**Files:**
- Modify: `apps/mobile/src/services/desktop-local-service.ts`
- Modify/Test: `apps/mobile/src/services/__tests__/download-records-service.test.ts`
- Optional: global remote/download tests

- [ ] Replace `/mock/path/{resourceId}` with a real saved local path if the current RN/native environment exposes a safe save target.
- [ ] If JS cannot save the sidecar response safely on both platforms, report the native bridge requirement instead of faking a path.
- [ ] Verify any changed shared service against global and CN call sites.

**Verification:**

```bash
pnpm --filter @lynavo-drive/mobile test -- download-records-service
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
```

## Final Verification

```bash
pnpm --filter @lynavo-drive/mobile test
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
pnpm verify:android-syncengine-bridge
```

If native or sidecar files are later touched:

```bash
cd services/sidecar-go && go test ./...
```

Run iOS/Android simulator builds only after the JS integration passes and native scope is known.
