# Vivi Drop Beta 發佈手冊

本文件是目前 beta 發佈的總入口。iOS TestFlight、desktop 安裝包（macOS / Windows）和 beta tag 都按這裡的順序執行。

詳細步驟仍然分別落在：

- `docs/release/ios-testflight.md`
- `docs/release/macos-desktop-signing.md`

Windows 桌面包目前直接走根目錄指令碼 `pnpm package:desktop:win`，詳細約束以目前程式碼和本文件為準。

## 1. 目前版本規則

目前統一規則：

1. 對外版本：`0.1.0`
2. beta build：使用 iOS `CURRENT_PROJECT_VERSION`
3. desktop build number 跟隨 iOS build number
4. beta tag 格式：`beta/v<MARKETING_VERSION>-b<CURRENT_PROJECT_VERSION>`

例如：

- `0.1.0 (6)`
- `beta/v0.1.0-b6`

## 2. 發佈前檢查

在倉庫根目錄確認：

```bash
git status --short
pnpm --filter @syncflow/mobile exec tsc --noEmit
pnpm --filter @syncflow/desktop test
pnpm --filter @syncflow/desktop typecheck
cd services/sidecar-go && go test ./...
```

還要滿足：

1. iOS Debug / Release build 通過
2. 關鍵真機回歸過一輪
3. 目前工作區乾淨

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

從倉庫根目錄執行：

```bash
pnpm package:mobile:testflight
```

如果你想拆步：

```bash
pnpm package:mobile:testflight:archive
pnpm package:mobile:testflight:upload
```

產物位置：

- `apps/mobile/ios/build/archives/ViviDrop-<version>-b<build>.xcarchive`

上傳成功後：

1. 去 App Store Connect `TestFlight`
2. 等 build 從 `Processing` 變為可用
3. 填 beta 說明

## 5. 出 desktop 安裝包

### 5.1 macOS signed DMG

從倉庫根目錄執行：

```bash
pnpm package:desktop:signed
```

如果只做本地驗籤：

```bash
pnpm package:desktop:signed:dir
```

產物位置：

- `apps/desktop/release/ViviDrop-0.1.0-arm64.dmg`
- `apps/desktop/release/ViviDrop-0.1.0-x64.dmg`
- `apps/desktop/release/mac*/Vivi Drop.app`

發佈前至少確認：

```bash
for app in apps/desktop/release/mac*/Vivi\ Drop.app; do
  spctl --assess --type execute -vv "$app"
done
hdiutil verify apps/desktop/release/ViviDrop-0.1.0-arm64.dmg
hdiutil verify apps/desktop/release/ViviDrop-0.1.0-x64.dmg
```

### 5.2 Windows NSIS / ZIP

從倉庫根目錄執行：

```bash
pnpm package:desktop:win
```

產物位置：

- `apps/desktop/release/ViviDrop-0.1.0-x64.exe`
- `apps/desktop/release/ViviDrop-0.1.0-x64.zip`

發佈前至少確認：

1. fresh install 後 app 能正常啟動
2. `resources\vivi-drop-sidecar.exe` 已隨包落地並能被 desktop 拉起
3. 安裝器已寫入 `Vivi Drop Sidecar TCP` 和 `Vivi Drop mDNS UDP` 防火牆規則
4. 設定頁能看到 Bonjour 執行時資訊，缺少 Bonjour 時 fallback 狀態可解釋

## 6. 打 beta tag

只有在這些發佈物都完成後再打 tag：

1. TestFlight 上傳成功
2. 本輪目標平台的 desktop 安裝包已完成並驗收

執行：

```bash
pnpm tag:beta
```

如果要直接推遠端 tag：

```bash
pnpm tag:beta:push
```

## 7. 推薦發佈順序

每次 beta 都按這個固定順序，避免遺漏：

1. 遞增 iOS build number
2. 跑預檢測試
3. 發 iOS TestFlight
4. 出 macOS signed DMG
5. 如本輪包含 Windows，出 Windows NSIS / ZIP
6. 打 beta tag
7. 確認工作區乾淨
8. 推程式碼和 tag
9. 等 TestFlight processing 完成後再擴大測試範圍

## 8. 發佈後的最小冒煙

### 8.1 iOS

1. fresh install
2. 配對
3. 同步一輪真實素材
4. 切背景繼續上傳
5. 中途斷網恢復
6. 歷史和設定頁狀態正常

### 8.2 macOS

1. 從 DMG fresh install
2. app 正常啟動
3. sidecar 正常監聽和廣播
4. 設定頁版本正確
5. 診斷包匯出正常
6. detail 分頁、排序、滾動正常

### 8.3 Windows

1. 從 `ViviDrop-Setup.exe` fresh install
2. app 正常啟動
3. sidecar 正常監聽和廣播
4. `Vivi Drop Sidecar TCP / Vivi Drop mDNS UDP` 防火牆規則已寫入
5. 設定頁 Bonjour 執行時 / fallback 文案正常
6. 診斷包匯出正常

## 9. 發佈物與記錄

建議每次 beta 都在發佈記錄裡明確寫出：

1. iOS build：例如 `0.1.0 (6)`
2. desktop build：例如 `0.1.0 (6)`，並註明平台（macOS / Windows）
3. git tag：例如 `beta/v0.1.0-b6`
4. 對應提交 SHA
5. 本輪重點驗證項
6. 已知限制

## 10. 目前已指令碼化的入口

倉庫根目錄已有：

```bash
pnpm package:mobile:testflight
pnpm package:desktop:signed
pnpm package:desktop:win
pnpm tag:beta
```

這些指令碼就是目前 beta 階段標準路徑，不再建議臨時發明另一套手工步驟。
