import { describe, expect, it } from 'vitest';
import { sidecarClient, type SidecarHealth } from '../sidecar-client';

describe('sidecarClient OSS removed-service boundary', () => {
  it('does not expose non-OSS auth, gift-card, config, plan, or off-LAN methods', () => {
    expect(sidecarClient).not.toHaveProperty('getClientConfig');
    expect(sidecarClient).not.toHaveProperty('redeemGiftCard');
    expect(sidecarClient).not.toHaveProperty('sendSMSCode');
    expect(sidecarClient).not.toHaveProperty('loginWithSMSCode');
    expect(sidecarClient).not.toHaveProperty('sendEmailCode');
    expect(sidecarClient).not.toHaveProperty('loginWithEmailCode');
    expect(sidecarClient).not.toHaveProperty('loginWithGoogle');
    expect(sidecarClient).not.toHaveProperty('loginWithApple');
    expect(sidecarClient).not.toHaveProperty('getAuthSession');
    expect(sidecarClient).not.toHaveProperty('getAuthSessionView');
    expect(sidecarClient).not.toHaveProperty('refreshSession');
    expect(sidecarClient).not.toHaveProperty('logout');
    expect(sidecarClient).not.toHaveProperty('fetchSubscriptionStatus');
    expect(sidecarClient).not.toHaveProperty('fetchTurnCredentials');
    expect(sidecarClient).not.toHaveProperty('syncTunnelCredentials');
    expect(sidecarClient).not.toHaveProperty('syncAccountContext');
    expect(sidecarClient).not.toHaveProperty('syncCredentialsToSidecar');
  });

  it('does not model tunnel health in the OSS desktop client', () => {
    const health: SidecarHealth = {
      ok: true,
      service: 'lynavo-drive-sidecar',
    };

    expect(health).not.toHaveProperty('tunnel');
  });
});
