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
5. **不做跨協定斷點續傳**：正常 background transition 只在檔案邊界排下一檔；若系統中止造成 TCP 停在 mid-file，後續同一 `fileKey` 改由 HTTP 接手時必須先 reset partial state，再全檔 POST，不得沿用舊 TCP offset
6. **單一 fileKey 的 partial state 只能由一條傳輸路徑持有**：背景 HTTP 與 TCP 對同一 `fileKey` 不做跨協定斷點續傳；切換協定時立即 reset 另一側的 `acked_offset` 與 sidecar `.part` ownership，避免 foreground TCP 和 background HTTP 共用半檔狀態
7. **開發版不保留舊半檔相容性**：本 plan 面向開發版；切協定、cold-start sweep、HTTP 失敗重試都允許放棄舊 TCP partial，回到 queue 後從 0 全檔重傳，優先換取簡單且一致的狀態機

---

## Tunable constants（實作時統一命名，集中定義避免各地魔術數字）

**Sidecar 側（`services/sidecar-go/internal/api/handlers_upload.go` 或新檔 `upload_constants.go`）**：

| 常數 | 值 | 用途 |
|-----|-----|------|
| `authReplayWindowSeconds` | `300`（±5 分鐘） | `X-SyncFlow-Auth-Timestamp` 允許偏差 |
| `authNonceLRUCapacity` | `1024` | Nonce LRU 容量 |
| `authNonceLRUTTLSeconds` | `authReplayWindowSeconds * 2 = 600` | Nonce TTL |
| `authIPFailureThreshold` | `5` | 同 IP 連續失敗次數上限 |
| `authIPBackoffSeconds` | `60` | 失敗超過門檻後的快速拒絕視窗 |
| `backgroundTransferTrackerStaleAfter` | `10 * time.Minute` | Dashboard / transfer tracker 的 progress inactivity prune |
| `backgroundTransferSweepInterval` | `1 * time.Minute` | Tracker + gate sweep cadence |
| `uploadInactivityTimeout` | `3 * time.Minute` | HTTP body 連續 N 秒沒有新 bytes 就關 body |
| `transferGateStaleAfter` | `10 * time.Minute` | Gate prune threshold；必須大於 `uploadInactivityTimeout` |
| `transferGatePruneGracePeriod` | `30 * time.Second` | Gate 呼叫 canceller 後等待 handler 自行 release 的寬限期 |
| `uploadBodyBufferBytes` | `256 * 1024`（256 KB） | Stream read buffer |

**iOS 側（`BackgroundUploadService` 常數）**：

| 常數 | 值 | 用途 |
|-----|-----|------|
| `transitionBackgroundWaitTimeoutSeconds` | `25` | `transitionToBackgroundUpload()` 等待 TCP 迴圈抵達檔案邊界的最長時間；此路徑只允許排已預備好的 temp 檔，不做大型 export / hash |
| `transitionPollIntervalMilliseconds` | `100` | 輪詢 `isTCPLoopStopped` 的 `Task.sleep` 間隔 |
| `consecutive422FailureThreshold` | `3` | 連續 422 `body_*_mismatch` / `body_too_large` 達此次數 → `status = 'failed'`，避免死循環 |
| `consecutiveAuthRepairThreshold` | `1` | 背景 HTTP 收到 repair-required auth failure（401 invalid signature / revoked，或 POST 404 unknown client / device_not_paired）立刻標 `needsRepair = true` |
| `foregroundBannerForRepairDelaySeconds` | `0` | `appWillEnterForeground` 讀到 `needsRepair` 後立即顯示 banner |
| `uploadMaxResponseBodyBytes` | `16 * 1024`（16 KB） | URLSession delegate response 累積上限（硬性） |
| `crossProtocolResetDeleteTimeoutSeconds` | `10` | TCP 接手 HTTP-touched fileKey 時 DELETE 請求的超時（超時 → 放棄本輪 TCP）|
| `backgroundTransitionPreparationBudgetSeconds` | `0` | `appDidEnterBackground` 轉場 fast path 不做 export / SHA256；缺預備資料直接 deferred |

所有「連續 N 次」計數器在 **HTTP 回 200 / 409 `already_completed`** 時歸零；在 queue 被 `.emptyQueue` 清空時亦歸零。

---

## Phase 1: Go Sidecar — HTTP 上傳端點

### 1.1 匯出 `hashFile` 函數

**檔案**: `services/sidecar-go/internal/server/handler_file.go`

在現有的 `hashFile` 旁新增匯出版本，或直接將 `hashFile` 改名為 `HashFile` 並更新 TCP 路徑引用。若只做 wrapper，避免改動既有呼叫點：

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
| `X-SyncFlow-Filename-B64` | 是 | UTF-8 原始檔名的 base64，避免 header 字元問題 |
| `X-SyncFlow-Media-Type` | 是 | `image` / `video` |
| `X-SyncFlow-File-Size` | 是 | 位元組數（decimal string） |
| `X-SyncFlow-Auth` | 是 | HMAC-SHA256 驗證值，不傳 raw pairing token |
| `X-SyncFlow-Auth-Timestamp` | 是 | Unix seconds，用於 replay window |
| `X-SyncFlow-Auth-Nonce` | 是 | client 產生的隨機 nonce（≥128 bits），用於 replay 防護 |
| `X-SyncFlow-SHA256` | 是 | hex-encoded SHA256 of body；簽入 canonical string，body 完整性承諾 |
| `X-SyncFlow-Created-At` | 否 | RFC3339 |
| `X-SyncFlow-Modified-At` | 否 | RFC3339 |
| `X-SyncFlow-Upload-Mode` | 否 | 固定 `"background_http"`，僅供 diagnostics/log 使用，不寫入 sidecar schema |

Auth 計算規則：

- HMAC key 編碼：mobile 以 `SHA256(pairingToken)` 的 **raw 32 bytes** 作 HMAC key；sidecar 以 `hex.DecodeString(paired_devices.pairing_token_hash)` 得到的 **raw 32 bytes** 作 HMAC key。兩側都**不得**用 hex string 當 key，與 `handler_hello.go:188-189` 的既有 hello proof 慣例一致。
- iOS 從目前 binding 的 `pairingTokenKeychainRef` 取出對應 server 的 `pairingToken`，計算 `keyBytes = SHA256(pairingToken)`（raw bytes，**不做 hex encoding**）。
- `X-SyncFlow-Auth = hex(HMAC-SHA256(keyBytes, canonicalString))`。
- `canonicalString` 採固定換行格式，欄位順序固定：
  ```
  method\n
  path\n
  clientId\n
  fileKey\n
  filenameB64\n
  mediaType\n
  fileSize\n
  bodySha256Hex\n
  createdAt\n
  modifiedAt\n
  timestamp\n
  nonce
  ```
  **換行字元**：上圖中的 `\n` 指 ASCII `0x0A`（LF，真實換行 byte），不是字面兩字元 `\` + `n`。iOS：Swift `"...\n..."` literal；Go：`"...\n..."` literal 或 `'\n'`。**禁止**用 `\r\n`（CRLF）。

  **欄位格式鎖死**（避免 mobile/server 組串差異）：
  - `method`：大寫 ASCII，固定 `POST`
  - `path`：**URL-decoded** 形式 `/upload/<raw-clientId>`，不含 query string、不含 fragment、不做 percent-encoding；iOS 以 string 拼接產生（不要從 `URLComponents.path` 取，因為該屬性會做 decoding 但大小寫可能異動）；sidecar 以 `r.URL.Path` 取（Go 預設已是 decoded）
  - `clientId`：限制為 ASCII-safe 字元集 `[A-Za-z0-9._:-]`（既有 `BindingService.getClientId()` 產生的 UUID/hex 已符合）；非 ASCII-safe 一律在 clientId 產生處拒絕，避免 path percent-encoding 歧義
  - `fileKey`：原樣字串
  - `filenameB64`：與 `X-SyncFlow-Filename-B64` 完全相同字串
  - `mediaType`：與 `X-SyncFlow-Media-Type` 完全相同字串
  - `fileSize`：decimal integer，無千分位、無負號
  - `bodySha256Hex`：64 字元小寫 hex
  - `createdAt`：與 `X-SyncFlow-Created-At` 完全相同字串；**缺省定義**：iOS 側若 optional 為 nil **不送** header，canonical string 用空字串 `""`；若 optional 為空字串 `""` 也**不送** header，canonical string 用 `""`。sidecar 側 `r.Header.Get(...)` 回空字串一律視為缺省，canonical string 用 `""`。**禁止**出現「iOS 送 header 為 `""` 但不納入 canonical」或「iOS 不送 header 卻把 `""` 寫進 canonical」的單邊行為
  - `modifiedAt`：與 `createdAt` 同缺省規則
  - `timestamp`：Unix seconds decimal integer（與 `X-SyncFlow-Auth-Timestamp` 完全相同字串）
  - `nonce`：原樣字串（與 `X-SyncFlow-Auth-Nonce` 完全相同字串）

  `bodySha256Hex` 必須與 `X-SyncFlow-SHA256` 一致；sidecar 在 streaming 過程中計算 body SHA256，結束後與 header 比對，不符回 422 `body_hash_mismatch`。這讓 HMAC 涵蓋 body 承諾，避免 LAN on-path 替換 body。
- sidecar 使用 `paired_devices.pairing_token_hash` hex-decode 後的 bytes 作為 HMAC key 驗證，不接收 raw `pairingToken`。
- `timestamp` 必須落在 ±300 秒 replay window 內；超出 → 401 `auth_timestamp_out_of_window`。
- Nonce LRU：容量 1024，TTL = `authReplayWindowSeconds * 2`（10 分鐘）。重複 nonce 在 TTL 內直接 401 `auth_nonce_replay`。
- sidecar 重啟後 LRU 清空，replay window 內（最多 5 分鐘）的 replay 視為可承擔風險；攻擊者需同時是 LAN on-path 並搶在 sidecar 重啟 5 分鐘內重放，且仍受 body SHA256 綁定限制，無法偽造新內容。

**背景 URLSession 延遲送出的 401 分類（避免誤判 re-pair）**：

背景 `URLSession` 可能在 `waitingForConnectivity` 中保留 request 很久才真正送出；因此 `X-SyncFlow-Auth-Timestamp` / nonce 是「建立 task 時」的值，不保證「抵達 sidecar 時」仍在 ±5 分鐘內。這是背景傳輸的正常現象，不代表 pairing token 失效。

Sidecar 401 `status` 必須可機器判讀：

- `auth_timestamp_out_of_window`：**retryable**。mobile 不標 `needsRepair`，取消/收斂目前 task 後以 fresh timestamp + fresh nonce 重新 enqueue。
- `auth_nonce_replay`：**retryable once per wake**。URLSession 可能自動重送同一 signed request；mobile 不標 `needsRepair`，下一輪必須重建 request 取得 fresh nonce。若連續多次仍 replay，才寫 diagnostics。
- `auth_invalid_signature` / `auth_revoked_device`：**repair-required**。mobile 才設定 `needsRepair=true` 並停止自動上傳。
- POST 404 `unknown_client` / `device_not_paired`：同樣視為 **repair-required**。DELETE 404 `not_found` 是 reset 冪等成功，兩者必須用 endpoint + response `status` 區分。

換句話說：`401` 本身不是 re-pair 訊號，**401 的 `status` 才是決策依據**。

Auth failure backoff 也必須依 `status` 分類：

- `auth_timestamp_out_of_window` 不計入 `authIPFailureThreshold`。這通常是 background `URLSession` 延後送出，不是暴力嘗試。
- `auth_nonce_replay` 只寫 diagnostics 與 per-task/per-wake retry guard，不計入一般 IP backoff；若同一 IP 在短時間內大量 replay 不同 nonce，可另外加 abuse counter，但不得阻擋單一合法 task 的 fresh retry。
- `auth_invalid_signature`、malformed auth header、unknown auth scheme 才計入 IP failure counter。
- repair-required 但已可識別裝置的 `auth_revoked_device` 不需要 IP backoff；它要觸發 mobile repair flow，不是網路層封鎖。

**Handler 流程**（複用 TCP 路徑的核心邏輯）：
1. 驗證 `clientId` 是已配對且未 revoked 的裝置 → `store.GetPairedDevice(clientId)` 且 `RevokedAt == nil`，否則 404/401
2. 解析並驗證必要 headers → 缺少則 400；`X-SyncFlow-File-Key` 必須符合 `^[0-9a-f]{64}$`，不符回 `400 invalid_file_key`
3. 驗證 `X-SyncFlow-Auth` HMAC、timestamp replay window 與 nonce；不符回 401，並依上方 `status` 分類決定是否對來源 IP 做輕量失敗退避
4. **`fileKey` owner 檢查**（**新增，security 防線**）：查 `store.GetUpload(fileKey)`；若**已存在 row 且 `row.client_id != path.clientId`**，回 `403 {"status":"file_key_owner_mismatch","fileKey":"..."}`，不得繼續。理由：`uploads.file_key` 在 sidecar DB 是**全域 primary key**（migrations/001_initial.sql:30），`CompleteUpload` 只 `WHERE file_key = ?`（uploads.go:226），若只信任 iOS fileKey 以 `SHA256(clientId|assetLocalId|mediaType)` 計算而不做 server-side 擁有權檢查，一旦 client A 的 fileKey 洩漏給 client B（log、abuse、social engineering），B 可以用自己的 pairingToken 對 A 的 file row 做 POST/DELETE。Server 必須加一層 ownership enforcement，defense-in-depth
5. 查詢已有上傳記錄 → 已 `completed` 且 final file 仍存在，回 `409 {"status":"already_completed","fileKey":"...","ledgerDate":"YYYY-MM-DD","activeTransmissionMs":1234}`
6. 檢查磁碟空間 → `disk.IsLow()` → 507
7. 以 `ctx, ctxCancel := context.WithCancel(r.Context())` 建立可被 `PruneStale` 中斷的 context；組 `canceller := func() { r.Body.Close(); ctxCancel() }`（Go 陷阱：ctx cancel 不中斷 blocking Read，必須同時關 body）；呼叫 `TransferGate.AcquireWithCanceller(clientId, fileKey, TransportHTTP, canceller)` 原子標記 active；若同 `clientId` 已有 TCP 或 background HTTP transfer，回 `409 {"status":"concurrent_transfer","via":"tcp|http"}`。defer 一定要 `release()`
8. HTTP path 取得 ownership 時立即放棄舊 partial，呼叫 **idempotent** 的 reset 序列（同一個 fileKey 重複呼叫無副作用）：
   ```go
   // 新增或等價實作（放在 internal/server 或 internal/api 共用處）
   server.DiscardPartialIfExists(config.StagingDir, clientID, fileKey)
   // ↑ 實作：計算 PartPath，os.Remove(partPath)，ignore ErrNotExist

   store.ResetUploadBytes(fileKey)
   // ↑ 新增專用 patch update，**不用 UpsertUpload**（現有 UpsertUpload 是 full-row upsert，
   //   會用零值覆蓋 client_id / original_filename / media_type / file_size 等既有欄位，
   //   見 services/sidecar-go/internal/store/uploads.go:10-42）
   // UPDATE uploads SET committed_bytes = 0, part_path = '', status = 'receiving', updated_at = ?
   //   WHERE file_key = ?
   // 若 row 不存在（首次上傳此 fileKey），直接返回 nil，由 step 9 建 row
   ```
   不得從 TCP offset 接續；HTTP 失敗後下一輪也從 0 重傳，不保留舊 TCP resume。
9. **確保 `uploads` row 存在**（新增一個專用 helper，**不用** `UpsertUpload`）：
   ```go
   store.EnsureReceivingUpload(store.UploadInit{
       FileKey:          headerFileKey,
       ClientID:         clientID,
       OriginalFilename: decodedFilename,  // 從 X-SyncFlow-Filename-B64 decode
       MediaType:        headerMediaType,
       FileSize:         headerFileSize,
       CreatedAtRemote:  headerCreatedAt,
       ModifiedAtRemote: headerModifiedAt,
       Status:           "receiving",
       CommittedBytes:   0,
       UpdatedAt:        time.Now(),
   })
   // 實作：INSERT ... ON CONFLICT(file_key) DO UPDATE SET
   //   status = 'receiving',
   //   committed_bytes = 0,
   //   updated_at = ?
   // **只更新**狀態相關欄位，**保留**既有的 client_id / filename / media_type / file_size
   // 既可從 TCP 路徑已寫過的 row 接手（不蓋 metadata），也可當全新 row 插入（用 HTTP headers 帶來的 metadata）
   ```
   **理由**：現有 `UpsertUpload` 是 full-row upsert，`ON CONFLICT` 會把所有欄位用 `excluded.*` 覆蓋。若 step 9 直接傳 `Upload{Status:"receiving", CommittedBytes:0}` 但其他欄位留零值，會把既有 `client_id` / `original_filename` / `file_size` 等寫成空字串或 0，破壞既有資料。必須另外加 `EnsureReceivingUpload` 專用 patch-style 函數。
10. 建立 `FileWriter` → `server.NewFileWriter(config.StagingDir(), clientID, fileKey, fileSize)`；同時啟動 `inactivityTimer := time.AfterFunc(uploadInactivityTimeout, canceller)` — **不用** `time.NewTimer + go func() { <-t.C }` 寫法（見 Phase 1.3a Timeout 段的 goroutine race 說明）。`defer inactivityTimer.Stop()` 冪等取消。
11. 用 `http.MaxBytesReader(w, r.Body, fileSize + 1)` 包住 body；串流讀取 → 256KB buffer → `bodyReader.Read(buf)` → `fw.WriteAt(buf[:n], offset)` + `fw.MaybeSync()`；每個成功 chunk 後 `inactivityTimer.Reset(uploadInactivityTimeout)`（Go 1.23+ 對 AfterFunc timer 直接 Reset 安全）+ `gate.Touch(clientId)` + `UpdateProgress(committedBytes)` + feed bytes 進 `sha256.New()` 累積器。讀 loop 結束後明確 `inactivityTimer.Stop()`（defer 是兜底，顯式 Stop 讓分類檢查時不再被誤觸發）。**禁止**在主 streaming loop 直接用 `io.ReadFull(bodyReader, buf)`，除非完整處理 final partial chunk；否則最後一段小於 buffer size 的正常尾段會被誤判成 read error。
12. **讀取迴圈結束時立即檢查**（在任何 fsync / Close 之前，避免把錯的 bytes 浪費 fsync I/O）；先 `inactivityTimer.Stop()` 冪等取消後援。

    **分類優先序鎖死**（必須依此順序判斷，不得任意互換）：

    ```
    1. readErr 是 *http.MaxBytesError OR receivedBytes > fileSize
       → 422 body_too_large  （優先於下列任一：即使 body 超大，也算 body_too_large 不算 read error）

    2. readErr != nil（任何非 nil 的 Read 錯誤）
       → 500 body_read_error
       ├─ errors.Is(readErr, net.ErrClosed) 或字串含 "use of closed network connection"
       │   且是 canceller 關的 body
       │   → log "body_closed_by_inactivity" 或 "body_closed_by_prune_cancel"
       │     但 HTTP status 仍回 500 body_read_error
       └─ 其他 Read error（net.OpError、context deadline、底層 IO 錯誤等）
           → log 原始 error 字串

    3. readErr == nil 且 receivedBytes < fileSize（clean EOF 但 bytes 不足）
       → 422 file_size_mismatch
       （這條只能是「client 乾淨送完卻沒送夠 byte」的場景；不能套用在 body 被 close 的情況）

    4. readErr == nil 且 receivedBytes == fileSize 且 bodySHA256 != X-SyncFlow-SHA256
       → 422 body_hash_mismatch

    5. 寫 fw.WriteAt 時 disk error（不是 Read error）
       → 500 internal_io_error；磁碟滿 → 507
    ```

    **關鍵原則**：**「是 readErr 還是 clean EOF」是首要區分**。Inactivity canceller 或 gate prune canceller 關 body 後 `Read` 會回非 nil error，走 **500 body_read_error**（因為這是 server-initiated close，不是 client 的 clean termination）；只有 client 正常送完 `fileSize` 之前就關 TCP（客戶端正常 close 而 Read 讀到 io.EOF）才算 `file_size_mismatch`。

    這避免了原寫法的衝突：「inactivity 關 body → receivedBytes < fileSize → 422 file_size_mismatch」其實語義錯誤 — 這不是 client 少送，而是 server 主動中斷，應該是 500。
13. 上述任一錯誤分支**必須**：`backgroundTransfers.Finish(clientId: clientID, fileKey: fileKey, reason: "http_body_error")` + `store.ResetUploadAfterHTTPError(fileKey)`（新增專用 patch helper，**不用 DELETE**）；確保 fileKey 可重試、不留 `failed` 汙染 UI、不得進入 finalize、不得呼叫 `CompleteUpload`、不得廣播 `upload.completed`

    ```go
    // 新增至 services/sidecar-go/internal/store/uploads.go
    // 失敗後 patch-style reset，保留 client_id / original_filename / media_type / file_size 等 owner metadata
    // sidecar 沒有「queue」概念；retryable clean state 用 interrupted 表示。
    // **禁止**改用 DELETE — 刪 row 會連同 owner 資訊一起失去，讓下次任何 POST 都變成「新 row」，
    //   Phase 1.2 step 4 的 file_key_owner_mismatch 防線失效
    func (s *Store) ResetUploadAfterHTTPError(fileKey string) error {
        now := time.Now().UTC().Format(time.RFC3339)
        _, err := s.db.Exec(`
            UPDATE uploads
            SET status = 'interrupted',
                committed_bytes = 0,
                part_path = '',
                updated_at = ?
            WHERE file_key = ? AND status = 'receiving'`,
            now, fileKey)
        return err
    }
    ```

    理由：原本寫 `DELETE FROM uploads WHERE file_key = ? AND status = 'receiving'` 會讓 `client_id` owner 資訊消失；下次 client B 用相同 fileKey 發 POST 時 `GetUpload` 回空、step 4 的 owner check 找不到 row 因此放行，可能讓 B 成功接手 A 曾經用的 fileKey。必須改為 patch-style reset 只清 in-flight 狀態、保留 ownership 承諾。

    **sidecar upload status vocabulary**（避免把 mobile queue 狀態混進 sidecar）：
    - `receiving`：sidecar 正在或曾經建立接收 row；`committed_bytes > 0` 時 TCP 可 resume
    - `completed`：finalized 且可進 history / daily stats
    - `failed`：不可自動重試的資料錯誤（例如 TCP SHA mismatch 既有路徑）
    - `paused_resumable`：低磁碟等可續傳暫停狀態（既有路徑）
    - `interrupted`：HTTP / IO error 後已清到 retryable clean state，`committed_bytes=0`、`part_path=''`；sidecar 不代表 queue，只保留 owner metadata

    `queued` 只屬於 mobile `upload_items`，不得寫入 sidecar `uploads.status`。
14. **（只有 step 12 全通過才執行）** `fw.ForceSync()` + `fw.Close()`；這是正常完成路徑才付的 fsync 成本
15. 取得穩定接收目錄 → `server.EnsureReceiveDirName(store, config.ReceiveDir, clientID)`（與 TCP 完成路徑一致）
16. `fw.Finalize(config.ReceiveDir, dirName, date, filename, fileKey)` → `relativePath`
17. `store.CompleteUpload(fileKey, relativePath, sha256, transmissionMs)`
18. `store.UpsertDailyStats(...)`
19. 清除 background transfer active 狀態（`backgroundTransfers.Finish(clientId: clientID, fileKey: fileKey, reason: "completed")`、`TransferGate.release()`），並依統一狀態推導器重新計算後廣播 `device.state.changed`
20. 廣播事件 → `upload.completed` + `dashboard.updated` + `history.updated`
21. 回傳 JSON：`200 {"status":"completed","fileKey":"...","relativePath":"...","storedBytes":N,"ledgerDate":"YYYY-MM-DD","activeTransmissionMs":1234}`

**補充要求**：

- `200 completed` 與 `409 already_completed` 都應盡量回傳 `ledgerDate` 與 `activeTransmissionMs`
- `ledgerDate` 必須沿用 sidecar / desktop 完成日口徑，不能由 iOS 本地重新分桶
- `activeTransmissionMs` 必須沿用 sidecar 完成時計算值，讓背景 HTTP 與前景 TCP 的 history 統計口徑一致
- `409 already_completed` 的 `ledgerDate` 來源也必須唯一化：優先使用該 upload 已持久化的完成日（例如由 `uploads.completed_at` 依 sidecar 本地時區推導），不得在不同 handler / client 各自重算
- 若 sidecar 需 fallback 查詢 daily stats 才能補齊 `ledgerDate` / `activeTransmissionMs`，也必須在單一路徑內完成，避免同一檔案在不同 API 得到不同日期
- `X-SyncFlow-Upload-Mode` 若不是 `"background_http"`，只寫 diagnostics 並忽略，不影響接收結果
- HTTP 上傳不接受 `Content-Range`；若未來要做 HTTP resume，需另開明確設計，不在本 plan 混入
- TCP 與 HTTP 對同一 `fileKey` 競速時，最後只能有一個完成者；另一條路徑必須收到 `SKIP` / `already_completed` 並收斂到本地 `completed`
- 路由不能套任何會 pre-read body 的 middleware；只套現有 logging / panic recovery 類 middleware
- 對 malformed auth / invalid signature / unknown client 的來源 IP 做輕量退避，例如連續 N 次失敗後 1 分鐘內快速拒絕；retryable stale auth 與已識別的 revoked device 不進一般 IP backoff

**錯誤碼**：400（headers 缺失、`invalid_file_key`）、401（auth 無效 / revoked）、**403（`file_key_owner_mismatch`）**、404（未知裝置）、409（已完成 / 同 client 併發 transfer）、422（`body_hash_mismatch` / `file_size_mismatch` / `body_too_large`）、500（`body_read_error` / `internal_io_error`）、507（磁碟滿）

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

必要方法：

- `Start(clientId:fileKey:filename:fileSize:)`：**僅登記** background HTTP progress 項目；不做任何 concurrency 檢查（舊版叫 `TryStart` 會誤導），同 client 互斥全交 `TransferGate`。命名與 `Finish` 對稱
- `UpdateProgress(clientId:fileKey:committedBytes:)`：更新 byte 數與 `lastProgressAt`
- `Finish(clientId:fileKey:reason:)`：完成、失敗、中斷、prune 都必須顯式呼叫，避免 dashboard 卡在 `transferring`
- `ActiveForClient(clientId)` / `AnyActive()`：供 dashboard 和 `/transfer/active` 查詢

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

### 1.2a TCP handleFileInit 補 fileKey owner 檢查

**位置**：`services/sidecar-go/internal/server/handler_file.go` 的 `handleFileInit(body)`（由 `connection.go:163-164` 分派）。

**問題**：既有 TCP 路徑在 `handler_file.go:318` 和 `:358` 都用 `c.store.GetUpload(req.FileKey)` 取 row，然後按 **global `file_key`** 做 resume / Finalize / UpsertDailyStats，**沒有**驗證 `row.client_id == c.clientID`。

與 Phase 1.2 step 4 對 HTTP POST 加的 owner check 完全對稱的漏洞：client B 知道 client A 的 fileKey 後透過 TCP `FILE_INIT_REQ` 送同一個 fileKey，sidecar 會把 B 的 bytes 寫進 A 的 row / A 的目錄，最後 A 再上傳時看到 `already_completed`。

**修法**：`handleFileInit` 在 `GetUpload(req.FileKey)` 之後、開始任何 resume / writer 建立之前插入。使用既有 `FileInitRes` schema（`messages.go:109-112` 已定義 `Action / ResumeOffset / Reason`；`Action` 的合法值包含 `UPLOAD / RESUME / SKIP / REJECT`，直接複用 `REJECT`）：

```go
if existing, err := c.store.GetUpload(req.FileKey); err == nil {
    if existing.ClientID != "" && existing.ClientID != c.clientID {
        // 拒絕：另一 client 的 fileKey 不得被本 client 接手
        slog.Warn("FILE_INIT rejected: fileKey owner mismatch",
            "fileKey", req.FileKey,
            "existingOwner", existing.ClientID,
            "requestingClient", c.clientID,
        )
        return c.sendJSON(protocol.TypeFileInitRes, protocol.FileInitRes{
            Action: "REJECT",
            Reason: "OWNER_MISMATCH",
        })
    }
}
```

**協議層**：

- `protocol.FileInitRes` 已有 `Action string` + `Reason string`（optional）— **不需新增欄位**，直接複用既有 schema
- `Action: "REJECT"` 是既有 action 集合的合法值（「UPLOAD / RESUME / SKIP / REJECT」），純粹加一個新的 `Reason` 字面值 `"OWNER_MISMATCH"`
- 與 HTTP `403 file_key_owner_mismatch` 同一個 security story：`uploads.file_key` 是全域 PK，server 必須做 owner enforcement，**不論**資料從 TCP 還是 HTTP 進來

**iOS 端**：

- `SyncEngineManager` 處理 `FILE_INIT_RES` 時檢查 `Action == "REJECT"`；若 `Reason == "OWNER_MISMATCH"` 走新分支：本地該 fileKey 標為 `failed`、通知使用者（不是 retry — 因為 retry 也會被同一檢查擋）
- 既有 `REJECT` 處理路徑（若已有）可沿用，只多一條 `Reason` 分流

**變更檔案清單連動**：

- `services/sidecar-go/internal/server/handler_file.go` 修改（+ owner check，複用 `Action: "REJECT"`）
- `services/sidecar-go/internal/protocol/messages.go` **不需改動**（`Action / Reason` 已存在）
- iOS 端 `SyncEngineManager` 的 `FILE_INIT_RES` 處理器新增 `Reason == "OWNER_MISMATCH"` 分支

### 1.3a 新增單一 TransferGate

目前 sidecar 沒有顯式「同一 `clientId` 正在傳檔」的單一 gate；`handlers_shared.go:286` 的 `state == "syncing"` 是從 presence/heartbeat 推導的字串，無法支撐原則 2「單檔串行」的原子拒絕。

**新檔案**：`services/sidecar-go/internal/transferstate/transfer_gate.go`（或等價的中立 package；避免 `internal/api` 與 `internal/server` import cycle）。

核心 API：

```go
type Transport string
const (
    TransportTCP  Transport = "tcp"
    TransportHTTP Transport = "http"
)

type ActiveTransfer struct {
    ClientID       string
    FileKey        string
    Transport      Transport
    StartedAt      time.Time
    LastProgressAt time.Time  // 由 handler 以 Touch(...) 週期性推進
}

// 主要 acquire API：handler 必須傳入 cancel func，讓 PruneStale 能主動中斷死卡的 handler
// 而不是粗暴地搶走 active entry（見 Stale 策略）。
func (g *TransferGate) AcquireWithCanceller(
    clientID, fileKey string,
    transport Transport,
    cancel func(),  // 通常是 context.WithCancel 回傳的 cancel func
) (release func(), conflict *ActiveTransfer)

func (g *TransferGate) ActiveForClient(clientID string) (ActiveTransfer, bool)
func (g *TransferGate) Any() bool

// 見下方 Stale 策略
func (g *TransferGate) Touch(clientID string)
func (g *TransferGate) PruneStale(now time.Time) (cancelled, forceEvicted []ActiveTransfer)
```

規則：

- `AcquireWithCanceller(...)` 必須在**同一把 mutex** 下完成「檢查同 client 是否已有 active transfer」、「占用」、「登記 cancel func」三件事，不可拆成兩個 registry 互查（語義上是「try-acquire」pattern，但 API 名稱叫 `AcquireWithCanceller` 反映其多帶 cancel 參數的事實）。
- **TCP handler（`internal/server/connection.go`）**：TCP blocking `Read` 同樣**不會**被 ctx cancel 中斷（和 HTTP 是同一個 Go runtime 陷阱）。既有 `connection.go:18` 已有 45s `readDeadline`（每個封包都 `SetReadDeadline`，`connection.go:183`），但 45s 粒度太粗 — `PruneStale` 呼叫 canceller 時要能**立即**中斷。

  TCP canceller 必須同時做三件事：
  ```go
  ctx, ctxCancel := context.WithCancel(connCtx)
  canceller := func() {
      // 1. 立即把 read deadline 設成過去，讓正 block 在 Read 的 goroutine 立刻回 timeout error
      _ = c.conn.SetReadDeadline(time.Now())
      // 2. 關掉 TCP conn，保險讓後續任何 Read/Write 都失敗
      _ = c.conn.Close()
      // 3. cancel ctx 讓 ctx-aware 路徑也能退出
      ctxCancel()
  }
  release, conflict := gate.AcquireWithCanceller(
      clientID, fileKey, TransportTCP, canceller,
  )
  if conflict != nil { ... }
  defer release()
  ```
  完成 / 錯誤 / 連線中斷都在 defer 中呼叫 `release()`。

- **HTTP handler（`internal/api/handlers_upload.go`）**：
  ```go
  ctx, ctxCancel := context.WithCancel(r.Context())
  canceller := func() {
      _ = r.Body.Close()   // 中斷 blocking Body.Read
      ctxCancel()
  }
  release, conflict := gate.AcquireWithCanceller(
      clientID, fileKey, TransportHTTP, canceller,
  )
  ```

- 兩條 handler 在 stream 的每個 chunk / 完成後**都呼叫** `gate.Touch(clientId)`，推進 `LastProgressAt`；Touch 是 O(1) 操作，不會成為 hot path 瓶頸。

**一致原則**：`AcquireWithCanceller` 的 `cancel func()` 絕不能只傳 `context.CancelFunc`；**一定**要帶「關底層 IO 資源」的動作（HTTP 是 `r.Body.Close()`，TCP 是 `SetReadDeadline(time.Now()) + c.conn.Close()`）。否則 `PruneStale` 呼叫 canceller 對真的卡在 syscall 的 goroutine 沒效果，gate 會卡到 force evict grace period 才釋放。
- 命中衝突時回 `409 {"status":"concurrent_transfer","via":"tcp|http","fileKey":"..."}`，方便 iOS 分流處理。
- `BackgroundTransferTracker` 繼續負責 HTTP progress/currentFile；`TransferGate` 只負責同 client 串行互斥。
- `handleDashboardDevices` / `handleTransferActive` 的狀態推導改成「`TransferGate.ActiveForClient(...)` 或 background tracker 任一存在」就視為 `transferring`，不再只依賴 presence 推導的 `state == "syncing"`。

**Instance 注入 wiring**（TCP 和 HTTP 必須拿到**同一個** `*TransferGate` instance，否則互斥失效）：

```go
// cmd/syncflow-sidecar/main.go
func main() {
    ...
    // 建立單一 gate instance
    gate := transferstate.NewGate()

    // 注入 api Server（HTTP 端用）
    apiSrv := api.NewServer(api.Config{
        Store:            store,
        BackgroundTracker: backgroundTransfers,
        TransferGate:     gate,   // 新增欄位
        ...
    })

    // 注入 TCP server / handler（TCP 端用同一個 instance）
    tcpSrv := server.NewTCPServer(server.Config{
        Store:        store,
        TransferGate: gate,       // 新增欄位
        ...
    })
    ...
}
```

**對應變更**：

- `internal/api.Server` struct 新增 `transferGate *transferstate.TransferGate`，`NewServer` 建構子新增對應參數
- `internal/server`（TCP 接收端）的 Server / Handler 結構也新增 `transferGate *transferstate.TransferGate`
- 兩邊的 acquire/release 都必須使用注入的 instance，**禁止**各自 `transferstate.NewGate()` 建立新的（會導致互斥無效）
- 單元測試用 `transferstate.NewGate()` 建 mock 時，要把同一個 instance 同時傳給 api handler 測試與 TCP handler 測試

**Stale 策略**（若 handler 卡在 Read / 死鎖 / 異常時避免永久擋住同 client）：

`BackgroundTransferTracker` 有 10 分鐘 inactivity prune，但那只清 progress 項目；若 `TransferGate` 不配對 prune，gate 會永遠擋住同 client 後續 transfer，dashboard 也會卡在 `transferring`。

**為什麼不能用 `context.WithTimeout` 包整個 upload**（Go 的陷阱）：

- `context.WithTimeout` 只會讓 `ctx.Done()` 觸發；**不會自動中斷**正在 blocking 的 `r.Body.Read()`。`net/http` 的 body reader 綁在底層 TCP connection，ctx 不會傳進 syscall 層級
- 必須**顯式** `r.Body.Close()` 或關閉底層 connection 才能讓 blocking Read 回傳 error
- 設「整個 upload 8 分鐘硬 timeout」對慢 Wi-Fi 上 4K 大影片太緊（iPhone Wi-Fi 在 2.4GHz 干擾下可能 <10Mbps，1GB 影片需要 >13 分鐘）

**改用 inactivity timeout（每讀到 chunk 就 reset 計時）+ `time.AfterFunc` 避免 goroutine race**：

規則：

- **不用** `time.NewTimer + go func() { <-timer.C }` 寫法，因為：
  - `timer.Stop()` 回 `false` 表示 timer 已 fire 或已 stop — 此時 channel 可能還沒被消費，goroutine 還在 `<-timer.C` 等 → 正常退出路徑呼叫 `Stop()` 無法喚醒 goroutine，leak
  - `timer.Reset()` 在 timer 已 fire 但 channel 未 drain 時也有 race（Go 1.23 前的典型陷阱；見 `time.Timer` doc 的 Reset 注意事項）
- **用** `time.AfterFunc(d, f)` — f 在 timer fire 時由 runtime 啟動新 goroutine 執行；handler 持有 `*time.Timer` 可用 `Stop()` 冪等取消；不用自己維護 goroutine 生命週期
- 無論 fire 或 Stop，都**不會 leak**：f 要嘛被呼叫一次、要嘛被 Stop 取消
- `Reset(d)` 的競態處理：對 AfterFunc timer，Go 1.23+ 可直接 `Reset(d)` 不需先 Stop；Go < 1.23 必須先 `Stop()` 檢查回傳；本 plan 以 Go 1.23+ 為準（若 repo 鎖舊版再補 `if !t.Stop() { /* 已 fire，視為 cancelled */ }` 分支）

程式片段：

```go
// handler 起頭建立 canceller（同時關 body + cancel ctx）
ctx, ctxCancel := context.WithCancel(r.Context())
canceller := func() {
    _ = r.Body.Close()  // 中斷 blocking Read
    ctxCancel()
}

// 建 AfterFunc timer；fire 時自動關 body 讓 Read 退出
inactivityTimer := time.AfterFunc(uploadInactivityTimeout, canceller)
defer inactivityTimer.Stop()  // 正常完成 / 錯誤退出都冪等取消，無 leak 風險

// 每 chunk 成功後；不要用 io.ReadFull，避免 final partial chunk 被誤判
n, err := bodyReader.Read(buf)
// ...
inactivityTimer.Reset(uploadInactivityTimeout)  // Go 1.23+ 直接 Reset 安全
gate.Touch(clientId)
```

- Blocking `Read` 被 `Body.Close()` 中斷 → 回 error → handler 走 Phase 1.2 step 12 的分類邏輯（見下方 #4 的錯誤分類修正）→ defer `release()`
- defer `inactivityTimer.Stop()` 冪等：正常完成、panic、ctx cancel 都不 leak

**關鍵不變量**：`uploadInactivityTimeout` **必須嚴格小於** `transferGateStaleAfter`。理由：

- 若 `uploadInactivityTimeout > transferGateStaleAfter`（例如 15m vs 10m），gate 被 prune 後有一段窗口（5 分鐘）gate 空閒但舊 handler 還沒 inactivity timeout → 新 `AcquireWithCanceller` 會成功進來，舊 handler 之後若 `Read` 又讀到 bytes 就會**並發寫同一 fileKey 的 `.part` 與 DB**，造成資料損毀
- 必須讓 handler **先** 主動失敗、先 `release()`；gate prune 只當**最後一道兜底**，處理 handler 完全死掉（panic 未被 recover、kernel 卡死、debugger attached）的漏網狀態

**TransferGate 的 `cancel` 也要關 body**：

`AcquireWithCanceller` 的 `cancel func()` 參數原本設計是 `context.CancelFunc`，但 ctx cancel 不中斷 blocking Read。實際傳入的 closure 必須同時關 body：

```go
ctx, ctxCancel := context.WithCancel(r.Context())
defer ctxCancel()

canceller := func() {
    _ = r.Body.Close()  // 中斷 blocking Read
    ctxCancel()          // 清理 ctx 監聽者
}
release, conflict := gate.AcquireWithCanceller(
    clientID, fileKey, TransportHTTP, canceller,
)
if conflict != nil { ... }
defer release()
```

這讓 `PruneStale` 呼叫 canceller 時能真正中斷 handler，不是只發一個 ctx 訊號期待 handler 自己輪詢。

規則：

- `AcquireWithCanceller` 設 `StartedAt = now`、`LastProgressAt = now`；登記的 `cancel` **必須同時關 body + cancel ctx**
- 每次 `Touch(clientId)` 更新 `LastProgressAt = now`（成本低，可每個 chunk 呼叫）
- `PruneStale(now)` **不直接刪除 entry**：
  1. 先呼叫該 entry 註冊的 `cancel()`（關 body → 觸發 `Read` error → handler 走「500 body_read_error」分支，在 defer 裡 `release()`）
  2. 標記 entry 為 `pendingRelease`，設一個 short grace period（`transferGatePruneGracePeriod`）等 handler 退出
  3. 若 grace period 過了 handler 仍未 release（真的死了），**此時**才強制移除 entry，寫 diagnostics log `transfer_gate_force_evicted`
  4. 正常 cancel 路徑走完後 log `transfer_gate_cancelled_by_prune`
- Prune 完成（不論 normal cancel 或 force evict）必須觸發 `device.state.changed` 廣播（與 tracker prune 對稱），state 依既有推導器重算
- 同一 sweep 週期內應**先** prune tracker 再 prune gate（避免 gate 被清但 tracker 還在顯示 transferring 的短暫不一致）

**對應 Tunable constants**（sidecar 側；**注意大小關係 `uploadInactivityTimeout < transferGateStaleAfter`**）：

| 常數 | 值 | 用途 |
|-----|----|------|
| `uploadInactivityTimeout` | `3 * time.Minute` | 連續 N 秒沒有新 bytes 就關 body；3 分鐘對 LAN 正常網路充裕（即使 1Mbps 也能每 3 分鐘傳 ~22MB），對真正卡死的連線夠快放手 |
| `transferGateStaleAfter` | `10 * time.Minute` | Gate prune threshold；**必須大於** `uploadInactivityTimeout`，讓 handler 有機會先因 inactivity timeout 自我失敗 |
| `transferGatePruneGracePeriod` | `30 * time.Second` | `PruneStale` 呼叫 cancel 後等 handler 自己 release 的寬限期 |
| `transferGateSweepInterval` | `1 * time.Minute` | 與 `backgroundTransferSweepInterval` 對齊 |

（舊常數 `httpUploadReadTimeout = 8m` 已移除 — 整體 upload 不設硬 deadline，交給 inactivity timeout + gate prune 雙層兜底。）

### 1.4 註冊路由

**檔案**: `services/sidecar-go/internal/api/router.go`

在 Transfer state 區塊之前新增兩條 route：

```go
// Background upload (iOS URLSession)
mux.HandleFunc("POST /upload/{clientId}", srv.handleUpload)

// 跨協定 ownership reset（Phase 3.7）：TCP 接手曾被 HTTP 碰過的 fileKey 前呼叫
mux.HandleFunc("DELETE /upload/{clientId}/{fileKey}", srv.handleUploadReset)
```

`handleUploadReset` 規格：

**Headers**（精簡，不需要 POST 的 filename/mediaType/fileSize/bodySha256）：

| Header | 必填 | 說明 |
|--------|------|------|
| `X-SyncFlow-File-Key` | 是 | 必須等於 path param `{fileKey}`；不一致回 `400 {"status":"filekey_mismatch"}` |
| `X-SyncFlow-Auth` | 是 | HMAC over DELETE canonical string |
| `X-SyncFlow-Auth-Timestamp` | 是 | Unix seconds |
| `X-SyncFlow-Auth-Nonce` | 是 | Nonce（與 POST 共用同一 LRU） |

**Path + header fileKey 綁定**：

- handler 首先驗證 `pathFileKey == headerFileKey`，不符 `400 filekey_mismatch`（防止 HMAC 對 A 卻刪 B 的走私攻擊）
- `fileKey` 格式驗證：`^[0-9a-f]{64}$`（iOS `PhotoScanner.computeFileKey` 產出 SHA256 hex）；不符回 `400 {"status":"invalid_file_key"}`。此驗證**兩個 endpoint（POST + DELETE）都要做**

**DELETE canonical string**（獨立定義，不沿用 POST）：

```
method\n           ← "DELETE"（大寫 ASCII）
path\n             ← "/upload/<clientId>/<fileKey>"
clientId\n
fileKey\n
timestamp\n
nonce
```

HMAC key 編碼規則同 POST（`SHA256(pairingToken)` 的 raw 32 bytes）。換行字元 `0x0A`。

理由：DELETE 不帶 body、不搬 metadata，保持 canonical 精簡；fileKey 同時在 path 和 canonical 裡，是主要的「要刪哪個」承諾。

**語意（重要：DELETE 不得 release 別人的 gate）**：

1. 驗 auth / path match / fileKey 格式
2. **fileKey owner 檢查**（與 POST 相同的 security 防線）：查 `store.GetUpload(fileKey)`；若 row 存在且 `row.client_id != path.clientId`，回 `403 {"status":"file_key_owner_mismatch","fileKey":"..."}`，不得繼續。防止 client A 用自己的 pairingToken DELETE client B 擁有的 file
3. 查 `TransferGate.ActiveForClient(clientId)`：
   - 若 **active transfer 存在且該 fileKey 正在傳**（不論 TCP 或 HTTP）：回 `409 {"status":"concurrent_transfer","via":"tcp|http","fileKey":"..."}`；**不清任何東西**、**不呼叫 release**。`release()` 是 `AcquireWithCanceller` 返回給**持有者**的 closure，DELETE endpoint 不是持有者，強制 release 會讓正在傳的 transfer 被第三方砸掉
   - 若 active transfer 存在但是**不同 fileKey**：也回 `409 concurrent_transfer`；caller 必須等那條 transfer 完成才 retry（避免 DELETE 操作期間同 client 其他 fileKey 狀態不穩）
   - 若**無 active transfer**：繼續 step 4
4. 呼叫 idempotent reset（**sidecar 側只動 sidecar 的 state**，不需要也不知道 iOS 的 `requires_remote_reset` 欄位）；**必須先記錄 reset 前狀態，再執行 reset**，避免 reset 後才查狀態導致永遠只看到 clean state：
   - `hadPart := part file existed before removal`
   - `previousCommittedBytes := uploads.committed_bytes before ResetUploadBytes`（row 不存在則視為 0）
   - `DiscardPartialIfExists(clientId, fileKey)` — 刪 `.part`，忽略 `ErrNotExist`
   - `ResetUploadBytes(fileKey)` — `uploads.committed_bytes = 0`、`part_path = ''`（見 Phase 1.2 step 7 的 patch SQL）
   - `backgroundTransfers.Finish(clientId: clientId, fileKey: fileKey, reason: "reset_by_client")` — 若 tracker 裡有對應項則清掉；簽名與 Phase 1.3 定義一致
5. 結果：
   - 實際清掉了 remote partial state（`hadPart == true` **或** `previousCommittedBytes > 0`）→ `200 {"status":"reset","fileKey":"..."}`
   - **沒有 remote partial state 可清**（**擴展定義**，與 Phase 1.2 step 13 的 `ResetUploadAfterHTTPError` 保留 row 邏輯對齊）：
     - `uploads` 無此 fileKey **或**
     - `uploads` row 存在但 `previousCommittedBytes == 0` 且 `hadPart == false`（例如 HTTP error 後走 `ResetUploadAfterHTTPError` 已 patch 過、或 sidecar 從未收到 byte）
     - → 一律回 `404 {"status":"not_found","fileKey":"..."}`（caller 視同成功，mobile 清 `requires_remote_reset = 0`）
   - 理由：上一輪把「HTTP error 後刪 row」改成「patch-style reset 保留 row」是為了 owner 防線；但這讓「沒 partial 可清」的判斷不能再靠「row 不存在」。**第二次 DELETE**、**error-reset 後再 DELETE** 等情境都會落在「row 存在但 committed_bytes=0」狀態，若仍按舊條件（row 必須不存在才 404）會讓 DELETE 回 200 reset — 雖然無副作用，但語義上混淆「真的清了東西」vs「本來就沒東西」。用統一的 404 表達「state 已乾淨、沒事可做」

**iOS 側**（`requires_remote_reset` 是 iOS `upload_items` 的欄位，sidecar 不知其存在）：收到 sidecar 回 `200 reset` 或 `404 not_found` 後，由 mobile 自己 `UploadStore.setRequiresRemoteReset(fileKey: false)` 清本地 flag，見 Phase 3.7 的 `connectAndUpload()` 預檢流程。

POST 和 DELETE 路由都不加 `withJSON`，且不得放在任何會讀取或重寫 request body 的 middleware 後面。現有 `withLogging(mux)` 可保留；若後續新增 CORS、rate limit、panic recover，必須確認它們不會 pre-read 二進位 body。

**POST 也要加 fileKey 格式驗證**：Phase 1.2 Handler 流程 step 2（解析並驗證必要 headers）補充一項：`X-SyncFlow-File-Key` 必須符合 `^[0-9a-f]{64}$`，不符回 `400 invalid_file_key`。

### 1.5 驗證

- `go build ./...` 編譯通過
- `go test ./internal/api/...` 測試通過
- 用 `curl` 手動測試（**clientId 必須是已配對的 ASCII-safe 值**；**fileKey 必須是 64 字元小寫 hex**，否則會被 Phase 1.2 step 2 的格式驗證拒絕回 `400 invalid_file_key`）：
  ```bash
  # 產生合法 fileKey（正式流程由 iOS PhotoScanner.computeFileKey 產生；這裡僅示範）
  FILEKEY=$(echo -n "test-client|asset-id|image" | shasum -a 256 | cut -d' ' -f1)
  BODY_SHA256=$(shasum -a 256 test-file.jpg | cut -d' ' -f1)

  curl -X POST http://localhost:39394/upload/test-client \
    -H "X-SyncFlow-File-Key: $FILEKEY" \
    -H "X-SyncFlow-Filename-B64: dGVzdC5qcGc=" \
    -H "X-SyncFlow-Media-Type: image" \
    -H "X-SyncFlow-File-Size: 1024" \
    -H "X-SyncFlow-SHA256: $BODY_SHA256" \
    -H "X-SyncFlow-Auth: <hmac-over-canonical>" \
    -H "X-SyncFlow-Auth-Timestamp: $(date +%s)" \
    -H "X-SyncFlow-Auth-Nonce: $(openssl rand -hex 16)" \
    --data-binary @test-file.jpg
  ```

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
    private var pendingDelegateWorkCount = 0
    private var didFinishEventsWhileWorkPending = false
    private let lock = NSLock()

    weak var uploadStore: UploadStore?
    weak var historyStore: HistoryLedgerStore?
    weak var bindingService: BindingService?
    weak var exportService: AssetExportService?
}
```

`task.taskDescription` 必須存 structured identity，而不是只存 `fileKey`：

```swift
struct BackgroundUploadTaskIdentity: Codable {
    let schemaVersion: Int      // 1
    let serverId: String
    let clientId: String
    let fileKey: String
    let bindingVersion: Int?    // 若 BindingService 已有 version / generation，帶上；沒有可 nil
}
```

理由：同一支手機可能曾配對多台 desktop。只用 `fileKey` 無法判斷 recovered task 屬於哪個 server；舊 binding 的 `waitingForConnectivity` task 不能永遠阻塞目前 binding。

**前置型別驗證**：`weak var` 要求被引用者為 class / AnyObject。實作前已驗證：

- `UploadStore`（`class UploadStore`，UploadStore.swift:74）✓
- `HistoryLedgerStore`（`class HistoryLedgerStore`，HistoryLedgerStore.swift:3）✓
- `BindingService`（`class BindingService`，BindingService.swift:4）✓
- `AssetExportService`（`class AssetExportService`，AssetExportService.swift:4）✓

若後續任一型別被重構為 `struct` / `actor`，對應 `weak var` 必須改為 `unowned` 或 strong 引用 + 明確 teardown。

注意：

- `BackgroundUploadService` 不依賴長期保存在記憶體裡的 `sidecarHost` / `clientId` / `pairingToken`。
- app 被 iOS kill 後只因 URLSession event 重啟時，記憶體狀態會重建；service 必須能從 `UploadStore.getLastKnownBinding()` 與 Keychain 重新取得目前 binding（見 Phase 4.3）。
- pairing token 是 per-server：目前正式路徑使用 `binding.pairingTokenKeychainRef`，legacy 單一 `syncflow_pairing_token` 只能作 fallback。排背景 task 時必須傳入 binding 或 serverId，不能只傳 `sidecarHost`。

**核心方法**：

1. **`reconnectBackgroundSession()`** — 建立 `URLSessionConfiguration.background(withIdentifier:)`，設定 `isDiscretionary = false`、`sessionSendsLaunchEvents = true`，delegate 指向 `self`

2. **`enqueueNextPendingFileIfIdle(binding:clientId:allowPreparation:) async -> EnqueueResult`** — 背景轉換核心：
   - 先呼叫 `backgroundSession.getAllTasks()` 並解析 `BackgroundUploadTaskIdentity`：
     - 若已有未完成 task 且 `serverId/clientId` 與目前 binding 相同（含 `waitingForConnectivity` 狀態），直接返回 `.activeTaskExists`。長期斷網時由 URLSession 自動重試，不由本層主動取消
     - 若 task identity 缺失、無法 decode、或 `serverId/clientId` 與目前 binding 不同：呼叫 `task.cancel()`；**不得只靠 `fileKey` 回寫 local row**。缺失 / decode 失敗 / binding 不符時寫 diagnostics `stale_background_task_cancelled` 並附 reason。只有在 task identity 可 decode，且 `UploadStore.backgroundTaskIdentityMatches(fileKey:identity:) == true` 時，才可把該 local item compare-and-reset 為 `transport=NULL`、`status='queued'`、`acked_offset=0`、保留 `requires_remote_reset=1`，並 compare-and-clear `background_task_*` 欄位；若 identity 可 decode 但 local row 不匹配，寫 `stale_background_task_cancelled_without_local_match`。舊 binding task 不得阻塞目前 binding，也不得污染目前 binding 的 queue/history
   - `binding` 必須包含目前 desktop 的 `deviceId`、`host`、`port`、`pairingTokenKeychainRef`；缺 binding 回 `.missingBinding`，缺 host 回 `.missingHost`，缺 token 回 `.missingPairingToken`，不得建立 task
   - 呼叫 `UploadStore.getBackgroundHTTPQueueHead()`（見 Phase 4.3）取 queue head；該方法以 `transport` 欄位排除 TCP-held 項目，無需在 service 層再重判斷 ownership
   - 若 queue head 是 `cloud_downloading`，不在背景中主動觸發 iCloud 匯出；返回 `.queueHeadNotReady`，交由下次 foreground / BG task 再處理
   - 若已有 `temp_file_path`、檔案存在、且 `http_body_sha256` / `http_body_size` 與檔案大小一致 → 直接用
   - 若缺 temp 檔或 hash：
     - `allowPreparation == false`（`appDidEnterBackground` 轉場 fast path）→ 回 `.queueHeadNeedsPreparation`，不做 export / SHA256，避免 30s background task 被大檔準備工作耗盡
     - `allowPreparation == true`（BGProcessing / foreground 預備路徑）→ 匯出單一檔案並計算 SHA256，寫入 `temp_file_path`、`http_body_sha256`、`http_body_size`
   - 背景 HTTP request 的 `X-SyncFlow-SHA256` 必須使用 `http_body_sha256`，不得在建立 request 當下臨時計算大檔 hash
   - 建立 `BackgroundUploadTaskIdentity(serverId: binding.deviceId, clientId, fileKey, bindingVersion)`；`serverId` 若實作改用其他 stable server key，必須與 taskDescription / local row 欄位同源
   - 在同一個 UploadStore transaction 內把 `transport` 欄位 set 為 `'http'`、`status = 'uploading'`、`requires_remote_reset = 1`、`acked_offset = 0`，並寫入 `background_task_server_id` / `background_task_client_id` / `background_task_binding_version`；HTTP 接手即放棄舊 TCP resume，後續失敗也從 0 全檔重傳
   - 上述 local row 標記與 identity 持久化必須在 `task.resume()` 前完成；若 URLSession task 建立或 `task.taskDescription` 設定失敗，必須用同一份 identity compare-and-reset / compare-and-clear local row，避免留下假 active HTTP row
   - 若此檔曾由 TCP 傳到半途（`acked_offset > 0`），不保留舊值；開發版不做跨協定 partial 相容，避免 mobile offset 與 sidecar `.part` ownership 分裂
   - `requires_remote_reset = 1` 是**持久化**承諾：即使 app 在 POST 送出前 crash，下次 foreground TCP 接手同一 fileKey 時仍會看到此 flag 並先發 DELETE（見 Phase 3.7）
   - 建立 `URLRequest` → `POST http://<host>:39394/upload/<clientId>`，metadata 放 headers，filename 使用 base64 header，auth 使用 HMAC headers，不傳 raw `pairingToken`
   - 呼叫 `backgroundSession.uploadTask(with:request, fromFile:tempURL)`
   - 設定 `task.taskDescription = JSON(BackgroundUploadTaskIdentity)`；delegate / reconnect / diagnostics 都從這裡取 `serverId/clientId/fileKey`，且內容必須與 local row 的 `background_task_*` 欄位一致
   - `task.resume()`
   - 回傳 `.enqueued`

`EnqueueResult` 至少區分：

- `.enqueued`
- `.activeTaskExists`
- `.emptyQueue`
- `.queueHeadNotReady`
- `.missingBinding`
- `.missingHost`
- `.missingPairingToken`
- `.exportFailed`
- `.queueHeadNeedsPreparation`
- `.staleTaskCancelled`

3. **`hasActiveTask() async -> Bool`** — 供 foreground / BG task 判斷目前是否已有背景 HTTP 上傳在跑

4. **`handleEventsForBackgroundURLSession(identifier:completionHandler:)`** — 儲存 completionHandler，重連 session

5. **`cleanupTempFile(fileKey:identity:)`** — 先用 `fileKey + BackgroundUploadTaskIdentity` compare 讀取並清除 UploadStore 的 `temp_file_path` / `http_body_sha256` / `http_body_size`，再刪磁碟檔；若 compare 失敗不得刪檔或清欄位，避免舊 task 刪掉目前 binding / 目前 task 的 temp 指標

6. **`requestForegroundResumeAfterBackgroundTask()`** — 記錄「回到前景後應恢復 TCP pipeline」，但不主動取消正在跑的背景上傳

7. **`configureBackgroundUploadService(...)`** — 由 `SyncEngineManager` 在初始化 store 後注入 `UploadStore`、`HistoryLedgerStore`、`BindingService`、`AssetExportService`；命名與 Phase 5 `AppDelegate` 呼叫端一致；不要從 `AppDelegate` 直接讀 `SyncEngineManager.uploadStore` private 屬性；方法必須可重複呼叫（URLSession background relaunch 時會再次觸發）

**URLSession delegate 方法**：

**所有 delegate 入口的 identity gate（硬性）**：

每個會讀寫 `UploadStore` / `HistoryLedgerStore` / queue 狀態的 delegate callback，都必須先從 `task.taskDescription` decode `BackgroundUploadTaskIdentity`，再與目前 binding 比對。比對來源順序：

1. `SyncEngineManager.shared.currentBinding`（若已 hydrate）
2. `UploadStore.getLastKnownBinding()`（URLSession cold relaunch 時的 fallback）
3. 若兩者都不可得，視為「無法驗證 binding」，不得改 `upload_items` / history，只寫 diagnostics 並等待 foreground / BGProcessing 重建狀態

判斷規則：

- `identity.serverId == binding.deviceId`（或 plan 實作中選定的 stable server key；必須與 enqueue 寫入的欄位同源）
- `identity.clientId == BindingService.getClientId()`
- `identity.fileKey` 必須存在於本地 `upload_items`
- `UploadStore.backgroundTaskIdentityMatches(fileKey: identity.fileKey, identity: identity)` 必須為 true；這是 row-level guard，避免舊 binding task 只因同一個 `fileKey` 命中目前 binding 的 local row

若 identity 缺失、decode 失敗、binding 不符、本地查不到 fileKey、或 local row 的 `background_task_*` 不符：

- `didSendBodyData`：忽略 progress，不更新 `acked_offset`
- `didReceive data`：可丟棄 response chunk 或只做 16 KB 上限保護，但不得建立會驅動本地狀態的 response buffer
- `didCompleteWithError`：只清 `responseDataByTaskId` / `oversizedTaskIds`，寫 diagnostics `stale_background_task_completion_ignored`，不得更新 `status`、`transport`、`requires_remote_reset`、`background_task_*`、`HistoryLedgerStore` 或續排下一檔

理由：同一支手機可能曾配對多台 desktop，而 `upload_items` 目前不是 per-server table；舊 binding 的 URLSession task 即使後來成功/失敗，也不能污染目前 binding 的本地 queue。

- `urlSession(_:task:didSendBodyData:totalBytesSent:totalBytesExpectedToSend:)` — 通過 identity gate 後，更新 `uploadStore.updateUploadOffset(fileKey:offset:)` 作為 UI progress；當 `transport='http'` 時，`acked_offset` **不具 TCP resume 語意**，僅表示本輪 HTTP 已送出 bytes
- `urlSession(_:dataTask:didReceive:)` — 累積回應 body（用於解析 JSON）。**body 上限 16 KB** 具體處理：
  ```swift
  guard isTaskForCurrentBinding(dataTask) else {
      noteIgnoredStaleTask(dataTask, reason: "didReceive")
      return
  }
  lock.lock()
  defer { lock.unlock() }
  let taskId = dataTask.taskIdentifier
  let existing = responseDataByTaskId[taskId]?.count ?? 0
  if existing + data.count > uploadMaxResponseBodyBytes {
      // 超限：清累積器、黑名單此 task、主動取消
      responseDataByTaskId.removeValue(forKey: taskId)
      oversizedTaskIds.insert(taskId)
      dataTask.cancel()
      return
  }
  responseDataByTaskId[taskId, default: Data()].append(data)
  ```
  - 新增成員 `private var oversizedTaskIds: Set<Int> = []`（用 `lock` 保護）
  - `task.cancel()` 觸發 `didCompleteWithError:` 帶 `URLError.cancelled`；該分支通過 identity gate 後檢查 `oversizedTaskIds.contains(taskId)`，若是則走「`response_body_too_large` → `status=queued`、`transport=nil`、`acked_offset=0`」等同一般 5xx 處理
  - task 結束後（成功或失敗）清 `oversizedTaskIds.remove(taskId)` 與 `responseDataByTaskId.removeValue(forKey: taskId)`，避免 leak
  - 理由：sidecar 只回小型 JSON（≤ 幾百 byte），16 KB 是寬鬆上限；累積超過一定是異常（被中間人注入、sidecar bug），拒絕累積避免 relaunch 模式下 iOS 把大 response 寫磁碟
- `urlSession(_:task:didCompleteWithError:)` — 核心完成回調，負責把 HTTP 結果收斂回 queue / history；此處**不再**作 ownership reset，因為 reset 已在 enqueue HTTP task 前完成：
  - **前置 guard**：先 decode `BackgroundUploadTaskIdentity` 並通過 identity gate；未通過時只清 task-local buffers + diagnostics，不得進入下列任何狀態分支
  - 通過 guard 後，所有會改 `status` / `transport` / `requires_remote_reset` / temp/hash / history 的分支都必須以同一份 identity 做 row-level compare；DB state transition、prepared temp/hash 清理與 `clearBackgroundTaskIdentity(fileKey:identity:)` 必須在同一個 transaction 中完成。若 compare 條件 affected rows = 0，代表 local row 已被新 binding / 新 task 接手，當前 completion 必須停止 queue/history mutation 並寫 diagnostics
  - **200 completed**：解析 JSON → `updateUploadStatus(fileKey, "completed")` → `updateTransport(fileKey, nil)` → `setRequiresRemoteReset(fileKey, false)` → `cleanupTempFile(fileKey:identity:)` → 用 `ledgerDate` / `activeTransmissionMs` 更新 `HistoryLedgerStore` / `daily_ledgers` → emit events
  - **409 already_completed**：視同成功去重 → `updateUploadStatus(fileKey, "completed")` → `updateTransport(fileKey, nil)` → `setRequiresRemoteReset(fileKey, false)` → `cleanupTempFile(fileKey:identity:)`，**不得**回 `queued`。若 body 含 `ledgerDate` / `activeTransmissionMs` 必須補寫 history
  - **409 concurrent_transfer**：代表 sidecar 偵測到同 clientId 有 active TCP/HTTP transfer；本地 `status` 回 `queued`、`transport = nil`、`acked_offset = 0`，**保留** `requires_remote_reset = 1`（sidecar 那邊有東西在跑，下次接手仍要 reset），保留 `temp_file_path` 供下次 HTTP / foreground 全量重傳
  - **401 retryable auth stale（`auth_timestamp_out_of_window` / `auth_nonce_replay`）**：
    - 這代表 background `URLSession` 延後送出或自動重送舊 request，不代表 pairing token 壞掉
    - `updateTransport(fileKey, nil)`、`status` 回 `queued`、`acked_offset = 0`、保留 `requires_remote_reset = 1`、保留 `temp_file_path` / `http_body_sha256`
    - 不設定 `needsRepair`；若 app 仍在背景且 binding 已 hydrate，可重新 enqueue 建立 fresh timestamp + fresh nonce；若在冷啟動狀態，等 foreground / BGProcessing 再重建 task
  - **repair-required auth failure（401 `auth_invalid_signature` / `auth_revoked_device`，或 POST 404 `unknown_client` / `device_not_paired`）**：
    - `UploadStore.setNeedsRepair(true, reason: "background_http_auth_failed")`（新增方法，見 Phase 4.3）
    - `updateTransport(fileKey, nil)`、`status` 回 `queued`、`acked_offset = 0`、保留 `requires_remote_reset = 1`
    - 停止為該 `clientId` 續排新的 background task，避免在 foreground 回來之前耗盡 BGProcessing quota
    - `appWillEnterForeground` 時 `SyncEngineManager` 讀 `needsRepair` flag，轉成 UI banner（「與 XXX 的配對已失效，請重新掃描連接碼」），並 disable 自動上傳直到使用者重新配對或清除
    - 使用者完成 re-pair（`BindingService` 寫新 token）時清除 `needsRepair`；未清除前 foreground TCP 也不應主動觸發上傳（避免持續 401 打 sidecar 退避計數器）
  - **403 file_key_owner_mismatch**：fatal data-integrity error，不得回 `queued` 重試。`updateTransport(fileKey, nil)`、`acked_offset = 0`、`status = 'failed'`、記錄 diagnostics（含 local fileKey / clientId / binding serverId，但不記 pairing token）；透過 `cleanupTempFile(fileKey:identity:)` 清 `temp_file_path` 與本地 tempURL，停止此 item 的背景續排。`requires_remote_reset` 可清為 0，因為問題不是 sidecar partial 殘留，而是 fileKey owner 衝突；重試只會再次 403
  - **404 / 4xx（非 401 / 403 / 409，且非 POST unknown client）**：`updateTransport(fileKey, nil)`，`status` 回 `queued`，`acked_offset = 0`；**保留** `requires_remote_reset = 1`（sidecar 不知狀態，下次 TCP 接手必須 DELETE）；foreground TCP 若接手也必須從 0 全檔重傳
  - **5xx / URLError / 網路中斷**：`updateTransport(fileKey, nil)`，`status` 回 `queued`，`acked_offset = 0`，**保留** `requires_remote_reset = 1`，保留 `temp_file_path`；等 foreground 或下一次 BG task 從 0 重試
  - **422 file_size_mismatch / body_hash_mismatch / body_too_large**：本次 upload body 本身有問題 → `updateTransport(fileKey, nil)`、`status` 回 `queued`、`acked_offset = 0`、**保留** `requires_remote_reset = 1`（sidecar 已收到 / 正在收 body，下次接手必須 DELETE 清）、透過 `cleanupTempFile(fileKey:identity:)` **清掉** `temp_file_path` 與本地 tempURL（檔案內容可能已變）；連續 N 次 422 → `status = 'failed'`，避免死循環
  - 若 app 已在 foreground 且 `requestForegroundResumeAfterBackgroundTask()` 已設置：當前背景檔案完成後**不要再排下一個 background task**，改為恢復 foreground TCP pipeline
  - 只有在 app 仍處於背景、未要求 foreground resume、且 binding/host/token 已 hydrate 時，才再次呼叫 `enqueueNextPendingFileIfIdle(...)`，讓背景模式保持**單檔串行但可接續下一檔**
  - 如果 app 是被 URLSession event 冷啟動，而 `sidecarHost` / binding 尚未恢復，完成當前 task 後不要續排下一檔；等待 foreground 或 BGProcessing 重新 hydrate 後再處理
- `urlSessionDidFinishEvents(forBackgroundURLSession:)` — 不可直接呼叫已儲存的 `completionHandler()`；必須先進入下方 drain gate

**Background URLSession completion handler drain gate（硬性）**：

iOS 會在 background URLSession events 送達後要求 app 盡快呼叫 `completionHandler`。但「盡快」不能早於本地狀態落盤，否則系統可在 DB/history 更新前 suspend app，造成 remote 已完成但 mobile queue/history 未收斂。

實作規則：

1. 每個 `didCompleteWithError` 開始處呼叫 `beginDelegateWork(taskId)`；所有分支（成功、失敗、stale identity、parse error）都必須在 `defer` 裡呼叫 `finishDelegateWork(taskId)`。
2. 若完成分支需要 `Task {}` 執行 async 續排或 history 補寫，`finishDelegateWork` 必須等該 async work 完成後才呼叫；不得在 `Task` 建立後立刻 decrement。
3. `urlSessionDidFinishEvents(forBackgroundURLSession:)` 只設定 `didFinishEventsWhileWorkPending = true`，然後呼叫 `tryFlushBackgroundCompletionHandler()`.
4. `tryFlushBackgroundCompletionHandler()` 只有在 `pendingDelegateWorkCount == 0` 且 `didFinishEventsWhileWorkPending == true` 時才取出並呼叫 `pendingCompletionHandler`；呼叫後清 flag，確保 handler 只呼叫一次。
5. 若 identity gate 判斷 stale task，仍要算作一個 delegate work：清 buffer、寫 diagnostics 後再 decrement，避免 completion handler 在 cleanup 前被呼叫。

簡化 pseudocode：

```swift
private func beginDelegateWork() {
    lock.lock()
    pendingDelegateWorkCount += 1
    lock.unlock()
}

private func finishDelegateWork() {
    let shouldFlush: Bool
    lock.lock()
    pendingDelegateWorkCount -= 1
    shouldFlush = pendingDelegateWorkCount == 0 && didFinishEventsWhileWorkPending
    lock.unlock()
    if shouldFlush { tryFlushBackgroundCompletionHandler() }
}

func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    lock.lock()
    didFinishEventsWhileWorkPending = true
    lock.unlock()
    tryFlushBackgroundCompletionHandler()
}
```

測試必須驗證：`didFinishEvents` 先到、`didCompleteWithError` 的 async DB/history work 後完成時，completion handler 等到 work 結束才呼叫。

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

### 3.2 修改 `appDidEnterBackground()`

以函數名定位，不寫死行號；目前行號會隨 SyncEngineManager 變動而失準。

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

**同步原語（鎖死實作方式，避免歧義）**：

- 用既有 `watchLoopContinuation: CheckedContinuation<Void, Never>?` + `watchLoopContinuationLock: NSLock` 機制（SyncEngineManager.swift:228-230）
- **新增兩個 helper 封裝既有 NSLock + Continuation pattern**（Phase 3 新增，不是既有 API）：
  ```swift
  /// 註冊 continuation，由 TCP 迴圈在檔案邊界 resume。
  /// 封裝現有 NSLock pattern（SyncEngineManager.swift:874-880）。
  private func registerWatchLoopContinuation(_ cont: CheckedContinuation<Void, Never>) {
      watchLoopContinuationLock.lock()
      defer { watchLoopContinuationLock.unlock() }
      // 如已有 pending continuation，先 resume 舊的避免 leak
      if let existing = watchLoopContinuation {
          existing.resume()
      }
      watchLoopContinuation = cont
      watchLoopContinuationToken = UUID()
  }

  /// 若有 pending continuation 則 resume 並清空。
  /// 封裝現有 resume pattern（SyncEngineManager.swift:881-893）。
  private func resumeWatchLoopContinuationIfPending() {
      watchLoopContinuationLock.lock()
      defer { watchLoopContinuationLock.unlock() }
      guard let cont = watchLoopContinuation else { return }
      watchLoopContinuation = nil
      watchLoopContinuationToken = nil
      cont.resume()
  }
  ```
  若既有 code 已有類似命名（例如 `registerSyncContinuation` / `resumeContinuation`），**沿用既有命名**，不新建重複 API
- `connectAndUpload()` 的檔案迴圈**每跑完一個檔案**檢查 `isTransitioningToBackground`；若為 true，呼叫 `resumeWatchLoopContinuationIfPending()` 把控制權還給 `transitionToBackgroundUpload()`
- `transitionToBackgroundUpload()` 內部：
  ```swift
  func transitionToBackgroundUpload() async {
      beginBackgroundTransitionIfNeeded(reason: "transitionToBackgroundUpload")
      defer { endBackgroundTransitionIfNeeded() }

      // 1. 等待 TCP 迴圈抵達檔案邊界（或 timeout）
      let deadline = Date().addingTimeInterval(transitionBackgroundWaitTimeoutSeconds)
      await withTaskGroup(of: Void.self) { group in
          group.addTask {
              await withCheckedContinuation { cont in
                  // 由 TCP 迴圈在檔案邊界 resume
                  self.registerWatchLoopContinuation(cont)
              }
          }
          group.addTask {
              // 同步 poll 或 Task.sleep 作 timeout 後援
              while Date() < deadline {
                  try? await Task.sleep(
                      nanoseconds: UInt64(transitionPollIntervalMilliseconds) * 1_000_000)
                  if !self.isTCPLoopRunning { break }
              }
              self.resumeWatchLoopContinuationIfPending()
          }
          await group.next()
          group.cancelAll()
      }

      // 2. 排下一檔 HTTP background task
      let result = await backgroundUploadService
          .enqueueNextPendingFileIfIdle(
              binding: currentBinding,
              clientId: clientId,
              allowPreparation: false
          )
      NSLog("[SyncEngine] background enqueue result: \(result)")
  }
  ```
- **絕對不用** `Task.yield()` 作為主同步原語（yield 不保證 wake，且無 timeout 保護）；只在極罕見 edge case 做補強

**行為規則**：

- 不嘗試中途接手半個 TCP 檔案；若目前檔案在背景轉場視窗內來不及完成（25s），TCP socket 斷線後可留下 partial，但一旦後續 HTTP 接手同一 `fileKey`，mobile 與 sidecar 都立即放棄舊 partial，從 0 全檔重傳
- `appDidEnterBackground` 的 30s 系統視窗只走 fast path：只能排 `temp_file_path + http_body_sha256 + http_body_size` 已存在且有效的 queue head；缺預備資料時回 `.queueHeadNeedsPreparation` 並交給 BGProcessing / foreground 處理，不在此時 export 大檔或計算 SHA256
- Ownership reset 是**立即式**：
  1. mobile 在 `enqueueNextPendingFileIfIdle(...)` 中把 `transport` 標為 `'http'`、`status` 標為 `'uploading'`，並立刻 `resetUploadOffset(fileKey)`
  2. sidecar 在 `handleUpload` step 7 清舊 `.part` / `committed_bytes`，HTTP 永遠從 0 全檔 POST
- POST 失敗（5xx / 網路中斷 / 401 / 409 concurrent）後 `acked_offset` 仍維持 0；下次 HTTP 或 foreground TCP 都必須從 0 全檔重傳

### 3.3 修改 `appWillEnterForeground()`

以函數名定位，不寫死行號。

在最前面加入：
```swift
isTransitioningToBackground = false
backgroundUploadService.requestForegroundResumeAfterBackgroundTask()
```

說明：

- **不在回前景時主動取消正在執行的背景 task**
- 若已有背景 HTTP 上傳正在進行，foreground 只標記「此檔完成後恢復一般 TCP pipeline」
- 若背景 task 空閒，則立即恢復既有 foreground watch loop / TCP sync

### 3.4 修改 `connectAndUpload()` 檔案迴圈

以函數名和 `for (index, asset) in assets.enumerated()` 定位，不寫死行號。

在迴圈頂部加入中斷檢查：
```swift
for (index, asset) in assets.enumerated() {
    if isTransitioningToBackground { break }  // 只允許在檔案邊界退出
    // ... 現有邏輯
}
```

### 3.5 修改 temp file cleanup

現有的 `defer { exportService.cleanup(tempURL:) }` 需條件化：只有在該檔案已成功交給背景上傳服務並寫入 `temp_file_path` 時，才跳過 foreground cleanup。單純 `isTransitioningToBackground` 不足以判斷 ownership，避免 export 失敗或未 enqueue 時留下孤兒 temp 檔。

### 3.6 修改 init temp dir cleanup

以 `syncflow_export` cleanup 區塊定位，不寫死行號。

不再無條件清空 `syncflow_export/` 目錄。改為只清理不在 `UploadStore.temp_file_path` 中追蹤的檔案。

### 3.7 TCP 接手曾被 HTTP 碰過的 fileKey — 跨協定 reset 協議

**觸發場景**：

- 一個 fileKey 曾由 background HTTP 嘗試傳輸（enqueue 時已 set `transport='http'` + `requires_remote_reset=1` + `acked_offset=0`）
- HTTP 失敗（iOS crash、URLSession task 還沒送出就被殺、sidecar 沒收到或拒絕）→ `transport` 回 `NULL`、但 `requires_remote_reset` **保持 1**（持久化，跨 session 有效）
- 此時 sidecar 可能保有 HTTP 寫進去的**部分** `.part`，或保有更早 TCP 寫的**舊** `.part`

**風險**：foreground 回來時 TCP 選到此 fileKey，mobile 從 `acked_offset = 0` 開始傳，但 sidecar 對這個 fileKey 仍保有非零 `committed_bytes`，TCP resume 協議會用舊 offset 接收 → 資料 mismatch。

**解決方式**：`requires_remote_reset = 1` 的項目在 TCP 接手前**必須**先發 DELETE；flag 由持久化欄位承載，跨 app kill / relaunch 仍有效。

**`connectAndUpload()` 選到 queue head 後**：

```swift
guard let head = uploadStore.getForegroundTCPQueueHead() else { return }

// 1. 跨協定 reset 預檢
if head.requiresRemoteReset {
    let result = try await sidecarClient.resetUpload(
        clientId: clientId,
        fileKey: head.fileKey,
        timeout: crossProtocolResetDeleteTimeoutSeconds
    )
    switch result {
    case .reset, .notFound:
        // sidecar 已乾淨（或本來就沒記錄），清 flag 再開始 TCP
        try uploadStore.setRequiresRemoteReset(fileKey: head.fileKey, value: false)
    case .concurrentTransfer(let via):
        // sidecar 那邊同 client 有 active transfer；放棄本輪 TCP，等下次重試
        NSLog("[Sync] DELETE rejected: concurrent_transfer via=\(via)")
        return
    case .failed(let error):
        // 5xx / timeout / 網路中斷 → 放棄本輪 TCP，保留 requires_remote_reset=1
        NSLog("[Sync] DELETE failed: \(error)")
        return
    }
}

// 2. Flag 已清，正式開始 TCP
try uploadStore.updateTransport(fileKey: head.fileKey, transport: "tcp")
// ... 原有 TCP 接收邏輯
```

**關鍵規則**：

1. 只有 `requires_remote_reset = 1` 才發 DELETE；flag = 0 的項目走既有 TCP 路徑（保留 TCP session-local resume）
2. DELETE 回 409 `concurrent_transfer` → 本輪 TCP 放棄，flag 保留、下次 BG task / foreground 再試
3. DELETE 回 5xx / timeout / 網路中斷 → 同上，保留 flag
4. DELETE 回 200 `reset` 或 404 `not_found` → 兩者都視為「sidecar 已乾淨」，清 flag
5. DELETE 成功 **and** 清 flag 後才 set `transport='tcp'`，原子語意：「HTTP 殘留已清、TCP 接手」

**為什麼不用 in-memory Set 追蹤**：in-memory Set 在 app kill 後丟失，而**正是 app kill 後 relaunch** 是最需要這個 flag 的場景（HTTP 沒跑完 → app 被殺 → foreground 回來想用 TCP → 這時 in-memory Set 已空，flag 缺失會導致 TCP 與 sidecar offset mismatch）。持久化 flag 是唯一正確的解法。

**為什麼不讓 TCP clientHello 強制 `resetPartial: true`**：那會放棄 TCP 對同 session 內連續檔案的 resume 能力（例如大檔 foreground 被切斷再回前景）。加個持久化 flag 成本極低（一個 INTEGER column），**保留** TCP resume 能力、**只**對 HTTP-touched 的檔案做 reset，收益對稱原則 #7 但不過度擴散。

---

## Phase 4: iOS — UploadStore schema 與 API 擴充

**檔案**: `apps/mobile/ios/SyncEngine/UploadStore.swift`

### 4.1 Schema migration：`transport` 欄位

目前 `upload_items.status` 為 flat string（`queued | uploading | completed | failed | cloud_downloading` 等），無法區分「TCP 正在傳」vs「HTTP background 正在傳」vs「上次 app 被殺留下的 orphan」。`getBackgroundHTTPQueueHead()` 若要安全排除 TCP-held 項目必須有 schema 支撐。

新增欄位（寫一條新 migration，不要手改既有 CREATE TABLE）：

```sql
ALTER TABLE upload_items ADD COLUMN transport TEXT;
-- 合法值：NULL（未開始或已完成） / 'tcp' / 'http'

ALTER TABLE upload_items ADD COLUMN requires_remote_reset INTEGER NOT NULL DEFAULT 0;
-- 1 表示 sidecar 那邊可能保有 HTTP 嘗試殘留的 .part / committed_bytes；
-- 下次 TCP 接手前必須先發 DELETE /upload/{clientId}/{fileKey} 清乾淨

ALTER TABLE upload_items ADD COLUMN http_body_sha256 TEXT;
-- 已匯出 temp file 的 body SHA256；用於建立背景 URLSession signed request

ALTER TABLE upload_items ADD COLUMN http_body_size INTEGER;
-- 與 http_body_sha256 配套，防止 temp file 被清理或替換後仍沿用舊 hash

ALTER TABLE upload_items ADD COLUMN background_task_server_id TEXT;
ALTER TABLE upload_items ADD COLUMN background_task_client_id TEXT;
ALTER TABLE upload_items ADD COLUMN background_task_binding_version INTEGER;
-- local row 持久化目前 URLSession task identity；delegate / stale cancel 只能在 identity match 時改 row

CREATE INDEX IF NOT EXISTS idx_upload_items_transport_status
  ON upload_items(transport, status);

CREATE INDEX IF NOT EXISTS idx_upload_items_background_task_identity
  ON upload_items(background_task_server_id, background_task_client_id, file_key);
```

`transport` 欄位語意：

- foreground TCP `connectAndUpload()` 選中 queue head → `transport = 'tcp'`
- background HTTP `enqueueNextPendingFileIfIdle()` 選中 queue head → `transport = 'http'`，並同步寫入 `background_task_*`
- 完成 (`status = 'completed'`)、重設 (`status = 'queued'`) 或 failed 路徑都清 `transport = NULL`；background HTTP 分支只能用 compare-and-clear 清 `background_task_*`

`requires_remote_reset` 欄位語意（持久化的「HTTP-touched」flag，取代 in-memory Set，解決 app kill / relaunch 後資訊丟失）：

- `enqueueNextPendingFileIfIdle(...)` 在 set `transport='http'` 時**同時** set `requires_remote_reset = 1`（表示 sidecar 那邊即將或已被我們戳過）
- `urlSession(...didCompleteWithError:)` 的**成功分支**（200 completed / 409 already_completed）清 `requires_remote_reset = 0`（sidecar 的狀態已是 completed 或乾淨）
- `urlSession(...didCompleteWithError:)` 的**retryable 失敗分支**（5xx / URLError / retryable 401 / 409 concurrent / 422）一律**保留** `requires_remote_reset = 1`，讓下次 TCP 或 HTTP 接手都知道要先 reset
- `403 file_key_owner_mismatch` 是 fatal data-integrity error：清 `requires_remote_reset = 0`、標 `failed`、不得重試
- repair-required auth failure（401 invalid signature / revoked，或 POST 404 unknown client / device_not_paired）保留 `requires_remote_reset = 1`，但同時設定 `needsRepair=true` 停止自動上傳
- `handleUploadReset` 在 sidecar 端成功（200 reset / 404 not_found）後，mobile 也同步清 `requires_remote_reset = 0`
- startup sweep 不動 `requires_remote_reset`（它是跨 session 的承諾，不該被 sweep 清）

`background_task_*` 欄位語意：

- 只由 background HTTP enqueue 寫入，值必須來自同一份 `BackgroundUploadTaskIdentity`
- URLSession delegate、`getAllTasks()` stale cancellation、`cleanupTempFile` 後續清理都必須先確認 local row 的 `background_task_*` 與 task identity 相符
- identity 缺失或 decode 失敗的 stale task 即使能從 legacy description 解析出 `fileKey`，也不得改 local row，因為 `upload_items` 不是 per-server table，`fileKey` 本身不足以證明 row ownership
- 成功 / fatal / retryable failure 分支清欄位時必須用 `WHERE file_key = ? AND background_task_server_id = ? AND background_task_client_id = ? AND COALESCE(background_task_binding_version, -1) = COALESCE(?, -1)` 的 compare-and-clear 形式；不得用單純 `WHERE file_key = ?` 清掉目前 binding 的 active task identity

### 4.2 Startup sweep：orphan uploading 歸零

**啟動順序鎖死**（AppDelegate / SyncEngineManager 實作必須按此順序，否則 sweep 會誤刪 URLSession 正在跑的 task 狀態，或 `getBackgroundHTTPQueueHead()` 會誤判卡住）：

1. `UploadStore.init()`（建表、跑 migrations）
2. `UploadStore.sweepOrphanUploadingOnStartup()`（把所有 `status='uploading'` 歸零，但**不得清 `background_task_*`**，讓下一步 URLSession reconnect 仍可做 row-level identity match）
3. `SyncEngineManager.configureBackgroundUploadService()`（注入依賴）
4. `BackgroundUploadService.reconnectBackgroundSession()`（重連背景 session，解析 `task.taskDescription` 的 `BackgroundUploadTaskIdentity`；若 task 的 `serverId/clientId` 符合目前 binding，且 local row 的 `background_task_*` 與 identity 相符，**對應 fileKey 的 row 標回** `status='uploading'`、`transport='http'`、保留 `temp_file_path`；若 identity 缺失、不符目前 binding、或 local row 不匹配，取消 stale task 並寫 diagnostics，不得只靠 `fileKey` 改 row）
5. 任何 `enqueueNextPendingFileIfIdle(...)`、前景 `startSync()`、`BGProcessing` 排程

Sweep SQL：

```swift
func sweepOrphanUploadingOnStartup() throws
// UPDATE upload_items
// SET status = 'queued', acked_offset = 0, transport = NULL, updated_at = ?
// WHERE status = 'uploading'
// 不清 background_task_*；由 reconnectBackgroundSession() 用 task identity 決定是否恢復或 compare-and-clear
```

理由：cold-start 的瞬間，iOS 本程序沒有任何 active TCP session，也還沒呼叫 `reconnectBackgroundSession()` 取得系統仍保留的 URLSession task；此時 DB 裡的 `status='uploading'` 是**pre-reconnect 不可信狀態**。先把它歸零，再由 URLSession taskDescription + local `background_task_*` 恢復真正仍 active 的 background HTTP task。若跳過 sweep，沒有對應 active task 的舊 `uploading` row 會讓 `getBackgroundHTTPQueueHead()` 誤判 TCP/HTTP-held 而跳過，導致整條 queue 卡住。

URLSession task 的恢復走的是 **delegate 路徑**（不是 SQL 查詢），所以**即使 sweep 把 row 歸零了**，步驟 4 的 reconnect 仍能透過 `task.taskDescription` 的 structured identity 與 local row 的 `background_task_*` 把對應 fileKey 的 row 標回 `uploading`、`transport='http'`。順序 4 在 2 之後，兩者不會互相覆蓋。

reconnect 後若 local row 還殘留 `background_task_*`，但 `getAllTasks()` 已沒有對應 active URLSession task，才可在 diagnostics 後清掉 orphan identity；清理條件必須排除 `status='uploading' AND transport='http'` 的 row，避免和稍晚抵達的 delegate callback 競速。

### 4.3 新增方法

```swift
func updatePreparedTempFile(fileKey: String, path: String?, sha256: String?, size: Int64?) throws
// UPDATE upload_items
// SET temp_file_path = ?1, http_body_sha256 = ?2, http_body_size = ?3, updated_at = ?4
// WHERE file_key = ?5
// path/sha256/size 必須同批寫入，避免 request 簽到舊 hash

func clearPreparedTempFile(fileKey: String, identity: BackgroundUploadTaskIdentity?) throws -> String?
// background URLSession completion 必須傳 identity：
// SELECT temp_file_path，然後 UPDATE 清 temp_file_path/http_body_sha256/http_body_size
// WHERE file_key = ? AND background_task_server_id/client_id/binding_version match identity
// 回傳被清掉的 temp_file_path，caller 才可刪磁碟檔
// identity == nil 僅供 foreground / startup orphan cleanup 這類非 task-specific 路徑

func getItemsWithTempFiles() -> [UploadItemRecord]
// SELECT * FROM upload_items WHERE temp_file_path IS NOT NULL AND temp_file_path != ''

func resetUploadOffset(fileKey: String) throws
// UPDATE upload_items SET acked_offset = 0, updated_at = ?1 WHERE file_key = ?2
// 開發版切到 HTTP 時立即呼叫；此後該 fileKey 不再保留 TCP resume offset

func updateTransport(fileKey: String, transport: String?) throws
// UPDATE upload_items SET transport = ?1, updated_at = ?2 WHERE file_key = ?3

func setBackgroundTaskIdentity(fileKey: String, identity: BackgroundUploadTaskIdentity?) throws
// identity != nil:
// UPDATE upload_items
// SET background_task_server_id = ?1,
//     background_task_client_id = ?2,
//     background_task_binding_version = ?3,
//     updated_at = ?4
// WHERE file_key = ?5
// identity == nil 僅供非 task-specific cleanup；一般 URLSession completion 應用 clearBackgroundTaskIdentity(...)

func backgroundTaskIdentityMatches(fileKey: String, identity: BackgroundUploadTaskIdentity) throws -> Bool
// SELECT 1 FROM upload_items
// WHERE file_key = ?1
//   AND background_task_server_id = ?2
//   AND background_task_client_id = ?3
//   AND COALESCE(background_task_binding_version, -1) = COALESCE(?4, -1)

func clearBackgroundTaskIdentity(fileKey: String, identity: BackgroundUploadTaskIdentity) throws
// UPDATE upload_items
// SET background_task_server_id = NULL,
//     background_task_client_id = NULL,
//     background_task_binding_version = NULL,
//     updated_at = ?1
// WHERE file_key = ?2
//   AND background_task_server_id = ?3
//   AND background_task_client_id = ?4
//   AND COALESCE(background_task_binding_version, -1) = COALESCE(?5, -1)
// compare-and-clear；舊 task completion 不得清掉目前 binding 的 active identity

func setRequiresRemoteReset(fileKey: String, value: Bool) throws
// UPDATE upload_items SET requires_remote_reset = ?1, updated_at = ?2 WHERE file_key = ?3
// HTTP enqueue set 1；HTTP 成功（200/409 already_completed）set 0；DELETE 成功（200/404）set 0
// retryable 失敗分支（5xx/retryable 401/409 concurrent/422）一律不動 → 保持 1，下次接手再 reset
// 403 owner mismatch 清 0 並 failed；repair-required auth failure 不清 flag，但設 needsRepair

func getRequiresRemoteReset(fileKey: String) -> Bool
// 供 connectAndUpload() 預檢（見 Phase 3.7）

func getPreparedHTTPBody(fileKey: String) -> (path: String, sha256: String, size: Int64)?
// 只有 temp_file_path 存在、檔案仍在磁碟、http_body_sha256 非空、http_body_size == 實際檔案大小時才回傳
// appDidEnterBackground fast path 只能排這種已預備好的 item；不能臨時 export/hash 大檔

func getBackgroundHTTPQueueHead() -> UploadItemRecord?
// SELECT ... WHERE status IN ('queued','uploading') AND (transport IS NULL OR transport = 'http')
// ORDER BY priority DESC, id ASC LIMIT 1
// 排除 transport = 'tcp' 的項目；沒有 transport 欄位的舊列在 startup sweep 後應已歸零

func getForegroundTCPQueueHead() -> UploadItemRecord?
// SELECT ... WHERE status IN ('queued','uploading') AND (transport IS NULL OR transport = 'tcp')
// ORDER BY priority DESC, id ASC LIMIT 1
// 對稱於 getBackgroundHTTPQueueHead：排除 transport = 'http' 的項目，避免 foreground TCP 誤選
// 目前正由 background HTTP 傳的檔案（會被 sidecar TransferGate 拒絕、且兩條路徑搶同一 tempURL）
// 注意：回傳的項目可能 requires_remote_reset = 1（上次 HTTP 殘留），
// 此時 connectAndUpload() 必須**先**發 DELETE /upload/{clientId}/{fileKey} 再開始 TCP；
// DELETE 成功或 404 後才將 transport 設為 'tcp' 並開始實際傳輸（見 Phase 3.7）

func sweepOrphanUploadingOnStartup() throws
// 見 4.2

func getLastKnownBinding() throws -> StoredBinding?
// 回傳最近一次成功 foreground pairing/sync 寫入的 serverId、sidecarHost、port、pairingTokenKeychainRef

func updateLastKnownBinding(_ binding: StoredBinding) throws
// foreground sync 成功確認 server 可用時寫入，供 BGProcessing cold-start hydrate 使用

func setNeedsRepair(_ value: Bool, reason: String?) throws
// 寫入 needs_repair flag（可存 UserDefaults 或 meta 表）；401 背景失敗時由 BackgroundUploadService 呼叫

func getNeedsRepair() -> (flag: Bool, reason: String?)
// appWillEnterForeground / SyncEngineManager.startSync() 前讀取，決定是否顯示 banner 或 skip 自動上傳
```

注意：

- `temp_file_path` 欄位已存在於 schema 且在 `uploadItemFromRow` 中已處理，目前只是未被使用
- `transport` 欄位在 `UploadItemRecord` struct / `uploadItemFromRow` 都要一併新增
- `binding` 持久化給 BGProcessing 冷啟動使用（見 Phase 6）；若 `UploadStore` 不適合存 binding，也可在 `AutoUploadConfigStore` 或 Keychain + UserDefaults 持久化

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

在 `didFinishLaunchingWithOptions` 中按 Phase 4.2 鎖死的順序 wire up：
```swift
func application(_ app: UIApplication,
                 didFinishLaunchingWithOptions options: ...) -> Bool {
    // 1. 建 store + migrations（SyncEngineManager.init() 內部執行）
    // 2. sweep orphan uploading（SyncEngineManager.init() 內部呼叫 sweepOrphanUploadingOnStartup；
    //    只歸零 status/transport/acked_offset，不清 background_task_*）
    _ = SyncEngineManager.shared

    // 3. 注入 BackgroundUploadService 依賴
    SyncEngineManager.shared.configureBackgroundUploadService()

    // 4. 重連 URLSession background session；delegate 會在 step 5 前用 taskDescription + background_task_* recover active task 狀態
    BackgroundUploadService.shared.reconnectBackgroundSession()

    // 5. 後續 sync / BGTaskScheduler 才可啟動（startSync / submitContinuedTask 等）
    return true
}
```

**執行順序不得顛倒**：特別是 `reconnectBackgroundSession()` **必須**晚於 `sweepOrphanUploadingOnStartup()`（後者在 `UploadStore.init` 或 `SyncEngineManager.init` 內部執行）。若顛倒，reconnect 已把 URLSession task 標回 `uploading`，sweep 再一次把它歸零，雖然 `background_task_*` 仍可保住 row identity，但在下一個 delegate callback 前 queue selection / foreground resume 可能短暫看到錯誤的 `queued + transport=NULL` 狀態並做錯決策。

`uploadStore` / `historyStore` 目前是 `SyncEngineManager` private 屬性，不要在 `AppDelegate` 直接讀取。`configureBackgroundUploadService()` 應在 store 初始化後注入所需依賴，並可在 URLSession background relaunch 時重複呼叫。

---

## Phase 6: iOS — 更新 BackgroundExecutionService

**檔案**: `apps/mobile/ios/SyncEngine/BackgroundExecutionService.swift`

修改 `handleContinuedTask`：背景中不再啟動完整 TCP sync，改成「單檔排隊 + 補掃描」模式：
```swift
private func handleContinuedTask(_ task: BGProcessingTask) {
    task.expirationHandler = { ... }
    Task {
        // 1. 先做增量掃描，把新素材補進 UploadStore
        // 2. 取 binding（見下方 binding hydrate 規則）
        // 3. 如果目前沒有 active background URLSession task，才排 queue head 的 1 個檔案
        let result = await BackgroundUploadService.shared
            .enqueueNextPendingFileIfIdle(
                binding: binding,
                clientId: clientId,
                allowPreparation: true
            )
        handleEnqueueResult(result, task: task)
    }
}
```

修改 `handleMaintenanceTask`：和 `continuedTask` 採用同一個背景策略，不再直接 `startSync()`：
```swift
private func handleMaintenanceTask(_ task: BGProcessingTask) {
    task.expirationHandler = { ... }
    Task {
        // 1. 先做增量掃描
        // 2. 取 binding
        // 3. 檢查 active task 並排 queue head 的 1 個檔案
        let result = await BackgroundUploadService.shared
            .enqueueNextPendingFileIfIdle(
                binding: binding,
                clientId: clientId,
                allowPreparation: true
            )
        handleEnqueueResult(result, task: task)
    }
}
```

**Binding hydrate 規則**（BGProcessing 冷啟動時 `SyncEngineManager.shared.currentBinding` 可能為 nil）：

1. 優先：`SyncEngineManager.shared.currentBinding`（in-memory）
2. Fallback：從持久化層取最近一次成功配對的 binding
   - `clientId` 來自 `BindingService.getClientId()`（已存 Keychain）
   - `serverId` / `sidecarHost` / `port` 來自 `UploadStore.getLastKnownBinding()`（新增，見 Phase 4 註記）；每次 foreground sync 成功配對時寫入
   - `pairingToken` 來自 `BindingService.getPairingToken(forKey: pairingTokenKeychainRef)`；缺就 fallback 到 legacy key
3. 若任一欄位仍缺 → 回 `.missingBinding` / `.missingHost` / `.missingPairingToken`，不盲目 reschedule

`handleEnqueueResult(_:task:)` 統一由 `EnqueueResult` 決定是否 `submitNextMaintenanceTask()`：

補充要求：

- `continuedTask` 與 `maintenanceTask` 都不得在背景中直接呼叫 `SyncEngineManager.startSync()`
- 兩者都必須遵守「先補掃描，再檢查 active task，最後只排 queue head 1 檔」的模式
- 如果 queue head 需要 iCloud download 或匯出條件不成立，可直接結束 task，等待下次 foreground / BGProcessing 再重試
- 若 `enqueueNextPendingFileIfIdle(...)` 回傳 `.activeTaskExists`，則本次 BG task 直接 `setTaskCompleted(success: true)`，不得額外再排 maintenance task
- 若 `enqueueNextPendingFileIfIdle(...)` 回傳 `.queueHeadNotReady`、`.missingHost` 或 `.exportFailed`，則應提交下一次 maintenance task，沿用既有 maintenance cadence，等待下次 BGProcessing / foreground 再重試
- 若回傳 `.emptyQueue`，可不提交下一次 maintenance task，等待 photo library change / foreground；若回傳 `.missingPairingToken` 或 `.missingBinding`，不盲目重試，等使用者重新配對或 foreground 修復
- 同一輪 BG task 不做 busy loop / 反覆輪詢 queue head；最多做一次增量掃描與一次排隊判斷
- 保留既有 BGTask identifiers 和基本 cadence，但把「何時 submit 下一次 maintenance」改由 `EnqueueResult` 決定：
  - `.activeTaskExists`：不提交下一次，避免重複喚醒
  - `.emptyQueue`：可不提交，等待 photo library change / foreground
  - `.queueHeadNotReady`、`.missingHost`、`.exportFailed`：提交下一次 maintenance，沿用現有 15 分鐘 cadence
  - `.missingPairingToken` / `.missingBinding`：不盲目重試，等使用者重新配對或 foreground 修復

---

## Phase 7: iOS — 移除 SilentAudioService

### 7.1 移除呼叫點

**檔案**: `apps/mobile/ios/SyncEngine/SyncEngineManager.swift`

不要依賴文件中的歷史行號。實作時先跑：

```bash
rg -n "SilentAudioService\\.shared" apps/mobile/ios/SyncEngine apps/mobile/ios/SyncFlowMobile
```

移除所有呼叫點。依目前程式碼至少包含：

- `SilentAudioService.shared.start()`
- 多個 `SilentAudioService.shared.stop()`

刪完後再次執行同一個 `rg`，結果必須為空。

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

## Phase 8: Desktop renderer 回歸檢查

背景 HTTP 上傳會改變 `device.state.changed` 事件的 `currentFile` 來源（從 TCP session 改為 `BackgroundTransferTracker`），需要確認 renderer 不假設任何 TCP-exclusive 欄位。

**涉及檔案**：

- `apps/desktop/src/renderer/features/dashboard/DeviceCard.tsx` — 讀 `device.currentFile.{filename,progress,fileSize}`
- `apps/desktop/src/renderer/features/layout/AppShell.tsx` — 訂閱 `device.state.changed`
- `apps/desktop/src/renderer/stores/dashboard-store.ts` — `updateDeviceProgress` 會從 progress 推測 currentFile

### 8.1 欄位形狀契約

sidecar 的 `handleDashboardDevices` / `/transfer/active` **必須**在背景 HTTP 傳輸中回傳與 TCP 路徑完全相同的 `currentFile` shape：

```ts
currentFile: {
  filename: string
  progress: number       // 0-100
  fileSize: number
}
```

若 `BackgroundTransferTracker` 的原生欄位名不同（例如 `committedBytes`），**在 sidecar 的 JSON 序列化層轉換**，不讓 renderer 側看到不同形狀。

**Progress 權威來源鎖定**：

| 來源 | 計算方式 | 用途 |
|------|---------|------|
| ✅ sidecar `BackgroundTransferTracker.committedBytes` | `committedBytes / fileSize * 100` | **desktop UI 的唯一權威值** — 透過 `device.state.changed` 事件 / dashboard API 送回 renderer |
| ✅ sidecar TCP session（既有機制） | TCP handler 既有計算 | TCP 路徑下 desktop UI 的權威值 |
| ⚠️ iOS `UploadStore.acked_offset` | `acked_offset / fileSize * 100` | **僅供 iOS app 內自己的 UI** 顯示；**不透過 IPC / event 回灌 desktop** |

理由：iOS `didSendBodyData` 回報的是「已寫入系統 buffer」的 bytes，與 sidecar 實收 bytes 可能有 TCP window-sized 差距。讓 desktop UI 以 sidecar 實收為準，保證「desktop 看到 100% → 檔案真的落盤」。iOS 自己的 UI 用 `acked_offset` 顯示 OK，因為 iOS 斷網時 `acked_offset` 暫停推進就是正確行為。

**禁止**：把 iOS `acked_offset` 透過任何通道（WebSocket / Bonjour / mDNS / sidecar API）送到 desktop。若需要加 iOS → desktop 的 progress 事件，也必須先經 sidecar 才由 sidecar 統一發布。

### 8.2 背景傳輸中的 progress 停滯

iOS 被系統 suspend 時，`didSendBodyData` 不會觸發，iOS 端的 `updateUploadOffset` 暫停；但 sidecar 的 `UpdateProgress` 仍可能更新（只要 body 還在 stream）。反過來，iOS 背景 HTTP 完成後到下一次 `BGProcessing` 排下一檔之間，`currentFile` 可能會短暫消失。

renderer 應容忍：

- `currentFile == null` 且 `status == 'transferring'`（已由 `DeviceCard.tsx:87` 的「Preparing state」分支處理）
- `currentFile.progress` 長時間（≥10s）不變但 `status` 仍是 `transferring`（background suspend 的正常狀態）

不需要在 UI 顯示「suspended」這類新狀態，維持現有 `transferring` 即可。

### 8.3 Dashboard store 的 progress backfill

`dashboard-store` 既有 `updateDeviceProgress backfills currentFile when API snapshot is stale` 測試（`__tests__/dashboard-store.test.ts:135`）— 背景 HTTP 路徑必須保持此行為一致。新增回歸測試：

- 模擬 `device.state.changed` 攜帶 background HTTP 來源的 `currentFile`，store 處理不應 crash、欄位應正常寫入
- 模擬背景 HTTP 完成 → `currentFile` 清空 → 下一檔 HTTP 開始 → `currentFile` 重新出現，期間 `status='transferring'` 不閃爍

### 8.4 驗證命令

```bash
pnpm --filter @lynavo-drive/desktop test renderer/stores/__tests__/dashboard-store.test.ts
pnpm --filter @lynavo-drive/desktop test renderer/features/dashboard
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
   - 只排已預備好的 temp 檔（temp path + body hash + size）
   - 最多只建立 1 個 URLSession uploadTask
   - local row 寫入 `background_task_*`
   - task.taskDescription = JSON(BackgroundUploadTaskIdentity)
6. endBackgroundTask()
7. iOS 掛起 app → 系統層級繼續 HTTP 上傳
```

如果第 4 步在 transition background task 到期前無法抵達檔案邊界，當前 TCP 檔案會停在 mid-file。此時：

- background HTTP 不接手該半檔 offset
- 下一次若仍由 TCP 接手，可沿用既有 TCP resume 語意
- 下一次若由 HTTP 接手，立即做 partial reset（mobile `acked_offset = 0`，sidecar `.part` / `committed_bytes = 0`），再全檔 POST；HTTP 失敗後也不恢復舊 TCP offset

### 背景完成（app 被殺後重啟）
```
1. iOS 重啟 app 發送背景 URLSession 事件
2. AppDelegate.handleEventsForBackgroundURLSession → 儲存 completionHandler
3. BackgroundUploadService 重連 session → delegate 回調觸發；SyncEngineManager 重新 configure service dependencies
4. 任務完成 → 通過 `BackgroundUploadTaskIdentity` gate → 更新 UploadStore / history → 清理 temp 檔案
5. 若 queue 仍有待傳項目，且 binding/host/token 已 hydrate，才再次排當前 queue head 的 1 個背景 task
   - 若 sidecarHost 尚未恢復，完成當前 task 後停止，不續排下一檔
   - 等 foreground 或下一次 BGProcessing 重新取得 host 後再處理
6. urlSessionDidFinishEvents → 進入 drain gate
7. pending delegate work 全部落盤 / cleanup 後 → 呼叫 completionHandler()
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
| ~30s 視窗內匯出 / SHA256 算不完 | `appDidEnterBackground` 只排已預備好的 temp 檔；缺 `temp_file_path + http_body_sha256 + http_body_size` 就回 `.queueHeadNeedsPreparation`，交由 BGProcessing / foreground 預備 |
| Mac 離線、iPhone 離開 Wi-Fi | 背景上傳失敗 → 重設為 `queued` → 回到前景時 TCP 重傳 |
| LAN 內未授權裝置偽造上傳 | HTTP 端點強制驗證 HMAC proof，不接受只有 `clientId` 的請求 |
| raw pairing token 在 LAN HTTP header 暴露 | 不傳 raw token；改用 HMAC proof，sidecar 只用已儲存的 `pairing_token_hash` 驗證 |
| revoked 裝置仍能上傳 | `handleUpload` 必須檢查 `RevokedAt == nil`，revoked 直接 401/404 |
| 未配對者對 HTTP endpoint 做 LAN DoS | 對 malformed auth / invalid signature / unknown client 的來源 IP 做輕量退避；retryable stale auth 與已識別的 revoked device 不進一般 IP backoff |
| HTTP body 提前中斷或內容被替換 | handler 先硬性驗證 `receivedBytes == X-SyncFlow-File-Size`，再比對 streaming body hash 與必填 `X-SyncFlow-SHA256`；不符就 `422 file_size_mismatch` / `body_hash_mismatch`，不得 finalize |
| HTTP body 超過宣告大小 | `MaxBytesReader(fileSize + 1)` + 讀取迴圈超過 fileSize 立刻中止並清理 `.part` |
| HTTP request 讀取中途 error | `fw.Cleanup()` + `backgroundTransfers.Finish(...)` + `store.ResetUploadAfterHTTPError(fileKey)`（patch-style，**不是 DELETE**）；保留 `client_id` owner metadata 確保下次不會繞過 file_key_owner_mismatch 防線 |
| Temp 檔案佔用磁碟 | 成功 / fatal 失敗（403、連續 422）清理；retryable 失敗保留已追蹤 temp/hash 供重簽重傳；app 啟動時只刪不在 `UploadStore.temp_file_path` 追蹤的孤兒檔案 |
| app 被 kill 後 temp 檔被 startup cleanup 刪掉 | init cleanup 只刪不在 `UploadStore.temp_file_path` 追蹤的檔案 |
| 背景 URLSession 無即時進度 | 可接受：`didSendBodyData` 仍更新 offset，desktop 端則透過 background transfer tracker 顯示 transferring/currentFile |
| iOS 被系統殺掉後 tracker 殘留 | `BackgroundTransferTracker` 以 10 分鐘 inactivity timeout + 1 分鐘 sweep 自動清除 stale active 項目，避免 dashboard 長期卡在 transferring |
| foreground/background 交接時重複排下一檔 | foreground resume flag 優先；當前背景檔完成後改恢復 TCP，不再續排 background task |
| 背景 HTTP 完成但 mobile history 缺資料或分桶錯誤 | sidecar 成功 / 去重回應都回 `ledgerDate` 與 `activeTransmissionMs`；iOS 完成分支必須同步更新 `HistoryLedgerStore` / `daily_ledgers` |
| maintenance task 殘留舊 TCP 背景同步入口 | `handleContinuedTask` / `handleMaintenanceTask` 一律改成「補掃描 + 單檔背景排隊」，不得直接 `startSync()` |
| BG task 這輪沒有排到檔案後行為不一致 | 明確區分 `active task 已存在` 與 `目前無可排 queue head` 兩種情況；前者直接完成，後者提交下一次 maintenance task |
| 多 server pairing token 取錯 | enqueue 以 binding/serverId 取得 `pairingTokenKeychainRef`，legacy token 只作 fallback |
| 舊 binding 的 URLSession task 永遠擋住目前 desktop | `taskDescription` 存 `BackgroundUploadTaskIdentity(serverId, clientId, fileKey)`；`getAllTasks()` 只把同 binding task 視為 active，identity 缺失或 binding 不符的 stale task 取消並寫 diagnostics |
| 舊 binding 的 URLSession completion 污染目前 queue/history | 每個 delegate 入口都先 decode `BackgroundUploadTaskIdentity` 並比對目前 binding / last-known binding；不符則只清 task-local buffer + diagnostics，不得改 `upload_items` 或 history |
| stale URLSession task 取消時只靠 `fileKey` 把目前 binding 的 completed/failed row 改回 queued | `upload_items` 持久化 `background_task_*`；stale cancellation / completion 只能在 `backgroundTaskIdentityMatches(...)` 成立時 compare-and-reset / compare-and-clear，identity 缺失或 row 不符只寫 diagnostics |
| `urlSessionDidFinishEvents` 太早呼叫 completion handler | 以 `pendingDelegateWorkCount` drain gate 等所有 DB/history/續排決策完成後才呼叫 stored completion handler；stale identity cleanup 也算 delegate work |
| URLSession event 冷啟動時 host 尚未 hydrate | 完成當前 task，不續排下一檔；等 foreground / BGProcessing 重新恢復 binding 與 host |
| TCP partial 和 HTTP full POST ownership 混亂 | 開發版採「切協定即重置」：同一 `fileKey` 一旦由 HTTP 接手，mobile `acked_offset=0`、sidecar 清 `.part` / committed bytes，後續全檔重傳 |
| 同 clientId 背景併發 | sidecar 使用單一 `TransferGate.AcquireWithCanceller(...)` 在同一把 mutex 下原子拒絕同 client 任一 transport 的 active transfer，回 `409 concurrent_transfer` 並附 `via` 欄位 |
| TCP + HTTP 完成競速 | sidecar completion path 必須冪等；輸家收到 `SKIP` / `already_completed`，mobile 兩邊都收斂到 `completed` |
| LAN on-path body 替換（HMAC 簽章未涵蓋 body） | `X-SyncFlow-SHA256` 改為必填並簽入 canonical string；streaming 中計算 body hash 並 422 拒絕不符內容 |
| HMAC key 編碼 mobile/server 不一致 | 鎖死「`SHA256(pairingToken)` 的 raw 32 bytes 作 HMAC key」；sidecar 走 `hex.DecodeString(pairing_token_hash)`，與 `handler_hello.go` 既有規則一致 |
| Nonce replay / sidecar restart 後 LRU 空 | LRU 容量 1024、TTL 10 分鐘；timestamp ±300s window 內才接受；restart 後 ≤5 分鐘的 replay 視為可承擔風險，且受 body hash 綁定限制 |
| URLSession 延後送出導致 signed request timestamp 過期 | sidecar 回 `401 auth_timestamp_out_of_window`；iOS 視為 retryable stale auth，重建 request 取得 fresh timestamp/nonce，不標 `needsRepair` |
| URLSession 自動重送同一 request 導致 nonce replay | sidecar 回 `401 auth_nonce_replay`；iOS 視為 retryable once per wake，下一輪重建 request，不把它當 pairing token 壞掉 |
| retryable stale auth 被 IP backoff 誤傷 | `auth_timestamp_out_of_window` / 單一 task 的 `auth_nonce_replay` 不計入一般 `authIPFailureThreshold`；只有 invalid signature / malformed auth 才進 IP backoff |
| cold-start 時 pre-reconnect `uploading` / orphan row 卡住 queue | startup sweep 先歸零 `status/transport/acked_offset`、保留 `background_task_*`；`reconnectBackgroundSession()` 再用 URLSession task identity 恢復真正 active 的 background HTTP row |
| iOS 無法區分 TCP-held vs HTTP-held queue item | 新增 `transport` 欄位；`getBackgroundHTTPQueueHead()` 排除 `transport='tcp'` 項目 |
| POST 失敗但本地 offset 已歸零導致 TCP 續傳 state 不一致 | 開發版不保留跨協定 resume；POST 失敗後 `acked_offset` 維持 0，下一次 HTTP 或 foreground TCP 都從 0 全檔重傳 |
| HTTP enqueue 後 app kill，in-memory HTTP-touched Set 丟失 | 改用持久化 `requires_remote_reset` 欄位；承諾跨 session 有效，foreground TCP 接手必先 DELETE |
| DELETE endpoint 被濫用 release 別人 active transfer | DELETE 偵測 active 必 409 `concurrent_transfer`，絕不呼叫 `release()`；只在無 active 時清 `.part` |
| DELETE HMAC 對 A 卻刪 B | canonical string 含 path fileKey；handler 先驗 path fileKey == header fileKey，再驗 `^[0-9a-f]{64}$` 格式 |
| client B 得知 client A 的 fileKey 後 POST / DELETE / TCP FILE_INIT 操作 A 的 row | POST、DELETE、TCP `handleFileInit` 都在 auth 通過後查 `store.GetUpload(fileKey)`，若 `row.client_id != path.clientId` 一律拒絕；HTTP 回 `403 file_key_owner_mismatch`，TCP 回 `FileInitRes{Action: "REJECT", Reason: "OWNER_MISMATCH"}`；`uploads.file_key` 是全域 PK 必須靠 server-side enforcement |
| HTTP `403 file_key_owner_mismatch` 被 mobile 當一般 4xx 重試 | iOS delegate 將此視為 fatal data-integrity error：`status='failed'`、`acked_offset=0`、清 `requires_remote_reset`、停止背景續排；不得回 `queued`，避免無限重試同一個已知 owner 衝突 |
| `UpsertUpload` 零值覆蓋既有 client_id / filename / file_size | 新增專用 `EnsureReceivingUpload` patch-style helper，`ON CONFLICT` 只更新 status / committed_bytes / updated_at |
| sidecar `uploads.status` 混入 mobile queue 語彙 | sidecar retryable clean state 用 `interrupted`，不得寫 `queued`；`queued` 只屬於 mobile `upload_items` |
| HTTP handler 卡在 Read 導致 `TransferGate` 永久擋住同 client | 雙層：`uploadInactivityTimeout = 3m` inactivity 主動關 body + `transferGateStaleAfter = 10m` gate 兜底；**不變量** `uploadInactivityTimeout < transferGateStaleAfter`；`context.WithTimeout` 不中斷 blocking Read，必須 `r.Body.Close()` |
| Gate prune 與舊 handler 並發寫同一 fileKey | `PruneStale` 不直接刪 entry，而是呼叫註冊的 `cancel()` → 等 `transferGatePruneGracePeriod`（30s）handler 自己 release；真死才 force evict。期間同 client 新 acquire 仍看 entry 為 active |
| TCP canceller 只 cancel ctx 無法中斷 blocking Read | TCP 的 canceller 必須 `SetReadDeadline(time.Now()) + c.conn.Close() + ctxCancel()` 三動作一起；HTTP 則是 `r.Body.Close() + ctxCancel()`。ctx cancel 對 syscall-blocking 無效，兩 transport 都要關底層 IO |
| DELETE 404 條件與 HTTP error 保留 row 衝突 | 404 定義擴展為「無 remote partial 可清」包含 row 存在但 `committed_bytes=0` 且 `.part` 不存在；第二次 DELETE / error-reset 後 DELETE 落在明確 404，不回 200 reset 誤導 caller |
| BGProcessing 冷啟動時 binding 為 nil 導致 BG task 空轉 | 優先走 in-memory `currentBinding`，fallback 讀 `UploadStore.getLastKnownBinding()` + Keychain；任一欄位缺就回 `.missingBinding`，不盲目 reschedule |
| delegate 累積大 response body 造成 relaunch 時 I/O 負擔 | response body 累積器上限 16 KB，超過即視為異常失敗 |

---

## 變更檔案清單

| 檔案 | 動作 |
|------|------|
| `services/sidecar-go/internal/api/handlers_upload.go` | **新增**（POST `/upload/{clientId}` + DELETE `/upload/{clientId}/{fileKey}`、HMAC/canonical/body-hash/owner checks、`DiscardPartialIfExists`） |
| `services/sidecar-go/internal/api/background_transfer_tracker.go` | **新增** |
| `services/sidecar-go/internal/transferstate/transfer_gate.go` | **新增**（TCP / HTTP 共用的同 client 串行互斥 gate） |
| `services/sidecar-go/internal/api/router.go` | 修改（新增 `POST /upload/{clientId}` + `DELETE /upload/{clientId}/{fileKey}` reset 路由） |
| `services/sidecar-go/internal/api/handlers_dashboard.go` | 修改（納入 background HTTP transfer + `TransferGate` 狀態） |
| `services/sidecar-go/internal/api/handlers_shared.go` | 修改（`/transfer/active` 納入 background HTTP transfer + `TransferGate` 狀態） |
| `services/sidecar-go/internal/server/handler_file.go` | 修改（匯出 `HashFile`；TCP `handleFileInit` owner check；TCP 接收前後 acquire/release `TransferGate`；TCP canceller 關 conn/deadline） |
| `apps/mobile/ios/SyncEngine/BackgroundUploadService.swift` | **新增**（background URLSession、structured task identity、delegate identity gate、completion handler drain gate、retryable auth stale handling、prepared temp/hash fast path） |
| `apps/mobile/ios/SyncEngine/SyncEngineManager.swift` | 修改（背景轉換邏輯 + 移除 SilentAudio 呼叫） |
| `apps/mobile/ios/SyncEngine/BackgroundExecutionService.swift` | 修改（continued task / maintenance task 都改用背景 HTTP） |
| `apps/mobile/ios/SyncEngine/UploadStore.swift` | 修改（+`transport` + `requires_remote_reset` + `http_body_sha256` + `http_body_size` 欄位 migration、+startup sweep、+背景 queue/transport/last-known binding/reset-flag/prepared-body helpers） |
| `services/sidecar-go/internal/store/uploads.go` | 修改（+`EnsureReceivingUpload`、+`ResetUploadBytes`、+`ResetUploadAfterHTTPError` patch helpers；HTTP error 後寫 `interrupted`，不寫 mobile-only `queued`；不改現有 `UpsertUpload` 避免 TCP 路徑回歸） |
| `apps/mobile/ios/SyncFlowMobile/AppDelegate.swift` | 修改（+背景 URLSession 回調） |
| `apps/mobile/ios/SyncFlowMobile/Info.plist` | 修改（移除 `audio`） |
| `apps/mobile/ios/SyncFlowMobile.xcodeproj/project.pbxproj` | 修改（+BackgroundUploadService, -SilentAudioService） |
| `apps/mobile/ios/SyncEngine/SilentAudioService.swift` | **刪除** |

---

## 驗證計畫

1. **Go sidecar 單元測試**: `go test ./internal/api/...` — 測試 happy path、missing headers、invalid HMAC、expired timestamp、nonce replay、revoked device、duplicate (`already_completed`)、`body_hash_mismatch`、`file_size_mismatch`、`body_read_error`、`body_too_large`、`concurrent_transfer`、stale tracker prune、完成後狀態重算；錯誤碼 literal 與 Phase 1.2 回應 JSON 的 `status` 欄位完全一致
2. **Go 編譯**: `go build ./cmd/syncflow-sidecar/`
3. **curl 手動測試**: 直接 POST 檔案到 `/upload/{clientId}` 驗證端到端
4. **iOS 編譯**: Xcode build 通過（無 SilentAudioService 引用錯誤）
5. **iOS TypeScript 類型檢查**: `pnpm --filter @lynavo-drive/mobile exec tsc --noEmit`
6. **前景同步回歸**: TCP 傳輸行為不變
7. **背景轉換測試**: app 進入背景後只建立 1 個 background URLSession task，且 desktop 顯示 `transferring`
8. **manual 插隊測試**: auto item 背景完成後，若此時 queue head 變成 manual item，下一個背景 task 必須取 manual item
9. **409 去重測試**: sidecar 回 `409 already_completed` 時，iOS 應標記本地項目為 `completed`，不得回 `queued`，且若回應包含 `ledgerDate` / `activeTransmissionMs` 必須同步補寫 history
10. **tracker timeout 測試**: 模擬 iPhone 背景上傳中斷且不再有新 byte，確認 10 分鐘後 stale tracker 被清除；**且**斷言 desktop dashboard 訂閱者於 prune 後 ≤1s 內收到 `device.state.changed` 事件，state 從 `transferring` 切換為 `connected_idle` 或 `offline`（依 presence 狀態）
11. **回到前景測試**: 確認不會和 active background task 並行雙傳；當前背景檔完成後恢復 TCP，而不是繼續串 background HTTP；已完成的背景上傳不重傳
12. **history 統計測試**: 背景 HTTP 完成後，mobile history / `daily_ledgers` 必須使用 sidecar 回傳的 `ledgerDate` 與 `activeTransmissionMs`
13. **maintenance task 測試**: 觸發 maintenance task 時，不得直接啟動完整 TCP sync；只能補掃描並排 queue head 的 1 個背景 task
14. **409 日期口徑測試**: `already_completed` 回應中的 `ledgerDate` 必須與 sidecar 既有完成記錄一致，不得因不同 API 路徑出現不同日期
15. **BG task 未排到檔案測試**: 驗證 `active task 已存在` 不會重複提交 maintenance task；`queue head 暫不可排` 則會提交下一次 maintenance task
16. **確認 Info.plist 不含 `audio`**: 重新提交審核前檢查
17. **App kill + URLSession relaunch 實機測試**: 上傳中把 app 送背景並讓系統終止，確認 URLSession 事件重啟後能完成當前 task、更新 UploadStore/history，並且只在 drain gate 歸零後呼叫 completion handler
18. **per-server token 測試**: 同一 iPhone 配對過兩台 desktop 時，背景 HTTP 必須使用目前 binding 的 `pairingTokenKeychainRef`，不能誤用 legacy/global token
19. **sidecarHost hydrate 測試**: URLSession relaunch 時若 host 尚未恢復，完成當前 task 後不得續排下一檔；foreground / BGProcessing 恢復 host 後再續排
20. **TCP partial → HTTP ownership 測試**: TCP 半檔中斷後由 BGProcessing 改走 HTTP 時，mobile `acked_offset` 與 sidecar `.part` / committed bytes 必須立即歸零，再全檔 POST
21. **POST 失敗後全量重傳測試**: 模擬 HTTP POST 因 retryable 401 / 5xx / 網路中斷而失敗時，mobile 的 `acked_offset` 必須維持 0、`transport` 回 NULL、`status` 回 `queued`；下一輪 foreground TCP / background HTTP 都必須從 0 全檔重傳。repair-required auth failure 另驗 `needsRepair=true`
22. **TCP + HTTP 競速測試**: foreground TCP 剛啟動時 background HTTP 同時完成，兩邊去重結果必須一致，且本地 queue 最終為 `completed`
23. **HMAC canonical string 一致性測試**: iOS 端計算的 HMAC 與 sidecar 期望值完全一致；涵蓋 filename 含非 ASCII、fileSize 為 0 / 極大值、timestamp 邊界等情境
24. **Body hash 綁定測試**: 以正確 HMAC + 不一致的 `X-SyncFlow-SHA256` / 替換 body 發 POST，sidecar 必須回 422 `body_hash_mismatch`，不得 finalize
25. **Nonce replay 測試**: 重用同一 nonce + 同一 timestamp 在 10 分鐘內重發，第二次必須回 401 `auth_nonce_replay`；過了 TTL 後舊 nonce 可被淘汰
26. **concurrent_transfer 測試**: 同一 clientId 先開 TCP 接收再 POST HTTP，sidecar 必須透過單一 `TransferGate` 回 409 `concurrent_transfer`，且 response body 含 `via: "tcp"`；反向（先 HTTP 再 TCP）同樣必須被拒
27. **Startup sweep 測試**: app 強殺後在 `uploading` 狀態的 row，cold-start 後必須被歸零成 `queued`、`acked_offset = 0`、`transport = NULL`
28. **BGProcessing binding hydrate 測試**: 模擬冷啟動下 `SyncEngineManager.shared.currentBinding` 為 nil，BackgroundExecutionService 必須能從 `UploadStore.getLastKnownBinding()` + Keychain 組出 binding；若 binding 資料不全，回 `.missingBinding` 而非 crash
29. **SilentAudioService 引用清空測試**: 執行 `rg -n "SilentAudioService\\.shared" apps/mobile/ios/SyncEngine apps/mobile/ios/SyncFlowMobile`，結果必須為空
30. **Desktop renderer 回歸**（Phase 8）: `pnpm --filter @lynavo-drive/desktop test` 全綠；背景 HTTP 來源的 `currentFile` 能正常顯示於 DeviceCard；progress 長時間不變時 UI 不閃爍
31. **HMAC path 格式測試**: 以非 ASCII-safe clientId（例如含 `/`、空白、中文）產生 HMAC proof，sidecar 必須拒絕或 mobile 端在 clientId 產生處就應拒絕；避免 percent-encoding 歧義導致 HMAC 不符
32. **Startup 順序回歸**: 透過 log 驗證 app cold-start 時執行順序為 `UploadStore.init → sweep → configureBackgroundUploadService → reconnectBackgroundSession → 任何 enqueue`；不得有任何 enqueue 落在 reconnect 之前
33. **DELETE /upload 跨協定 reset 測試**: HTTP 半檔後 foreground TCP 接手同一 fileKey，mobile 必須先 DELETE 再 TCP；DELETE HMAC canonical 為 6 行 `method\npath\nclientId\nfileKey\ntimestamp\nnonce`（`method="DELETE"`，**不含** `bodySha256Hex` / `filenameB64` / `mediaType` / `fileSize` / `createdAt` / `modifiedAt`，與 POST 的 canonical 獨立）；成功後 sidecar `.part` + `uploads.committed_bytes` 歸零、mobile `requires_remote_reset` 清 0
34. **DELETE 冪等性測試**: 對同一 fileKey 連續 DELETE 3 次，第 2/3 次應回 404 `not_found`；caller 視同成功不 retry
35. **TransferGate 注入一致性測試**: api handler 與 TCP handler 必須拿到**同一** `*TransferGate` instance；用 go test 建兩個獨立 gate 注入，驗證互斥失效（negative test）
36. **16KB response body 超限測試**: 模擬 sidecar 送 >16KB 回應，iOS delegate 必須 `task.cancel()` 且走 URLError.cancelled 分支；`oversizedTaskIds` set 在 task 結束後清空
37. **Canonical string 換行字元測試**: 以 `\r\n` 或字面 `\n` 組 HMAC，sidecar 必須拒絕；正確的 `0x0A` 才通過
38. **Progress 權威來源測試**: 斷開 iOS 網路但 sidecar 已收部分 bytes 時，desktop `currentFile.progress` 仍以 sidecar `committedBytes` 為準；iOS `acked_offset` 不得污染 desktop 顯示
39. **getForegroundTCPQueueHead 排除測試**: 有 `transport='http'` 項目存在時，`getForegroundTCPQueueHead()` 必須跳過它；`getBackgroundHTTPQueueHead()` 對稱排除 `transport='tcp'`
40. **createdAt/modifiedAt 缺省語意測試**: iOS 送 `nil`、空字串、省略 header 三種情境都應產生相同 HMAC，sidecar 接收三種情境都應通過
41. **DELETE 不 release 別人 gate 測試**: HTTP 上傳正在跑中間時，另一 client 或同 client 發 DELETE，sidecar 必須回 `409 concurrent_transfer` 且**不中斷**正在跑的 transfer；原 transfer 後續能正常完成
42. **DELETE path vs header fileKey mismatch 測試**: path `/upload/<cid>/<A>` 但 header `X-SyncFlow-File-Key: B`，sidecar 必須回 `400 filekey_mismatch`（防止 HMAC 對 A 卻刪 B）
43. **fileKey 格式驗證測試**: POST / DELETE 送 `X-SyncFlow-File-Key: not-hex-64chars`，sidecar 必須回 `400 invalid_file_key`
44. **requires_remote_reset 持久化測試**: HTTP enqueue 後殺掉 app、重啟、走 foreground TCP 接手同一 fileKey，必須先發 DELETE 再開始 TCP（驗 flag 沒在 app kill 中丟失）
45. **requires_remote_reset 生命週期測試**: HTTP 成功（200/409 already_completed）flag=0；HTTP retryable 失敗（5xx/retryable 401/409 concurrent/422）flag=1；repair-required auth failure flag=1 且 `needsRepair=true`；HTTP 403 owner mismatch flag=0 且 status failed；DELETE 成功（200/404）flag=0；DELETE 失敗（5xx/409/timeout）flag=1
46. **UpsertUpload partial 覆蓋回歸**: 既有 TCP row 有 `client_id="abc"`, `original_filename="foo.jpg"`；HTTP 接手同 fileKey 走 `EnsureReceivingUpload` 後這兩欄**必須保留**、只 `status` / `committed_bytes` 更新為 receiving / 0
47. **TransferGate stale prune 測試**（三階段，必須分別斷言）:
    - **階段 A（正常 cancel 路徑）**：mock handler 卡在 Read 10+ 分鐘，`PruneStale` 呼叫 cancel → body 被關 → handler 走 500 分支 → defer `release()` → gate entry 徹底移除 → 同 client 後續 `AcquireWithCanceller` 可成功。log 出現 `transfer_gate_cancelled_by_prune`
    - **階段 B（grace 期間仍擋 acquire）**：mock handler 卡在 Read 且**也不回應 cancel**（用 mock 讓 body.Close 後仍 block），`PruneStale` 呼叫 cancel 後 entry 進入 `pendingRelease`；此時**在 `transferGatePruneGracePeriod`（30s）內**同 client 新 `AcquireWithCanceller` 必須回 `conflict != nil`（仍是 concurrent_transfer），**不得**成功 acquire。這是防止舊 handler 還在寫 `.part` 時新 handler 併發寫
    - **階段 C（grace 過了 force evict）**：grace period（30s）結束後，mock handler 仍未退出，此時 `PruneStale` 下一輪呼叫才 force evict entry；新 acquire 此時才成功。log 出現 `transfer_gate_force_evicted`
    - 三階段都必須驗 desktop dashboard 收到 `device.state.changed` 事件
48. **TransferGate + tracker 雙側 prune 順序測試**: 週期 sweep 時必須**先** prune tracker、**再** prune gate；同一 fileKey 在 prune 期間不得出現「gate 已釋放但 tracker 還顯示 transferring」的短暫不一致
49. **PruneStale 不併發寫測試**（競態防線）：模擬 handler 卡在 Read 不讀不失敗：
    - 跑過 `uploadInactivityTimeout`（3m）— handler 的 inactivity `AfterFunc` 必須呼叫 `r.Body.Close()` 讓 blocking Read 回 error，走 500 body_read_error → defer `release()` 正常執行
    - 若模擬「body.Close 後 Read 仍 block」（使用 mock 攔截），超過 `transferGateStaleAfter`（10m）handler 仍未退出，`PruneStale` 呼叫 canceller → 再次嘗試 body.Close + ctx cancel；在 `transferGatePruneGracePeriod`（30s）內 handler 仍未 release 才 force evict
    - **關鍵斷言**：force evict 期間（handler 尚未 release），同 client 的新 `AcquireWithCanceller` 必須看到 entry 仍為 active（`pendingRelease`），直到 grace period 過；不得出現「舊 handler 還在寫 .part，新 handler 已 acquire 開始寫」
50. **`uploadInactivityTimeout < transferGateStaleAfter` 不變量測試**：常數檢查 + go test 驗證；若後續 constant 被改到違反，CI 紅燈
50a. **Inactivity timeout 中斷 blocking Read 測試**：模擬 iOS Wi-Fi 突然卡住不傳 bytes，`uploadInactivityTimeout` 到期時 handler 必須呼叫 `r.Body.Close()` 讓 blocking `Read` 立刻回 error；驗證 handler 走「500 body_read_error」分支、defer `release()` 正常執行；**斷言** 只用 `context.WithCancel` 而不關 body 會測試失敗（反面測試確認這個陷阱）
50b. **大檔慢速連線不誤殺測試**：模擬 1MB/s 持續傳 10 分鐘（6GB 總量），只要每個 chunk 間隔 < `uploadInactivityTimeout` 就不應被 timeout；確認這條路徑不會因整體 timeout 誤殺正常慢網路
51. **sidecar DELETE 不動 uploads.requires_remote_reset 測試**（職責分離）：sidecar `uploads` 表**沒有** `requires_remote_reset` 欄位；mobile 端收到 DELETE 200/404 後才 `setRequiresRemoteReset(false)`。用 go test 驗 sidecar schema 不含此欄位、用 iOS 測驗 mobile 在何時清 flag
52. **fileKey owner mismatch security 測試**（必測）：
    - 建兩台 paired 裝置 A 和 B，讓 A 先 POST 上傳 fileKey `F` 並 completed
    - B 用**自己的** pairingToken 對 path `/upload/<B>/` 發 POST 帶 `X-SyncFlow-File-Key: F`；sidecar 必須回 `403 file_key_owner_mismatch`，不得覆蓋 A 的 row
    - B 對 path `/upload/<B>/F` 發 DELETE；sidecar 必須同樣回 `403`，不得清 A 的 `.part` / `committed_bytes`
    - 反面測試：A 用自己的 pairingToken 對 path `/upload/<A>/F` 操作必須成功，驗證檢查不誤殺
53. **fileKey 格式驗證跨 endpoint 一致**：POST 和 DELETE 都對 `X-SyncFlow-File-Key` 做 `^[0-9a-f]{64}$` 檢查；送非 hex / 長度錯誤 / 大寫字元都回 `400 invalid_file_key`
54. **curl 範例可執行性測試**：Phase 1.5 的 curl 範例用正確產生的 fileKey + body_sha256 + HMAC 必須 happy path 200；把 fileKey 換成 `test-key` 必須回 400（防止文件範例與實作驗證脫鉤）
55. **TCP handleFileInit owner check 測試**（補 #2）：
    - 建 A / B 兩 paired client；A 先透過 TCP 上傳 fileKey `F` 並 completed
    - B 經 TCP `FILE_INIT_REQ` 送同一 fileKey `F`，sidecar 必須回 `FileInitRes{Action: "REJECT", Reason: "OWNER_MISMATCH"}`（沿用既有 `messages.go:109-112` 的 `Action / Reason` schema，不新增欄位）
    - 驗 A 的 row `client_id == A`、`original_filename` 等 metadata **未被**覆蓋；A 再嘗試上傳時仍能 resume 或看到 completed
    - iOS 端收到 `Action == "REJECT" && Reason == "OWNER_MISMATCH"` 後必須不重試（反面：fileKey 算法既有設計上不該產生跨 client collision，出現 = 邏輯 bug 必須排查）
56. **HTTP body error 不 DELETE row 測試**（補 #1）：
    - POST 到一半斷網 / 422 body_hash_mismatch 等錯誤分支，驗 `uploads.file_key = F` 的 row **仍存在**，`client_id` 保留原值，僅 `status='interrupted'`、`committed_bytes=0`、`part_path=''`
    - 接著讓 client B 用**自己** pairingToken 對同 fileKey `F` 發 POST，必須仍回 `403 file_key_owner_mismatch`（證明 owner 防線因保留 row 而持續生效）
57. **Inactivity timer goroutine 不 leak 測試**（補 #3）：
    - 用 `runtime.NumGoroutine()` 在測試開始 / 每次完成 1000 次成功 upload / 失敗 upload / cancelled upload 後比對，goroutine 計數不得持續增長
    - 反面測試：若有人把 `time.AfterFunc` 換回 `go func() { <-t.C }` 寫法且沒正確 drain channel，此測試必須紅燈
58. **錯誤分類優先序測試**（補 #4）：
    - 分別構造：(a) body 超大 (b) canceller 關 body 後 Read 回 error (c) clean EOF 但 bytes 不足 (d) SHA256 不符 (e) 寫盤 error，驗回傳 status 依序為 `body_too_large` / `body_read_error` / `file_size_mismatch` / `body_hash_mismatch` / `internal_io_error`
    - **關鍵**：case (b) 必須明確回 `500 body_read_error`，**不得**回 `422 file_size_mismatch`（這是上一版的語義錯誤）；即使 `receivedBytes < fileSize` 也一樣，只要 readErr != nil 就優先判為 body_read_error
    - **final partial chunk 反面測試**：送出 `fileSize = 256KB + 1 byte` 的合法 body，handler 必須正常讀完最後 1 byte 並成功完成；若有人把主 loop 改回 `io.ReadFull(bodyReader, buf)` 且未正確處理 final partial chunk，此測試必須紅燈
59. **TCP canceller 立即中斷 blocking Read 測試**（補本輪 #4）：
    - 模擬 TCP handler 正 block 在 `c.conn.Read()`（iOS 停止傳但 TCP 連線未關），`PruneStale` 呼叫 canceller：
      - 驗 `SetReadDeadline(time.Now())` + `c.conn.Close()` 被依序呼叫
      - 驗 TCP handler 在 ≤100ms 內從 Read 回 error，走既有 TCP error 分支 → defer `release()`
    - **反面測試**：把 canceller 改成只 `ctxCancel()` 不關 conn，測試必須紅燈（證明 ctx cancel 對 blocking Read 無效）
    - 與 HTTP 側 #50a 對稱，驗 Go blocking IO 陷阱兩條 transport 都處理正確
60. **DELETE 重複呼叫語意測試**（補本輪 #3）：
    - 序列：POST 半檔失敗 → `ResetUploadAfterHTTPError` 留下 `row.client_id=A, committed_bytes=0, part_path=''`；此時**第一次** DELETE 必須回 `404 not_found`（無 remote partial 可清），**不是** 200 reset
    - 直接對完全未傳過的 fileKey DELETE 也回 `404 not_found`
    - 只有真有 `.part` 或 `committed_bytes > 0` 要清時才回 `200 reset`
    - 反面：若有人實作成「row 存在就回 200」，此測試紅燈（避免 caller 誤判「我真的清了東西」）
61. **iOS HTTP 403 owner mismatch 收斂測試**：
    - 模擬 URLSession completion 收到 `403 {"status":"file_key_owner_mismatch"}`，`UploadStore` 必須將 item 標記為 `failed`、`acked_offset=0`、`transport=NULL`、`requires_remote_reset=0`
    - 驗證不呼叫 `enqueueNextBackgroundUpload()`、不回 `queued`、不重新排同一檔；diagnostics 可記 `clientId` / `serverId` / local `fileKey`，但不得記 pairing token
    - 反面：若有人把 403 落進 generic 4xx retry branch，此測試必須紅燈
62. **背景 URLSession stale auth 分類測試**：
    - 模擬 sidecar 回 `401 {"status":"auth_timestamp_out_of_window"}`：mobile 必須回 `queued`、保留 `requires_remote_reset=1`、保留 prepared temp/hash、不設定 `needsRepair`，下一輪 enqueue 必須產生新的 timestamp / nonce
    - 模擬 `401 {"status":"auth_nonce_replay"}`：同上，但記 diagnostics；不得顯示重新配對 banner
    - 模擬 `401 {"status":"auth_invalid_signature"}` / `auth_revoked_device` 或 POST `404 {"status":"unknown_client"}`：必須設定 `needsRepair=true`，停止自動續排
63. **background transition fast path 測試**：
    - `allowPreparation=false` 且 queue head 沒有有效 `temp_file_path + http_body_sha256 + http_body_size` 時，`enqueueNextPendingFileIfIdle` 必須回 `.queueHeadNeedsPreparation`，不得呼叫 `exportAsset()` 或計算 SHA256
    - `allowPreparation=true` 時，只允許預備 queue head 的單一檔案；寫入 prepared temp/hash 後才建立 URLSession task
64. **prepared hash stale 測試**：
    - `temp_file_path` 存在但實際檔案大小 != `http_body_size`，或 `http_body_sha256` 為空，必須視為未預備；不得用舊 hash 建 signed request
    - 成功完成 / fatal 403 / 422 需要清 prepared temp/hash；retryable 401 / 5xx 可保留 prepared temp/hash 供下一輪重簽
65. **BackgroundUploadTaskIdentity 測試**：
    - `task.taskDescription` 必須是可 decode 的 JSON，包含 `serverId/clientId/fileKey`
    - enqueue HTTP task 時必須把同一份 identity 寫入 local row 的 `background_task_*` 欄位，且在 `task.resume()` 前已落盤
    - `getAllTasks()` 遇到同 binding unfinished task 回 `.activeTaskExists`
    - 遇到 identity 缺失、decode 失敗、或 `serverId/clientId` 不符目前 binding 的 task，必須 cancel 並寫 `stale_background_task_cancelled`（含 reason），不得阻塞目前 binding
    - stale task 只有在 `backgroundTaskIdentityMatches(fileKey:identity:) == true` 時才可重設該 local row；identity 可 decode 但 local row 不匹配時，即使可取得 `fileKey` 也不得改 row，必須寫 `stale_background_task_cancelled_without_local_match`
66. **sidecar upload status vocabulary 測試**：
    - `ResetUploadAfterHTTPError` 後 sidecar `uploads.status` 必須是 `interrupted`，不得是 mobile-only `queued`
    - TCP `handleFileInit` 遇到 `interrupted + committed_bytes=0` 應走 fresh upload；遇到 `committed_bytes>0` 仍按既有 resume 規則處理
67. **delegate identity gate 測試**：
    - 建立 taskDescription 屬於舊 `serverId/clientId` 的 URLSession task，模擬 `didSendBodyData`、`didReceive data`、`didCompleteWithError(200 completed)` 依序抵達；`UploadStore.updateUploadOffset`、`updateUploadStatus`、`HistoryLedgerStore` 都不得被呼叫
    - 同 binding task 的 happy path 必須正常更新 offset/status/history，證明 guard 不誤殺目前 binding
    - `currentBinding == nil` 但 `UploadStore.getLastKnownBinding()` 可用時，delegate gate 必須用 last-known binding 判斷；兩者皆不可用時只寫 diagnostics，不改本地 queue
68. **background completion handler drain gate 測試**：
    - 模擬 `urlSessionDidFinishEvents` 先到、`didCompleteWithError` 的 async DB/history work 後完成；stored completion handler 必須等 `pendingDelegateWorkCount == 0` 才呼叫
    - stale identity completion 也必須進入 begin/finish delegate work；清 buffer/diagnostics 前不得 flush completion handler
    - completion handler 必須只呼叫一次，即使多個 task completion 與 `urlSessionDidFinishEvents` 交錯抵達
69. **auth backoff classification 測試**：
    - 連續多次 `auth_timestamp_out_of_window` 不得增加一般 IP failure counter，也不得觸發 `authIPBackoffSeconds`
    - 單一 wake 內的 `auth_nonce_replay` 只觸發 retry guard / diagnostics，不阻擋下一輪 fresh nonce request
    - `auth_invalid_signature` / malformed auth header 達 `authIPFailureThreshold` 才啟動 IP backoff
70. **background task row identity guard 測試**：
    - 舊 binding task 的 `fileKey` 與目前 binding 已 completed row 相同時，`getAllTasks()` stale cancellation 不得把該 row 改回 `queued`
    - 舊 binding task 的 `didCompleteWithError(200 completed)` 抵達時，不得清目前 binding row 的 `transport` / `requires_remote_reset` / `background_task_*` / `temp_file_path` / `http_body_sha256`，也不得補寫 history
    - 同 binding 且 local row `background_task_*` 相符的 completion 才能正常收斂 row 並清 identity
71. **compare-and-clear helper 測試**：
    - `clearBackgroundTaskIdentity(fileKey:identity:)` 必須使用 `file_key + server_id + client_id + binding_version` 條件；identity 不符時 affected rows 必須是 0
    - retryable failure / success / fatal failure 都必須在同一個 state transition 中 compare-and-clear；不得用單純 `fileKey` 清除 identity

---

## 附錄 A：App Review response 模板

重新送審時在 App Store Connect「App Review Information → Notes」或 Resolution Center 附下列說明：

```
Thank you for the feedback on Guideline 2.5.4.

In the previous build we used the `audio` background mode with a silent
audio service to keep the app alive for file transfers. We have removed
this entirely. Specifically in this build:

1. Info.plist — UIBackgroundModes now contains only `processing`.
   File:     apps/mobile/ios/SyncFlowMobile/Info.plist
   The `audio` entry has been removed.

2. SilentAudioService — the entire file and all call sites have been
   deleted. A repository-wide search for `SilentAudioService` returns
   zero results.

3. Replacement mechanism — file transfers now use URLSession
   background upload (URLSessionConfiguration.background), which is
   Apple's recommended system-level mechanism for continuing transfers
   when the app is suspended or terminated. The app no longer needs to
   remain in the foreground or play audio to complete uploads.

4. User-facing behavior — the app's function (syncing photos/videos to
   the user's paired Mac over the local network) is unchanged; only the
   underlying background execution method has been replaced to comply
   with 2.5.4.

No audio playback occurs anywhere in the app. The microphone is not
used. Please let us know if any additional information is needed.
```

對應 commit / PR 追蹤：

- Info.plist 變更：本 plan Phase 7.4
- SilentAudioService 刪除：本 plan Phase 7.1-7.3
- URLSession 背景上傳實作：本 plan Phase 1-6

**送審前 checklist**：

- [ ] `rg -n "SilentAudioService" apps/` 全空
- [ ] `Info.plist` 的 `UIBackgroundModes` 陣列不含 `audio`
- [ ] `grep -rn "AVAudioSession\|AVAudioPlayer" apps/mobile/ios/` 確認沒有誤留的音訊 API 使用
- [ ] TestFlight 內測至少完成一次 **app 背景 + 被系統終止 → 重啟 → URLSession 完成** 的實機流程（驗證項 #17）
- [ ] 版本號 / build number bump
- [ ] 附上本模板說明
