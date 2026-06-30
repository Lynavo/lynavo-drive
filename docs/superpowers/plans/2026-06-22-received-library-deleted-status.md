# Received Library Deleted Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep deleted desktop files visible in mobile sync space while marking them as deleted and disabling preview/download.

**Architecture:** Add an explicit received-library `fileStatus` DTO field that is independent from share state. The Go sidecar computes this from the stored `final_path` and filesystem state, suppresses preview URLs for deleted files, and mobile UI treats deleted items as non-actionable.

**Tech Stack:** TypeScript contracts, Go sidecar, React Native mobile, Jest/Vitest/Go tests.

---

### Task 1: Sidecar File Status

**Files:**
- Modify: `services/sidecar-go/internal/store/models.go`
- Modify: `services/sidecar-go/internal/store/received_library.go`
- Test: `services/sidecar-go/internal/store/received_library_test.go`

- [x] Add a failing test that inserts one completed upload with an existing final file and one completed upload whose final file is missing, then asserts `FileStatus` is `available` and `deleted`.
- [x] Run `go test ./internal/store -run TestReceivedLibraryMarksDeletedFiles -count=1` from `services/sidecar-go` and confirm it fails because `FileStatus` is missing/empty.
- [x] Add `FileStatus string json:"fileStatus"` to `ReceivedLibraryItem` and set it from `uploadfs.FinalFileExists`.
- [x] Re-run the targeted Go test and confirm it passes.

### Task 2: Mobile Received URLs

**Files:**
- Modify: `services/sidecar-go/internal/api/handlers_resources.go`
- Test: `services/sidecar-go/internal/api/resources_handlers_test.go`

- [x] Add a failing API test for `/resources/mobile/received?scope=client` where a missing final file returns `fileStatus: deleted` and no `thumbnailUrl`, `previewUrl`, or `streamUrl`.
- [x] Run `go test ./internal/api -run TestMobileReceivedLibraryMarksDeletedFilesWithoutPreviewURLs -count=1` and confirm it fails.
- [x] Skip URL enrichment for deleted received items.
- [x] Re-run the targeted API test and confirm it passes.

### Task 3: Mobile UI Guards

**Files:**
- Modify: `packages/contracts/src/types.ts`
- Modify: `apps/mobile/src/screens/PhoneSyncSpaceScreen.tsx`
- Modify: `apps/mobile/src/screens/PhoneSyncSpaceGlobalScreen.tsx`
- Modify: `apps/mobile/src/i18n/locales/zh-Hant/sharedFiles.json`
- Modify: `apps/mobile/src/i18n/locales/zh-Hans/sharedFiles.json`
- Modify: `apps/mobile/src/i18n/locales/en/sharedFiles.json`
- Test: `apps/mobile/src/screens/__tests__/SharedFilesDownloadGate.test.tsx`

- [x] Add failing mobile tests that render `fileStatus: deleted`, verify the deleted badge is shown, and verify preview/download handlers are not called.
- [x] Run the targeted Jest test and confirm it fails.
- [x] Add `fileStatus?: 'available' | 'deleted'` to `ReceivedLibraryItemDTO`.
- [x] Add UI guards, disabled states, and localized copy for deleted received items in both phone sync screens.
- [x] Re-run the targeted mobile test and confirm it passes.

### Task 4: Verification

**Files:**
- All files touched above.

- [x] Run `go test ./internal/store ./internal/api` from `services/sidecar-go`.
- [x] Run the targeted mobile Jest test.
- [x] Run `pnpm build` because `@lynavo-drive/contracts` changed.
- [x] Run `pnpm --filter @lynavo-drive/mobile exec tsc --noEmit`.
- [x] Review `git diff` for unintended protocol, queue, sync state, persistence, or unrelated UI changes.
