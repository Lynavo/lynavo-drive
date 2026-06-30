import * as authService from '../auth-service';

describe('auth-service OSS surface', () => {
  test('does not expose official login, profile, logout, or account deletion endpoint helpers', () => {
    expect(authService).toHaveProperty('registerAuthStoreActions');
    expect(authService).toHaveProperty('_setTokensFromApi');
    expect(authService).toHaveProperty('_clearAuthFromApi');

    expect(authService).not.toHaveProperty('sendEmailCode');
    expect(authService).not.toHaveProperty('emailLogin');
    expect(authService).not.toHaveProperty('appleLogin');
    expect(authService).not.toHaveProperty('googleLogin');
    expect(authService).not.toHaveProperty('getUserProfile');
    expect(authService).not.toHaveProperty('logout');
    expect(authService).not.toHaveProperty('deleteAccount');
  });
});
