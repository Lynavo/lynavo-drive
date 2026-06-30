# Lynavo Drive

移动端（iOS / Android）→ Desktop（macOS / Windows / Linux）局域网素材无感增量同步工具，面向全球用户和短视频团队。当前开源基线是 Lynavo Drive global-only，不再维护 CN / Global 双市场发行路径。

## 当前状态

- 桌面端、Go sidecar、移动端和 iOS / Android 原生同步能力都已落地
- iOS 与 Android 移动端都属于当前支持范围
- 当前工作重点是 beta 收口、异常恢复、后台上传、远程能力边界和发布验证
- 仓库中目前没有单独维护的产品 spec 文件；开发基线以当前代码、`@lynavo-drive/contracts` 和测试矩阵为准
- guest/local 用户可使用前景 LAN 自动同步；后台持续和远程访问属于官方商业能力，缺少有效 entitlement 时必须 fail closed

## 前置依赖

- **macOS 或 Windows**（桌面端当前支持 macOS / Windows；iOS 构建仍需 macOS + Xcode）
- **Node.js** >= 22.11.0
- **pnpm** >= 10
- **Go** >= 1.25.6（sidecar 开发和测试）
- **Xcode + CocoaPods**（iOS 构建和真機偵錯，僅 macOS）
- **Android Studio + Android SDK / NDK**（Android 构建和调试）

## 快速開始

```bash
# 1. 安裝依賴
pnpm install

# 2. 建置共享包
pnpm --filter @lynavo-drive/contracts build
pnpm --filter @lynavo-drive/design-tokens build

# 3. 啟動 Desktop 開發模式
pnpm dev:desktop
```

Electron 窗口會自動打開；桌面端會負責拉起 sidecar。

## 常用命令

```bash
# Desktop
pnpm dev:desktop
pnpm build:desktop
pnpm package:desktop:signed   # macOS signed DMG
pnpm package:desktop:win      # Windows NSIS + zip（預設 desktop Windows 包，不帶 release profile）

# Mobile
pnpm dev:mobile
pnpm build:mobile
pnpm dev:mobile:android
pnpm build:mobile:android

# Sidecar
pnpm dev:sidecar
pnpm build:sidecar
pnpm test:sidecar

# 全倉驗證
pnpm build
pnpm test
pnpm typecheck
pnpm format:check
pnpm check
```

## 發佈與 Review 打包

正式發佈、Review 包、TestFlight 上傳、Android APK/AAB、Desktop DMG / EXE / DEB 都應先選 release profile，避免手動拼接 API base URL：

```bash
# 檢查 review 後端、base URL 與會執行的命令
pnpm release --profile review --targets win --dry-run

# 打 review Windows EXE / zip
pnpm release --profile review --targets win

# 打 prod Windows EXE / zip
pnpm release --profile prod --targets win

# 打完整 Review / Prod 版本（iOS TestFlight + Android + Desktop）
pnpm release --profile review --targets ios,android,mac,win,linux
pnpm release --profile prod --targets ios,android,mac,win,linux
```

`package:desktop:*` 類腳本只做本地封裝或單平台驗證；正式 / Review 發佈都應走 `release` 指令，讓 profile 統一注入 `LYNAVO_RELEASE_CHANNEL` 與 Lynavo API base URL。`review` 必須指向 review API，`prod` 不得使用 review API。

## Open Source / Commercial Boundary

- Community/OSS build 是 global-only：不提供 CN 市場分支、CN 專屬支付、CN 專屬 release profile 或雙市場回歸矩陣。
- guest local LAN mode 必須可用：未登入或無訂閱時，使用者仍可在前景發現 desktop、配對、掃描 pending queue 並自動 LAN 上傳。
- 不提供手動選檔替代路徑：佇列仍由 mobile 本地掃描和 pending queue 驅動，UI 不允許手動勾選檔案來繞過自動增量同步。
- foreground LAN fail-open：只要本地權限、配對和 LAN 可達，前景同步不因登入、訂閱或官方商業模組缺失而被阻斷。
- remote/background fail-closed：遠端訪問、tunnel credentials、背景靜默續傳等能力必須同時具備官方 capability 和有效 entitlement；缺失、過期或無法確認時保持關閉。
- package scope、mDNS service、舊 data-dir、native package/bundle rename 是後續遷移邊界，本輪文檔不要求執行 rename 或資料遷移。

## 專案結構

```text
lynavo-drive/
├── apps/
│   ├── desktop/              # Electron 桌面應用
│   │   └── src/
│   │       ├── main/         # 主進程（窗口、IPC、sidecar 生命周期）
│   │       ├── preload/      # 預先加載橋接
│   │       └── renderer/     # React 18 UI
│   └── mobile/               # React Native iOS/Android 應用 + 平台原生同步能力
│       ├── ios/              # Xcode 工程、Swift 原生模組
│       ├── android/          # Android 工程、Kotlin bridge、原生同步能力
│       ├── src/              # RN 頁面和 hooks
│       └── __tests__/        # RN 測試
├── packages/
│   ├── contracts/            # 共享 DTO / 常量 / 事件 / 錯誤碼
│   └── design-tokens/        # 共享設計 token
├── services/
│   └── sidecar-go/           # Go sidecar（TCP/HTTP/SQLite/mDNS）
├── docs/
│   ├── architecture/         # 架構、狀態機、數據模型
│   ├── operations/           # 排障、診斷、環境、sidecar 運行手冊
│   ├── open-source/          # Community/OSS build 規則
│   ├── commercial/           # 官方商業能力邊界
│   ├── product/              # 產品約束與非目標
│   ├── release/              # TestFlight / 簽名 / 發版手冊
│   └── testing/              # 測試矩陣和 beta 驗證說明
└── tmp/
    └── ui-demo/              # 視覺參考，僅供比對，不直接複用程式碼
```

## 技術棧

| 層             | 技術                                                       |
| -------------- | ---------------------------------------------------------- |
| Monorepo       | pnpm 10 + turborepo 2.8                                    |
| Desktop        | Electron 41 + electron-vite 5 + electron-builder 26        |
| Desktop UI     | React 18.3 + zustand 5 + Tailwind CSS v4                   |
| Mobile         | React Native 0.84.1 + React 19（iOS / Android）            |
| iOS Native     | Swift `SyncEngine` + BGTask + PhotoKit + Network.framework |
| Android Native | Kotlin bridge + NativeSyncEngine / MediaStore / NsdManager |
| Sidecar        | Go 1.25.6 + SQLite + WebSocket                             |
| Shared         | `@lynavo-drive/contracts` + `@lynavo-drive/design-tokens`          |
| Test           | vitest 4.1 + jest + `go test`                              |

## 架構概覽

```text
Mobile (RN UI on iOS / Android)
  ├── iOS: Swift SyncEngine
  └── Android: Kotlin NativeSyncEngine
  ├── Bonjour/mDNS discover
  ├── LMUP/TCP :39393
  └── Presence/HTTP :39394
                │
                ▼
Desktop (Electron + Go sidecar, macOS / Windows)
  ├── Electron: UI 殼、窗口、橋接、sidecar 生命周期管理
  ├── Sidecar HTTP API / WebSocket
  ├── LMUP 檔案接收
  ├── SQLite
  └── 檔案系統 / 共享目錄偵測
```

## 開發基線

- 共享型別、常量、事件名、連接埠定義統一來自 `@lynavo-drive/contracts`
- renderer 不直接存取 sidecar、檔案系統、SQLite；全部透過 preload bridge / main 進程轉發
- 佇列保持唯讀，不允許在 UI 裡刪除、重排或跳過
- 同一台手機同一時間只允許序列上傳一個檔案
- `tmp/ui-demo/` 只做視覺參考，不作為實作來源
- guest/local 前景 LAN 同步 fail-open；遠端訪問和背景續傳 fail-closed

## 檔案

- 開發約束與執行準則：[`AGENTS.md`](./AGENTS.md)
- 系統概覽：[`docs/architecture/system-overview.md`](./docs/architecture/system-overview.md)
- 同步狀態機：[`docs/architecture/sync-state-machine.md`](./docs/architecture/sync-state-machine.md)
- 資料模型與統計口徑：[`docs/architecture/data-model.md`](./docs/architecture/data-model.md)
- 排障手冊：[`docs/operations/troubleshooting.md`](./docs/operations/troubleshooting.md)
- Mobile 診斷包說明：[`docs/operations/mobile-diagnostics.md`](./docs/operations/mobile-diagnostics.md)
- Sidecar 運作手冊：[`docs/operations/sidecar-runbook.md`](./docs/operations/sidecar-runbook.md)
- 環境與秘密金鑰說明：[`docs/operations/environment-and-secrets.md`](./docs/operations/environment-and-secrets.md)
- 產品約束與非目標：[`docs/product/constraints.md`](./docs/product/constraints.md)
- Beta 發佈手冊：[`docs/release/release-playbook.md`](./docs/release/release-playbook.md)
- beta 測試矩陣：[`docs/testing/beta-test-matrix.md`](./docs/testing/beta-test-matrix.md)
- Community build：[`docs/open-source/community-build.md`](./docs/open-source/community-build.md)
- Commercial feature boundary：[`docs/commercial/feature-boundary.md`](./docs/commercial/feature-boundary.md)

## License

Private — 內部使用
