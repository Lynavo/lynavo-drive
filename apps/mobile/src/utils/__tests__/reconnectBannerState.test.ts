import { shouldTreatReconnectAsWaitingForNetworkRecovery } from '../reconnectBannerState';

describe('shouldTreatReconnectAsWaitingForNetworkRecovery', () => {
  it('keeps reconnect banner transient while a retry countdown is active', () => {
    expect(
      shouldTreatReconnectAsWaitingForNetworkRecovery({
        isTransferInterrupted: true,
        reconnectElapsedMs: 45_000,
        retryAttempt: 7,
        retryCountdownSec: 18,
      }),
    ).toBe(false);
  });

  it('treats reconnect as waiting for recovery once retries stop counting down', () => {
    expect(
      shouldTreatReconnectAsWaitingForNetworkRecovery({
        isTransferInterrupted: true,
        reconnectElapsedMs: 45_000,
        retryAttempt: 7,
        retryCountdownSec: 0,
      }),
    ).toBe(true);
  });

  it('does not mark non-interrupted sessions as waiting for recovery', () => {
    expect(
      shouldTreatReconnectAsWaitingForNetworkRecovery({
        isTransferInterrupted: false,
        reconnectElapsedMs: 60_000,
        retryAttempt: 9,
        retryCountdownSec: 0,
      }),
    ).toBe(false);
  });
});
