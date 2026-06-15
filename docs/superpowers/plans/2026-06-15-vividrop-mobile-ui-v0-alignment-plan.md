# Vivi Drop Mobile UI v0 Alignment Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modify the React Native mobile UI components and colors to align 1:1 with the v0 Next.js prototype design.

**Architecture:** We will update `colors.ts` with hex values corresponding to the prototype's OKLCH variables. Then we will adapt screen style declarations, headers, cards, status components, and button styles on each page to match the prototype's visual architecture.

**Tech Stack:** React Native, TypeScript, React Navigation.

---

### Task 1: Update Color Theme

**Files:**
- Modify: `apps/mobile/src/theme/colors.ts`
- Test: Run typecheck in mobile folder.

- [ ] **Step 1: Update colors in colors.ts**
  Replace the contents of `apps/mobile/src/theme/colors.ts` with the new design values:
  ```typescript
  export const colors = {
    background: '#F7F9FC',
    foreground: '#1C1C1E',
    card: '#FFFFFF',
    cardForeground: '#1C1C1E',
    primary: '#1A3A5C',
    primaryForeground: '#FFFFFF',
    secondary: '#F0F4F8',
    secondaryForeground: '#5A7A96',
    muted: '#EBF0F5',
    mutedForeground: '#8AABBD',
    accent: '#3B9FD8',
    accentForeground: '#FFFFFF',
    border: 'rgba(0,0,0,0.05)',
    input: '#F0F4F8',
    ring: '#1A3A5C',
    success: '#16A34A',
    successForeground: '#FFFFFF',
    warning: '#F59E0B',
    warningForeground: '#D97706',
    destructive: '#EF4444',
    destructiveForeground: '#FFFFFF',
    screenBackground: '#F7F9FC',
    screenTitle: '#1A3A5C',
  } as const;
  ```

- [ ] **Step 2: Run typecheck**
  Run: `pnpm --filter @syncflow/mobile exec tsc --noEmit`
  Expected: PASS

- [ ] **Step 3: Commit**
  ```bash
  git add apps/mobile/src/theme/colors.ts
  git commit -m "style(mobile): update colors.ts to match prototype palette"
  ```

---

### Task 2: Align Sync Activity Screen UI

**Files:**
- Modify: `apps/mobile/src/screens/SyncActivityScreen.tsx`
- Test: `pnpm test apps/mobile/src/screens/__tests__/SyncActivityScreen.test.tsx` (if it exists, or run general mobile tests)

- [ ] **Step 1: Update UI layout of SyncActivityScreen**
  Update the style sheet and screen layout in `apps/mobile/src/screens/SyncActivityScreen.tsx`:
  - Change main background to `colors.background` (`#F7F9FC`).
  - Style header bar to have deep navy background (`#1A3A5C`) or clean header text with Help, History, and Settings icons.
  - Style connection card with computer icon, status text (`在线`), and green indicator.
  - Revamp active transfer card to show 3 columns of stats (速度, 进度, 已传输) with light borders and `#F7F9FC` background.
  - Set progress bar height to 6 with rounded corners and `#3B9FD8` gradient or color.

- [ ] **Step 2: Verify typecheck**
  Run: `pnpm --filter @syncflow/mobile exec tsc --noEmit`
  Expected: PASS

- [ ] **Step 3: Run mobile tests**
  Run: `pnpm --filter @syncflow/mobile test`
  Expected: PASS

- [ ] **Step 4: Commit**
  ```bash
  git add apps/mobile/src/screens/SyncActivityScreen.tsx
  git commit -m "style(mobile): align SyncActivity screen with prototype design"
  ```

---

### Task 3: Align Settings Screen UI

**Files:**
- Modify: `apps/mobile/src/screens/SettingsScreen.tsx`
- Test: `pnpm test SettingsScreen`

- [ ] **Step 1: Update Settings screen layout**
  Update the styles in `apps/mobile/src/screens/SettingsScreen.tsx`:
  - Set screen container background to `colors.background` (`#F7F9FC`).
  - Use white card container styles for settings rows (`#FFFFFF`, `borderRadius: 16`, thin border).
  - Modify the User / Account row to show the subscription status badge (purple for Pro, blue for Trial, red for Expired).
  - Keep the red trash icon for the "Forget Desktop" action row.
  - Set standard chevron icons to colored container circles.

- [ ] **Step 2: Verify typecheck**
  Run: `pnpm --filter @syncflow/mobile exec tsc --noEmit`
  Expected: PASS

- [ ] **Step 3: Run SettingsScreen tests**
  Run: `pnpm --filter @syncflow/mobile test SettingsScreen`
  Expected: PASS

- [ ] **Step 4: Commit**
  ```bash
  git add apps/mobile/src/screens/SettingsScreen.tsx
  git commit -m "style(mobile): align Settings screen with prototype design"
  ```

---

### Task 4: Align Shared Files Screen UI

**Files:**
- Modify: `apps/mobile/src/screens/SharedFilesScreen.tsx`
- Test: `pnpm test SharedFilesDownloadGate`

- [ ] **Step 1: Update SharedFiles screen layout**
  Update `apps/mobile/src/screens/SharedFilesScreen.tsx` layout and styling:
  - Redesign Segmented Tabs control at the top to match the prototype look.
  - Revamp file row elements: set specific icons for folder/doc/video/image types.
  - Format size details and align download buttons/indicators (checkmark for downloaded, spinner for loading).

- [ ] **Step 2: Verify typecheck**
  Run: `pnpm --filter @syncflow/mobile exec tsc --noEmit`
  Expected: PASS

- [ ] **Step 3: Run tests**
  Run: `pnpm --filter @syncflow/mobile test SharedFilesDownloadGate`
  Expected: PASS

- [ ] **Step 4: Commit**
  ```bash
  git add apps/mobile/src/screens/SharedFilesScreen.tsx
  git commit -m "style(mobile): align SharedFiles screen with prototype design"
  ```

---

### Task 5: Align Device Discovery & Verify Screen UI

**Files:**
- Modify: `apps/mobile/src/screens/DeviceDiscoveryScreen.tsx`
- Modify: `apps/mobile/src/screens/CodeVerifyScreen.tsx`
- Test: `pnpm test DeviceDiscoveryScreen`

- [ ] **Step 1: Update DeviceDiscovery screen layout**
  Modify `apps/mobile/src/screens/DeviceDiscoveryScreen.tsx`:
  - Format "Recent Desktops" and "Discovered Desktops" sections with thin border cards and desktop icons.
  - Customize the scan progress pulse circles.

- [ ] **Step 2: Update CodeVerify screen layout**
  Modify `apps/mobile/src/screens/CodeVerifyScreen.tsx` to align layout with the prototype verify page.

- [ ] **Step 3: Verify typecheck**
  Run: `pnpm --filter @syncflow/mobile exec tsc --noEmit`
  Expected: PASS

- [ ] **Step 4: Run discovery tests**
  Run: `pnpm --filter @syncflow/mobile test DeviceDiscoveryScreen`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add apps/mobile/src/screens/DeviceDiscoveryScreen.tsx apps/mobile/src/screens/CodeVerifyScreen.tsx
  git commit -m "style(mobile): align Discovery and Verify screens with prototype design"
  ```

---

### Task 6: Audit & Hide Legacy Entry Points

**Files:**
- Modify: `apps/mobile/src/navigation/RootNavigator.tsx`
- Modify: `apps/mobile/src/screens/AlbumWorkbenchScreen.tsx`
- Modify: `apps/mobile/src/screens/HistoryScreen.tsx`

- [ ] **Step 1: Hide non-v0 legacy elements**
  Ensure that any legacy buttons, setting entries, and help links not represented in the Next.js prototype design are hidden.
  Modify `AlbumWorkbenchScreen.tsx`, `HistoryScreen.tsx`, and `RootNavigator.tsx` style configurations as needed.

- [ ] **Step 2: Run full typecheck and build validation**
  Run: `pnpm --filter @syncflow/mobile exec tsc --noEmit`
  Expected: PASS

- [ ] **Step 3: Run all mobile tests**
  Run: `pnpm --filter @syncflow/mobile test`
  Expected: PASS

- [ ] **Step 4: Commit**
  ```bash
  git add apps/mobile/src/navigation/RootNavigator.tsx apps/mobile/src/screens/AlbumWorkbenchScreen.tsx apps/mobile/src/screens/HistoryScreen.tsx
  git commit -m "style(mobile): hide legacy entry points and perform final audit"
  ```
