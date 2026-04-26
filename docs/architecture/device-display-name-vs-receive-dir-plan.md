# Plan: 設備展示名稱與接收資料夾名稱解耦

> Status: 已依本方案完成主要實作。本文保留決策背景與驗收標準，Phase 2-4 內容以下方「目前實作狀態」為準。

## Context

目前 sidecar 同時保存四種與設備名稱有關的資料：

- `clientId`：設備唯一身份
- `clientName`：mobile 上報的目前設備名稱
- `deviceAlias`：使用者可讀的設備別名
- `receiveDirName`：接收檔案落盤時使用的資料夾名

現況中，`clientName` / `deviceAlias` / `receiveDirName` 的責任邊界不夠清楚，導致以下問題：

1. iPhone 改系統設備名後，桌面端接收目錄是否應跟著變動，語義不明
2. UI 展示名稱與磁碟實際路徑互相耦合，容易造成誤解
3. 若資料夾名會因展示名稱變動而自動 rename，外部備份、索引與腳本路徑會不穩定

本方案的目標，是把「展示層名稱」與「儲存層路徑」徹底分開。

## Decision

採用以下明確語義：

### 1. 設備身份

- 設備身份唯一依賴 `clientId`
- 不依賴 `clientName`
- 不依賴 `deviceAlias`
- 不依賴 `receiveDirName`

### 2. 展示名稱

展示名稱只用於 UI、診斷與列表呈現，不參與落盤路徑計算。

建議統一規則：

```text
displayName = deviceAlias ?? clientName ?? clientId
```

說明：

- `deviceAlias`：使用者主觀命名，優先展示
- `clientName`：設備目前上報的系統或自訂名稱
- `clientId`：最後 fallback，僅在資料異常或初始化不完整時使用

### 3. 接收資料夾名稱

- `receiveDirName` 是儲存層欄位
- 一旦為某台設備確定，就視為穩定 storage key
- 後續 `clientName` 或 `deviceAlias` 更新時，不自動變更
- 不因 `HELLO_REQ` metadata refresh 自動觸發資料夾 rename

## Product Rules

### 必須成立

1. iPhone 改設備名稱後，Desktop 看板與 detail 可更新展示名稱
2. 已存在的磁碟資料夾路徑保持不變
3. 同一台設備不會因展示名稱改變而被識別成新設備
4. Desktop「打開資料夾」永遠指向該設備既有的穩定接收路徑

### 明確不做

1. 不因 `clientName` 變更而自動搬移設備資料夾
2. 不因 `deviceAlias` 變更而自動搬移設備資料夾
3. 不做啟動時全量 rename 或全量目錄重建

## Data Model Semantics

在現有 schema 基礎上，重新定義欄位語義：

### `paired_devices.client_name`

- 來源：mobile 每次連線上報
- 用途：展示與診斷
- 可變

### `paired_devices.device_alias`

- 來源：使用者在產品內設定
- 用途：展示與排序
- 可變

### `paired_devices.receive_dir_name`

- 來源：首次建立或 legacy 回填
- 用途：磁碟路徑 key
- 穩定，不自動變更

## File System Rules

實際接收路徑保持：

```text
received/
  <receiveDirName>/
    <YYYY-MM-DD>/
      <original filename>
```

其中：

- `<receiveDirName>`：只取自已持久化欄位
- `clientName` / `deviceAlias`：不直接參與最終落盤路徑選擇

## Creation and Backfill Strategy

### 1. 新配對設備

在 sidecar 建立 paired device 時就確定 `receiveDirName`。

建議生成規則：

```text
candidate = sanitize(deviceAlias ?? clientName ?? clientId)
```

這裡 `deviceAlias` 優先，與 legacy 回填（Section 3）的 `clientName` 優先不同。原因：新設備沒有歷史目錄要匹配，目標是取當下最佳可讀名稱作為初始 storage key；而 legacy 回填的目標是找到過去程式碼建出的既有目錄，那些目錄多半來自 `clientName`。

若 `candidate` 已被其他設備占用，sidecar 需自動避衝突，例如：

- `My iPhone`
- `My iPhone (2)`
- `My iPhone (3)`

避衝突檢查範圍：需同時檢查 DB `paired_devices.receive_dir_name` 和 `received/` 目錄，取聯集。原因：

- 只查 DB 會漏掉已刪除/revoke 設備遺留的目錄
- 只查檔案系統會漏掉已 reserve 但尚未建目錄的設備

一旦寫入 `receive_dir_name`，後續不再自動重算。

### 2. 舊設備，`receive_dir_name` 已存在

- 完全保留
- 不重新計算
- 不 rename

### 3. 舊設備，`receive_dir_name` 為空

採惰性回填，不做全庫一次性遷移。

回填規則：

1. 優先認領既有 legacy 目錄
2. 若找不到 legacy 目錄，再生成新的 `receiveDirName`
3. 一旦回填成功，即持久化

legacy 認領順序建議：

1. `sanitize(clientName)` 對應的目錄
2. `sanitize(deviceAlias)` 對應的目錄（僅當有明確證據顯示該目錄曾由 alias 建立時）
3. 若以上都不存在，再生成唯一新名稱

順序說明：

- `clientName` 優先，因為 legacy 目錄大多是由早期程式碼根據 `clientName` 建立的
- `deviceAlias` 是可變展示名稱，使用者改名後其值可能與 legacy 目錄毫無關係
- 若 alias 優先，會導致改過名的舊設備被錯綁到 alias 對應的目錄，而非原本由 `clientName` 建出的 legacy 目錄
- 若兩個 candidate 目錄都存在，保守選 `clientName` 對應的那個

## Implementation Plan

### Phase 1: 固化語義

更新架構與資料模型文件，明確定義：

- `displayName` 是展示層概念
- `receiveDirName` 是儲存層概念
- 名稱更新不驅動資料夾 rename

### Phase 2: sidecar 停止名稱驅動 rename

調整：

- `services/sidecar-go/internal/server/handler_hello.go`
- `services/sidecar-go/internal/server/handler_file.go`
- `services/sidecar-go/internal/server/file_writer.go`

要求：

1. `HELLO_REQ` 只刷新 metadata（`clientName`、`deviceAlias`、`lastIP`）
2. 不因 `clientName` 變更而 `MigrateDeviceDir`
3. 不因 `deviceAlias` 變更而 `MigrateDeviceDir`
4. `Finalize` 路徑一律優先使用已保存的 `receiveDirName`

具體需要移除的 rename 觸發點：

#### 觸發點 A：`handleHello` alias 變更（`handler_hello.go`）

目前程式碼在 `aliasChanged` 時會呼叫 `MigrateDeviceDir` 並覆寫 `receive_dir_name`：

```go
if aliasChanged && oldDirName != "" {
    newDirName := SanitizeDirName(req.DeviceAlias)
    if oldDirName != newDirName {
        MigrateDeviceDir(c.config.ReceiveDir, oldDirName, req.DeviceAlias)
        _ = c.store.UpdateReceiveDirName(c.clientID, newDirName)
    }
}
```

需要：

1. 移除整段 rename 邏輯（包含 `MigrateDeviceDir` 呼叫和 `UpdateReceiveDirName`）
2. 移除僅為 rename 服務的 `oldDirName` snapshot 區塊（lines 96-104），該區塊在移除 rename 後成為死碼
3. 保留 metadata 更新（`clientName`、`deviceAlias`、`lastIP`）

#### 觸發點 B：`handleFileEnd` finalize 前比對（`handler_file.go`）

目前程式碼在每次檔案完成時都會比對新舊 dir name 並嘗試遷移，且無條件覆寫 `receive_dir_name`：

```go
newDirName := SanitizeDirName(deviceAlias)
if oldDirName != "" && oldDirName != newDirName {
    MigrateDeviceDir(c.config.ReceiveDir, oldDirName, deviceAlias)
}
_ = c.store.UpdateReceiveDirName(c.clientID, newDirName)
```

這比觸發點 A 更危險，因為它在**每次檔案完成**時都可能觸發目錄搬移。

需要：

1. 移除 `MigrateDeviceDir` 呼叫
2. 停止每次 finalize 都重寫 `receive_dir_name`
3. 改為從 DB 讀取已保存的 `receiveDirName`（經 `EnsureReceiveDirName` 保證非空）直接傳給 `Finalize`

#### `MigrateDeviceDir` 函式本身（`file_writer.go`）

Phase 2 移除所有呼叫點後，`MigrateDeviceDir` 函式本身成為死碼。建議一併移除，避免後續誤用。若有手動遷移需求，可另行建立 CLI 工具。

#### `Finalize` 方法參數語意調整（`file_writer.go`）

目前 `Finalize` 的第二個參數名為 `deviceAlias`，內部再自行 `sanitizeDirName`：

```go
func (fw *FileWriter) Finalize(receivePath, deviceAlias, date, filename, fileKey string) (string, error) {
    alias := sanitizeDirName(deviceAlias)
```

需要：

1. 將參數語意從 `deviceAlias`（展示名稱）改為 `dirName`（已持久化的儲存名稱）
2. 呼叫端改為從 DB 取得 `receiveDirName` 傳入（經 `EnsureReceiveDirName` 保證非空）
3. `Finalize` 內部保留最後一道防呆：對傳入的 `dirName` 做 idempotent `sanitize` 或顯式 validate

原因：

- 正常路徑下，呼叫端傳入的應該已是持久化且 sanitized 的 `receiveDirName`
- 但 `Finalize` 是最後接觸檔案系統的入口，完全移除 sanitize/validate 會讓未來的誤用直接進入落盤邏輯
- 保留最後一道防線可以降低維護期回歸風險

### Phase 3: 補 `receiveDirName` 保證機制

新增集中邏輯，例如：

- `EnsureReceiveDirName(clientID string) (string, error)`
- `PairDeviceWithDirName(device store.PairedDevice) (string, error)`

要求：

1. 對新設備只生成一次
2. 對 legacy 設備只回填一次
3. 唯一性與 sanitize 規則集中在單一路徑

需要修改的呼叫點：

#### `handlePair`（`handler_hello.go`）

目前實作已改為在配對成功時直接呼叫 `PairDeviceWithDirName`：

1. 先組出完整 `store.PairedDevice`
2. 在同一個臨界區內生成唯一 `receiveDirName`
3. 將 `receive_dir_name` 與 paired device 一起寫入 DB

這代表新設備不再經過「先寫 paired row、再補 `receive_dir_name`」的中間狀態，也不會誤走 legacy claim 路徑。

#### `UpsertPairedDevice`（`store/devices.go`）

目前實作已將 `receive_dir_name` 納入 INSERT / UPDATE SQL，因此新設備可以在配對當下完成持久化；returning device 的 metadata refresh 也能保留既有 `receive_dir_name`。

#### `ListPairedDevices`（`store/devices.go`）

目前實作已補齊 `receive_dir_name` 的 SELECT / scan，避免不同呼叫點拿到不一致的 paired device 結構。

### Phase 2 與 Phase 3 的實作要求

本方案是**開發版本直接切換**，不設計兼容期 fallback。

要求：

1. Phase 2（移除 rename 邏輯）與 Phase 3（建立 `receiveDirName` 保證機制）必須一起實作
2. `handleFileEnd` / `Finalize` 不接受 `receive_dir_name = NULL` 的運行時狀態
3. 若某設備缺少 `receiveDirName`，應在 sidecar 內先完成 `EnsureReceiveDirName`，而不是在 API 或 finalize 階段臨時兜底

這代表：

- 不提供「未完成回填也能繼續靠名稱推導路徑」的 compatibility path
- 不保留 process-level fallback cache 設計
- 不允許新語義上線後還有「同一設備每次 finalize 重新依名稱算目錄」的過渡狀態

### Phase 4: dashboard / desktop 顯示與路徑拆分

#### 涵蓋範圍

本方案 Phase 4 涵蓋 **dashboard device card、device detail、device header** 的設備名稱顯示。

以下 surface **暫不在本階段切換**，留待後續統一：

- `DashboardSummaryDTO.lastSuccessfulDeviceName`：sidecar 已用 `COALESCE(NULLIF(device_alias,''), client_name)` 組裝，語義接近 `displayName` 但 fallback chain 不含 `clientId`
- `HistoryLedgerCardDTO.deviceName`：歷史帳本卡片的設備名
- `device_daily_stats.client_name_snapshot`：統計快照欄位，改動需考慮歷史一致性
- `Dashboard.tsx` / `SupportSection.tsx` 中的「最近一次成功同步」設備名稱

**原因**：這些 surface 的資料來源各自不同（有的是 SQL 即時查詢、有的是落盤快照），統一改動需要額外設計 snapshot vs. live 的策略。本階段先確保主要設備列表和詳情頁一致，避免範圍膨脹。

**風險**：同一版產品中，dashboard device card 顯示 `displayName`，而 summary 行仍顯示 `lastSuccessfulDeviceName`（可能不同）。這在「使用者改了 alias 但尚未完成新同步」的場景下可感知。

**實作提醒**：Phase 4 的 PR 描述中應明確列出上述「暫不切換」的 surface，避免 reviewer 將其視為遺漏。

#### 調整檔案

- `packages/contracts/src/types.ts`
- `services/sidecar-go/internal/api/handlers_dashboard.go`
- `apps/desktop/src/renderer/features/dashboard/DeviceCard.tsx`
- `apps/desktop/src/renderer/features/device-detail/DeviceHeader.tsx`
- `apps/desktop/src/renderer/features/device-detail/DeviceDetailPage.tsx`
- `apps/desktop/src/renderer/features/device-detail/DeviceDetailModal.tsx`
- `apps/desktop/src/renderer/stores/directory-store.ts`
- `apps/desktop/src/renderer/mocks/devices.ts`

要求：

1. UI 顯示名稱改走 `displayName`
2. `devicePath` 改走 `receiveDirName`
3. 不再假設資料夾名等於展示名

具體需要修改的地方：

#### Dashboard DTO 欄位調整

目前 `DashboardDeviceDTO`（`packages/contracts/src/types.ts`）只有 `clientName`，沒有 `displayName` 欄位；`handlers_dashboard.go` 的 `deviceDTO` 只是 API 端內部組裝結構。

需要：

1. `DashboardDeviceDTO` 新增 `displayName` 欄位
2. `DashboardDeviceDTO` 新增 `platform` 欄位（值來自 `paired_devices.platform`）
3. `handlers_dashboard.go` 的 DTO 與 JSON 回傳同步新增 `displayName` 和 `platform`
4. `displayName` 按 `deviceAlias ?? clientName ?? clientId` 組裝
5. 前端改讀 `displayName` 而非 `clientName` 作為 UI 標籤
6. 前端的設備類型判斷（手機/電腦圖示）改用 `platform` 欄位，而非 regex 比對 `clientName`
7. `clientName` 欄位保留作為原始設備名稱資料與診斷用途，但前端不應再直接用它做 UI 展示
8. 依 monorepo 約束，修改 contracts 後需先 `pnpm build` 再改 desktop renderer

設備類型判斷的說明：

目前 `DeviceHeader.tsx` 和 `DeviceDetailPage.tsx` 用 regex 比對 `clientName` 判斷設備類型：

```tsx
const isPhone = /iphone|ipad|galaxy|pixel|android|mobile/i.test(
  device.clientName,
);
```

如果前端改讀 `displayName`，使用者設了像「我的手機」這種 alias，regex 會失敗。改用 `platform` 欄位可徹底解決。sidecar 目前會從 `HELLO_REQ.clientPlatform` 暫存到 connection state，並在配對與 returning-device metadata refresh 時寫回 `paired_devices.platform`；對尚未送出 `clientPlatform` 的舊 client，sidecar 仍保留 `"ios"` fallback。

#### `directory-store.ts` 的設備名標籤

目前 `directory-store.ts` 用 `device.clientName` 作為檔案歸屬的設備名標籤。Phase 4 後需同步改為 `displayName`。

#### `DevicePath` 推導邏輯

目前 `handlers_dashboard.go` 的 fallback chain 是 `ReceiveDirName > DeviceAlias > ClientName`。

本方案落地後，應直接收斂為：

1. `DevicePath` 只由 `ReceiveDirName` 推導
2. API 層不保留 defensive fallback
3. 若 `ReceiveDirName` 缺失，視為 sidecar 資料錯誤，應在 sidecar 層修復，而不是由 API 臨時兜底

### Phase 5: 補可觀測性

建議在 device detail 或 diagnostics 中增加：

- `displayName`
- `clientName`
- `deviceAlias`
- `receiveDirName`
- `devicePath`

目的是降低「畫面名」與「磁碟路徑」不同時的排障成本。

### Phase 6: 更新既有文件

需要同步更新的文件：

- `docs/architecture/data-model.md` Section 6「設備重命名與目錄名」：目前描述模糊，需明確寫入解耦後的語義
- `docs/architecture/system-overview.md`（若涉及檔案落盤路徑描述）

## Test Plan

至少補以下測試：

### sidecar 單元 / 整合測試

1. returning device 僅更新 `clientName` 時：
   - `client_name` 會更新
   - `receive_dir_name` 不變
   - 不觸發目錄 rename

2. returning device 僅更新 `deviceAlias` 時：
   - `device_alias` 會更新
   - `receive_dir_name` 不變
   - 不觸發目錄 rename

3. finalize file 時：
   - 優先使用已保存的 `receive_dir_name`
   - 不因新的 `clientName` 改變落盤路徑
   - 不呼叫 `MigrateDeviceDir`
   - 不覆寫 DB 中已存在的 `receive_dir_name`

4. legacy device `receive_dir_name = NULL`：
   - 若 legacy 目錄存在，可被正確認領
   - 若不存在，會生成唯一新名稱

5. 新設備首次建立：
   - `handlePair` 完成後 `receive_dir_name` 已寫入
   - 重名時可避衝突

6. 並發安全：
   - 兩個 connection 同時對同一設備做 `handleFileEnd` 時，`receive_dir_name` 不會被競態覆寫
   - `EnsureReceiveDirName` 在並發呼叫下只生成一次
   - 兩台同名新設備幾乎同時配對時，`PairDeviceWithDirName` 需保證「生成名稱 + 寫入 DB」在同一個臨界區內完成，不會拿到相同 `receive_dir_name`

7. 缺失狀態約束：
   - `receive_dir_name = NULL` 視為 sidecar 錯誤狀態，不應進入 `Finalize`
   - `EnsureReceiveDirName` 必須先完成，`handleFileEnd` / `Finalize` 才能執行

### desktop / API 測試

1. dashboard `displayName` 優先顯示 `deviceAlias`，其次 `clientName`，最後 `clientId`
2. `DevicePath` 永遠使用 `receiveDirName`
3. 展示名稱變更不影響「打開資料夾」的目標路徑
4. `displayName` 與 `devicePath`（資料夾名）可以不同，UI 不應假設兩者相等

## Rollout Strategy

本方案按開發版模式直接切換，不設計兼容期：

1. 先上文件與語義統一（Phase 1、6）
2. 同時實作 rename 移除 + `receiveDirName` 保證機制（Phase 2 + 3）
3. 調整 UI 顯示（Phase 4）
4. 補可觀測性（Phase 5）

不建議直接：

- 對所有設備批次 rename
- 啟動時掃描整個 `received/` 全量重寫

因為這會提高誤搬移與路徑破壞風險。

## Risks

### 1. 使用者認知差異

風險：

- UI 顯示名稱可能與 Finder / Explorer 看到的資料夾名不同

對策：

- 在 device detail 明確顯示接收路徑
- 在 help / troubleshooting 文件補充說明

### 2. Legacy 資料夾認領錯誤

風險：

- 若舊資料夾命名與目前 metadata 不一致，可能認錯

對策：

- 認領順序保守
- 找不到明確對應時寧可生成新名稱，不做高風險 rename

### 3. 前端仍隱式依賴資料夾名

風險：

- 某些頁面可能仍用 `clientName` 推導 path

對策：

- 統一由 sidecar API 回傳 `devicePath`
- renderer 不自行拼接設備目錄

## Acceptance Criteria

完成後需滿足：

1. iPhone 改設備名後，Desktop 展示名稱會更新
2. 既有接收資料夾名不會自動變更
3. 新檔案仍落到原有設備資料夾下
4. `clientId` 仍是唯一設備身份來源
5. dashboard / detail / open folder 行為一致且可解釋
6. dashboard device card 和 detail page 顯示 `displayName`（非 `clientName`）
7. 設備圖示由 `platform` 欄位驅動（非名稱 regex）

## 目前實作狀態

以下項目已落地：

1. 已移除 `clientName` / `deviceAlias` 驅動的自動目錄 rename，`Finalize` 改由已持久化的 `receiveDirName` 決定落盤路徑
2. `EnsureReceiveDirName` 現在只負責 legacy device 的惰性回填；新設備改由 `PairDeviceWithDirName` 在配對當下生成並持久化 `receive_dir_name`
3. `PairDeviceWithDirName` 已將「生成唯一名稱 + 寫入 paired device」包進同一個 mutex 臨界區，避免同名新設備並發配對時拿到相同目錄名
4. `UpsertPairedDevice` / `ListPairedDevices` 已補齊 `receive_dir_name`
5. Dashboard API 已回傳 `displayName` + `platform`，並移除 `devicePath` 的 fallback chain；缺 `receive_dir_name` 視為 sidecar 資料錯誤而跳過
6. Desktop renderer 已改讀 `displayName` 作為主要設備標籤，並以 `platform` 驅動設備圖示，`directory-store.ts` 也已改用 `displayName`

## Remaining Follow-up

仍可後續補強的項目：

1. 補更多 diagnostics / device detail 可觀測性欄位，明確顯示 `displayName`、`clientName`、`deviceAlias`、`receiveDirName`、`devicePath`
2. 統一 `DashboardSummaryDTO.lastSuccessfulDeviceName`、`HistoryLedgerCardDTO.deviceName` 等尚未切換到同一套 `displayName` 語義的 surface
3. 若要把並發安全做成更硬的防線，可再補一個真正 goroutine 併發的 pairing regression test
