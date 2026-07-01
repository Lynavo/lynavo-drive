import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildDevChildEnv,
  buildDevRunPlan,
  buildSourceDefaultMobileReleaseProfileSource,
} from '../release-profile-dev.mjs';

test('builds prod desktop dev env from the release channel profile', () => {
  const plan = buildDevRunPlan({
    profileName: 'prod',
    target: 'desktop',
  });

  assert.equal(plan.command, 'pnpm');
  assert.deepEqual(plan.args, ['--filter', '@lynavo-drive/desktop', 'dev']);
  assert.equal(plan.profile.channel, 'prod');
  assert.equal(Object.hasOwn(plan.profile, 'market'), false);
  assert.equal(plan.env.LYNAVO_RELEASE_CHANNEL, 'prod');
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_SUPPORT_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_DESKTOP_UPDATE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_DIAGNOSTICS_UPLOAD_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_CLIENT_CONFIG_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_GIFTCARD_REDEEM_BASE_URL'), false);
  assert.equal(plan.env.ELECTRON_BUILDER_CONFIG, 'electron-builder.yml');
  assert.equal(Object.hasOwn(plan.env, 'SYNCFLOW_RELEASE_PROFILE'), false);
  assert.equal(Object.hasOwn(plan.env, 'SYNCFLOW_MARKET'), false);
  assert.equal(Object.hasOwn(plan.env, 'SYNCFLOW_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'VIVIDROP_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'SYNCFLOW_AUTH_BASE_URL'), false);
  assert.equal(plan.writeMobileReleaseProfile, false);
});

test('builds review iOS dev command with the single native scheme and mobile profile', () => {
  const plan = buildDevRunPlan({
    profileName: 'review',
    target: 'mobile-ios',
    extraArgs: ['--simulator', 'iPhone 17 Pro'],
  });

  assert.equal(plan.command, 'corepack');
  assert.deepEqual(plan.args, [
    'pnpm',
    '--filter',
    '@lynavo-drive/mobile',
    'exec',
    'react-native',
    'run-ios',
    '--scheme',
    'LynavoDrive',
    '--mode',
    'Debug',
    '--simulator',
    'iPhone 17 Pro',
  ]);
  assert.equal(plan.env.LYNAVO_RELEASE_CHANNEL, 'review');
  assert.equal(Object.hasOwn(plan.env, 'SYNCFLOW_MARKET'), false);
  assert.equal(plan.writeMobileReleaseProfile, true);
  assert.match(plan.mobileReleaseProfileSource, /name: 'review'/);
  assert.match(plan.mobileReleaseProfileSource, /channel: 'review'/);
  assert.doesNotMatch(plan.mobileReleaseProfileSource, /supportApiBaseUrl/);
  assert.doesNotMatch(plan.mobileReleaseProfileSource, /releaseSupportApiBaseUrl/);
  assert.doesNotMatch(plan.mobileReleaseProfileSource, /releaseApiBaseUrl/);
  assert.doesNotMatch(plan.mobileReleaseProfileSource, /\bmarket\b/i);
});

test('builds prod Android dev command with the single native debug task', () => {
  const plan = buildDevRunPlan({
    profileName: 'prod',
    target: 'mobile-android',
  });

  assert.equal(plan.command, 'bash');
  assert.deepEqual(plan.args, ['scripts/dev/run-mobile-android-device.sh']);
  assert.equal(plan.env.LYNAVO_RELEASE_CHANNEL, 'prod');
  assert.equal(Object.hasOwn(plan.env, 'SYNCFLOW_MARKET'), false);
  assert.equal(Object.hasOwn(plan.env, 'SYNCFLOW_ANDROID_APP_ID'), false);
  assert.equal(Object.hasOwn(plan.env, 'SYNCFLOW_ANDROID_INSTALL_TASK'), false);
  assert.equal(plan.writeMobileReleaseProfile, true);
});

test('can generate the source-default mobile release profile for reset', () => {
  assert.equal(
    buildSourceDefaultMobileReleaseProfileSource(),
    `export const mobileReleaseProfile = {
  name: 'source-default',
  channel: 'dev',
  review: false,
} as const;
`,
  );
});

test('prints dev dry-run plan without market output or market env', () => {
  const result = spawnSync(
    process.execPath,
    [
      'scripts/dev/run-release-profile.mjs',
      '--profile',
      'prod',
      '--target',
      'desktop',
      '--dry-run',
    ],
    {
      cwd: new URL('../../..', import.meta.url),
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Profile:\s+prod/);
  assert.match(result.stdout, /Channel:\s+prod/);
  assert.doesNotMatch(result.stdout, /Market:/);
  assert.doesNotMatch(result.stdout, /market/i);
  assert.match(result.stdout, /LYNAVO_RELEASE_CHANNEL=prod/);
  assert.doesNotMatch(result.stdout, /SYNCFLOW_MARKET=/);
  assert.doesNotMatch(result.stdout, /SYNCFLOW_API_BASE_URL=/);
  assert.doesNotMatch(result.stdout, /VIVIDROP_API_BASE_URL=/);
});

test('removes externally exported legacy release env from child process env', () => {
  const plan = buildDevRunPlan({
    profileName: 'review',
    target: 'mobile-ios-device',
  });
  const env = buildDevChildEnv(
    {
      PATH: '/usr/bin',
      SYNCFLOW_MARKET: 'cn',
      SYNCFLOW_RELEASE_PROFILE: 'cn-prod',
      SYNCFLOW_API_BASE_URL: 'https://old.example',
      VIVIDROP_API_BASE_URL: 'https://old-vividrop.example',
      SYNCFLOW_CLIENT_CONFIG_BASE_URL: 'https://old-config.example',
      SYNCFLOW_GIFTCARD_REDEEM_BASE_URL: 'https://old-gift.example',
      LYNAVO_CLIENT_CONFIG_BASE_URL: 'https://external-config.example',
      LYNAVO_GIFTCARD_REDEEM_BASE_URL: 'https://external-gift.example',
      SYNCFLOW_AUTH_BASE_URL: 'https://old-auth.example',
      SYNCFLOW_ANDROID_APP_ID: 'com.legacy.mobile.cn',
      SYNCFLOW_ANDROID_INSTALL_TASK: ':app:installCnDebug',
      SYNCFLOW_GOOGLE_CLIENT_CONFIG_FILE: '/secure/google-client.json',
      GOOGLE_CLIENT_ID: 'google-client-id',
      APPLE_OAUTH_CLIENT_ID: 'com.example.signin',
      LYNAVO_API_BASE_URL: 'https://external-lynavo.example',
      LYNAVO_SUPPORT_API_BASE_URL: 'https://external-support.example',
      LYNAVO_DESKTOP_UPDATE_URL: 'https://external-update.example',
      LYNAVO_DIAGNOSTICS_UPLOAD_URL: 'https://external-diagnostics.example',
    },
    plan.env,
  );

  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.LYNAVO_RELEASE_CHANNEL, 'review');
  assert.equal(Object.hasOwn(env, 'LYNAVO_SUPPORT_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, 'LYNAVO_DESKTOP_UPDATE_URL'), false);
  assert.equal(Object.hasOwn(env, 'LYNAVO_DIAGNOSTICS_UPLOAD_URL'), false);
  assert.equal(Object.hasOwn(env, 'LYNAVO_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, 'SYNCFLOW_MARKET'), false);
  assert.equal(Object.hasOwn(env, 'SYNCFLOW_RELEASE_PROFILE'), false);
  assert.equal(Object.hasOwn(env, 'SYNCFLOW_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, 'VIVIDROP_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, 'SYNCFLOW_CLIENT_CONFIG_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, 'SYNCFLOW_GIFTCARD_REDEEM_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, 'LYNAVO_CLIENT_CONFIG_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, 'LYNAVO_GIFTCARD_REDEEM_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, 'SYNCFLOW_AUTH_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, 'SYNCFLOW_ANDROID_APP_ID'), false);
  assert.equal(Object.hasOwn(env, 'SYNCFLOW_ANDROID_INSTALL_TASK'), false);
  assert.equal(Object.hasOwn(env, 'SYNCFLOW_GOOGLE_CLIENT_CONFIG_FILE'), false);
  assert.equal(Object.hasOwn(env, 'GOOGLE_CLIENT_ID'), false);
  assert.equal(Object.hasOwn(env, 'APPLE_OAUTH_CLIENT_ID'), false);
});

test('external legacy env does not appear in dev dry-run output', () => {
  const result = spawnSync(
    process.execPath,
    [
      'scripts/dev/run-release-profile.mjs',
      '--profile',
      'review',
      '--target',
      'mobile-ios-device',
      '--dry-run',
    ],
    {
      cwd: new URL('../../..', import.meta.url),
      encoding: 'utf8',
      env: {
        ...process.env,
        SYNCFLOW_MARKET: 'cn',
        SYNCFLOW_API_BASE_URL: 'https://old.example',
        VIVIDROP_API_BASE_URL: 'https://old-vividrop.example',
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Market:/);
  assert.doesNotMatch(result.stdout, /https:\/\/old\.example/);
  assert.doesNotMatch(result.stdout, /https:\/\/old-vividrop\.example/);
  assert.doesNotMatch(result.stdout, /SYNCFLOW_MARKET=/);
  assert.doesNotMatch(result.stdout, /SYNCFLOW_API_BASE_URL=/);
  assert.doesNotMatch(result.stdout, /VIVIDROP_API_BASE_URL=/);
});

test('explicit mobile profile dry-run does not write the generated mobile profile file', () => {
  const mobileProfileUrl = new URL('../../../apps/mobile/src/release-profile.ts', import.meta.url);
  let before = null;
  try {
    before = {
      exists: true,
      source: readFileSync(mobileProfileUrl, 'utf8'),
    };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    before = { exists: false, source: '' };
  }

  const result = spawnSync(
    process.execPath,
    [
      'scripts/dev/run-release-profile.mjs',
      '--profile',
      'review',
      '--target',
      'mobile-metro',
      '--set-mobile-profile-only',
      '--dry-run',
    ],
    {
      cwd: new URL('../../..', import.meta.url),
      encoding: 'utf8',
    },
  );

  let after = null;
  try {
    after = {
      exists: true,
      source: readFileSync(mobileProfileUrl, 'utf8'),
    };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    after = { exists: false, source: '' };
  }

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(after, before);
});
