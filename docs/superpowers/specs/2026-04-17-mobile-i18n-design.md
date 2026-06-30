# SyncFlow Mobile — 多語言支援（簡體中文 + 英文）設計文件

- **日期**：2026-04-17
- **範圍**：`apps/mobile`（React Native app）
- **狀態**：待實作計劃
- **作者**：Brett（與 AI 協作 brainstorm）

---

## 1. 背景

SyncFlow Mobile 目前所有 UI 文字硬編碼為簡體中文，面向大陸市場（bundle ID `com.vividrop.mobile.china`）。為了準備後續出海與英語使用者測試，需要引入 i18n 框架，先支援 **簡體中文（zh）** 與 **英文（en）** 兩語言。

本設計的目標是：以最小架構成本完成雙語化，並為未來擴充額外語言保留彈性。

## 2. 目標與非目標

### 2.1 目標

- 支援簡體中文與英文兩語言，依系統 locale 自動切換。
- 涵蓋 JS 側所有使用者可見文字（screens、components、Alert、錯誤訊息）。
- 建立可擴展的 key 命名規則與 `AppError` 錯誤碼體系，避免日後硬編碼回歸。
- 提供型別安全的翻譯 API（`t('settings.title')` IDE 自動補全，拼錯 key 編譯期發現）。

### 2.2 非目標

- 不提供 Settings 內的手動語言切換入口。
- 不維護繁體中文（zh-Hant）獨立翻譯；繁體系統 fallback 至英文。
- 不翻譯 iOS SyncEngine（Swift）與 Android NativeSyncEngineModule（Kotlin）中的原生字串；bridge 回 JS 時原樣顯示。
- 不支援運行時熱切換：使用者切換系統語言需重啟 app 後生效。
- 不翻譯後端 API 回傳的中文錯誤訊息；UI 僅以 HTTP status code / error code 映射到 i18n key。

## 3. 核心決策

| 決策 | 選擇 | 理由 |
|---|---|---|
| 切換入口 | 只跟隨系統 locale | 簡化架構，免 UI 改動與持久化 |
| 中文變體 | 單一 `zh`（簡體） | 主市場為大陸，維護一套即可 |
| Fallback | 非 zh/en 系統 fallback `en` | 英文為國際通用語言 |
| 範圍 | JS 側 UI + JS 側錯誤訊息 | native 層字串可走 bridge error code 轉譯 |
| 套件 | `react-i18next` + `react-native-localize` | TS 型別推導、生態最成熟 |
| Key 組織 | 單一 JSON + namespace 巢狀 | 500 條字串規模下讀寫比最佳 |

## 4. 架構設計

### 4.1 目錄結構

```
apps/mobile/src/
├── i18n/
│   ├── index.ts              # i18next 初始化、locale 解析、side-effect 綁定
│   ├── types.ts              # declare module 'i18next' 型別注入
│   ├── locale-resolver.ts    # 純函式：系統 locale list → 'zh' | 'en'
│   └── locales/
│       ├── zh.json
│       └── en.json
├── utils/
│   └── app-error.ts          # AppError 類別
└── App.tsx                   # import './i18n' side-effect init
```

### 4.2 套件

```json
{
  "dependencies": {
    "i18next": "^23.x",
    "react-i18next": "^15.x",
    "react-native-localize": "^3.x"
  }
}
```

三個套件都是純 JS，無 autolinking 成本；iOS 僅需 `pod install`（`react-native-localize` 含 native 部分）。

### 4.3 初始化流程

`src/i18n/index.ts`（偽代碼）：

```ts
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as RNLocalize from 'react-native-localize';
import zh from './locales/zh.json';
import en from './locales/en.json';
import { resolveLocale } from './locale-resolver';

const lng = resolveLocale(RNLocalize.getLocales());

i18next.use(initReactI18next).init({
  resources: { zh: { translation: zh }, en: { translation: en } },
  lng,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
  missingInterpolationHandler: __DEV__ ? (text, value) => {
    console.warn('[i18n] missing interpolation', { text, value });
  } : undefined,
});

export default i18next;
```

`src/i18n/locale-resolver.ts`：

```ts
import type { Locale } from 'react-native-localize';

export type SupportedLocale = 'zh' | 'en';

export function resolveLocale(locales: readonly Locale[]): SupportedLocale {
  for (const l of locales) {
    if (l.languageCode === 'zh' && (l.scriptCode === 'Hans' || l.scriptCode === undefined)) {
      return 'zh';
    }
  }
  return 'en';
}
```

> 繁體中文（`zh-Hant-*`）會被 `scriptCode === 'Hans'` 過濾掉，落到 `en`；這是刻意設計。

### 4.4 型別注入

`src/i18n/types.ts`：

```ts
import 'react-i18next';
import type zh from './locales/zh.json';

declare module 'react-i18next' {
  interface CustomTypeOptions {
    resources: { translation: typeof zh };
    returnNull: false;
  }
}
```

此檔只需 import 一次（透過 `tsconfig.json` 的 `include` 或在 `App.tsx` 頂部 `import './i18n/types'`），就能讓 `t('...')` 全專案自動補全。

### 4.5 元件使用模式

```tsx
import { useTranslation } from 'react-i18next';

export function SettingsScreen() {
  const { t } = useTranslation();
  return <Text>{t('settings.title')}</Text>;
}
```

不額外封裝 `useT` hook——保留官方 API 降低學習成本。

### 4.6 錯誤處理模式

`src/utils/app-error.ts`：

```ts
export class AppError extends Error {
  constructor(
    public readonly code: string,           // 對應 i18n key，例如 'errors.authInvalidPhone'
    public readonly params?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'AppError';
  }
}
```

使用：

```ts
// service 層
if (!isValidPhone(phone)) {
  throw new AppError('errors.authInvalidPhone');
}

// UI 層
try {
  await loginService.requestCode(phone);
} catch (e) {
  const msg = e instanceof AppError
    ? t(e.code, e.params)
    : t('errors.unknown');
  Alert.alert(t('errors.title'), msg);
}
```

**原則**：`AppError.code` 與 i18n key 一對一，不做額外 mapping 層。

## 5. 翻譯資源結構

> **術語澄清**：本節所稱「分組（group）」指 JSON 頂層 key 的邏輯分類，與 i18next 自身的 `namespace` 機制無關。全專案只使用單一 i18next namespace（預設 `translation`），所有翻譯放在同一份 JSON。

### 5.1 頂層 key 分組

按 screens 模組切分頂層 key，共用文字抽 `common`，錯誤集中 `errors`：

```
translation（i18next 預設 namespace，僅此一個）
├── common          # 跨 screen 共用（ok / cancel / back / retry ...）
├── auth
│   ├── login
│   └── smsVerify
├── settings
├── syncActivity
├── albumWorkbench
├── sharedFiles
├── history
├── help
├── deviceDiscovery
├── qrScanner
├── codeVerify
├── syncStatus
├── subscription
└── errors          # 集中管理所有可拋錯誤訊息
```

### 5.2 命名規則

| 層級 | 規則 | 範例 |
|---|---|---|
| 頂層分組 | 對應 screens 目錄名 camelCase | `syncActivity`、`albumWorkbench` |
| leaf key | 動詞/名詞 camelCase；動態值 `{{param}}` | `uploadingFile`、`resendIn` |
| plural | i18next 後綴 `_one` / `_other` | `selectedCount_one` / `selectedCount_other` |
| error | `errors.*`，`AppError.code` 與 key 同名 | `errors.authInvalidPhone` |

### 5.3 插值規則

- 所有動態值使用 `{{name}}` 雙大括號。
- **禁止** 字串拼接（如 `'已上传 ' + count + ' 张'`）——英文語序不同會壞。
- 版本號、裝置名、檔名等不翻譯專有名詞也走 `{{param}}` 傳入。

### 5.4 Plural 處理

- 中文無複數概念，只需 `_other`。
- 英文需同時提供 `_one`（count === 1）與 `_other`（其他）。
- 呼叫：`t('albumWorkbench.selectedCount', { count: n })`——i18next 自動挑變體。

### 5.5 範例 JSON 片段

`zh.json`：

```json
{
  "common": {
    "ok": "好",
    "cancel": "取消",
    "confirm": "确认",
    "back": "返回",
    "retry": "重试",
    "loading": "加载中",
    "unknownVersion": "未知版本"
  },
  "settings": {
    "title": "设置",
    "logout": "退出登录",
    "versionLabel": "v{{version}} ({{build}})",
    "diagnostics": {
      "export": "导出诊断包",
      "exporting": "导出中"
    }
  },
  "errors": {
    "title": "错误",
    "unknown": "发生未知错误",
    "authInvalidPhone": "手机号无效",
    "networkUnavailable": "网络不可用",
    "sidecarUnreachable": "无法连接到桌面端"
  }
}
```

## 6. 遷移策略

### 6.1 階段劃分

| 階段 | 範圍 | 備註 |
|---|---|---|
| P0 基礎建設 | 安裝套件、建立 `src/i18n/*`、`AppError`、型別注入、`App.tsx` 掛載 | 不動業務程式碼 |
| P1 共用層 | `common.*`、`errors.*`、`Icon` 等共用 component | 共用優先，後續 screens 直接引用 |
| P2 入口流程 | `LoginScreen`、`SmsVerifyScreen`、`AuthScreenShell` | 英文使用者首次可見區 |
| P3 主要 Tab Screens | `SyncActivityScreen`、`SettingsScreen`、`AlbumWorkbenchScreen` | 使用頻率最高 |
| P4 次要 Screens | `DeviceDiscoveryScreen`、`QRScannerScreen`、`CodeVerifyScreen`、`HistoryScreen`、`SharedFilesScreen`、`HelpScreen`、`SubscriptionScreen`、`SyncStatusScreen` | 批量處理 |
| P5 錯誤訊息回收 | `services/auth-service.ts`、`services/api.ts`、`services/subscription-service.ts`、`utils/phone-validation.ts` 的 `throw new Error(...)` | 改用 `AppError(code)` |
| P6 英文譯文補齊 | `en.json` 全量翻譯 | 可邊做邊翻，也可最後集中翻 |

可視工作節奏開一個大 PR 或拆 6 個 sub-PR；下游 writing-plans 階段決定。

### 6.2 字串抽取工具

`scripts/extract-cjk.mjs`：

- 掃 `apps/mobile/src/**/*.{ts,tsx}`（排除 `__tests__`、`i18n/locales/zh.json`）。
- 偵測字串字面量中含 CJK Unified Ideographs（`\u4e00-\u9fa5`）。
- 輸出 CSV：`file,line,text,context`。
- **不做自動替換**——避免破壞 `'正在上传 ' + filename` 這類拼接式寫法的 context。

腳本在 P1–P5 期間作為參考，也在驗收階段用來驗證殘留。

## 7. 測試策略

| 測試 | 對象 | 重點 |
|---|---|---|
| Unit | `src/i18n/__tests__/locale-resolver.test.ts` | `zh-Hans-CN` → `zh`；`en-US` → `en`；`ja-JP` → `en`；`zh-Hant-TW` → `en` |
| Unit | `src/utils/__tests__/app-error.test.ts` | code / params 正確；`instanceof AppError` 成立 |
| Component | 2-3 個 screen（`LoginScreen`、`SettingsScreen`）用 `@testing-library/react-native` 渲染，切換 `i18next.changeLanguage()` 驗證關鍵文字 | 確保 `useTranslation` 在 re-render 時正常綁定 |

**不做**：

- Snapshot 測試（翻譯變動維護成本高）。
- ESLint `i18next/no-literal-string` 規則（誤報率高，列入後續考慮）。

## 8. 邊界情況

| 情況 | 處理 |
|---|---|
| 系統 locale 在 app 開啟中被切換 | 不處理；下次冷啟動生效 |
| 翻譯 key 缺失 | `fallbackLng: 'en'`；英文也缺則顯示 key 本身（便於發現漏譯） |
| 插值 param 缺失 | dev mode 透過 `missingInterpolationHandler` 印 warning；prod 保留 `{{param}}` 字面 |
| 原生層拋的中文訊息（bridge 回 JS） | 原樣顯示——不在本次範圍 |
| 繁體中文系統 | fallback 至英文（預期行為） |
| 日期/數字格式 | 使用 Hermes 內建 `Intl.DateTimeFormat` / `Intl.NumberFormat`，語言傳 `i18next.language`——不走 i18next 翻譯系統 |
| Alert.alert 的 title 空字串 | 沿用現況，不強制 |
| 後端 API 中文錯誤訊息 | UI 以 HTTP status / error code 映射到 `errors.*`；不直接顯示原始字串 |

## 9. 回歸驗證

- [ ] `pnpm --filter @lynavo-drive/mobile exec tsc --noEmit` 通過（型別注入無誤）
- [ ] `pnpm --filter @lynavo-drive/mobile test` 通過
- [ ] iOS/Android 冷啟動在 `zh-Hans-CN` locale 顯示簡體
- [ ] iOS/Android 切至 `en-US` locale 後重啟顯示英文
- [ ] `zh-Hant-TW` locale 重啟顯示英文（fallback 驗證）
- [ ] 所有 `throw new Error('中文')` 已改 `AppError`，UI 層正確 catch 並翻譯
- [ ] `scripts/extract-cjk.mjs` 第二輪掃描回報 **零** CJK 殘留（除 `zh.json`）

## 10. 未來擴充方向（非本次範圍）

- Settings 新增手動語言切換入口（持久化至 `AsyncStorage`）。
- 繁體中文（`zh-Hant`）獨立翻譯。
- 運行時熱切換（監聽 `RNLocalize.addEventListener('change', ...)`，呼叫 `i18next.changeLanguage`）。
- iOS / Android 原生層字串 i18n（`NSLocalizedString` + Android `strings.xml`）。
- 自動翻譯 CI（漏譯時阻擋 merge）。
- 加入日文、韓文等出海市場語言。

## 11. 風險

| 風險 | 機率 | 影響 | 緩解 |
|---|---|---|---|
| 硬編碼字串日後回歸 | 中 | 中 | 階段尾用 `extract-cjk.mjs` 掃；未來可考慮啟用 ESLint 規則 |
| `AppError` 改造漏掉 service 層某條 `throw` | 中 | 低 | CSV 報告覆蓋 services/ 目錄；Code review 時逐條比對 |
| i18next 型別注入配置失敗（`t()` 補全失效） | 低 | 中 | P0 階段驗收時手動測試自動補全 |
| 英文翻譯品質不一致（語氣、大小寫、標點） | 中 | 低 | P6 集中翻譯時建立 style guide（句末標點、title case 等） |
| Hermes `Intl` API 在某些舊 RN 版本有 bug | 低 | 低 | RN 0.84 已預設啟用 Hermes Intl；若出包時發現問題再 polyfill |
