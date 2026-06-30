# Global Connection Feature Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current global connection guide with a six-step feature-entry tour that does not perform real page navigation.

**Architecture:** Keep `DeviceDiscoveryGlobalScreen` as the owner of guide visibility and persistence. Extract the guide step model into a local config, render step 1 with the existing device-list spotlight, and render steps 2-6 as pseudo feature preview cards inside the guide overlay.

**Tech Stack:** React Native, TypeScript, Jest, `@testing-library/react-native`.

---

### Task 1: Encode The Approved Guide Behavior In Tests

**Files:**
- Modify: `apps/mobile/src/screens/__tests__/DeviceDiscoveryGlobalScreen.onboarding.test.tsx`

- [x] **Step 1: Write the failing tests**

Add tests that expect `1/6`, step titles `开启自动上传`, `选择同步内容和范围`, `查看同步进度`, `最近下载和同步记录`, and `远程资源 / 访问电脑`; assert `mockNavigate` is not called while progressing through the guide; assert `markUnconnectedGuideSeen` is called on final completion and skip.

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @lynavo-drive/mobile test -- DeviceDiscoveryGlobalScreen.onboarding.test.tsx --runInBand
```

Expected: fail because the current implementation still renders `1/8` and only one hardcoded guide step.

### Task 2: Implement The Six-Step Global Feature Guide

**Files:**
- Modify: `apps/mobile/src/screens/DeviceDiscoveryGlobalScreen.tsx`

- [x] **Step 1: Add guide state and config**

Add a local `ConnectionGuideStep` config with these six titles and action labels:

```ts
const CONNECTION_FEATURE_GUIDE_STEPS = [
  { title: '先连接电脑', actionLabel: '继续预览', previewKind: 'connect' },
  { title: '开启自动上传', actionLabel: '下一步', previewKind: 'autoUpload' },
  { title: '选择同步内容和范围', actionLabel: '下一步', previewKind: 'uploadScope' },
  { title: '查看同步进度', actionLabel: '下一步', previewKind: 'syncProgress' },
  { title: '最近下载和同步记录', actionLabel: '下一步', previewKind: 'records' },
  { title: '远程资源 / 访问电脑', actionLabel: '完成', previewKind: 'remoteResources' },
] as const;
```

- [x] **Step 2: Wire progression without navigation**

Add `guideStepIndex` state. `onNext` increments until the last step; the last step calls the existing guide dismissal path. No guide action calls `navigation.navigate`.

- [x] **Step 3: Render pseudo feature cards**

For step 1, preserve the existing spotlight. For later steps, render an overlay preview card with a simple icon, feature title, short body, and mini rows/chips that do not expose real buttons.

- [x] **Step 4: Run tests to verify pass**

Run:

```bash
pnpm --filter @lynavo-drive/mobile test -- DeviceDiscoveryGlobalScreen.onboarding.test.tsx --runInBand
```

Expected: pass.

### Task 3: Verify Integration

**Files:**
- Modify as needed only if tests reveal type or interaction issues.

- [x] **Step 1: Run typecheck**

```bash
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
```

Expected: pass.

- [x] **Step 2: Run focused related tests**

```bash
pnpm --filter @lynavo-drive/mobile test -- DeviceDiscoveryGlobalScreen.onboarding.test.tsx RootNavigator.subscription.test.tsx --runInBand
```

Expected: pass.
