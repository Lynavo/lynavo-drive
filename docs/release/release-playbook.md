# Lynavo Drive Beta 發佈手冊

本文件是目前 beta 發佈的總入口。iOS TestFlight、Android Debug 構建驗證、desktop 安裝包（macOS / Windows / Linux）和 beta tag 都按這裡的順序執行。

詳細步驟仍然分別落在：

- `docs/release/ios-testflight.md`
- `docs/release/macos-desktop-signing.md`
- `docs/release/market-release-flow.md`

desktop 桌面包正式 / Review 打包必須優先走 `pnpm release --profile review|prod --targets ...`，不要手動拼接 release 環境變數。`package:*` 根目錄指令碼只作為 release profile 內部步驟或本地開發驗證入口，不作為正式發佈入口。

Lynavo Drive 目前是 global-only OSS baseline。發佈文件不再維護 CN / Global 雙市場流程；local foreground LAN 同步對 guest/community build fail-open，remote/background 商業能力缺少有效 entitlement 時 fail-closed。

## 1. 目前版本規則

目前統一規則：

1. 對外版本：使用 iOS `MARKETING_VERSION`
2. beta build：使用 iOS `CURRENT_PROJECT_VERSION`
3. Android `versionName` 跟隨 iOS `MARKETING_VERSION`，`versionCode` 跟隨 iOS `CURRENT_PROJECT_VERSION`
4. desktop build number 跟隨 iOS build number
5. beta tag 格式：`beta/v<MARKETING_VERSION>-b<CURRENT_PROJECT_VERSION>`

例如：

- `0.1.0 (6)`
- `beta/v0.1.0-b6`

## 2. 發佈前檢查

在倉庫根目錄確認：

```bash
git status --short
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
pnpm --filter @lynavo-drive/desktop test
pnpm --filter @lynavo-drive/desktop typecheck
pnpm build:mobile:android
cd services/sidecar-go && go test ./...
```

還要滿足：

1. iOS Debug / Release build 通過
2. Android Debug build 通過
3. iOS 發佈範圍維持 iPhone-only：Xcode target `TARGETED_DEVICE_FAMILY = 1`，App Store Connect 不勾選 iPad 發佈
4. Android 發佈範圍維持 phone-only：`AndroidManifest.xml` 宣告不支援 `largeScreens` / `xlargeScreens`，Google Play Device catalog 不開放 tablet form factor
5. 關鍵真機回歸過一輪
6. 目前工作區乾淨

回歸基線見：

- `docs/testing/beta-test-matrix.md`

## 3. 遞增 build

每次準備發 beta：

1. 保持 `MARKETING_VERSION = 0.1.0`
2. 遞增 `CURRENT_PROJECT_VERSION`

原因：

- TestFlight 同一 marketing version 下必須遞增 build
- desktop 的 build 也依賴這條數字做對齊和展示

## 4. 發 iOS TestFlight

從倉庫根目錄按目標 profile 執行其一：

```bash
SERVER_ENV_FILE=/path/to/vivi-drop-server/.env.prod pnpm release --profile review --targets ios
SERVER_ENV_FILE=/path/to/vivi-drop-server/.env.prod pnpm release --profile prod --targets ios
```

如果只是排查 TestFlight archive / upload 腳本，可用底層 package 指令拆步；正式 / Review 發佈仍以 `pnpm release --profile review|prod --targets ios` 為準：

```bash
SERVER_ENV_FILE=/path/to/vivi-drop-server/.env.prod pnpm package:mobile:testflight:archive
SERVER_ENV_FILE=/path/to/vivi-drop-server/.env.prod pnpm package:mobile:testflight:upload
```

TestFlight 腳本會在 archive / upload 前比對 server `.env.prod` 與 mobile
config 內的 `APP_REVIEW_PHONE`。不一致會直接失敗，避免 App Review 帳號
連到錯誤後端。

產物位置：

- `apps/mobile/ios/build/archives/SyncFlow-<version>-b<build>.xcarchive`

上傳成功後：

1. 去 App Store Connect `TestFlight`
2. 等 build 從 `Processing` 變為可用
3. 填 beta 說明

## 5. 出 desktop 安裝包

正式發佈打包優先使用 release profile，例如 `pnpm release --profile prod --targets mac,win,linux`。下列根目錄指令碼可用於對應平台的本地打包或單平台驗證。

### 5.1 macOS signed DMG

正式發佈必須從倉庫根目錄使用 release profile。例：

```bash
pnpm release --profile review --targets mac
```

macOS Developer ID Team ID 必須跟 Lynavo Drive 發佈身份一致：

| Release profile   | Required Team ID |
| ----------------- | ---------------- |
| `review` / `prod` | `S44ANBLMF9`     |

`package-macos-signed.sh` 會檢查預期 Team ID；找不到匹配的 `Developer ID Application` identity 時不能用其他 Team 代簽。歷史雙市場 Team ID 不再是推薦發佈路徑。

如果只做本地驗籤：

```bash
pnpm package:desktop:signed:dir
```

產物位置：

- `apps/desktop/release/LynavoDrive-0.1.0-arm64.dmg`
- `apps/desktop/release/LynavoDrive-0.1.0-x64.dmg`
- `apps/desktop/release/mac*/Lynavo Drive.app`

發佈前至少確認：

```bash
for app in apps/desktop/release/mac*/Lynavo\ Drive.app; do
  codesign -dv --verbose=4 "$app" 2>&1 | grep TeamIdentifier
done
for app in apps/desktop/release/mac*/Lynavo\ Drive.app; do
  spctl --assess --type execute -vv "$app"
done
hdiutil verify apps/desktop/release/LynavoDrive-0.1.0-arm64.dmg
hdiutil verify apps/desktop/release/LynavoDrive-0.1.0-x64.dmg
```

### 5.2 Windows NSIS / ZIP

正式 / Review 發佈從倉庫根目錄使用 release profile：

```bash
pnpm release --profile review --targets win
pnpm release --profile prod --targets win
```

如果只做 Windows 本地封裝或單平台開發驗證，可直接執行 `pnpm package:desktop:win`；它不替代 release profile。

產物位置：

- `apps/desktop/release/LynavoDrive-0.1.0-x64.exe`
- `apps/desktop/release/LynavoDrive-0.1.0-x64.zip`

發佈前至少確認：

1. fresh install 後 app 能正常啟動
2. `resources\lynavo-drive-sidecar.exe` 已隨包落地並能被 desktop 拉起
3. 安裝器已寫入相容既有安裝的 `Vivi Drop Sidecar TCP`、`Vivi Drop Sidecar HTTP` 和 `Vivi Drop mDNS UDP` 防火牆規則，分別放行 `39393/TCP`、`39394/TCP` 和 `5353/UDP`；規則命名改為 Lynavo Drive 留到後續 native/binary/mDNS migration 任務
4. 設定頁能看到 Bonjour 執行時資訊，缺少 Bonjour 時 fallback 狀態可解釋

### 5.3 Linux `.deb`

Ubuntu 22.04+ Linux 桌面包提供 `.deb`，覆蓋 `amd64` / `x64` 和 `arm64`；Ubuntu `amd64` 對應產物檔名中的 `x64`。

Linux `.deb` 按目標 Ubuntu host / VM / arch 分開打包。正式 / Review 發佈從倉庫根目錄使用 release profile：

```bash
pnpm release --profile review --targets linux
pnpm release --profile prod --targets linux
```

如果只做 Linux 本地封裝或指定 arch 的開發驗證，可使用底層 package 指令；它們不替代 release profile。需要顯式指定 arch 時，可在 `apps/desktop` 下用 pnpm 的 `--` 轉發參數：

```bash
pnpm package:desktop:linux
cd apps/desktop
pnpm package:linux -- --arch x64
pnpm package:linux -- --arch arm64
```

產物位置如下；`linux-x64.deb` 與 `linux-arm64.deb` 分別來自 x64 和 arm64 的獨立打包執行，不是單次命令同時產出：

- `apps/desktop/release/LynavoDrive-<version>-linux-x64.deb`
- `apps/desktop/release/LynavoDrive-<version>-linux-arm64.deb`

發佈前至少確認：

1. 在 Ubuntu 22.04+ `amd64` / `x64` 和 `arm64` 上 fresh install `.deb`
2. app 能從桌面啟動器或終端正常啟動
3. sidecar 已隨包落地並能被 desktop 拉起
4. `39393/TCP`、`39394/TCP` 和 `5353/UDP` 網路放行條件已確認

## 6. 打 beta tag

只有在這些發佈物都完成後再打 tag：

1. TestFlight 上傳成功
2. 本輪目標平台的 desktop 安裝包已完成並驗收

TestFlight 打包上傳觸發 beta tag 時，必須讓兩個倉庫都有同一個測試 tag：

1. `/Volumes/T7/Dev/Web/SyncFlow`
2. `/Volumes/T7/Dev/Web/vivi-drop-server`

tag 名稱沿用本文件的 `beta/v<MARKETING_VERSION>-b<CURRENT_PROJECT_VERSION>`，例如 `beta/v1.0.0-b37`。不要只在 SyncFlow 單邊打 tag；若要推送遠端 tag，也必須兩邊都推送。

先在 SyncFlow 執行：

```bash
pnpm tag:beta
```

再到 server repo 用同一個 tag 名稱打 tag：

```bash
cd /Volumes/T7/Dev/Web/vivi-drop-server
git tag -a beta/v<MARKETING_VERSION>-b<CURRENT_PROJECT_VERSION> -m "Lynavo Drive beta <MARKETING_VERSION> (<CURRENT_PROJECT_VERSION>)"
```

如果要推遠端 tag，SyncFlow 可直接執行：

```bash
pnpm tag:beta:push
```

server repo 另外推同名 tag：

```bash
cd /Volumes/T7/Dev/Web/vivi-drop-server
git push origin beta/v<MARKETING_VERSION>-b<CURRENT_PROJECT_VERSION>
```

## 7. 推薦發佈順序

每次 beta 都按這個固定順序，避免遺漏：

1. 遞增 iOS build number
2. 跑預檢測試
3. 發 iOS TestFlight
4. 跑 Android Debug build
5. 出 macOS signed DMG
6. 如本輪包含 Windows，出 Windows NSIS / ZIP
7. 如本輪包含 Linux，出 Ubuntu 22.04+ `.deb`
8. 給 SyncFlow 和 vivi-drop-server 打同一個 Lynavo Drive beta tag
9. 確認工作區乾淨
10. 推程式碼和 tag
11. 等 TestFlight processing 完成後再擴大測試範圍

## 8. 發佈後的最小冒煙

### 8.1 iOS

1. fresh install
2. 配對
3. 同步一輪真實素材
4. Community/OSS 背景靜默續傳 fail-closed：只確認不啟用或承諾 paid background continuation
5. 回到前景後繼續 foreground LAN 同步 / 恢復驗證
6. 中途斷網恢復
7. 歷史和設定頁狀態正常
8. App Store Connect 裝置支援範圍確認只發布 iPhone，不發布 iPad / tablet

### 8.2 Android

1. Debug build 安裝
2. 配對
3. 同步一輪真實素材
4. Community/OSS 背景靜默續傳 fail-closed：只確認不啟用或承諾 paid background continuation
5. 回到前景後繼續 foreground LAN 同步 / 恢復驗證
6. 中途斷網恢復
7. 歷史和設定頁狀態正常
8. Google Play Device catalog 確認只發布 mobile phones，不發布 tablet form factor

### 8.3 macOS

1. 從 DMG fresh install
2. app 正常啟動
3. sidecar 正常監聽和廣播
4. 設定頁版本正確
5. 診斷包匯出正常
6. detail 分頁、排序、滾動正常

### 8.4 Windows

1. 從 `LynavoDrive-*-x64.exe` fresh install
2. app 正常啟動
3. sidecar 正常監聽和廣播
4. `Vivi Drop Sidecar TCP / Vivi Drop Sidecar HTTP / Vivi Drop mDNS UDP` 防火牆規則已寫入；Task 15 保留既有 firewall/mDNS identity，命名遷移留到後續 native/binary/mDNS migration 任務
5. 設定頁 Bonjour 執行時 / fallback 文案正常
6. 診斷包匯出正常

### 8.5 Linux

1. 從 `LynavoDrive-*-linux-*.deb` fresh install
2. app 正常啟動
3. sidecar 正常監聽 `39393/TCP` 與 `39394/TCP`
4. mDNS / zeroconf 廣播可被真機 mobile 發現，網路允許 `5353/UDP`
5. 設定頁 Linux 共享提示不顯示 macOS 或 Windows 專屬操作
6. iOS 真機可配對並完成一輪真實素材上傳
7. Android 真機可配對並完成一輪真實素材上傳
8. 重啟 desktop 後 paired state、history、received library 正常保留

## 9. 發佈物與記錄

建議每次 beta 都在發佈記錄裡明確寫出：

1. iOS build：例如 `0.1.0 (6)`
2. Android build：註明 Debug build 版本與提交
3. desktop build：例如 `0.1.0 (6)`，並註明平台（macOS / Windows / Linux）
4. git tag：例如 `beta/v0.1.0-b6`
5. 對應提交 SHA
6. 本輪重點驗證項
7. 已知限制

## 10. 目前已指令碼化的入口

正式打包、Review 打包、TestFlight 上傳、Android APK 與 desktop DMG/EXE/DEB 打包都必須先選 release profile：

```bash
pnpm release --profile prod --targets ios,mac,win,linux
pnpm release --profile review --targets ios,mac,win,linux
```

Android APK & AAB 可加入 `android` target：

```bash
pnpm release --profile review --targets android,mac,win,linux
```

Android release target 會透過 Gradle 從
`apps/mobile/ios/LynavoDrive.xcodeproj/project.pbxproj` 讀取
`MARKETING_VERSION` / `CURRENT_PROJECT_VERSION`，不要在
`apps/mobile/android/app/build.gradle` 另外手動維護 Android
`versionName` / `versionCode`。

可用 `--dry-run` 檢查實際會執行的 release channel、base URL 與命令，不會打包或上傳：

```bash
pnpm release --profile review --targets ios,mac,win,linux --dry-run
```

AI 或人工發佈時不得手動拼接歷史 market 或 API base URL 環境變數來代替 profile。`prod` profile 不允許使用 Review Server；`review` profile 的 backend URL 必須是 review API。

倉庫根目錄已有以下底層指令碼，供 release profile 調度或本地開發驗證使用；正式 / Review 發佈不要直接把它們當成入口：

```bash
SERVER_ENV_FILE=/path/to/vivi-drop-server/.env.prod pnpm package:mobile:testflight
pnpm build:mobile:android
pnpm package:desktop:signed
pnpm package:desktop:win
pnpm package:desktop:linux
pnpm tag:beta
```

上述根目錄指令碼是目前 beta 階段可用工具；正式 / Review 發佈仍以 release profile 統一調度，不再建議臨時發明另一套手工步驟。package scope、mDNS service、舊 data-dir 和 native package / bundle rename 是後續遷移任務，不在本發佈手冊步驟中執行。
