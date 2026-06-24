import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReleasePlan,
  getReleaseProfile,
  listReleaseProfileNames,
  parseTargets,
} from '../release-profiles.mjs';

test('defines the four supported release profiles', () => {
  assert.deepEqual(listReleaseProfileNames(), [
    'cn-prod',
    'global-prod',
    'cn-review',
    'global-review',
  ]);
});

test('keeps production profiles off the review server', () => {
  assert.equal(getReleaseProfile('cn-prod').apiBaseUrl, 'https://api.vividrop.cn');
  assert.equal(getReleaseProfile('global-prod').apiBaseUrl, 'https://global-api.vividrop.cn');
});

test('keeps review profiles on the review server while preserving market', () => {
  assert.deepEqual(
    {
      market: getReleaseProfile('cn-review').market,
      apiBaseUrl: getReleaseProfile('cn-review').apiBaseUrl,
    },
    {
      market: 'cn',
      apiBaseUrl: 'https://review-api.vividrop.cn',
    },
  );
  assert.deepEqual(
    {
      market: getReleaseProfile('global-review').market,
      apiBaseUrl: getReleaseProfile('global-review').apiBaseUrl,
    },
    {
      market: 'global',
      apiBaseUrl: 'https://review-api.vividrop.cn',
    },
  );
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
    profileName: 'global-review',
    targets: ['ios', 'android', 'mac', 'win', 'linux'],
  });

  assert.equal(plan.profile.name, 'global-review');
  assert.equal(plan.profile.market, 'global');
  assert.equal(plan.env.SYNCFLOW_MARKET, 'global');
  assert.equal(plan.env.SYNCFLOW_API_BASE_URL, 'https://review-api.vividrop.cn');
  assert.equal(plan.env.VIVIDROP_API_BASE_URL, 'https://review-api.vividrop.cn');
  assert.equal(plan.env.ELECTRON_BUILDER_CONFIG, 'electron-builder.global.yml');
  assert.equal(plan.mobileReleaseProfileSource.includes("name: 'global-review'"), true);
  assert.equal(
    plan.mobileReleaseProfileSource.includes("apiBaseUrl: 'https://review-api.vividrop.cn'"),
    true,
  );

  assert.deepEqual(
    plan.steps.map((step) => [step.target, step.command, step.args]),
    [
      [
        'ios',
        'bash',
        ['apps/mobile/ios/scripts/testflight-release.sh', 'archive-upload', 'global'],
      ],
      [
        'android',
        'bash',
        [
          '-lc',
          'cd apps/mobile/android && ./gradlew assembleGlobalRelease bundleGlobalRelease -PreactNativeArchitectures=arm64-v8a,x86_64',
        ],
      ],
      ['mac', 'pnpm', ['package:desktop:signed']],
      ['win', 'pnpm', ['--filter', '@syncflow/desktop', 'package:win:global']],
      ['linux', 'pnpm', ['--filter', '@syncflow/desktop', 'package:linux:global']],
    ],
  );
});
