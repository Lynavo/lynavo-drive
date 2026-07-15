import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('Android uses the demo application identity consistently', () => {
  const buildGradle = readRepoFile('apps/mobile/android/app/build.gradle');
  const reactNativeConfig = readRepoFile('apps/mobile/react-native.config.js');
  const appConfig = readRepoFile('apps/mobile/src/config/app-config.ts');
  const deviceScript = readRepoFile('scripts/dev/run-mobile-android-device.sh');
  const versionScript = readRepoFile('scripts/sync-version-manifest.mjs');
  const mainActivity = readRepoFile(
    'apps/mobile/android/app/src/main/java/com/lynavo/drive/mobile/MainActivity.kt',
  );
  const mainApplication = readRepoFile(
    'apps/mobile/android/app/src/main/java/com/lynavo/drive/mobile/MainApplication.kt',
  );

  assert.match(buildGradle, /^    namespace "com\.lynavo\.drive\.mobile\.demo"$/m);
  assert.match(buildGradle, /^        applicationId "com\.lynavo\.drive\.mobile\.demo"$/m);
  assert.match(reactNativeConfig, /packageName: 'com\.lynavo\.drive\.mobile\.demo'/);
  assert.match(appConfig, /bundleId: 'com\.lynavo\.drive\.mobile\.demo'/);
  assert.match(deviceScript, /LYNAVO_ANDROID_APP_ID:-com\.lynavo\.drive\.mobile\.demo/);
  assert.match(versionScript, /package com\.lynavo\.drive\.mobile\.demo\.sync/);
  assert.match(mainActivity, /^package com\.lynavo\.drive\.mobile\.demo$/m);
  assert.match(mainApplication, /^package com\.lynavo\.drive\.mobile\.demo$/m);
});
