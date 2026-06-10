# Vivi Drop 排障手冊

本文件給接手同事一個統一的排障入口。優先用「分層定位」而不是盲猜。

## 1. 先看哪一層

遇到問題時，先判斷問題屬於哪一層：

1. **desktop / sidecar 層**
   - 桌面端沒監聽、沒廣播、Windows 防火牆擋住、Bonjour 執行時缺失、簽名包打不開、共享檢測錯誤
2. **mobile 發現 / 綁定層**
   - 掃不到設備、連接失敗、重啟 app 後恢復
3. **mobile 佇列 / 匯出層**
   - 佇列很多但不起傳、iCloud 下載慢、列表狀態不對
4. **傳輸層**
   - `FILE_ACK timeout`、重連、續傳、hash mismatch
5. **統計 / UI 層**
   - 今天/昨天不一致、完成時間顯示異常、detail 分頁/排序問題

## 2. 先收什麼材料

### 2.1 Desktop / sidecar

優先要：

1. desktop 診斷包
2. 目前 DMG / NSIS 安裝包或執行的 app 版本
3. `desktop-main.log`
4. `sidecar.db`

### 2.2 Mobile

優先要：

1. mobile 診斷包 zip
2. app 版本 / build
3. 當時是前景還是背景
4. 是否存在 iCloud 素材

## 3. 常見問題判斷路徑

## 3.1 「app 提示連接失敗，重啟後恢復」

先看：

1. sidecar 是否健康
2. 日誌裡是否有 `HELLO_REQ / AUTH_REQ` 成功
3. 是否真正進入 `SYNC_BEGIN`
4. mobile 診斷包裡是否還有大量 pending

高概率根因：

- app 主循環沒有從本地 pending 佇列繼續推進
- 鑑權成功後沒有進入真實同步輪次
- UI 最終落成了「連接失敗」而不是「等待下一輪」

不是這類問題時才考慮：

- sidecar 真不可達
- pairing 失效
- desktop 連接埠未監聽

## 3.2 「佇列很多，但 `queueCount=1` 或傳完一條就停住」

這是一個非常典型的 mobile 佇列問題。

檢查：

1. mobile `queue.json` 是否仍有大量 pending
2. sidecar 日誌裡的 `sync session started ... queueCount=` 是多少
3. 是否傳完一個檔案後沒有立即起下一條

高概率根因：

- app 真實上傳集合沒有從 pending 佇列建構
- 只拿了本輪新掃描素材

## 3.3 「顯示斷開連接，但又繼續上傳」

分兩件事看：

1. 是否真有 `FILE_ACK timeout` 或短重連
2. 重連是否幾秒內恢復，檔案是否繼續完成

如果是短時自動恢復：

- 這是「真實短重連 + UI 文案過重」
- 應視為「正在重連」，不是最終失敗

## 3.4 「電腦睡眠後局域網傳輸中斷」

先判斷是否為睡眠造成的正常網路斷線：

1. desktop 日誌在中斷前是否沒有 sidecar crash 或 app quit
2. mobile 診斷包是否仍保留 pending 佇列
3. 電腦喚醒後是否能重新掃到同一台 desktop
4. 喚醒後是否重新進入 `HELLO / AUTH / SYNC_BEGIN`

處理方式：

- 建議在 desktop 設定開啟「同步時防止電腦睡眠」
- 傳輸期間 desktop 會阻止顯示器睡眠，任務結束後恢復系統待機設定
- 若電腦已經睡眠，LAN 連線會斷開；喚醒並恢復網路後，mobile 應保留已完成檔案並自動繼續未完成佇列
- 若喚醒後沒有恢復，優先檢查 mobile pending 佇列、`SYNC_BEGIN` 是否重新發起，以及 desktop `39393 / 39394` 是否仍在監聽

## 3.5 「發現頁能掃到設備，但實際連不上」

先查：

1. sidecar 是否真的監聽 `39393 / 39394`
2. 本機是否有殘留的 `dns-sd` Bonjour 廣播孤兒行程
3. mobile 實際選到的是 IPv4 還是 `fe80::` IPv6
4. Windows 下 `SyncFlow Sidecar TCP / SyncFlow Sidecar HTTP / SyncFlow mDNS UDP` 防火牆規則是否生效，`Bonjour Service` 是否正在執行

歷史上常見根因：

- 殘留 `dns-sd` 導致假在線
- 舊路徑優先用了 `fe80::` link-local IPv6
- Windows 防火牆放行規則缺失或被策略覆蓋，尤其是 Android fallback 需要的 `39394/TCP` sidecar HTTP `/health`
- Windows 未安裝 / 未啟動 Bonjour for Windows，導致只能走相容廣播或發現失敗

## 3.6 「同一天統計在 app 和 desktop 不一致」

先對總量：

1. 檔案數總量是否一致
2. 總位元組數總量是否一致

如果總量一致但分桶不一致：

- 先懷疑是歷史分桶口徑不一致
- 目前正確口徑應以 sidecar/desktop 完成日為準

## 3.7 「iCloud 素材看起來卡住」

先確認：

1. 佇列項是否標記 `iCloud`
2. 目前狀態是否是 `cloud_downloading / preparing`
3. 並不是已經進入真實上傳但網路無流量

iCloud 問題通常卡在匯出階段，而不是 TCP 傳輸階段。

## 4. 關鍵日誌關鍵字

### 4.1 正常進入同步

- `startSync`
- `scan result`
- `pending assets`
- `TCP connected`
- `auth successful`
- `sync session started`
- `FILE_INIT_REQ`

### 4.2 典型異常

- `FILE_ACK timeout`
- `ACK_WAIT_FAILED`
- `backoff_waiting`
- `reconnecting in`
- `file already completed, skipping`
- `Network is down`
- `EOF`

## 5. 什麼時候懷疑哪一端

### 5.1 先懷疑 sidecar

當出現：

1. `39393 / 39394` 根本沒監聽
2. `desktop-main.log` 明確報 sidecar 啟動失敗
3. 多台設備同時受影響
4. DMG 安裝後 sidecar 本體就沒跑起來
5. Windows 下 Bonjour 執行時或防火牆規則沒有準備好

### 5.2 先懷疑 mobile

當出現：

1. `HELLO / AUTH` 成功但沒有 `SYNC_BEGIN`
2. 佇列很多但 `queueCount` 異常小
3. 檔案切換後頂部狀態殘留
4. 重啟 app 後恢復

### 5.3 先懷疑 UI

當出現：

1. 統計總量一致，但某個頁面顯示不一致
2. 傳輸仍在推進，但文案提示已失敗
3. 排序、分頁、滾動等表現異常

## 6. 最小排查順序

每次遇到線上問題，建議按這個順序走：

1. 看版本：desktop build、mobile build 是否對齊
2. 看 desktop 診斷包
3. 看 mobile 診斷包
4. 對照是否進入了 `SYNC_BEGIN`
5. 對照 queue 真實來源是不是 pending 佇列
6. 再決定是修 sidecar、mobile 狀態機，還是 UI 映射
