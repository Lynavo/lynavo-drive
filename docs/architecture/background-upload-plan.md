# Plan: URLSession 背景上傳 + 移除靜音音訊

## Context

Apple 以 Guideline 2.5.4 拒絕了 SyncFlow (Vivi Drop) iOS app：app 宣告了 `UIBackgroundModes: audio` 但沒有提供可聽內容。目前使用 `SilentAudioService` 播放靜音音訊保持 app 在背景存活，這違反 Apple 政策。

**解決方案**：改用 `URLSession` 背景傳輸。前景繼續使用 LMUP/2 TCP（高效能），背景自動切換為 HTTP 上傳（系統層級管理，app 被殺也能繼續傳）。需要在 Go sidecar 新增 HTTP 上傳端點，iOS 端新增 `BackgroundUploadService`。

## 設計原則

這個方案在實作時必須同時滿足下面幾條，不可只解決審核問題：

1. **不降低既有配對安全性**：背景 HTTP 上傳仍必須驗證 `pairingToken`，不能只靠 `clientId`
2. **維持單檔串行**：同一台手機任一時間仍只能有 1 個活躍上傳；背景模式也不能一次排整批
3. **維持 queue head 語意**：每完成 1 個檔案，都必須重新從 `UploadStore.getPendingUploadItemsSorted(limit: 1)` 取下一個，讓 manual 項目仍可插隊 auto 項目
4. **不破壞 desktop 狀態語意**：背景 HTTP 上傳中，desktop 仍要看到 `transferring`，`/transfer/active` 也要反映真實狀態
5. **不做跨協定半檔切換**：TCP -> 背景 HTTP 的切換只允許發生在「檔案與檔案之間」，不中途接手半個檔案

---

## Phase 1: Go Sidecar — HTTP 上傳端點

### 1.1 匯出 `hashFile` 函數

**檔案**: `services/sidecar-go/internal/server/handler_file.go`

在現有的 `hashFile`（line 477）旁新增匯出版本：

```go
func HashFile(path string) (string, error) {
    return hashFile(path)
}
```

### 1.2 新增 `handlers_upload.go`

**新檔案**: `services/sidecar-go/internal/api/handlers_upload.go`（約 150 行）

**路由**: `POST /upload/{clientId}`（不加 `withJSON` wrapper，body 是二進位）

**HTTP 請求規格**：
- Body: raw `application/octet-stream`（檔案內容）
- 元資料透過 custom headers 傳遞：

| Header | 必填 | 說明 |
|--------|------|------|
| `X-SyncFlow-File-Key` | 是 | 唯一檔案 ID |
| `X-SyncFlow-Filename` | 是 | 原始檔名 |
| `X-SyncFlow-Media-Type` | 是 | `image` / `video` |
| `X-SyncFlow-File-Size` | 是 | 位元組數（decimal string） |
| `X-SyncFlow-Pairing-Token` | 是 | 配對完成後儲存在 iOS Keychain 的 token |
| `X-SyncFlow-SHA256` | 否 | hex-encoded hash |
| `X-SyncFlow-Created-At` | 否 | RFC3339 |
| `X-SyncFlow-Modified-At` | 否 | RFC3339 |
| `X-SyncFlow-Upload-Mode` | 否 | 固定 `"background_http"`，僅供 diagnostics/log 使用，不寫入 sidecar schema |

**Handler 流程**（複用 TCP 路徑的核心邏輯）：
1. 驗證 `clientId` 是已配對裝置 → `store.GetPairedDevice(clientId)`，否則 404
2. 解析並驗證必要 headers → 缺少則 400
3. 驗證 `X-SyncFlow-Pairing-Token`：將 header token hash 後與 `paired_devices.pairing_token_hash` 比對；不符回 401
4. 查詢已有上傳記錄 → 已 `completed` 則回 `409 {"status":"already_completed","fileKey":"...","ledgerDate":"YYYY-MM-DD","activeTransmissionMs":1234}`
5. 檢查磁碟空間 → `disk.IsLow()` → 507
6. 將此 `clientId/fileKey` 標記為 **background transfer active**，供 dashboard/transfer API 查詢
7. 寫入 upload 記錄 → `store.UpsertUpload({status:"receiving"})`
8. 建立 `FileWriter` → `server.NewFileWriter(config.StagingDir(), clientID, fileKey, fileSize)`
9. 串流 `r.Body` → 256KB buffer 讀取循環 → `fw.WriteAt(buf, offset)` + `fw.MaybeSync()`；同時更新 background transfer tracker 的 `committedBytes`
10. `fw.ForceSync()` + `fw.Close()`
11. **硬性驗證實收 byte 數**：`receivedBytes` / `fw.CommittedOffset()` 必須等於 `fileSize`；不符則 `fw.Cleanup()` + `422 {"status":"file_size_mismatch"}`，不得進入 finalize
12. 可選 SHA256 驗證 → `server.HashFile(fw.PartPath())`，不符則 `fw.Cleanup()` + 422
13. 解析 deviceAlias → `store.GetPairedDevice()`
14. 處理目錄遷移 → `MigrateDeviceDir()` + `store.UpdateReceiveDirName()`（與 TCP 一致）
15. `fw.Finalize(config.ReceiveDir, deviceAlias, date, filename, fileKey)` → `relativePath`
16. `store.CompleteUpload(fileKey, relativePath, sha256, transmissionMs)`
17. `store.UpsertDailyStats(...)`
18. 清除 background transfer active 狀態，並依統一狀態推導器重新計算後廣播 `device.state.changed`
19. 廣播事件 → `upload.completed` + `dashboard.updated` + `history.updated`
20. 回傳 JSON：`200 {"status":"completed","fileKey":"...","relativePath":"...","storedBytes":N,"ledgerDate":"YYYY-MM-DD","activeTransmissionMs":1234}`

**補充要求**：

- `200 completed` 與 `409 already_completed` 都應盡量回傳 `ledgerDate` 與 `activeTransmissionMs`
- `ledgerDate` 必須沿用 sidecar / desktop 完成日口徑，不能由 iOS 本地重新分桶
- `activeTransmissionMs` 必須沿用 sidecar 完成時計算值，讓背景 HTTP 與前景 TCP 的 history 統計口徑一致
- `409 already_completed` 的 `ledgerDate` 來源也必須唯一化：優先使用該 upload 已持久化的完成日（例如由 `uploads.completed_at` 依 sidecar 本地時區推導），不得在不同 handler / client 各自重算
- 若 sidecar 需 fallback 查詢 daily stats 才能補齊 `ledgerDate` / `activeTransmissionMs`，也必須在單一路徑內完成，避免同一檔案在不同 API 得到不同日期

**錯誤碼**：400（headers 缺失）、401（pairing token 無效）、404（未知裝置）、409（已完成）、422（SHA256 不符 / file size 不符）、500（內部錯誤）、507（磁碟滿）

### 1.3 新增背景傳輸狀態追蹤

**檔案**: `services/sidecar-go/internal/api/background_transfer_tracker.go`（新檔案）

新增 `BackgroundTransferTracker`，最少追蹤：

- `clientId`
- `fileKey`
- `filename`
- `fileSize`
- `committedBytes`
- `startedAt`
- `lastProgressAt`

清理策略：

1. 採用 **inactivity timeout**，不是固定生命週期 timeout
2. 預設：
   - `staleAfter = 10m`
   - `sweepInterval = 1m`
3. `Start(...)` 與每次 `UpdateProgress(...)` 都更新 `lastProgressAt`
4. `PruneExpired(now)` 只清除「超過 `staleAfter` 沒有新 byte」的項目
5. 若 `committedBytes` 仍在前進，即使單檔很大、耗時很久，也不能清除
6. 清除 stale 項目時要寫 diagnostics log，標記為 `background_transfer_stale_pruned`

整合點：

1. `Server` 結構新增 `backgroundTransfers *BackgroundTransferTracker`
2. `handleUpload` 在開始接收時 `Start(...)`，接收中 `UpdateProgress(...)`，完成/失敗/中斷時 `Finish(...)`
3. `handleUpload` 的開始/結束路徑都順手呼叫 `PruneExpired(...)`；此外可選擇啟動一個 goroutine 每 1 分鐘 sweep 一次
4. `handleDashboardDevices`：狀態推導改成 **live TCP syncing > background HTTP transfer > HTTP presence > offline**
5. `handleTransferActive`：只要 TCP syncing 或 background HTTP transfer 任一存在，就回 `active=true`
6. 若背景 HTTP 上傳正在進行，dashboard 的 `currentFile` 應取自 background transfer tracker，而不是只依賴 TCP session
7. `PruneExpired(...)` 清掉 stale 項目後，需重新廣播 `device.state.changed`
   - 若該 client 仍有 live TCP syncing，維持 `transferring`
   - 否則若 presence 仍存活，退回 `connected_idle`
   - 否則退回 `offline`

### 1.4 註冊路由

**檔案**: `services/sidecar-go/internal/api/router.go`

在 Transfer state 區塊之前加一行：

```go
// Background upload (iOS URLSession)
mux.HandleFunc("POST /upload/{clientId}", srv.handleUpload)
```

### 1.5 驗證

- `go build ./...` 編譯通過
- `go test ./internal/api/...` 測試通過
- 用 `curl` 手動測試：`curl -X POST http://localhost:39394/upload/test-client -H "X-SyncFlow-File-Key: test-key" -H "X-SyncFlow-Filename: test.jpg" -H "X-SyncFlow-Media-Type: image" -H "X-SyncFlow-File-Size: 1024" -H "X-SyncFlow-Pairing-Token: <token>" --data-binary @test-file.jpg`

---

## Phase 2: iOS — BackgroundUploadService

### 2.1 新增 `BackgroundUploadService.swift`

**新檔案**: `apps/mobile/ios/SyncEngine/BackgroundUploadService.swift`（約 300-350 行）

```swift
class BackgroundUploadService: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
    static let shared = BackgroundUploadService()
    static let sessionIdentifier = "com.syncflow.background-upload"

    private var backgroundSession: URLSession!
    private var pendingCompletionHandler: (() -> Void)?
    private var responseDataByTaskId: [Int: Data] = [:]
    private let lock = NSLock()

    weak var uploadStore: UploadStore?
    var sidecarHost: String?
    var clientId: String?
}
```

**核心方法**：

1. **`reconnectBackgroundSession()`** — 建立 `URLSessionConfiguration.background(withIdentifier:)`，設定 `isDiscretionary = false`、`sessionSendsLaunchEvents = true`，delegate 指向 `self`

2. **`enqueueNextPendingFileIfIdle(exportService:sidecarHost:clientId:pairingToken:) async -> Bool`** — 背景轉換核心：
   - 先呼叫 `backgroundSession.getAllTasks()`；只要已有未完成 task，直接返回 `false`
   - 從 `uploadStore.getPendingUploadItemsSorted(limit: 1)` 重新取 queue head，永遠只看當前隊首
   - 若 queue head 是 `cloud_downloading`，不在背景中主動觸發 iCloud 匯出；返回 `false`，交由下次 foreground / BG task 再處理
   - 已有 `temp_file_path` 且檔案存在 → 直接用；否則呼叫 `exportService.exportAsset()` 匯出單一檔案
   - 將 `temp_file_path` 寫入 UploadStore
   - 建立 `URLRequest` → `POST http://<host>:39394/upload/<clientId>`，metadata 放 headers，並附上 `X-SyncFlow-Pairing-Token`
   - 呼叫 `backgroundSession.uploadTask(with:request, fromFile:tempURL)`
   - 設定 `task.taskDescription = fileKey`
   - `task.resume()`
   - 回傳 `true`

3. **`hasActiveTask() async -> Bool`** — 供 foreground / BG task 判斷目前是否已有背景 HTTP 上傳在跑

4. **`handleEventsForBackgroundURLSession(identifier:completionHandler:)`** — 儲存 completionHandler，重連 session

5. **`cleanupTempFile(fileKey:)`** — 讀取 UploadStore 的 `temp_file_path`，刪檔，清欄位

6. **`requestForegroundResumeAfterBackgroundTask()`** — 記錄「回到前景後應恢復 TCP pipeline」，但不主動取消正在跑的背景上傳

**URLSession delegate 方法**：

- `urlSession(_:task:didSendBodyData:totalBytesSent:totalBytesExpectedToSend:)` — 更新 `uploadStore.updateUploadOffset(fileKey:offset:)` 進度
- `urlSession(_:dataTask:didReceive:)` — 累積回應 body（用於解析 JSON）
- `urlSession(_:task:didCompleteWithError:)` — 核心完成回調：
  - 成功：解析 JSON → `updateUploadStatus(fileKey, "completed")` → `cleanupTempFile` → 用 sidecar 回傳的 `ledgerDate` / `activeTransmissionMs` 更新 `HistoryLedgerStore` / `daily_ledgers` → emit events
  - 若 HTTP 回應為 `409` 且 body `status == "already_completed"`：視同成功去重，將本地項目標記為 `completed`，清理 `temp_file_path`，**不得**回 `queued`
  - 若 HTTP 回應為 `409` 且 body 同時帶有 `ledgerDate` / `activeTransmissionMs`，仍要補寫本地 `HistoryLedgerStore` / `daily_ledgers`
  - 失敗：重設為 `queued`（讓 foreground TCP 或下一次 BG task 重試）
  - 若 app 已在 foreground 且 `requestForegroundResumeAfterBackgroundTask()` 已設置：當前背景檔案完成後**不要再排下一個 background task**，改為恢復 foreground TCP pipeline
  - 只有在 app 仍處於背景、且未要求 foreground resume 時，才再次呼叫 `enqueueNextPendingFileIfIdle(...)`，讓背景模式保持**單檔串行但可接續下一檔**
- `urlSessionDidFinishEvents(forBackgroundURLSession:)` — 呼叫已儲存的 `completionHandler()`

### 2.2 加入 Xcode 專案

**檔案**: `apps/mobile/ios/SyncFlowMobile.xcodeproj/project.pbxproj`

新增 `BackgroundUploadService.swift` 的 PBXBuildFile、PBXFileReference、Sources build phase 引用。

---

## Phase 3: iOS — 修改 SyncEngineManager

### 3.1 新增屬性

**檔案**: `apps/mobile/ios/SyncEngine/SyncEngineManager.swift`

```swift
let backgroundUploadService = BackgroundUploadService.shared
var isTransitioningToBackground = false
```

### 3.2 修改 `appDidEnterBackground()`（line 900）

```swift
@objc private func appDidEnterBackground() {
    NSLog("[SyncEngine] app entered background, isSyncing=\(isSyncing)")
    guard isSyncing else { return }
    beginBackgroundTransitionIfNeeded(reason: "didEnterBackground")
    isTransitioningToBackground = true  // 新增：通知 TCP 迴圈停下
    if sessionService.state == .syncingForeground {
        sessionService.transitionTo(.syncingBackground)
    }
    // 新增：啟動背景上傳排隊
    Task { [weak self] in
        await self?.transitionToBackgroundUpload()
    }
}
```

新增方法 `transitionToBackgroundUpload()`：
- 等待 TCP 迴圈在**當前檔案完成**後中斷（透過 `isTransitioningToBackground` flag）
- 不嘗試中途接手半個 TCP 檔案；若目前檔案在背景轉場視窗內來不及完成，就保留現有 TCP resume 語意，等下次 foreground / BGProcessing 再接續
- 呼叫 `backgroundUploadService.enqueueNextPendingFileIfIdle(...)`
- 呼叫 `endBackgroundTransitionIfNeeded()`

### 3.3 修改 `appWillEnterForeground()`（line 909）

在最前面加入：
```swift
isTransitioningToBackground = false
backgroundUploadService.requestForegroundResumeAfterBackgroundTask()
```

說明：

- **不在回前景時主動取消正在執行的背景 task**
- 若已有背景 HTTP 上傳正在進行，foreground 只標記「此檔完成後恢復一般 TCP pipeline」
- 若背景 task 空閒，則立即恢復既有 foreground watch loop / TCP sync

### 3.4 修改 `connectAndUpload()` 檔案迴圈（約 line 2228）

在迴圈頂部加入中斷檢查：
```swift
for (index, asset) in assets.enumerated() {
    if isTransitioningToBackground { break }  // 只允許在檔案邊界退出
    // ... 現有邏輯
}
```

### 3.5 修改 temp file cleanup

現有的 `defer { exportService.cleanup(tempURL:) }` 需條件化：如果 `isTransitioningToBackground` 且該檔案已交給背景上傳服務，則跳過 cleanup。

### 3.6 修改 init temp dir cleanup（約 line 892）

不再無條件清空 `syncflow_export/` 目錄。改為只清理不在 `UploadStore.temp_file_path` 中追蹤的檔案。

---

## Phase 4: iOS — UploadStore 擴充

**檔案**: `apps/mobile/ios/SyncEngine/UploadStore.swift`

新增兩個方法：

```swift
func updateTempFilePath(fileKey: String, path: String?) throws
// UPDATE upload_items SET temp_file_path = ?1, updated_at = ?2 WHERE file_key = ?3

func getItemsWithTempFiles() -> [UploadItemRecord]
// SELECT * FROM upload_items WHERE temp_file_path IS NOT NULL AND temp_file_path != ''
```

注意：`temp_file_path` 欄位已存在於 schema 且在 `uploadItemFromRow` 中已處理，目前只是未被使用。

---

## Phase 5: iOS — AppDelegate 整合

**檔案**: `apps/mobile/ios/SyncFlowMobile/AppDelegate.swift`

新增背景 URLSession 事件回調：
```swift
func application(
    _ application: UIApplication,
    handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
) {
    BackgroundUploadService.shared.handleEventsForBackgroundURLSession(
        identifier: identifier,
        completionHandler: completionHandler
    )
}
```

在 `didFinishLaunchingWithOptions` 中 wire up 依賴：
```swift
BackgroundUploadService.shared.uploadStore = SyncEngineManager.shared.uploadStore
```

---

## Phase 6: iOS — 更新 BackgroundExecutionService

**檔案**: `apps/mobile/ios/SyncEngine/BackgroundExecutionService.swift`

修改 `handleContinuedTask`：背景中不再啟動完整 TCP sync，改成「單檔排隊 + 補掃描」模式：
```swift
private func handleContinuedTask(_ task: BGProcessingTask) {
    task.expirationHandler = { ... }
    Task {
        // 1. 先做增量掃描，把新素材補進 UploadStore
        // 2. 如果目前沒有 active background URLSession task，才排 queue head 的 1 個檔案
        await BackgroundUploadService.shared.enqueueNextPendingFileIfIdle(...)
        task.setTaskCompleted(success: true)
    }
}
```

修改 `handleMaintenanceTask`：和 `continuedTask` 採用同一個背景策略，不再直接 `startSync()`：
```swift
private func handleMaintenanceTask(_ task: BGProcessingTask) {
    task.expirationHandler = { ... }
    Task {
        // 1. 先做增量掃描，把新素材補進 UploadStore
        // 2. 如果目前沒有 active background URLSession task，才排 queue head 的 1 個檔案
        await BackgroundUploadService.shared.enqueueNextPendingFileIfIdle(...)
        task.setTaskCompleted(success: true)
    }
}
```

補充要求：

- `continuedTask` 與 `maintenanceTask` 都不得在背景中直接呼叫 `SyncEngineManager.startSync()`
- 兩者都必須遵守「先補掃描，再檢查 active task，最後只排 queue head 1 檔」的模式
- 如果 queue head 需要 iCloud download 或匯出條件不成立，可直接結束 task，等待下次 foreground / BGProcessing 再重試
- 若 `enqueueNextPendingFileIfIdle(...)` 回傳 `false` 是因為**已有 active background task**，則本次 BG task 直接 `setTaskCompleted(success: true)`，不得額外再排 maintenance task
- 若 `enqueueNextPendingFileIfIdle(...)` 回傳 `false` 是因為**目前沒有可立即排程的 queue head**（例如 queue 為空、queue head 為 `cloud_downloading`、暫時不適合匯出），則應提交下一次 maintenance task，沿用既有 maintenance cadence，等待下次 BGProcessing / foreground 再重試
- 同一輪 BG task 不做 busy loop / 反覆輪詢 queue head；最多做一次增量掃描與一次排隊判斷

---

## Phase 7: iOS — 移除 SilentAudioService

### 7.1 移除呼叫點

**檔案**: `apps/mobile/ios/SyncEngine/SyncEngineManager.swift`
- Line 1699: 刪除 `SilentAudioService.shared.start()`
- Line 1300: 刪除 `SilentAudioService.shared.stop()`
- Line 3374: 刪除 `SilentAudioService.shared.stop()`

### 7.2 刪除檔案

刪除 `apps/mobile/ios/SyncEngine/SilentAudioService.swift`

### 7.3 從 Xcode 專案移除引用

**檔案**: `apps/mobile/ios/SyncFlowMobile.xcodeproj/project.pbxproj`

移除 `SilentAudioService.swift` 的 PBXBuildFile、PBXFileReference、Sources build phase 引用。

### 7.4 修改 Info.plist

**檔案**: `apps/mobile/ios/SyncFlowMobile/Info.plist`

```xml
<!-- 修改前 -->
<key>UIBackgroundModes</key>
<array>
    <string>processing</string>
    <string>audio</string>
</array>

<!-- 修改後 -->
<key>UIBackgroundModes</key>
<array>
    <string>processing</string>
</array>
```

---

## 交互流程摘要

### 前景同步（不變）
```
startSync() → connectAndUpload() → streamFileData() via LMUP/2 TCP
```

### 進入背景
```
1. appDidEnterBackground()
2. beginBackgroundTask() → ~30s 視窗
3. isTransitioningToBackground = true
4. TCP 迴圈完成當前檔案後 break（不切半檔）
5. backgroundUploadService.enqueueNextPendingFileIfIdle():
   - 重新查當前 queue head
   - 最多只建立 1 個 URLSession uploadTask
   - task.taskDescription = fileKey
6. endBackgroundTask()
7. iOS 掛起 app → 系統層級繼續 HTTP 上傳
```

### 背景完成（app 被殺後重啟）
```
1. iOS 重啟 app 發送背景 URLSession 事件
2. AppDelegate.handleEventsForBackgroundURLSession → 儲存 completionHandler
3. BackgroundUploadService 重連 session → delegate 回調觸發
4. 任務完成 → 更新 UploadStore → 清理 temp 檔案
5. 若 queue 仍有待傳項目，再次排當前 queue head 的 1 個背景 task
6. urlSessionDidFinishEvents → 呼叫 completionHandler()
```

### 回到前景
```
1. appWillEnterForeground()
2. isTransitioningToBackground = false
3. 若背景 task 正在跑，允許它先完成當前檔案
4. 當前背景檔案完成後，再恢復一般 TCP 管線
5. 已由背景 HTTP 完成的檔案在 UploadStore 中已是 completed，不會重傳
```

---

## 風險與緩解

| 風險 | 緩解 |
|------|------|
| ~30s 視窗內匯出不完 | 背景模式只匯出 queue head 的單一檔案；iCloud / 超大檔不在背景中主動匯出 |
| Mac 離線、iPhone 離開 Wi-Fi | 背景上傳失敗 → 重設為 `queued` → 回到前景時 TCP 重傳 |
| LAN 內未授權裝置偽造上傳 | HTTP 端點強制驗證 `pairingToken` hash，不接受只有 `clientId` 的請求 |
| HTTP body 提前中斷但未提供 SHA256 | handler 先硬性驗證 `receivedBytes == X-SyncFlow-File-Size`，不符就 `422 file_size_mismatch`，不得 finalize |
| Temp 檔案佔用磁碟 | 完成/失敗後立即清理；app 啟動時掃描孤兒檔案 |
| 背景 URLSession 無即時進度 | 可接受：`didSendBodyData` 仍更新 offset，desktop 端則透過 background transfer tracker 顯示 transferring/currentFile |
| iOS 被系統殺掉後 tracker 殘留 | `BackgroundTransferTracker` 以 10 分鐘 inactivity timeout + 1 分鐘 sweep 自動清除 stale active 項目，避免 dashboard 長期卡在 transferring |
| foreground/background 交接時重複排下一檔 | foreground resume flag 優先；當前背景檔完成後改恢復 TCP，不再續排 background task |
| 背景 HTTP 完成但 mobile history 缺資料或分桶錯誤 | sidecar 成功 / 去重回應都回 `ledgerDate` 與 `activeTransmissionMs`；iOS 完成分支必須同步更新 `HistoryLedgerStore` / `daily_ledgers` |
| maintenance task 殘留舊 TCP 背景同步入口 | `handleContinuedTask` / `handleMaintenanceTask` 一律改成「補掃描 + 單檔背景排隊」，不得直接 `startSync()` |
| BG task 這輪沒有排到檔案後行為不一致 | 明確區分 `active task 已存在` 與 `目前無可排 queue head` 兩種情況；前者直接完成，後者提交下一次 maintenance task |

---

## 變更檔案清單

| 檔案 | 動作 |
|------|------|
| `services/sidecar-go/internal/api/handlers_upload.go` | **新增** |
| `services/sidecar-go/internal/api/background_transfer_tracker.go` | **新增** |
| `services/sidecar-go/internal/api/router.go` | 修改（+1 行路由） |
| `services/sidecar-go/internal/api/handlers_dashboard.go` | 修改（納入 background HTTP transfer 狀態） |
| `services/sidecar-go/internal/api/handlers_shared.go` | 修改（`/transfer/active` 納入 background HTTP transfer） |
| `services/sidecar-go/internal/server/handler_file.go` | 修改（+3 行匯出 HashFile） |
| `apps/mobile/ios/SyncEngine/BackgroundUploadService.swift` | **新增** |
| `apps/mobile/ios/SyncEngine/SyncEngineManager.swift` | 修改（背景轉換邏輯 + 移除 SilentAudio 呼叫） |
| `apps/mobile/ios/SyncEngine/BackgroundExecutionService.swift` | 修改（continued task / maintenance task 都改用背景 HTTP） |
| `apps/mobile/ios/SyncEngine/UploadStore.swift` | 修改（+2 方法） |
| `apps/mobile/ios/SyncFlowMobile/AppDelegate.swift` | 修改（+背景 URLSession 回調） |
| `apps/mobile/ios/SyncFlowMobile/Info.plist` | 修改（移除 `audio`） |
| `apps/mobile/ios/SyncFlowMobile.xcodeproj/project.pbxproj` | 修改（+BackgroundUploadService, -SilentAudioService） |
| `apps/mobile/ios/SyncEngine/SilentAudioService.swift` | **刪除** |

---

## 驗證計畫

1. **Go sidecar 單元測試**: `go test ./internal/api/...` — 測試 happy path、missing headers、invalid pairing token、duplicate、SHA256 mismatch、file_size_mismatch、stale tracker prune、完成後狀態重算
2. **Go 編譯**: `go build ./cmd/syncflow-sidecar/`
3. **curl 手動測試**: 直接 POST 檔案到 `/upload/{clientId}` 驗證端到端
4. **iOS 編譯**: Xcode build 通過（無 SilentAudioService 引用錯誤）
5. **iOS TypeScript 類型檢查**: `pnpm --filter @syncflow/mobile exec tsc --noEmit`
6. **前景同步回歸**: TCP 傳輸行為不變
7. **背景轉換測試**: app 進入背景後只建立 1 個 background URLSession task，且 desktop 顯示 `transferring`
8. **manual 插隊測試**: auto item 背景完成後，若此時 queue head 變成 manual item，下一個背景 task 必須取 manual item
9. **409 去重測試**: sidecar 回 `409 already_completed` 時，iOS 應標記本地項目為 `completed`，不得回 `queued`，且若回應包含 `ledgerDate` / `activeTransmissionMs` 必須同步補寫 history
10. **tracker timeout 測試**: 模擬 iPhone 背景上傳中斷且不再有新 byte，確認 10 分鐘後 stale tracker 被清除，desktop 從 `transferring` 恢復成正確狀態
11. **回到前景測試**: 確認不會和 active background task 並行雙傳；當前背景檔完成後恢復 TCP，而不是繼續串 background HTTP；已完成的背景上傳不重傳
12. **history 統計測試**: 背景 HTTP 完成後，mobile history / `daily_ledgers` 必須使用 sidecar 回傳的 `ledgerDate` 與 `activeTransmissionMs`
13. **maintenance task 測試**: 觸發 maintenance task 時，不得直接啟動完整 TCP sync；只能補掃描並排 queue head 的 1 個背景 task
14. **409 日期口徑測試**: `already_completed` 回應中的 `ledgerDate` 必須與 sidecar 既有完成記錄一致，不得因不同 API 路徑出現不同日期
15. **BG task 未排到檔案測試**: 驗證 `active task 已存在` 不會重複提交 maintenance task；`queue head 暫不可排` 則會提交下一次 maintenance task
16. **確認 Info.plist 不含 `audio`**: 重新提交審核前檢查
