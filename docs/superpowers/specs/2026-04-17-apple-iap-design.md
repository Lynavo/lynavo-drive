# Apple IAP 接入設計 — SyncFlow Mobile

- **日期**：2026-04-17
- **範圍**：SyncFlow Mobile（iOS）接入 Apple In-App Purchase，完成訂閱購買 / 恢復購買 / 後端驗證整條鏈路
- **對齊版本**：vivi-drop-server Phase-1（已部署 `/subscription/verify` 與 App Store Server Notifications V2 webhook）

---

## 1. 目標與背景

### 1.1 要解的問題

`SubscriptionScreen` paywall UI、`subscription-service.ts` API client、後端 `/subscription/verify` + webhook V2 都已實作，**唯獨缺少 iOS 端真正發起購買並取得 receipt 的那一段**。目前 `handleSubscribe` 只是 mock Alert。

本期要做的事情就一句：**把 `react-native-iap` 接起來，完成從「按下訂閱」到「`auth-store.subscription.status === 'subscribed'`」的整條閉環**。

### 1.2 成功標準

1. 真實沙盒帳號可完整走完：選方案 → Apple UI → 扣款（或試用） → 後端 `/verify` → paywall 消失 → SyncActivity 可用
2. 失敗路徑不遺失付款：付款後任何環節斷掉，下次啟動自動補驗證
3. Restore Purchases 按鈕曝光並可用（Apple Review 硬要求）
4. Monthly 的 Apple 7 天免費試用 eligibility 正確動態顯示
5. 後端 `2002 RECEIPT_ALREADY_USED` 被當成成功處理（不是錯誤）
6. iOS 上架通過 Apple Review

---

## 2. 產品邊界

### 2.1 本期目標

- iOS 訂閱 monthly / yearly 兩個方案的購買流程
- Monthly 產品開啟 Apple 7 天免費試用（introductory free trial）
- Restore Purchases
- 孤兒交易（interrupted purchase）自動恢復
- 錯誤處理與 i18n 文案（en / zh-Hans / zh-Hant）
- 單元測試與手動測試矩陣

### 2.2 明確不做（非目標）

| 項目 | 理由 |
|---|---|
| Family Sharing（家庭共享訂閱） | 產品決策不開啟，App Store Connect 該選項保持關閉 |
| Yearly 試用 | 只有 monthly 配 7 天免費試用；yearly 首購即扣款 |
| Promotional offers / 優惠碼 / 首購折扣 | 需 JWT 簽章與後端整合，本期不做 |
| 除 monthly 7 天免費試用外的 introductory pricing（折扣價、pay-as-you-go） | 本期不做 |
| 升降級按比例退款 UI | Apple 自動處理，前端僅透過 `loadSubscription` 呈現結果 |
| 自建訂閱管理介面（取消 / 改方案） | 導引至 iOS 系統設定 `https://apps.apple.com/account/subscriptions` |
| Android / Google Play Billing | 本期僅 iOS |
| 多幣別 / 非中國區訂閱 | 產品目前只上 App Store China |
| 沙盒帳號自動化 E2E | Apple 沙盒帳號無法自動化，只做 unit test + 手動測試矩陣 |
| 訂閱到期前 push 提醒 | 後端 notification 服務另行規劃 |
| 收據簽章本地驗證 | Mobile 端不自行驗證 receipt，完全信任後端 `/verify` |
| 用 `getSubscriptions().localizedPrice` 取代硬編碼價格 | 列為後續迭代 |

### 2.3 Trial 策略（後端 trial 與 Apple trial 並存）

- **後端 trial**：新使用者註冊後 `trial_end = createdAt + 7 天`，狀態 `trialing`，由後端判斷是否允許功能存取
- **Apple trial**：首次訂閱 monthly 的合格 Apple ID 享 7 天免費試用，由 Apple 計時
- **並存代表**：新使用者理論上最多可享 **14 天免費**（後端 7 天 + Apple 7 天）
- 這是有意的行銷策略，不做阻擋

---

## 3. 前置條件（已就緒）

### 3.1 後端契約

| 端點 | 方法 | Request | Response |
|---|---|---|---|
| `/api/v1/subscription/status` | GET | `Authorization: Bearer <token>` | `{ status, plan, expire_at, trial_end }` |
| `/api/v1/subscription/verify` | POST | `{ receipt_data, plan }` | `{}`（成功）/ 錯誤碼 |

**錯誤碼**（`services/api.ts` 已定義）

| Code | 名稱 | 意義 |
|---|---|---|
| 2001 | `IAP_VERIFY_FAILED` | Apple 回 status != 0，receipt 無效 |
| 2002 | `RECEIPT_ALREADY_USED` | 同 receipt 已驗證過，**當成功處理** |
| 2003 | `PRODUCT_ID_MISMATCH` | Receipt 的 product ID 不在 `validProducts` |

### 3.2 App Store Connect 設定

| 項目 | 值 |
|---|---|
| Bundle ID | `com.vividrop.mobile.china` |
| Monthly Product ID | `com.vividrop.mobile.china.monthly.999` |
| Monthly 價格 | ¥9.9 / 月（auto-renewable） |
| Monthly Introductory Offer | **7 天免費試用**（free trial） |
| Yearly Product ID | `com.vividrop.mobile.china.yearly.10400` |
| Yearly 價格 | ¥104 / 年（auto-renewable，無 trial） |
| Subscription Group | 同一組（允許月 ↔ 年升降級） |
| Family Sharing | **關閉** |
| Webhook URL | 後端已設 V2 endpoint、Apple Root CA 鏈驗證 |

### 3.3 Receipt 格式

- Mobile 端送給 `/verify` 的是 **StoreKit 1 `transactionReceipt` base64 blob**
- 後端透過 shared secret 打 Apple legacy `/verifyReceipt` endpoint
- 行動端**不**送 StoreKit 2 `jwsRepresentation`（後端此端點未實作 JWS 驗證）

---

## 4. 架構

### 4.1 檔案配置

```
apps/mobile/
  package.json                     + react-native-iap ^12.16.x
  ios/Podfile.lock                 + (pod install 自動產生)
  
  src/
    constants/
      iap.ts                       NEW  — IAP_PRODUCTS、PLAN_TO_PRODUCT、PRODUCT_TO_PLAN
      features.ts                  MOD  — 新增 IAP_ENABLED、IAP_RESTORE_ENABLED
    
    services/
      iap-service.ts               NEW  — react-native-iap 封裝（initialize/purchase/restore/teardown/checkEligibility）
      iap-errors.ts                NEW  — Apple error code + backend 錯誤碼 → i18n key mapping
      subscription-service.ts      —    已存在，不動
    
    hooks/
      useIapLifecycle.ts           NEW  — 綁 initialize/teardown 到 auth 狀態
    
    screens/
      SubscriptionScreen.tsx       MOD  — 接真實 IAP、加 Restore 按鈕、加錯誤態、加 trial eligibility
    
    stores/
      auth-store.tsx               MOD  — AuthProvider 掛 useIapLifecycle
    
    i18n/locales/{en,zh-Hans,zh-Hant}/subscription.json
                                   MOD  — 新增 restore.*、errors.*、plans.monthly.trialOffer
```

### 4.2 模組責任

| 模組 | 負責 | 不負責 |
|---|---|---|
| `constants/iap.ts` | Product ID 常數與 plan ↔ productId 雙向 map | |
| `services/iap-service.ts` | `react-native-iap` 生命週期、purchase / restore Promise 包裝、孤兒交易偵測與 finish、trial eligibility 查詢 | 後端驗證、auth-store 更新、UI 狀態 |
| `services/iap-errors.ts` | Apple error code（`E_USER_CANCELLED` 等）與 backend 錯誤碼（2001/2002/2003）的分類與 i18n key mapping | |
| `hooks/useIapLifecycle.ts` | `isLoggedIn` 變 true 時 `initialize()`、訂閱 `onOrphanPurchaseVerified` 呼叫 `loadSubscription()`；`isLoggedIn` 變 false 時 unsubscribe + `teardown()` | 購買邏輯 |
| `SubscriptionScreen.tsx` | UI 狀態（idle / loading / error / success / restoring / trial-copy-variant）、orchestrate `iapService.purchase` → `verifyIapReceipt` → `loadSubscription` | native 細節、lifecycle |

### 4.3 `constants/iap.ts` 完整內容

```ts
import type { SubscriptionPlan } from '../stores/auth-store';

export const IAP_PRODUCTS = {
  monthly: 'com.vividrop.mobile.china.monthly.999',
  yearly:  'com.vividrop.mobile.china.yearly.10400',
} as const;

export type IapProductId = (typeof IAP_PRODUCTS)[keyof typeof IAP_PRODUCTS];

export const ALL_PRODUCT_IDS: readonly IapProductId[] = Object.values(IAP_PRODUCTS);

export function planToProductId(plan: Exclude<SubscriptionPlan, ''>): IapProductId {
  return IAP_PRODUCTS[plan];
}

export function productIdToPlan(productId: string): Exclude<SubscriptionPlan, ''> | null {
  if (productId === IAP_PRODUCTS.monthly) return 'monthly';
  if (productId === IAP_PRODUCTS.yearly) return 'yearly';
  return null;
}

// Apple 僅對 monthly 配置了 7 天免費試用
export const TRIAL_ELIGIBLE_PRODUCTS: readonly IapProductId[] = [IAP_PRODUCTS.monthly];
```

### 4.4 `services/iap-service.ts` 對外介面

```ts
export interface PurchaseReceipt {
  transactionReceipt: string;   // base64 — 送給 /verify 的 receipt_data
  productId: IapProductId;
  transactionId: string;
}

export interface EligibilityResult {
  productId: IapProductId;
  eligibleForIntroOffer: boolean;
}

export interface IapService {
  initialize(): Promise<void>;        // 在 login 後呼叫，多次呼叫 idempotent
  teardown(): Promise<void>;          // 在 logout 時呼叫
  
  getProducts(): Promise<Product[]>;  // 拉 App Store 產品資訊（localizedPrice、title 等）
  checkEligibility(): Promise<EligibilityResult[]>;  // 查 intro offer 合規
  
  purchase(productId: IapProductId): Promise<PurchaseReceipt>;
  restore(): Promise<PurchaseReceipt[]>;
  
  // 只在 /verify 成功後或 PRODUCT_ID_MISMATCH 時呼叫
  finishTransaction(transactionId: string): Promise<void>;
  
  // 供 auth-store / hooks 訂閱「孤兒交易已驗證成功」事件
  onOrphanPurchaseVerified(cb: () => void): () => void;  // 回傳 unsubscribe
}

export const iapService: IapService;  // singleton
```

---

## 5. Purchase 生命週期狀態機

### 5.1 SubscriptionScreen 狀態機

```
          ┌─────────┐
          │  idle   │ ◀──────────────────────────────┐
          └────┬────┘                                 │
        按「立即訂閱」                                  │
               ▼                                       │
       ┌───────────────┐                               │
       │ loading(IAP)  │ — 彈 Apple UI                 │
       └───┬───────┬───┘                               │
           │       └──────────┐                        │
    使用者同意                使用者取消/失敗            │
           ▼                  ▼                        │
  ┌─────────────────┐   ┌──────────────────────┐       │
  │ loading(verify) │   │  error (可重試)       │──────▶│
  └───┬─────────┬───┘   └──────────────────────┘       │
      │         │                                      │
  200 OK   4xx/5xx                                     │
  (或 2002)                                            │
      │         └───────────┐                          │
      ▼                     ▼                          │
┌─────────────┐    ┌──────────────────────┐            │
│ loadSub     │    │ error+已付款未驗證    │───重試───▶ │
│ success     │    │ (自動重送 / Restore)  │            │
│ Modal       │    └──────────────────────┘            │
└──────┬──────┘                                        │
       │                                                │
  關閉 Modal ────────────────────────────────────────────┘
       │
       ▼
   navigate back
```

### 5.2 Happy path

1. `setIsLoading(true)` → `iapService.purchase(productId)`
2. Service 內部：
   - 在 `pendingPurchase: Map<productId, Deferred>` 寫入 Deferred
   - `requestSubscription({ sku: productId })` 觸發系統 UI
   - `purchaseUpdatedListener` 收到事件 → resolve Deferred
3. Screen 拿到 `PurchaseReceipt` → `verifyIapReceipt(receipt.transactionReceipt, selectedPlan)`
4. 成功 → `await loadSubscription()` 刷新 `auth-store.subscription`
5. **`iapService.finishTransaction(transactionId)`** — 最後才 ack Apple
6. `setShowPaymentSuccess(true)`

### 5.3 關鍵失敗路徑

**A. 使用者取消**
- `react-native-iap` 拋 `E_USER_CANCELLED`
- `iap-errors.ts` 分類 → `cancelled`
- UI **靜默回 idle**，不彈 alert、不當錯誤 log

**B. Deferred（Screen Time 家長控管 / 企業 MDM）**
- 拋 `E_DEFERRED_PAYMENT`
- UI 彈 `errors.deferred` 訊息 + 回 idle
- Transaction 保留，核准後 listener 會收到

**C. Apple UI 失敗 / 網路錯誤（`E_NETWORK_ERROR`, `E_UNKNOWN`）**
- UI 進 `error` 狀態 + 「重試」按鈕
- 無 transaction 需處理

**D. 驗證階段網路失敗（最危險 — Apple 已扣款但 `/verify` 沒到）**
- **不 finish transaction**，Apple 會在下次啟動透過 listener 重送
- Service 呼叫方立即做 2 次重試（exponential backoff 1s → 4s，合計約 5s）
- 仍失敗 → UI 顯示 `errors.verifyRetrying` + 提供 Restore 按鈕當手動救援
- 下次 app 啟動 `initialize()` 掛 listener 時自動補打 `/verify`（孤兒路徑）

**E. Backend 2002 `RECEIPT_ALREADY_USED`**
- **當成功處理**：`finishTransaction` + `loadSubscription`
- `iap-errors.ts` 把 2002 標記為 `SILENT_SUCCESS`
- 這是最重要的一條 — 防止「付款後 crash」變成「永遠訂閱不了」

**F. Backend 2003 `PRODUCT_ID_MISMATCH`**
- **必須 finish transaction**（否則 listener 無限迴圈）
- UI 顯示 `errors.productMismatch`（「產品設定有誤，請聯絡客服」）
- 不自動重試

### 5.4 Deferred 配對規則

`pendingPurchase: Map<productId, { resolve, reject, timeout }>`

- 使用者主動觸發 purchase → 寫入 Deferred，listener 事件 resolve
- 事件到但 Map 是空的 → 走孤兒路徑（自動驗證）
- Deferred timeout = 60 秒，超時 reject（listener 仍會處理後續事件）

### 5.5 孤兒交易自動恢復

`initialize()` 掛 listener 後，Apple 會自動推送 queue 中所有未 ack 交易：

```
handleOrphanPurchase(purchase) {
  const plan = productIdToPlan(purchase.productId);
  if (!plan) {
    // 不認得的 product — finish 掉避免卡 queue
    await iapService.finishTransaction(purchase.transactionId);
    log.warn('orphan receipt with unknown productId', purchase.productId);
    return;
  }
  
  try {
    await verifyIapReceipt(purchase.transactionReceipt, plan);
    // 200 OK 或 2002 都來到這裡
    await iapService.finishTransaction(purchase.transactionId);
    emitOrphanPurchaseVerified();  // AuthProvider 監聽 → 觸發 loadSubscription
  } catch (err) {
    if (isApiError(err, ERROR_CODE.PRODUCT_ID_MISMATCH)) {
      await iapService.finishTransaction(purchase.transactionId);
      log.warn('orphan receipt product_id_mismatch', purchase);
      return;
    }
    // 其他錯誤（網路、2001）：不 finish，下次啟動再試
  }
}
```

---

## 6. Trial（Apple Introductory Free Trial）處理

### 6.1 Eligibility 檢查

- `SubscriptionScreen` mount 時呼叫 `iapService.checkEligibility()`
- Service 內部：對 `TRIAL_ELIGIBLE_PRODUCTS` 逐一查 `react-native-iap` 的 `subscriptionOfferDetails` / `isEligibleForIntroOffer`
- 回傳 `{ productId, eligibleForIntroOffer }[]`
- Screen 用結果決定月卡文案（不阻塞 UI 初始渲染，有結果後 re-render）

### 6.2 文案動態切換

月卡：

| Eligibility | UI 顯示 |
|---|---|
| `eligibleForIntroOffer = true` | `subscription.plans.monthly.trialOffer`（例：「7 天免費試用，之後 ¥9.9/月」） |
| `eligibleForIntroOffer = false` | `subscription.plans.monthly.subtitle`（例：「¥9.9/月」） |
| 查詢失敗 / 尚未完成 | fallback 到非 trial 文案（不誤導使用者） |

年卡：永遠顯示 `subscription.plans.yearly.*`，與 eligibility 無關。

### 6.3 Trial 期間 receipt 流程

- Receipt 裡 `is_trial_period: true`，`expires_date_ms = 第 7 天`
- 後端 `/verify` 照常處理：入 `subscriptions` 表，`status = active`、`expire_at = 第 7 天`
- `auth-store.subscription.status = 'subscribed'`（不是 `trialing` — 那個狀態專屬後端 sign-up trial）
- 第 7 天到期，Apple 送 webhook：
  - `DID_RENEW` → 後端 webhook V2 handler 續期 expire_at +1 月
  - `DID_FAIL_TO_RENEW` → 進 60 天 billing retry grace period

### 6.4 Trial 取消

- 使用者在 iOS 系統設定取消自動續訂
- Apple 第 7 天送 `CANCEL` webhook（notificationType），expire_at = 第 7 天
- 後端 webhook V2 handler 把 subscription status 設 expired
- 使用者下次啟動 `loadSubscription` → 狀態 `sub_expired` → 進 paywall

---

## 7. Restore Purchases

### 7.1 UI 入口

- **位置 A（主要）**：`SubscriptionScreen` paywall 底部文字連結樣式，與訂閱條款同列
- **位置 B（輔助，本期範圍內）**：`SettingsScreen` 訂閱管理區塊，讓換機使用者能找到

### 7.2 文案（新增 i18n key）

```json
"restore": {
  "action": "恢復購買",
  "inProgress": "恢復中...",
  "success": "已恢復你的訂閱",
  "empty": "沒有可恢復的訂閱",
  "failed": "恢復失敗，請稍後重試"
}
```

### 7.3 流程

```
tap「恢復購買」
  → iapService.restore()
    → getAvailablePurchases()  // StoreKit 2 回所有 active subscription
    → receipts: Purchase[]
  
  if receipts.length === 0 → 顯示 "empty"
  
  foreach receipt in receipts.slice(0, MAX_RESTORE_RECEIPTS=10):
    plan = productIdToPlan(receipt.productId)
    if !plan: skip
    try:
      verifyIapReceipt(receipt.transactionReceipt, plan)
      await iapService.finishTransaction(receipt.transactionId)
      successCount++
    catch 2002:
      await iapService.finishTransaction(receipt.transactionId)
      successCount++
    catch 2003:
      skip (不同 bundle 殘留)
    catch 其他:
      failCount++ (不 finish)
  
  if successCount > 0 → loadSubscription() + 顯示 "success"
  else → 顯示 "failed"
```

### 7.4 邊界條件

- **沙盒 availablePurchases 可能回大量歷史測試 receipt** → `MAX_RESTORE_RECEIPTS = 10` 限制
- **Deferred 狀態的 receipt** `transactionReceipt` 為空 → skip
- **已退款訂閱** 出現但 expire_at 已過 → 後端回成功、`loadSubscription` 後 UI 自動顯示 `sub_expired`
- **部分成功算整體成功**：N 張中 1 張過即進 success 分支

---

## 8. 錯誤矩陣

| 來源 | 錯誤碼 / 事件 | 分類 | UI 行為 | Transaction 處理 |
|---|---|---|---|---|
| RN-IAP | `E_USER_CANCELLED` | `cancelled` | 靜默回 idle，不 alert | 無 |
| RN-IAP | `E_DEFERRED_PAYMENT` | `deferred` | alert `errors.deferred` + 回 idle | 保留（待核准） |
| RN-IAP | `E_NETWORK_ERROR` | `retryable` | `error` 狀態 + 重試按鈕 | 無 |
| RN-IAP | `E_ALREADY_OWNED` | `auto_restore` | 自動觸發 restore 流程 | restore 處理 |
| RN-IAP | `E_ITEM_UNAVAILABLE` | `fatal_config` | `errors.productUnavailable` | 無 |
| RN-IAP | `E_UNKNOWN` | `retryable` | `errors.iapFailed` + 重試 | 有 receipt 走孤兒 |
| Backend | 2001 `IAP_VERIFY_FAILED` | `retryable` | `errors.verifyFailed` + 重試 | 保留（listener 重送） |
| Backend | 2002 `RECEIPT_ALREADY_USED` | `silent_success` | success flow | finish |
| Backend | 2003 `PRODUCT_ID_MISMATCH` | `fatal_mismatch` | `errors.productMismatch` | **finish**（避免卡 queue） |
| Backend | 9004 `NETWORK_ERROR` / 5xx | `retryable` | `error+已付款未驗證` + 自動 retry 2 次 + Restore 按鈕 | 保留 |

**設計原則**

1. **Finish 是「ack 這筆交易已處理完畢」** — 只在後端入帳、或永遠無法處理（2003）時呼叫
2. **Cancel 與 error 分開處理** — 使用者主動取消不是錯誤
3. **靜默自動恢復優先於 UI 錯誤** — 孤兒路徑在背景補打，使用者可能無感
4. **2002 當成功** — 最關鍵一條，防付款後 crash 死循環

---

## 9. 測試計畫

### 9.1 單元 / 元件測試（vitest）

| 測試檔 | 驗證項 |
|---|---|
| `services/__tests__/iap-service.test.ts` | `initialize()` idempotent、purchase Deferred 三路徑（resolve/reject/timeout）、孤兒交易 handler（2002 當成功、2003 強制 finish）、restore 三路徑（空/部分/全失敗）、`teardown()` 正確 unsubscribe、`checkEligibility` 對 monthly / yearly 回傳正確 |
| `services/__tests__/iap-errors.test.ts` | 每個 error code 有對應 i18n key、cancel 不當錯誤、2002 標記 SILENT_SUCCESS |
| `constants/__tests__/iap.test.ts` | `productIdToPlan` / `planToProductId` 雙向正確、未知 productId 回 null |
| `hooks/__tests__/useIapLifecycle.test.ts` | login → initialize、logout → teardown、re-login 不 leak listener |
| `screens/__tests__/SubscriptionScreen.test.tsx` | idle/loading/error/success/restoring 五態 UI 正確、Restore 按鈕觸發 restore、2002 當成功觸發 PaymentSuccessModal、eligibility 切換月卡文案 |

Mock 策略：`services/iap-service.ts` 在 screen test 完全 mock；`iap-service.test.ts` 自己 mock `react-native-iap` 模組。

### 9.2 手動裝置測試（Apple Sandbox）

新增到 `docs/testing/beta-test-matrix.md`：

| 場景 | 前置條件 | 驗證點 |
|---|---|---|
| 首次訂閱 monthly（享 trial） | 全新沙盒帳號 | UI 顯示「7 天免費試用」、扣款 0 元、receipt `is_trial_period: true`、第 7 天自動轉付費 |
| 已用過 trial 訂閱 monthly | 沙盒帳號先用過 trial | UI 顯示「¥9.9/月」無 trial 文案、立即扣款 |
| Trial 期間取消自動續訂 | Monthly trial active | 第 7 天到期變 `sub_expired`、不扣款 |
| 首次訂閱 yearly | 全新沙盒帳號 | 扣款 ¥104、訂閱期限 1 年、無 trial |
| 訂閱後殺 app 重啟 | Monthly active | 狀態仍 subscribed、無重複扣款 |
| 付款後 `/verify` 前斷網 | Sandbox + 飛航模式 | 恢復網路後下次啟動自動補驗證 |
| 使用者取消購買 UI | Sandbox | 無 alert、無錯誤 log、UI 回 idle |
| Deferred（Screen Time） | 啟用 Screen Time 付款限制 | 顯示 deferred alert |
| 跨裝置 Restore | 裝置 A 訂閱、裝置 B 登同帳號 | 裝置 B Restore → 狀態 subscribed |
| 月訂升級為年訂 | Monthly active | Apple 按比例處理、webhook V2 同步、UI 更新為 yearly |
| 取消自動續訂 | 已訂閱 | 到期前顯示「已取消」、到期變 sub_expired |
| 退款（sandbox CONSUMPTION_REQUEST） | 訂閱後觸發退款 | Webhook V2 同步、狀態變 sub_expired |

### 9.3 沙盒帳號需求

- 至少 3 個 App Store Connect 沙盒測試帳號（地區=中國）
- 測試用途分配：全新訂閱、跨裝置 restore、trial 已用過
- 沙盒週期加速：1 month = 5 min、1 year = 1 hour

---

## 10. Rollout 策略

### 10.1 Feature flag

`constants/features.ts` 擴充：

```ts
export const FEATURES = {
  SUBSCRIPTION_ENFORCEMENT: false,  // 既有：paywall 強制
  IAP_ENABLED: false,               // 新：實際 IAP 流程
  IAP_RESTORE_ENABLED: false,       // 新：Restore 按鈕曝光
} as const
```

### 10.2 階段

**階段 1 — Dev build 內部驗證（週 1）**
- `IAP_ENABLED = true`（`__DEV__` only）
- `SUBSCRIPTION_ENFORCEMENT = false`
- 開發團隊用沙盒帳號跑完測試矩陣 12 條

**階段 2 — TestFlight Beta（週 2）**
- 所有 flag true
- 發 TestFlight 給 20 名內測
- 監控後端：2001/2002/2003 比例、`/verify` p95 latency、`RECEIPT_ALREADY_USED` 比例（> 5% 暗示前端 finish bug）

**階段 3 — App Store Review**

提審 checklist：

- [ ] Restore Purchases 按鈕曝光在 paywall
- [ ] 自動續訂條款明確列在 paywall：期限、續費週期、取消方式
- [ ] Privacy Policy + Terms of Use 連結可點
- [ ] Monthly trial 文案與 App Store Connect 設定一致
- [ ] Review notes 附沙盒帳號、測試步驟截圖
- [ ] `SUBSCRIPTION_ENFORCEMENT = true` 的 build 已通過內部回歸

**階段 4 — Production**

上架後所有 flag true，監控：

| 指標 | 健康值 | 異常代表 |
|---|---|---|
| `/verify` 成功率 | > 98% | 前端 bug |
| 2002 比例 | < 3% | finish 邏輯問題 |
| 2003 比例 | = 0 | Product ID 不同步 |
| Restore 成功率 | > 80% | 帳號切換或驗證問題 |
| Trial → 付費轉換率（`DID_RENEW` / `INITIAL_BUY`） | > 30%（行業基準） | 產品定價 / 文案問題 |

---

## 11. 風險與應對

| 風險 | 影響 | 應對 |
|---|---|---|
| `react-native-iap` 大版本 breaking | service 層要重寫 | Pin `^12.16.x`；升版前跑完測試矩陣 |
| Sandbox 週期加速誤判 | 看起來正常的續訂在 prod 失敗 | TestFlight 用真實帳號持續驗證 |
| Apple Review 退件（訂閱條款不夠明確） | 上架延遲 1 週 | Paywall 文案提審前由產品 / 法務 review |
| `/verify` 後端掛 | 使用者付款後看不到訂閱 | 孤兒交易自動恢復 + Restore + webhook V2 second source of truth |
| 中國區沙盒帳號審核與區域不符 | 開發自測卡關 | 沙盒帳號 region 選中國、裝置語言區域切中國 |
| Product ID 命名價格調整後不換 | UI 與扣款不符 | Spec 註記產品 ID 尾綴僅是命名慣例；後續迭代用 `localizedPrice` |
| Trial eligibility 查詢失敗 | 月卡文案預設到非 trial 版本 | Fallback 到非 trial 文案（不誤導），不阻塞 UI |

---

## 12. 後續迭代（記錄但不做）

- 用 `react-native-iap.getSubscriptions()` 拉 `localizedPrice` 取代硬編碼 `¥9.9 / ¥104`
- Paywall 加「管理訂閱」按鈕連到 `https://apps.apple.com/account/subscriptions`
- Promotional offers / win-back 折扣
- Analytics：訂閱漏斗（paywall 曝光 → 選方案 → 進 Apple UI → 完成 → 驗證成功）
- 7 天試用到期前 push 提醒（後端 cron）
- Android / Google Play Billing 支援
- 跨區 App Store 訂閱（需重新命名 product ID 或分群）
