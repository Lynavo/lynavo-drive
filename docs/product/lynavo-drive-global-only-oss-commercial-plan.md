# Lynavo Drive Global-only 开源 / 商业化实施计划

> 版本：2026-06-29 更新版  
> 输入基线：当前 `vividrop-client-dev` 代码包 + 原《Global Commercial Boundary Implementation Plan》  
> 核心新增决策：开源版本只保留 `global` 语义；不再保留 `cn/global` 路径 switch；默认就是 global；项目名从 **Vivi Drop** 迁移为 **Lynavo Drive**。

---

## 0. 一句话结论

新版计划不再把目标描述为“在现有 cn/global 双市场代码里放开 global 免费能力”，而是改成：

**把当前仓库抽取 / 收敛成一个名为 Lynavo Drive 的 global-only 开源基线。开源仓库默认就是 global local-first 产品，不再存在 market、activeMarket、isGlobalMarket、isChinaMarket、cn profile、global profile 这类业务路径 switch。商业能力只通过 feature entitlement 和官方商业模块 / 服务端能力解锁，而不是通过 cn/global 路径分叉实现。**

这会影响原计划中所有“cn 保持现状 / cn regression / market fallback”的写法。对于开源版，`cn` 不再是需要兼容的路径，而是需要从开源仓库移除的历史市场实现。若仍需维护中国区旧产品，应放在私有仓库、历史分支或单独商业仓库中，不应残留在 Lynavo Drive 开源主干里。

---

## 1. 产品与仓库定位

### 1.1 新产品名

目标产品名：**Lynavo Drive**。

命名范围分三层处理：

| 层级            | 目标                                                                                                           | 是否必须在第一阶段完成                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 用户可见品牌    | App 名称、Desktop 名称、安装包名、窗口 title、权限说明、通知文案、下载页、README                               | 必须                                                    |
| 构建 / 发布身份 | bundle id、application id、appId、URL scheme、IAP product id、artifact name、installer shortcut、firewall rule | 必须，但 bundle id/IAP 需确认商店迁移策略               |
| 内部命名空间    | `@syncflow/*`、`SyncFlowMobile`、`syncflow-sidecar`、Go module、mDNS service type、数据库文件名、日志 tag      | 建议分阶段；若重命名成本过高，可先建立 legacy allowlist |

建议第一阶段至少做到：用户看到的所有 **Vivi Drop** 都变成 **Lynavo Drive**；开源仓库名、README、package metadata、安装包名、App display name、desktop productName 全部改名。内部 `SyncFlow` 命名如果无法一次性全部改完，需要建立 `docs/rename/legacy-name-allowlist.md`，明确哪些是短期协议 / 存量兼容名称，不能无限期散落。

### 1.2 开源版定位

开源版是 **Lynavo Drive Community / OSS**，不是 Vivi Drop global profile。

开源版能力边界：

- 默认 global，不要求登录即可使用本地局域网同步。
- 保留 App 前台运行时的自动扫描、pending queue、单文件串行上传、增量上传。
- 保留 Desktop / sidecar 的本地发现、配对、本地接收、本地历史。
- 不保留 cn 登录、短信、支付宝、微信、cn API、cn release profile、cn UI、cn assets。
- 不新增手动挑选文件上传路径来替代自动上传。
- 后台 / 锁屏继续上传和远程穿透是商业能力，必须和开源基础能力拆开。

### 1.3 商业版定位

商业版建议命名为 **Lynavo Drive Official**，仍然基于 global-only 产品主线，但额外具备：

- 登录 / 恢复购买 / 订阅管理。
- 后台 / 锁屏继续上传。
- 远程穿透访问。
- 官方 TURN / signaling / entitlement 服务。
- App Store / Google Play / Desktop 官方签名、自动更新、商业渠道发布。

重要边界：商业版不是 `cn/global` switch 的另一条市场路径；商业差异应该是 **distribution / entitlement / service capability**，不是 market switch。

### 1.4 旧 cn 产品的处置

对于开源仓库：

- `cn` 代码应删除，不再要求 cn regression。
- `cn-prod`、`cn-review`、`electron-builder.cn.yml`、Android `cn` flavor、iOS CN scheme 不应出现在开源主干。
- 中国区旧产品如果仍需维护，应迁到私有仓库或历史分支，例如 `vividrop-cn-private`，并由私有发布流程维护。

对于商业组织内部：

- 可在私有仓库保留 cn 历史代码，但不要让它反向污染 Lynavo Drive OSS。
- 如果必须共享某些底层协议或修复，应通过干净的共享包或 cherry-pick 回流，不要重新引入 market switch。

---

## 2. 当前代码中的双路径与命名现状

### 2.1 market / release profile 分叉

当前代码里已经有完整的 cn/global 双市场机制：

- `scripts/release/release-profiles.mjs` 定义 `cn-prod`、`global-prod`、`cn-review`、`global-review`。
- release profile 会注入 `SYNCFLOW_MARKET`、`SYNCFLOW_API_BASE_URL`、`VIVIDROP_API_BASE_URL`、`ELECTRON_BUILDER_CONFIG`。
- `apps/desktop/src/shared/market.ts` 通过 `process.env.SYNCFLOW_MARKET === 'global'` 判断 global。
- `apps/mobile/src/markets/index.ts` 从 native module、`process.env.SYNCFLOW_MARKET`、`mobileReleaseProfile.market` 等多处解析 active market，并 fallback 到 `cn`。
- mobile 有 `apps/mobile/src/markets/cn/config.ts` 和 `apps/mobile/src/markets/global/config.ts`。
- Android 有 `flavorDimensions "market"` 和 `productFlavors { cn { ... } global { ... } }`。
- iOS 有 `SyncFlowMobileCN.xcscheme`、`SyncFlowMobileGlobal.xcscheme`、`DebugGlobal` / `ReleaseGlobal` 配置、`SYNCFLOW_MARKET` build setting。

这说明“默认 global、无路径 switch”不是改一个默认值即可完成，而是需要系统性删除 market 抽象。

### 2.2 cn 代码和依赖残留

当前仓库内有多类 cn 相关内容：

- Mobile JS：`src/markets/cn`、`activeMarket === 'global' ? ... : cnMarketConfig`、`isChinaMarket()`、短信 / 手机号校验 / cn wallets routing。
- Android：`applicationId "com.vividrop.mobile.china"`、`cnImplementation` 支付宝 / 微信依赖、`WXPayEntryActivity`、`com.tencent.mm` query、`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` 仅 cn manifest。
- Desktop：`package:cn`、`package:win:cn`、`package:linux:cn`、`electron-builder.cn.yml`。
- Release docs/tests：大量 `cn-review`、`cn-prod`、`global-review`、`global-prod` 测试和命令。

这些内容在 Lynavo Drive 开源版中应该删除或迁出，而不是继续做 fallback。

### 2.3 品牌 / 命名残留

当前代码同时存在多套历史命名：

- 产品可见名：`Vivi Drop`。
- 根仓库名：`vivi-drop`。
- desktop package：`@syncflow/desktop`，`productName: "Vivi Drop"`。
- mobile package：`@syncflow/mobile`。
- contracts 包：`@syncflow/contracts`。
- binary：`syncflow-sidecar`。
- Go module：`github.com/nicksyncflow/sidecar`。
- Android package：`com.vividrop.mobile.china`，global applicationId 为 `com.vividrop.mobile.global`。
- iOS project / workspace / scheme：`SyncFlowMobile`。
- URL scheme：`vividrop://auth`。
- env：`VIVIDROP_*`、`SYNCFLOW_*`。
- App display name / permissions / notifications：`Vivi Drop`。
- Desktop artifact：`ViviDrop-${version}`。
- data dir：`Vivi Drop`。

Lynavo Drive 迁移需要明确“哪些必须立即改、哪些可短期保留为 legacy compatibility”。

---

## 3. 目标架构：global-only + feature entitlement

### 3.1 删除 market，保留 channel

迁移后不再有：

```ts
export type Market = 'cn' | 'global';
export const activeMarket: Market = ...;
export function isGlobalMarket(): boolean;
export function isChinaMarket(): boolean;
```

替代概念：

```ts
export type ReleaseChannel = 'dev' | 'review' | 'prod';
export type Distribution = 'community' | 'official';
```

含义区分：

| 概念                                | 是否允许 | 用途                                                                  |
| ----------------------------------- | -------- | --------------------------------------------------------------------- |
| `market = cn/global`                | 不允许   | 已废弃，不应进入开源主干                                              |
| `releaseChannel = dev/review/prod`  | 允许     | 控制 API base、签名、商店发布目标                                     |
| `distribution = community/official` | 谨慎允许 | 控制是否打入官方商业模块、IAP、远程服务；不能变成另一个 market switch |
| runtime entitlement                 | 必须     | 控制后台继续、远程穿透等商业能力                                      |

### 3.2 单一 App config

迁移后 mobile 不再需要 `src/markets/index.ts`、`src/markets/cn/config.ts`、`src/markets/global/config.ts`。

建议替换为：

```ts
// apps/mobile/src/config/app-config.ts
export const appConfig = {
  productName: 'Lynavo Drive',
  bundleId: 'com.lynavo.drive.mobile',
  apiBaseUrl: releaseApiBaseUrl,
  reviewApiBaseUrl: LYNAVO_REVIEW_API_BASE_URL,
  privacyUrl: `${LYNAVO_WEB_BASE_URL}/privacy`,
  termsUrl: `${LYNAVO_WEB_BASE_URL}/terms`,
  loginProviders: ['apple', 'google'],
  supportEmail: LYNAVO_SUPPORT_EMAIL,
} as const;
```

Desktop 同理：

```ts
// apps/desktop/src/shared/product.ts
export const PRODUCT_NAME = 'Lynavo Drive';
export const PRODUCT_SLUG = 'lynavo-drive';
export const DESKTOP_APP_ID = 'com.lynavo.drive.desktop';
```

### 3.3 权益模型不再带 market

原计划建议 `CommercialEntitlements.market: 'global' | 'cn'`。在 global-only 开源版中，这个字段应该删除。

建议改成：

```ts
export type DriveFeatureKey = 'lan_foreground_auto_upload';

export type EntitlementSource =
  | 'guest'
  | 'free_account'
  | 'subscription'
  | 'trial'
  | 'gift_card'
  | 'legacy'
  | 'official_override'
  | 'unknown';

export interface DriveEntitlements {
  canUseLanForegroundAutoUpload: boolean;
  source: EntitlementSource;
  expiresAt: string | null;
  checkedAt: string | null;
}
```

默认策略：

| 用户 / 构建状态               | 局域网前台自动上传 | 后台 / 锁屏继续     | 远程穿透            |
| ----------------------------- | ------------------ | ------------------- | ------------------- |
| OSS guest                     | 允许               | 不允许              | 不允许              |
| Official overlay              | 允许               | 由私有 overlay 决定 | 由私有 overlay 决定 |
| entitlement unknown / expired | 允许               | 不允许              | 不允许              |

Fail-open / fail-closed：

- `lan_foreground_auto_upload` 对 guest、离线、订阅未知 fail-open。
- 商业后台继续和远程穿透不再作为 OSS contract 字段存在。
- OSS build 中如果没有官方商业模块，不应保留可被本地打开的商业 native path。

### 3.4 商业能力的开源边界

这是比“cn/global 删除”更关键的商业化边界。

远程穿透天然依赖官方服务端的 TURN / signaling / device auth，即使客户端开源，服务端也能 fail-closed。因此远程商业化可以主要靠服务端 entitlement 守住。

后台 / 锁屏继续上传不同：它主要是本地 native 能力。如果完整后台实现全部开源，用户理论上可以自编译绕过 JS entitlement。因此有两种路线：

| 路线             | 做法                                                                                                                                                                    | 优点                                         | 风险                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------- |
| 强商业隔离，推荐 | OSS 只保留前台 LAN 同步；paid background 的 native continuation、silent audio、background URLSession chain、Android FGS continuation 放入官方私有模块或 private overlay | 商业边界清晰，自编译不能轻易解锁付费本地能力 | 工程上需要维护 official overlay / private package |
| 全开源弱约束     | OSS 包含完整后台代码，但 entitlement 默认 false；官方 build 通过订阅打开                                                                                                | 社区透明，工程简单                           | 用户可 fork 解锁后台，本地付费点弱化              |

建议采用强商业隔离：

- OSS 仓库保留前台同步需要的最小 native 能力。
- Paid background 的持续后台调度、silent audio、background URLSession 链式推进、Android background FGS continuation 放到 `@lynavo-drive/commercial-mobile` 或私有 native patch。
- OSS 中不保留可从 JS 打开的商业 entitlement bridge；后台 continuation / tunnel 的正向实现放入官方 overlay。
- 远程穿透的 TURN credential 获取、官方 signaling 和 native tunnel runtime 不进入 OSS baseline。

---

## 4. 代码迁移总原则

### 4.1 不要把 `global` 改成默认值后继续保留 switch

不推荐：

```ts
const activeMarket = process.env.SYNCFLOW_MARKET ?? 'global';
if (activeMarket === 'cn') { ... }
```

因为这只是把默认值换成 global，cn 路径仍然在开源仓库里。

推荐：

```ts
export const appConfig = { productName: 'Lynavo Drive', ... } as const;
```

代码里不再知道 cn 的存在。

### 4.2 不用 market profile 控制商业能力

不推荐：

```ts
if (isGlobalMarket() && isSubscribed) {
  enableRemoteTunnel();
}
```

推荐：OSS baseline 只保留前台 LAN 同步能力；商业远程 tunnel 条件和启动逻辑不出现在 OSS runtime 中。

### 4.3 删除 cn 时要删除测试和文档断言

原计划里有 “cn regression”。在 Lynavo Drive OSS 中这部分应替换为：

- `market switch removal checks`
- `global-only build checks`
- `legacy name allowlist checks`
- `community vs official feature entitlement checks`

不再在开源仓库里测试 `cn mobile 未登录仍进入现有登录流程`。

### 4.4 允许 legacy compatibility，但必须显式 allowlist

例如以下内容可能不能第一阶段全部删除：

- 本地协议名 `_syncflow._tcp`。
- SQLite 文件 `syncflow.db`。
- Go module path。
- 某些 Swift / Kotlin class name。
- 升级迁移需要识别旧 `Vivi Drop` data dir 或 Windows firewall rule。

这些不能散落保留。建议新增：

```text
docs/rename/legacy-name-allowlist.md
scripts/verify-legacy-name-allowlist.mjs
```

CI 规则：`rg "Vivi Drop|vividrop|SyncFlow|syncflow|SYNCFLOW|VIVIDROP"` 的结果必须全部在 allowlist 中，否则失败。

---

## 5. 推荐目标目录 / 包命名

### 5.1 Monorepo 名称

建议仓库名：

```text
lynavo-drive
```

根 `package.json`：

```json
{
  "name": "lynavo-drive",
  "private": true
}
```

### 5.2 workspace package 命名

推荐：

```text
@lynavo-drive/contracts
@lynavo-drive/design-tokens
@lynavo-drive/desktop
@lynavo-drive/mobile
```

如果计划发布到 npm org，也可以改为：

```text
@lynavo/drive-contracts
@lynavo/drive-design-tokens
@lynavo/drive-desktop
@lynavo/drive-mobile
```

二选一后全仓统一，不建议混用。

### 5.3 Go module 和 sidecar binary

建议：

```text
module github.com/lynavo/lynavo-drive/services/sidecar-go
binary: lynavo-drive-sidecar
```

如果短期 Go module 迁移成本过高：

- binary 和 packaging 可先改成 `lynavo-drive-sidecar`。
- Go module path 暂时进入 legacy allowlist。

### 5.4 Bundle / App ID 建议

建议新安装包身份：

| 平台                     | 当前                                     | 建议目标                                                                 |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------------------------ |
| iOS bundle id            | `com.vividrop.mobile.global`             | `com.lynavo.drive.mobile`                                                |
| Android applicationId    | `com.vividrop.mobile.global`             | `com.lynavo.drive.mobile`                                                |
| Desktop appId            | `com.vividrop.desktop.global`            | `com.lynavo.drive.desktop`                                               |
| Apple Sign-in service id | `com.vividrop.global.signin`             | `com.lynavo.drive.signin`                                                |
| URL scheme               | `vividrop`                               | `lynavodrive`                                                            |
| FileProvider authority   | `${applicationId}.syncflow.fileprovider` | `${applicationId}.drive.fileprovider` 或 `${applicationId}.fileprovider` |

注意：如果要保留现有 App Store / Google Play 上架记录，bundle id / applicationId 不能随意改；这需要单独确认商店迁移策略。若 Lynavo Drive 是新品牌新 app，则建议直接启用新 id。

### 5.5 API / web / env 命名

建议把环境变量从 `VIVIDROP_*`、`SYNCFLOW_*` 收敛为：

```text
LYNAVO_API_BASE_URL
LYNAVO_REVIEW_API_BASE_URL
LYNAVO_WEB_BASE_URL
LYNAVO_SUPPORT_EMAIL
LYNAVO_RELEASE_CHANNEL
LYNAVO_DISTRIBUTION
LYNAVO_GIFTCARD_REDEEM_BASE_URL
LYNAVO_CLIENT_CONFIG_BASE_URL
```

不再需要：

```text
SYNCFLOW_MARKET
VIVIDROP_API_BASE_URL
```

如短期需要兼容旧变量，可在启动脚本里做一次映射并打 warning，但业务代码不应继续读取旧变量。

---

## 6. 分阶段实施计划

### Phase 0：建立迁移边界和分支策略

目标：避免在一个 PR 中同时做删除 cn、改名、商业 gate、native 改造导致不可回滚。

任务：

- 创建迁移主分支，例如 `main-lynavo-drive`。
- 明确当前 `vividrop-client-dev` 作为历史基线归档。
- 确认是否要保留旧 cn 产品：
  - 若保留，切到私有仓库 / 私有分支。
  - 若不保留，归档并停止 release profile。
- 明确 Lynavo Drive 的 app id / bundle id / domain / support email / API 域名。
- 建立 `docs/rename/legacy-name-allowlist.md`。
- 建立 CI 检查脚本：
  - 禁止新增 `cn` market 代码。
  - 禁止新增 `Vivi Drop` 用户可见字符串。
  - 禁止新增 `SYNCFLOW_MARKET`。

验收：

- 有明确的 “Lynavo Drive OSS 主干” 和 “Vivi Drop/cn 历史代码” 分界。
- 团队不再在 OSS 主干上做 cn 修复。

---

### Phase 1：删除 market release profile

目标：release 不再表达 cn/global，只表达 dev/review/prod 或 community/official。

当前候选文件：

- `scripts/release/release-profiles.mjs`
- `scripts/release/release.mjs`
- `scripts/dev/run-release-profile.mjs`
- `apps/mobile/src/release-profile.ts`
- `scripts/release/__tests__/release-profiles.test.mjs`
- `docs/release/market-release-flow.md`
- `README.md`

任务：

- 删除 `cn-prod`、`global-prod`、`cn-review`、`global-review`。
- 改为：

```ts
const RELEASE_PROFILES = Object.freeze({
  review: Object.freeze({
    name: 'review',
    channel: 'review',
    apiBaseUrl: 'https://review-api.lynavo.example',
    desktopBuilderConfig: 'electron-builder.yml',
  }),
  prod: Object.freeze({
    name: 'prod',
    channel: 'prod',
    apiBaseUrl: 'https://api.lynavo.example',
    desktopBuilderConfig: 'electron-builder.yml',
  }),
});
```

- `buildProfileEnv()` 不再输出 `SYNCFLOW_MARKET`、`VIVIDROP_API_BASE_URL`。
- 输出 `LYNAVO_RELEASE_CHANNEL`、`LYNAVO_API_BASE_URL`、`LYNAVO_CLIENT_CONFIG_BASE_URL`。
- Android release command 从 `assembleGlobalRelease bundleGlobalRelease` 改成无 flavor 的 `assembleRelease bundleRelease`。
- iOS release command 不再传 `profile.market`，而传 `channel` 或只传 archive/upload mode。
- Desktop Windows/Linux 脚本不再有 `package:win:cn` / `package:win:global`。
- 文档命令更新为：

```bash
pnpm release --profile review --targets ios,android,mac,win --dry-run
pnpm release --profile prod --targets ios,android,mac,win --dry-run
```

验收：

- `rg "cn-prod|global-prod|cn-review|global-review|SYNCFLOW_MARKET" scripts docs README.md` 无结果，或仅存在于 legacy allowlist。
- release dry-run 不再显示 Market 字段。
- mobile generated release profile 不再包含 `market`。

---

### Phase 2：Mobile JS 删除 market 层

目标：mobile TypeScript 不再知道 cn/global，只保留 Lynavo Drive 单一配置。

当前候选文件：

- `apps/mobile/src/markets/index.ts`
- `apps/mobile/src/markets/types.ts`
- `apps/mobile/src/markets/cn/config.ts`
- `apps/mobile/src/markets/global/config.ts`
- `apps/mobile/src/constants/legal.ts`
- `apps/mobile/src/constants/iap.ts`
- `apps/mobile/src/utils/subscriptionPaymentRouting.ts`
- `apps/mobile/src/utils/phone-validation.ts`
- `apps/mobile/src/navigation/RootNavigator.tsx`
- 所有 `*GlobalScreen.tsx` 和相关 tests

任务：

- 删除 `src/markets` 目录。
- 新增 `src/config/app-config.ts`。
- 删除 `activeMarket`、`marketConfig`、`isGlobalMarket()`、`isChinaMarket()`。
- 删除 phone/SMS/cn wallets routing；global-only 保留 Apple / Google / 邮箱等实际 global 登录方式。
- IAP product id 改成 Lynavo Drive 新 id，例如：

```ts
const OFFICIAL_PRODUCTS = {
  monthly: 'com.lynavo.drive.mobile.monthly.999',
  yearly: 'com.lynavo.drive.mobile.yearly.9900',
};
```

- 将 Global 后缀屏幕逐步改为中性名称：
  - `DeviceDiscoveryGlobalScreen.tsx` -> `DeviceDiscoveryScreen.tsx`
  - `SettingsGlobalScreen.tsx` -> `SettingsScreen.tsx`
  - `AutoUploadSettingsGlobalScreen.tsx` -> `AutoUploadSettingsScreen.tsx`
  - `RemoteAccessGlobalScreen.tsx` -> `RemoteAccessScreen.tsx`
  - `GlobalBottomTabBar.tsx` -> `DriveBottomTabBar.tsx`
- 删除 cn-only auth flow。未登录不再进入 `UnauthedStack` 硬拦截，而是进入 local mode。
- 登录 / 订阅 / 远程访问作为商业入口挂在 Settings 或 Remote Access 中。

验收：

- `apps/mobile/src` 下没有 `markets/cn`、`markets/global`、`isChinaMarket`、`activeMarket`。
- 新安装 App 不登录即可进入本地发现 / 同步主流程。
- 登录失败或离线不阻塞前台 LAN 自动上传。
- `rg "Vivi Drop|vividrop|cnMarket|globalMarket|SYNCFLOW_MARKET" apps/mobile/src` 无非 allowlist 结果。

---

### Phase 3：Android 删除 flavor 和 cn 原生依赖

目标：Android 变成单一 Lynavo Drive app，不再有 `cn`/`global` product flavor。

当前候选文件：

- `apps/mobile/android/app/build.gradle`
- `apps/mobile/android/app/src/cn/*`
- `apps/mobile/android/app/src/global/*`
- `apps/mobile/android/app/src/main/AndroidManifest.xml`
- `apps/mobile/android/app/src/main/res/values/strings.xml`
- `apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/**`
- `apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/market/NativeMarketConfigModule.kt`
- `scripts/sync-version-manifest.mjs`
- `scripts/verify-android-syncengine-bridge-parity.mjs`

任务：

- 删除：

```gradle
flavorDimensions "market"
productFlavors {
  cn { ... }
  global { ... }
}
```

- 设置单一：

```gradle
namespace "com.lynavo.drive.mobile"
defaultConfig {
  applicationId "com.lynavo.drive.mobile"
}
```

- 删除 `cnImplementation` 支付宝 / 微信依赖。
- 删除 `app/src/cn` 和 `app/src/global` source set。
- 删除 `NativeMarketConfigModule` / `NativeMarketConfigPackage`。
- 删除 `WXPayEntryActivity`、微信 package query、`vividrop://auth` scheme，替换为 `lynavodrive://auth`。
- Java/Kotlin 包从 `com.vividrop.mobile.china` 迁移到 `com.lynavo.drive.mobile`。
- `strings.xml` 改成 Lynavo Drive：

```xml
<string name="app_name">Lynavo Drive</string>
<string name="background_sync_notification_channel_description">Persistent notification shown while Lynavo Drive uploads files in the background.</string>
```

- `SyncFlowVersion.kt` 路径和 package 更新。
- Android release 命令更新：

```bash
cd apps/mobile/android && ./gradlew assembleDebug
cd apps/mobile/android && ./gradlew assembleRelease bundleRelease
```

验收：

- `./gradlew tasks` 中不再出现 `assembleGlobalRelease`、`assembleCnRelease`。
- `rg "productFlavors|cnImplementation|com.vividrop|vividrop|Vivi Drop|NativeMarketConfig|WXPayEntryActivity" apps/mobile/android` 无非 allowlist 结果。
- Android debug/release 能以单一 applicationId 编译。
- 前台免费同步不依赖 notification permission；notification 只为 paid background continuation 服务。

---

### Phase 4：iOS 删除 market scheme 和重命名

目标：iOS 变成单一 Lynavo Drive target / scheme / bundle id。

当前候选文件：

- `apps/mobile/ios/SyncFlowMobile.xcodeproj/project.pbxproj`
- `apps/mobile/ios/SyncFlowMobile.xcworkspace`
- `apps/mobile/ios/SyncFlowMobile/Info.plist`
- `apps/mobile/ios/SyncFlowMobile/SyncFlowMobile.entitlements`
- `apps/mobile/ios/SyncFlowMobile/SyncFlowMobileGlobal.entitlements`
- `apps/mobile/ios/SyncFlowMobile.xcodeproj/xcshareddata/xcschemes/*`
- `apps/mobile/ios/ExportOptions-TestFlight.plist`
- `apps/mobile/ios/ExportOptions-TestFlightGlobal.plist`
- `apps/mobile/ios/scripts/testflight-release.sh`
- `apps/mobile/ios/Podfile`

任务：

- 单一 scheme：`LynavoDrive`。
- 删除 `SyncFlowMobileGlobal.xcscheme` 和 CN/global build configurations。
- 删除 `SYNCFLOW_MARKET` build setting。
- 删除 `Info.plist` 中的 `SyncFlowMarket`。
- `CFBundleDisplayName` / `CFBundleName` 改成 `Lynavo Drive`。
- `PRODUCT_BUNDLE_IDENTIFIER` 改成 `com.lynavo.drive.mobile`。
- URL scheme 改成 `lynavodrive` 或新的 OAuth redirect scheme。
- 权限说明改成 Lynavo Drive。
- `ExportOptions-TestFlightGlobal.plist` 合并成单一 `ExportOptions-TestFlight.plist`。
- 如果改项目名成本可控，目录 / target 从 `SyncFlowMobile` 改成 `LynavoDrive`；若短期不改，必须进入 legacy allowlist。
- 对 `NSBonjourServices` / sidecar mDNS 做 no-compat 切换：
  - Lynavo Drive 使用 `_lynavodrive._tcp`。
  - 不保留 `_syncflow._tcp` 双广播 / 双发现迁移窗口。

验收：

- Xcode schemes 中只有 Lynavo Drive 单一发布路径。
- `xcodebuild -workspace ... -scheme LynavoDrive -configuration Debug build` 可通过。
- `rg "SYNCFLOW_MARKET|SyncFlowMarket|Vivi Drop|vividrop|Global.xcscheme|CN" apps/mobile/ios` 无非 allowlist 结果。

---

### Phase 5：Desktop 删除 market 和改名

目标：Desktop 不再由 `SYNCFLOW_MARKET` 决定产品名、配置和登录路径。

当前候选文件：

- `apps/desktop/src/shared/market.ts`
- `apps/desktop/src/renderer/main.tsx`
- `apps/desktop/src/renderer/features/layout/AppShell.tsx`
- `apps/desktop/package.json`
- `apps/desktop/electron.vite.config.ts`
- `apps/desktop/electron-builder.yml`
- `apps/desktop/electron-builder.cn.yml`
- `apps/desktop/electron-builder.global.yml`
- `apps/desktop/resources/installer.nsh`
- `apps/desktop/scripts/package-*.cjs/sh`
- `scripts/release/__tests__/desktop-branding.test.mjs`

任务：

- 删除 `market.ts`，新增 `product.ts`。
- `getProductName()` 固定返回 `Lynavo Drive`，或直接导出常量。
- 删除 `electron-builder.cn.yml` 和 `electron-builder.global.yml`，保留单一 `electron-builder.yml`。
- `appId` 改成 `com.lynavo.drive.desktop`。
- `productName` 改成 `Lynavo Drive`。
- artifact：`LynavoDrive-${version}-${arch}.${ext}`。
- Windows executable / shortcut：`Lynavo Drive`。
- Linux executable：`lynavo-drive`。
- Sidecar binary：`lynavo-drive-sidecar`。
- Windows firewall rule 文案和旧规则清理：
  - 新增 `Lynavo Drive Sidecar TCP / HTTP / mDNS`。
  - 清理旧 `Vivi Drop ...` 和 `SyncFlow ...` 规则，保证升级干净。
- Desktop AppShell 未登录进入 local shell，不再因为 auth 未完成返回 `AuthPage`。
- 登录页变成 Settings / Remote / Subscription 的入口。
- `electron.vite.config.ts` 不再注入 `process.env.SYNCFLOW_MARKET`。

验收：

- Desktop fresh install 打开即显示 Lynavo Drive local mode。
- 未登录也启动 sidecar、本地发现、接收 LAN 上传。
- `rg "isGlobalMarket|SYNCFLOW_MARKET|electron-builder.cn|electron-builder.global|Vivi Drop|vividrop" apps/desktop` 无非 allowlist 结果。
- Windows 安装后 firewall rules 使用 Lynavo Drive 名称，并能清理历史规则。

---

### Phase 6：contracts 和共享策略改名 / 去 market

目标：共享 DTO / 常量不再表达 cn/global，同时承载 Lynavo Drive 的 feature entitlement。

当前候选文件：

- `packages/contracts/package.json`
- `packages/contracts/src/*`
- `packages/design-tokens/package.json`
- 所有 import `@syncflow/contracts` 的文件

任务：

- package 改名为 `@lynavo-drive/contracts`。
- 所有 import 从 `@syncflow/contracts` 改成 `@lynavo-drive/contracts`。
- 常量从 `VIVIDROP_*` 改成 `LYNAVO_*`。
- 新增 feature entitlement 类型：

```ts
export type DriveFeatureKey = 'lan_foreground_auto_upload';

export interface DriveEntitlements {
  canUseLanForegroundAutoUpload: boolean;
  source: EntitlementSource;
  expiresAt: string | null;
  checkedAt: string | null;
}
```

- 新增纯函数：

```ts
export function resolveDriveEntitlements(input: {
  isAuthenticated: boolean;
  serverEntitlements: Partial<DriveEntitlements> | null;
  now: string;
}): DriveEntitlements;
```

默认逻辑：

- guest/free/unknown：foreground LAN true。
- 商业后台/远程字段不属于 OSS contract；official overlay 自行定义和注入商业能力。
- OSS no official module：不启用缺失的 native/commercial implementation。

验收：

- 新增 policy 单元测试覆盖 guest/free/paid/expired/unknown/official module missing。
- 全仓不存在 `CommercialEntitlements.market`。
- 无 UI 组件直接用 `subscription.status === 'subscribed'` 推导 background / remote。

---

### Phase 7：Mobile no-login local mode 和前台 LAN 免费同步

目标：Lynavo Drive mobile 默认就是 local-first，不登录也能同步。

当前候选文件：

- `apps/mobile/src/navigation/RootNavigator.tsx`
- `apps/mobile/src/stores/auth-store.tsx`
- `apps/mobile/src/screens/DeviceDiscoveryGlobalScreen.tsx`
- `apps/mobile/src/screens/AlbumWorkbenchScreen.tsx`
- `apps/mobile/src/screens/AutoUploadSettingsGlobalScreen.tsx`
- `apps/mobile/src/screens/SettingsGlobalScreen.tsx`
- `apps/mobile/src/services/SyncEngineModule.ts`

任务：

- 建立 `guestLocalMode`，不要伪造成真实登录账号。
- `RootNavigator` 默认进入 local app flow。
- 登录 / 订阅只作为商业入口。
- 拆掉 `isFeatureAccessAllowed()` 这种 broad gate：
  - OSS 中只保留 foreground LAN gate
  - 商业后台 / 远程能力不在 OSS runtime 里推导
- 移除“未订阅阻止上传 / 自动上传”的逻辑。
- 保留真实技术 gate：相册权限、局域网权限、设备发现、配对、安全码、网络可达性。
- 不新增手动选择文件作为免费替代路径。
- 自动上传主开关含义固定为：前台局域网自动扫描 + pending queue + 串行上传。

验收：

- fresh install、不登录，可以进入设备发现和同步页面。
- 前台 App 可见时可以扫描、入队、上传。
- 未登录不访问 subscription-only API。
- 登录失败 / 订阅状态未知不阻断前台 LAN 上传。

---

### Phase 8：Mobile paid background continuation

目标：后台 / 锁屏继续上传从前台免费自动上传中拆出，作为 paid feature。

#### 8.1 UI / JS 层

任务：

- 自动上传页保留主开关：免费 foreground LAN auto-upload。
- 增加“后台 / 锁屏继续上传”付费开关或入口。
- 免费用户可打开自动上传，但不能打开后台继续。
- App 进入后台 / 锁屏时，如果无 entitlement，只暂停继续推进，不清空 pending queue。
- 文案避免“自动上传需要订阅”，统一表达为“后台 / 锁屏继续上传需要订阅”。

#### 8.2 iOS native gate

当前候选文件：

- `apps/mobile/ios/SyncEngine/SyncEngineManager.swift`
- `apps/mobile/ios/SyncEngine/BackgroundExecutionService.swift`
- `apps/mobile/ios/SyncEngine/BackgroundUploadService.swift`
- `apps/mobile/ios/SyncEngine/SilentAudioService.swift`
- iOS RN bridge / native module

任务：

- 增加 native entitlement snapshot：

```swift
struct DriveEntitlementSnapshot {
  let canUseBackgroundContinuation: Bool
  let updatedAt: Date
  let expiresAt: Date?
}
```

- JS 在启动、登录、退出、订阅变更、entitlement 过期后同步给 native。
- 无 background entitlement 时：
  - 不启用 silent audio。
  - `appDidEnterBackground` 不进入 background handoff。
  - 不创建 background URLSession chain。
  - continued / maintenance BGTask no-op。
  - `chainNextIfAppropriate` 停止推进。
- 停止后台继续时保留 pending queue。

#### 8.3 Android native gate

当前候选文件：

- `apps/mobile/android/.../NativeSyncEngineModule.kt`
- `apps/mobile/android/.../AndroidForegroundSyncService.kt`
- lifecycle / screen lock listener

任务：

- 增加 native entitlement snapshot setter。
- 增加 App visible / screen locked / screen off 状态判断。
- 拆出不依赖 FGS 的前台同步路径，或至少确保 notification permission denied 不会阻断前台免费同步。
- 免费 / guest：
  - App 可见时允许扫描、入队、上传。
  - App 不可见、screen off、lockscreen 时停止继续推进。
  - 不因 notification permission 缺失中止前台同步。
- paid：
  - 开启后台继续时启动合规 Foreground Service。
  - Android 13+ notification permission 是 paid background continuation 的平台前置条件。

验收：

- iOS guest/free 锁屏后不继续下一个文件。
- Android guest/free 切后台或锁屏后停止推进。
- Android notification denied 时，前台免费同步仍可用。
- paid 用户在平台允许范围内可继续后台推进。
- 退出登录 / entitlement 过期后，native background chain 停止。

---

### Phase 9：Remote tunnel paid gate 和官方服务端边界

目标：远程穿透不能是登录即有，也不能因为 OSS 自编译绕过官方服务。

当前候选文件：

- `apps/mobile/src/stores/auth-store.tsx`
- `apps/mobile/src/services/tunnel-credentials-service.ts`
- `apps/mobile/src/screens/RemoteAccessGlobalScreen.tsx`
- `apps/mobile/src/screens/SharedFilesDownloadGate.tsx`
- `apps/desktop/src/main/sidecar-client.ts`
- `apps/desktop/src/main/sidecar-manager.ts`
- `services/sidecar-go/internal/api/handlers_settings.go`
- `services/sidecar-go/internal/api/handlers_personal.go`
- `services/sidecar-go/internal/api/router.go`
- sidecar tunnel / p2p manager

任务：

- 只有 official overlay 明确允许远程 tunnel 且用户隐私设置打开时才请求 TURN credentials。
- guest/free/expired：
  - 不请求 `/tunnel/turn-credentials`。
  - 不向 native 或 sidecar 下发真实 credentials。
  - 如果此前有 credentials，主动清除。
- 后端 `/tunnel/turn-credentials` 必须校验 entitlement：
  - 未登录：401。
  - 登录未付费 / 过期：403 或明确业务错误码。
- Desktop 拆分：
  - `syncAccountContextToSidecar()`
  - `syncTunnelCredentialsToSidecar()`
  - `clearTunnelCredentialsFromSidecar()`
- `remoteAccessEnabled` 是用户隐私设置，不是付费状态；商业 entitlement 由 official overlay 负责。

- Sidecar 做最后防线：
  - `/tunnel/credentials` 拒绝 guest/free/expired。
  - personal / remote API 同时检查 user setting、entitlement、account context、device authorization。
  - Bonjour/local discovery metadata 不对未授权状态宣传 remote 可用。
  - 日志区分 disabled by setting / entitlement / missing account。

验收：

- guest/free 抓包或日志中没有 TURN credential 请求。
- paid + remoteAccessEnabled=true 可建立远程访问。
- paid + remoteAccessEnabled=false 不启动 tunnel，local LAN 不受影响。
- entitlement 过期后 remote 显示付费状态，不误报网络故障。
- 直接绕过 UI 打 sidecar remote API，guest/free 被拒绝。

---

### Phase 10：Official commercial module / overlay

目标：避免 OSS 开源基线与商业能力混在一起，尤其是后台 continuation 这种本地能力。

推荐结构：

```text
lynavo-drive/                         # public OSS
  apps/mobile/                        # foreground LAN sync + stubs
  apps/desktop/                       # local shell + local sidecar
  services/sidecar-go/                # local LAN sidecar + remote stubs/guards
  packages/contracts/
  packages/design-tokens/

lynavo-drive-commercial/              # private
  packages/commercial-entitlements/
  packages/mobile-background-native/
  packages/remote-tunnel-official/
  release/official-signing/
```

或在私有 mono repo 中用 patch overlay：

```text
commercial-overlays/mobile-background/
commercial-overlays/remote-tunnel/
commercial-overlays/official-release/
```

原则：

- OSS 编译应可用 local LAN，不需要任何官方 token。
- OSS 中 paid capability 的 resolver 默认 fail-closed。
- Official build 在打包时注入商业模块和官方 API config。
- 商业模块不能重新引入 `cn/global` market switch。
- CI 要同时跑：
  - public OSS build。
  - private official build。
  - entitlement boundary tests。

验收：

- 从 public repo clone 后可完成 local LAN build/test。
- 没有官方私有模块时，background continuation / remote tunnel 无法被 UI 打开。
- official build 能解锁 paid features，但仍在 guest/free/expired 时 fail-closed。

---

### Phase 11：UI / 文案 / Paywall 重整

目标：用户理解 Lynavo Drive 的免费和付费边界。

### Mobile

- 首屏：直接进入本地模式，不以登录作为第一步。
- Settings：显示账号区：
  - guest：登录以启用后台和远程。
  - free account：升级以启用后台和远程。
  - paid：显示权益状态。
- 自动上传页：
  - “自动上传” = 前台局域网自动扫描和上传，免费。
  - “后台 / 锁屏继续上传” = 付费。
- Remote Access：
  - guest 显示登录入口。
  - free 显示升级入口。
  - paid 且 remoteAccessEnabled=true 显示可用状态。

### Desktop

- 未登录打开就是 local shell。
- 登录入口不遮挡本地接收。
- Remote Access 设置区：
  - guest/free：解释需要官方订阅。
  - paid：允许开启 / 关闭 remoteAccessEnabled。
- 本地模式文案：
  - “Local network only”
  - “No account required”
  - “Background continuation and remote access require Lynavo Drive Official subscription”

### 文案禁区

避免：

- “自动上传需要订阅”
- “同步需要登录”
- “免费版只能手动选择文件”

推荐：

- “前台局域网自动上传免费可用”
- “后台 / 锁屏继续上传需要订阅”
- “远程访问需要 Lynavo Drive Official 订阅”

---

## 7. 文件级任务清单

### 7.1 根目录 / workspace

- `package.json`
  - `name: "vivi-drop"` -> `"lynavo-drive"`
  - scripts 中 profile 名称更新。
- `pnpm-workspace.yaml`
  - 如包名变化，确认 workspace 仍覆盖。
- `README.md`
  - 标题改为 Lynavo Drive。
  - 删除 cn/global release 命令。
  - 新增 community / official 说明。
- `AGENTS.md` / `CLAUDE.md`
  - 更新项目名和新边界。
- `version-manifest.json`
  - 确认 app compatibility version 仍可独立于品牌。

### 7.2 contracts / design-tokens

- `packages/contracts/package.json`
  - `@syncflow/contracts` -> `@lynavo-drive/contracts`。
- `packages/contracts/src/*`
  - `VIVIDROP_*` -> `LYNAVO_*`。
  - 删除 Market 类型。
  - 新增 `DriveEntitlements`、`DriveFeatureKey`。
- `packages/design-tokens/package.json`
  - `@syncflow/design-tokens` -> `@lynavo-drive/design-tokens`。

### 7.3 mobile JS / TS

- 删除：
  - `apps/mobile/src/markets/cn`
  - `apps/mobile/src/markets/global`
  - `apps/mobile/src/markets/index.ts`
  - `apps/mobile/src/markets/types.ts`
- 新增：
  - `apps/mobile/src/config/app-config.ts`
  - `apps/mobile/src/entitlements/drive-entitlements.ts`
- 改造：
  - `RootNavigator.tsx`
  - `auth-store.tsx`
  - `features.ts`
  - `iap.ts`
  - `legal.ts`
  - `SubscriptionGlobalScreen.tsx` -> `SubscriptionScreen.tsx`
  - `RemoteAccessGlobalScreen.tsx` -> `RemoteAccessScreen.tsx`
- 删除 / 改造 cn 相关：
  - `phone-validation.ts`
  - SMS login paths
  - cn wallet routing

### 7.4 Android

- `apps/mobile/android/app/build.gradle`
  - 删除 product flavors。
  - 设置 `namespace/applicationId com.lynavo.drive.mobile`。
  - 删除 `cnImplementation`。
- 删除：
  - `app/src/cn`
  - `app/src/global`，若为空也删除。
  - `NativeMarketConfigModule.kt`
  - `NativeMarketConfigPackage.kt`
  - WeChat / Alipay native entry。
- 迁移 package：
  - `com/vividrop/mobile/china` -> `com/lynavo/drive/mobile`。
- `AndroidManifest.xml`
  - 删除 WeChat query / activity。
  - URL scheme 改成 `lynavodrive`。
  - FileProvider authority 改名。
- `strings.xml`
  - 全部改成 Lynavo Drive。

### 7.5 iOS

- Project / scheme：
  - `SyncFlowMobile` -> `LynavoDrive`，或短期 allowlist。
  - 删除 Global/CN scheme split。
- `Info.plist`
  - `CFBundleDisplayName` -> `Lynavo Drive`。
  - 删除 `SyncFlowMarket`。
  - 更新 permission strings。
  - 更新 URL scheme。
- Entitlements：
  - 单一 entitlement 文件。
  - 更新 application group / keychain group。
- Scripts：
  - `testflight-release.sh` 不再接受 market 参数。

### 7.6 desktop

- `apps/desktop/package.json`
  - `name` -> `@lynavo-drive/desktop`。
  - `productName` -> `Lynavo Drive`。
  - `description` 更新。
  - `homepage`、`author.email` 更新。
  - 删除 `package:*:cn` 和 `package:*:global`。
- `electron-builder.yml`
  - 单一配置。
  - `appId: com.lynavo.drive.desktop`。
  - artifact / executable / shortcut 全部改名。
- 删除：
  - `electron-builder.cn.yml`
  - `electron-builder.global.yml`
  - `src/shared/market.ts`
- 新增：
  - `src/shared/product.ts`
  - `src/shared/release-channel.ts`
- `installer.nsh`
  - 新 firewall rules。
  - 清理旧 SyncFlow / Vivi Drop rules。

### 7.7 sidecar

- `services/sidecar-go/go.mod`
  - module path 改成 Lynavo org，或暂列 legacy allowlist。
- `Makefile`
  - `BINARY := lynavo-drive-sidecar`。
- `internal/config/config.go`
  - data dir `Lynavo Drive`。
  - 从旧 `Vivi Drop` / `syncflow` data dir 做一次性迁移。
- API / router：
  - remote entitlement guard。
  - local LAN API 不受 remote entitlement 影响。
- mDNS service：
  - 已决策直接从 `_syncflow._tcp` 迁移到 `_lynavodrive._tcp`，不保留旧客户端发现兼容。

### 7.8 docs / tests

- 删除或改写：
  - `docs/release/market-release-flow.md`
  - cn/global release snippets
  - cn regression matrix
- 新增：
  - `docs/release/release-channel-flow.md`
  - `docs/open-source/community-build.md`
  - `docs/commercial/feature-boundary.md`
  - `docs/rename/legacy-name-allowlist.md`
- 更新 tests：
  - `release-profiles.test.mjs`
  - `desktop-branding.test.mjs`
  - mobile market config tests 删除 / 替换为 app config tests。

---

## 8. 新测试矩阵

### 8.1 Global-only / market removal

| 场景                                      | 预期                                  |
| ----------------------------------------- | ------------------------------------- |
| 全仓搜索 `SYNCFLOW_MARKET`                | 无结果或仅 legacy allowlist           |
| 全仓搜索 `isChinaMarket` / `activeMarket` | 无结果                                |
| release dry-run                           | 不显示 Market，只显示 Release Channel |
| Android Gradle tasks                      | 无 `assembleCn*` / `assembleGlobal*`  |
| iOS schemes                               | 只有 Lynavo Drive 单一路径            |
| Desktop builder configs                   | 只有单一 `electron-builder.yml`       |

### 8.2 Branding / rename

| 场景                 | 预期                                                  |
| -------------------- | ----------------------------------------------------- |
| App display name     | Lynavo Drive                                          |
| Desktop window title | Lynavo Drive                                          |
| Installer artifact   | `LynavoDrive-...`                                     |
| Windows shortcut     | Lynavo Drive                                          |
| Notifications        | Lynavo Drive                                          |
| Permission strings   | Lynavo Drive                                          |
| README / docs 首页   | Lynavo Drive                                          |
| Legacy string scan   | `Vivi Drop` / `vividrop` 只存在于 migration allowlist |

### 8.3 Community / OSS local mode

| 场景                        | Mobile    | Desktop   | 预期                                        |
| --------------------------- | --------- | --------- | ------------------------------------------- |
| Fresh community build       | 未登录    | 未登录    | 可发现、配对、前台 LAN 自动上传             |
| Guest background            | 未登录    | 未登录    | 切后台 / 锁屏后停止推进，pending queue 保留 |
| Offline local               | 无网络    | 同 LAN    | 不访问官方 API，前台 LAN 可用               |
| Notification denied Android | 未登录    | 任意      | 前台 LAN 同步不中止                         |
| No official module          | OSS build | OSS build | background / remote 不可开启                |

### 8.4 Official commercial

| 场景                            | 预期                                            |
| ------------------------------- | ----------------------------------------------- |
| Official guest                  | 前台 LAN 可用；后台 / 远程提示登录/订阅         |
| Logged-in free                  | 前台 LAN 可用；不请求 TURN；后台开关不可用      |
| Paid background                 | iOS / Android 在平台限制内继续后台上传          |
| Paid remote enabled             | 获取 TURN，sidecar tunnel 可用                  |
| Paid remote disabled by setting | 不启动 tunnel，local LAN 不受影响               |
| Entitlement expired             | 前台 LAN 可用；后台和远程停用并清除 credentials |
| Server 401/403                  | 不误报网络故障，展示登录/订阅状态               |

### 8.5 兼容 / 迁移

| 场景                           | 预期                                                          |
| ------------------------------ | ------------------------------------------------------------- |
| 旧 Vivi Drop data dir 存在     | Lynavo Drive 首次启动迁移或读取旧数据，日志说明               |
| 旧 Windows firewall rules 存在 | 新 installer 添加 Lynavo Drive rules，并清理旧规则            |
| 旧 mDNS service name           | 若启用迁移期，mobile 可发现旧 sidecar；否则文档明确不兼容     |
| 旧 OAuth callback              | 新 scheme 生效；旧 scheme 按商店/后端策略决定是否保留迁移窗口 |

---

## 9. 推荐验证命令

### 9.1 Market removal scan

```bash
rg -n "SYNCFLOW_MARKET|activeMarket|isChinaMarket|isGlobalMarket|cn-prod|global-prod|cn-review|global-review|productFlavors|cnImplementation|electron-builder\.cn|electron-builder\.global" \
  apps packages scripts services docs README.md
```

期望：无结果，或仅命中 `docs/rename/legacy-name-allowlist.md` 中明确允许的历史记录。

### 9.2 Branding scan

```bash
rg -n "Vivi Drop|ViviDrop|vivi-drop|vividrop|VIVIDROP" \
  apps packages scripts services docs README.md
```

期望：用户可见路径无结果；迁移脚本 / legacy cleanup 可以在 allowlist 中保留。

### 9.3 SyncFlow internal scan

```bash
rg -n "SyncFlow|syncflow|SYNCFLOW|@syncflow" \
  apps packages scripts services docs README.md
```

期望：阶段 1 可有 allowlist；最终阶段尽量清零或仅保留协议兼容项。

### 9.4 Build / typecheck

```bash
pnpm build
pnpm test
pnpm typecheck
pnpm --filter @lynavo-drive/desktop typecheck
pnpm --filter @lynavo-drive/desktop test
cd services/sidecar-go && go test ./...
cd apps/mobile/android && ./gradlew assembleDebug assembleRelease
```

### 9.5 Release dry-run

```bash
pnpm release --profile review --targets ios,android,mac,win --dry-run
pnpm release --profile prod --targets ios,android,mac,win --dry-run
```

---

## 10. 对原计划的主要修改点

原计划中的这些结论保留：

- 前台局域网自动扫描、排队、增量上传是免费能力。
- 不新增手动选择文件路径替代自动上传。
- 后台 / 锁屏继续是付费能力。
- 远程穿透是付费能力。
- broad subscription gate 要拆成 feature-level entitlement。
- mobile / desktop 都要支持 no-login local mode。
- remote tunnel 不能登录即有；TURN credentials 必须 gated。
- sidecar 必须有最后防线。

原计划中的这些结论需要改写：

| 原计划写法                                       | 新版写法                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| 本计划只针对 global，cn 保持现状                 | Lynavo Drive OSS 只保留 global 语义；cn 从开源仓库移除                  |
| cn fallback / cn regression                      | 删除 OSS 中的 cn fallback；cn regression 只属于私有旧产品               |
| `CommercialEntitlements.market`                  | 删除 market 字段，改为 global-only `DriveEntitlements`                  |
| release profile 使用 `global-review/global-prod` | release channel 使用 `review/prod`，不再带 global                       |
| desktop `isGlobalMarket()`                       | 删除 market helper，产品默认 Lynavo Drive                               |
| mobile `activeMarket`                            | 删除 market resolver，使用单一 app config                               |
| Android `assembleGlobalRelease`                  | 改为无 flavor 的 `assembleRelease`                                      |
| iOS `SyncFlowMobileGlobal` scheme                | 改为单一 `LynavoDrive` scheme                                           |
| “开源 build 默认值应可用 local LAN”              | 进一步明确：OSS build 就是 local-first global-only，不是 market profile |

---

## 11. 最终验收标准

必须全部满足：

- 开源仓库名、README、用户可见产品名均为 Lynavo Drive。
- 开源仓库不包含 cn market 业务路径。
- 默认配置就是 global/local-first，不需要 `SYNCFLOW_MARKET=global`。
- 不存在 `activeMarket`、`isChinaMarket()`、`cnMarketConfig`、`globalMarketConfig` 这类市场分支代码。
- Android 无 cn/global product flavor。
- iOS 无 CN/global scheme split。
- Desktop 无 cn/global builder config。
- Mobile fresh install 未登录可进入 local mode。
- Desktop fresh install 未登录可进入 local shell 并启动 sidecar。
- Mobile guest + Desktop guest 在同一局域网可发现、配对、前台自动上传。
- guest/free 切后台或锁屏后不继续推进上传，pending queue 保留。
- guest/free 不请求 TURN credentials，不向 native/sidecar 下发真实 remote credentials。
- official paid 才能开启 background continuation 和 remote tunnel。
- sidecar remote API 不能仅靠 UI gate，必须校验 entitlement / setting / account context。
- `Vivi Drop`、`vividrop`、`VIVIDROP_*` 不再作为用户可见或主路径命名出现。
- `SyncFlow` / `syncflow` 若暂时保留，必须全部记录在 legacy allowlist，且有后续清理计划。

---

## 12. 推荐落地顺序

建议顺序：

1. **先做 global-only extraction**：删 release market、mobile markets、Android flavors、iOS schemes、desktop market helper。
2. **再做 Lynavo Drive visible rename**：App 名、desktop 名、安装包、权限、通知、README、artifact。
3. **再做 package / namespace rename**：`@syncflow`、Go module、binary、data dir、URL scheme、app id。
4. **再做 no-login local mode**：mobile 和 desktop 都默认进入 local-first 主流程。
5. **再做 entitlement contract**：去 market 的 `DriveEntitlements`，foreground LAN fail-open，background/remote fail-closed。
6. **再拆 paid background**：优先确定是否私有 overlay；iOS / Android native gate 必须落地。
7. **再拆 paid remote**：mobile/desktop/sidecar/backend 全链路 gate。
8. **最后补 UI 文案、paywall、QA 和 release docs**。

这个顺序的原因是：先把代码身份变干净，避免在 cn/global 双路径上继续叠加商业逻辑；再恢复 local-first 免费体验；最后把真正付费的 background 和 remote 做成清晰的 commercial capability。

---

## 13. 关键风险和待决策

### 13.1 App ID / Bundle ID 是否新建

如果 Lynavo Drive 要继承现有商店 app，bundle id / applicationId 可能不能改。若是新 app，建议直接启用 `com.lynavo.drive.mobile`。这是发布策略决策，不是代码偏好。

### 13.2 mDNS / 协议名是否改

已决策直接改成 `_lynavodrive._tcp`。Lynavo Drive OSS 版本不兼容旧 `_syncflow._tcp` 客户端发现；后续任务不再保留双广播 / 双发现迁移窗口。

### 13.3 后台继续是否全开源

如果后台 continuation 是核心付费点，推荐不要把完整 native continuation 全量放进 public OSS，否则 fork 可绕过付费 gate。远程穿透则可更多依赖服务端 entitlement。

### 13.4 数据目录迁移

旧用户数据从 `Vivi Drop` 迁移到 `Lynavo Drive` 要谨慎：

- 先读旧目录。
- 成功迁移后写新目录。
- 不要删除旧目录，除非用户确认或迁移完成有备份。
- 日志和诊断报告要标记 migration source。

### 13.5 OAuth / 登录回调迁移

URL scheme、Apple client id、Google client id 都要随品牌和 bundle id 更新。后端需要同时支持新旧回调一段时间，或明确旧 app 不升级到新 app。

---

## 14. 可直接拆 PR 的清单

### PR 1：Release profile 去 market

- 删除 cn/global profiles。
- 新增 review/prod channel。
- 更新 release tests 和 README 命令。

### PR 2：Mobile app config 单一化

- 删除 `src/markets`。
- 新增 `app-config.ts`。
- 删除 `activeMarket` / `isChinaMarket`。
- 保留 global 登录提供方和 global UI。

### PR 3：Android flavor 删除

- 删除 product flavors。
- 删除 cn dependencies/source set。
- applicationId/namespace 改成 Lynavo。
- Gradle 命令改成无 flavor。

### PR 4：iOS scheme 单一化

- 删除 market scheme/config。
- 单一 LynavoDrive scheme。
- Info.plist 删除 SyncFlowMarket。

### PR 5：Desktop builder 单一化

- 删除 cn/global builder config。
- product.ts 替代 market.ts。
- AppShell no-login local shell 初步打通。

### PR 6：Visible rename

- 全端用户可见 `Vivi Drop` -> `Lynavo Drive`。
- artifact、installer、notification、permission strings 更新。
- legacy cleanup allowlist 上线。

### PR 7：Package / namespace rename

- `@syncflow/*` -> `@lynavo-drive/*`。
- binary、Go module、scripts、tests 更新。

### PR 8：Entitlement contract 去 market

- 新增 `DriveEntitlements`。
- 删除 `CommercialEntitlements.market`。
- foreground LAN fail-open；background/remote fail-closed。

### PR 9：Mobile foreground LAN 免费通路

- RootNavigator local-first。
- 移除 broad subscription gate。
- pending queue 自动上传前台可用。

### PR 10：Native background paid gate / overlay

- iOS / Android entitlement snapshot。
- free background stop。
- paid background continue。

### PR 11：Remote tunnel paid gate

- TURN credential fetch gate。
- desktop account/tunnel sync 拆分。
- sidecar remote API hardening。

### PR 12：UI / docs / QA 收口

- Paywall 文案。
- OSS build docs。
- Official build docs。
- 测试矩阵和 release playbook。

---

## 15. 推荐的新文档结构

建议在仓库中增加：

```text
docs/
  open-source/
    community-build.md
    local-lan-sync.md
    contribution-guide.md
  commercial/
    feature-boundary.md
    entitlement-contract.md
    official-build-overlay.md
  release/
    release-channel-flow.md
    app-store-and-play-store.md
    desktop-signing.md
  rename/
    lynavo-drive-migration.md
    legacy-name-allowlist.md
  testing/
    beta-test-matrix.md
    global-only-qa.md
```

原 `docs/release/market-release-flow.md` 应改名或删除。

---

## 16. 最小可行版本定义

### Lynavo Drive OSS MVP

必须具备：

- 单一 global-only build。
- 用户可见名 Lynavo Drive。
- mobile 未登录 local mode。
- desktop 未登录 local shell。
- 同 LAN 发现、配对、自动 scan、pending queue、串行上传。
- 后台 / 远程入口不可用或指向 official 说明。
- 无 cn 代码路径和 cn release profile。

可以暂缓：

- 全量 `SyncFlow` 内部命名清零。
- mDNS service type 改名。
- 旧用户数据自动迁移。
- official paid background 完整实现。

### Lynavo Drive Official MVP

在 OSS MVP 基础上增加：

- 登录 / 订阅 / restore purchase。
- paid background continuation。
- paid remote tunnel。
- official release profile review/prod。
- 服务端 entitlement 和 TURN credential gate。

---

## 17. 最后建议

这次新增要求应该被视为“架构边界变更”，而不是文案修订：

- **原计划的 commercial boundary 仍然成立，但 market 边界要重写。**
- **开源仓库应该是 Lynavo Drive global-only，而不是 Vivi Drop global profile。**
- **商业能力应该由 feature entitlement 和 official/private capability 控制，而不是 market switch。**
- **cn 代码不应再作为开源主干的兼容目标。**

完成这一步后，后续所有开发都会更简单：代码里只有 Lynavo Drive，一个默认 global 的 local-first 产品；用户免费体验清晰，商业收费点集中，开源仓库也不会暴露旧 cn 市场实现和复杂 release profile。
