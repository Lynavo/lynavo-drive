import type { DeviceType } from '@syncflow/contracts';

interface ReconnectInterruptionReasonEvidence {
  deviceType?: DeviceType;
  isWaitingForNetworkRecovery: boolean;
  lastErrorCode?: string | null;
}

export function getReconnectInterruptionReason(
  evidence: ReconnectInterruptionReasonEvidence,
):
  | 'transient_reconnect'
  | 'network_recovery'
  | 'windows_host_interrupted' {
  if (
    evidence.deviceType === 'win' &&
    evidence.lastErrorCode === 'WINDOWS_HOST_ABORTED_CONNECTION'
  ) {
    return 'windows_host_interrupted';
  }

  if (evidence.isWaitingForNetworkRecovery) {
    return 'network_recovery';
  }

  return 'transient_reconnect';
}
