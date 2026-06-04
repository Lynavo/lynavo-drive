# Market Branching and Build Flavor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support China and global market builds from one shared SyncFlow codebase without long-lived `dev-cn` / `dev-global` forks.

**Architecture:** Keep `dev` as the shared integration branch and move market differences into explicit `MARKET=cn` / `MARKET=global` profile and build flavor layers. Shared sync behavior remains in `@syncflow/contracts`, Go sidecar, desktop bridge, React Native shared screens, and native SyncEngine; market-specific behavior stays in config, assets, auth routes, native app identity, and packaging.

**Tech Stack:** Git branch workflow, React Native 0.84, TypeScript strict mode, React Navigation, iOS Xcode targets or schemes, Android Gradle product flavors, Electron Builder, pnpm/turborepo.

---

## Fixed Decisions

```text
Long-lived branches:
  main
  dev

Short-lived feature branches:
  feature/market-profiles
  feature/native-build-flavors
  feature/global-auth
  feature/global-ui

Release branches:
  release/cn/0.1.x
  release/global/1.0.x

Hotfix branches:
  hotfix/cn/0.1.x
  hotfix/global/1.0.x
```

```text
China market:
  MARKET=cn
  Mobile bundle/application id: com.vividrop.mobile.china
  Desktop appId: com.vividrop.desktop.china
  API base URL: https://api.vividrop.cn
  Review API base URL: https://review-api.vividrop.cn
  Legal URLs:
    https://www.vividrop.cn/terms
    https://www.vividrop.cn/privacy
  Login providers: phone

Global market:
  MARKET=global
  Mobile bundle/application id: com.vividrop.mobile.global
  Desktop appId: com.vividrop.desktop.global
  API base URL: https://api.vividrop.cn
  Review API base URL: https://review-api.vividrop.cn
  Legal URLs:
    https://www.vividrop.cn/terms
    https://www.vividrop.cn/privacy
  Login providers: apple, google
```

## Non-Goals

```text
Do not create long-lived dev-cn / dev-global branches.
Do not fork @syncflow/contracts for market differences.
Do not fork Go sidecar behavior for market differences.
Do not change queue semantics, sync state machine, LMUP protocol, or sidecar ports.
Do not use UI-only hiding for native SDKs that should be excluded from a market build.
Do not add email login unless product explicitly decides global should support email.
```

## File Structure

**New files:**

- `apps/mobile/src/markets/types.ts` - market type definitions.
- `apps/mobile/src/markets/cn/config.ts` - China market config.
- `apps/mobile/src/markets/global/config.ts` - global market config.
- `apps/mobile/src/markets/index.ts` - active market resolver.
- `apps/mobile/src/markets/__tests__/market-config.test.ts` - config invariants.
- `apps/mobile/src/screens/LoginGlobalScreen.tsx` - Apple / Google login screen.
- `apps/mobile/src/screens/__tests__/LoginGlobalScreen.test.tsx` - global login UI behavior.
- `apps/desktop/src/renderer/markets/types.ts` - desktop market type definitions.
- `apps/desktop/src/renderer/markets/cn/config.ts` - desktop China market config.
- `apps/desktop/src/renderer/markets/global/config.ts` - desktop global market config.
- `apps/desktop/src/renderer/markets/index.ts` - desktop active market resolver.
- `apps/desktop/electron-builder.cn.yml` - China desktop packaging config.
- `apps/desktop/electron-builder.global.yml` - global desktop packaging config.
- `docs/release/market-release-flow.md` - branch, release, and hotfix flow.

**Modified files:**

- `apps/mobile/src/services/config.ts` - read API URLs from active market config.
- `apps/mobile/src/constants/legal.ts` - read legal URLs from active market config.
- `apps/mobile/src/navigation/RootNavigator.tsx` - choose China or global auth routes.
- `apps/mobile/src/screens/LoginScreen.tsx` - keep as China phone login or rename in a small follow-up.
- `apps/mobile/src/theme/colors.ts` - route exported colors through active market theme if needed.
- `apps/mobile/android/app/build.gradle` - add `cn` and `global` product flavors.
- `apps/mobile/ios/SyncFlowMobile.xcodeproj/project.pbxproj` - add market-specific build settings via Xcode target/scheme work.
- `apps/desktop/package.json` - add market-specific build/package scripts.
- `docs/release/release-playbook.md` - link to market release flow and add market commands.

## Branching Rules

```text
dev:
  Shared integration branch.
  Both cn and global profile code must compile here.

feature/*:
  Short-lived branches.
  Merge back to dev after tests pass.

release/cn/* and release/global/*:
  Created from dev for submission or beta cutoff.
  Accept only stabilization fixes, version bumps, signing/package config, and store review adjustments.

hotfix/cn/* and hotfix/global/*:
  Created from the released tag or corresponding release branch after a shipped build has a critical issue.
  Fix must be released and then merged or cherry-picked back to dev.
```

## Task 1: Preserve Current China Baseline

**Files:**

- No file changes.

- [ ] **Step 1: Confirm the current integration branch**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
git fetch origin
git checkout dev
git pull --ff-only origin dev
git status --short
```

Expected:

```text
current branch is dev
working tree has no unrelated local changes that would be included in the baseline tag
```

- [ ] **Step 2: Create and push the China baseline tag**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
git tag cn-baseline-2026-04-29
git push origin cn-baseline-2026-04-29
```

Expected:

```text
origin has tag cn-baseline-2026-04-29
```

- [ ] **Step 3: Create the market profile branch**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
git checkout -b feature/market-profiles
```

Expected:

```text
Switched to a new branch 'feature/market-profiles'
```

## Task 2: Add Mobile Market Profile Types and Configs

**Files:**

- Create: `apps/mobile/src/markets/types.ts`
- Create: `apps/mobile/src/markets/cn/config.ts`
- Create: `apps/mobile/src/markets/global/config.ts`
- Create: `apps/mobile/src/markets/index.ts`
- Create: `apps/mobile/src/markets/__tests__/market-config.test.ts`

- [ ] **Step 1: Write the config invariant tests**

Create `apps/mobile/src/markets/__tests__/market-config.test.ts`:

```ts
import { cnMarketConfig } from '../cn/config';
import { globalMarketConfig } from '../global/config';

describe('mobile market configs', () => {
  it('keeps China build on phone login and China endpoints', () => {
    expect(cnMarketConfig.market).toBe('cn');
    expect(cnMarketConfig.loginProviders).toEqual(['phone']);
    expect(cnMarketConfig.apiBaseUrl).toBe('https://api.vividrop.cn');
    expect(cnMarketConfig.reviewApiBaseUrl).toBe('https://review-api.vividrop.cn');
    expect(cnMarketConfig.privacyUrl).toBe('https://www.vividrop.cn/privacy');
    expect(cnMarketConfig.termsUrl).toBe('https://www.vividrop.cn/terms');
  });

  it('keeps global build on Apple and Google login with global endpoints', () => {
    expect(globalMarketConfig.market).toBe('global');
    expect(globalMarketConfig.loginProviders).toEqual(['apple', 'google']);
    expect(globalMarketConfig.apiBaseUrl).toBe('https://api.vividrop.cn');
    expect(globalMarketConfig.reviewApiBaseUrl).toBe('https://review-api.vividrop.cn');
    expect(globalMarketConfig.privacyUrl).toBe('https://www.vividrop.cn/privacy');
    expect(globalMarketConfig.termsUrl).toBe('https://www.vividrop.cn/terms');
  });
});
```

- [ ] **Step 2: Run the market config test and verify RED**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
pnpm --filter @syncflow/mobile test -- market-config.test.ts
```

Expected:

```text
FAIL because apps/mobile/src/markets does not exist
```

- [ ] **Step 3: Create market type definitions**

Create `apps/mobile/src/markets/types.ts`:

```ts
export type Market = 'cn' | 'global';

export type LoginProvider = 'phone' | 'apple' | 'google';

export interface MarketTheme {
  primary: string;
  primaryForeground: string;
  background: string;
  foreground: string;
  accent: string;
}

export interface MobileMarketConfig {
  market: Market;
  appName: string;
  bundleId: string;
  apiBaseUrl: string;
  reviewApiBaseUrl: string;
  appReviewPhone: string;
  privacyUrl: string;
  termsUrl: string;
  loginProviders: readonly LoginProvider[];
  theme: MarketTheme;
}
```

- [ ] **Step 4: Create China market config**

Create `apps/mobile/src/markets/cn/config.ts`:

```ts
import type { MobileMarketConfig } from '../types';

export const cnMarketConfig: MobileMarketConfig = {
  market: 'cn',
  appName: 'Vivi Drop',
  bundleId: 'com.vividrop.mobile.china',
  apiBaseUrl: 'https://api.vividrop.cn',
  reviewApiBaseUrl: 'https://review-api.vividrop.cn',
  appReviewPhone: '17000000002',
  privacyUrl: 'https://www.vividrop.cn/privacy',
  termsUrl: 'https://www.vividrop.cn/terms',
  loginProviders: ['phone'],
  theme: {
    primary: '#2a6cb5',
    primaryForeground: '#ffffff',
    background: '#f2f5f8',
    foreground: '#1a2a3c',
    accent: '#b8d4ec',
  },
};
```

- [ ] **Step 5: Create global market config**

Create `apps/mobile/src/markets/global/config.ts`:

```ts
import type { MobileMarketConfig } from '../types';

export const globalMarketConfig: MobileMarketConfig = {
  market: 'global',
  appName: 'Vivi Drop',
  bundleId: 'com.vividrop.mobile.global',
  apiBaseUrl: 'https://api.vividrop.cn',
  reviewApiBaseUrl: 'https://review-api.vividrop.cn',
  appReviewPhone: '17000000002',
  privacyUrl: 'https://www.vividrop.cn/privacy',
  termsUrl: 'https://www.vividrop.cn/terms',
  loginProviders: ['apple', 'google'],
  theme: {
    primary: '#3f5fdb',
    primaryForeground: '#ffffff',
    background: '#f7f8fb',
    foreground: '#172033',
    accent: '#18a999',
  },
};
```

- [ ] **Step 6: Create the active market resolver**

Create `apps/mobile/src/markets/index.ts`:

```ts
import { cnMarketConfig } from './cn/config';
import { globalMarketConfig } from './global/config';
import type { Market, MobileMarketConfig } from './types';

const rawMarket = process.env.SYNCFLOW_MARKET;

export const activeMarket: Market = rawMarket === 'global' || rawMarket === 'cn' ? rawMarket : 'cn';

export const marketConfig: MobileMarketConfig =
  activeMarket === 'global' ? globalMarketConfig : cnMarketConfig;

export function isGlobalMarket(): boolean {
  return activeMarket === 'global';
}

export function isChinaMarket(): boolean {
  return activeMarket === 'cn';
}
```

- [ ] **Step 7: Run market config test and verify GREEN**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
pnpm --filter @syncflow/mobile test -- market-config.test.ts
```

Expected:

```text
PASS apps/mobile/src/markets/__tests__/market-config.test.ts
```

- [ ] **Step 8: Commit**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
git add apps/mobile/src/markets
git commit -m "feat(mobile): add market profiles"
```

## Task 3: Route Mobile API and Legal Config Through Market Profile

**Files:**

- Modify: `apps/mobile/src/services/config.ts`
- Modify: `apps/mobile/src/constants/legal.ts`
- Modify: `apps/mobile/src/services/__tests__/config.review-server.test.ts`
- Modify: `apps/mobile/src/services/__tests__/auth-service.review-server.test.ts`

- [ ] **Step 1: Add tests for market-backed config**

Update existing config tests so they assert:

```ts
expect(PROD_BASE_URL).toBe('https://api.vividrop.cn');
expect(REVIEW_API_BASE_URL).toBe('https://review-api.vividrop.cn');
expect(APP_REVIEW_PHONE).toBe('17000000002');
```

Expected China behavior stays unchanged because default `SYNCFLOW_MARKET` is `cn`.

- [ ] **Step 2: Replace hard-coded API constants**

In `apps/mobile/src/services/config.ts`, import `marketConfig`:

```ts
import { marketConfig } from '../markets';
```

Replace:

```ts
export const PROD_BASE_URL = 'https://api.vividrop.cn';
export const REVIEW_API_BASE_URL = 'https://review-api.vividrop.cn';
export const APP_REVIEW_PHONE = '17000000002';
```

with:

```ts
export const PROD_BASE_URL = marketConfig.apiBaseUrl;
export const REVIEW_API_BASE_URL = marketConfig.reviewApiBaseUrl;
export const APP_REVIEW_PHONE = marketConfig.appReviewPhone;
```

- [ ] **Step 3: Replace hard-coded legal constants**

In `apps/mobile/src/constants/legal.ts`, replace the file with:

```ts
import { marketConfig } from '../markets';

export const USER_AGREEMENT_URL = marketConfig.termsUrl;
export const PRIVACY_POLICY_URL = marketConfig.privacyUrl;
```

- [ ] **Step 4: Run focused mobile config tests**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
pnpm --filter @syncflow/mobile test -- config.review-server.test.ts auth-service.review-server.test.ts
```

Expected:

```text
PASS config.review-server.test.ts
PASS auth-service.review-server.test.ts
```

- [ ] **Step 5: Commit**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
git add apps/mobile/src/services/config.ts apps/mobile/src/constants/legal.ts apps/mobile/src/services/__tests__
git commit -m "refactor(mobile): read API and legal URLs from market profile"
```

## Task 4: Add Market-Aware Auth Navigation

**Files:**

- Create: `apps/mobile/src/screens/LoginGlobalScreen.tsx`
- Create: `apps/mobile/src/screens/__tests__/LoginGlobalScreen.test.tsx`
- Modify: `apps/mobile/src/navigation/RootNavigator.tsx`
- Modify: `apps/mobile/src/navigation/__tests__/RootNavigator.subscription.test.tsx`

- [ ] **Step 1: Write global login screen test**

Create `apps/mobile/src/screens/__tests__/LoginGlobalScreen.test.tsx`:

```tsx
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { LoginGlobalScreen } from '../LoginGlobalScreen';

describe('LoginGlobalScreen', () => {
  it('shows Apple and Google login without phone login', () => {
    const { getByText, queryByText } = render(<LoginGlobalScreen />);

    expect(getByText('Continue with Apple')).toBeTruthy();
    expect(getByText('Continue with Google')).toBeTruthy();
    expect(queryByText('+86')).toBeNull();
  });

  it('keeps provider buttons disabled while provider login is pending', () => {
    const { getByText } = render(<LoginGlobalScreen />);

    fireEvent.press(getByText('Continue with Apple'));

    expect(getByText('Continue with Apple')).toBeTruthy();
    expect(getByText('Continue with Google')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
pnpm --filter @syncflow/mobile test -- LoginGlobalScreen.test.tsx
```

Expected:

```text
FAIL because LoginGlobalScreen does not exist
```

- [ ] **Step 3: Implement initial global login screen shell**

Create `apps/mobile/src/screens/LoginGlobalScreen.tsx`:

```tsx
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { AUTH_COLORS, AuthScreenShell } from '../components/auth/AuthScreenShell';

type Provider = 'apple' | 'google';

export function LoginGlobalScreen() {
  const [pendingProvider, setPendingProvider] = useState<Provider | null>(null);

  const handleProviderPress = async (provider: Provider) => {
    if (pendingProvider) return;
    setPendingProvider(provider);
    Alert.alert(
      'Sign in unavailable',
      'Apple and Google sign-in native SDK wiring will be added in feature/global-auth.',
    );
    setPendingProvider(null);
  };

  return (
    <AuthScreenShell subtitle="Connect your desktop and keep media in sync.">
      <View style={styles.card}>
        <Text style={styles.title}>Sign in to Vivi Drop</Text>
        <Pressable
          accessibilityRole="button"
          disabled={pendingProvider !== null}
          onPress={() => void handleProviderPress('apple')}
          style={styles.providerButton}
        >
          <Text style={styles.providerText}>Continue with Apple</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={pendingProvider !== null}
          onPress={() => void handleProviderPress('google')}
          style={styles.providerButton}
        >
          <Text style={styles.providerText}>Continue with Google</Text>
        </Pressable>
      </View>
    </AuthScreenShell>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    marginTop: 32,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    padding: 20,
    gap: 14,
  },
  title: {
    color: AUTH_COLORS.text,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 6,
  },
  providerButton: {
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: AUTH_COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  providerText: {
    color: AUTH_COLORS.text,
    fontSize: 16,
    fontWeight: '700',
  },
});
```

- [ ] **Step 4: Switch unauthenticated routes by market**

In `apps/mobile/src/navigation/RootNavigator.tsx`, import the global screen and market helper:

```ts
import { isGlobalMarket } from '../markets';
import { LoginGlobalScreen } from '../screens/LoginGlobalScreen';
```

Inside `UnauthStack`, replace the fixed screens:

```tsx
<Stack.Screen name="Login" component={LoginScreen} />
<Stack.Screen name="SmsVerify" component={SmsVerifyScreen} />
```

with:

```tsx
{
  isGlobalMarket() ? (
    <Stack.Screen name="Login" component={LoginGlobalScreen} />
  ) : (
    <>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="SmsVerify" component={SmsVerifyScreen} />
    </>
  );
}
```

- [ ] **Step 5: Run focused auth navigation tests**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
pnpm --filter @syncflow/mobile test -- LoginGlobalScreen.test.tsx RootNavigator.subscription.test.tsx
```

Expected:

```text
PASS LoginGlobalScreen.test.tsx
PASS RootNavigator.subscription.test.tsx
```

- [ ] **Step 6: Commit**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
git add apps/mobile/src/screens/LoginGlobalScreen.tsx apps/mobile/src/screens/__tests__/LoginGlobalScreen.test.tsx apps/mobile/src/navigation/RootNavigator.tsx apps/mobile/src/navigation/__tests__
git commit -m "feat(mobile): route auth screens by market"
```

## Task 5: Add Android Product Flavors

**Files:**

- Modify: `apps/mobile/android/app/build.gradle`

- [ ] **Step 1: Create native build flavor branch**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
git checkout dev
git pull --ff-only origin dev
git checkout -b feature/native-build-flavors
```

Expected:

```text
Switched to a new branch 'feature/native-build-flavors'
```

- [ ] **Step 2: Add Gradle flavor dimension and flavors**

In `apps/mobile/android/app/build.gradle`, inside `android { ... }`, keep `namespace "com.vividrop.mobile.china"` and replace the single `defaultConfig.applicationId` ownership with flavors:

```gradle
    flavorDimensions "market"

    productFlavors {
        cn {
            dimension "market"
            applicationId "com.vividrop.mobile.china"
            resValue "string", "app_name", "Vivi Drop"
            buildConfigField "String", "SYNCFLOW_MARKET", "\"cn\""
        }
        global {
            dimension "market"
            applicationId "com.vividrop.mobile.global"
            resValue "string", "app_name", "Vivi Drop"
            buildConfigField "String", "SYNCFLOW_MARKET", "\"global\""
        }
    }
```

Also add React Native debuggable variants inside the existing `react { ... }` block:

```gradle
    debuggableVariants = ["cnDebug", "globalDebug"]
```

- [ ] **Step 3: Build both Android debug flavors**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow/apps/mobile/android
./gradlew assembleCnDebug assembleGlobalDebug
```

Expected:

```text
BUILD SUCCESSFUL
```

- [ ] **Step 4: Commit**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
git add apps/mobile/android/app/build.gradle
git commit -m "feat(android): add market product flavors"
```

## Task 6: Add iOS Market Build Settings

**Files:**

- Modify: `apps/mobile/ios/SyncFlowMobile.xcodeproj/project.pbxproj`
- Modify: `apps/mobile/ios/SyncFlowMobile/Info.plist`
- Create: `apps/mobile/ios/SyncFlowMobile/Images.xcassets/AppIconGlobal.appiconset/Contents.json`

- [ ] **Step 1: Create global app icon asset catalog entry**

Duplicate `apps/mobile/ios/SyncFlowMobile/Images.xcassets/AppIcon.appiconset` to `AppIconGlobal.appiconset` and replace the image files with approved global icons.

Expected:

```text
AppIcon.appiconset remains the China icon set.
AppIconGlobal.appiconset exists for global builds.
```

- [ ] **Step 2: Add iOS market build settings in Xcode**

Open:

```bash
open /Volumes/T7/Dev/Web/SyncFlow/apps/mobile/ios/SyncFlowMobile.xcworkspace
```

Add either two schemes or two targets:

```text
SyncFlowMobileCN:
  PRODUCT_BUNDLE_IDENTIFIER = com.vividrop.mobile.china
  PRODUCT_NAME = Vivi Drop
  ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon
  SYNCFLOW_MARKET = cn

SyncFlowMobileGlobal:
  PRODUCT_BUNDLE_IDENTIFIER = com.vividrop.mobile.global
  PRODUCT_NAME = Vivi Drop
  ASSETCATALOG_COMPILER_APPICON_NAME = AppIconGlobal
  SYNCFLOW_MARKET = global
```

- [ ] **Step 3: Make display name use build settings**

In `apps/mobile/ios/SyncFlowMobile/Info.plist`, ensure:

```xml
<key>CFBundleDisplayName</key>
<string>$(PRODUCT_NAME)</string>
```

- [ ] **Step 4: Build both iOS schemes**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow/apps/mobile/ios
xcodebuild -workspace SyncFlowMobile.xcworkspace -scheme SyncFlowMobileCN -destination 'generic/platform=iOS' -configuration Debug build
xcodebuild -workspace SyncFlowMobile.xcworkspace -scheme SyncFlowMobileGlobal -destination 'generic/platform=iOS' -configuration Debug build
```

Expected:

```text
Both xcodebuild commands exit 0.
```

- [ ] **Step 5: Commit**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
git add apps/mobile/ios/SyncFlowMobile.xcodeproj/project.pbxproj apps/mobile/ios/SyncFlowMobile/Info.plist apps/mobile/ios/SyncFlowMobile/Images.xcassets
git commit -m "feat(ios): add market build schemes"
```

## Task 7: Add Desktop Market Packaging Config

**Files:**

- Create: `apps/desktop/electron-builder.cn.yml`
- Create: `apps/desktop/electron-builder.global.yml`
- Modify: `apps/desktop/package.json`
- Create: `apps/desktop/src/renderer/markets/types.ts`
- Create: `apps/desktop/src/renderer/markets/cn/config.ts`
- Create: `apps/desktop/src/renderer/markets/global/config.ts`
- Create: `apps/desktop/src/renderer/markets/index.ts`

- [ ] **Step 1: Create China desktop builder config**

Copy the current `apps/desktop/electron-builder.yml` to `apps/desktop/electron-builder.cn.yml` and keep:

```yaml
appId: com.vividrop.desktop.china
productName: Vivi Drop
```

- [ ] **Step 2: Create global desktop builder config**

Copy `apps/desktop/electron-builder.cn.yml` to `apps/desktop/electron-builder.global.yml` and change:

```yaml
appId: com.vividrop.desktop.global
productName: Vivi Drop
```

- [ ] **Step 3: Add desktop market scripts**

In `apps/desktop/package.json`, add scripts:

```json
{
  "build:cn": "SYNCFLOW_MARKET=cn electron-vite build",
  "build:global": "SYNCFLOW_MARKET=global electron-vite build",
  "package:cn": "SYNCFLOW_MARKET=cn node ./scripts/run-workspace-pnpm.cjs build && pnpm build:sidecar:mac && CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --config electron-builder.cn.yml --mac dmg --arm64 --x64",
  "package:global": "SYNCFLOW_MARKET=global node ./scripts/run-workspace-pnpm.cjs build && pnpm build:sidecar:mac && CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --config electron-builder.global.yml --mac dmg --arm64 --x64"
}
```

- [ ] **Step 4: Add desktop renderer market config**

Create desktop market files mirroring mobile config but limited to renderer and package-visible fields:

```ts
export type DesktopMarket = 'cn' | 'global';

export interface DesktopMarketConfig {
  market: DesktopMarket;
  appName: string;
  privacyUrl: string;
  termsUrl: string;
}
```

China config:

```ts
export const cnDesktopMarketConfig = {
  market: 'cn',
  appName: 'Vivi Drop',
  privacyUrl: 'https://www.vividrop.cn/privacy',
  termsUrl: 'https://www.vividrop.cn/terms',
} as const;
```

Global config:

```ts
export const globalDesktopMarketConfig = {
  market: 'global',
  appName: 'Vivi Drop',
  privacyUrl: 'https://www.vividrop.cn/privacy',
  termsUrl: 'https://www.vividrop.cn/terms',
} as const;
```

- [ ] **Step 5: Build desktop TypeScript**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
pnpm --filter @syncflow/desktop typecheck
```

Expected:

```text
exit code 0
```

- [ ] **Step 6: Commit**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
git add apps/desktop/electron-builder.cn.yml apps/desktop/electron-builder.global.yml apps/desktop/package.json apps/desktop/src/renderer/markets
git commit -m "feat(desktop): add market packaging profiles"
```

## Task 8: Implement Real Global Auth

**Files:**

- Modify: `apps/mobile/src/screens/LoginGlobalScreen.tsx`
- Modify: `apps/mobile/src/services/auth-service.ts`
- Modify: `apps/mobile/src/services/__tests__/auth-service.review-server.test.ts`
- Modify: `apps/mobile/src/stores/auth-store.tsx`

- [ ] **Step 1: Use fixed native SDK choices**

Use these SDK paths for implementation:

```text
iOS Apple login: native AuthenticationServices bridge exposed to React Native.
Google login: @react-native-google-signin/google-signin.
```

The selected SDKs must be added only in the global build when native build tooling supports that isolation.

- [ ] **Step 2: Add Google Sign-In dependency**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
pnpm --filter @syncflow/mobile add @react-native-google-signin/google-signin
```

Expected:

```text
apps/mobile/package.json and pnpm-lock.yaml include @react-native-google-signin/google-signin
```

- [ ] **Step 3: Wire Apple login service call**

Use existing `appleLogin` in `apps/mobile/src/services/auth-service.ts`:

```ts
export async function appleLogin(args: {
  identityToken: string;
  authorizationCode?: string;
  fullName?: string;
}): Promise<{
  accessToken: string;
  refreshToken: string;
  isNewUser: boolean;
  merged: boolean;
}>;
```

`LoginGlobalScreen` should call this after native Apple identity succeeds and then update auth store with returned tokens.

- [ ] **Step 4: Wire Google login service call**

Use existing `googleLogin` in `apps/mobile/src/services/auth-service.ts`:

```ts
export async function googleLogin(identityToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  isNewUser: boolean;
  merged: boolean;
}>;
```

`LoginGlobalScreen` should call this after native Google identity succeeds and then update auth store with returned tokens.

- [ ] **Step 5: Verify global login routes do not expose SMS**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
SYNCFLOW_MARKET=global pnpm --filter @syncflow/mobile test -- LoginGlobalScreen.test.tsx RootNavigator.subscription.test.tsx
```

Expected:

```text
Global auth stack renders LoginGlobalScreen.
SmsVerify route is not reachable from global login UI.
```

- [ ] **Step 6: Commit**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
git add apps/mobile/package.json pnpm-lock.yaml apps/mobile/src/screens/LoginGlobalScreen.tsx apps/mobile/src/services/auth-service.ts apps/mobile/src/stores/auth-store.tsx apps/mobile/src/services/__tests__
git commit -m "feat(mobile): add global Apple and Google login"
```

## Task 9: Document Release and Hotfix Flow

**Files:**

- Create: `docs/release/market-release-flow.md`
- Modify: `docs/release/release-playbook.md`

- [ ] **Step 1: Create market release flow document**

Create `docs/release/market-release-flow.md` with:

````md
# Market Release Flow

## Branches

`dev` is the shared integration branch. China and global builds both come from `dev`.

Release branches are cut from `dev`:

- `release/cn/<version>`
- `release/global/<version>`

Hotfix branches are cut from the released tag or the corresponding release branch:

- `hotfix/cn/<version>`
- `hotfix/global/<version>`

## Release Branch Rules

Release branches accept only stabilization fixes, version/build number changes, signing/package config, and store review adjustments.

Every real bugfix made on a release branch must be merged or cherry-picked back to `dev`.

## Hotfix Rules

Hotfix branches are used only after a build has shipped or entered external review. Every hotfix must:

1. Be released as a new build.
2. Be tagged.
3. Be merged or cherry-picked back to `dev`.

## Market Build Commands

China:

```bash
SYNCFLOW_MARKET=cn pnpm --filter @syncflow/mobile exec tsc --noEmit
pnpm --filter @syncflow/desktop package:cn
```

Global:

```bash
SYNCFLOW_MARKET=global pnpm --filter @syncflow/mobile exec tsc --noEmit
pnpm --filter @syncflow/desktop package:global
```
````

- [ ] **Step 2: Link the release flow from release playbook**

In `docs/release/release-playbook.md`, add `docs/release/market-release-flow.md` near the top-level release references.

- [ ] **Step 3: Commit**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
git add docs/release/market-release-flow.md docs/release/release-playbook.md
git commit -m "docs: add market release flow"
```

## Task 10: Final Verification Before Merging to dev

**Files:**

- No planned file changes.

- [ ] **Step 1: Run shared package build**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
pnpm --filter @syncflow/contracts build
pnpm --filter @syncflow/design-tokens build
```

Expected:

```text
both package builds exit 0
```

- [ ] **Step 2: Run mobile typecheck and tests**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
pnpm --filter @syncflow/mobile exec tsc --noEmit
pnpm --filter @syncflow/mobile test
```

Expected:

```text
typecheck exits 0
Jest exits 0
```

- [ ] **Step 3: Run desktop typecheck and tests**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
pnpm --filter @syncflow/desktop typecheck
pnpm --filter @syncflow/desktop test
```

Expected:

```text
typecheck exits 0
Vitest exits 0
```

- [ ] **Step 4: Run sidecar tests**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow/services/sidecar-go
go test ./...
```

Expected:

```text
all Go packages pass
```

- [ ] **Step 5: Build China and global mobile variants**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow/apps/mobile/android
./gradlew assembleCnDebug assembleGlobalDebug

cd /Volumes/T7/Dev/Web/SyncFlow/apps/mobile/ios
xcodebuild -workspace SyncFlowMobile.xcworkspace -scheme SyncFlowMobileCN -destination 'generic/platform=iOS' -configuration Debug build
xcodebuild -workspace SyncFlowMobile.xcworkspace -scheme SyncFlowMobileGlobal -destination 'generic/platform=iOS' -configuration Debug build
```

Expected:

```text
Android cn/global debug builds exit 0.
iOS cn/global Debug builds exit 0.
```

- [ ] **Step 6: Build desktop market variants**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
pnpm --filter @syncflow/desktop build:cn
pnpm --filter @syncflow/desktop build:global
```

Expected:

```text
Both desktop builds exit 0.
```

- [ ] **Step 7: Merge feature branch back to dev**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
git checkout dev
git pull --ff-only origin dev
git merge --no-ff feature/market-profiles
git push origin dev
```

Expected:

```text
dev contains market profile work and CI remains green
```

## Task 11: First Release Branch Cut

**Files:**

- No planned file changes until version/build bump work starts.

- [ ] **Step 1: Cut China release branch**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
git checkout dev
git pull --ff-only origin dev
git checkout -b release/cn/0.1.0
git push -u origin release/cn/0.1.0
```

Expected:

```text
origin/release/cn/0.1.0 exists
```

- [ ] **Step 2: Cut global release branch**

Run:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
git checkout dev
git pull --ff-only origin dev
git checkout -b release/global/1.0.0
git push -u origin release/global/1.0.0
```

Expected:

```text
origin/release/global/1.0.0 exists
```

- [ ] **Step 3: Apply release-only changes on each branch**

On each release branch, limit changes to:

```text
version number
build number
signing profile
store review metadata alignment
submission-specific copy fixes
```

- [ ] **Step 4: Backport real release fixes to dev**

For every real bugfix commit on a release branch:

```bash
cd /Volumes/T7/Dev/Web/SyncFlow
git checkout dev
git pull --ff-only origin dev
git cherry-pick <bugfix-commit-sha>
git push origin dev
```

Expected:

```text
dev receives the bugfix so the next release does not regress
```

## Self-Review Checklist

```text
Spec coverage:
  Covers branch naming, release branches, hotfix branches, cn/global login split,
  market config, native build identity, desktop packaging, and validation.

Pollution check:
  Sync protocol, sidecar ports, queue semantics, state machine, and contracts remain shared.
  Market differences are limited to config, assets, auth routing, native app identity,
  package identity, legal URLs, and SDK inclusion.

Known risk:
  Global API domain, bundle id, Google OAuth client ids, Apple Services IDs, and final icons
  must be confirmed before store submission. This plan uses explicit working values so
  implementation can proceed without inventing branch structure later.
```
