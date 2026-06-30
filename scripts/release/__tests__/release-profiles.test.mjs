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
  assert.equal(getReleaseProfile('prod').apiBaseUrl, 'https://api.lynavo.com');
  assert.equal(getReleaseProfile('prod').review, false);
});

test('keeps review profiles on the review server without a market', () => {
  assert.deepEqual(
    {
      channel: getReleaseProfile('review').channel,
      review: getReleaseProfile('review').review,
      apiBaseUrl: getReleaseProfile('review').apiBaseUrl,
      hasMarket: Object.hasOwn(getReleaseProfile('review'), 'market'),
    },
    {
      channel: 'review',
      review: true,
      apiBaseUrl: 'https://review-api.lynavo.com',
      hasMarket: false,
    },
  );
});

test('does not bake an explicit auth base URL into production release env', () => {
  const plan = buildReleasePlan({
    profileName: 'prod',
    targets: ['mac'],
  });

  assert.equal(plan.env.LYNAVO_API_BASE_URL, 'https://api.lynavo.com');
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
  assert.equal(plan.env.LYNAVO_RELEASE_CHANNEL, 'review');
  assert.equal(plan.env.LYNAVO_API_BASE_URL, 'https://review-api.lynavo.com');
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_CLIENT_CONFIG_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'LYNAVO_GIFTCARD_REDEEM_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'SYNCFLOW_MARKET'), false);
  assert.equal(Object.hasOwn(plan.env, 'SYNCFLOW_API_BASE_URL'), false);
  assert.equal(Object.hasOwn(plan.env, 'VIVIDROP_API_BASE_URL'), false);
  assert.equal(plan.env.ELECTRON_BUILDER_CONFIG, 'electron-builder.yml');
  assert.equal(plan.mobileReleaseProfileSource.includes("name: 'review'"), true);
  assert.equal(plan.mobileReleaseProfileSource.includes("channel: 'review'"), true);
  assert.equal(
    plan.mobileReleaseProfileSource.includes("apiBaseUrl: 'https://review-api.lynavo.com'"),
    true,
  );
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
