import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function runReleaseDryRun(profile, targets = 'ios,android,win,linux') {
  return spawnSync(
    process.execPath,
    ['scripts/release/release.mjs', '--profile', profile, '--targets', targets, '--dry-run'],
    {
      cwd: new URL('../../..', import.meta.url),
      encoding: 'utf8',
    },
  );
}

test('prints the cn-review release plan without running build commands in dry-run mode', () => {
  const result = runReleaseDryRun('cn-review');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Profile:\s+cn-review/);
  assert.match(result.stdout, /Market:\s+cn/);
  assert.match(result.stdout, /Base URL:\s+https:\/\/review-api\.vividrop\.cn/);
  assert.match(result.stdout, /DRY RUN/);
  assert.match(result.stdout, /SYNCFLOW_MARKET=cn/);
  assert.match(result.stdout, /SYNCFLOW_API_BASE_URL=https:\/\/review-api\.vividrop\.cn/);
  assert.match(result.stdout, /VIVIDROP_API_BASE_URL=https:\/\/review-api\.vividrop\.cn/);
  assert.match(result.stdout, /ELECTRON_BUILDER_CONFIG=electron-builder\.cn\.yml/);
  assert.match(
    result.stdout,
    /bash apps\/mobile\/ios\/scripts\/testflight-release\.sh archive-upload cn/,
  );
  assert.match(result.stdout, /bash -lc cd apps\/mobile\/android && \.\/gradlew assembleCnRelease bundleCnRelease/);
  assert.match(result.stdout, /pnpm --filter @syncflow\/desktop package:win:cn/);
  assert.match(result.stdout, /pnpm --filter @syncflow\/desktop package:linux:cn/);
});

test('prints the global-review release plan without running build commands in dry-run mode', () => {
  const result = runReleaseDryRun('global-review');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Profile:\s+global-review/);
  assert.match(result.stdout, /Market:\s+global/);
  assert.match(result.stdout, /Base URL:\s+https:\/\/review-api\.vividrop\.cn/);
  assert.match(result.stdout, /DRY RUN/);
  assert.match(result.stdout, /SYNCFLOW_MARKET=global/);
  assert.match(result.stdout, /SYNCFLOW_API_BASE_URL=https:\/\/review-api\.vividrop\.cn/);
  assert.match(result.stdout, /VIVIDROP_API_BASE_URL=https:\/\/review-api\.vividrop\.cn/);
  assert.match(result.stdout, /ELECTRON_BUILDER_CONFIG=electron-builder\.global\.yml/);
  assert.match(
    result.stdout,
    /bash apps\/mobile\/ios\/scripts\/testflight-release\.sh archive-upload global/,
  );
  assert.match(
    result.stdout,
    /bash -lc cd apps\/mobile\/android && \.\/gradlew assembleGlobalRelease bundleGlobalRelease/,
  );
  assert.match(result.stdout, /pnpm --filter @syncflow\/desktop package:win:global/);
  assert.match(result.stdout, /pnpm --filter @syncflow\/desktop package:linux:global/);
});

test('rejects missing profile', () => {
  const result = spawnSync(process.execPath, ['scripts/release/release.mjs', '--dry-run'], {
    cwd: new URL('../../..', import.meta.url),
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--profile is required/);
});
