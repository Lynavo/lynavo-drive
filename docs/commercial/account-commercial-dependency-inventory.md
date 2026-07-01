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
2. `@lynavo-drive/contracts` no longer exposes Drive entitlement/source
   resolver types. Commercial background, tunnel and paid-source metadata were
   removed from the OSS contract surface.
3. Mobile native background continuation runtime, native shared-files tunnel
   route skeletons, mobile `RemoteAccess*` naming for LAN personal-directory
   browsing, and manual file-selection upload surfaces have been removed from
   the OSS baseline. Remaining mobile residue is mainly negative assertion tests
   that guard removed commercial/manual APIs.
4. Mobile LAN personal-directory browsing is now named `LocalComputer*` /
   `GlobalLocalComputer*` in JS/UI. Native shared-files policy may still
   recognize historical wire-level disabled messages for version compatibility;
   do not treat that compatibility text as a commercial capability.
5. Sidecar and desktop no longer expose commercial credential sync, tunnel
   health, remote-access settings, or account/tunnel/wake proxy HTTP endpoints in
   the OSS tree. Positive commercial implementations belong outside this
   baseline.

## Desktop Inventory

| Area                    | Evidence                                                                                                                                                                               | Classification   | Next action                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------- |
| Product distribution    | `apps/desktop/src/shared/product.ts:6` sets `PRODUCT_DISTRIBUTION = 'community'`.                                                                                                      | Keep baseline    | Keep as OSS identity guard.                                                                               |
| Auth IPC/preload        | `apps/desktop/src/main/ipc-handlers.ts:30`, `apps/desktop/src/preload/index.ts:58`; guard tests in `ipc-handlers.test.ts:261` and `preload/__tests__/index.test.ts:71`.                | Keep baseline    | Preserve guard tests that no auth/session/subscription bridge is exposed.                                 |
| Sidecar commercial sync | `apps/desktop/src/main/sidecar-client.ts` has no credential-sync helper; desktop tests assert the OSS client does not expose it.                                                       | Moved out of OSS | Keep removed; official overlays must own positive credential sync.                                        |
| Remote sidecar plumbing | `apps/desktop/src/main/sidecar-client.ts` now targets the local sidecar base and no longer carries remote request helpers.                                                             | Moved out of OSS | Keep local-only dispatch in OSS.                                                                          |
| Tunnel health read      | Desktop sidecar health no longer models a `tunnel` object.                                                                                                                             | Moved out of OSS | Keep health local-only.                                                                                   |
| Settings store default  | Renderer initial settings no longer default `remoteAccessEnabled`.                                                                                                                     | Moved out of OSS | Keep absent; do not reintroduce a remote access toggle in OSS settings.                                   |
| Misleading UI keys      | Desktop dashboard/setup copy now uses local-file-access keys instead of `remoteAccess*` for LAN file access.                                                                           | Moved out of OSS | Continue removing remaining unused auth copy.                                                             |
| Unused auth copy        | Desktop renderer locale `authPage` blocks were removed after confirming no non-locale references.                                                                                      | Removed          | Keep absent; official account UI copy belongs in an overlay.                                              |
| Support/update backend  | Desktop support/update network paths were removed; diagnostics now export a local archive only. The old unmounted support panel, reset-state IPC, and reset support copy were removed. | Removed from OSS | Keep official support upload, update-check clients, and destructive support reset entrypoints out of OSS. |
| Local pairing/resources | Dashboard QR pairing, IPC local sidecar, received library and shared resources are local LAN features.                                                                                 | Keep baseline    | Do not remove; these are not manual mobile upload alternatives.                                           |

## Mobile JS Inventory

| Area                               | Evidence                                                                                                                                                              | Classification        | Next action                                                                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Guest LAN routing                  | `apps/mobile/src/navigation/RootNavigator.tsx:86` and `:102` route unauthenticated users into LAN sync.                                                               | Keep baseline         | Preserve fail-open guest local LAN behavior.                                                                                            |
| Auth state shell                   | Mobile auth store no longer exposes user/profile/subscription snapshots, token globals, or old token cleanup. It keeps only guest/dev-session route state.            | Removed from OSS      | Keep official profile bootstrap and token rotation out of OSS.                                                                          |
| Broad feature gate                 | `isFeatureAccessAllowed` was removed from `auth-store`; `SyncActivityScreen.tsx` no longer consumes auth state for local sync activity.                               | Removed from OSS      | Keep foreground LAN sync activity independent of account/subscription state.                                                            |
| API bearer auth                    | `apps/mobile/src/services/api.ts` was removed with the remaining support-upload client path.                                                                          | Removed from OSS      | Keep official account/support API callers absent from OSS.                                                                              |
| Local diagnostics export           | Mobile diagnostics now routes through `shareDiagnosticsArchive`, which asks the native engine for a local archive and opens the system share sheet.                   | Keep baseline         | Keep local export/share only; do not add official support upload APIs.                                                                  |
| Auth service bridge                | `apps/mobile/src/services/auth-service.ts` keeps only a clear callback for session-replaced API responses.                                                            | Keep baseline         | Keep as route-state cleanup only; do not add token rotation or official profile helpers.                                                |
| App config                         | `apps/mobile/src/services/app-config-service.ts` no longer calls paid native feature toggles.                                                                         | Keep fail-closed stub | Keep OSS no-op; official overlay must own positive native config.                                                                       |
| Native tunnel bridge               | `apps/mobile/src/services/SyncEngineModule.ts` no longer exports a tunnel credential bridge; native bridges were removed.                                             | Moved out of OSS      | Keep removed; official overlays must own any positive tunnel credential path.                                                           |
| Legacy account-owner compatibility | Removed from OSS mobile JS and native sync bridges.                                                                                                                   | Removed from OSS      | Official overlays must own any future account-owner mismatch repair path.                                                               |
| Local computer naming              | `LocalComputerGlobalScreen.tsx`, `LocalComputerScreen.tsx`, and `GlobalLocalComputer*` service helpers browse the paired desktop personal directory over LAN.         | Keep baseline         | Keep LAN browsing independent of account/tunnel state; only native wire-compatibility text may mention historical remote-access errors. |
| OSS locale namespace               | Mobile OSS information copy now uses the neutral `oss` i18n namespace and `oss.json` locale files.                                                                    | Removed from OSS      | Keep paid subscription locale namespaces out of the community runtime.                                                                  |
| Social login residue               | `AppleAuthModule` was removed; Google Sign-In dependency, plist, pods, lock entries and URL scheme were removed; visual-QA launch flags use `NativeAppRuntimeConfig`. | Removed from OSS      | Official overlays must own any future social-login native modules, dependencies, redirect schemes and account endpoints.                |

## Mobile Native Inventory

| Area                          | Evidence                                                                                                                                                                                                                   | Classification   | Next action                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| iOS foreground LAN            | `SyncEngineManager.swift:4047`, `:4332`, `:4411` gates on local sync state, binding, pairing token and photo permission.                                                                                                   | Keep baseline    | Preserve as guest/local sync path.                                                               |
| Android foreground LAN        | `NativeSyncEngineModule.kt` now runs foreground LAN rounds without Android notification or foreground-service permission gates.                                                                                            | Keep baseline    | Preserve foreground-only runtime checks; official overlays must own any background service path. |
| iOS silent audio              | The silent-audio service and bridge toggle were removed from OSS.                                                                                                                                                          | Moved out of OSS | Keep removed; positive capability belongs in official overlay.                                   |
| iOS background upload runtime | Background URLSession/BGTask registration, upload service code, HTTP reset state machine, UploadStore HTTP/background metadata, and the old background upload plan were removed; only short UIKit transition tasks remain. | Moved out of OSS | Keep OSS foreground-only; official overlays must own paid background upload runtime.             |
| Android background service    | Android foreground-service class, manifest service declaration and notification resources were removed.                                                                                                                    | Moved out of OSS | Keep removed; official overlays must own paid background continuation.                           |
| iOS P2P tunnel                | RN bridge credential entrypoints, former tunnel xcframework, old gomobile tunnel build script, `LocalTCPProxy`, tunnel route state/retry logic, and tunnel policy tests were removed.                                      | Moved out of OSS | Keep absent; iOS shared-files routing is LAN/WoL/direct-host only in OSS.                        |
| Android P2P tunnel            | RN bridge credential entrypoints, bundled MobileTunnel AAR/JAR, old gomobile tunnel build script, tunnel route state/retry logic, peer-proxy diagnostics, and tunnel policy tests were removed.                            | Moved out of OSS | Keep absent; Android shared-files routing is LAN/WoL/direct-host only in OSS.                    |
| Public wake                   | Public Wake-on-WAN target DTOs and policy helpers were removed from iOS and Android; same-LAN WoL target metadata remains.                                                                                                 | Moved out of OSS | Keep same-LAN WoL only; do not reintroduce public/router/account-backed wake in OSS.             |
| Manual file selection         | JS service exports, document-picker dependency, iOS bridge/service, Android bridge methods, and manual selection UI were removed.                                                                                          | Removed from OSS | Keep absent; OSS upload sets must only come from mobile scan pending queue.                      |

## Sidecar And Contracts Inventory

| Area                         | Evidence                                                                                                                                                                                                                               | Classification   | Next action                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Drive entitlement contract   | Drive entitlement/source resolver types were removed from `packages/contracts/src/types.ts`.                                                                                                                                           | Moved out of OSS | Keep paid-source and server entitlement metadata out of public OSS contracts.                                                       |
| Subscription DTOs            | Paywall subscription plan DTOs were removed from `packages/contracts/src/types.ts`.                                                                                                                                                    | Moved out of OSS | Keep removed from public contracts.                                                                                                 |
| Tunnel/signaling DTOs        | `SharedFilesRouteKind` is LAN-only and TURN/signaling registration DTOs were removed from contracts.                                                                                                                                   | Moved out of OSS | Keep only LAN route DTOs in OSS.                                                                                                    |
| Service endpoints            | `packages/contracts/src/service-endpoints.ts:1` exports only the public web URL and support email. Broad API, support API, update-check, and diagnostics-upload endpoint exports were removed from contracts and release/dev profiles. | Removed from OSS | Keep official account, entitlement, auth, tunnel, support upload, and update API constants out of public OSS contracts.             |
| TCP sync                     | `services/sidecar-go/internal/server/connection.go:214`, `handler_sync.go:21`, `handler_hello.go:360`.                                                                                                                                 | Keep baseline    | Preserve pairing/HMAC authenticated foreground LAN sync.                                                                            |
| Commercial HTTP endpoints    | `/account/context`, `/tunnel/credentials`, and `/wake/proxy` route registrations were removed.                                                                                                                                         | Moved out of OSS | Keep absent unless an external commercial distribution adds them.                                                                   |
| Reset-state support endpoint | `/settings/reset-state` and the desktop `sidecar.resetState` bridge were removed with the old support reset UI.                                                                                                                        | Removed from OSS | Keep destructive test/support reset entrypoints out of the community runtime.                                                       |
| Remote setting               | Sidecar settings DTO/update request no longer model `remoteAccessEnabled`.                                                                                                                                                             | Moved out of OSS | Keep absent; local LAN sharing is independent of account/tunnel state.                                                              |
| Tunnel health                | `/health` no longer reports a tunnel status object.                                                                                                                                                                                    | Moved out of OSS | Keep health local-only.                                                                                                             |
| Proxy wake                   | Account-backed proxy wake handler was removed from the OSS sidecar.                                                                                                                                                                    | Moved out of OSS | Keep absent; only same-LAN wake behavior can remain in OSS.                                                                         |
| Personal API                 | `handlers_personal.go:41`; test at `router_test.go:2673` says no account context required.                                                                                                                                             | Keep baseline    | Treat as local paired-device HMAC browsing, not official account remote access.                                                     |
| Mobile resources/presence    | `router.go:144`, `router.go:163`, `handlers_resources.go:1028`, `presence.go:44`.                                                                                                                                                      | Hardened         | Public/non-LAN HTTP access is rejected; mobile resource handlers also enforce local-network source before paired `clientId` checks. |
| Store schema                 | `001_initial.sql:1`, `005_desktop_local_management.sql:25`.                                                                                                                                                                            | Keep baseline    | No account/tunnel/entitlement persistence exists in sidecar store.                                                                  |

## Documentation And QA Drift

| Area                   | Evidence                                                                                                                                                             | Classification | Next action                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------- |
| Community build docs   | `docs/open-source/community-build.md:23` states commercial remote/tunnel/background native runtime is absent from community builds.                                  | Keep baseline  | Keep aligned as OSS removals continue.               |
| Beta matrix background | `docs/testing/beta-test-matrix.md` now treats OSS background as fail-closed and validates foreground pending-queue recovery instead of paid background continuation. | Keep baseline  | Keep aligned as native background removals continue. |
| Feature boundary       | `docs/commercial/feature-boundary.md:25` requires official capability and entitlement for paid features.                                                             | Keep baseline  | Use as the migration rule for follow-up tasks.       |

## Recommended Follow-up Order

1. Keep desktop and mobile diagnostics on local export/share/email only; do not
   reintroduce one-click upload to official support APIs in OSS.
2. Keep positive support IPC/preload tests focused on diagnostics export and
   retain negative coverage for removed upload/update IPC channels.
3. Remove dead support/settings renderer components that are no longer mounted
   by the OSS desktop UI.
