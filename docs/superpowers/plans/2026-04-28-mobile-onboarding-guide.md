# Mobile Onboarding Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two install-lifetime mobile onboarding experiences: the unconnected post-login guide and the first successful sync activity tour.

**Implementation status:** Completed. The Sync Activity tour now uses measured target layouts from the live screen instead of static screenshot ratios, and renders its rounded cutout / border through `react-native-svg`.

**Architecture:** Store onboarding completion in device-scoped AsyncStorage keys so logout/account switches do not reset the guides. Keep UI in small dedicated onboarding components, mounted by `DeviceDiscoveryScreen` and `SyncActivityScreen` without changing SyncEngine state or navigation contracts.

**Tech Stack:** React Native 0.84, React 19, TypeScript, AsyncStorage, React Navigation, Jest + @testing-library/react-native.

**Latest A tour visual requirements:** A appears only after a computer connection succeeds, and only once per app install lifecycle. Its five steps map to the provided screenshots:

1. `1/5`: highlight the bottom-left album quick entry, coach title `手動同步`, primary `下一步 1/5`.
2. `2/5`: highlight the main sync status card, coach title `無感備份`, primary `下一步 2/5`.
3. `3/5`: highlight the header transfer-history icon, coach title `傳輸歷史`, primary `下一步 3/5`.
4. `4/5`: highlight the header settings icon, coach title `全域設定`, primary `下一步 4/5`.
5. `5/5`: highlight the header help icon, coach title `幫助中心`, final primary `開啟旅程`.

**A tour highlight positioning:** Highlight targets are measured from the live `SyncActivityScreen` elements with `measureInWindow` and passed into `SyncActivityTour`. The tour still keeps ratio-based fallback rectangles for the first render, but production alignment follows real header buttons, the main sync card, and the album quick-entry card.

---

## File Structure

- Create `apps/mobile/src/utils/onboardingStorage.ts`: device-scoped AsyncStorage API for read/write of the two guide flags.
- Create `apps/mobile/src/utils/__tests__/onboardingStorage.test.ts`: storage behavior and failure fallback tests.
- Create `apps/mobile/src/components/onboarding/UnconnectedGuide.tsx`: C guide shown over the unconnected discovery screen.
- Create `apps/mobile/src/components/onboarding/SyncActivityTour.tsx`: A guide overlay shown over sync activity after first successful binding.
- Modify `apps/mobile/src/screens/DeviceDiscoveryScreen.tsx`: load C flag, show `UnconnectedGuide` only in initial unconnected mode, mark seen on skip/start.
- Modify `apps/mobile/src/screens/SyncActivityScreen.tsx`: load A flag after binding + initial load, show `SyncActivityTour`, mark seen on skip/finish.
- Modify `apps/mobile/src/i18n/locales/{zh-Hant,zh-Hans,en}/deviceDiscovery.json`: C guide copy.
- Modify `apps/mobile/src/i18n/locales/{zh-Hant,zh-Hans,en}/syncActivity.json`: A tour copy.
- Modify `apps/mobile/src/utils/__tests__/clearUserScopedStorage.test.ts`: prove onboarding keys are preserved across user-scoped cleanup.
- Add focused screen tests beside the existing screen tests.

## Task 1: Onboarding Storage

**Files:**
- Create: `apps/mobile/src/utils/onboardingStorage.ts`
- Create: `apps/mobile/src/utils/__tests__/onboardingStorage.test.ts`

- [ ] **Step 1: Write failing storage tests**

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  hasSeenSyncActivityTour,
  hasSeenUnconnectedGuide,
  markSyncActivityTourSeen,
  markUnconnectedGuideSeen,
  ONBOARDING_SYNC_ACTIVITY_TOUR_SEEN_KEY,
  ONBOARDING_UNCONNECTED_GUIDE_SEEN_KEY,
} from '../onboardingStorage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

describe('onboardingStorage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reads both device-scoped onboarding flags', async () => {
    (AsyncStorage.getItem as jest.Mock)
      .mockResolvedValueOnce('1')
      .mockResolvedValueOnce(null);

    await expect(hasSeenUnconnectedGuide()).resolves.toBe(true);
    await expect(hasSeenSyncActivityTour()).resolves.toBe(false);

    expect(AsyncStorage.getItem).toHaveBeenNthCalledWith(
      1,
      ONBOARDING_UNCONNECTED_GUIDE_SEEN_KEY,
    );
    expect(AsyncStorage.getItem).toHaveBeenNthCalledWith(
      2,
      ONBOARDING_SYNC_ACTIVITY_TOUR_SEEN_KEY,
    );
  });

  it('marks both onboarding guides as seen', async () => {
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);

    await markUnconnectedGuideSeen();
    await markSyncActivityTourSeen();

    expect(AsyncStorage.setItem).toHaveBeenNthCalledWith(
      1,
      ONBOARDING_UNCONNECTED_GUIDE_SEEN_KEY,
      '1',
    );
    expect(AsyncStorage.setItem).toHaveBeenNthCalledWith(
      2,
      ONBOARDING_SYNC_ACTIVITY_TOUR_SEEN_KEY,
      '1',
    );
  });

  it('falls back to seen when read fails so onboarding does not loop', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValue(new Error('storage unavailable'));

    await expect(hasSeenUnconnectedGuide()).resolves.toBe(true);
    await expect(hasSeenSyncActivityTour()).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Run storage tests and verify RED**

Run: `pnpm --filter @lynavo-drive/mobile test -- onboardingStorage.test.ts`

Expected: fail because `../onboardingStorage` does not exist.

- [ ] **Step 3: Implement storage helpers**

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';

export const ONBOARDING_UNCONNECTED_GUIDE_SEEN_KEY =
  '@vividrop/onboarding/unconnected/v1/seen';
export const ONBOARDING_SYNC_ACTIVITY_TOUR_SEEN_KEY =
  '@vividrop/onboarding/sync-activity-tour/v1/seen';

async function hasSeen(key: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key)) === '1';
  } catch (error) {
    console.warn('[onboardingStorage] failed to read onboarding flag', key, error);
    return true;
  }
}

async function markSeen(key: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, '1');
  } catch (error) {
    console.warn('[onboardingStorage] failed to write onboarding flag', key, error);
  }
}

export function hasSeenUnconnectedGuide(): Promise<boolean> {
  return hasSeen(ONBOARDING_UNCONNECTED_GUIDE_SEEN_KEY);
}

export function markUnconnectedGuideSeen(): Promise<void> {
  return markSeen(ONBOARDING_UNCONNECTED_GUIDE_SEEN_KEY);
}

export function hasSeenSyncActivityTour(): Promise<boolean> {
  return hasSeen(ONBOARDING_SYNC_ACTIVITY_TOUR_SEEN_KEY);
}

export function markSyncActivityTourSeen(): Promise<void> {
  return markSeen(ONBOARDING_SYNC_ACTIVITY_TOUR_SEEN_KEY);
}
```

- [ ] **Step 4: Run storage tests and verify GREEN**

Run: `pnpm --filter @lynavo-drive/mobile test -- onboardingStorage.test.ts`

Expected: pass.

## Task 2: Preserve Onboarding During User-Scoped Cleanup

**Files:**
- Modify: `apps/mobile/src/utils/__tests__/clearUserScopedStorage.test.ts`

- [ ] **Step 1: Add failing preservation test**

Add a test that seeds `@vividrop/onboarding/unconnected/v1/seen` and `@vividrop/onboarding/sync-activity-tour/v1/seen`, runs `clearUserScopedStorage()`, and expects `AsyncStorage.multiRemove` not to remove those keys.

- [ ] **Step 2: Run cleanup test and verify behavior**

Run: `pnpm --filter @lynavo-drive/mobile test -- clearUserScopedStorage.test.ts`

Expected: pass if cleanup already preserves unknown app-level keys; fail only if cleanup is too broad.

## Task 3: Unconnected Guide Component and Mount

**Files:**
- Create: `apps/mobile/src/components/onboarding/UnconnectedGuide.tsx`
- Modify: `apps/mobile/src/screens/DeviceDiscoveryScreen.tsx`
- Modify: `apps/mobile/src/i18n/locales/zh-Hant/deviceDiscovery.json`
- Modify: `apps/mobile/src/i18n/locales/zh-Hans/deviceDiscovery.json`
- Modify: `apps/mobile/src/i18n/locales/en/deviceDiscovery.json`

- [ ] **Step 1: Write failing DeviceDiscovery test**

Create or extend a focused test that mocks initial mode, `hasSeenUnconnectedGuide()` returning false, renders `DeviceDiscoveryScreen`, expects the C guide title, presses skip/start, and expects `markUnconnectedGuideSeen()` plus the guide disappears.

- [ ] **Step 2: Run test and verify RED**

Run: `pnpm --filter @lynavo-drive/mobile test -- DeviceDiscoveryScreen.onboarding.test.tsx`

Expected: fail because `UnconnectedGuide` and mount logic do not exist.

- [ ] **Step 3: Implement `UnconnectedGuide`**

Build a full-screen overlay matching `UI/guide/登录后-还未连接引导页.png`: skip button, icon, title, three step labels, download URL with copy action, and primary "go connect" CTA.

- [ ] **Step 4: Mount it in `DeviceDiscoveryScreen`**

On initial mode only, read `hasSeenUnconnectedGuide()` on mount. If false, show guide. On skip/start, await `markUnconnectedGuideSeen()` and hide guide. Do not show in switch mode.

- [ ] **Step 5: Run DeviceDiscovery onboarding tests**

Run: `pnpm --filter @lynavo-drive/mobile test -- DeviceDiscoveryScreen.onboarding.test.tsx`

Expected: pass.

## Task 4: Sync Activity Tour Component and Mount

**Files:**
- Create: `apps/mobile/src/components/onboarding/SyncActivityTour.tsx`
- Modify: `apps/mobile/src/screens/SyncActivityScreen.tsx`
- Modify: `apps/mobile/src/i18n/locales/zh-Hant/syncActivity.json`
- Modify: `apps/mobile/src/i18n/locales/zh-Hans/syncActivity.json`
- Modify: `apps/mobile/src/i18n/locales/en/syncActivity.json`

- [ ] **Step 1: Write failing SyncActivity test**

Extend `SyncActivityScreen.header.test.tsx` or add `SyncActivityScreen.onboarding.test.tsx`: mock `hasSeenSyncActivityTour()` false, render with valid binding, wait for the first tour step, press next through the steps, press finish, and assert `markSyncActivityTourSeen()` was called.

- [ ] **Step 2: Run test and verify RED**

Run: `pnpm --filter @lynavo-drive/mobile test -- SyncActivityScreen.onboarding.test.tsx`

Expected: fail because the tour component and mount logic do not exist.

- [ ] **Step 3: Implement `SyncActivityTour`**

Build a transparent RN `Modal` overlay with five steps: manual sync, sync panel, history, settings, help. The overlay dims the page, shows a rounded glass-like coach card, step indicator, skip/back/next/finish controls, and does not trigger underlying page actions.

- [ ] **Step 4: Mount it in `SyncActivityScreen`**

After initial native data load finishes and `bindingState.deviceId` exists, read `hasSeenSyncActivityTour()`. If false, show the tour. On skip/finish, await `markSyncActivityTourSeen()` and hide the tour.

- [ ] **Step 5: Run SyncActivity onboarding tests**

Run: `pnpm --filter @lynavo-drive/mobile test -- SyncActivityScreen.onboarding.test.tsx`

Expected: pass.

## Task 5: Verification

**Files:**
- All files above.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter @lynavo-drive/mobile test -- onboardingStorage.test.ts clearUserScopedStorage.test.ts DeviceDiscoveryScreen.onboarding.test.tsx SyncActivityScreen.onboarding.test.tsx SyncActivityScreen.header.test.tsx
```

Expected: pass.

- [ ] **Step 2: Run mobile typecheck**

Run: `pnpm --filter @lynavo-drive/mobile exec tsc --noEmit`

Expected: pass.

- [ ] **Step 3: Self-review**

Check that no DTO/contracts, SyncEngine state machine, queue semantics, subscription gate, account cleanup, or persistence semantics outside onboarding changed.
