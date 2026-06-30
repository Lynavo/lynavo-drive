# Device Pairing Version Compatibility Alert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native version incompatibility alert popup on the mobile Connect Device (CodeVerify) screen when the client and desktop compatibility versions do not match.

**Architecture:** When `NativeSyncEngine.pairDevice` fails due to incompatibility, catch the error inside `CodeVerifyScreen.tsx`, check for error signatures ('版本不相容', 'APP_VERSION_INCOMPATIBLE', '版本不兼容'), and trigger a React Native `Alert.alert` with localized strings.

**Tech Stack:** React Native, TypeScript, React Navigation, Jest, i18next

---

### Task 1: Add localization keys in translation files

**Files:**
- Modify: `apps/mobile/src/i18n/locales/zh-Hant/errors.json`
- Modify: `apps/mobile/src/i18n/locales/zh-Hans/errors.json`
- Modify: `apps/mobile/src/i18n/locales/en/errors.json`

- [ ] **Step 1: Add localization keys to `zh-Hant/errors.json`**

Edit `apps/mobile/src/i18n/locales/zh-Hant/errors.json` to append the version mismatch keys:
```json
  "pairingVersionMismatchTitle": "版本不相容",
  "pairingVersionMismatchMessage": "手機與電腦端的版本不相容，請將電腦端（桌面端）App 更新至最新版本後再試。"
```

- [ ] **Step 2: Add localization keys to `zh-Hans/errors.json`**

Edit `apps/mobile/src/i18n/locales/zh-Hans/errors.json` to append the version mismatch keys:
```json
  "pairingVersionMismatchTitle": "版本不兼容",
  "pairingVersionMismatchMessage": "手机与电脑端的版本不兼容，请将电脑端（桌面端）App 更新至最新版本后再试。"
```

- [ ] **Step 3: Add localization keys to `en/errors.json`**

Edit `apps/mobile/src/i18n/locales/en/errors.json` to append the version mismatch keys:
```json
  "pairingVersionMismatchTitle": "Version Incompatible",
  "pairingVersionMismatchMessage": "The app versions on your mobile device and computer are incompatible. Please update the desktop app to the latest version and try again."
```

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/i18n/locales/zh-Hant/errors.json apps/mobile/src/i18n/locales/zh-Hans/errors.json apps/mobile/src/i18n/locales/en/errors.json
git commit -m "feat: add version compatibility localization strings for errors"
```

---

### Task 2: Implement version incompatibility interception and alert popup in CodeVerifyScreen

**Files:**
- Modify: `apps/mobile/src/screens/CodeVerifyScreen.tsx:83-118`

- [ ] **Step 1: Import Alert from react-native**

Verify that `Alert` is already imported from `react-native` in `CodeVerifyScreen.tsx`. (Yes, `Alert` is not currently in the import block of `CodeVerifyScreen.tsx`, so we must add it).

Add `Alert` to imports:
```typescript
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Vibration,
  NativeModules,
  Dimensions,
  Alert,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';
```

- [ ] **Step 2: Catch and intercept compatibility errors in submitCode**

Replace the catch block in `submitCode` inside `apps/mobile/src/screens/CodeVerifyScreen.tsx`:

```typescript
      } catch (e: any) {
        console.error('Native pairing failed:', e);
        // Native module threw a pairing error — show error state
        setVerifying(false);
        setError(true);
        // Include actual error message so the user knows if it's a network timeout vs incorrect code
        const msg = e?.message || '';
        if (
          msg.includes('版本不相容') ||
          msg.includes('APP_VERSION_INCOMPATIBLE') ||
          msg.includes('版本不兼容')
        ) {
          Alert.alert(
            t('errors.pairingVersionMismatchTitle'),
            t('errors.pairingVersionMismatchMessage'),
            [{ text: t('common.ok') }]
          );
          setErrorMsg(t('errors.pairingVersionMismatchMessage'));
        } else if (msg.includes('Pairing rejected')) {
          setErrorMsg(t('errors.pairingWrongCode'));
        } else {
          setErrorMsg(t('errors.pairingConnectFailed', { msg }));
        }
        setCode(Array(CODE_LENGTH).fill(''));
        Vibration.vibrate(300);
        inputRefs.current[0]?.focus();
        return;
      }
```

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/screens/CodeVerifyScreen.tsx
git commit -m "feat: intercept compatibility version mismatch and show Alert dialog"
```

---

### Task 3: Write unit tests to verify the version mismatch alert popup

**Files:**
- Modify: `apps/mobile/src/screens/__tests__/CodeVerifyScreen.test.tsx`

- [ ] **Step 1: Add a unit test to verify version mismatch Alert.alert triggering**

Append a new test to the `CodeVerifyScreen` describe block inside `apps/mobile/src/screens/__tests__/CodeVerifyScreen.test.tsx`. We will mock `NativeSyncEngine.pairDevice` to throw a version mismatch error and check if `Alert.alert` is triggered.

Before writing the test, make sure `Alert` is mocked or spied. We can spy on `Alert.alert` using `jest.spyOn(Alert, 'alert')`.

Add the test content:
```typescript
  it('triggers Alert.alert and displays upgrade message when pairing fails due to version compatibility mismatch', async () => {
    const { Alert, NativeModules, Vibration } = require('react-native');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const vibrateSpy = jest.spyOn(Vibration, 'vibrate').mockImplementation(() => {});
    
    const mockPairDevice = jest.fn().mockRejectedValueOnce(
      new Error('手機與桌面 App 版本不相容，請同時更新兩端後再連線。')
    );
    NativeModules.NativeSyncEngine = {
      pairDevice: mockPairDevice,
    };

    const { getByDisplayValue, getByText } = render(<CodeVerifyScreen />);

    // Mock entering a 6-digit code to trigger submitCode
    const digitInputs = [
      getByDisplayValue(''), // first input
    ];
    // In our test, let's just find and fill inputs sequentially or directly call submitCode via prop simulation if needed
    // However, since we want a complete simulation:
    // Let's directly trigger code inputs or mock it by rendering with prefilledCode
  });
```

Wait, since it's simpler to test `prefilledCode` prop logic in navigation params, we can mock `useRoute` to return `prefilledCode: '123456'`.
Let's create a separate describe block or test case that overrides `useRoute` params, or we can just mock `NativeSyncEngine.pairDevice` and render `CodeVerifyScreen` with a `prefilledCode` parameter in navigation params.
Let's see how `useRoute` is mocked:
```typescript
jest.mock('@react-navigation/native', () => ({
...
  useRoute: () => ({
    params: {
      deviceId: 'device-1',
      host: '192.168.1.8',
      port: 39393,
      deviceName: 'Studio Mac',
    },
  }),
}));
```
We can mock it dynamically or spy on `useRoute` using `jest.spyOn(require('@react-navigation/native'), 'useRoute')`.
Wait, let's write an elegant, functional unit test.
```typescript
  it('triggers Alert.alert when pairDevice throws APP_VERSION_INCOMPATIBLE', async () => {
    const { Alert, NativeModules } = require('react-native');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const mockPairDevice = jest.fn().mockRejectedValueOnce(
      new Error('APP_VERSION_INCOMPATIBLE: version mismatch')
    );
    NativeModules.NativeSyncEngine = {
      pairDevice: mockPairDevice,
    };

    const nav = require('@react-navigation/native');
    jest.spyOn(nav, 'useRoute').mockReturnValue({
      params: {
        deviceId: 'device-1',
        host: '192.168.1.8',
        port: 39393,
        deviceName: 'Studio Mac',
        prefilledCode: '123456',
      },
    });

    render(<CodeVerifyScreen />);

    // Wait for the deferred submitCode timer (500ms) to fire
    await new Promise(resolve => setTimeout(resolve, 600));

    expect(mockPairDevice).toHaveBeenCalledWith({
      deviceId: 'device-1',
      host: '192.168.1.8',
      port: 39393,
      connectionCode: '123456',
    });
    expect(alertSpy).toHaveBeenCalledWith(
      '版本不相容',
      '手機與電腦端的版本不相容，請將電腦端（桌面端）App 更新至最新版本後再試。',
      [{ text: '好' }]
    );
    
    alertSpy.mockRestore();
  });
```
This is incredibly elegant, uses `prefilledCode` parameter, wait for 600ms, and asserts that `pairDevice` is called and `Alert.alert` is triggered with the correct localized title, message, and button text!

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @lynavo-drive/mobile test CodeVerifyScreen.test.tsx`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/screens/__tests__/CodeVerifyScreen.test.tsx
git commit -m "test: add unit test for version mismatch pairing failure alert popup"
```
