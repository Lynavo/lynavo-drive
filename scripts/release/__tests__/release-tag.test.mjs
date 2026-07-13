import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { verifyReleaseTag } from '../release-version.mjs';

const cli = new URL('../verify-release-tag.mjs', import.meta.url);

function writeFixtureFile(root, relativePath, content) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function fixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lynavo-release-tag-'));
  const versions = {
    desktop: '1.2.3',
    mobile: '1.2.3',
    ios: '1.2.3',
    android: 'resolveIosMarketingVersion()',
    ...overrides,
  };

  writeFixtureFile(
    root,
    'apps/desktop/package.json',
    `${JSON.stringify({ name: '@lynavo-drive/desktop', version: versions.desktop })}\n`,
  );
  writeFixtureFile(
    root,
    'apps/mobile/package.json',
    `${JSON.stringify({ name: '@lynavo-drive/mobile', version: versions.mobile })}\n`,
  );
  writeFixtureFile(
    root,
    'apps/mobile/ios/LynavoDrive.xcodeproj/project.pbxproj',
    [
      `MARKETING_VERSION = ${versions.ios};`,
      `MARKETING_VERSION = ${versions.ios};`,
      '',
    ].join('\n'),
  );
  writeFixtureFile(
    root,
    'apps/mobile/android/app/build.gradle',
    `versionName ${versions.android}\n`,
  );

  return root;
}

test('accepts an exact stable tag when all four version sources match', () => {
  const result = verifyReleaseTag({ repoRoot: fixture(), tag: 'v1.2.3' });
  assert.deepEqual(result, { tag: 'v1.2.3', version: '1.2.3' });
});

for (const tag of ['1.2.3', 'v1.2', 'v01.2.3', 'v1.2.3-rc.1']) {
  test(`rejects a non-stable release tag: ${tag}`, () => {
    assert.throws(
      () => verifyReleaseTag({ repoRoot: fixture(), tag }),
      /stable release tag|vX\.Y\.Z/i,
    );
  });
}

for (const [source, overrides] of [
  ['desktop', { desktop: '1.2.4' }],
  ['mobile', { mobile: '1.2.4' }],
  ['iOS', { ios: '1.2.4' }],
  ['Android', { android: "'1.2.4'" }],
]) {
  test(`rejects a ${source} version mismatch`, () => {
    assert.throws(
      () => verifyReleaseTag({ repoRoot: fixture(overrides), tag: 'v1.2.3' }),
      new RegExp(`${source}.*1\\.2\\.4|1\\.2\\.4.*${source}`, 'i'),
    );
  });
}

test('rejects ambiguous iOS marketing versions', () => {
  const root = fixture();
  writeFixtureFile(
    root,
    'apps/mobile/ios/LynavoDrive.xcodeproj/project.pbxproj',
    'MARKETING_VERSION = 1.2.3;\nMARKETING_VERSION = 1.2.4;\n',
  );

  assert.throws(
    () => verifyReleaseTag({ repoRoot: root, tag: 'v1.2.3' }),
    /iOS.*ambiguous|ambiguous.*iOS/i,
  );
});

test('accepts an Android literal version matching the tag', () => {
  const root = fixture({ android: "'1.2.3'" });
  assert.deepEqual(verifyReleaseTag({ repoRoot: root, tag: 'v1.2.3' }), {
    tag: 'v1.2.3',
    version: '1.2.3',
  });
});

test('CLI prints only the verified version', () => {
  const result = spawnSync(
    process.execPath,
    [cli.pathname, '--repo-root', fixture(), '--tag', 'v1.2.3'],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '1.2.3\n');
  assert.equal(result.stderr, '');
});

test('CLI accepts the pnpm argument separator before the tag flag', () => {
  const result = spawnSync(
    process.execPath,
    [cli.pathname, '--', '--repo-root', fixture(), '--tag', 'v1.2.3'],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '1.2.3\n');
});
