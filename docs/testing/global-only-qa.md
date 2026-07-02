# Lynavo Drive Global-only QA

本文补充 global-only OSS/commercial split 的专项 QA。基础 beta 回归仍以 `docs/testing/beta-test-matrix.md` 为主。

## Release Profile Smoke

CI / release gate 入口：

```bash
pnpm gate:release
```

该 gate 会依次执行：

1. `pnpm sync:versions:check`
2. `pnpm verify:oss-source-package`
3. `pnpm verify:oss-boundary`
4. `pnpm verify:legacy-names:strict`
5. `pnpm test:release`
6. `pnpm release --profile review --targets ios,android,mac,win,linux --dry-run`
7. `pnpm release --profile prod --targets ios,android,mac,win,linux --dry-run`

如果只验证 release profile dry-run，可单独执行：

```bash
pnpm release --profile review --targets ios,android,mac,win,linux --dry-run
pnpm release --profile prod --targets ios,android,mac,win,linux --dry-run
```

验收口径：

1. 只出现 `review` / `prod` release channel。
2. dry-run 输出只设置 `LYNAVO_RELEASE_CHANNEL`、中性的 `ELECTRON_BUILDER_CONFIG=electron-builder.yml` 和打包命令。
3. dry-run 输出不要求或展示 API base、support upload endpoint、update check endpoint 或历史 market。
4. `prod` 不复用 `review` channel。
5. GitHub Actions `OSS Release Gate` 只执行 `pnpm gate:release`，不执行
   native build、desktop package、TestFlight upload 或 Android Gradle package。

## Guest Local LAN

场景：

1. fresh install mobile。
2. 不登录账号，不购买订阅。
3. desktop 与 mobile 在同一 LAN。
4. mobile 发现 desktop 并完成配对。
5. 触发一轮真实素材同步。

预期：

1. 前景 LAN 同步可用。
2. 上传集合来自 pending queue。
3. 断线恢复走 `RESUME`。
4. 不清空 sync identity、pairing 或 pending queue。
5. 没有手动选档入口。

## No Manual-file-selection Replacement

检查所有上传入口：

1. 不允许用户手动勾选文件作为同步集合。
2. 不允许用手动上传按钮绕过自动扫描和 pending queue。
3. 不允许用户从 UI 删除、跳过或重排 pending queue item。

如果需要 debug 特定文件，应使用诊断或测试脚本，不作为产品路径暴露。

## Commercial Boundary Negative Check

这是商业能力负向边界检查，不是 OSS 正向功能验收。Community/OSS build 应覆盖官方 capability 缺失场景，并确认前景 LAN 同步不受影响。

预期：

1. 不请求或不使用官方 tunnel credentials。
2. background silent continuation 不启用。
3. community / OSS runtime 不展示官方 tunnel 激活入口。
4. 前景 LAN 同步仍可用。
5. 回到前景后继续 pending queue 补偿。

## 2026-07-02 OSS Beta Smoke Evidence

执行环境：本机 `/Volumes/workspace/work/sync-flow`，
`codex/lynavo-global-oss-commercial-plan`，2026-07-02 10:37 CST。

本轮只覆盖自动化和静态边界证据；真实 mDNS、PhotoKit / MediaStore
权限、真机 TCP 传输字节、断网重连和系统 share sheet 仍按
`docs/testing/beta-test-matrix.md` 走人工实机 smoke。

已通过的自动化证据：

1. Desktop OSS IPC / diagnostics / settings smoke:

   ```bash
   pnpm --filter @lynavo-drive/desktop exec vitest run \
     src/preload/__tests__/index.test.ts \
     src/main/__tests__/ipc-handlers.test.ts \
     src/main/__tests__/diagnostics.test.ts \
     src/renderer/features/settings/__tests__/SettingsPage.test.tsx \
     src/renderer/features/layout/__tests__/AppShell.test.tsx
   ```

   结果：5 files / 59 tests passed。覆盖 preload 无 auth/commercial
   bridge、diagnostics 本地导出、settings 不暴露 update check、support
   upload/update IPC 负向断言。

2. Sidecar `/personal/*` HMAC / local-network smoke:

   ```bash
   cd services/sidecar-go
   go test ./internal/api -run 'TestPersonal(PairedDeviceAccessUsesLocalHMACCredentials|AccessRejectsBearerTokenWithoutPairedDeviceCredentials|AccessAcceptsPairedDeviceHMACCredentials|AccessRejectsReplayedPairedDeviceHMACNonce|AccessRejectsBlockedPairedDeviceHMAC|AccessVerifiesHMACBeforeDeviceStatusDenials)|TestMobileResourcesRejectNonLocalNetwork|TestPresenceRejectsNonLocalNetwork|TestPersonalAccess'
   ```

   结果：passed。覆盖 paired-device HMAC access、bearer-only rejection、nonce
   replay / blocked device rejection、non-LAN mobile resource / presence
   rejection。

3. Sidecar sync / resume smoke:

   ```bash
   cd services/sidecar-go
   go test ./internal/server -run '^(TestFullPairingAndFileTransfer|TestResumeAfterDisconnect|TestCompletedSessionStaysCompletedAfterDisconnect|TestPauseTransferWhenDiskFallsBelowThresholdMidFile|TestNewFileWriterSeeksToResumeOffset)$' -count=1
   ```

   结果：passed。覆盖 `HELLO -> PAIR_REQ -> SYNC_BEGIN -> FILE_* ->
SYNC_END`、disconnect resume、completed session stability、mid-file pause。

4. Sidecar progress persistence smoke:

   ```bash
   cd services/sidecar-go
   go test ./internal/store -run '^(TestUpdateUploadProgress|TestInterruptActiveSession_MarksActiveSessionAndKeepsProgress)$' -count=1
   ```

   结果：passed。覆盖 upload progress update 和 active session
   interruption keeps progress。

5. Sidecar Bonjour local LAN metadata smoke:

   ```bash
   cd services/sidecar-go
   go test ./cmd/lynavo-drive-sidecar -run '^TestBonjourShareMetadataAdvertisesLocalLANShare$' -count=1
   ```

   结果：passed。覆盖 advertised share metadata stays local-LAN。

6. Mobile TypeScript:

   ```bash
   pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
   ```

   结果：passed。覆盖 mobile TS surface compiles after OSS cleanup。

7. Mobile guest LAN / pending queue / diagnostics smoke:

   ```bash
   pnpm --filter @lynavo-drive/mobile exec jest --silent --runTestsByPath \
     src/navigation/__tests__/RootNavigator.local-mode.test.tsx \
     src/navigation/__tests__/RootNavigator.fail-open.test.tsx \
     src/stores/__tests__/auth-store-local-mode.test.tsx \
     src/screens/__tests__/DeviceDiscoveryScreen.pairingOptions.test.tsx \
     src/screens/__tests__/DeviceDiscoveryScreen.switchMode.test.tsx \
     src/screens/__tests__/deviceDiscoveryManualPairing.test.ts \
     src/screens/__tests__/AutoUploadSettingsGlobalScreen.test.tsx \
     src/services/__tests__/SyncEngineModule.bridgeWrappers.test.ts \
     src/services/__tests__/SyncEngineModule.autoUploadSession.test.ts \
     src/services/__tests__/SyncEngineModule.background-service.test.ts \
     src/screens/__tests__/SyncActivityGlobalScreen.test.tsx \
     src/utils/__tests__/syncActivityTransferState.test.ts \
     src/utils/__tests__/shareDiagnosticsArchive.test.ts \
     src/screens/__tests__/HelpGlobalScreen.test.tsx \
     src/screens/__tests__/SettingsGlobalScreen.test.tsx \
     src/config/__tests__/app-config.test.ts \
     src/services/__tests__/auth-service.review-server.test.ts
   ```

   结果：17 suites / 127 tests passed。覆盖 guest route fail-open、manual
   pairing UI/service、pending queue upload session wrappers、background
   commercial bridge absence、local diagnostics share、review-server URL cleanup。

8. OSS boundary scanner:

   ```bash
   pnpm verify:oss-boundary
   ```

   结果：passed，0 unallowlisted hits。覆盖
   commercial/account/support/update/tunnel/auth boundary stays allowlisted only。

9. Android SyncEngine bridge parity:

   ```bash
   pnpm verify:android-syncengine-bridge
   ```

   结果：passed。覆盖 JS/native Android SyncEngine bridge declarations stay in
   parity。

10. Removed support/update/reset runtime scan:

    ```bash
    rg -n "resetState|reset-state|settings/reset-state|support:reset-state|support:upload-diagnostics|support:check-for-updates|checkForUpdates|uploadDiagnostics" apps packages services scripts -S
    ```

    结果：runtime hits: 0；只剩 desktop IPC negative assertions。覆盖无
    support upload、update check 或 destructive reset-state runtime
    entrypoint。

Observed command-selection issues:

1. An initial mobile Jest run referenced two stale paths and failed with
   `ENOENT`; the corrected path set above passed.
2. A follow-up mobile Jest run briefly used
   `src/services/__tests__/deviceDiscoveryManualPairing.test.ts`; that file
   lives under `src/screens/__tests__`. The corrected command above passed.

Remaining manual smoke required before beta sign-off:

1. Real iOS and Android devices discover desktop over LAN mDNS, pair, and upload
   a real media batch.
2. Real device transfer interruption resumes without resetting pending queue or
   sync identity.
3. Local diagnostics export opens the platform share sheet / mail path without
   support upload network calls.
4. Desktop installer smoke on the target OS set confirms sidecar ports, Bonjour
   / local discovery, and received library behavior.

## Deferred Migration Checks

本轮不要求迁移这些名称或路径，但 QA 记录里要明确它们是兼容项：

1. package scope。
2. mDNS service type。
3. sidecar health service name。
4. data-dir / keychain / shared-preference legacy paths。
5. iOS / Android native package identifiers。
