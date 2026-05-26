# Android CN Review APK Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打包一個可獨立於真機運行、預設 API Base URL 指向 `https://review-api.vividrop.cn` 的 CN 版本 Release APK，並在打包完成後還原代碼。

**Architecture:** 臨時修改 CN 市場的 API 設定檔，執行 Gradle 中對應 CN 版本的 Release 打包任務（assembleCnRelease），完成後將變更還原，確保 Git 工作區乾淨。

**Tech Stack:** React Native, Gradle, Android build system, Bash

---

### Task 1: 暫時更換 API Base URL
**Files:**
- Modify: `apps/mobile/src/markets/cn/config.ts:7`

- [ ] **Step 1: 修改 apiBaseUrl 變量**
  將 `apiBaseUrl` 改為 `https://review-api.vividrop.cn`。

  ```typescript
  // apps/mobile/src/markets/cn/config.ts:7
  apiBaseUrl: 'https://review-api.vividrop.cn',
  ```

- [ ] **Step 2: 驗證修改**
  執行 git diff 以確認僅修改了 `apiBaseUrl`。
  Run: `git diff apps/mobile/src/markets/cn/config.ts`
  Expected: 僅有一行 `apiBaseUrl` 被改為 `https://review-api.vividrop.cn`。

---

### Task 2: 執行 Android 封裝編譯
**Files:**
- Modify: None (Compile task)

- [ ] **Step 1: 清理先前快取與安裝依賴**
  在 `apps/mobile` 目錄執行 pnpm install。
  Run: `pnpm install`
  Expected: 依賴成功更新。

- [ ] **Step 2: 執行 Gradle assembleCnRelease**
  進入 `apps/mobile/android` 目錄，執行清理與編譯打包命令。
  Run: `./gradlew clean assembleCnRelease` (在 `apps/mobile/android` 中)
  Expected: 終端輸出 `BUILD SUCCESSFUL`。

- [ ] **Step 3: 確認產出的 APK 檔案路徑與存在**
  確認生成的 APK 檔案是否存在。
  Run: `ls -la apps/mobile/android/app/build/outputs/apk/cn/release/app-cn-release.apk`
  Expected: 能找到對應的 APK 檔案，且檔案大小大於 0。

---

### Task 3: 還原 API 設定與整理
**Files:**
- Modify: `apps/mobile/src/markets/cn/config.ts:7`

- [ ] **Step 1: 還原 apiBaseUrl 修改**
  將 `apiBaseUrl` 還原回原本的 `https://api.vividrop.cn`。

  ```typescript
  // apps/mobile/src/markets/cn/config.ts:7
  apiBaseUrl: 'https://api.vividrop.cn',
  ```

- [ ] **Step 2: 檢查 git status**
  Run: `git status`
  Expected: 顯示 `nothing to commit, working tree clean`。
