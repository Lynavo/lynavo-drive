# Sleep And Wake Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce LAN transfer interruption when the desktop sleeps, preserve resumability after unavoidable sleep, and add Wake-on-LAN recovery paths in the agreed P0 -> P3 order.

**Architecture:** Desktop prevents system sleep only while a transfer is active. Existing resumable upload state remains the source of truth after interruption. Wake-on-LAN metadata is exposed only to paired clients, cached by mobile, and used for same-LAN and manually configured public WOL attempts without changing upload queue ordering, pairing identity, or history semantics.

**Tech Stack:** Electron `powerSaveBlocker`, TypeScript contracts, Go sidecar, React Native, iOS Swift SyncEngine, Android Kotlin SyncEngine, Vitest, Go test, native unit tests.

---

## Phase Order

### P0: Strong Transfer-Time Sleep Prevention

- Change desktop `PowerSaveManager` to start `powerSaveBlocker` with `prevent-display-sleep` while transfer is active and the setting is enabled.
- Keep the existing user setting and default enabled preference.
- Stop the blocker when transfer becomes inactive, sidecar becomes unhealthy, or the app quits.
- Update tests so the expected blocker type is `prevent-display-sleep`.

### P1: Resume And User Feedback After Sleep

- Keep existing `.part` / `committed_bytes` / `RESUME` behavior intact.
- Improve mobile/desktop copy and troubleshooting docs to distinguish "paused because desktop slept" from final failure.
- Add or update regression coverage for the sleep/reconnect messaging path without changing queue semantics.

### P2: Same-LAN Wake-on-LAN

- Add wake DTOs and reachability states in `@lynavo-drive/contracts`.
- Sidecar collects LAN wake targets while awake and exposes full metadata only to paired clients.
- Mobile persists wake metadata with the bound desktop.
- When opening "My Computer" and LAN health fails, mobile sends same-LAN WOL packets, emits `waking`, polls health, then falls back to existing routes.

### P3: Manual Public Wake-on-LAN

- Add a setup-gated public WOL target model for VPN/router Wake-on-WAN usage.
- Do not add cloud-only wake or automatic router port opening.
- Validate manual host/port settings and rate-limit public wake attempts.
- Show `wake_setup_required` or `wake_unavailable` instead of pretending public wake is always possible.

## Task 1: P0 Desktop Strong Power Save Blocker

**Files:**
- Modify: `apps/desktop/src/main/power-save-manager.ts`
- Modify: `apps/desktop/src/main/__tests__/power-save-manager.test.ts`
- Modify: `apps/desktop/src/renderer/i18n/locales/en/settings.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/zh-Hant/settings.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/zh-Hans/settings.json`

- [ ] **Step 1: Write failing test**

Change the first power-save manager test to expect `prevent-display-sleep`:

```ts
it('starts display sleep blocker only when enabled and transfer is active', () => {
  const blocker = createBlocker();
  const manager = new PowerSaveManager(blocker);

  manager.setEnabled(true);
  expect(blocker.start).not.toHaveBeenCalled();

  manager.setTransferActive(true);

  expect(blocker.start).toHaveBeenCalledWith('prevent-display-sleep');
  expect(blocker.start).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Verify red**

Run: `pnpm --filter @lynavo-drive/desktop test -- src/main/__tests__/power-save-manager.test.ts`

Expected: FAIL because production code still starts `prevent-app-suspension`.

- [ ] **Step 3: Implement strong blocker**

Change `PowerSaveManager.syncBlocker()` to:

```ts
this.blockerId = this.blocker.start('prevent-display-sleep');
```

- [ ] **Step 4: Update settings copy**

Clarify that the stronger mode may keep the display awake during active transfers:

```json
"preventSleepDescription": "Keeps this computer awake while a phone is syncing. The display may stay awake during transfer, then normal sleep behavior is restored."
```

Use Taiwan Traditional Chinese for `zh-Hant`.

- [ ] **Step 5: Verify green**

Run: `pnpm --filter @lynavo-drive/desktop test -- src/main/__tests__/power-save-manager.test.ts`

Expected: PASS.

## Task 2: P1 Sleep Resume Messaging

**Files:**
- Modify: `apps/mobile/src/i18n/locales/en/syncStatus.json`
- Modify: `apps/mobile/src/i18n/locales/zh-Hant/syncStatus.json`
- Modify: `apps/mobile/src/i18n/locales/zh-Hans/syncStatus.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/en/help.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/zh-Hant/help.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/zh-Hans/help.json`
- Modify: `docs/operations/troubleshooting.md`

- [ ] **Step 1: Update copy**

Use copy that says sleeping desktops pause transfer, progress is saved, and reconnect/wake resumes the queue.

- [ ] **Step 2: Verify i18n JSON**

Run: `pnpm --filter @lynavo-drive/mobile test -- src/i18n/__tests__/bootstrap.test.tsx`

Expected: PASS.

## Task 3: P2 Same-LAN Wake-on-LAN Foundation

**Files:** Follow `docs/superpowers/plans/2026-06-09-wake-bound-desktop.md`, Tasks 1 through shared-files UI/tasks, but include `wake_setup_required` and `wake_unavailable` contract states before route work.

- [ ] **Step 1: Add contract tests first**
- [ ] **Step 2: Add sidecar wake metadata provider and tests**
- [ ] **Step 3: Add iOS wake metadata storage, sender, and route hook tests**
- [ ] **Step 4: Add Android wake metadata storage, sender, and route hook tests**
- [ ] **Step 5: Add shared-files `waking` UI state and copy**
- [ ] **Step 6: Verify contracts, sidecar, mobile typecheck, and focused native tests**

## Task 4: P3 Manual Public Wake-on-LAN

**Files:** To be expanded after Task 3 lands, because public WOL settings depend on the final wake DTO/storage shape.

- [ ] **Step 1: Add public WOL target DTOs**
- [ ] **Step 2: Add mobile settings validation for manual router host/port**
- [ ] **Step 3: Add native public WOL sender path using the same magic packet builder**
- [ ] **Step 4: Add `wake_setup_required` and `wake_unavailable` UX**
- [ ] **Step 5: Add troubleshooting and beta matrix cases**

## Self-Review

- The plan keeps P0 independent and testable.
- P1 does not alter queue or resume semantics.
- P2 follows the existing wake plan and explicitly adds capability states before public wake.
- P3 uses Wake-on-LAN only: VPN/router Wake-on-WAN/manual host-port setup, no cloud-only wake and no automatic UPnP/NAT-PMP.
