# Lynavo Drive Global-only OSS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the current Vivi Drop dual-market codebase into a Lynavo Drive global-only OSS baseline with local-first LAN sync available to guest users. The initial guard phase makes paid background/remote features fail closed; the follow-up direction for this branch is to remove commercial purchase/account/remote logic from the open-source edition rather than keep it as a Pro overlay.

**Architecture:** Remove `cn/global` market branching before removing commercial behavior. The OSS baseline should expose one product configuration, one release channel model, and fail-open foreground LAN sync. Background continuation, remote tunnel, subscription purchase, gift-card redemption, TURN/signaling, and official-account flows should first be made fail-closed, then deleted or hidden from the open-source runtime in the commercial removal phase. Protocol/storage compatibility names such as `_syncflow._tcp`, existing keychain services, and old data directories are allowed only through an explicit legacy allowlist and migration task.

**Tech Stack:** pnpm monorepo, TypeScript strict mode, React Native, Electron, React 18, Go sidecar, Vitest/Jest, Gradle, Xcode, `@lynavo-drive/contracts` after the package rename task.

---

## Coordinator Rules

- The main agent coordinates, integrates, self-reviews, and verifies. Worker agents receive the exact task text and a disjoint write scope.
- Do not let workers reinterpret `docs/product/lynavo-drive-global-only-oss-commercial-plan.md`; this plan is the task source.
- Workers must not revert `.gitignore` or the untracked product plan document unless explicitly told.
- Workers must not change queue semantics: queue remains read-only, foreground automatic upload remains pending-queue based, and one mobile device uploads one file at a time.
- Renderer must continue to use preload/main bridges. No renderer code may read sidecar, SQLite, or filesystem directly.
- Market removal must not be replaced by `market = 'global'` defaults. The code should stop knowing about `cn`.
- `Vivi Drop`, `vividrop`, `SyncFlow`, `syncflow`, `SYNCFLOW`, and `@syncflow` may remain only in files explicitly tracked by the legacy allowlist until the corresponding rename task removes them.
- Completed workers may be reviewed and then closed. Running workers should not be closed early; ask them to wrap up only if scope changes.

## Decision Log For This Branch

- Release profiles become `review` and `prod`; `cn-prod`, `global-prod`, `cn-review`, and `global-review` are removed.
- Public OSS app IDs target `com.lynavo.drive.mobile` and `com.lynavo.drive.desktop`, but store migration implications must remain documented until a release owner confirms App Store / Play continuity.
- mDNS service and sidecar health service have migrated to Lynavo identities without old-client compatibility. The Go module / cmd path remains a legacy item until its own rename task lands. The workspace package scope is migrated in Task 16.
- Official commercial native modules are not added to the public repo in this plan. OSS implements entitlement contracts and fail-closed stubs/guards only.
- Android/iOS package and target renames are split from flavor/scheme removal to keep builds debuggable.
- Product direction confirmed after the code review fix pass: continue toward a thorough open-source edition. Do not preserve subscription/IAP/gift-card/TURN/official remote access as a public Pro overlay unless a later product decision reverses this.

## Execution Order

1. Safety scaffolding: legacy allowlist and scan scripts.
2. Release channel model: remove market release profiles and generated `market`.
3. Contracts entitlement model: add `DriveEntitlements` and channel/distribution types.
4. Mobile app config: single Lynavo config without deleting all market files yet.
5. Mobile local-first navigation/auth: guest routes into LAN sync surfaces.
6. Desktop product helper and local shell: remove desktop market helper and auth shell gate.
7. Native build cleanup: Android flavor removal, then iOS scheme/config collapse.
8. Paid feature gates: mobile/desktop/sidecar remote and background fail-closed checks.
9. Visible rename and docs: user-facing Lynavo Drive strings, release docs, QA matrix.
10. Commercial removal phase: delete or hide subscription/IAP/gift-card/TURN/official-account runtime paths from the OSS edition while preserving local LAN sync.
11. Package/namespace/data-dir/mDNS migrations: broad churn after behavior is green and commercial runtime paths are removed.

## Task 0: Legacy Name Allowlist And Scans

**Owner:** Worker, isolated.

**Files:**

- Create: `docs/rename/legacy-name-allowlist.md`
- Create: `scripts/verify-legacy-name-allowlist.mjs`
- Modify: `package.json`
- Optional Test: `scripts/release/__tests__/legacy-name-allowlist.test.mjs`

- [x] Write a failing test or dry-run command that proves unallowlisted `Vivi Drop`, `vividrop`, `SyncFlow`, `syncflow`, `SYNCFLOW`, `VIVIDROP`, and `@syncflow` hits are detected outside the product plan and allowlist.
- [x] Implement `scripts/verify-legacy-name-allowlist.mjs` using `rg --json` or a structured child-process wrapper, not ad hoc unchecked string parsing.
- [x] Allow current compatibility items by exact path and rationale: protocol service type, sidecar health service, Go module path, keychain/shared-pref migration strings, old data-dir migration paths, and historical docs under `docs/superpowers/*`.
- [x] Add `verify:legacy-names` to root `package.json`.
- [x] Keep the script advisory at first if current hits are intentionally broad; later rename tasks tighten it to CI-blocking.

**Verification:**

```bash
node scripts/verify-legacy-name-allowlist.mjs
pnpm format:check -- scripts/verify-legacy-name-allowlist.mjs docs/rename/legacy-name-allowlist.md
```

## Task 1: Release Profiles Become Channels

**Owner:** Worker, isolated.

**Files:**

- Modify: `scripts/release/release-profiles.mjs`
- Modify: `scripts/release/release.mjs`
- Modify: `scripts/release/__tests__/release-profiles.test.mjs`
- Modify: `scripts/release/__tests__/release-cli.test.mjs`
- Modify: `apps/mobile/src/release-profile.ts`

- [x] Update tests first so `listReleaseProfileNames()` expects `['prod', 'review']`.
- [x] Change `RELEASE_PROFILES` to channel-oriented objects with `name`, `channel`, `review`, `apiBaseUrl`, and one neutral `electronBuilderConfig`.
- [x] Remove `market` from profile objects, `buildProfileEnv()`, dry-run output, and generated `mobileReleaseProfile`.
- [x] Emit `LYNAVO_RELEASE_CHANNEL`, `LYNAVO_API_BASE_URL`, `LYNAVO_CLIENT_CONFIG_BASE_URL`, and `LYNAVO_GIFTCARD_REDEEM_BASE_URL`.
- [x] Do not emit `SYNCFLOW_MARKET`, `SYNCFLOW_API_BASE_URL`, or `VIVIDROP_API_BASE_URL` from release profiles.
- [x] Keep review/prod URL integrity checks. `review` must use the review API; `prod` must not.
- [x] Keep Android/iOS command updates conservative if native tasks have not landed: document temporary blockers in the test expectations rather than pretending neutral native commands work.

**Verification:**

```bash
pnpm test:release
node scripts/dev/__tests__/release-profile-dev.test.mjs
node scripts/release/release.mjs --profile review --targets ios,android,mac,win,linux --dry-run
```

## Task 2: Dev Profile Runner And Package Aliases

**Owner:** Worker, isolated after Task 1.

**Files:**

- Modify: `scripts/dev/release-profile-dev.mjs`
- Modify: `scripts/dev/run-release-profile.mjs`
- Modify: `scripts/dev/__tests__/release-profile-dev.test.mjs`
- Modify: `package.json`
- Modify: `apps/desktop/package.json`

- [x] Update dev-run tests first to use `prod` / `review`, with no `Market:` output and no market env.
- [x] Rename root scripts from `*:global-prod` to `*:prod` or `*:review`.
- [x] Generate a source-default mobile profile with `name: 'source-default'`, `channel: 'dev'`, `review: false`, and `apiBaseUrl: ''`. Generated mobile profiles must not include `market`.
- [x] Remove desktop `package:*:cn` and `package:*:global` scripts only after release profiles no longer call them.
- [x] Keep current native target names where native cleanup has not landed, but isolate them behind explicit compatibility comments that point to Task 9 and Task 10.

**Verification:**

```bash
node --test scripts/dev/__tests__/release-profile-dev.test.mjs
node scripts/dev/run-release-profile.mjs --profile prod --target desktop --dry-run
node scripts/dev/run-release-profile.mjs --profile review --target mobile-metro --set-mobile-profile-only --dry-run
```

## Task 3: Contracts Entitlement And Product Constants

**Owner:** Worker, isolated.

**Files:**

- Modify: `packages/contracts/src/service-endpoints.ts`
- Modify: `packages/contracts/src/types.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify/Test: `packages/contracts/src/__tests__/exports.test.ts`

- [x] Add failing tests for Lynavo endpoint constants and `DriveEntitlements` exports.
- [x] Add `ReleaseChannel = 'dev' | 'review' | 'prod'`.
- [x] Add `Distribution = 'community' | 'official'`.
- [x] Add `DriveFeatureKey`, `EntitlementSource`, and `DriveEntitlements`.
- [x] Add `resolveDriveEntitlements(input)` with foreground LAN fail-open and background/remote fail-closed behavior.
- [x] Keep the pre-rename contracts package name unchanged in this task; package rename is Task 16.
- [x] Keep existing `VIVIDROP_*` constants until consumers move to Lynavo constants, but add Lynavo constants for new code.

**Required policy behavior:**

```ts
resolveDriveEntitlements({
  isAuthenticated: false,
  serverEntitlements: null,
  now: '2026-06-29T00:00:00.000Z',
});
// foreground true, source 'guest'
```

**Verification:**

```bash
pnpm --filter @lynavo-drive/contracts test
pnpm --filter @lynavo-drive/contracts typecheck
```

## Task 4: Mobile Single App Config

**Owner:** Worker, isolated.

**Files:**

- Create: `apps/mobile/src/config/app-config.ts`
- Create/Test: `apps/mobile/src/config/__tests__/app-config.test.ts`
- Modify: `apps/mobile/src/services/config.ts`
- Modify: `apps/mobile/src/constants/legal.ts`
- Modify: `apps/mobile/src/constants/iap.ts`
- Modify: `apps/mobile/src/utils/subscriptionPaymentRouting.ts`
- Modify relevant tests under `apps/mobile/src/services/__tests__`, `constants/__tests__`, and `utils/__tests__`

- [x] Write tests that assert `appConfig` has no `market`, no `cn` fallback, and Lynavo global values.
- [x] Introduce `appConfig` with `productName: 'Lynavo Drive'`, `bundleId: 'com.lynavo.drive.mobile'`, Lynavo web/API/support placeholders, Apple/Google login providers, and Lynavo IAP IDs.
- [x] Move legal URL and IAP fallback constants to `appConfig`.
- [x] Make `subscriptionPaymentRouting` global-only: Apple on iOS, Google Play on Android, no mainland wallet routing.
- [x] Keep `apps/mobile/src/markets/**` in place until Task 11 removes remaining callers; do not edit navigation/auth in this task.
- [x] Do not touch `SyncEngineModule` or any queue/native upload APIs.

**Verification:**

```bash
pnpm --filter @lynavo-drive/mobile test -- src/config/__tests__/app-config.test.ts src/services/__tests__/config.release-profile.test.ts src/constants/__tests__/iap.test.ts src/utils/__tests__/subscriptionPaymentRouting.test.ts
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
```

## Task 5: Mobile Guest Local Mode

**Owner:** Worker, isolated after Task 4.

**Files:**

- Modify: `apps/mobile/src/navigation/RootNavigator.tsx`
- Modify: `apps/mobile/src/stores/auth-store.tsx`
- Modify: `apps/mobile/src/stores/bootstrapAuthedSession.ts`
- Create/Test: `apps/mobile/src/navigation/__tests__/RootNavigator.local-mode.test.tsx`
- Create/Test: `apps/mobile/src/stores/__tests__/auth-store-local-mode.test.tsx`
- Modify existing RootNavigator subscription tests as needed

- [x] Write tests showing no persisted token routes to `DeviceDiscovery` or `SyncActivity`, not `Login`.
- [x] Preserve existing binding-state routing: guest with binding goes to `SyncActivity`; guest without binding goes to `DeviceDiscovery`.
- [x] Keep official login/profile bootstrap only for authenticated sessions.
- [x] Do not call `wipeSyncIdentity`, `setOwnerUserId`, sidecar reset, or `clearUserScopedStorage` during guest/local bootstrap.
- [x] Remove broad subscription route blocking from foreground LAN routes. Subscription screens remain reachable from paid-feature entry points.
- [x] Keep pairing invalidation watcher active for local mode.
- [x] Do not change sync queue, auto-upload native methods, or visual design.

**Verification:**

```bash
pnpm --filter @lynavo-drive/mobile test -- src/navigation/__tests__/RootNavigator.local-mode.test.tsx src/navigation/__tests__/RootNavigator.subscription.test.tsx src/stores/__tests__/auth-store-local-mode.test.tsx
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
```

## Task 6: Mobile Paid Feature Entitlement Resolver

**Owner:** Worker, isolated after Task 3 and Task 5.

**Files:**

- Create: `apps/mobile/src/entitlements/drive-entitlements.ts`
- Create/Test: `apps/mobile/src/entitlements/__tests__/drive-entitlements.test.ts`
- Modify: `apps/mobile/src/stores/auth-store.tsx`
- Modify: `apps/mobile/src/services/tunnel-credentials-service.ts`
- Modify: `apps/mobile/src/services/app-config-service.ts`
- Modify: `apps/mobile/src/services/subscription-service.ts`
- Modify: `apps/mobile/src/screens/RemoteAccessGlobalScreen.tsx`
- Modify: `apps/mobile/src/screens/SharedFilesGlobalScreen.tsx`

- [x] Add a thin mobile resolver that consumes `resolveDriveEntitlements` from contracts.
- [x] Ensure guest/free/expired users never fetch `/tunnel/turn-credentials`.
- [x] Clear stale native tunnel credentials when entitlement is missing or expired.
- [x] Keep foreground LAN auto-upload enabled for guest/local mode.
- [x] Gate backend-driven `background_silent_audio` so OSS/community without official capability cannot enable native background continuation.
- [x] Preserve omitted `entitlement_expire_at` as missing so paid paths fail closed; only explicit `null` can represent non-expiring grants.
- [x] Remote access UI should distinguish disabled by subscription from network failure.
- [x] Do not implement native background continuation in this task.

**Verification:**

```bash
pnpm --filter @lynavo-drive/mobile test -- src/entitlements/__tests__/drive-entitlements.test.ts src/services/__tests__/tunnel-credentials-service.test.ts src/services/__tests__/app-config-service.test.ts
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
```

## Task 7: Desktop Product Helper And Market Removal

**Owner:** Worker, isolated.

**Files:**

- Delete/Replace: `apps/desktop/src/shared/market.ts`
- Create: `apps/desktop/src/shared/product.ts`
- Modify/Test: `apps/desktop/src/shared/__tests__/market.test.ts` or replace with `product.test.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/main/sidecar-client.ts`
- Modify: `apps/desktop/src/main/oauth-config.ts`
- Modify desktop tests for sidecar client and OAuth config

- [x] Write tests that `PRODUCT_NAME` is `Lynavo Drive` and no desktop runtime behavior depends on `SYNCFLOW_MARKET`.
- [x] Replace `isGlobalMarket()` with product/channel/distribution constants or remove the branch entirely.
- [x] Default API base for desktop should be Lynavo global/prod unless `LYNAVO_API_BASE_URL` overrides it.
- [x] Keep compatibility with old env vars only in a narrow bootstrap layer if necessary, with warnings and legacy allowlist entries.
- [x] Do not touch renderer auth shell behavior in this task.

**Verification:**

```bash
pnpm --filter @lynavo-drive/desktop exec vitest run src/shared src/main/__tests__/sidecar-client.test.ts src/main/__tests__/oauth-config.test.ts
pnpm --filter @lynavo-drive/desktop typecheck
```

## Task 8: Desktop Guest Local Shell

**Owner:** Worker, isolated after Task 7.

**Files:**

- Modify: `apps/desktop/src/renderer/features/layout/AppShell.tsx`
- Modify: `apps/desktop/src/renderer/components/shared/AuthPage.tsx`
- Modify: `apps/desktop/src/renderer/components/shared/LoginDialog.tsx`
- Modify/Test: `apps/desktop/src/renderer/features/layout/__tests__/AppShell.test.tsx`
- Modify/Test: auth/login/settings tests as needed

- [x] Write tests showing no session still renders the local shell and starts sidecar-backed local surfaces.
- [x] Move login to Settings/Remote/Subscription entry points instead of blocking the entire app.
- [x] Keep connection-code setup behavior intact for local pairing.
- [x] Remove SMS/CN login assumptions from desktop login UI where touched.
- [x] Do not make renderer call sidecar or filesystem directly.

**Verification:**

```bash
pnpm --filter @lynavo-drive/desktop exec vitest run src/renderer/features/layout/__tests__/AppShell.test.tsx src/renderer/components/shared/__tests__/AuthPage.test.tsx src/renderer/components/shared/__tests__/LoginDialog.test.tsx
pnpm --filter @lynavo-drive/desktop typecheck
```

## Task 9: Android Flavor Removal

**Owner:** Worker, isolated.

**Files:**

- Modify: `apps/mobile/android/app/build.gradle`
- Modify: `apps/mobile/android/app/src/main/AndroidManifest.xml`
- Modify: Android `MainApplication.kt` under the package path active at the time of the task
- Delete: `apps/mobile/android/app/src/cn/**`
- Delete: `apps/mobile/android/app/src/global/**`
- Delete or modify: `apps/mobile/android/app/src/testCn/**`
- Delete: Android native market module package
- Modify Android tests that reference flavors/tasks

- [x] Write/update Gradle or script tests so `assembleCn*` and `assembleGlobal*` are no longer expected.
- [x] Remove `flavorDimensions`, `productFlavors`, `cnImplementation`, Alipay, WeChat, `NativeMarketConfigPackage`, and `NativeMarketConfigModule`.
- [x] Keep the pre-Lynavo Java/Kotlin package path until Task 17 to reduce churn.
- [x] Set one `applicationId`. Use `com.lynavo.drive.mobile` only if signing/store migration has been accepted for this branch; otherwise document why it remains legacy.
- [x] Remove WeChat manifest query/activity and the legacy auth URL scheme only when OAuth redirect strategy is updated in the same task.
- [x] Do not change foreground/background sync behavior except what is required to compile without market modules.

**Verification:**

```bash
cd apps/mobile/android && ./gradlew test assembleDebug
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
```

## Task 10: iOS Scheme And Market Config Collapse

**Owner:** Worker, isolated.

**Files:**

- Modify: `apps/mobile/ios/LynavoDrive.xcodeproj/project.pbxproj`
- Modify/Delete: `apps/mobile/ios/LynavoDrive.xcodeproj/xcshareddata/xcschemes/*`
- Modify: `apps/mobile/ios/LynavoDrive/Info.plist`
- Modify: `apps/mobile/ios/LynavoDrive/AppleAuthModule.swift`
- Modify: `apps/mobile/ios/LynavoDrive/LynavoDrive.entitlements`
- Delete or merge: `apps/mobile/ios/LynavoDrive/LynavoDriveGlobal.entitlements`
- Modify: `apps/mobile/ios/Podfile`
- Modify: `apps/mobile/ios/scripts/testflight-release.sh`

- [x] Choose one surviving scheme for this task: `LynavoDrive`.
- [x] Remove `DebugGlobal` / `ReleaseGlobal` and `SYNCFLOW_MARKET`.
- [x] Remove `SyncFlowMarket` from `Info.plist` and `AppleAuthModule` constants.
- [x] Preserve Apple Sign-In entitlement in the surviving entitlement file.
- [x] Keep old mDNS identity only until the mDNS migration task; Task 17C switches to `_lynavodrive._tcp` without dual discovery.
- [x] Do not remove background modes until paid background entitlement gates are implemented and verified.

**Verification:**

```bash
cd apps/mobile/ios && pod install
cd apps/mobile/ios && xcodebuild -workspace LynavoDrive.xcworkspace -scheme LynavoDrive -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
```

## Task 11: Mobile Market Directory And CN Flow Removal

**Owner:** Worker, isolated after Tasks 4, 5, 9, and 10.

**Files:**

- Delete: `apps/mobile/src/markets/**`
- Modify: all remaining mobile imports of `activeMarket`, `marketConfig`, `isGlobalMarket`, and `isChinaMarket`
- Modify/Delete: `LoginScreen.tsx`, `SmsVerifyScreen.tsx`, `mainland-payment-service.ts`, `phone-validation.ts`, and related tests as needed
- Rename global screens/components only when import churn is contained

- [x] First run `rg -n "activeMarket|marketConfig|isGlobalMarket|isChinaMarket|../markets|../../markets" apps/mobile/src`.
- [x] Replace remaining call sites with `appConfig`, entitlement checks, or unconditional Lynavo/global behavior.
- [x] Delete SMS/phone/CN wallet paths only when no navigator references remain.
- [x] Keep existing `*GlobalScreen.tsx` filenames if a full rename would create broad visual churn; record them in legacy allowlist with follow-up cleanup.
- [x] Do not add manual file selection as a free alternative path.

**Verification:**

```bash
rg -n "activeMarket|marketConfig|isGlobalMarket|isChinaMarket|SYNCFLOW_MARKET|cnMarket|globalMarket" apps/mobile/src
pnpm --filter @lynavo-drive/mobile test
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
```

## Task 12: Desktop Packaging And Visible Branding

**Owner:** Worker, isolated after Task 7.

**Files:**

- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/electron-builder.yml`
- Delete: `apps/desktop/electron-builder.cn.yml`
- Delete: `apps/desktop/electron-builder.global.yml`
- Modify: `apps/desktop/resources/installer.nsh`
- Modify: `apps/desktop/scripts/**`
- Modify desktop i18n/assets references as needed

- [x] Write/update script tests for one builder config and Lynavo artifact names.
- [x] Set product name and artifact names to Lynavo Drive / `LynavoDrive-*`.
- [x] Remove `package:*:cn` and `package:*:global` references if not already removed.
- [x] Keep sidecar binary name `syncflow-sidecar` until sidecar binary migration task unless all resources/scripts are changed together.
- [x] Keep existing Windows firewall / mDNS identity for Task 15 compatibility; Lynavo Drive rule naming and old-rule cleanup are deferred to the native/binary/mDNS migration task.
- [x] Do not alter sidecar data-dir defaults in this task.

**Verification:**

```bash
node --test apps/desktop/scripts/__tests__/package-linux.test.mjs apps/desktop/scripts/__tests__/run-electron-vite-config.test.mjs apps/desktop/scripts/__tests__/build-sidecar-linux.test.mjs
pnpm --filter @lynavo-drive/desktop typecheck
```

## Task 13: Sidecar Remote Entitlement Guard

**Owner:** Worker, isolated after Task 3 and desktop/mobile entitlement clients exist.

**Files:**

- Modify: `services/sidecar-go/internal/api/handlers_settings.go`
- Modify: `services/sidecar-go/internal/api/handlers_personal.go`
- Modify: `services/sidecar-go/internal/api/router.go`
- Modify/Test: `services/sidecar-go/internal/api/router_test.go`
- Modify: `apps/desktop/src/main/sidecar-client.ts` only if request DTOs need to include entitlement context

- [x] Add tests proving guest/free/expired remote requests and `/tunnel/credentials` fail closed even when UI is bypassed.
- [x] Keep local LAN/presence/settings APIs available where they are local-only and not remote-tunnel features.
- [x] Split logs into disabled by user setting, missing entitlement, missing account context, and invalid device authorization.
- [x] Ensure clearing tunnel credentials stops any existing tunnel.
- [x] Do not rename mDNS or data dirs in this task.

**Verification:**

```bash
cd services/sidecar-go && go test ./internal/api
pnpm --filter @lynavo-drive/desktop exec vitest run src/main/__tests__/sidecar-client.test.ts
```

## Task 14: Docs And Release Rule Rewrite

**Owner:** Worker, isolated after code command shape is known.

**Files:**

- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/release/release-playbook.md`
- Rename/replace: `docs/release/market-release-flow.md`
- Create: `docs/open-source/community-build.md`
- Create: `docs/commercial/feature-boundary.md`
- Create: `docs/testing/global-only-qa.md`

- [x] Replace release commands with `pnpm release --profile review|prod --targets ...`.
- [x] Remove cn regression language from OSS docs.
- [x] Document guest local mode, paid background/remote boundaries, and no manual-file-selection replacement.
- [x] Update AGENTS release-profile rule so future agents do not use `cn-prod` / `global-prod`.
- [x] Keep beta/TestFlight tag rules if still applicable, but update product naming.

**Verification:**

```bash
rg -n "cn-prod|global-prod|cn-review|global-review|SYNCFLOW_MARKET" README.md AGENTS.md docs/release docs/open-source docs/commercial docs/testing
pnpm format:check README.md AGENTS.md docs/release docs/open-source docs/commercial docs/testing
```

## Task 15: Commercial Logic Removal For OSS Edition

**Owner:** Multiple workers, split by platform after Tasks 0-14 and review fixes are green.

**Files:**

- Modify/Delete: `apps/mobile/src/screens/SubscriptionGlobalScreen.tsx`
- Modify/Delete: `apps/mobile/src/services/subscription-service.ts`
- Modify/Delete: `apps/mobile/src/services/subscription-plans-service.ts`
- Modify/Delete: `apps/mobile/src/services/iap-service.ts`
- Modify/Delete: `apps/mobile/src/services/tunnel-credentials-service.ts`
- Modify/Delete: `apps/mobile/src/hooks/useSubscriptionPlans.ts`
- Modify/Delete: mobile subscription/IAP/gift-card tests and i18n entries
- Modify: `apps/mobile/src/navigation/RootNavigator.tsx`
- Modify: `apps/mobile/src/screens/SharedFilesGlobalScreen.tsx`
- Modify: `apps/mobile/src/screens/RemoteAccessGlobalScreen.tsx`
- Modify: `apps/mobile/src/services/app-config-service.ts`
- Modify: `apps/desktop/src/main/sidecar-client.ts`
- Modify: `apps/desktop/src/main/diagnostics.ts`
- Modify: `services/sidecar-go/internal/api/**`
- Modify: release/dev scripts and OSS docs as needed

- [x] Remove IAP purchase, restore, StoreKit/Google Play verification, subscription plan loading, and gift-card redeem flows from the OSS runtime.
- [x] Remove or hide official login/profile/subscription bootstrap wherever it only exists for commercial access. Preserve local device pairing, pairing tokens, and paired-device HMAC local access.
- [x] Remove TURN credential fetch, official signaling, and remote tunnel activation from community mobile/desktop runtime paths. Local LAN sync and local personal/shared file access must remain available.
- [x] Replace paid-feature CTAs with open-source copy that describes local LAN capability and, if needed, points to documentation rather than purchase screens.
- [x] Delete unused commercial service modules, tests, i18n keys, endpoint env vars, and release profile env entries after consumers are gone.
- [x] Keep foreground LAN fail-open, read-only queue semantics, pending-queue upload source, and one-file-at-a-time mobile upload behavior unchanged.
- [x] Do not combine this task with package scope, native namespace, data-dir, binary, or mDNS migrations.

**Verification:**

```bash
rg -n "SubscriptionGlobalScreen|iap|purchase|restore|gift.?card|turn-credentials|LYNAVO_GIFTCARD|subscription/status" apps packages scripts services docs --glob '!**/node_modules/**'
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
pnpm --filter @lynavo-drive/desktop test
pnpm --filter @lynavo-drive/desktop typecheck
cd services/sidecar-go && go test ./...
```

Task 15 verification update, 2026-06-30:

- The `pnpm --filter ...` wrapper commands were blocked before execution by `ERR_PNPM_IGNORED_BUILDS` for `electron-winstaller` and `esbuild`.
- Equivalent local package verification passed: mobile `./node_modules/.bin/tsc --noEmit`, desktop `./node_modules/.bin/vitest run`, desktop web/node `tsc --noEmit`, contracts vitest/tsc, release/dev `node --test`, and sidecar `go test -count=1 ./...`.
- `node scripts/release/release.mjs --profile prod --targets ios,android,mac,win,linux --dry-run` passed and emits only `LYNAVO_RELEASE_CHANNEL`, `LYNAVO_API_BASE_URL`, and `ELECTRON_BUILDER_CONFIG`.
- A focused runtime scan found remaining commercial keyword hits only in negative regression tests, scrubber deny-lists, entitlement compatibility tests, historical docs, or non-commercial uses such as `restoreAllMocks` / local disk restore.

## Task 16: Package Scope Rename

**Owner:** Worker, broad churn task after commercial removal behavior tasks are green.

**Files:**

- Modify: `packages/contracts/package.json`
- Modify: `packages/design-tokens/package.json`
- Modify: all imports of the contracts and design-token workspace packages
- Modify: root and app `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: Vite/tsconfig/test setup that references old package names

- [x] Rename packages to `@lynavo-drive/contracts` and `@lynavo-drive/design-tokens`.
- [x] Run `pnpm install` to update the lockfile.
- [x] Update all source imports and tests.
- [x] Keep protocol constants stable unless the mDNS migration task is executed.
- [x] Do not mix with behavioral changes.

**Verification:**

```bash
pnpm install
rg -n "@syncflow/(contracts|design-tokens|desktop|mobile)" apps packages scripts services README.md AGENTS.md CLAUDE.md package.json pnpm-lock.yaml .vscode docs --glob '!docs/product/lynavo-drive-global-only-oss-commercial-plan.md'
pnpm build
pnpm typecheck
pnpm test
```

## Task 17: Native Package, Data Dir, Binary, And mDNS Migration

**Owner:** Worker, broad migration task after Tasks 9, 10, 12, 15, and 16.

**Files:**

- Modify: `apps/mobile/android/**`
- Modify: `apps/mobile/ios/**`
- Modify: `services/sidecar-go/**`
- Modify: `apps/desktop/scripts/**`
- Modify: `apps/desktop/resources/**`
- Modify: `packages/contracts/src/protocol.ts`

- [x] Rename Android package/namespace and FileProvider authority. No legacy keychain/shared prefs compatibility is required for the OSS baseline.
- [x] Rename iOS target/project directories only if Xcode scheme/build commands are updated and verified.
- [x] Rename sidecar binary to `lynavo-drive-sidecar`.
- [x] Drop legacy data-dir compatibility; fresh OSS state uses `Lynavo Drive` only.
- [x] Decide mDNS compatibility: Lynavo Drive is incompatible with old `_syncflow._tcp` clients and uses `_lynavodrive._tcp` only.
- [x] Update health service identity to `lynavo-drive-sidecar` only.

**Verification:**

```bash
cd services/sidecar-go && go test ./...
cd apps/mobile/android && ./gradlew test assembleDebug
cd apps/mobile/ios && xcodebuild -workspace LynavoDrive.xcworkspace -scheme LynavoDrive -configuration Debug -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
pnpm build
pnpm typecheck
```

## Final Verification Gate

Run the narrow checks for each task as it lands. Before claiming the branch is complete, run:

```bash
node scripts/verify-legacy-name-allowlist.mjs
pnpm test:release
pnpm --filter @lynavo-drive/contracts test
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
pnpm --filter @lynavo-drive/desktop test
pnpm --filter @lynavo-drive/desktop typecheck
cd services/sidecar-go && go test ./...
```

Native release builds are required before shipping but may be deferred if the current machine lacks Android/Xcode signing prerequisites:

```bash
cd apps/mobile/android && ./gradlew test assembleDebug assembleRelease
cd apps/mobile/ios && xcodebuild -workspace LynavoDrive.xcworkspace -scheme LynavoDrive -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

Native verification update, 2026-06-30:

- Android local build passed with explicit local env:
  `JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=/Users/blooming/Library/Android/sdk ANDROID_SDK_ROOT=/Users/blooming/Library/Android/sdk ./gradlew test assembleDebug --stacktrace`.
  The initial failure was environmental: NDK `28.2.13676358` existed as an incomplete `.installer` directory without `source.properties`; reinstalling that NDK with `sdkmanager` fixed the root cause.
- iOS local simulator Debug compile passed after `pod install` restored stale CocoaPods header symlinks. `Podfile.lock` was updated to match the current `Podfile` checksum and CocoaPods-generated spec checksums; no pod versions changed.
