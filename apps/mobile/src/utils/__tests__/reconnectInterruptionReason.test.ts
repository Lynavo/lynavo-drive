import { getReconnectInterruptionReason } from '../reconnectInterruptionReason';

describe('getReconnectInterruptionReason', () => {
  it('prefers windows host interruption when the native error code matches', () => {
    expect(
      getReconnectInterruptionReason({
        deviceType: 'win',
        isWaitingForNetworkRecovery: true,
        lastErrorCode: 'WINDOWS_HOST_ABORTED_CONNECTION',
      }),
    ).toBe('windows_host_interrupted');
  });

  it('falls back to network recovery when reconnect has genuinely stalled', () => {
    expect(
      getReconnectInterruptionReason({
        deviceType: 'win',
        isWaitingForNetworkRecovery: true,
        lastErrorCode: 'RETRYABLE_NETWORK_ERROR',
      }),
    ).toBe('network_recovery');
  });

  it('keeps ordinary reconnects transient when no recovery or host-abort evidence exists', () => {
    expect(
      getReconnectInterruptionReason({
        deviceType: 'mac',
        isWaitingForNetworkRecovery: false,
        lastErrorCode: null,
      }),
    ).toBe('transient_reconnect');
  });
});
