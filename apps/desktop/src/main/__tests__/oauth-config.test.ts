import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAppleOAuthConfig, resolveGoogleOAuthConfig } from '../oauth-config';

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveGoogleOAuthConfig', () => {
  it('prefers explicit env values', () => {
    expect(
      resolveGoogleOAuthConfig({
        SYNCFLOW_GOOGLE_CLIENT_ID: 'desktop-client.apps.googleusercontent.com',
        SYNCFLOW_GOOGLE_REDIRECT_URI: 'http://localhost/explicit',
      }),
    ).toEqual({
      clientId: 'desktop-client.apps.googleusercontent.com',
      redirectUri: 'http://localhost/explicit',
    });
  });

  it('reads the desktop client id and redirect uri from a Google installed app file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vividrop-google-oauth-'));
    const configPath = join(dir, 'client_secret.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        installed: {
          client_id: 'installed-client.apps.googleusercontent.com',
          redirect_uris: ['http://localhost'],
        },
      }),
    );

    expect(resolveGoogleOAuthConfig({ SYNCFLOW_GOOGLE_CLIENT_CONFIG_FILE: configPath })).toEqual({
      clientId: 'installed-client.apps.googleusercontent.com',
      redirectUri: 'http://localhost',
    });
  });

  it('reads the desktop client from a configured Google OAuth directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vividrop-google-oauth-dir-'));
    writeFileSync(
      join(dir, 'Android-Debug-client_secret.json'),
      JSON.stringify({
        installed: {
          client_id: 'android-debug-client.apps.googleusercontent.com',
        },
      }),
    );
    writeFileSync(
      join(dir, 'Desktop_client_secret.json'),
      JSON.stringify({
        installed: {
          client_id: 'desktop-client.apps.googleusercontent.com',
          redirect_uris: ['http://localhost'],
        },
      }),
    );
    writeFileSync(
      join(dir, 'Web-client_secret.json'),
      JSON.stringify({
        web: {
          client_id: 'web-client.apps.googleusercontent.com',
        },
      }),
    );

    expect(resolveGoogleOAuthConfig({ SYNCFLOW_GOOGLE_CLIENT_CONFIG_DIR: dir })).toEqual({
      clientId: 'desktop-client.apps.googleusercontent.com',
      redirectUri: 'http://localhost',
    });
  });

  it('falls back to id.txt desktop client when a Google OAuth directory has no JSON files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vividrop-google-oauth-id-'));
    writeFileSync(
      join(dir, 'id.txt'),
      [
        'Web 客戶端 ID: web-client.apps.googleusercontent.com',
        'Web 客戶端密鑰: should-not-be-used',
        'Desktop 客戶端ID: desktop-client.apps.googleusercontent.com',
        'Desktop 客戶端密鑰: should-not-be-used',
      ].join('\n'),
    );

    expect(resolveGoogleOAuthConfig({ GOOGLE_CLIENT_CONFIG_DIR: dir })).toEqual({
      clientId: 'desktop-client.apps.googleusercontent.com',
      redirectUri: 'http://localhost',
    });
  });

  it('defaults the redirect uri to the registered desktop loopback uri', () => {
    expect(
      resolveGoogleOAuthConfig({
        GOOGLE_CLIENT_ID: 'desktop-client.apps.googleusercontent.com',
      }),
    ).toEqual({
      clientId: 'desktop-client.apps.googleusercontent.com',
      redirectUri: 'http://localhost',
    });
  });

  it('uses the packaged global desktop client id fallback for global builds', () => {
    vi.stubEnv('SYNCFLOW_MARKET', 'global');

    expect(resolveGoogleOAuthConfig()).toEqual({
      clientId: '318131526906-9iivkqid8imviaa3gj0i6kmer54tn5n5.apps.googleusercontent.com',
      redirectUri: 'http://localhost',
    });
  });
});

describe('resolveAppleOAuthConfig', () => {
  function writeAppleSignConfig() {
    const dir = mkdtempSync(join(tmpdir(), 'vividrop-apple-oauth-'));
    writeFileSync(
      join(dir, 'id.txt'),
      [
        'Name:ViviDrop Desktop Auth Key',
        'Key ID:R6CSMNCJAM',
        'Team ID: S44ANBLMF9',
        'Client ID (Services ID): com.vividrop.global.signin',
        '测试环境(Review Server)：https://review-api.vividrop.com/auth/apple/callback',
        '正式环境(Global Product Server)：https://global-api.vividrop.com/auth/apple/callback',
      ].join('\n'),
    );
    return dir;
  }

  it('prefers explicit Apple env values', () => {
    expect(
      resolveAppleOAuthConfig({
        SYNCFLOW_APPLE_CLIENT_ID: 'com.example.desktop.signin',
        SYNCFLOW_APPLE_REDIRECT_URI: 'https://auth.example.test/auth/apple/callback',
      }),
    ).toEqual({
      clientId: 'com.example.desktop.signin',
      redirectUri: 'https://auth.example.test/auth/apple/callback',
    });
  });

  it('reads the Services ID and global callback from an Apple sign config directory', () => {
    expect(
      resolveAppleOAuthConfig({
        SYNCFLOW_APPLE_SIGN_CONFIG_DIR: writeAppleSignConfig(),
      }),
    ).toEqual({
      clientId: 'com.vividrop.global.signin',
      redirectUri: 'https://global-api.vividrop.com/auth/apple/callback',
    });
  });

  it('uses the review callback when auth is pointed at the review API', () => {
    expect(
      resolveAppleOAuthConfig({
        SYNCFLOW_APPLE_SIGN_CONFIG_DIR: writeAppleSignConfig(),
        SYNCFLOW_AUTH_BASE_URL: 'https://review-api.vividrop.com',
      }),
    ).toEqual({
      clientId: 'com.vividrop.global.signin',
      redirectUri: 'https://review-api.vividrop.com/auth/apple/callback',
    });
  });

  it('uses the review callback when only the review auth base is configured', () => {
    expect(
      resolveAppleOAuthConfig({
        SYNCFLOW_APPLE_SIGN_CONFIG_DIR: writeAppleSignConfig(),
        SYNCFLOW_AUTH_REVIEW_BASE_URL: 'https://review-api.vividrop.com',
      }),
    ).toEqual({
      clientId: 'com.vividrop.global.signin',
      redirectUri: 'https://review-api.vividrop.com/auth/apple/callback',
    });
  });

  it('uses the review callback for review release profiles', () => {
    expect(
      resolveAppleOAuthConfig({
        SYNCFLOW_APPLE_SIGN_CONFIG_DIR: writeAppleSignConfig(),
        SYNCFLOW_RELEASE_PROFILE: 'global-review',
      }),
    ).toEqual({
      clientId: 'com.vividrop.global.signin',
      redirectUri: 'https://review-api.vividrop.com/auth/apple/callback',
    });
  });

  it('uses packaged global Apple public config fallback for global builds', () => {
    vi.stubEnv('SYNCFLOW_MARKET', 'global');

    expect(resolveAppleOAuthConfig()).toEqual({
      clientId: 'com.vividrop.global.signin',
      redirectUri: 'https://global-api.vividrop.com/auth/apple/callback',
    });
  });
});
