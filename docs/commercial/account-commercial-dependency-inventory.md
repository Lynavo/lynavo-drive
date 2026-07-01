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
3. Mobile native background continuation runtime and native shared-files tunnel
   route skeletons have been removed from the OSS baseline. The largest
   remaining mobile residue is legacy auth/account UI, RemoteAccess naming for
   LAN browsing, and manual file-selection upload surfaces.
4. "RemoteAccess" often means LAN personal-directory browsing in current mobile
   and desktop UI. Do not delete it as paid tunnel code without first splitting
   the naming and route policy.
5. Sidecar and desktop no longer expose commercial credential sync, tunnel
   health, remote-access settings, or account/tunnel/wake proxy HTTP endpoints in
   the OSS tree. Positive commercial implementations belong outside this
   baseline.

## Desktop Inventory

| Area                    | Evidence                                                                                                                                                                | Classification          | Next action                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------- |
| Product distribution    | `apps/desktop/src/shared/product.ts:6` sets `PRODUCT_DISTRIBUTION = 'community'`.                                                                                       | Keep baseline           | Keep as OSS identity guard.                                               |
| Auth IPC/preload        | `apps/desktop/src/main/ipc-handlers.ts:30`, `apps/desktop/src/preload/index.ts:58`; guard tests in `ipc-handlers.test.ts:261` and `preload/__tests__/index.test.ts:71`. | Keep baseline           | Preserve guard tests that no auth/session/subscription bridge is exposed. |
| Sidecar commercial sync | `apps/desktop/src/main/sidecar-client.ts` has no credential-sync helper; desktop tests assert the OSS client does not expose it.                                        | Moved out of OSS        | Keep removed; official overlays must own positive credential sync.        |
| Remote sidecar plumbing | `apps/desktop/src/main/sidecar-client.ts` now targets the local sidecar base and no longer carries remote request helpers.                                              | Moved out of OSS        | Keep local-only dispatch in OSS.                                          |
| Tunnel health read      | Desktop sidecar health no longer models a `tunnel` object.                                                                                                              | Moved out of OSS        | Keep health local-only.                                                   |
| Settings store default  | Renderer initial settings no longer default `remoteAccessEnabled`.                                                                                                      | Moved out of OSS        | Keep absent; do not reintroduce a remote access toggle in OSS settings.   |
| Misleading UI keys      | Desktop dashboard/setup copy now uses local-file-access keys instead of `remoteAccess*` for LAN file access.                                                            | Moved out of OSS        | Continue removing remaining unused auth copy.                             |
| Unused auth copy        | `apps/desktop/src/renderer/i18n/locales/en/common.json:84` and zh locale peers keep `authPage` copy with no non-locale references.                                      | Delete or rename        | Remove unused auth locale blocks.                                         |
| Support/update backend  | `apps/desktop/src/main/diagnostics.ts:473` and `:712` can call official support/update APIs.                                                                            | Keep baseline with note | Treat as support service dependency, not account/tunnel sync.             |
| Local pairing/resources | Dashboard QR pairing, IPC local sidecar, received library and shared resources are local LAN features.                                                                  | Keep baseline           | Do not remove; these are not manual mobile upload alternatives.           |

## Mobile JS Inventory

| Area                               | Evidence                                                                                                                                | Classification           | Next action                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------- |
| Guest LAN routing                  | `apps/mobile/src/navigation/RootNavigator.tsx:86` and `:102` route unauthenticated users into LAN sync.                                 | Keep baseline            | Preserve fail-open guest local LAN behavior.                                                      |
| Auth state shell                   | `apps/mobile/src/stores/auth-store.tsx:23`, `:57`, `:115`, `:146`, `:240`.                                                              | Keep fail-closed stub    | Keep token cleanup now; shrink legacy `UserProfile`/`SubscriptionInfo` after callers are removed. |
| Broad feature gate                 | `isFeatureAccessAllowed` was removed from `auth-store`; `SyncActivityScreen.tsx` no longer consumes auth state for local sync activity. | Removed from OSS         | Keep foreground LAN sync activity independent of account/subscription state.                      |
| API bearer auth                    | `apps/mobile/src/services/api.ts:94` returns no auth headers; `:187` rejects `/auth/refresh`.                                           | Keep fail-closed stub    | Keep until all official account API callers are absent; then simplify.                            |
| Auth service bridge                | `apps/mobile/src/services/auth-service.ts:34` documents official helpers absent.                                                        | Keep fail-closed stub    | Remove only after `api.ts` no longer needs clear-auth callbacks.                                  |
| App config                         | `apps/mobile/src/services/app-config-service.ts` no longer calls paid native feature toggles.                                           | Keep fail-closed stub    | Keep OSS no-op; official overlay must own positive native config.                                 |
| Native tunnel bridge               | `apps/mobile/src/services/SyncEngineModule.ts` no longer exports a tunnel credential bridge; native bridges were removed.               | Moved out of OSS         | Keep removed; official overlays must own any positive tunnel credential path.                     |
| Legacy account-owner compatibility | Removed from OSS mobile JS and native sync bridges.                                                                                     | Removed from OSS         | Official overlays must own any future account-owner mismatch repair path.                         |
| RemoteAccess naming                | `apps/mobile/src/services/desktop-local-service.ts:689`, `:1112`; `RemoteAccessGlobalScreen.tsx` uses personal LAN browse.              | Delete or rename         | Keep LAN behavior, rename from remote access to personal/local computer browsing.                 |
| Subscription locale namespace      | `apps/mobile/src/i18n/resources.ts:12`, `OpenSourceInfoScreen.tsx:44`, `subscription.json:1`.                                           | Delete or rename         | Rename `subscription` namespace to OSS/community info after UI impact is scoped.                  |
| Social login residue               | `AppleAuthModule.swift` rejects login; Google Sign-In dependency and URL scheme remain but JS is unused.                                | Move to official overlay | Remove from OSS native/deps or keep only explicit unsupported stubs.                              |

## Mobile Native Inventory

| Area                          | Evidence                                                                                                                                                                                                                   | Classification   | Next action                                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| iOS foreground LAN            | `SyncEngineManager.swift:4047`, `:4332`, `:4411` gates on local sync state, binding, pairing token and photo permission.                                                                                                   | Keep baseline    | Preserve as guest/local sync path.                                                                         |
| Android foreground LAN        | `NativeSyncEngineModule.kt` now runs foreground LAN rounds without Android notification or foreground-service permission gates.                                                                                            | Keep baseline    | Preserve foreground-only runtime checks; official overlays must own any background service path.           |
| iOS silent audio              | The silent-audio service and bridge toggle were removed from OSS.                                                                                                                                                          | Moved out of OSS | Keep removed; positive capability belongs in official overlay.                                             |
| iOS background upload runtime | Background URLSession/BGTask registration, upload service code, HTTP reset state machine, UploadStore HTTP/background metadata, and the old background upload plan were removed; only short UIKit transition tasks remain. | Moved out of OSS | Keep OSS foreground-only; official overlays must own paid background upload runtime.                       |
| Android background service    | Android foreground-service class, manifest service declaration and notification resources were removed.                                                                                                                    | Moved out of OSS | Keep removed; official overlays must own paid background continuation.                                     |
| iOS P2P tunnel                | RN bridge credential entrypoints, former tunnel xcframework, old gomobile tunnel build script, `LocalTCPProxy`, tunnel route state/retry logic, and tunnel policy tests were removed.                                      | Moved out of OSS | Keep absent; iOS shared-files routing is LAN/WoL/direct-host only in OSS.                                  |
| Android P2P tunnel            | RN bridge credential entrypoints, bundled MobileTunnel AAR/JAR, old gomobile tunnel build script, tunnel route state/retry logic, peer-proxy diagnostics, and tunnel policy tests were removed.                            | Moved out of OSS | Keep absent; Android shared-files routing is LAN/WoL/direct-host only in OSS.                              |
| Public wake                   | Public Wake-on-WAN target DTOs and policy helpers were removed from iOS and Android; same-LAN WoL target metadata remains.                                                                                                 | Moved out of OSS | Keep same-LAN WoL only; do not reintroduce public/router/account-backed wake in OSS.                       |
| Manual file selection         | `SyncEngineModule.ts:314`, `AutoUploadSettingsGlobalScreen.tsx:347`, `NativeSyncEngineModule.kt:1210`.                                                                                                                     | Harden           | Separate non-commercial invariant risk: OSS must not offer manual file selection as an upload replacement. |

## Sidecar And Contracts Inventory

| Area                      | Evidence                                                                                               | Classification   | Next action                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------- | ---------------------------------------------------------------------------------- |
| Entitlement contract      | `packages/contracts/src/types.ts` keeps only the foreground LAN entitlement and resolver metadata.     | Keep baseline    | Keep OSS contract surface free of commercial background/tunnel fields.             |
| Subscription DTOs         | Paywall subscription plan DTOs were removed from `packages/contracts/src/types.ts`.                    | Moved out of OSS | Keep removed from public contracts.                                                |
| Tunnel/signaling DTOs     | `SharedFilesRouteKind` is LAN-only and TURN/signaling registration DTOs were removed from contracts.   | Moved out of OSS | Keep only LAN route DTOs in OSS.                                                   |
| Service endpoints         | `packages/contracts/src/service-endpoints.ts:1`.                                                       | Delete or rename | Audit whether OSS needs official API constants outside update/support diagnostics. |
| TCP sync                  | `services/sidecar-go/internal/server/connection.go:214`, `handler_sync.go:21`, `handler_hello.go:360`. | Keep baseline    | Preserve pairing/HMAC authenticated foreground LAN sync.                           |
| Commercial HTTP endpoints | `/account/context`, `/tunnel/credentials`, and `/wake/proxy` route registrations were removed.         | Moved out of OSS | Keep absent unless an external commercial distribution adds them.                  |
| Remote setting            | Sidecar settings DTO/update request no longer model `remoteAccessEnabled`.                             | Moved out of OSS | Keep absent; local LAN sharing is independent of account/tunnel state.             |
| Tunnel health             | `/health` no longer reports a tunnel status object.                                                    | Moved out of OSS | Keep health local-only.                                                            |
| Proxy wake                | Account-backed proxy wake handler was removed from the OSS sidecar.                                    | Moved out of OSS | Keep absent; only same-LAN wake behavior can remain in OSS.                        |
| Personal API              | `handlers_personal.go:41`; test at `router_test.go:2673` says no account context required.             | Keep baseline    | Treat as local paired-device HMAC browsing, not official account remote access.    |
| Mobile resources/presence | `handlers_resources.go:1027`, `presence.go:76` use paired `clientId` checks without HMAC.              | Harden           | Add paired-device HMAC or narrower local-only rules before public OSS release.     |
| Store schema              | `001_initial.sql:1`, `005_desktop_local_management.sql:25`.                                            | Keep baseline    | No account/tunnel/entitlement persistence exists in sidecar store.                 |

## Documentation And QA Drift

| Area                   | Evidence                                                                                                                                                             | Classification | Next action                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------- |
| Community build docs   | `docs/open-source/community-build.md:23` states commercial remote/tunnel/background native runtime is absent from community builds.                                  | Keep baseline  | Keep aligned as OSS removals continue.               |
| Beta matrix background | `docs/testing/beta-test-matrix.md` now treats OSS background as fail-closed and validates foreground pending-queue recovery instead of paid background continuation. | Keep baseline  | Keep aligned as native background removals continue. |
| Feature boundary       | `docs/commercial/feature-boundary.md:25` requires official capability and entitlement for paid features.                                                             | Keep baseline  | Use as the migration rule for follow-up tasks.       |

## Recommended Follow-up Order

1. Mobile auth cleanup: shrink legacy auth store after remaining callers are
   removed.
2. Naming cleanup: split LAN personal-directory browsing from paid remote
   tunnel by renaming `RemoteAccess*` services/screens/copy to local computer or
   shared-files terminology.
3. Manual upload cleanup: remove document picker/manual-selection upload paths
   so the true upload set only comes from the mobile pending queue.
4. Sidecar HTTP hardening: add HMAC/local-only protection to mobile resource and
   presence routes, while keeping `/personal/*` as paired-device local browsing.
