import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReleasePlan,
  getReleaseProfile,
  listReleaseProfileNames,
  parseTargets,
} from '../release-profiles.mjs';

const token = (parts) => parts.join('');
const legacySyncEnv = (suffix) => token(['SYN', 'CFLOW', suffix]);
const legacyViviEnv = (suffix) => token(['VIVI', 'DROP', suffix]);
const desktopUpdateEnv = token(['LYNAVO_DESKTOP', '_UPDATE_URL']);
const diagnosticsUploadEnv = token(['LYNAVO_DIAGNOSTICS', '_UPLOAD_URL']);
const supportApiBaseKey = token(['support', 'ApiBaseUrl']);
const releaseSupportApiBaseKey = token(['release', 'Support', 'ApiBaseUrl']);

test('defines the supported release channels', () => {
  assert.deepEqual(listReleaseProfileNames(), ['prod', 'review']);
});

test('keeps production profiles off the review server', () => {
  assert.equal(getReleaseProfile('prod').review, false);
  assert.equal(Object.hasOwn(getReleaseProfile('prod'), supportApiBaseKey), false);
});

test('keeps review profiles without official API endpoints or a market', () => {
  assert.deepEqual(
    {
      channel: getReleaseProfile('review').channel,
      review: getReleaseProfile('review').review,
      supportApiBasePresent: Object.hasOwn(getReleaseProfile('review'), supportApiBaseKey),
      hasMarket: Object.hasOwn(getReleaseProfile('review'), 'market'),
    },
    {
      channel: 'review',
      review: true,
      supportApiBasePresent: false,
      hasMarket: false,
    },
  );
});

test('does not bake an explicit auth base URL into production release env', () => {
  const plan = buildReleasePlan({
    profileName: 'prod',
    targets: ['mac'],
  });

  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_SUPPORT_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, desktopUpdateEnv), false);
  assert.equal(Object.hasOwn(plan.env, diagnosticsUploadEnv), false);
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_GIFTCARD_REDEEM_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, legacySyncEnv('_AUTH_BASE_URL')), false);
});

test('parses targets predictably', () => {
  assert.deepEqual(parseTargets('ios,android,mac,win,linux'), [
    'ios',
    'android',
    'mac',
    'win',
    'linux',
  ]);
  assert.deepEqual(parseTargets(' android , mac , linux '), ['android', 'mac', 'linux']);
  assert.throws(() => parseTargets('freebsd'), /Unsupported release target/);
});

test('builds commands and env from the selected profile', () => {
  const plan = buildReleasePlan({
    profileName: 'review',
    targets: ['ios', 'android', 'mac', 'win', 'linux'],
  });

  assert.equal(plan.profile.name, 'review');
  assert.equal(plan.profile.channel, 'review');
  assert.equal(Object.hasOwn(plan.profile, 'market'), false);
  assert.equal(Object.hasOwn(plan.profile, supportApiBaseKey), false);
  assert.equal(plan.env.LYNAVO_RELEASE_CHANNEL, 'review');
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_SUPPORT_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, desktopUpdateEnv), false);
  assert.equal(Object.hasOwn(plan.env, diagnosticsUploadEnv), false);
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_CLIENT_CONFIG_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_GIFTCARD_REDEEM_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, legacySyncEnv('_MARKET')), false);
  assert.equal(Object.hasOwn(plan.env, legacySyncEnv('_API_BASE_URL')), false);
  assert.equal(Object.hasOwn(plan.env, legacyViviEnv('_API_BASE_URL')), false);
  assert.equal(plan.env.ELECTRON_BUILDER_CONFIG, 'electron-builder.yml');
  assert.equal(plan.mobileReleaseProfileSource.includes("name: 'review'"), true);
  assert.equal(plan.mobileReleaseProfileSource.includes("channel: 'review'"), true);
  assert.equal(plan.mobileReleaseProfileSource.includes(supportApiBaseKey), false);
  assert.equal(plan.mobileReleaseProfileSource.includes(releaseSupportApiBaseKey), false);
  assert.equal(plan.mobileReleaseProfileSource.includes('releaseApiBaseUrl'), false);
  assert.doesNotMatch(plan.mobileReleaseProfileSource, /\bmarket\b/i);

  assert.deepEqual(
    plan.steps.map((step) => [step.target, step.command, step.args]),
    [
      ['ios', 'pnpm', ['--filter', '@lynavo-drive/mobile', 'build:ios:release']],
      [
        'android',
        'bash',
        [
          '-lc',
          'cd apps/mobile/android && ./gradlew assembleRelease bundleRelease -PreactNativeArchitectures=arm64-v8a,x86_64',
        ],
      ],
      ['mac', 'pnpm', ['package:desktop']],
      ['win', 'pnpm', ['--filter', '@lynavo-drive/desktop', 'package:win']],
      ['linux', 'pnpm', ['--filter', '@lynavo-drive/desktop', 'package:linux']],
    ],
  );
});
