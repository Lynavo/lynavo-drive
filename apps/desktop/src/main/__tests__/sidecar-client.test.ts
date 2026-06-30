import { describe, expect, it } from 'vitest';
import { sidecarClient, syncCredentialsToSidecar } from '../sidecar-client';

describe('sidecarClient OSS commercial boundary', () => {
  it('does not expose commercial auth, gift-card, config, subscription, or tunnel methods', () => {
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
  });

  it('keeps commercial credential sync inert in the OSS runtime', async () => {
    await expect(syncCredentialsToSidecar()).resolves.toBe(false);
  });
});
