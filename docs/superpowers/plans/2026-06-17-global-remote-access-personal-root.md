# Global Remote Access Personal Root Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make global mobile `Remote Access Computer` browse the existing desktop personal root, preserving the old `My Computer` content.

**Architecture:** Keep sidecar unchanged and add a mobile service adapter over the existing native personal-directory bridge. The global remote access screen will receive the same `DesktopSharedResourceDTO` shape it already renders, but operations for `personal-dir:` items will route through `scope='personal'`.

**Tech Stack:** React Native, TypeScript, Jest, existing `SyncEngineModule` native bridge, `@lynavo-drive/contracts` DTOs.

---

### Task 1: Add Failing Service Tests

**Files:**
- Modify: `apps/mobile/src/services/__tests__/desktop-local-service.test.ts`

- [ ] **Step 1: Import the new global personal helpers after they are defined**

```ts
import {
  downloadGlobalRemoteAccessResource,
  listGlobalRemoteAccessFolderContents,
  listGlobalRemoteAccessResources,
  prepareGlobalRemoteAccessPreview,
  shareGlobalRemoteAccessResources,
} from '../desktop-local-service';
```

- [ ] **Step 2: Mock `SyncEngineModule` personal directory bridge functions**

```ts
jest.mock('../SyncEngineModule', () => ({
  getClientId: jest.fn(),
  browseDirectory: jest.fn(),
  downloadDirectoryFile: jest.fn(),
  prepareDirectoryFilePreview: jest.fn(),
}));
```

- [ ] **Step 3: Add tests for root listing, folder listing, download, preview, and share**

```ts
it('lists global remote access from the desktop personal directory root', async () => {
  mockedBrowseDirectory.mockResolvedValueOnce({
    scope: 'personal',
    path: '',
    files: [
      { name: 'Desktop', path: 'Desktop', type: 'other', size: 96, modifiedAt: '2026-06-17T08:00:00.000Z', isDirectory: true },
      { name: 'notes.txt', path: 'notes.txt', type: 'document', size: 12, modifiedAt: '2026-06-17T08:01:00.000Z' },
    ],
    totalCount: 2,
  });

  await expect(listGlobalRemoteAccessResources()).resolves.toEqual([
    expect.objectContaining({ resourceId: 'personal-dir:Desktop', kind: 'shared_folder', displayName: 'Desktop' }),
    expect.objectContaining({ resourceId: 'personal-dir:notes.txt', kind: 'shared_file', displayName: 'notes.txt' }),
  ]);
  expect(mockedBrowseDirectory).toHaveBeenCalledWith('personal');
});
```

- [ ] **Step 4: Run red test**

Run:

```bash
pnpm --filter @lynavo-drive/mobile test -- desktop-local-service.test.ts
```

Expected: FAIL because the new helper exports do not exist.

### Task 2: Implement Personal Directory Adapter

**Files:**
- Modify: `apps/mobile/src/services/desktop-local-service.ts`
- Modify: `apps/mobile/src/screens/RemoteAccessGlobalScreen.tsx`

- [ ] **Step 1: Add local personal resource id helpers**

```ts
const PERSONAL_DIRECTORY_RESOURCE_PREFIX = 'personal-dir:';
const PERSONAL_DIRECTORY_DESKTOP_ID = 'personal-dir';
```

- [ ] **Step 2: Export personal listing helpers**

```ts
export async function listGlobalRemoteAccessResources(): Promise<DesktopSharedResourceDTO[]> {
  const listing = await browseDirectory('personal');
  return listing.files.map(personalDirectoryFileToSharedResource);
}
```

- [ ] **Step 3: Route personal download, preview, and share operations through native bridge**

```ts
export async function downloadGlobalRemoteAccessResource(resourceId: string): Promise<ResourceDownloadResult> {
  return downloadDirectoryFile('personal', getPersonalDirectoryPathFromResourceId(resourceId));
}
```

- [ ] **Step 4: Update `RemoteAccessGlobalScreen` imports and callbacks**

Replace global screen usage of `listSharedResources`, `listSharedFolderContents`, `downloadResourceForGlobal`, `prepareResourcePreview`, and `shareResources` with the new global personal helpers.

- [ ] **Step 5: Run green test**

Run:

```bash
pnpm --filter @lynavo-drive/mobile test -- desktop-local-service.test.ts
```

Expected: PASS.

### Task 3: Verification And Review

**Files:**
- Review: `apps/mobile/src/services/desktop-local-service.ts`
- Review: `apps/mobile/src/screens/RemoteAccessGlobalScreen.tsx`
- Review: `apps/mobile/src/services/__tests__/desktop-local-service.test.ts`

- [ ] **Step 1: Run focused mobile tests**

```bash
pnpm --filter @lynavo-drive/mobile test -- desktop-local-service.test.ts SharedFilesDownloadGate.test.tsx
```

- [ ] **Step 2: Run TypeScript check**

```bash
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
```

- [ ] **Step 3: Self-review impact scope**

Confirm that the change only affects global remote access data source and does not alter contracts, sidecar APIs, queue semantics, sync state machine, persistence, or desktop settings.
