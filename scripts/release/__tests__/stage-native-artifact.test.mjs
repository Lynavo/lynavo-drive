import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const cli = new URL('../stage-native-artifact.mjs', import.meta.url);

function fixture() {
  return mkdtempSync(join(tmpdir(), 'lynavo-native-artifact-'));
}

function run(args) {
  return spawnSync(process.execPath, [cli.pathname, ...args], {
    encoding: 'utf8',
  });
}

test('stages one non-empty native artifact with an exact filename', () => {
  const root = fixture();
  const source = join(root, 'source.dmg');
  const outputDir = join(root, 'output');
  writeFileSync(source, 'native artifact');

  const result = run([
    '--source', source,
    '--output-dir', outputDir,
    '--name', 'LynavoDriveDemo-1.2.3-macos-arm64.dmg',
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(join(outputDir, 'LynavoDriveDemo-1.2.3-macos-arm64.dmg'), 'utf8'),
    'native artifact',
  );
  assert.match(result.stdout, /LynavoDriveDemo-1\.2\.3-macos-arm64\.dmg/);
});

test('rejects a missing source artifact', () => {
  const root = fixture();
  const result = run([
    '--source', join(root, 'missing.apk'),
    '--output-dir', join(root, 'output'),
    '--name', 'release.apk',
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source/i);
});

test('rejects an empty source artifact', () => {
  const root = fixture();
  const source = join(root, 'empty.aab');
  writeFileSync(source, '');
  const result = run([
    '--source', source,
    '--output-dir', join(root, 'output'),
    '--name', 'release.aab',
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /empty|non-empty/i);
});

for (const name of ['nested/release.exe', 'nested\\release.exe']) {
  test(`rejects destination name with path separators: ${name}`, () => {
    const root = fixture();
    const source = join(root, 'source.exe');
    writeFileSync(source, 'installer');
    const result = run([
      '--source', source,
      '--output-dir', join(root, 'output'),
      '--name', name,
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /name/i);
  });
}

test('refuses to stage into a directory containing a sibling', () => {
  const root = fixture();
  const source = join(root, 'source.zip');
  const outputDir = join(root, 'output');
  writeFileSync(source, 'archive');
  mkdirSync(outputDir);
  writeFileSync(join(outputDir, 'unexpected.txt'), 'unexpected');

  const result = run([
    '--source', source,
    '--output-dir', outputDir,
    '--name', 'release.zip',
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /output directory|sibling|empty/i);
});
