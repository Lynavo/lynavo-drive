import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../../..');

test('Android signing does not depend on committed repo-local keystores', () => {
  const buildGradle = readFileSync(
    resolve(repoRoot, 'apps/mobile/android/app/build.gradle'),
    'utf8',
  );

  assert.doesNotMatch(buildGradle, /storeFile file\('debug\.keystore'\)/);
  assert.doesNotMatch(buildGradle, /storeFile file\('release\.keystore'\)/);
  assert.doesNotMatch(buildGradle, /lynavo_release_2026/);
  assert.match(buildGradle, /hasReleaseSigningConfig\(\)/);
  assert.match(buildGradle, /Missing Android release signing properties/);
});
