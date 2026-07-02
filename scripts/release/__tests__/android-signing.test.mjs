import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../../..');
const token = (parts) => parts.join('');

test('Android release builds are source-buildable without official signing material', () => {
  const buildGradle = readFileSync(
    resolve(repoRoot, 'apps/mobile/android/app/build.gradle'),
    'utf8',
  );

  assert.doesNotMatch(buildGradle, /storeFile file\('debug\.keystore'\)/);
  assert.doesNotMatch(buildGradle, /storeFile file\('release\.keystore'\)/);
  assert.doesNotMatch(buildGradle, /lynavo_release_2026/);
  assert.equal(buildGradle.includes(token(['MYAPP', '_RELEASE_'])), false);
  assert.doesNotMatch(buildGradle, /signingConfigs/);
  assert.doesNotMatch(buildGradle, /signingConfig signingConfigs\.release/);
  assert.doesNotMatch(buildGradle, /Missing Android release signing properties/);
  assert.doesNotMatch(buildGradle, /requireReleaseSigningConfig/);
});
