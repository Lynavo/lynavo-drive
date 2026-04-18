# Account Identity Reset Design Spec

**日期：** 2026-04-18
**狀態：** Draft — pending review
**範圍：** Mobile（iOS + Android + JS）+ Desktop sidecar（macOS / Windows）
**起源：** IAP sandbox 測試時發現 A logout / B login 後 RootNavigator 直接進 SyncActivity 看到 A 的 Mac + history

---

## 1. 背景

現行 Vivi Drop Mobile 在三種「換人 / 重裝」場景下狀態殘留：

| 場景 | 現象 | 後果 |
| --- | --- | --- |
| A logout → B login（同裝置）| B 直接進 `SyncActivity` 看到 A 綁的 Mac | 帳號邊界洩漏，嚴重 UX 問題 |
| 刪 App → 重裝 | 自動登入前一個帳號（Keychain 倖存）| 重裝沒起到重置作用 |
| Token 過期 / 被動登出 | Settings 的 logout flow 沒走到 | 同「A → B 切換」，但沒 cleanup 機會 |
| Desktop 重開（mac / windows）| sidecar 仍保留 A 的 paired device / uploads / history | 桌面端仍看到舊測試資料，與 mobile reset 語意不一致 |

### 相關程式碼位置

- Logout 入口：`apps/mobile/src/screens/SettingsScreen.tsx:429` — 只呼叫 `serverLogout` + `auth.clearAuth()`，不碰 native
- 路由判斷：`apps/mobile/src/navigation/RootNavigator.tsx:159` — `AuthedStack` 看到 `NativeSyncEngine.getBindingState()` 有值就 `setInitialRoute('SyncActivity')`
- iOS 綁定儲存：`apps/mobile/ios/SyncEngine/BindingService.swift:85` — clientId + pairing token 存 Keychain（跨 App 刪除倖存）
- Desktop sidecar reset：`services/sidecar-go/internal/api/handlers_reset_state.go:15` — 已存在 `POST /settings/reset-state`，可清 `paired_devices / uploads / device_daily_stats / sessions` 與接收目錄

---

## 2. Root Cause

當前 codebase 的四層身份**脫節**：

```text
Layer 1  Auth identity
         └─ access_token / refresh_token
         └─ Storage: Keychain (cn.vividrop.auth)
         └─ 清理: clearAuth()     ← 唯一有清的層

Layer 2  Sync identity            ← 完全沒清
         └─ binding (user × mac pairing)
         └─ pairing token
         └─ clientId              ← 裝置 × 帳號 的身份
         └─ upload queue
         └─ sync sessions
         └─ daily ledger / local history
         └─ auto upload config
         └─ Storage: iOS Keychain + SQLite / Android SharedPrefs

Layer 3  UI-scoped state          ← 完全沒清
         └─ reminder-shown AsyncStorage keys (@vividrop/reminder-shown/*)

Layer 4  Desktop sidecar state    ← 目前也不會隨 account boundary 清
         └─ paired_devices
         └─ uploads
         └─ device_daily_stats
         └─ sessions
         └─ receive dir / staging dir
         └─ Storage: sidecar SQLite + filesystem（mac / windows 同一份 Go 實作）
```

`clearAuth()` 只處理 Layer 1。Layer 2 是 mobile UX 洩漏的主因（B 看到 A 的 Mac）；Layer 3 是輔助問題（B 當天看不到該彈的 reminder）；Layer 4 則會讓 desktop app 在 mac / windows 上繼續顯示舊 paired device 與 history。

---

## 3. Design

### 3.0 開發版前提

目前是**開發版本**，本設計採用以下簡化前提：

- **不考慮資料遷移**
- **不考慮向後兼容**
- **不保留既有測試資料**
- 若跨 account boundary 需要 reset，允許直接清空 mobile 與 desktop sidecar 的測試狀態

因此，本 spec 以「狀態乾淨、邏輯單純」優先，而不是保留舊資料。

### 3.1 三層 Defense-in-Depth

| Defense | 觸發時機 | 作用 |
| --- | --- | --- |
| **Explicit logout cleanup** | Settings Logout / Delete Account 使用者主動觸發 | 正常 happy path；同時清 mobile + best-effort 清目前綁定的 desktop sidecar |
| **Owner-mismatch guard** | Login 成功 + profile 載入後比對 `lastSyncOwnerUserId` vs `auth.user.id` | 處理 token 過期、app crash 中斷、被動登出等非典型路徑 |
| **iOS reinstall sentinel** | App 冷啟動時檢查 UserDefaults install marker | 處理「刪 App 但 Keychain 倖存」 |

任一條 defense 失敗，下一條仍能攔下殘留狀態。

### 3.2 單一清理入口：`SyncEngineModule.wipeSyncIdentity()`

Native bridge 暴露的原子操作。任何觸發清理的時機都調用這一個 method。

**清理範圍：**

- binding（與 Mac 的配對記錄）
- pairing token
- clientId
- upload queue（未完成上傳）
- sync sessions
- daily ledger / local history
- auto upload config
- reminder-shown AsyncStorage keys（`@vividrop/reminder-shown/*`，JS 側負責）

**保留範圍：**

- 語言設定、theme、系統權限狀態
- `clientDisplayName`（「我的 iPhone」等裝置 label，視為裝置偏好非帳號資料）
- Debug override（`@vividrop/debug/api_base_url`，開發工具跟 user 無關）

### 3.3 Desktop sidecar reset（新增）

開發版下，desktop sidecar 不保留跨帳號測試資料。設計上直接使用既有：

- `POST /settings/reset-state`

其效果：

- 清 `paired_devices`
- 清 `uploads`
- 清 `device_daily_stats`
- 清 `sessions`
- 清 `receive dir`
- 清 `staging dir`
- **保留** sidecar settings / share config

此 API 為 Go sidecar 內部實作，對 macOS / Windows 共用，只有資料目錄路徑不同，reset semantics 相同。

### 3.4 Storage Conventions（新增）

| 資料 | iOS | Android | 為什麼 |
| --- | --- | --- | --- |
| `lastSyncOwnerUserId` | UserDefaults | SharedPreferences | native-visible；reinstall / wipe recovery 可直接讀取 |
| `vivi_install_marker` | UserDefaults | SharedPreferences | 刪 App 時 OS 會清空；reinstall 偵測靠它 |
| Auth tokens | Keychain（不變） | EncryptedSharedPreferences（不變） | 現行設計 |
| Sync identity (clientId / pairing) | Keychain（不變，但加清理路徑） | SharedPreferences（不變，但加清理路徑） | 現行設計 |

---

## 4. Implementation Phases

### Phase 1 — Native wipe + logout/delete-account 串接

**新增 files / methods：**

| 檔案 | 改動 |
| --- | --- |
| `apps/mobile/ios/SyncEngine/SyncEngineManager.swift` | 新增 `wipeSyncIdentity()` — 作為單一 orchestrator，協調清 binding / pairing token / clientId / upload queue / sync sessions / daily ledger / auto upload config。保留 clientDisplayName。 |
| `apps/mobile/ios/SyncEngine/BindingService.swift` | 補 `clearClientId()` 等底層 keychain helper，供 `SyncEngineManager.wipeSyncIdentity()` 調用 |
| `apps/mobile/android/.../NativeSyncEngineModule.kt` | 對應 Android 實作：清 `PREF_BINDING` / `PREF_CLIENT_ID` / owner/install marker；目前 Android shell 無 queue/history DB，不額外引入 Room |
| `apps/mobile/src/services/SyncEngineModule.ts` | 暴露 `wipeSyncIdentity(): Promise<void>` bridge |
| `apps/mobile/src/services/sidecar-reset-service.ts`（新檔） | 根據目前 binding host，best-effort 呼叫 `POST http://<host>:39394/settings/reset-state` |
| `apps/mobile/src/utils/clearUserScopedStorage.ts`（新檔） | `getAllKeys()` + filter `@vividrop/reminder-shown/*` + `multiRemove` |
| `apps/mobile/src/screens/SettingsScreen.tsx:429` | `handleLogout`：`serverLogout → await resetCurrentDesktopSidecarIfReachable() → await SyncEngineModule.wipeSyncIdentity() → await clearUserScopedStorage() → auth.clearAuth()` |
| `apps/mobile/src/screens/SettingsScreen.tsx:472` | `handleDeleteAccount`：`deleteAccount → auth.setSignedOutTransition('account_deleted') → await resetCurrentDesktopSidecarIfReachable() → await wipeSyncIdentity() → await clearUserScopedStorage() → auth.clearAuth()` |
| `apps/desktop/src/.../Settings` | 新增「重置測試狀態」入口，直接呼叫本機 sidecar `POST /settings/reset-state`，供 mac / windows 手動清空 desktop 測試資料 |

**順序要求：**

- desktop sidecar reset 與 native wipe 都 **必須 await**
- sidecar reset 採 **best-effort**：若目前綁定桌機不可達，記 warning，但不阻塞 mobile 本地 wipe
- native wipe **不能** fire-and-forget，否則 `clearAuth` 觸發的 navigation 轉跳可能 race 到 wipe 還沒完成、下一個 login flow 撞進殘留狀態
- `reminder-shown` 也跟著 await，讓「logout 完成後 user-scoped UI state 已清空」成為真保證，而不是 best effort

### Phase 2 — Owner-mismatch Guard

**新增 native bridge methods：**

| Method | 實作 |
| --- | --- |
| `NativeSyncEngine.getOwnerUserId(): Promise<number \| null>` | 從 UserDefaults/SharedPrefs 讀 `lastSyncOwnerUserId`；無 → null |
| `NativeSyncEngine.setOwnerUserId(userId: number): Promise<void>` | 寫入 UserDefaults/SharedPrefs |

**插入位置：**

`apps/mobile/src/stores/auth-store.tsx` 的 post-login bootstrap。這一段**不能**在 `loadProfile()` 已經先 `dispatch(SET_USER)` 之後才做，否則 RootNavigator 會提早進 `AuthedStack`，讓 `getBindingState()` 先讀到舊 binding。

因此要把目前的 `loadProfile()` / `ensureProfileLoaded()` 拆成：

- `fetchProfile()`：只拿 API profile，不直接 `dispatch(SET_USER)`
- `bootstrapAuthedSession(profile)`：做 owner check / wipe / owner 寫回 / subscription load
- 全部完成後才 `dispatch(SET_USER)` 與 `PROFILE_LOAD_SUCCESS`

參考流程：

```ts
dispatch({ type: 'PROFILE_LOAD_START' });
const profile = await fetchProfile();

const storedOwnerId = await NativeSyncEngine.getOwnerUserId();
if (storedOwnerId !== null && storedOwnerId !== profile.id) {
  await resetCurrentDesktopSidecarIfReachable();
  await NativeSyncEngine.wipeSyncIdentity();
  await clearUserScopedStorage();
}
await NativeSyncEngine.setOwnerUserId(profile.id);

dispatch({ type: 'SET_USER', user: profile });

try {
  await loadSubscription();
} catch (err) {
  console.warn('[auth-store] subscription load failed (non-fatal)', err);
}

dispatch({ type: 'PROFILE_LOAD_SUCCESS' });
```

**為什麼放這裡：** AuthProvider 的 post-login bootstrap 是 profile 回來的唯一 funnel。只要保證 `SET_USER` 發生在 owner check 完成之後，RootNavigator 進 `AuthedStack` 時看到的就已經是 owner-consistent state。

**race-condition / failure 處理：**

- `bootstrapAuthedSession` 內每一個 `await` 之後都要檢查 cancellation / auth-cleared flag。若 bootstrap 過程中 user 已觸發 logout，或 API layer 已因 token 失效而 `CLEAR` auth，就必須立刻 abort，不能再繼續 `dispatch(SET_USER)` 或 `PROFILE_LOAD_SUCCESS`。
- wipe 失敗時 fail-closed：若 `wipeSyncIdentity()` reject，視為「清理未完成，不可進主 stack」，auth-store 把 `profileError` 設為 wipe error，讓 RootNavigator 渲染 ProfileErrorScreen 而非 AuthedStack。
- owner mismatch 時也對目前綁定的 desktop sidecar 做 best-effort reset，避免 token 過期 / crash 中斷後，desktop 端仍殘留 A 的 paired device / history。
- owner-match 且同一 user 被動登出後重新登入時，不清 `reminder-shown`，避免把「同一人當天已看過的提醒」重置掉。

### Phase 3 — iOS Reinstall Sentinel

**插入位置：** `apps/mobile/ios/SyncFlowMobile/AppDelegate.swift` 的 `application(_:didFinishLaunchingWithOptions:)` 最早期（在 `RCTBridge` 初始化之前）。

**邏輯：**

```swift
let marker = UserDefaults.standard.string(forKey: "vivi_install_marker")
if marker == nil {
    try? SyncEngineManager.shared.wipeSyncIdentity()
    // 同時清 auth Keychain（auth 層的 reinstall 偵測也一併做）
    AuthKeychainCleaner.clearPersistedTokens()
    UserDefaults.standard.set("1", forKey: "vivi_install_marker")
}
```

**Android equivalent：** `MainApplication.onCreate` 做同樣檢查 SharedPreferences 的 `vivi_install_marker`。

**為什麼放這麼早：** 必須在 JS bridge 啟動前完成，否則 JS 的 `loadPersistedTokens()` 可能搶先 hydrate 到殘留 token。

---

## 5. 測試計畫

### 5.1 自動化

| 測試 | 檔案 | 驗證內容 |
| --- | --- | --- |
| `clearUserScopedStorage` unit test | `apps/mobile/src/utils/__tests__/clearUserScopedStorage.test.ts` | 掃描到 `reminder-shown` 前綴並 `multiRemove`；非相關 key 保留 |
| sidecar reset service unit test | `apps/mobile/src/services/__tests__/sidecar-reset-service.test.ts` | 有 binding host 時 POST `/settings/reset-state`；無 binding 時跳過；失敗只記 warning |
| Owner-mismatch triggers wipe | `apps/mobile/src/stores/__tests__/auth-store-owner-check.test.ts` | mock `getOwnerUserId`=A、`profile.id`=B → 斷言 `wipeSyncIdentity` 被呼叫 1 次、`setOwnerUserId(B)` 被呼叫 1 次 |
| Owner-match no wipe | 同上 | `getOwnerUserId`=A、`profile.id`=A → `wipeSyncIdentity` 不被呼叫 |
| Bootstrap 未完成前不可進主 stack | `apps/mobile/src/navigation/__tests__/RootNavigator.owner-guard.test.tsx` | mock profile bootstrap in-flight → 不應看到 SyncActivity / DeviceDiscovery，仍停留 LoadingScreen |
| iOS install sentinel（Xcode unit test） | `apps/mobile/ios/SyncFlowMobileTests/InstallSentinelTests.swift` | UserDefaults 空 → 觸發 wipe；非空 → 不觸發 |
| sidecar reset handler test | `services/sidecar-go/internal/api/router_test.go` | 驗證 `/settings/reset-state` 清 DB + receive dir；mac / windows 不需要分開寫邏輯測試，因為共用 Go handler |

### 5.2 Manual（實機）

| 步驟 | 預期 |
| --- | --- |
| A 綁 Mac + 有 history → Settings logout → B phone 登入 | 進入 DeviceDiscovery，看不到 A 的 Mac |
| A 有 upload queue → logout → B 登入 | 看不到 A 的 queue |
| 刪 App → 重裝 → 登入任意帳號 | 進 DeviceDiscovery，無舊 binding |
| Desktop（mac / windows）已有 A 的 dashboard/history → 執行 reset-state | dashboard / history 清空，接收目錄與 staging 清空，但 settings / share config 保留 |
| A logout → 再以 B 登入 → 後端 log 裡兩次 `/verify` 的 clientId 不同 | clientId 完成輪換 |
| 被動登出（server 401）→ 重登 A | 無異常，維持同 `lastSyncOwnerUserId` |

### 5.3 測試矩陣邊界

- **wipe 中失敗**：模擬 SyncEngine.wipe reject → 斷言 auth-store 進 profileError 狀態、RootNavigator 渲染 ProfileErrorScreen
- **首次啟動**（new install）：UserDefaults 沒 marker + Keychain 也沒 token → 直接設 marker、不觸發無意義 wipe
- **owner mismatch + desktop 可達**：應同時呼叫 sidecar reset + mobile wipe，兩邊都不保留舊測試資料

---

## 6. 驗收標準

從原始設計稿延伸，新增 owner-guard 相關驗收：

1. ✅ A logout → B login 同裝置 → **直接進 DeviceDiscovery**，不進 SyncActivity
2. ✅ A 有 queue / history → B login → **B 看不到 A 的本地同步紀錄**
3. ✅ iOS 刪 App 重裝 → 登入任意帳號 → **無自動帶出舊 binding**
4. ✅ 帳號切換後 **clientId 輪換**，server log 可見新舊 clientId 不同
5. ✅ RootNavigator **僅在 owner 一致時**才依 binding 直進 SyncActivity
6. ✅（新）`wipeSyncIdentity` 中途失敗 → UI 進入 ProfileErrorScreen，**不**進 AuthedStack
7. ✅（新）owner mismatch / explicit logout 後 `reminder-shown` 被清空 — 新用戶當天可看到自己的 reminder
8. ✅ `clientDisplayName` 與 debug override 在 wipe 後**仍保留**
9. ✅ Desktop sidecar 在 mac / windows 執行 `reset-state` 後，不再保留舊 paired device / uploads / history / receive dir 測試資料

---

## 7. 風險

### 7.1 Partial wipe 的 atomicity

Native wipe 要清多個 storage region（Keychain / UserDefaults / SQLite）。若中途 crash，下次啟動可能處於「一半 clean 一半髒」狀態。

**處理：** wipe 實作採用「先標記 wipe_in_progress → 逐一清理 → 最後清標記」的簡易 2-phase。啟動時檢查若 `wipe_in_progress=1`，視為 dirty state，**再 wipe 一次**。小成本，大幅提升 robustness。

### 7.2 Desktop reset 的破壞性

`/settings/reset-state` 會清整個 sidecar DB 的 runtime tables 與接收目錄，而不是只清單一 clientId。這在開發版是**刻意接受**的簡化：保證測試環境乾淨，比保留多設備測試資料更重要。

### 7.3 Android bridge 同步差異

iOS Keychain 是同步 API；Android SharedPreferences 也是。兩端的 wipe bridge 都應維持 `Promise<void>` 介面，讓 JS 端一致 await。Android 現階段只需清 SharedPreferences 內的 sync identity 與 owner/install metadata；若日後 Android 真接上本地 queue/history DB，再把 DB truncate 納入同一個 wipe 入口。

### 7.4 測試 coverage gap

UI 層的「B 看不到 A 的 history」類驗收（驗收標準 2）很難自動化 —— 涉及 SyncActivity、HistoryScreen 的實際 rendering，需要 navigator fully wired + native engine mocked 很重。**暫定 manual 驗收**，自動化待後續補。

---

## 8. 需要 Review 確認的點

- [x] Scope 決策：`clientDisplayName` 保留
- [x] Scope 決策：debug override 保留
- [x] Phase 1 ordering：接受 native wipe / desktop sidecar reset await，logout UI 以 loading / spinner 過渡
- [x] desktop sidecar reset 接受以「整台桌機測試狀態清空」為語意，而不是只清單一 clientId
- [x] auth-store bootstrap 接受把 `loadProfile()` 拆成「fetch 不 dispatch」+「bootstrap 後才 SET_USER」
- [x] Phase 3 reinstall sentinel：auth Keychain 一起清
- [x] 驗收標準 6 的 failure UX：wipe 失敗時顯示 ProfileErrorScreen 合適，維持 fail-closed

---

## 9. 實作順序 + 時程估計

| Phase | 工作量 | 產出 |
| --- | --- | --- |
| 1 | ~75 min | native wipe + mobile logout/delete 串接 + desktop sidecar reset service + JS unit tests |
| 2 | ~45 min | owner-mismatch guard + auth bootstrap 重構 + tests |
| 3 | ~45 min | iOS UserDefaults sentinel + Android SharedPrefs sentinel |
| 4 | ~30 min | desktop 設定頁 reset-state 入口（mac / windows 共用） |
| 測試 sweep | ~30 min | 跑 jest + tsc + go test + 手動驗收 |

**總計：** ~3.5 小時（不含非預期 Android bridge / desktop UI 細節）

---

## 10. 與其他 in-flight 工作的關係

- **Task 22（IAP sandbox testing）**：此 fix 完成後**能讓 Task 22 的 user-switch 測試變乾淨** —— Case 4.1（Restore Purchases 刪 App 重裝）可以自然實現，不用手動 bump `token_version`
- **Task 23（IAP flag flip）**：獨立 commit，不衝突
- **`subscription_intro_trial` 重構**（當前 uncommitted）：獨立 commit，不衝突

建議 commit 順序：

```text
7eb2a75 (current HEAD)
├── refactor(mobile): split trial display into account vs subscription intro
├── fix(mobile): wipe native sync identity on logout + account switch (Phase 1)
├── fix(mobile): guard RootNavigator against owner mismatch (Phase 2)
├── fix(mobile): iOS reinstall sentinel wipes stale Keychain (Phase 3)
├── feat(desktop): add "reset test state" action in Settings (Phase 4)
└── feat(mobile): enable SUBSCRIPTION_ENFORCEMENT + IAP flags (Task 23)
```
