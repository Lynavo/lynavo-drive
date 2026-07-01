import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReleasePlan,
  getReleaseProfile,
  listReleaseProfileNames,
  parseTargets,
} from '../release-profiles.mjs';

test('defines the supported release channels', () => {
  assert.deepEqual(listReleaseProfileNames(), ['prod', 'review']);
});

test('keeps production profiles off the review server', () => {
  assert.equal(getReleaseProfile('prod').review, false);
  assert.equal(Object.hasOwn(getReleaseProfile('prod'), 'supportApiBaseUrl'), false);
});

test('keeps review profiles without official API endpoints or a market', () => {
  assert.deepEqual(
    {
      channel: getReleaseProfile('review').channel,
      review: getReleaseProfile('review').review,
      hasSupportApiBaseUrl: Object.hasOwn(getReleaseProfile('review'), 'supportApiBaseUrl'),
      hasMarket: Object.hasOwn(getReleaseProfile('review'), 'market'),
    },
    {
      channel: 'review',
      review: true,
      hasSupportApiBaseUrl: false,
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
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_DESKTOP_UPDATE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_DIAGNOSTICS_UPLOAD_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_GIFTCARD_REDEEM_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'SYNCFLOW_AUTH_BASE_URL'), false);
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
  assert.equal(Object.hasOwn(plan.profile, 'supportApiBaseUrl'), false);
  assert.equal(plan.env.LYNAVO_RELEASE_CHANNEL, 'review');
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_SUPPORT_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_DESKTOP_UPDATE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_DIAGNOSTICS_UPLOAD_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_CLIENT_CONFIG_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_GIFTCARD_REDEEM_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'SYNCFLOW_MARKET'), false);
  assert.equal(Object.hasOwn(plan.env, 'SYNCFLOW_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'VIVIDROP_API_BASE_URL'), false);
  assert.equal(plan.env.ELECTRON_BUILDER_CONFIG, 'electron-builder.yml');
  assert.equal(plan.mobileReleaseProfileSource.includes("name: 'review'"), true);
  assert.equal(plan.mobileReleaseProfileSource.includes("channel: 'review'"), true);
  assert.equal(plan.mobileReleaseProfileSource.includes('supportApiBaseUrl'), false);
  assert.equal(plan.mobileReleaseProfileSource.includes('releaseSupportApiBaseUrl'), false);
  assert.equal(plan.mobileReleaseProfileSource.includes('releaseApiBaseUrl'), false);
  assert.doesNotMatch(plan.mobileReleaseProfileSource, /\bmarket\b/i);

  assert.deepEqual(
    plan.steps.map((step) => [step.target, step.command, step.args]),
    [
      ['ios', 'bash', ['apps/mobile/ios/scripts/testflight-release.sh', 'archive-upload']],
      [
        'android',
        'bash',
        [
          '-lc',
          'cd apps/mobile/android && ./gradlew assembleRelease bundleRelease -PreactNativeArchitectures=arm64-v8a,x86_64',
        ],
      ],
      ['mac', 'pnpm', ['package:desktop:signed']],
      ['win', 'pnpm', ['--filter', '@lynavo-drive/desktop', 'package:win']],
      ['linux', 'pnpm', ['--filter', '@lynavo-drive/desktop', 'package:linux']],
    ],
  );
});
