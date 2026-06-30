# Mobile Pairing Invalidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route global mobile users back to device pairing immediately when desktop resets the pairing code, while keeping ordinary offline states on the sync UI.

**Architecture:** Desktop sidecar sends an LMUP `PAIRING_INVALIDATED` control frame to authenticated clients before closing sockets during pairing-code reset/set. Native sync engines treat that frame, `/presence paired:false`, and token auth rejection as explicit pairing invalidation evidence, then emit the existing JS invalidation event so global navigation resets to `DeviceDiscovery`. Mobile keeps a lightweight authenticated LMUP control session while a binding is `connected` and idle, so reset/set pairing code can push invalidation immediately even when no upload is active. Heartbeat remains the fallback for older clients/desktops or control-session delivery failures.

**Tech Stack:** Go sidecar LMUP server, React Native, React Navigation, Jest / Testing Library, Swift iOS SyncEngine, Kotlin Android SyncEngine, Gradle unit tests.

---

## File Structure

- Modify `apps/mobile/src/services/SyncEngineModule.ts`
  - Define the JS-facing pairing invalidation event name and route reason type.
  - Add a small type guard for native invalidation payloads.
- Modify `apps/mobile/src/navigation/RootNavigator.tsx`
  - Add a global-only authenticated watcher that subscribes to native pairing invalidation events and resets navigation to `DeviceDiscovery`.
  - Check cold-start invalidation state before resolving the default authenticated route.
- Modify `apps/mobile/src/screens/DeviceDiscoveryGlobalScreen.tsx`
  - Read `route.params.reason`.
  - Render a concise pairing invalidation state card without hiding QR/manual/recent pairing options.
- Modify `apps/mobile/src/i18n/locales/en/deviceDiscovery.json`
  - Add global invalidation title and description.
- Modify `apps/mobile/src/i18n/locales/zh-Hans/deviceDiscovery.json`
  - Add matching keys only because tests in this repo currently run with zh-Hans fixtures even for global screens.
- Modify `apps/mobile/src/navigation/__tests__/RootNavigator.pairingInvalidation.test.tsx`
  - Cover online event reset and cold-start initial route.
- Modify `apps/mobile/src/screens/__tests__/DeviceDiscoveryGlobalScreen.onboarding.test.tsx`
  - Cover invalidation message rendering and preserved pairing actions.
- Modify `apps/mobile/ios/SyncEngine/SyncEngineManager.swift`
  - Add `invalidateCurrentPairing(reason:)`.
  - Call it for `/presence paired:false`, missing token with existing binding, and token-invalid auth errors.
  - Maintain an idle authenticated LMUP control session while connected and not uploading.
  - Suppress generic sync pipeline errors after `PAIRING_INVALIDATED` has invalidated the binding.
- Modify `apps/mobile/ios/SyncEngine/PresenceReconnectPolicy.swift`
  - Add pure policy helpers for identifying explicit invalidation.
- Modify `apps/mobile/ios/SyncEngine/PresenceReconnectPolicyTests/main.swift`
  - Cover explicit invalidation vs generic offline.
- Modify `apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/sync/AndroidSyncPrimitives.kt`
  - Add equivalent pure policy helpers.
- Modify `apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/sync/NativeSyncEngineModule.kt`
  - Add native invalidation helper and emit the JS event.
  - Invalidate the current binding when an authenticated LMUP session receives `PAIRING_INVALIDATED`.
  - Maintain an idle authenticated LMUP control session while connected and not uploading.
- Modify `apps/mobile/android/app/src/test/java/com/vividrop/mobile/china/sync/AndroidSyncPrimitivesTest.kt`
  - Cover explicit invalidation vs generic offline.
- Modify `services/sidecar-go/internal/protocol/frame.go`
  - Add LMUP `TypePairingInvalidated = 0x0014`.
- Modify `services/sidecar-go/internal/server/listener.go`
  - Track authenticated `connection` objects so disconnect can serialize the invalidation write through `connection.writeMu`.
- Modify `services/sidecar-go/internal/server/connection.go`
  - Add `sendPairingInvalidated(reason string)`.
- Modify `services/sidecar-go/internal/server/handler_hello.go`
  - Register authenticated connections with the `connection` object.
- Modify `services/sidecar-go/internal/server/connection_test.go`
  - Cover send-before-close for reset/set reasons and no-frame close for ordinary disconnect reasons.
- Modify `apps/mobile/ios/SyncEngine/TcpTransport.swift`
  - Add LMUP `.pairingInvalidated = 0x0014`.
- Modify `apps/mobile/ios/SyncEngine/ProtocolSession.swift`
  - Surface incoming `PAIRING_INVALIDATED` frames as a typed error with the desktop reason.

## Active Invalidation Increment

This increment extends the already-planned mobile pairing invalidation flow so desktop reset/set pairing code can push the invalidation immediately instead of waiting for the next `/presence` heartbeat.

### Task A: Sidecar Active Invalidation Frame

**Files:**
- Modify: `services/sidecar-go/internal/protocol/frame.go`
- Modify: `services/sidecar-go/internal/server/listener.go`
- Modify: `services/sidecar-go/internal/server/connection.go`
- Modify: `services/sidecar-go/internal/server/handler_hello.go`
- Test: `services/sidecar-go/internal/server/connection_test.go`

- [x] **Step 1: Write failing sidecar tests**

Add tests that register an authenticated connection, call `DisconnectClients(..., "connection_code_regenerated")`, read `TypePairingInvalidated` with the same reason on the client side, then verify the socket closes. Keep an ordinary close test for non-reset reasons.

- [x] **Step 2: Run the failing sidecar tests**

Run:

```bash
cd services/sidecar-go && go test ./internal/server -run 'TestDisconnectClients'
```

Expected: FAIL because `TypePairingInvalidated` and the send-before-close behavior do not exist.

- [x] **Step 3: Implement minimal sidecar protocol support**

Add `TypePairingInvalidated = 0x0014`, track `*connection` in `TCPServer.activeConns`, register `c` after auth/pair success, and call `conn.sendPairingInvalidated(reason)` before closing the transport for reset/set reasons.

- [x] **Step 4: Run focused sidecar tests**

Run:

```bash
cd services/sidecar-go && go test ./internal/protocol ./internal/server ./internal/api
```

### Task B: Android Active Invalidation Frame

**Files:**
- Modify: `apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/sync/AndroidSyncPrimitives.kt`
- Modify: `apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/sync/NativeSyncEngineModule.kt`
- Test: `apps/mobile/android/app/src/test/java/com/vividrop/mobile/china/sync/AndroidSyncPrimitivesTest.kt`

- [x] **Step 1: Write failing Android policy tests**

Add a policy test proving `connection_code_regenerated` and `connection_code_set` are accepted control-frame invalidation reasons, while blank/generic offline reasons are not.

- [x] **Step 2: Implement frame handling**

Add `TYPE_PAIRING_INVALIDATED = 0x0014`. When an authenticated sync read receives this frame, parse the reason, call `invalidateCurrentPairing(reason, expectedDeviceId=binding.deviceId, expectedPairingToken=binding.pairingToken)`, and abort the current session.

### Task C: iOS Active Invalidation Frame

**Files:**
- Modify: `apps/mobile/ios/SyncEngine/PresenceReconnectPolicy.swift`
- Modify: `apps/mobile/ios/SyncEngine/PresenceReconnectPolicyTests/main.swift`
- Modify: `apps/mobile/ios/SyncEngine/TcpTransport.swift`
- Modify: `apps/mobile/ios/SyncEngine/ProtocolSession.swift`
- Modify: `apps/mobile/ios/SyncEngine/SyncEngineManager.swift`

- [x] **Step 1: Write failing iOS policy tests**

Add a policy test proving `connection_code_regenerated` and `connection_code_set` are accepted control-frame invalidation reasons, while blank/generic offline reasons are not.

- [x] **Step 2: Implement frame handling**

Add `.pairingInvalidated = 0x0014`, convert that frame into a typed `PairingInvalidatedControlFrameError`, catch it in authenticated sync paths, call `invalidateCurrentPairing(reason, expectedDeviceId, expectedPairingToken)`, and stop the current protocol session.

### Task D: Idle Mobile Control Session

**Files:**
- Modify: `apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/sync/AndroidSyncPrimitives.kt`
- Modify: `apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/sync/NativeSyncEngineModule.kt`
- Test: `apps/mobile/android/app/src/test/java/com/vividrop/mobile/china/sync/AndroidSyncPrimitivesTest.kt`
- Modify: `apps/mobile/ios/SyncEngine/PresenceReconnectPolicy.swift`
- Modify: `apps/mobile/ios/SyncEngine/SyncEngineManager.swift`
- Test: `apps/mobile/ios/SyncEngine/PresenceReconnectPolicyTests/main.swift`

- [x] **Step 1: Write failing mobile policy tests**

Add policy tests proving an idle control connection should be maintained only when the binding is `connected`, no sync/upload is active, and the active control identity matches the current binding. Add iOS coverage proving `PAIRING_INVALIDATED` does not surface as a generic sync pipeline error after the binding has been invalidated.

- [x] **Step 2: Add iOS idle control session**

Start a lightweight LMUP session after `connected` state or heartbeat resume, authenticate with the current binding token, then wait for pushed control frames. Stop it on upload start, binding invalidation, background idle transition, non-connected state, or binding clear. Ordinary socket drops should not force offline; schedule a guarded restart if the same binding identity is still current.

- [x] **Step 3: Add Android idle control session**

Mirror the iOS lifecycle in `NativeSyncEngineModule`: start after `connected` state or heartbeat resume, stop before upload and on non-connected state, and call `invalidateCurrentPairing(...)` when the control reader receives `PAIRING_INVALIDATED`.

- [x] **Step 4: Verify targeted regressions**

Run focused Android/iOS/sidecar tests, then compile Android global debug and Swift policy tests where available.

## Task 1: JS Contract And Central Navigation Watcher

**Files:**
- Modify: `apps/mobile/src/services/SyncEngineModule.ts`
- Modify: `apps/mobile/src/navigation/RootNavigator.tsx`
- Test: `apps/mobile/src/navigation/__tests__/RootNavigator.pairingInvalidation.test.tsx`

- [x] **Step 1: Write the failing navigation tests**

Create `apps/mobile/src/navigation/__tests__/RootNavigator.pairingInvalidation.test.tsx` with:

```tsx
import React from 'react';
import { NativeEventEmitter, NativeModules } from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';

import { RootNavigator } from '../RootNavigator';
import { useAuth } from '../../stores/auth-store';
import { isGlobalMarket } from '../../markets';

jest.mock('../../stores/auth-store', () => ({
  FEATURES: {},
  isFeatureAccessAllowed: jest.fn(() => true),
  useAuth: jest.fn(),
}));

jest.mock('../../markets', () => ({
  isGlobalMarket: jest.fn(() => true),
}));

jest.mock('../../dev/visualQa', () => ({
  resolveVisualQaInitialRoute: jest.fn(() => null),
}));

jest.mock('../../hooks/useExpiryReminder', () => ({
  useExpiryReminder: jest.fn(),
}));

jest.mock('../../screens/DeviceDiscoveryGlobalScreen', () => ({
  DeviceDiscoveryGlobalScreen: ({ route }: { route?: { params?: Record<string, unknown> } }) => {
    const React = require('react');
    const { Text } = require('react-native');
    return (
      <Text>
        DeviceDiscoveryGlobal:{String(route?.params?.reason ?? 'none')}
      </Text>
    );
  },
}));

jest.mock('../../screens/SyncActivityGlobalScreen', () => ({
  SyncActivityGlobalScreen: () => {
    const React = require('react');
    const { Text } = require('react-native');
    return <Text>GlobalHome</Text>;
  },
}));

const nativeEventHandlers: Record<string, (payload?: unknown) => void> = {};
const mockReset = jest.fn();
const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      dispatch: mockReset,
      navigate: mockNavigate,
    }),
  };
});

jest.mock('@react-navigation/stack', () => ({
  createStackNavigator: () => ({
    Navigator: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Screen: ({ component: Component, initialParams }: { component: React.ComponentType<any>; initialParams?: Record<string, unknown> }) => (
      <Component route={{ params: initialParams }} />
    ),
  }),
}));

jest.mock('@react-navigation/bottom-tabs', () => ({
  createBottomTabNavigator: () => ({
    Navigator: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Screen: ({ component: Component }: { component: React.ComponentType<any> }) => <Component />,
  }),
}));

describe('RootNavigator pairing invalidation routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(nativeEventHandlers).forEach(key => delete nativeEventHandlers[key]);
    (isGlobalMarket as jest.Mock).mockReturnValue(true);
    (useAuth as jest.Mock).mockReturnValue({
      isLoading: false,
      isLoggedIn: true,
      signedOutTransition: null,
      user: { status: 'active' },
      userStatus: 'active',
      subscription: null,
      profileError: null,
      profileLoading: false,
      retryProfileLoad: jest.fn(),
      setSignedOutTransition: jest.fn(),
      clearAuth: jest.fn(),
    });
    NativeModules.NativeSyncEngine = {
      getBindingInvalidationState: jest.fn().mockResolvedValue(null),
    };
    (NativeEventEmitter as jest.Mock).mockImplementation(() => ({
      addListener: jest.fn((eventName: string, handler: (payload?: unknown) => void) => {
        nativeEventHandlers[eventName] = handler;
        return { remove: jest.fn() };
      }),
    }));
  });

  it('resets global authenticated navigation when native emits pairing invalidated', async () => {
    render(<RootNavigator />);

    await waitFor(() => {
      expect(nativeEventHandlers.onPairingInvalidated).toBeDefined();
    });

    await act(async () => {
      nativeEventHandlers.onPairingInvalidated?.({ reason: 'presence_unpaired' });
    });

    expect(mockReset).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'RESET',
        payload: expect.objectContaining({
          routes: [
            {
              name: 'DeviceDiscovery',
              params: { reason: 'pairing_invalidated' },
            },
          ],
        }),
      }),
    );
  });

  it('does not reset navigation for ordinary offline binding updates', async () => {
    render(<RootNavigator />);

    await waitFor(() => {
      expect(nativeEventHandlers.onPairingInvalidated).toBeDefined();
    });

    await act(async () => {
      nativeEventHandlers.onBindingStateChanged?.({
        deviceId: 'desktop-1',
        connectionState: 'offline',
      });
    });

    expect(mockReset).not.toHaveBeenCalled();
  });

  it('uses DeviceDiscovery as the cold-start route when native persisted pairing invalidation', async () => {
    NativeModules.NativeSyncEngine.getBindingInvalidationState = jest
      .fn()
      .mockResolvedValue({ reason: 'presence_unpaired' });

    const screen = render(<RootNavigator />);

    await waitFor(() => {
      expect(screen.getByText('DeviceDiscoveryGlobal:pairing_invalidated')).toBeTruthy();
    });
  });
});
```

- [x] **Step 2: Run the failing navigation tests**

Run:

```bash
pnpm --filter @lynavo-drive/mobile test -- RootNavigator.pairingInvalidation.test.tsx
```

Expected: FAIL because `onPairingInvalidated`, `getBindingInvalidationState`, and `reason` initial params are not wired.

- [x] **Step 3: Add JS event constants and payload guard**

In `apps/mobile/src/services/SyncEngineModule.ts`, add near the existing bridge types:

```ts
export const PAIRING_INVALIDATED_EVENT = 'onPairingInvalidated';

export const PAIRING_INVALIDATED_ROUTE_REASON = 'pairing_invalidated' as const;

export type PairingInvalidatedRouteReason =
  typeof PAIRING_INVALIDATED_ROUTE_REASON;

export type PairingInvalidatedEvent = {
  reason?: string;
};

export function isPairingInvalidatedEvent(
  payload: unknown,
): payload is PairingInvalidatedEvent {
  return (
    payload === null ||
    payload === undefined ||
    (typeof payload === 'object' && !Array.isArray(payload))
  );
}
```

- [x] **Step 4: Add the central watcher and cold-start route check**

In `apps/mobile/src/navigation/RootNavigator.tsx`, import:

```ts
import { CommonActions, useNavigation } from '@react-navigation/native';
import { NativeEventEmitter, NativeModules } from 'react-native';
import {
  PAIRING_INVALIDATED_EVENT,
  PAIRING_INVALIDATED_ROUTE_REASON,
  type PairingInvalidatedRouteReason,
  isPairingInvalidatedEvent,
} from '../services/SyncEngineModule';
```

Update the `RootStackParamList` entry for `DeviceDiscovery` without removing the existing switch mode:

```ts
DeviceDiscovery:
  | { mode?: 'switch'; reason?: PairingInvalidatedRouteReason }
  | undefined;
```

Add a component rendered inside `AuthedStack`:

```tsx
function PairingInvalidationWatcher({ enabled }: { enabled: boolean }) {
  const navigation = useNavigation();
  const resetInFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const nativeModule = NativeModules.NativeSyncEngine;
    if (!nativeModule) return;

    const emitter = new NativeEventEmitter(nativeModule);
    const subscription = emitter.addListener(
      PAIRING_INVALIDATED_EVENT,
      payload => {
        if (!isPairingInvalidatedEvent(payload) || resetInFlightRef.current) {
          return;
        }
        resetInFlightRef.current = true;
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [
              {
                name: 'DeviceDiscovery',
                params: { reason: PAIRING_INVALIDATED_ROUTE_REASON },
              },
            ],
          }),
        );
      },
    );

    return () => subscription.remove();
  }, [enabled, navigation]);

  return null;
}
```

In `AuthedStack.decide`, before `resolveDefaultAuthedRoute()`:

```ts
if (globalMarket) {
  const invalidation = await NativeModules.NativeSyncEngine
    ?.getBindingInvalidationState?.()
    .catch(() => null);
  if (invalidation) {
    if (!cancelled) {
      setInitialDeviceDiscoveryReason(PAIRING_INVALIDATED_ROUTE_REASON);
      setInitialRoute('DeviceDiscovery');
    }
    return;
  }
}
```

Add this state beside `initialRoute`:

```ts
const [initialDeviceDiscoveryReason, setInitialDeviceDiscoveryReason] =
  useState<PairingInvalidatedRouteReason | undefined>(undefined);
```

When setting `Subscription`, a visual QA route, or the route returned by `resolveDefaultAuthedRoute()`, also call:

```ts
setInitialDeviceDiscoveryReason(undefined);
```

When rendering `Stack.Screen name="DeviceDiscovery"`, pass global initial params:

```tsx
<Stack.Screen
  name="DeviceDiscovery"
  component={DeviceDiscoveryComponent}
  initialParams={
    globalMarket && initialDeviceDiscoveryReason
      ? { reason: initialDeviceDiscoveryReason }
      : undefined
  }
/>
```

Render the watcher before the navigator:

```tsx
<PairingInvalidationWatcher enabled={globalMarket} />
```

- [x] **Step 5: Run the navigation tests**

Run:

```bash
pnpm --filter @lynavo-drive/mobile test -- RootNavigator.pairingInvalidation.test.tsx
```

Expected: PASS.

- [x] **Step 6: Commit Task 1**

```bash
git add apps/mobile/src/services/SyncEngineModule.ts apps/mobile/src/navigation/RootNavigator.tsx apps/mobile/src/navigation/__tests__/RootNavigator.pairingInvalidation.test.tsx
git commit -m "feat(mobile): route pairing invalidation globally"
```

## Task 2: Device Discovery Invalidation Message

**Files:**
- Modify: `apps/mobile/src/screens/DeviceDiscoveryGlobalScreen.tsx`
- Modify: `apps/mobile/src/i18n/locales/en/deviceDiscovery.json`
- Modify: `apps/mobile/src/i18n/locales/zh-Hans/deviceDiscovery.json`
- Test: `apps/mobile/src/screens/__tests__/DeviceDiscoveryGlobalScreen.onboarding.test.tsx`

- [x] **Step 1: Write the failing UI tests**

Append to `DeviceDiscoveryGlobalScreen.onboarding.test.tsx`:

```tsx
it('shows a pairing invalidated message while keeping pairing choices available', async () => {
  mockHasSeenUnconnectedGuide.mockResolvedValue(true);

  const screen = render(
    <DeviceDiscoveryGlobalScreen
      route={{ params: { reason: 'pairing_invalidated' } } as never}
    />,
  );

  await waitFor(() => {
    expect(screen.getByText('需要重新配对这台电脑')).toBeTruthy();
  });

  expect(
    screen.getByText('这台电脑已更新连接码。请重新配对后继续同步。'),
  ).toBeTruthy();
  expect(screen.getByText('手动配对')).toBeTruthy();
  expect(screen.getByText('Studio Mac')).toBeTruthy();
});
```

- [x] **Step 2: Run the failing UI test**

Run:

```bash
pnpm --filter @lynavo-drive/mobile test -- DeviceDiscoveryGlobalScreen.onboarding.test.tsx -t "pairing invalidated"
```

Expected: FAIL because the route reason and copy are not implemented.

- [x] **Step 3: Add i18n keys**

In `apps/mobile/src/i18n/locales/en/deviceDiscovery.json`, under `global`, add:

```json
"pairingInvalidatedTitle": "Pair this desktop again",
"pairingInvalidatedDesc": "This desktop changed its pairing code. Pair again to continue."
```

In `apps/mobile/src/i18n/locales/zh-Hans/deviceDiscovery.json`, under `global`, add:

```json
"pairingInvalidatedTitle": "需要重新配对这台电脑",
"pairingInvalidatedDesc": "这台电脑已更新连接码。请重新配对后继续同步。"
```

- [x] **Step 4: Render the invalidation state card without hiding device choices**

In `DeviceDiscoveryGlobalScreen.tsx`, include `route` in the props type if needed:

```ts
type DeviceDiscoveryGlobalScreenProps = {
  route?: {
    params?: {
      mode?: 'switch';
      reason?: 'pairing_invalidated';
    };
  };
};
```

Derive the flag:

```ts
const showPairingInvalidatedNotice =
  route?.params?.reason === 'pairing_invalidated';
```

Render this before the devices card:

```tsx
{showPairingInvalidatedNotice ? (
  <FlowStateCard
    state={{
      title: t('deviceDiscovery.global.pairingInvalidatedTitle'),
      description: t('deviceDiscovery.global.pairingInvalidatedDesc'),
      icon: 'key-outline',
      tone: 'warning',
    }}
  />
) : null}
```

Do not fold this into `connectionStateContent`; that object hides device rows and recent desktops when present.

- [x] **Step 5: Run the UI tests**

Run:

```bash
pnpm --filter @lynavo-drive/mobile test -- DeviceDiscoveryGlobalScreen.onboarding.test.tsx -t "pairing invalidated"
```

Expected: PASS.

- [x] **Step 6: Commit Task 2**

```bash
git add apps/mobile/src/screens/DeviceDiscoveryGlobalScreen.tsx apps/mobile/src/i18n/locales/en/deviceDiscovery.json apps/mobile/src/i18n/locales/zh-Hans/deviceDiscovery.json apps/mobile/src/screens/__tests__/DeviceDiscoveryGlobalScreen.onboarding.test.tsx
git commit -m "feat(mobile): explain invalidated pairing in discovery"
```

## Task 3: iOS Native Pairing Invalidation

**Files:**
- Modify: `apps/mobile/ios/SyncEngine/PresenceReconnectPolicy.swift`
- Modify: `apps/mobile/ios/SyncEngine/PresenceReconnectPolicyTests/main.swift`
- Modify: `apps/mobile/ios/SyncEngine/SyncEngineManager.swift`

- [x] **Step 1: Write the failing policy tests**

In `PresenceReconnectPolicyTests/main.swift`, add:

```swift
expect(
    PresenceReconnectPolicy.shouldInvalidatePairing(
        responsePaired: false,
        tokenMissingForPersistedBinding: false,
        authRejected: false
    ),
    "paired:false should invalidate the stored pairing"
)

expect(
    PresenceReconnectPolicy.shouldInvalidatePairing(
        responsePaired: nil,
        tokenMissingForPersistedBinding: true,
        authRejected: false
    ),
    "missing token for a persisted binding should invalidate the stored pairing"
)

expect(
    PresenceReconnectPolicy.shouldInvalidatePairing(
        responsePaired: nil,
        tokenMissingForPersistedBinding: false,
        authRejected: true
    ),
    "explicit auth rejection should invalidate the stored pairing"
)

expect(
    !PresenceReconnectPolicy.shouldInvalidatePairing(
        responsePaired: nil,
        tokenMissingForPersistedBinding: false,
        authRejected: false
    ),
    "generic offline failures must not invalidate pairing"
)
```

- [x] **Step 2: Run the failing iOS policy test**

Run:

```bash
cd apps/mobile/ios/SyncEngine
swiftc PresenceReconnectPolicy.swift PresenceReconnectPolicyTests/main.swift -o /tmp/PresenceReconnectPolicyTests && /tmp/PresenceReconnectPolicyTests
```

Expected: FAIL because `shouldInvalidatePairing` does not exist.

- [x] **Step 3: Implement the pure iOS policy helper**

In `PresenceReconnectPolicy.swift`, add:

```swift
static func shouldInvalidatePairing(
    responsePaired: Bool?,
    tokenMissingForPersistedBinding: Bool,
    authRejected: Bool
) -> Bool {
    responsePaired == false || tokenMissingForPersistedBinding || authRejected
}
```

- [x] **Step 4: Implement `invalidateCurrentPairing(reason:)`**

In `SyncEngineManager.swift`, add a private helper near binding state helpers:

```swift
private func invalidateCurrentPairing(reason: String) {
    syncDiagnosticsLog("SyncEngine", "pairing invalidated reason=\(reason)")
    stopPresenceHeartbeatTimer()
    cancelPresenceRecoveryProbe(reason: reason)
    stopP2PTunnel(reason: reason)

    if let binding = uploadStore?.getBinding() {
        bindingService.clearPairingToken(forKey: binding.pairingTokenKeychainRef)
    }
    uploadStore?.clearBinding()
    bindingConnectionState = .offline
    clearSharedFilesReachability(reason: reason)
    NativeSyncEngineModule.shared?.emitPairingInvalidated(["reason": reason])
    NativeSyncEngineModule.shared?.emitBindingStateChanged(nil)
}
```

Use these existing method names from `SyncEngineManager.swift`: `stopPresenceHeartbeatTimer()`, `cancelPresenceRecoveryProbe(reason:)`, `stopP2PTunnel(reason:)`, `bindingService.clearPairingToken(forKey:)`, `uploadStore?.clearBinding()`, `clearSharedFilesReachability(reason:)`, and `NativeSyncEngineModule.shared?.emitBindingStateChanged(nil)`.

- [x] **Step 5: Call the helper from explicit invalidation sites**

In `sendPresenceHeartbeat`, where `responsePaired == false` currently updates state to offline, replace that branch with:

```swift
if PresenceReconnectPolicy.shouldInvalidatePairing(
    responsePaired: responsePaired,
    tokenMissingForPersistedBinding: false,
    authRejected: false
) {
    invalidateCurrentPairing(reason: rejectionReason)
    completion?(false)
    return
}
```

In pairing-token-missing branches that already clear stale binding, replace duplicated cleanup with:

```swift
invalidateCurrentPairing(reason: "pairing_token_missing")
```

In HMAC/auth rejection paths where the sidecar explicitly rejects the current stored token, call:

```swift
invalidateCurrentPairing(reason: "pairing_auth_rejected")
```

- [x] **Step 6: Add native module event emitter**

In `apps/mobile/ios/SyncEngine/RNBridge.swift`, add `"onPairingInvalidated"` to `supportedEvents()` immediately after `"onBindingStateChanged"`.

In the same file, add this emitter next to `emitBindingStateChanged(_:)`:

```swift
func emitPairingInvalidated(_ payload: [String: Any]) {
    sendEventOnMain(withName: "onPairingInvalidated", body: payload)
}
```

- [x] **Step 7: Run iOS tests and build**

Run:

```bash
cd apps/mobile/ios/SyncEngine
swiftc PresenceReconnectPolicy.swift PresenceReconnectPolicyTests/main.swift -o /tmp/PresenceReconnectPolicyTests && /tmp/PresenceReconnectPolicyTests
swiftc PresenceReconnectPolicy.swift SharedFilesRoutePolicy.swift SharedFilesRoutePolicyTests/main.swift -o /tmp/SharedFilesRoutePolicyTests && /tmp/SharedFilesRoutePolicyTests
cd /Volumes/T7/Dev/Web/SyncFlow
xcodebuild -workspace apps/mobile/ios/SyncFlowMobile.xcworkspace -scheme SyncFlowMobileGlobal -configuration Debug -sdk iphonesimulator -derivedDataPath /tmp/SyncFlowMobileGlobalDerivedData CODE_SIGNING_ALLOWED=NO build
```

Expected: both Swift policy commands exit 0 and the Xcode build prints `BUILD SUCCEEDED`.

- [x] **Step 8: Commit Task 3**

```bash
git add apps/mobile/ios/SyncEngine/PresenceReconnectPolicy.swift apps/mobile/ios/SyncEngine/PresenceReconnectPolicyTests/main.swift apps/mobile/ios/SyncEngine/SyncEngineManager.swift apps/mobile/ios
git commit -m "feat(ios): emit pairing invalidation on token rejection"
```

## Task 4: Android Native Pairing Invalidation

**Files:**
- Modify: `apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/sync/AndroidSyncPrimitives.kt`
- Modify: `apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/sync/NativeSyncEngineModule.kt`
- Modify: `apps/mobile/android/app/src/test/java/com/vividrop/mobile/china/sync/AndroidSyncPrimitivesTest.kt`

- [x] **Step 1: Write the failing Android policy tests**

Add to `AndroidSyncPrimitivesTest.kt`:

```kotlin
@Test
fun explicitPairingInvalidationSignalsRequireRePairing() {
  assertTrue(
    AndroidSyncPrimitives.shouldInvalidatePairing(
      responsePaired = false,
      tokenMissingForPersistedBinding = false,
      authRejected = false,
    ),
  )
  assertTrue(
    AndroidSyncPrimitives.shouldInvalidatePairing(
      responsePaired = null,
      tokenMissingForPersistedBinding = true,
      authRejected = false,
    ),
  )
  assertTrue(
    AndroidSyncPrimitives.shouldInvalidatePairing(
      responsePaired = null,
      tokenMissingForPersistedBinding = false,
      authRejected = true,
    ),
  )
  assertFalse(
    AndroidSyncPrimitives.shouldInvalidatePairing(
      responsePaired = null,
      tokenMissingForPersistedBinding = false,
      authRejected = false,
    ),
  )
}
```

- [x] **Step 2: Run the failing Android policy test**

Run:

```bash
cd apps/mobile/android
./gradlew :app:testCnDebugUnitTest --tests com.vividrop.mobile.china.sync.AndroidSyncPrimitivesTest
```

Expected: FAIL because `shouldInvalidatePairing` does not exist.

- [x] **Step 3: Implement the Android policy helper**

In `AndroidSyncPrimitives.kt`, add:

```kotlin
fun shouldInvalidatePairing(
  responsePaired: Boolean?,
  tokenMissingForPersistedBinding: Boolean,
  authRejected: Boolean,
): Boolean =
  responsePaired == false || tokenMissingForPersistedBinding || authRejected
```

- [x] **Step 4: Implement Android native invalidation helper**

In `NativeSyncEngineModule.kt`, add:

```kotlin
private fun invalidateCurrentPairing(reason: String) {
  recordDiagnosticsLog("SyncEngine", "pairing invalidated reason=$reason")
  stopPresenceHeartbeatTimer()
  cancelPresenceRecoveryProbe(reason = reason)
  stopP2PTunnel()

  loadBinding()?.let { binding ->
    clearPairingToken(binding.pairingTokenKeychainRef)
  }
  clearBinding()
  clearSharedFilesReachability(reason)
  emitPairingInvalidated(reason)
  emitBindingStateCleared()
}

private fun emitPairingInvalidated(reason: String) {
  val payload = Arguments.createMap().apply {
    putString("reason", reason)
  }
  emitEvent("onPairingInvalidated", payload)
}
```

Use these existing method names from `NativeSyncEngineModule.kt`: `stopPresenceHeartbeatTimer()`, `cancelPresenceRecoveryProbe(reason = reason)`, `stopP2PTunnel()`, `clearBinding()`, `clearSharedFilesReachability(reason)`, `emitBindingStateCleared()`, and `emitEvent(eventName, payload)`.

- [x] **Step 5: Call Android invalidation only from explicit rejection sites**

In `sendPresenceHeartbeat`, replace the `responsePaired == false` offline update with:

```kotlin
if (AndroidSyncPrimitives.shouldInvalidatePairing(
    responsePaired = responsePaired,
    tokenMissingForPersistedBinding = false,
    authRejected = false,
  )
) {
  invalidateCurrentPairing(rejectionReason)
  return false
}
```

In missing-token branches for an existing persisted binding, call:

```kotlin
invalidateCurrentPairing("pairing_token_missing")
```

In explicit stored-token auth rejection paths, call:

```kotlin
invalidateCurrentPairing("pairing_auth_rejected")
```

Do not call this helper for health timeouts, discovery misses, tunnel unavailable, or generic IO exceptions.

- [x] **Step 6: Run Android tests**

Run:

```bash
cd apps/mobile/android
./gradlew :app:testCnDebugUnitTest --tests com.vividrop.mobile.china.sync.AndroidSyncPrimitivesTest
```

Expected: `BUILD SUCCESSFUL`.

- [x] **Step 7: Commit Task 4**

```bash
git add apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/sync/AndroidSyncPrimitives.kt apps/mobile/android/app/src/main/java/com/vividrop/mobile/china/sync/NativeSyncEngineModule.kt apps/mobile/android/app/src/test/java/com/vividrop/mobile/china/sync/AndroidSyncPrimitivesTest.kt
git commit -m "feat(android): emit pairing invalidation on token rejection"
```

## Task 5: End-To-End Verification And Cleanup

**Files:**
- Verify all files touched in Tasks 1-4.
- Update docs only if implementation discovers behavior that differs from `docs/superpowers/specs/2026-06-24-mobile-pairing-invalidation-design.md`.

- [ ] **Step 1: Run focused JS tests**

Run:

```bash
pnpm --filter @lynavo-drive/mobile test -- RootNavigator.pairingInvalidation.test.tsx DeviceDiscoveryGlobalScreen.onboarding.test.tsx
```

Expected: PASS.

- [x] **Step 2: Run focused native tests**

Run:

```bash
cd apps/mobile/ios/SyncEngine
swiftc PresenceReconnectPolicy.swift PresenceReconnectPolicyTests/main.swift -o /tmp/PresenceReconnectPolicyTests && /tmp/PresenceReconnectPolicyTests
swiftc PresenceReconnectPolicy.swift SharedFilesRoutePolicy.swift SharedFilesRoutePolicyTests/main.swift -o /tmp/SharedFilesRoutePolicyTests && /tmp/SharedFilesRoutePolicyTests
cd /Volumes/T7/Dev/Web/SyncFlow/apps/mobile/android
./gradlew :app:testCnDebugUnitTest --tests com.vividrop.mobile.china.sync.AndroidSyncPrimitivesTest
```

Expected: all commands exit 0.

- [x] **Step 3: Run mobile TypeScript check**

Run:

```bash
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
```

Expected: exit 0.

- [x] **Step 4: Run iOS global simulator build**

Run:

```bash
xcodebuild -workspace apps/mobile/ios/SyncFlowMobile.xcworkspace -scheme SyncFlowMobileGlobal -configuration Debug -sdk iphonesimulator -derivedDataPath /tmp/SyncFlowMobileGlobalDerivedData CODE_SIGNING_ALLOWED=NO build
```

Expected: `BUILD SUCCEEDED`.

- [x] **Step 5: Run diff hygiene checks**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors. `git status --short` should show only intended files before the final commit.

- [x] **Step 6: Final self-review**

Check:

- `offline` events still leave the user on sync UI.
- `onPairingInvalidated` resets global authenticated navigation only once.
- CN UI text is not changed beyond test i18n keys.
- Native invalidation helper is not called from generic timeout/IO failure paths.
- Active binding/token cleanup matches existing account-wipe cleanup patterns.

- [ ] **Step 7: Commit verification/doc updates if any**

If Task 5 changes docs or small cleanup files:

```bash
git add <changed-files>
git commit -m "test: verify mobile pairing invalidation flow"
```

If there are no changes, do not create an empty commit.
