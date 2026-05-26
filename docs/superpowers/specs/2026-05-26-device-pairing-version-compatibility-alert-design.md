# 連接設備界面版本不相容彈窗提示設計

本文檔定義了當手機端與電腦端進行配對（輸入 6 位數字連接碼）時，若檢測到雙方 `appCompatibilityVersion` 版本不相容，手機端應如何進行彈窗提示的設計規格。

## 1. 背景與現狀

Vivi Drop 客戶端（React Native）與桌面端（Go Sidecar）之間使用特定的二進位/JSON 協議進行通信。為了防止老舊客戶端或桌面端版本在非相容性協議下運行導致數據損壞或同步異常，雙方引入了 `appCompatibilityVersion` 校驗機制。

目前，原生層和桌面端對版本不相容的處理非常完善：
*   **Go Sidecar (桌面端服務)**：在收到 `HELLO_REQ` 時，若 `AppCompatibilityVersion` 不符，會響應 `APP_VERSION_INCOMPATIBLE` 錯誤。
*   **iOS 平台 (`SyncEngineManager.swift`)**：解析出該錯誤碼時，會拋出帶有 `"手機與桌面 App 版本不相容，請同時更新兩端後再連線。"` 的 `SyncEngineError.pairingError`。
*   **Android 平台 (`AndroidSyncPrimitives.kt`)**：拋出 `IllegalArgumentException("手機與桌面 App 版本不相容，請同時更新兩端後再連線。")`。

在 React Native 側，上述原生拋錯會轉化為 `e.message` 並在 `CodeVerifyScreen.tsx` 的配對 `catch` 塊中捕獲。目前客戶端尚未對該錯誤進行特別攔截，僅將其作為一般性配對失敗訊息展示，無法有效引導用戶去更新桌面端。

---

## 2. 設計方案

### 🛠️ 設計 1：多語系文案配置 (`errors.json`)

我們將在多語系對照表檔案中新增版本不相容的標題與提示訊息，以確保全球化適配。

#### 1. 繁體中文 (`apps/mobile/src/i18n/locales/zh-Hant/errors.json`)
```json
{
  ...
  "pairingVersionMismatchTitle": "版本不相容",
  "pairingVersionMismatchMessage": "手機與電腦端的版本不相容，請將電腦端（桌面端）App 更新至最新版本後再試。"
}
```

#### 2. 簡體中文 (`apps/mobile/src/i18n/locales/zh-Hans/errors.json`)
```json
{
  ...
  "pairingVersionMismatchTitle": "版本不兼容",
  "pairingVersionMismatchMessage": "手机与电脑端的版本不兼容，请将电脑端（桌面端）App 更新至最新版本后再试。"
}
```

#### 3. 英文 (`apps/mobile/src/i18n/locales/en/errors.json`)
```json
{
  ...
  "pairingVersionMismatchTitle": "Version Incompatible",
  "pairingVersionMismatchMessage": "The app versions on your mobile device and computer are incompatible. Please update the desktop app to the latest version and try again."
}
```

---

### 🛠️ 設計 2：攔截不相容錯誤並彈窗 (`CodeVerifyScreen.tsx`)

我們將在 `CodeVerifyScreen.tsx` 提交驗證碼（`submitCode`）的 `catch` 分支中進行特定攔截：
1. 提取異常拋出的錯誤訊息 `msg = e?.message || ''`。
2. 判斷 `msg` 是否包含 `'版本不相容'`、`'APP_VERSION_INCOMPATIBLE'` 或簡體字的 `'版本不兼容'`。
3. 若匹配，則調用 React Native 原生的 `Alert.alert` 彈出警告框，展示剛才配置的 `errors.pairingVersionMismatchTitle` 和 `errors.pairingVersionMismatchMessage`。
4. 彈窗關閉後，保留輸入框下方的一般性錯誤提示（`setErrorMsg`），並自動清空 6 位數輸入框、觸發 300 毫秒震動、將焦點放回第一個輸入框，便於用戶重新操作。

---

## 3. 驗證計劃

### 自動化測試 (Automated Tests)
我們將在 `CodeVerifyScreen.test.tsx` 檔案中加入針對性單元測試：
*   **測試場景 1**：當 `pairDevice` 拋出包含 `APP_VERSION_INCOMPATIBLE` 的 Error 時，確認 `Alert.alert` 確實被呼叫。
*   **測試場景 2**：確認對應的翻譯 Key (`errors.pairingVersionMismatchTitle` 和 `errors.pairingVersionMismatchMessage`) 在多語系切換時顯示正確。
