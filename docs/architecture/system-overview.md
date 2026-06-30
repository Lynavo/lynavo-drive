# Vivi Drop 系统概覽

本文件用於幫助新同事快速理解目前系統邊界、職責分工和主鏈路。不作為產品規格文件；行為以目前程式碼和 `@lynavo-drive/contracts` 為準。

## 1. 目標

Vivi Drop 目前的目標非常聚焦：

1. mobile 端自動或半自動綁定一台 desktop
2. 在區域網內把相簿素材無感增量同步到 desktop
3. 在中斷、重連、背景、鎖定螢幕等場景下盡可能自動恢復
4. 在 desktop 端提供佇列、歷史、儲存、診斷和發佈驗證能力

目前範圍明確限制為：

- 支援 `iOS / Android -> Desktop` 同步鏈路
- 僅支援區域網傳輸
- 不支援使用者在 UI 手動挑選、刪除、跳過或重排佇列
- 同一台手機同一時間只傳 1 個檔案

## 2. 執行時組件

### 2.1 Electron Desktop

職責：

1. 提供桌面 UI 和設定頁
2. 拉起、監控和打包 sidecar
3. 透過 preload bridge 暴露 IPC API 給 renderer
4. 匯總 diagnostics、匯出桌面診斷包

限制：

- renderer 不直接存取 sidecar、檔案系統或 SQLite
- 所有存取都經由 main / preload 轉發

關鍵目錄：

- `apps/desktop/src/main`
- `apps/desktop/src/preload`
- `apps/desktop/src/renderer`

### 2.2 Go Sidecar

職責：

1. 提供 TCP 檔案接收協定服務
2. 提供 HTTP API、WebSocket、共享偵測和 dashboard 聚合
3. 管理落盤目錄、續傳 `.part` 檔案、SQLite 持久化
4. 廣播 Bonjour/mDNS，供 mobile 發現

關鍵連接埠：

- TCP/LMUP：`39393`
- HTTP API：`39394`

關鍵目錄：

- `services/sidecar-go/internal/server`
- `services/sidecar-go/internal/api`
- `services/sidecar-go/internal/store`
- `services/sidecar-go/internal/mdns`

### 2.3 React Native Mobile UI

職責：

1. 展示發現頁、同步狀態、歷史、設定
2. 透過原生 bridge 呼叫對應平台能力
3. 透過原生 bridge 呼叫 iOS / Android 對應的 `SyncEngine` 能力
4. 只承載 UI，不直接負責真實傳輸

關鍵目錄：

- `apps/mobile/src/screens`
- `apps/mobile/src/navigation`
- `apps/mobile/specs`

### 2.4 Mobile 原生 SyncEngine

職責：

1. 發現 desktop、維護綁定狀態、心跳和短探活
2. 掃描相簿、匯出素材、維護本地上傳佇列
3. 建立 TCP 協定會話並執行檔案傳輸、續傳、重連
4. 對 RN 發出 binding、queue、sync state 和 diagnostics 事件

關鍵目錄：

- `apps/mobile/ios/SyncEngine`
- `apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/sync`

## 3. 關鍵資料流

## 3.1 發現

1. sidecar 透過 Bonjour 廣播 `_syncflow._tcp`
2. macOS / Windows 優先使用原生 `dns-sd` 廣播；Windows 缺失 Bonjour 時會回退到 zeroconf 相容廣播
3. iOS 使用 `Network.framework` 瀏覽區域網服務；Android 使用 `NsdManager` 瀏覽 `_syncflow._tcp`，並在未發現設備時回退到手動輸入 IP
4. 目前實作優先使用 sidecar 廣播的 IPv4 資訊，避免 `fe80::` 連結本地 IPv6 誤判
5. 發現列表展示的是「可探活、可連接」的設備，而不是單純有廣播的設備

## 3.2 配對

1. desktop 生成連接碼並展示在設定頁
2. mobile 輸入連接碼，向 sidecar 發起 `PAIR_REQ`
3. sidecar 儲存 `paired_devices`
4. mobile 將 `pairingToken` 和 `clientId` 儲存在本地（Keychain + SQLite）

設備身份約束：

- desktop 端識別同一台手機依賴 `clientId`
- 不是依賴設備名、IP 或目錄名

## 3.3 上傳

標準鏈路：

1. mobile 從平台相簿媒體庫掃描素材並寫入本地上傳佇列
2. 主上傳輪次從本地 pending 佇列建構真實上傳集合
3. `SyncEngine` 建立 TCP 會話並發 `HELLO_REQ / AUTH_REQ / SYNC_BEGIN_REQ`
4. sidecar 逐檔案處理 `FILE_INIT_REQ / FILE_DATA / FILE_END_REQ`
5. sidecar 落盤並在 `FILE_END_RES` 中返回最終結果與 `ledgerDate`
6. mobile 更新本地歷史與佇列狀態
7. desktop 透過 sidecar HTTP / WebSocket 讀取聚合結果

關鍵約束：

- 上傳集合必須來自本地 pending 佇列，而不只是「本輪新掃描出來的素材」
- 否則會出現「佇列很多，但 `queueCount=1` 或 `0`」的狀態機問題

## 3.4 續傳與重連

1. 傳輸中斷時，app 會進入短重連和 backoff
2. sidecar 透過 `uploads.committed_bytes` + `.part` 檔案支援斷點續傳
3. 成功恢復後，下一輪 `FILE_INIT_REQ` 會走 `RESUME`
4. 對使用者來說，短時自動恢復應該理解為「正在重連」，不是最終失敗

## 3.5 歷史與統計

目前已經統一到「以 sidecar/desktop 完成日為準」：

1. sidecar 在檔案完成時寫 `uploads.completed_at`
2. sidecar 在 `device_daily_stats` 中按 desktop 本地日做分桶
3. mobile 在 `FILE_END_RES` 中優先使用 sidecar 回傳的 `ledgerDate`
4. desktop detail/history 也以 sidecar 資料為准

## 4. Source of Truth

目前開發與排障按以下優先級判斷：

1. 目前已提交程式碼
2. `@lynavo-drive/contracts`
3. `docs/testing/beta-test-matrix.md`

不應再依賴已刪除的歷史 spec 檔案。

## 5. 目前專案結構

```text
apps/desktop      Electron 桌面端
apps/mobile       React Native iOS/Android + 平台原生 SyncEngine
packages/contracts 共享 DTO、常量、連接埠、事件名
packages/design-tokens 共享設計 token
services/sidecar-go Go sidecar
scripts/ios       真機上傳回歸指令碼
scripts/release   beta tag 等發佈指令碼
```

## 6. 接手建議

新同事按這個順序進入最省時間：

1. 先讀本檔案
2. 再讀 `docs/architecture/sync-state-machine.md`
3. 再讀 `docs/architecture/data-model.md`
4. 遇到具體問題時查 `docs/operations/troubleshooting.md`
5. 發佈時按 `docs/release/release-playbook.md`
