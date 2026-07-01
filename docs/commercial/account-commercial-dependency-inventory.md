# Account And Commercial Dependency Inventory

Status: collected on 2026-07-01 for the global-only community OSS baseline.

This inventory separates local-first LAN functionality from official commercial
features. It is a planning artifact: it does not authorize deleting LAN sync,
paired-device HMAC access, pending queue behavior, or local shared-directory
browsing.

## Classification

| Class                    | Meaning                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------- |
| Keep baseline            | Required for community OSS local LAN behavior.                                         |
| Keep fail-closed stub    | Compatibility surface may stay, but must never enable paid behavior in OSS.            |
| Move to official overlay | Positive commercial behavior should live outside the OSS baseline.                     |
| Moved out of OSS         | Commercial runtime surface has been removed from the OSS baseline in the current tree. |
| Delete or rename         | Remove unused commercial residue or rename misleading local-LAN names.                 |
| Harden                   | Not a commercial feature by itself, but should be tightened before public OSS release. |

## Current Conclusions

1. Foreground local LAN sync is mostly fail-open already. Desktop has no auth
   shell, mobile routes guests into `LanSyncStack`, and sidecar TCP sync gates on
   pairing/HMAC rather than account state.
2. `@lynavo-drive/contracts` now exposes only the community foreground LAN
   entitlement. Commercial background and tunnel entitlement fields were removed
   from the OSS contract surface.
3. Mobile still carries the largest commercial residue outside tunnel runtime:
   legacy auth state, iOS background URLSession/BGTask code, and Android
   foreground service coupling. Native tunnel credential bridges and bundled
   MobileTunnel artifacts have been removed from the OSS runtime.
4. "RemoteAccess" often means LAN personal-directory browsing in current mobile
   and desktop UI. Do not delete it as paid tunnel code without first splitting
   the naming and route policy.
5. Sidecar keeps commercial compatibility endpoints (`/account/context`,
   `/tunnel/credentials`, `/wake/proxy`) and returns OSS-disabled errors. That is
   acceptable as a temporary fail-closed stub, but the positive implementation
   belongs in an official overlay.

## Desktop Inventory

| Area                    | Evidence                                                                                                                                                                                       | Classification           | Next action                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------- |
| Product distribution    | `apps/desktop/src/shared/product.ts:6` sets `PRODUCT_DISTRIBUTION = 'community'`.                                                                                                              | Keep baseline            | Keep as OSS identity guard.                                                  |
| Auth IPC/preload        | `apps/desktop/src/main/ipc-handlers.ts:30`, `apps/desktop/src/preload/index.ts:58`; guard tests in `ipc-handlers.test.ts:261` and `preload/__tests__/index.test.ts:71`.                        | Keep baseline            | Preserve guard tests that no auth/session/subscription bridge is exposed.    |
| Sidecar commercial sync | `apps/desktop/src/main/sidecar-client.ts:312` skips commercial credential sync; `sidecar-manager.test.ts:146` and `:188` guard no credential refresh even when tunnel health asks for refresh. | Keep fail-closed stub    | Keep stub until official overlay owns positive credential sync.              |
| Remote sidecar plumbing | `apps/desktop/src/main/sidecar-client.ts:38` has remote header/timeout helpers, but default methods use local `127.0.0.1`.                                                                     | Move to official overlay | Remove or isolate remote base URL dispatch from OSS once no caller needs it. |
| Tunnel health read      | `apps/desktop/src/main/sidecar-client.ts:99` reads optional `tunnel` health only.                                                                                                              | Keep fail-closed stub    | Keep read-only health; do not trigger credential refresh in OSS.             |
| Settings store default  | `apps/desktop/src/renderer/stores/settings-store.ts:40` defaults `remoteAccessEnabled: true` while sidecar always returns false.                                                               | Delete or rename         | Change OSS initial value to false/absent in a follow-up.                     |
| Misleading UI keys      | `apps/desktop/src/renderer/features/dashboard/Dashboard.tsx:301`, `apps/desktop/src/renderer/i18n/locales/en/dashboard.json:32` use `remoteAccess*` keys for local file access.                | Delete or rename         | Rename to local-file-access keys after snapshot/test impact is scoped.       |
| Unused auth copy        | `apps/desktop/src/renderer/i18n/locales/en/common.json:84` and zh locale peers keep `authPage` copy with no non-locale references.                                                             | Delete or rename         | Remove unused auth locale blocks.                                            |
| Support/update backend  | `apps/desktop/src/main/diagnostics.ts:473` and `:712` can call official support/update APIs.                                                                                                   | Keep baseline with note  | Treat as support service dependency, not account/tunnel sync.                |
| Local pairing/resources | Dashboard QR pairing, IPC local sidecar, received library and shared resources are local LAN features.                                                                                         | Keep baseline            | Do not remove; these are not manual mobile upload alternatives.              |

## Mobile JS Inventory

| Area                          | Evidence                                                                                                                   | Classification           | Next action                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Guest LAN routing             | `apps/mobile/src/navigation/RootNavigator.tsx:86` and `:102` route unauthenticated users into LAN sync.                    | Keep baseline            | Preserve fail-open guest local LAN behavior.                                                                      |
| Auth state shell              | `apps/mobile/src/stores/auth-store.tsx:23`, `:57`, `:115`, `:146`, `:240`.                                                 | Keep fail-closed stub    | Keep token cleanup now; shrink legacy `UserProfile`/`SubscriptionInfo` after callers are removed.                 |
| Broad feature gate            | `apps/mobile/src/stores/auth-store.tsx:371`; `SyncActivityScreen.tsx:654` consumes it.                                     | Delete or rename         | Remove `isFeatureAccessAllowed` and the `useAuth` dependency from sync activity; it is a dead compatibility gate. |
| API bearer auth               | `apps/mobile/src/services/api.ts:94` returns no auth headers; `:187` rejects `/auth/refresh`.                              | Keep fail-closed stub    | Keep until all official account API callers are absent; then simplify.                                            |
| Auth service bridge           | `apps/mobile/src/services/auth-service.ts:34` documents official helpers absent.                                           | Keep fail-closed stub    | Remove only after `api.ts` no longer needs clear-auth callbacks.                                                  |
| App config                    | `apps/mobile/src/services/app-config-service.ts:36` disables silent audio and public IP.                                   | Keep fail-closed stub    | Keep OSS default false; official overlay may inject config later.                                                 |
| Native tunnel bridge          | `apps/mobile/src/services/SyncEngineModule.ts` no longer exports a tunnel credential bridge; native bridges were removed.  | Moved out of OSS         | Keep removed; official overlays must own any positive tunnel credential path.                                     |
| Legacy owner marker           | `apps/mobile/src/services/SyncEngineModule.ts:712`, `:741`.                                                                | Delete or rename         | Remove if no OSS caller needs account-owner mismatch repair.                                                      |
| RemoteAccess naming           | `apps/mobile/src/services/desktop-local-service.ts:689`, `:1112`; `RemoteAccessGlobalScreen.tsx` uses personal LAN browse. | Delete or rename         | Keep LAN behavior, rename from remote access to personal/local computer browsing.                                 |
| Subscription locale namespace | `apps/mobile/src/i18n/resources.ts:12`, `OpenSourceInfoScreen.tsx:44`, `subscription.json:1`.                              | Delete or rename         | Rename `subscription` namespace to OSS/community info after UI impact is scoped.                                  |
| Social login residue          | `AppleAuthModule.swift` rejects login; Google Sign-In dependency and URL scheme remain but JS is unused.                   | Move to official overlay | Remove from OSS native/deps or keep only explicit unsupported stubs.                                              |

## Mobile Native Inventory

| Area                             | Evidence                                                                                                                                         | Classification           | Next action                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| iOS foreground LAN               | `SyncEngineManager.swift:4047`, `:4332`, `:4411` gates on local sync state, binding, pairing token and photo permission.                         | Keep baseline            | Preserve as guest/local sync path.                                                                                 |
| Android foreground LAN           | `NativeSyncEngineModule.kt:2270`, `:2317` starts `AndroidForegroundSyncService`; JS permission failure is surfaced at `SyncEngineModule.ts:594`. | Harden                   | Foreground LAN sync must not abort only because notification/foreground-service background support is unavailable. |
| iOS silent audio                 | `app-config-service.ts:36`; `SyncEngineManager.swift:1423` and `:1440` stop/skip when disabled.                                                  | Keep fail-closed stub    | Keep disabled in OSS; positive capability belongs in official overlay.                                             |
| iOS background URLSession/BGTask | `BackgroundExecutionService.swift:66`, `BackgroundUploadService.swift:17`, `SyncEngineManager.swift:1484`, `:3289`.                              | Move to official overlay | Add entitlement/capability gate or remove from OSS build.                                                          |
| Android foreground service       | `AndroidManifest.xml:48`, `AndroidForegroundSyncService.kt:17`.                                                                                  | Move to official overlay | Split foreground LAN transfer from paid background continuation.                                                   |
| iOS P2P tunnel                   | RN bridge credential entrypoints and the former iOS tunnel xcframework were removed; `LocalTCPProxy` is an OSS no-op.                            | Moved out of OSS         | Keep no-op/direct-LAN behavior unless an official overlay supplies the private tunnel runtime.                     |
| Android P2P tunnel               | RN bridge credential entrypoints and bundled MobileTunnel AAR/JAR were removed; route policy resolves to direct LAN only.                        | Moved out of OSS         | Keep direct-LAN behavior unless an official overlay supplies the private tunnel runtime.                           |
| Public wake                      | `SharedFilesRoutePolicy.swift:14`, `AndroidSyncPrimitives.kt:191` are fail-closed.                                                               | Keep fail-closed stub    | Keep disabled; same-LAN WoL can remain local baseline if not account/relay backed.                                 |
| Manual file selection            | `SyncEngineModule.ts:314`, `AutoUploadSettingsGlobalScreen.tsx:347`, `NativeSyncEngineModule.kt:1210`.                                           | Harden                   | Separate non-commercial invariant risk: OSS must not offer manual file selection as an upload replacement.         |

## Sidecar And Contracts Inventory

| Area                      | Evidence                                                                                               | Classification           | Next action                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------ | ---------------------------------------------------------------------------------- |
| Entitlement contract      | `packages/contracts/src/types.ts` keeps only the foreground LAN entitlement and resolver metadata.     | Keep baseline            | Keep OSS contract surface free of commercial background/tunnel fields.             |
| Subscription DTOs         | `packages/contracts/src/types.ts:667`.                                                                 | Move to official overlay | Remove/move paywall DTOs after no OSS package exports require them.                |
| Tunnel/signaling DTOs     | `packages/contracts/src/enums.ts:14`, `packages/contracts/src/types.ts:714`.                           | Move to official overlay | Keep only LAN route DTOs in OSS or mark tunnel/relay as official-only.             |
| Service endpoints         | `packages/contracts/src/service-endpoints.ts:1`.                                                       | Delete or rename         | Audit whether OSS needs official API constants outside update/support diagnostics. |
| TCP sync                  | `services/sidecar-go/internal/server/connection.go:214`, `handler_sync.go:21`, `handler_hello.go:360`. | Keep baseline            | Preserve pairing/HMAC authenticated foreground LAN sync.                           |
| Commercial HTTP endpoints | `services/sidecar-go/internal/api/router.go:206`, `handlers_settings.go:304`, `:313`.                  | Keep fail-closed stub    | Keep temporary 403 compatibility or remove after desktop/mobile callers are gone.  |
| Remote setting            | `handlers_settings.go:217`, `:288` force `remoteAccessEnabled=false`.                                  | Keep fail-closed stub    | Keep false in OSS; avoid UI defaults that imply it can be enabled.                 |
| Tunnel health             | `handlers_health.go:25` reports tunnel disabled.                                                       | Keep fail-closed stub    | Keep as explicit OSS health signal.                                                |
| Proxy wake                | `router.go:203`, `handlers_wake.go:5`.                                                                 | Keep fail-closed stub    | Keep disabled unless official overlay implements account-backed proxy wake.        |
| Personal API              | `handlers_personal.go:41`; test at `router_test.go:2673` says no account context required.             | Keep baseline            | Treat as local paired-device HMAC browsing, not official account remote access.    |
| Mobile resources/presence | `handlers_resources.go:1027`, `presence.go:76` use paired `clientId` checks without HMAC.              | Harden                   | Add paired-device HMAC or narrower local-only rules before public OSS release.     |
| Store schema              | `001_initial.sql:1`, `005_desktop_local_management.sql:25`.                                            | Keep baseline            | No account/tunnel/entitlement persistence exists in sidecar store.                 |

## Documentation And QA Drift

| Area                   | Evidence                                                                                                                                                                        | Classification   | Next action                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------- |
| Community build docs   | `docs/open-source/community-build.md:23` says commercial native modules are not built in; tunnel binaries are now removed while background continuation still needs split work. | Delete or rename | Update wording after the background continuation split.               |
| Beta matrix background | `docs/testing/beta-test-matrix.md:140` says OSS background is fail-closed, but `:264` lists background upload/lock soak as covered.                                             | Delete or rename | Mark those as paid official coverage or foreground recovery coverage. |
| Feature boundary       | `docs/commercial/feature-boundary.md:25` requires official capability and entitlement for paid features.                                                                        | Keep baseline    | Use as the migration rule for follow-up tasks.                        |

## Recommended Follow-up Order

1. Android foreground fail-open: foreground LAN sync must not abort because
   Android notification permission or foreground-service background support is
   unavailable.
2. Background continuation split: gate or remove iOS BGTask/background
   URLSession, Android background service, and silent-audio positive paths from
   OSS.
3. Mobile auth cleanup: remove `isFeatureAccessAllowed` and sync activity auth
   dependency, then shrink legacy auth store and owner-user-id bridges.
4. Naming cleanup: split LAN personal-directory browsing from paid remote
   tunnel by renaming `RemoteAccess*`, `remoteAccessEnabled`, and related copy.
5. Contracts split: keep the foreground LAN resolver and LAN DTOs in OSS;
   move subscription plan, TURN, signaling, and tunnel/relay positive DTOs to
   official overlay.
6. Sidecar HTTP hardening: add HMAC/local-only protection to mobile resource and
   presence routes, while keeping `/personal/*` as paired-device local browsing.
7. Documentation cleanup: align beta matrix and community-build docs with the
   actual current fail-closed state.
