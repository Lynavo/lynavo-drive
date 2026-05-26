# 2026-05-26 Android CN Review APK Design

本設計文件說明如何為 Vivi Drop Android App 打包一個臨時的中國（CN）版本 APK，使其預設連接至審查環境（`https://review-api.vividrop.cn`）。

## 1. 目標
* 打包一個可獨立於真機運行、預設 API Base URL 指向 `https://review-api.vividrop.cn` 的 CN 版本 Release APK。
* 打包完成後，確保程式碼變更被還原，避免污染 git 提交記錄。

## 2. 修改方案
臨時修改 `/Volumes/T7/Dev/Web/SyncFlow/apps/mobile/src/markets/cn/config.ts` 中的 `apiBaseUrl`：

```diff
-  apiBaseUrl: 'https://api.vividrop.cn',
+  apiBaseUrl: 'https://review-api.vividrop.cn', // 臨時更改，打包後還原
```

因為 `src/services/config.ts` 中 `PROD_BASE_URL` 是讀取 `marketConfig.apiBaseUrl`，此修改會使 Release APK 的預設 API 請求皆發往審查伺服器。

## 3. 打包步驟
在 `/Volumes/T7/Dev/Web/SyncFlow/apps/mobile` 目錄中：
1. 執行 `pnpm install` 確保依賴最新。
2. 進入 `android` 目錄，執行 Gradle 打包指令：
   ```bash
   ./gradlew assembleCnRelease
   ```
3. 打包完成後，取得 APK 檔案，其路徑預計為：
   `/Volumes/T7/Dev/Web/SyncFlow/apps/mobile/android/app/build/outputs/apk/cn/release/app-cn-release.apk`
4. 還原 `apps/mobile/src/markets/cn/config.ts` 中的修改。

## 4. 驗收標準
* 成功產出 `app-cn-release.apk` 檔案。
* 原始碼的暫時修改已安全還原，`git status` 無未提交的變更。
