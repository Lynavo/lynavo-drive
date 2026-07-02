import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildDevChildEnv,
  buildDevRunPlan,
  buildSourceDefaultMobileReleaseProfileSource,
} from '../release-profile-dev.mjs';

const token = (parts) => parts.join('');
const desktopUpdateEnv = token(['LYNAVO_DESKTOP', '_UPDATE_URL']);
const diagnosticsUploadEnv = token(['LYNAVO_DIAGNOSTICS', '_UPLOAD_URL']);
const supportApiBaseKey = token(['support', 'ApiBaseUrl']);
const releaseSupportApiBaseKey = token(['release', 'Support', 'ApiBaseUrl']);

test('builds prod desktop dev env from the release channel profile', () => {
  const plan = buildDevRunPlan({
    profileName: 'prod',
    target: 'desktop',
  });

  assert.equal(plan.command, 'pnpm');
  assert.deepEqual(plan.args, ['--filter', '@lynavo-drive/desktop', 'dev']);
  assert.equal(plan.profile.channel, 'prod');
  assert.equal(plan.env.LYNAVO_RELEASE_CHANNEL, 'prod');
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_SUPPORT_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, desktopUpdateEnv), false);
  assert.equal(Object.hasOwn(plan.env, diagnosticsUploadEnv), false);
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_CLIENT_CONFIG_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_GIFTCARD_REDEEM_BASE_URL'), false);
  assert.equal(plan.env.ELECTRON_BUILDER_CONFIG, 'electron-builder.yml');
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
  assert.equal(plan.writeMobileReleaseProfile, true);
  assert.match(plan.mobileReleaseProfileSource, /name: 'review'/);
  assert.match(plan.mobileReleaseProfileSource, /channel: 'review'/);
  assert.equal(plan.mobileReleaseProfileSource.includes(supportApiBaseKey), false);
  assert.equal(plan.mobileReleaseProfileSource.includes(releaseSupportApiBaseKey), false);
  assert.doesNotMatch(plan.mobileReleaseProfileSource, /releaseApiBaseUrl/);
});

test('builds prod Android dev command with the single native debug task', () => {
  const plan = buildDevRunPlan({
    profileName: 'prod',
    target: 'mobile-android',
  });

  assert.equal(plan.command, 'bash');
  assert.deepEqual(plan.args, ['scripts/dev/run-mobile-android-device.sh']);
  assert.equal(plan.env.LYNAVO_RELEASE_CHANNEL, 'prod');
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

test('prints dev dry-run plan with local release env', () => {
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
  assert.match(result.stdout, /LYNAVO_RELEASE_CHANNEL=prod/);
});

test('removes externally exported sensitive release env from child process env', () => {
  const plan = buildDevRunPlan({
    profileName: 'review',
    target: 'mobile-ios-device',
  });
  const env = buildDevChildEnv(
    {
      PATH: '/usr/bin',
      LYNAVO_API_BASE_URL: 'https://external-api.example',
      LYNAVO_CLIENT_CONFIG_BASE_URL: 'https://external-config.example',
      LYNAVO_GIFTCARD_REDEEM_BASE_URL: 'https://external-gift.example',
      LYNAVO_ANDROID_APP_ID: 'com.example.mobile',
      LYNAVO_GOOGLE_CLIENT_CONFIG_FILE: '/secure/google-client.json',
      GOOGLE_CLIENT_ID: 'google-client-id',
      APPLE_OAUTH_CLIENT_ID: 'com.example.signin',
      APPLE_ID: 'maintainer@example.com',
      APPLE_APP_SPECIFIC_PASSWORD: 'app-password',
      APPLE_TEAM_ID: 'TEAMID1234',
      CSC_LINK: '/secure/cert.p12',
      CSC_KEY_PASSWORD: 'cert-password',
      WIN_CSC_LINK: '/secure/win-cert.p12',
      LYNAVO_SUPPORT_API_BASE_URL: 'https://external-support.example',
      [desktopUpdateEnv]: 'https://external-update.example',
      [diagnosticsUploadEnv]: 'https://external-diagnostics.example',
    },
    plan.env,
  );

  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.LYNAVO_RELEASE_CHANNEL, 'review');
  assert.equal(Object.hasOwn(env, 'LYNAVO_SUPPORT_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, desktopUpdateEnv), false);
  assert.equal(Object.hasOwn(env, diagnosticsUploadEnv), false);
  assert.equal(Object.hasOwn(env, 'LYNAVO_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, 'LYNAVO_CLIENT_CONFIG_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, 'LYNAVO_GIFTCARD_REDEEM_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, 'LYNAVO_ANDROID_APP_ID'), false);
  assert.equal(Object.hasOwn(env, 'LYNAVO_GOOGLE_CLIENT_CONFIG_FILE'), false);
  assert.equal(Object.hasOwn(env, 'GOOGLE_CLIENT_ID'), false);
  assert.equal(Object.hasOwn(env, 'APPLE_OAUTH_CLIENT_ID'), false);
  assert.equal(Object.hasOwn(env, 'APPLE_ID'), false);
  assert.equal(Object.hasOwn(env, 'APPLE_APP_SPECIFIC_PASSWORD'), false);
  assert.equal(Object.hasOwn(env, 'APPLE_TEAM_ID'), false);
  assert.equal(Object.hasOwn(env, 'CSC_LINK'), false);
  assert.equal(Object.hasOwn(env, 'CSC_KEY_PASSWORD'), false);
  assert.equal(Object.hasOwn(env, 'WIN_CSC_LINK'), false);
});

test('external sensitive env does not appear in dev dry-run output', () => {
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
        LYNAVO_API_BASE_URL: 'https://external-api.example',
        LYNAVO_SUPPORT_API_BASE_URL: 'https://external-support.example',
        [desktopUpdateEnv]: 'https://external-update.example',
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Market:/);
  assert.doesNotMatch(result.stdout, /https:\/\/external-api\.example/);
  assert.doesNotMatch(result.stdout, /https:\/\/external-support\.example/);
  assert.doesNotMatch(result.stdout, /https:\/\/external-update\.example/);
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
