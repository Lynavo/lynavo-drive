# Lynavo Drive Release Channel Flow

本文件取代歷史多市場發佈流程。Lynavo Drive 目前是 global-only OSS baseline，只保留 `review` 和 `prod` 兩個 release channel；不再推薦或維護 CN / Global 雙市場 profile、分支或回歸表。

## 1. Release Channel

正式發佈與 Review 打包都必須使用根目錄 release profile：

```bash
pnpm release --profile review --targets ios,android,mac,win,linux
pnpm release --profile prod --targets ios,android,mac,win,linux
```

如果只確認會執行什麼：

```bash
pnpm release --profile review --targets ios,android,mac,win,linux --dry-run
```

規則：

1. `review` 必須使用 review API，供 App Review、TestFlight 或內部審核包驗證。
2. `prod` 不得使用 review API。
3. release profile 負責注入 `LYNAVO_RELEASE_CHANNEL` 和 Lynavo API base URL。
4. 不允許用歷史 market env 或手動 base URL 拼接替代 profile。
5. `package:desktop:*`、Gradle、Xcode 或 Electron builder 單平台命令只用於本地驗證；正式發佈仍以 `pnpm release` 為入口。

## 2. Branching And Hotfix

不再按市場維護 `release/cn` 和 `release/global` 分支。建議流程：

1. 所有修復先進入主開發分支或對應 feature branch。
2. 發佈候選從同一份 global-only 程式碼產出。
3. 緊急修復仍遵循 dev-first 原則：先在主線修復並驗證，再 cherry-pick 到需要補發的 release branch。
4. 補發時遞增 build number，使用同一套 `review` / `prod` profile 打包。

## 3. OSS / Commercial Boundary

Community build 必須保留前景 LAN 同步能力：

1. guest/local 使用者可在前景 LAN 內發現 desktop、配對、掃描素材並從 pending queue 自動上傳。
2. 佇列是只讀的自動增量同步結果，不提供手動選檔、刪除、跳過或重排作為替代路徑。
3. foreground LAN fail-open：登入、訂閱、官方商業模組缺失都不應阻斷本地前景 LAN 同步。

官方商業能力必須 fail closed：

1. remote access、tunnel credentials、relay、cloud-assisted route 必須有有效 entitlement。
2. background continuation / silent background upload 必須同時具備官方 native capability 和有效 entitlement。
3. entitlement 缺失、過期、無法確認或官方 capability 不存在時，遠程和背景能力保持關閉。

## 4. Beta Tag

TestFlight 打包上傳後仍保留跨倉庫 tag 規則。tag 名稱與 Lynavo Drive TestFlight build 對齊：

```text
beta/v<MARKETING_VERSION>-b<CURRENT_PROJECT_VERSION>
```

例如：

```text
beta/v1.0.0-b37
```

需要打 tag 的倉庫仍為：

1. `/Volumes/T7/Dev/Web/SyncFlow`
2. `/Volumes/T7/Dev/Web/vivi-drop-server`

兩邊必須使用同一個 tag 名稱；若推送遠端 tag，也必須兩邊都推送。

## 5. Deferred Migration Boundaries

以下項目是後續遷移邊界，不在 release channel rewrite 中執行：

1. package scope rename。
2. mDNS service type 和 sidecar health service rename。
3. 舊 data-dir、keychain、shared-preference migration。
4. iOS bundle id、Android application id、native package namespace rename。
5. store listing 和既有 App Store / Play continuity 決策。
