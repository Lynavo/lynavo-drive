export type ReconnectBannerEvidence = {
  isTransferInterrupted: boolean;
  reconnectElapsedMs: number;
  retryAttempt: number;
  retryCountdownSec: number;
  pausedThresholdMs?: number;
  pausedThresholdAttempt?: number;
};

const DEFAULT_PAUSED_THRESHOLD_MS = 15_000;
const DEFAULT_PAUSED_THRESHOLD_ATTEMPT = 3;

export function shouldTreatReconnectAsWaitingForNetworkRecovery(
  evidence: ReconnectBannerEvidence,
): boolean {
  if (!evidence.isTransferInterrupted) {
    return false;
  }

  // As long as the engine still has a scheduled retry window, the UI should
  // present the transfer as actively reconnecting rather than inventing a
  // paused state.
  if (evidence.retryCountdownSec > 0) {
    return false;
  }

  const pausedThresholdMs =
    evidence.pausedThresholdMs ?? DEFAULT_PAUSED_THRESHOLD_MS;
  const pausedThresholdAttempt =
    evidence.pausedThresholdAttempt ?? DEFAULT_PAUSED_THRESHOLD_ATTEMPT;

  return (
    evidence.reconnectElapsedMs >= pausedThresholdMs ||
    evidence.retryAttempt >= pausedThresholdAttempt
  );
}
