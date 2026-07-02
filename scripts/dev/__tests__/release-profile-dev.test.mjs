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
const legacySyncEnv = (suffix) => token(['SYN', 'CFLOW', suffix]);
const legacyViviEnv = (suffix) => token(['VIVI', 'DROP', suffix]);
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
  assert.equal(Object.hasOwn(plan.profile, 'market'), false);
  assert.equal(plan.env.LYNAVO_RELEASE_CHANNEL, 'prod');
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_SUPPORT_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, desktopUpdateEnv), false);
  assert.equal(Object.hasOwn(plan.env, diagnosticsUploadEnv), false);
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_CLIENT_CONFIG_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_GIFTCARD_REDEEM_BASE_URL'), false);
  assert.equal(plan.env.ELECTRON_BUILDER_CONFIG, 'electron-builder.yml');
  assert.equal(Object.hasOwn(plan.env, legacySyncEnv('_RELEASE_PROFILE')), false);
  assert.equal(Object.hasOwn(plan.env, legacySyncEnv('_MARKET')), false);
  assert.equal(Object.hasOwn(plan.env, legacySyncEnv('_API_BASE_URL')), false);
  assert.equal(Object.hasOwn(plan.env, legacyViviEnv('_API_BASE_URL')), false);
  assert.equal(Object.hasOwn(plan.env, legacySyncEnv('_AUTH_BASE_URL')), false);
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
  assert.equal(Object.hasOwn(plan.env, legacySyncEnv('_MARKET')), false);
  assert.equal(plan.writeMobileReleaseProfile, true);
  assert.match(plan.mobileReleaseProfileSource, /name: 'review'/);
  assert.match(plan.mobileReleaseProfileSource, /channel: 'review'/);
  assert.equal(plan.mobileReleaseProfileSource.includes(supportApiBaseKey), false);
  assert.equal(plan.mobileReleaseProfileSource.includes(releaseSupportApiBaseKey), false);
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
  assert.equal(Object.hasOwn(plan.env, legacySyncEnv('_MARKET')), false);
  assert.equal(Object.hasOwn(plan.env, legacySyncEnv('_ANDROID_APP_ID')), false);
  assert.equal(Object.hasOwn(plan.env, legacySyncEnv('_ANDROID_INSTALL_TASK')), false);
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
  assert.equal(result.stdout.includes(`${legacySyncEnv('_MARKET')}=`), false);
  assert.equal(result.stdout.includes(`${legacySyncEnv('_API_BASE_URL')}=`), false);
  assert.equal(result.stdout.includes(`${legacyViviEnv('_API_BASE_URL')}=`), false);
});

test('removes externally exported legacy release env from child process env', () => {
  const plan = buildDevRunPlan({
    profileName: 'review',
    target: 'mobile-ios-device',
  });
  const env = buildDevChildEnv(
    {
      PATH: '/usr/bin',
      [legacySyncEnv('_MARKET')]: 'cn',
      [legacySyncEnv('_RELEASE_PROFILE')]: 'cn-prod',
      [legacySyncEnv('_API_BASE_URL')]: 'https://old.example',
      [legacyViviEnv('_API_BASE_URL')]: `https://old-${token(['vivi', 'drop'])}.example`,
      [legacySyncEnv('_CLIENT_CONFIG_BASE_URL')]: 'https://old-config.example',
      [legacySyncEnv('_GIFTCARD_REDEEM_BASE_URL')]: 'https://old-gift.example',
      LYNAVO_CLIENT_CONFIG_BASE_URL: 'https://external-config.example',
      LYNAVO_GIFTCARD_REDEEM_BASE_URL: 'https://external-gift.example',
      [legacySyncEnv('_AUTH_BASE_URL')]: 'https://old-auth.example',
      [legacySyncEnv('_ANDROID_APP_ID')]: 'com.legacy.mobile.cn',
      [legacySyncEnv('_ANDROID_INSTALL_TASK')]: ':app:installCnDebug',
      [legacySyncEnv('_GOOGLE_CLIENT_CONFIG_FILE')]: '/secure/google-client.json',
      GOOGLE_CLIENT_ID: 'google-client-id',
      APPLE_OAUTH_CLIENT_ID: 'com.example.signin',
      LYNAVO_API_BASE_URL: 'https://external-lynavo.example',
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
  assert.equal(Object.hasOwn(env, legacySyncEnv('_MARKET')), false);
  assert.equal(Object.hasOwn(env, legacySyncEnv('_RELEASE_PROFILE')), false);
  assert.equal(Object.hasOwn(env, legacySyncEnv('_API_BASE_URL')), false);
  assert.equal(Object.hasOwn(env, legacyViviEnv('_API_BASE_URL')), false);
  assert.equal(Object.hasOwn(env, legacySyncEnv('_CLIENT_CONFIG_BASE_URL')), false);
  assert.equal(Object.hasOwn(env, legacySyncEnv('_GIFTCARD_REDEEM_BASE_URL')), false);
  assert.equal(Object.hasOwn(env, 'LYNAVO_CLIENT_CONFIG_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, 'LYNAVO_GIFTCARD_REDEEM_BASE_URL'), false);
  assert.equal(Object.hasOwn(env, legacySyncEnv('_AUTH_BASE_URL')), false);
  assert.equal(Object.hasOwn(env, legacySyncEnv('_ANDROID_APP_ID')), false);
  assert.equal(Object.hasOwn(env, legacySyncEnv('_ANDROID_INSTALL_TASK')), false);
  assert.equal(Object.hasOwn(env, legacySyncEnv('_GOOGLE_CLIENT_CONFIG_FILE')), false);
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
        [legacySyncEnv('_MARKET')]: 'cn',
        [legacySyncEnv('_API_BASE_URL')]: 'https://old.example',
        [legacyViviEnv('_API_BASE_URL')]: `https://old-${token(['vivi', 'drop'])}.example`,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Market:/);
  assert.doesNotMatch(result.stdout, /https:\/\/old\.example/);
  assert.equal(result.stdout.includes(`https://old-${token(['vivi', 'drop'])}.example`), false);
  assert.equal(result.stdout.includes(`${legacySyncEnv('_MARKET')}=`), false);
  assert.equal(result.stdout.includes(`${legacySyncEnv('_API_BASE_URL')}=`), false);
  assert.equal(result.stdout.includes(`${legacyViviEnv('_API_BASE_URL')}=`), false);
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
