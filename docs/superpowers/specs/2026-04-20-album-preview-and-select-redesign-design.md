# 相冊預覽與選擇交互重構設計

- **建立日期**：2026-04-20
- **影響範圍**：`apps/mobile`（React Native）、`apps/mobile/ios/SyncEngine`（原生）、`packages/contracts`
- **動機**：相冊工作台目前缺少預覽；多選模式依賴長按進入，新用戶不易發現。改為「點 item 預覽、右上角圓圈常駐選中」以降低學習成本並支援素材確認。

---

## 1. 交互模型

### 1.1 Item 觸控分區

每個相冊 item 拆為兩個獨立熱區：

| 熱區 | 行為 | 已上傳項（`isTransferred`） |
|------|------|-----------------------------|
| Item 本體 | `onPress` → 打開預覽 Modal | 同樣可預覽 |
| 右上角選擇圓圈 | `onPress` → 切換 `selectedIds` | 不渲染圓圈（保留現有綠勾遮罩） |

實作：選擇圓圈用獨立 `TouchableOpacity` 包住；`hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}` 擴大觸控範圍；無需手動 `stopPropagation`（React Native 的 Touchable 不會冒泡到父 Touchable，但仍將圓圈置於絕對定位以避免視覺與觸控重疊）。

### 1.2 選擇狀態

- `selectedIds: Set<string>`：保留，作為唯一選擇來源
- **刪除** `multiSelectMode` state
- **刪除** `handleLongPress` + 所有 item 的 `onLongPress` 綁定
- 空圈在所有 `!isTransferred` 的 item 上**常駐顯示**；選中時切換為綠底白勾（沿用既有 `selectionCircleActive` 樣式）

### 1.3 全選過濾結果按鈕

- 位置：統計卡片「已選 N 項」同一行右側
- 文案：當「可選集合（當前過濾結果中 `!isTransferred` 的 items）」全部在 `selectedIds` 中時顯示「取消全選」，否則顯示「全選」
- 點擊行為：
  - 全選 → `setSelectedIds(new Set(currentFilteredSelectable.map(i => i.assetLocalId)))`
  - 取消全選 → `setSelectedIds(new Set())`
- 過濾 tab / 集合切換時 `selectedIds` 清空（保留既有行為）

### 1.4 上傳按鈕

不變：`selectedIds.size > 0 && !isAutoUploadActive && deviceConnected` 時啟用；觸發時把整個 `selectedIds` 送給 `submitManualUpload`。

---

## 2. 預覽 Modal（`AssetPreviewModal`）

### 2.1 組件位置

- 新檔 `apps/mobile/src/components/AssetPreviewModal.tsx`
- 由 `AlbumWorkbenchScreen` 控制開關、傳入當前過濾後並已排序的 `AlbumAssetDTO[]` 和初始 `index`
- 使用 `Modal`，`presentationStyle="fullScreen"`、`animationType="fade"`、`statusBarTranslucent`

### 2.2 結構

```
┌────────────────────────────────────────────┐
│ ✕        N / Total          <filename>     │  ← 頂部欄
├────────────────────────────────────────────┤
│                                            │
│             [Image / Video]                │  ← 主體：橫向分頁
│                                            │
└────────────────────────────────────────────┘
```

- 頂部欄：左「✕」關閉；中「N / Total」；右檔名（`numberOfLines={1}`）；已上傳時檔名後附 badge
- 主體：`FlatList` `horizontal`、`pagingEnabled`、`getItemLayout`（避開 `PagerView` 以免新增依賴）
- 已上傳不影響預覽能力；用 badge 提示而已

### 2.3 每頁渲染

- 每頁寬度 = 螢幕寬度（`Dimensions.get('window').width`）
- 進入某頁時才呼叫 `NativeSyncEngine.getAssetPreviewSource(assetLocalId)`
- 載入中顯示 `ActivityIndicator`；失敗顯示錯誤文字（iCloud 未下載等）
- 圖片：`<Image source={{ uri }} resizeMode="contain">`
- 影片：`<Video source={{ uri }} controls paused={index !== activeIndex} resizeMode="contain">`（`react-native-video`）

### 2.4 導航

- `onMomentumScrollEnd` → 計算新 `activeIndex`，更新頂部「N / Total」、檔名
- 只有 `activeIndex` 對應頁面的影片可播放，其他頁 `paused={true}`
- 預取策略：`activeIndex ± 1` 先發起 `getAssetPreviewSource`，但不渲染元素（減少左右滑等待）
- 關閉：✕ 按鈕、Android 硬體返回鍵（`BackHandler`）
- 離開 Modal 時釋放所有 `<Video>` 實例（透過 unmount 自然完成）

---

## 3. 原生層擴充（iOS `SyncEngine`）

### 3.1 新增方法

**`AlbumBrowserService`** 新增：

```swift
func getPreviewSource(assetLocalId: String) -> [String: Any]
// 回傳：
//   成功：["uri": "file:///...", "mediaType": "image" | "video"]
//   iCloud 未下載：["uri": "", "mediaType": "video", "error": "cloud_unavailable"]
//   asset 找不到：["uri": "", "mediaType": "image", "error": "not_found"]
```

**圖片分支**：
- `PHImageRequestOptions`：`deliveryMode = .highQualityFormat`、`isNetworkAccessAllowed = true`、`isSynchronous = false`（但在 bridge 層包成 Promise 式同步等待）
- `PHImageManager.default().requestImageDataAndOrientation` 取原始 JPEG data
- 寫入 `tmp/syncflow_album_previews/<safeId>.jpg`
- 已存在則直接回傳（快取）

**影片分支**：
- `PHVideoRequestOptions`：`isNetworkAccessAllowed = true`、`deliveryMode = .automatic`
- `PHImageManager.default().requestAVAsset(forVideo:options:)` → `AVURLAsset.url`
- **不導出** —— 直接回傳原生 URL 字串（iOS 內部 sandbox 已為 `<Video>` 授權）
- 若結果為 `nil` 或 URL 無效（iCloud 未下載失敗），回傳 `error: "cloud_unavailable"`

### 3.2 Bridge 註冊

**`SyncEngineManager`** 新增 public 方法：

```swift
func getAssetPreviewSource(assetLocalId: String) -> [String: Any]
```

**`RNBridge.swift`** 新增 `@objc` 包裝（若此專案 bridge 形態為 NativeModule）；若是現有 `NativeSyncEngine` 命名空間，加入同命名空間下的方法。參照既有 `browseAlbum` / `getBindingState` 的註冊形態。

### 3.3 Tmp 清理

新增 `SyncEngineManager.cleanupPreviewCacheIfNeeded()`：
- App 啟動時（`init` 尾端或既有 startup hook）呼叫
- 掃 `tmp/syncflow_album_previews/` 所有檔案
- 規則：刪除最後修改超過 **24 小時** 或目錄總大小超過 **500 MB**（後者先刪最舊的直到達標）
- 非阻塞（`DispatchQueue.global(qos: .utility)`）

---

## 4. 契約層（`@syncflow/contracts`）

### 4.1 新增 DTO

`packages/contracts/src/types.ts`：

```typescript
/** Preview source for a single album asset, fetched on demand */
export interface AssetPreviewSourceDTO {
  uri: string;
  mediaType: 'image' | 'video';
  error?: 'cloud_unavailable' | 'not_found';
}
```

### 4.2 既有 DTO 不變

`AlbumAssetDTO` 不動 —— 預覽是懶加載，不將原圖路徑塞進列表 DTO。

### 4.3 建置

改完 contracts 後必須 `pnpm build`（turbo 會重建 `@syncflow/contracts`），desktop 雖不用改但確保依賴一致。

---

## 5. 依賴與平台設定

- `apps/mobile/package.json` 新增 `react-native-video@^6`（具體版本以 RN 0.84 兼容性為準）
- iOS：`cd apps/mobile/ios && pod install`
- Android：此輪不特別驗證（主要發布目標是 iOS），但確保 `./gradlew assembleDebug` 不崩；若有額外 manifest 需求留給後續
- 不改 `Info.plist`（本地檔案 URL 不需要 ATS 例外）

---

## 6. i18n

三個 locale (`en` / `zh-Hans` / `zh-Hant`) 的 `albumWorkbench.json` 新增：

```json
{
  "preview": {
    "close": "關閉",
    "loading": "載入中…",
    "cloudUnavailable": "iCloud 影片未下載，無法預覽",
    "notFound": "素材找不到",
    "indexOfTotal": "{{index}} / {{total}}"
  },
  "selectAll": "全選",
  "deselectAll": "取消全選"
}
```

（繁中文案以 `zh-Hant` 為準，其他語言對應翻譯）

---

## 7. 測試策略

| 層 | 測試重點 | 工具 |
|----|---------|------|
| `AlbumWorkbenchScreen.test.tsx` | 圓圈點擊切換選中、item 本體點擊打開 Modal、全選/取消全選、上傳按鈕聯動；**刪除**長按多選相關 case | `@testing-library/react-native` |
| `AssetPreviewModal.test.tsx`（新增） | 初始 index 正確、左右滑 `activeIndex` 更新、只有當前頁影片播放、loading / error 狀態渲染、關閉回呼觸發 | `@testing-library/react-native`；`react-native-video` mock |
| `AlbumBrowserService` XCTest | `getPreviewSource` 圖片快取命中、cloud_unavailable 回傳、路徑 sanitize | Swift `XCTest` |
| Tmp 清理 | 24h 逾期刪除、500 MB 上限 LRU 削減 | Swift `XCTest` |

**既有測試回歸**：`AlbumWorkbenchScreen.test.tsx` 目前 long-press 相關 case 需刪除/改寫。

---

## 8. 驗證閘

實作完成前必須全部綠燈：

- `pnpm build`（contracts 重建）
- `pnpm --filter @syncflow/mobile exec tsc --noEmit`
- `pnpm --filter @syncflow/mobile test`
- iOS 本機 build 通過（`pnpm --filter @syncflow/mobile build` 或直接 Xcode build）
- 手機實機冒煙：相冊列表點 item 開預覽、左右滑、點圓圈選中、全選、上傳；影片預覽播放/暫停切頁；已上傳 item 預覽可開但無圓圈

---

## 9. 非目標（Out of Scope）

- 預覽器內的選中操作（交互已定：選中只在列表層）
- 圖片縮放手勢（本輪用 `resizeMode="contain"` 填滿螢幕；pinch-to-zoom 留後續）
- 影片剪輯/編輯
- Android 端的額外配置驗證
- 共享相冊 `SharedFiles` 的預覽（此輪僅限 `AlbumWorkbenchScreen`）

---

## 10. 風險與緩解

| 風險 | 緩解 |
|------|------|
| iCloud 影片請求失敗或超時卡住 UI | `getPreviewSource` 設 15 秒超時；前端 loading 超過 15s 顯示錯誤 |
| 預覽快取撐爆儲存 | §3.3 的 24h/500MB 清理策略 |
| `react-native-video` 與 RN 0.84 的兼容性 | 選用明確支援 RN 0.84 的版本；`pod install` 後手動冒煙驗證 |
| 橫向 `FlatList` 在 iOS 上 `getItemLayout` 未設好導致跳頁閃爍 | 明確設 `getItemLayout={(_, i) => ({ length: width, offset: width*i, index: i })}` |
| 原生端同步 I/O 阻塞 JS 線程 | bridge 方法用 Promise 返回，原生端 `DispatchQueue.global` 執行 |
