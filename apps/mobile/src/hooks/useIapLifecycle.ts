import { useEffect } from 'react';
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

    return () => {
      unsubscribe();
      void iapService.teardown();
    };
  }, [isLoggedIn, loadSubscription]);
}
