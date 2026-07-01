# Lynavo Drive 同步狀態機

本文件記錄目前系統裡的主要狀態機、狀態含義和 UI 語意。重點是區分「探活短連」和「真實同步會話」。

## 1. 為什麼要單獨寫這份文件

過去幾類真實問題都和狀態語意混淆有關：

1. app 提示連接失敗，但實際幾秒內自動恢復並繼續上傳
2. 短探活成功後 UI 過早顯示「已連接」
3. 頂部顯示上一檔案 `100%`，但目前沒有任何檔案在傳
4. 佇列很多，但實際會話 `queueCount=1`

所以交接時必須先把狀態層次分開看。

## 2. 四層狀態

目前至少有四層狀態，不要混為一談：

1. **Binding / Connection state**
   - 設備發現、綁定、探活、心跳連接狀態
2. **Upload state**
   - 目前同步輪次的粗粒度階段
3. **SyncEngine internal state**
   - 原生引擎內部更細的狀態機
4. **Queue item state**
   - 單個檔案在本地佇列中的狀態

## 3. Binding / Connection State

契約定義在 `@lynavo-drive/contracts`：

- `discovering`
- `bound`
- `connecting`
- `connected`
- `offline`

用途：

1. 發現頁設備狀態
2. 設定頁粗粒度連接狀態
3. 首頁頂層連接/離線提示的輸入之一

語意：

- `discovering`：正在瀏覽 Bonjour 服務
- `bound`：本地有綁定紀錄，但目前還沒有活連結確認
- `connecting`：正在進行探活、心跳或同步鏈路連結
- `connected`：最近一次心跳或同步鏈路確認成功
- `offline`：最近一次連結/心跳失敗

注意：

- `connected` 不等於「目前一定有一個長 TCP 會話在持續傳輸」
- 空閒態下，app 會做短探活和 HTTP `/presence` 心跳
- 因此 `connected` 只表示「目前這台 desktop 是可達且綁定有效的」

## 4. Upload State

`@lynavo-drive/contracts` 裡定義的是粗粒度狀態：

- `idle`
- `scanning`
- `queued`
- `uploading`
- `paused`
- `retrying`
- `completed`
- `failed`

但目前行動端 UI 實際消費的是更細的原生狀態字串，包括：

- `idle`
- `scanning`
- `preparing`
- `uploading`
- `reconnecting`
- `completed`
- `paused_no_permission`

這是目前實作事實。交接後如果要繼續收口，應該優先考慮把 coarse state 和 runtime state 對齊，而不是繼續擴散更多字串。

## 5. SyncEngine Internal State

內部狀態枚舉位於 `@lynavo-drive/contracts` 的 `SyncEngineState`：

- `idle`
- `discovering`
- `scanning`
- `preparing`
- `syncing_foreground`
- `backoff_waiting`
- `paused_no_target`
- `paused_no_permission`
- `stopped`

這些狀態主要用於原生層調度，不是直接給最終用戶展示。

## 6. Queue Item State

單檔案目前會經歷這些狀態：

- `discovered`
- `queued`
- `preparing`
- `ready`
- `cloud_downloading`
- `uploading`
- `completed`
- `failed`
- `skipped`

關鍵說明：

1. `cloud_downloading` 只在 iCloud 素材匯出階段出現
2. `completed / failed / skipped` 的檔案不會繼續留在唯讀 pending 佇列裡
3. desktop 不直接消費這套原生狀態；desktop 只看 sidecar 聚合後的上傳紀錄

## 7. 標準同步輪次

### 7.1 正常前景同步

1. `bindingState = connecting`
2. `uploadState = scanning`
3. 相簿掃描結束，新素材入隊
4. 上傳集合從本地 pending 佇列建構
5. `uploadState = preparing`
6. `HELLO_REQ / AUTH_REQ / SYNC_BEGIN_REQ`
7. `uploadState = uploading`
8. 每個檔案依次 `preparing -> cloud_downloading? -> uploading -> completed`
9. 全部結束後 `uploadState = completed`
10. 空閒輪詢時回到 `idle`

### 7.2 空閒探活

空閒時 app 會：

1. 短連 TCP 以解析 sidecar host
2. 鑑權後主動斷開短連結
3. 透過 HTTP `/presence` 維持「已連接」心跳

因此：

- 會看到 `HELLO / AUTH` 成功後立即 EOF
- 這本身不是 bug
- 只有當它本來應該進入 `SYNC_BEGIN` 卻沒有進入時，才是狀態機問題

## 8. 重連語意

短時 `FILE_ACK timeout` 或網路抖動時，目前正確理解是：

1. 傳輸層確實發生了短暫中斷
2. app 會自動進入 `backoff_waiting`
3. 數秒內可能恢復並繼續上傳

產品展示建議：

- 幾秒內自動恢復：`網路波動，正在重連`
- 超過閾值未恢復：`連接失敗` 或 `等待網路恢復`

不要把可自動恢復的短波動直接作為最終失敗態。

## 9. 已知易錯點

1. **短探活不等於真實同步連接**
2. **頂部進度不應殘留上一檔案的 100% 狀態**
3. **佇列 UI 和真實上傳集合必須都基於 pending 佇列**
4. **連接失敗要和「短時自動重連」分開**
5. **冷啟動時不應閃未連接/重連 banner**

## 10. 接手建議

新同事排查同步問題時，先問這 3 件事：

1. 目前看到的是短探活、真實同步，還是重連恢復？
2. UI 佇列和真實 `queueCount` 是否一致？
3. 問題發生在 binding、upload 還是單檔案狀態層？
