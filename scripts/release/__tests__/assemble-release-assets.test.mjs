import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

const cli = new URL('../assemble-release-assets.mjs', import.meta.url);
const version = '1.2.3';

function expectedNames(releaseVersion = version) {
  return [
    `LynavoDriveDemo-${releaseVersion}-macos-arm64.dmg`,
    `LynavoDriveDemo-${releaseVersion}-macos-x64.dmg`,
    `LynavoDriveDemo-${releaseVersion}-windows-x64.exe`,
    `LynavoDriveDemo-${releaseVersion}-windows-x64.zip`,
    `LynavoDriveDemo-${releaseVersion}-android-arm64-x86_64.apk`,
    `LynavoDriveDemo-${releaseVersion}-android-arm64-x86_64.aab`,
  ];
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lynavo-release-assets-'));
  const inputDirs = expectedNames().map((name, index) => {
    const inputDir = join(root, `input-${index}`);
    const path = index === 0 ? join(inputDir, 'nested', name) : join(inputDir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `asset:${name}`);
    return inputDir;
  });
  return { root, inputDirs, outputDir: join(root, 'output') };
}

function run({ inputDirs, outputDir, releaseVersion = version }) {
  const args = [
    cli.pathname,
    '--version', releaseVersion,
    ...inputDirs.flatMap(inputDir => ['--input-dir', inputDir]),
    '--output-dir', outputDir,
  ];
  return spawnSync(process.execPath, args, { encoding: 'utf8' });
}

test('assembles exactly six allowlisted assets and sorted SHA-256 checksums', () => {
  const { inputDirs, outputDir } = fixture();
  const result = run({ inputDirs, outputDir });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(outputDir).sort(), [
    ...expectedNames(),
    'SHA256SUMS',
  ].sort());

  const checksumLines = readFileSync(join(outputDir, 'SHA256SUMS'), 'utf8')
    .trimEnd()
    .split('\n');
  const sortedNames = expectedNames().sort();
  assert.deepEqual(
    checksumLines.map(line => line.slice(66)),
    sortedNames,
  );
  for (const [index, name] of sortedNames.entries()) {
    const contents = readFileSync(join(outputDir, name));
    const expectedHash = createHash('sha256').update(contents).digest('hex');
    assert.equal(checksumLines[index], `${expectedHash}  ${name}`);
    assert.match(checksumLines[index], /^[0-9a-f]{64}  [^/\\]+$/);
  }
});

test('rejects a missing allowlisted asset', () => {
  const { inputDirs, outputDir } = fixture();
  const result = run({ inputDirs: inputDirs.slice(1), outputDir });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing.*macos-arm64|macos-arm64.*missing/i);
});

test('rejects an empty allowlisted asset', () => {
  const { inputDirs, outputDir } = fixture();
  const emptyName = expectedNames()[2];
  writeFileSync(join(inputDirs[2], emptyName), '');
  const result = run({ inputDirs, outputDir });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /empty|non-empty/i);
});

test('rejects an unexpected input sibling', () => {
  const { inputDirs, outputDir } = fixture();
  writeFileSync(join(inputDirs[0], 'notes.txt'), 'unexpected');
  const result = run({ inputDirs, outputDir });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unexpected.*notes\.txt|notes\.txt.*unexpected/i);
});

test('rejects a duplicate allowlisted basename', () => {
  const { root, inputDirs, outputDir } = fixture();
  const duplicateDir = join(root, 'duplicate');
  mkdirSync(duplicateDir);
  writeFileSync(join(duplicateDir, expectedNames()[0]), 'duplicate');
  const result = run({ inputDirs: [...inputDirs, duplicateDir], outputDir });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate.*macos-arm64|macos-arm64.*duplicate/i);
});

test('rejects assets named for a different version', () => {
  const { inputDirs, outputDir } = fixture();
  const result = run({ inputDirs, outputDir, releaseVersion: '1.2.4' });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unexpected|wrong version|1\.2\.3/i);
});

test('rejects a non-empty output directory', () => {
  const { inputDirs, outputDir } = fixture();
  mkdirSync(outputDir);
  writeFileSync(join(outputDir, 'sibling.txt'), 'existing');
  const result = run({ inputDirs, outputDir });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /output directory.*empty|empty.*output directory/i);
});
