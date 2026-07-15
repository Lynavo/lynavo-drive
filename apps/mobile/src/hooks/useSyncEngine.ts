import { TurboModuleRegistry } from 'react-native';
import type { Spec } from '../../specs/NativeSyncEngine';

export function useSyncEngine(): Spec {
  return TurboModuleRegistry.getEnforcing<Spec>('NativeSyncEngine');
}
