# Switch Device Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to switch the connected desktop from Settings, with previously paired devices connecting directly (no 6-digit code required).

**Architecture:** Extend `DeviceDiscoveryScreen` with a `mode='switch'` route param. In switch mode, a new `getKnownDeviceIds()` native method identifies previously paired devices from Keychain, so they bypass `CodeVerifyScreen`. Unknown devices still go through the existing code-entry flow.

**Tech Stack:** React Native (iOS), Swift (native layer), React Navigation v6, i18next, jest + @testing-library/react-native

---

## File Map

| File | Change |
|---|---|
| `apps/mobile/ios/SyncEngine/SyncEngineManager.swift` | Add `getKnownDeviceIds() -> [String]` (line 5444, before closing `}`) |
| `apps/mobile/ios/SyncEngine/RNBridge.swift` | Add `@objc func getKnownDeviceIds(...)` (after `setOwnerUserId` at line 474) |
| `apps/mobile/ios/SyncEngine/RNBridge.m` | Add `RCT_EXTERN_METHOD(getKnownDeviceIds:...)` |
| `apps/mobile/src/services/SyncEngineModule.ts` | Export `getKnownDeviceIds(): Promise<string[]>` |
| `apps/mobile/src/services/__tests__/SyncEngineModule.getKnownDeviceIds.test.ts` | New test file |
| `apps/mobile/src/navigation/RootNavigator.tsx` | `DeviceDiscovery: { mode?: 'switch' } \| undefined` |
| `apps/mobile/src/i18n/locales/zh-Hans/settings.json` | Add `switchDeviceWhileUploading` keys |
| `apps/mobile/src/i18n/locales/zh-Hant/settings.json` | Add `switchDeviceWhileUploading` keys |
| `apps/mobile/src/i18n/locales/en/settings.json` | Add `switchDeviceWhileUploading` keys |
| `apps/mobile/src/i18n/locales/zh-Hans/deviceDiscovery.json` | Add `switch` keys |
| `apps/mobile/src/i18n/locales/zh-Hant/deviceDiscovery.json` | Add `switch` keys |
| `apps/mobile/src/i18n/locales/en/deviceDiscovery.json` | Add `switch` keys |
| `apps/mobile/src/screens/SettingsScreen.tsx` | Update `handleSwitchDevice` |
| `apps/mobile/src/screens/__tests__/SettingsScreen.test.tsx` | Add switch device tests |
| `apps/mobile/src/screens/DeviceDiscoveryScreen.tsx` | Add switch mode |
| `apps/mobile/src/screens/__tests__/DeviceDiscoveryScreen.switchMode.test.tsx` | New test file |

---

## Task 1: Native — add `getKnownDeviceIds` to SyncEngineManager + RNBridge

**Files:**
- Modify: `apps/mobile/ios/SyncEngine/SyncEngineManager.swift` (line 5444)
- Modify: `apps/mobile/ios/SyncEngine/RNBridge.swift` (after line 474)
- Modify: `apps/mobile/ios/SyncEngine/RNBridge.m` (after line 52)

- [ ] **Step 1: Add `getKnownDeviceIds()` to SyncEngineManager**

In `apps/mobile/ios/SyncEngine/SyncEngineManager.swift`, insert before the final closing `}` at line 5445:

```swift
    func getKnownDeviceIds() -> [String] {
        let keys = bindingService.listStoredKeychainKeys()
        let prefixes = ["syncflow_pairing_token_", "pairing_token_"]
        return keys.compactMap { key -> String? in
            for prefix in prefixes {
                if key.hasPrefix(prefix) { return String(key.dropFirst(prefix.count)) }
            }
            return nil
        }
    }
```

- [ ] **Step 2: Expose via RNBridge.swift**

In `apps/mobile/ios/SyncEngine/RNBridge.swift`, insert after the `setOwnerUserId` method (after line 474, before the closing `}`):

```swift
    @objc
    func getKnownDeviceIds(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        let ids = SyncEngineManager.shared.getKnownDeviceIds()
        resolve(ids)
    }
```

- [ ] **Step 3: Register in RNBridge.m**

In `apps/mobile/ios/SyncEngine/RNBridge.m`, add after the `setOwnerUserId` line (line 52, before `@end`):

```objc
RCT_EXTERN_METHOD(getKnownDeviceIds:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
```

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/ios/SyncEngine/SyncEngineManager.swift \
        apps/mobile/ios/SyncEngine/RNBridge.swift \
        apps/mobile/ios/SyncEngine/RNBridge.m
git commit -m "feat(mobile/native): add getKnownDeviceIds to RNBridge"
```

---

## Task 2: JS — expose `getKnownDeviceIds` in SyncEngineModule + tests

**Files:**
- Modify: `apps/mobile/src/services/SyncEngineModule.ts`
- Create: `apps/mobile/src/services/__tests__/SyncEngineModule.getKnownDeviceIds.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/services/__tests__/SyncEngineModule.getKnownDeviceIds.test.ts`:

```ts
import { NativeModules } from 'react-native';

const mockGetKnownDeviceIds = jest.fn();

beforeEach(() => {
  NativeModules.NativeSyncEngine = {
    getKnownDeviceIds: mockGetKnownDeviceIds,
  };
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('getKnownDeviceIds', () => {
  it('returns array of server ids from native', async () => {
    mockGetKnownDeviceIds.mockResolvedValueOnce(['device-abc', 'device-xyz']);
    const { getKnownDeviceIds } = await import('../SyncEngineModule');
    const result = await getKnownDeviceIds();
    expect(result).toEqual(['device-abc', 'device-xyz']);
    expect(mockGetKnownDeviceIds).toHaveBeenCalledTimes(1);
  });

  it('returns empty array when native returns empty', async () => {
    mockGetKnownDeviceIds.mockResolvedValueOnce([]);
    const { getKnownDeviceIds } = await import('../SyncEngineModule');
    const result = await getKnownDeviceIds();
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/mobile && npx jest src/services/__tests__/SyncEngineModule.getKnownDeviceIds.test.ts --no-coverage
```

Expected: FAIL — `getKnownDeviceIds is not a function`

- [ ] **Step 3: Add export to SyncEngineModule.ts**

In `apps/mobile/src/services/SyncEngineModule.ts`, add after the `getOwnerUserId` function (the last export in the file):

```ts
export async function getKnownDeviceIds(): Promise<string[]> {
  const result = await NativeSyncEngine.getKnownDeviceIds();
  return result as string[];
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/mobile && npx jest src/services/__tests__/SyncEngineModule.getKnownDeviceIds.test.ts --no-coverage
```

Expected: PASS — 2 tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/services/SyncEngineModule.ts \
        apps/mobile/src/services/__tests__/SyncEngineModule.getKnownDeviceIds.test.ts
git commit -m "feat(mobile): expose getKnownDeviceIds in SyncEngineModule"
```

---

## Task 3: Navigation type + i18n strings

**Files:**
- Modify: `apps/mobile/src/navigation/RootNavigator.tsx`
- Modify: `apps/mobile/src/i18n/locales/zh-Hans/settings.json`
- Modify: `apps/mobile/src/i18n/locales/zh-Hant/settings.json`
- Modify: `apps/mobile/src/i18n/locales/en/settings.json`
- Modify: `apps/mobile/src/i18n/locales/zh-Hans/deviceDiscovery.json`
- Modify: `apps/mobile/src/i18n/locales/zh-Hant/deviceDiscovery.json`
- Modify: `apps/mobile/src/i18n/locales/en/deviceDiscovery.json`

- [ ] **Step 1: Update RootStackParamList**

In `apps/mobile/src/navigation/RootNavigator.tsx`, change line 45:

```ts
// Before:
DeviceDiscovery: undefined;

// After:
DeviceDiscovery: { mode?: 'switch' } | undefined;
```

- [ ] **Step 2: Add i18n keys to zh-Hans/settings.json**

In `apps/mobile/src/i18n/locales/zh-Hans/settings.json`, inside the `"dialogs"` object, add after the `"switchDevice"` block:

```json
"switchDeviceWhileUploading": {
  "title": "正在上传中",
  "body": "当前有上传任务正在进行，切换设备将中断上传，是否继续？",
  "confirm": "继续切换"
}
```

- [ ] **Step 3: Add i18n keys to zh-Hant/settings.json**

In `apps/mobile/src/i18n/locales/zh-Hant/settings.json`, inside `"dialogs"`, after `"switchDevice"`:

```json
"switchDeviceWhileUploading": {
  "title": "正在上傳中",
  "body": "目前有上傳任務正在進行，切換設備將中斷上傳，是否繼續？",
  "confirm": "繼續切換"
}
```

- [ ] **Step 4: Add i18n keys to en/settings.json**

In `apps/mobile/src/i18n/locales/en/settings.json`, inside `"dialogs"`, after `"switchDevice"`:

```json
"switchDeviceWhileUploading": {
  "title": "Upload in Progress",
  "body": "An upload is currently running. Switching devices will interrupt it. Continue?",
  "confirm": "Switch Anyway"
}
```

- [ ] **Step 5: Add i18n keys to zh-Hans/deviceDiscovery.json**

In `apps/mobile/src/i18n/locales/zh-Hans/deviceDiscovery.json`, add a comma after the `"dialogs"` closing `}`, then append before the file's closing `}`:

```json
"switch": {
  "title": "切换设备",
  "badge": {
    "known": "直接切换",
    "current": "当前"
  },
  "toast": {
    "alreadyCurrent": "已是当前连接设备"
  }
}
```

- [ ] **Step 6: Add i18n keys to zh-Hant/deviceDiscovery.json**

In `apps/mobile/src/i18n/locales/zh-Hant/deviceDiscovery.json`, add a comma after `"dialogs"` closing `}`, then append before the file's closing `}`:

```json
"switch": {
  "title": "切換設備",
  "badge": {
    "known": "直接切換",
    "current": "當前"
  },
  "toast": {
    "alreadyCurrent": "已是當前連接設備"
  }
}
```

- [ ] **Step 7: Add i18n keys to en/deviceDiscovery.json**

In `apps/mobile/src/i18n/locales/en/deviceDiscovery.json`, add a comma after `"dialogs"` closing `}`, then append before the file's closing `}`:

```json
"switch": {
  "title": "Switch Device",
  "badge": {
    "known": "Switch Directly",
    "current": "Current"
  },
  "toast": {
    "alreadyCurrent": "Already connected to this device"
  }
}
```

- [ ] **Step 8: Run i18n key consistency test**

```bash
cd apps/mobile && npx jest src/i18n/__tests__/resources.test.ts --no-coverage
```

Expected: PASS — all three locales have identical leaf keys

- [ ] **Step 10: Verify typecheck passes**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors related to `DeviceDiscovery` params

- [ ] **Step 11: Commit**

```bash
git add apps/mobile/src/navigation/RootNavigator.tsx \
        apps/mobile/src/i18n/locales/zh-Hans/settings.json \
        apps/mobile/src/i18n/locales/zh-Hant/settings.json \
        apps/mobile/src/i18n/locales/en/settings.json \
        apps/mobile/src/i18n/locales/zh-Hans/deviceDiscovery.json \
        apps/mobile/src/i18n/locales/zh-Hant/deviceDiscovery.json \
        apps/mobile/src/i18n/locales/en/deviceDiscovery.json
git commit -m "feat(mobile): add switch-device i18n keys and DeviceDiscovery route param"
```

---

## Task 4: SettingsScreen — upload guard + navigate to switch mode

**Files:**
- Modify: `apps/mobile/src/screens/SettingsScreen.tsx`
- Modify: `apps/mobile/src/screens/__tests__/SettingsScreen.test.tsx`

- [ ] **Step 1: Write failing tests**

In `apps/mobile/src/screens/__tests__/SettingsScreen.test.tsx`, add to the `mockNativeSyncEngine` object and add new test cases.

First, add `getKnownDeviceIds` to `mockNativeSyncEngine` (around line 165):

```ts
getKnownDeviceIds: jest.fn().mockResolvedValue([]),
```

Then add these two test cases at the end of the `describe('SettingsScreen')` block:

```ts
describe('Switch Device button', () => {
  it('navigates to DeviceDiscovery switch mode when not uploading', async () => {
    mockNativeSyncEngine.getSyncOverview.mockResolvedValueOnce({
      progressPercent: 0,
      transferredBytes: 0,
      currentFile: null,
      currentFileConfirmedBytes: 0,
      uploadState: 'idle',
    });
    const { getByText } = render(<SettingsScreen />);
    await waitFor(() => {
      expect(getByText('切換')).toBeTruthy();
    });
    fireEvent.press(getByText('切換'));
    expect(mockNavigate).toHaveBeenCalledWith('DeviceDiscovery', { mode: 'switch' });
  });

  it('shows upload confirmation dialog when upload is active', async () => {
    mockNativeSyncEngine.getSyncOverview.mockResolvedValueOnce({
      progressPercent: 50,
      transferredBytes: 1024,
      currentFile: 'photo.jpg',
      currentFileConfirmedBytes: 512,
      uploadState: 'uploading',
    });
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { getByText } = render(<SettingsScreen />);
    await waitFor(() => {
      expect(getByText('切換')).toBeTruthy();
    });
    fireEvent.press(getByText('切換'));
    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringContaining('上傳'),
      expect.any(String),
      expect.any(Array),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/mobile && npx jest src/screens/__tests__/SettingsScreen.test.tsx --no-coverage -t "Switch Device"
```

Expected: FAIL — navigate called with wrong args or alert not shown

- [ ] **Step 3: Update SettingsScreen.tsx**

**3a.** Add import for `isSyncActivityActivelyTransferring` — in `apps/mobile/src/screens/SettingsScreen.tsx`, update the import block around line 46 to add:

```ts
import { isSyncActivityActivelyTransferring } from '../utils/syncActivityTransferState';
```

**3b.** Replace `handleSwitchDevice` (lines 490–516) with:

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

Note: remove the `disconnectAndUnbind()` call — device transition is handled inside `pairDevice` on the native layer.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/mobile && npx jest src/screens/__tests__/SettingsScreen.test.tsx --no-coverage
```

Expected: all tests PASS (including existing ones)

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/SettingsScreen.tsx \
        apps/mobile/src/screens/__tests__/SettingsScreen.test.tsx
git commit -m "feat(mobile): guard switch-device with upload check, navigate to switch mode"
```

---

## Task 5: DeviceDiscoveryScreen — switch mode

**Files:**
- Modify: `apps/mobile/src/screens/DeviceDiscoveryScreen.tsx`
- Create: `apps/mobile/src/screens/__tests__/DeviceDiscoveryScreen.switchMode.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `apps/mobile/src/screens/__tests__/DeviceDiscoveryScreen.switchMode.test.tsx`:

```tsx
import React from 'react';
import { Alert, NativeModules, NativeEventEmitter } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockDispatch = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    const R = require('react');
    R.useEffect(cb, [cb]);
  },
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    dispatch: mockDispatch,
  }),
  useRoute: () => ({
    params: { mode: 'switch' },
  }),
  CommonActions: {
    reset: jest.fn(payload => ({ type: 'RESET', ...payload })),
  },
}));

jest.mock('@react-navigation/stack', () => ({}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../components/Icon', () => ({
  Icon: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

jest.mock('../../utils/shareDiagnosticsArchive', () => ({
  isDiagnosticsExportUnavailable: jest.fn().mockReturnValue(false),
  shareDiagnosticsArchive: jest.fn().mockResolvedValue(undefined),
}));

const mockNativeSyncEngine = {
  startDiscovery: jest.fn().mockResolvedValue(undefined),
  stopDiscovery: jest.fn().mockResolvedValue(undefined),
  getKnownDeviceIds: jest.fn().mockResolvedValue([]),
  getBindingState: jest.fn().mockResolvedValue(null),
  pairDevice: jest.fn().mockResolvedValue(undefined),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};

const mockEmitter = {
  addListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
};

beforeEach(() => {
  jest.clearAllMocks();
  NativeModules.NativeSyncEngine = mockNativeSyncEngine;
  jest
    .spyOn(NativeEventEmitter.prototype, 'addListener')
    .mockImplementation(mockEmitter.addListener as any);
});

import { DeviceDiscoveryScreen } from '../DeviceDiscoveryScreen';

describe('DeviceDiscoveryScreen — switch mode', () => {
  it('calls getKnownDeviceIds on mount', async () => {
    render(<DeviceDiscoveryScreen />);
    await waitFor(() => {
      expect(mockNativeSyncEngine.getKnownDeviceIds).toHaveBeenCalledTimes(1);
    });
  });

  it('shows back button instead of manual-pair button', async () => {
    const { queryByText } = render(<DeviceDiscoveryScreen />);
    await waitFor(() => {
      expect(queryByText('手动配对')).toBeNull();
      expect(queryByText('chevron-back')).toBeTruthy();
    });
  });

  it('calls pairDevice with empty code for known device and resets to SyncActivity on success', async () => {
    mockNativeSyncEngine.getKnownDeviceIds.mockResolvedValueOnce(['server-known']);
    mockNativeSyncEngine.getBindingState.mockResolvedValueOnce({ deviceId: 'server-current' });
    mockNativeSyncEngine.pairDevice.mockResolvedValueOnce(undefined);

    const { getByText } = render(<DeviceDiscoveryScreen />);

    // Simulate device discovery event with a known device
    const onDiscoveredDevicesChangedCallback = mockEmitter.addListener.mock.calls.find(
      ([event]: [string]) => event === 'onDiscoveredDevicesChanged',
    )?.[1];

    if (onDiscoveredDevicesChangedCallback) {
      onDiscoveredDevicesChangedCallback({
        devices: [{ deviceId: 'server-known', name: 'Studio Mac', ip: '192.168.1.8', port: 39393, type: 'mac' }],
      });
    }

    await waitFor(() => {
      expect(getByText('Studio Mac')).toBeTruthy();
    });

    fireEvent.press(getByText('Studio Mac'));

    await waitFor(() => {
      expect(mockNativeSyncEngine.pairDevice).toHaveBeenCalledWith({
        deviceId: 'server-known',
        host: '192.168.1.8',
        port: 39393,
        connectionCode: '',
      });
      expect(mockDispatch).toHaveBeenCalled();
    });
  });

  it('navigates to CodeVerify when pairDevice fails for known device', async () => {
    mockNativeSyncEngine.getKnownDeviceIds.mockResolvedValueOnce(['server-known']);
    mockNativeSyncEngine.getBindingState.mockResolvedValueOnce({ deviceId: 'server-current' });
    mockNativeSyncEngine.pairDevice.mockRejectedValueOnce(new Error('PAIR_FAILED: auth required'));

    const { getByText } = render(<DeviceDiscoveryScreen />);

    const onDiscoveredDevicesChangedCallback = mockEmitter.addListener.mock.calls.find(
      ([event]: [string]) => event === 'onDiscoveredDevicesChanged',
    )?.[1];

    if (onDiscoveredDevicesChangedCallback) {
      onDiscoveredDevicesChangedCallback({
        devices: [{ deviceId: 'server-known', name: 'Studio Mac', ip: '192.168.1.8', port: 39393, type: 'mac' }],
      });
    }

    await waitFor(() => getByText('Studio Mac'));
    fireEvent.press(getByText('Studio Mac'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('CodeVerify', {
        deviceId: 'server-known',
        host: '192.168.1.8',
        port: 39393,
        deviceName: 'Studio Mac',
      });
    });
  });

  it('navigates to CodeVerify for unknown device', async () => {
    mockNativeSyncEngine.getKnownDeviceIds.mockResolvedValueOnce([]);
    mockNativeSyncEngine.getBindingState.mockResolvedValueOnce(null);

    const { getByText } = render(<DeviceDiscoveryScreen />);

    const onDiscoveredDevicesChangedCallback = mockEmitter.addListener.mock.calls.find(
      ([event]: [string]) => event === 'onDiscoveredDevicesChanged',
    )?.[1];

    if (onDiscoveredDevicesChangedCallback) {
      onDiscoveredDevicesChangedCallback({
        devices: [{ deviceId: 'server-new', name: 'New PC', ip: '192.168.1.9', port: 39393, type: 'win' }],
      });
    }

    await waitFor(() => getByText('New PC'));
    fireEvent.press(getByText('New PC'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('CodeVerify', expect.objectContaining({
        deviceId: 'server-new',
      }));
      expect(mockNativeSyncEngine.pairDevice).not.toHaveBeenCalled();
    });
  });

  it('shows alert when tapping current device', async () => {
    mockNativeSyncEngine.getKnownDeviceIds.mockResolvedValueOnce(['server-current']);
    mockNativeSyncEngine.getBindingState.mockResolvedValueOnce({ deviceId: 'server-current' });
    const alertSpy = jest.spyOn(Alert, 'alert');

    const { getByText } = render(<DeviceDiscoveryScreen />);

    const onDiscoveredDevicesChangedCallback = mockEmitter.addListener.mock.calls.find(
      ([event]: [string]) => event === 'onDiscoveredDevicesChanged',
    )?.[1];

    if (onDiscoveredDevicesChangedCallback) {
      onDiscoveredDevicesChangedCallback({
        devices: [{ deviceId: 'server-current', name: 'My Mac', ip: '192.168.1.5', port: 39393, type: 'mac' }],
      });
    }

    await waitFor(() => getByText('My Mac'));
    fireEvent.press(getByText('My Mac'));

    expect(mockNativeSyncEngine.pairDevice).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('當前'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/mobile && npx jest src/screens/__tests__/DeviceDiscoveryScreen.switchMode.test.tsx --no-coverage
```

Expected: FAIL — various missing behaviors

- [ ] **Step 3: Add imports to DeviceDiscoveryScreen.tsx**

At the top of `apps/mobile/src/screens/DeviceDiscoveryScreen.tsx`, add to the existing `@react-navigation/native` import:

```ts
// Change:
import { useFocusEffect, useNavigation } from '@react-navigation/native';
// To:
import { useFocusEffect, useNavigation, useRoute, CommonActions } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
```

Also add `getKnownDeviceIds` to the `SyncEngineModule` import (or add a new import):

```ts
import { getKnownDeviceIds } from '../services/SyncEngineModule';
```

- [ ] **Step 4: Add mode + switch-mode state to component**

Inside `DeviceDiscoveryScreen()` function, after the `const isAndroid = ...` line, add:

```ts
const route = useRoute<RouteProp<RootStackParamList, 'DeviceDiscovery'>>();
const mode = route.params?.mode ?? 'initial';
const [knownDeviceIds, setKnownDeviceIds] = useState<Set<string>>(new Set());
const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
```

- [ ] **Step 5: Load known device data on mount (switch mode)**

After the `const preserveCachedDevicesRef = useRef(false);` line, add:

```ts
useEffect(() => {
  if (mode !== 'switch') return;
  let cancelled = false;
  const { NativeSyncEngine: NSE } = NativeModules;
  Promise.all([
    getKnownDeviceIds().catch(() => [] as string[]),
    (NSE?.getBindingState?.() ?? Promise.resolve(null)).catch(() => null),
  ]).then(([ids, binding]) => {
    if (cancelled) return;
    setKnownDeviceIds(new Set(ids as string[]));
    setCurrentDeviceId((binding as any)?.deviceId ?? null);
  });
  return () => { cancelled = true; };
}, [mode]);
```

- [ ] **Step 6: Replace `handleDevicePress` with switch-aware version**

Replace the existing `handleDevicePress` function (currently at line ~323) with:

```ts
const handleDevicePress = useCallback(
  async (device: DiscoveredDevice) => {
    console.log(
      '[DiscoveryScreen] handleDevicePress',
      `${device.name}/${device.ip || 'no-ip'}/${device.deviceId}/${device.type}`,
    );

    if (mode !== 'switch') {
      navigation.navigate('CodeVerify', {
        deviceId: device.deviceId,
        host: device.ip,
        port: device.port,
        deviceName: device.name,
      });
      return;
    }

    if (device.deviceId === currentDeviceId) {
      Alert.alert(t('deviceDiscovery.switch.toast.alreadyCurrent'));
      return;
    }

    if (knownDeviceIds.has(device.deviceId)) {
      try {
        const { NativeSyncEngine: NSE } = NativeModules;
        if (NSE) {
          await NSE.pairDevice({
            deviceId: device.deviceId,
            host: device.ip,
            port: device.port,
            connectionCode: '',
          });
          navigation.dispatch(
            CommonActions.reset({ index: 0, routes: [{ name: 'SyncActivity' }] }),
          );
        }
      } catch {
        navigation.navigate('CodeVerify', {
          deviceId: device.deviceId,
          host: device.ip,
          port: device.port,
          deviceName: device.name,
        });
      }
      return;
    }

    navigation.navigate('CodeVerify', {
      deviceId: device.deviceId,
      host: device.ip,
      port: device.port,
      deviceName: device.name,
    });
  },
  [mode, navigation, currentDeviceId, knownDeviceIds, t],
);
```

- [ ] **Step 7: Update `renderDevice` to show badges**

Replace the existing `renderDevice` function with:

```tsx
const renderDevice = useCallback(
  ({ item }: ListRenderItemInfo<DiscoveredDevice>) => {
    const isCurrentDevice = mode === 'switch' && item.deviceId === currentDeviceId;
    const isKnownDevice =
      mode === 'switch' && !isCurrentDevice && knownDeviceIds.has(item.deviceId);

    return (
      <TouchableOpacity
        style={styles.deviceCard}
        activeOpacity={0.7}
        onPress={() => handleDevicePress(item)}
      >
        <View style={styles.deviceIconWrapper}>
          <Icon name="desktop-outline" size={20} color="#fff" />
        </View>
        <View style={styles.deviceInfo}>
          <Text style={styles.deviceName}>{item.name}</Text>
          <Text style={styles.deviceMeta}>
            {item.type === 'win' ? 'Windows' : 'macOS'} {'·'} {item.ip}
          </Text>
        </View>
        {isCurrentDevice && (
          <View style={styles.badgeCurrent}>
            <Text style={styles.badgeCurrentText}>
              {t('deviceDiscovery.switch.badge.current')}
            </Text>
          </View>
        )}
        {isKnownDevice && (
          <View style={styles.badgeKnown}>
            <Text style={styles.badgeKnownText}>
              {t('deviceDiscovery.switch.badge.known')}
            </Text>
          </View>
        )}
        {!isCurrentDevice && !isKnownDevice && (
          <Icon name="chevron-forward" size={20} color="#b0c8da" />
        )}
      </TouchableOpacity>
    );
  },
  [handleDevicePress, mode, currentDeviceId, knownDeviceIds, t],
);
```

- [ ] **Step 8: Update header to show back button in switch mode**

In the header JSX section (around line 425), replace the `<View style={styles.headerTopRow}>` block with a conditional:

```tsx
<View style={styles.headerTopRow}>
  {mode === 'switch' ? (
    <TouchableOpacity
      style={styles.backButton}
      activeOpacity={0.7}
      onPress={() => navigation.goBack()}
    >
      <Icon name="chevron-back" size={20} color="#3b9fd8" />
    </TouchableOpacity>
  ) : (
    <>
      <View style={styles.wifiIconBox}>
        <Icon name="wifi" size={24} color="#3b9fd8" />
      </View>
      <TouchableOpacity
        style={styles.scanButton}
        activeOpacity={0.8}
        onPress={() => {
          if (isAndroid) {
            setShowManualModal(true);
            return;
          }
          setShowPairingMenu(true);
        }}
      >
        <Icon name="settings-outline" size={16} color="#3b9fd8" />
        <Text style={styles.scanButtonText}>{t('deviceDiscovery.actions.manualPair')}</Text>
      </TouchableOpacity>
    </>
  )}
</View>
```

Also update the title line just below to:

```tsx
<Text style={styles.title}>
  {mode === 'switch' ? t('deviceDiscovery.switch.title') : t('deviceDiscovery.title')}
</Text>
```

- [ ] **Step 9: Add badge and back button styles**

In the `StyleSheet.create({...})` at the bottom of the file, add after `deviceMeta`:

```ts
badgeCurrent: {
  backgroundColor: 'rgba(59,159,216,0.15)',
  borderWidth: 1,
  borderColor: 'rgba(59,159,216,0.4)',
  borderRadius: 8,
  paddingHorizontal: 8,
  paddingVertical: 3,
},
badgeCurrentText: {
  color: '#3b9fd8',
  fontSize: 11,
  fontWeight: '600',
},
badgeKnown: {
  backgroundColor: 'rgba(63,207,127,0.15)',
  borderWidth: 1,
  borderColor: 'rgba(63,207,127,0.4)',
  borderRadius: 8,
  paddingHorizontal: 8,
  paddingVertical: 3,
},
badgeKnownText: {
  color: '#3fcf7f',
  fontSize: 11,
  fontWeight: '600',
},
backButton: {
  width: 36,
  height: 36,
  borderRadius: 10,
  backgroundColor: 'rgba(59,159,216,0.1)',
  justifyContent: 'center',
  alignItems: 'center',
},
```

- [ ] **Step 10: Run switch mode tests**

```bash
cd apps/mobile && npx jest src/screens/__tests__/DeviceDiscoveryScreen.switchMode.test.tsx --no-coverage
```

Expected: all 5 tests PASS

- [ ] **Step 11: Run full test suite to check for regressions**

```bash
cd apps/mobile && npx jest --no-coverage 2>&1 | tail -20
```

Expected: all existing tests still PASS

- [ ] **Step 12: Run typecheck**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors

- [ ] **Step 13: Commit**

```bash
git add apps/mobile/src/screens/DeviceDiscoveryScreen.tsx \
        apps/mobile/src/screens/__tests__/DeviceDiscoveryScreen.switchMode.test.tsx
git commit -m "feat(mobile): add switch mode to DeviceDiscoveryScreen"
```

---

## Verification Checklist

After all tasks complete:

- [ ] iOS build succeeds: `cd apps/mobile/ios && xcodebuild -workspace SyncFlowMobile.xcworkspace -scheme SyncFlowMobile -configuration Debug -sdk iphonesimulator build 2>&1 | tail -5`
- [ ] Full test suite passes: `cd apps/mobile && npx jest --no-coverage`
- [ ] TypeScript clean: `cd apps/mobile && npx tsc --noEmit`
- [ ] Manual test: Settings → 切換 → device list appears with back button
- [ ] Manual test: tapping known device connects without code
- [ ] Manual test: tapping unknown device goes to CodeVerify
- [ ] Manual test: tapping while uploading shows confirmation dialog
