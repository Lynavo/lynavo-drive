import { renderHook } from '@testing-library/react-native';
import { useIapLifecycle } from '../useIapLifecycle';
import { iapService } from '../../services/iap-service';
import { FEATURES } from '../../constants/features';

// useIapLifecycle now defers iapService.initialize() via
// InteractionManager.runAfterInteractions to keep the cold-start path
// off of react-native-iap's flush burst. Tests still want to assert on
// initialize being called synchronously, so mock the scheduler to
// invoke its callback immediately and return a no-op cancel handle.
jest.mock('react-native', () => ({
  InteractionManager: {
    runAfterInteractions: (cb: () => void) => {
      cb();
      return { cancel: jest.fn() };
    },
  },
}));

jest.mock('../../services/iap-service', () => ({
  iapService: {
    initialize: jest.fn().mockResolvedValue(undefined),
    teardown: jest.fn().mockResolvedValue(undefined),
    onOrphanPurchaseVerified: jest.fn(() => jest.fn()),
  },
}));

jest.mock('../../constants/features', () => ({
  FEATURES: { IAP_ENABLED: true, IAP_RESTORE_ENABLED: true },
}));

describe('useIapLifecycle', () => {
  beforeEach(() => jest.clearAllMocks());

  test('initialize on isLoggedIn=true', () => {
    const loadSub = jest.fn().mockResolvedValue(undefined);
    renderHook(() =>
      useIapLifecycle({ isLoggedIn: true, loadSubscription: loadSub }),
    );
    expect(iapService.initialize).toHaveBeenCalledTimes(1);
    expect(iapService.onOrphanPurchaseVerified).toHaveBeenCalledTimes(1);
  });

  test('teardown on isLoggedIn=false after being true', () => {
    const loadSub = jest.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ isLoggedIn }) => useIapLifecycle({ isLoggedIn, loadSubscription: loadSub }),
      { initialProps: { isLoggedIn: true } },
    );
    rerender({ isLoggedIn: false });
    expect(iapService.teardown).toHaveBeenCalledTimes(1);
  });

  test('orphan event triggers loadSubscription', () => {
    const loadSub = jest.fn().mockResolvedValue(undefined);
    // Use a container so TypeScript doesn't narrow the captured reference away.
    const holder: { cb: (() => void) | null } = { cb: null };
    (iapService.onOrphanPurchaseVerified as jest.Mock).mockImplementation((cb: () => void) => {
      holder.cb = cb;
      return jest.fn();
    });
    renderHook(() =>
      useIapLifecycle({ isLoggedIn: true, loadSubscription: loadSub }),
    );
    holder.cb?.();
    expect(loadSub).toHaveBeenCalledTimes(1);
  });

  test('skipped entirely when FEATURES.IAP_ENABLED is false', () => {
    // Override the mocked FEATURES object for this test only.
    (FEATURES as { IAP_ENABLED: boolean }).IAP_ENABLED = false;
    renderHook(() =>
      useIapLifecycle({ isLoggedIn: true, loadSubscription: jest.fn() }),
    );
    expect(iapService.initialize).not.toHaveBeenCalled();
    // Restore for subsequent tests.
    (FEATURES as { IAP_ENABLED: boolean }).IAP_ENABLED = true;
  });
});
