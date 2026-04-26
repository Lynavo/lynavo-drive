# Switch Device — Design Spec

**Date:** 2026-04-23
**Branch:** dev
**PRD reference:** §4.1–4.3（設備連接與切換）

---

## Overview

Allow the user to switch the currently connected desktop from the Settings page. Previously connected devices (those with a stored pairing token) can reconnect directly without re-entering a 6-digit code. Newly discovered devices still go through the existing CodeVerify flow.

Offline devices (not discoverable on the current LAN) are not shown.

---

## Approach

Extend `DeviceDiscoveryScreen` with an optional `mode?: 'switch'` parameter. The `initial` mode (default) retains all existing onboarding behavior unchanged. The `switch` mode changes navigation entry, header UI, known-device identification, and tap behavior.

No new screen is created.

---

## Changes by Layer

### 1. Native Swift — `RNBridge.swift`

New method: `getKnownDeviceIds()`

Reads all Keychain keys via `bindingService.listStoredKeychainKeys()`, strips the `syncflow_pairing_token_` and legacy `pairing_token_` prefixes, and returns the remaining serverIds as a string array.

```swift
@objc func getKnownDeviceIds(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
) {
    let keys = bindingService.listStoredKeychainKeys()
    let prefixes = ["syncflow_pairing_token_", "pairing_token_"]
    let ids = keys.compactMap { key -> String? in
        for prefix in prefixes {
            if key.hasPrefix(prefix) { return String(key.dropFirst(prefix.count)) }
        }
        return nil
    }
    resolve(ids)
}
```

Also requires the corresponding `RCT_EXPORT_METHOD` macro in the Objective-C bridge header.

### 2. `SyncEngineModule.ts`

New export:

```ts
export async function getKnownDeviceIds(): Promise<string[]> {
    const result = await NativeSyncEngine.getKnownDeviceIds();
    return result as string[];
}
```

### 3. `RootNavigator.tsx` — `RootStackParamList`

```ts
DeviceDiscovery: { mode?: 'switch' } | undefined;
```

### 4. `SettingsScreen.tsx` — `handleSwitchDevice`

- Remove `disconnectAndUnbind()` call (device switching is handled inside `pairDevice`).
- Add upload-in-progress guard using `isSyncActivityActivelyTransferring(syncOverviewState)`.
- Change navigation from `navigation.reset(...)` to `navigation.navigate('DeviceDiscovery', { mode: 'switch' })`.

```ts
const handleSwitchDevice = useCallback(() => {
    if (isSyncActivityActivelyTransferring(syncOverviewState)) {
        Alert.alert(
            t('settings.dialogs.switchDeviceWhileUploading.title'),
            t('settings.dialogs.switchDeviceWhileUploading.body'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('settings.dialogs.switchDeviceWhileUploading.confirm'),
                    style: 'destructive',
                    onPress: () => navigation.navigate('DeviceDiscovery', { mode: 'switch' }),
                },
            ],
        );
    } else {
        navigation.navigate('DeviceDiscovery', { mode: 'switch' });
    }
}, [navigation, syncOverviewState, t]);
```

### 5. `DeviceDiscoveryScreen.tsx`

**Props / route params:**
- Read `mode` from route params (`route.params?.mode ?? 'initial'`).
- On mount (switch mode only): call `getKnownDeviceIds()` and store result as `Set<string>`.

**Header (switch mode):**
- Replace wifi icon + manual-pair button row with a back button (`←`) + title "切換設備".
- Back button calls `navigation.goBack()`.

**Device card (switch mode):**
- `deviceId in knownIds` → show blue "當前" badge (current device) or green "直接切換" badge (other known devices), no badge change for unknown devices.
- Current device determined by comparing `deviceId` against `bindingState.deviceId`.

Visual spec (Option A — badge on right):
```
[ 🖥  Brett 的 MacBook Pro    macOS · 192.168.1.5   [當前]  ]
[ 🖥  Studio iMac             macOS · 192.168.1.8   [直接切換] ]
[ 🖥  DESKTOP-WIN01           Windows · 192.168.1.12         › ]
```

**Tap handler (switch mode):**

```
tap known device (not current)
  → pairDevice(deviceId, host, port, "")
      ├─ success       → CommonActions.reset({ routes: [{ name: 'SyncActivity' }] })
      └─ pairing error → navigation.navigate('CodeVerify', { deviceId, host, port })
         network error → Alert "無法連接，請確認設備已開啟"

tap unknown device
  → navigation.navigate('CodeVerify', { deviceId, host, port })   (unchanged)

tap current device
  → toast "已是當前連接設備"（不觸發任何導航或連接動作）
```

`initial` mode tap handler is unchanged.

---

## Data Flow

```
SettingsScreen
  └─ 點擊「切換」
       ├─ 傳輸中 → Alert 確認 → navigate('DeviceDiscovery', { mode: 'switch' })
       └─ 空閒   → navigate('DeviceDiscovery', { mode: 'switch' })

DeviceDiscoveryScreen (mode='switch')
  ├─ mount: getKnownDeviceIds() → Set<serverId>
  ├─ mount: startDiscovery() (same as initial)
  ├─ 掃描到設備 → deviceId in knownIds ? badge : no badge
  └─ tap 已知設備 → pairDevice("") → reset to SyncActivity | CodeVerify
     tap 未知設備 → CodeVerify
```

---

## Error Handling

| Scenario | Handling |
|---|---|
| Token revoked (desktop changed code) | pairDevice throws pairing error → fallback to CodeVerify |
| Network timeout / device unreachable | Alert: "無法連接，請確認設備已開啟" |
| `getKnownDeviceIds()` fails | Treat all devices as unknown (graceful degradation) |
| Upload in progress during switch | Alert confirmation before navigating |

---

## What Does NOT Change

- `initial` mode of `DeviceDiscoveryScreen`: zero behavioral change.
- `CodeVerifyScreen`: unchanged.
- `QRScannerScreen`: unchanged.
- Existing pairing token storage format in Keychain.
- `disconnectAndUnbind` is NOT called before switching; `pairDevice` in the native layer handles the device transition internally.

---

## i18n Keys Required

```
settings.dialogs.switchDeviceWhileUploading.title
settings.dialogs.switchDeviceWhileUploading.body
settings.dialogs.switchDeviceWhileUploading.confirm
deviceDiscovery.switch.title           ("切換設備")
deviceDiscovery.switch.badge.known     ("直接切換")
deviceDiscovery.switch.badge.current   ("當前")
deviceDiscovery.switch.toast.alreadyCurrent  ("已是當前連接設備")
```

---

## Out of Scope

- Showing offline (undiscoverable) devices.
- Deleting / forgetting a previously paired device.
- Multi-device simultaneous connection.
