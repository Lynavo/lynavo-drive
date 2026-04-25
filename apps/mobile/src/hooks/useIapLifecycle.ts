import { useEffect } from 'react';
import { InteractionManager } from 'react-native';
import { iapService } from '../services/iap-service';
import { FEATURES } from '../constants/features';

export interface UseIapLifecycleArgs {
  isLoggedIn: boolean;
  // Return value is intentionally ignored here — the hook just needs the side
  // effect. Using `unknown` keeps it compatible with both the store's
  // value-returning variant and any void mocks used in tests.
  loadSubscription: () => Promise<unknown>;
}

export function useIapLifecycle({
  isLoggedIn,
  loadSubscription,
}: UseIapLifecycleArgs): void {
  useEffect(() => {
    if (!FEATURES.IAP_ENABLED) return;
    if (!isLoggedIn) return;

    // Register orphan listener synchronously so teardown can unsubscribe
    // even if initialize() hasn't resolved yet.
    const unsubscribe = iapService.onOrphanPurchaseVerified(() => {
      void loadSubscription();
    });

    // Defer iapService.initialize() off the cold-start critical path.
    // react-native-iap's purchaseUpdatedListener attach triggers a native
    // flush of the entire SKPaymentQueue — on devices with stale sandbox
    // transactions this floods the JS bridge with hundreds of events,
    // blocking screen mounts and producing a "stuck on loading" symptom.
    // runAfterInteractions parks init on the low-priority queue so the
    // first frame (login redirect, paywall, settings) renders before the
    // flush burst arrives. teardown cancels the handle so a logout
    // happening before init fires doesn't strand a registration.
    const initHandle = InteractionManager.runAfterInteractions(() => {
      void iapService.initialize();
    });

    return () => {
      initHandle.cancel();
      unsubscribe();
      void iapService.teardown();
    };
  }, [isLoggedIn, loadSubscription]);
}
