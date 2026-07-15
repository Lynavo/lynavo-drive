import type { TFunction } from 'i18next';
import type { BonjourRuntimeState, SidecarRuntimeState } from '../../shared/sidecar-runtime';

export function getBonjourRuntimeMessage(
  bonjour: BonjourRuntimeState,
  t: TFunction,
  fallbackKey = 'layout.sidecar.bonjourFallbackDetail',
): string {
  if (bonjour.messageCode) {
    return t(`layout.sidecar.runtimeMessages.${bonjour.messageCode}`, bonjour.messageArgs ?? {});
  }
  return t(fallbackKey);
}

export function getSidecarRuntimeMessage(
  runtime: SidecarRuntimeState,
  t: TFunction,
  fallbackKey: string,
): string {
  if (runtime.messageCode) {
    return t(`layout.sidecar.runtimeMessages.${runtime.messageCode}`, runtime.messageArgs ?? {});
  }
  return t(fallbackKey);
}
