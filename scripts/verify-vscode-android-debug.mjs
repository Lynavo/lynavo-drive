import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(root, relativePath), 'utf8'));
}

const launch = readJson('.vscode/launch.json');
const tasks = readJson('.vscode/tasks.json');
const mobilePackage = readJson('apps/mobile/package.json');
const androidBuildGradle = readFileSync(
  resolve(root, 'apps/mobile/android/app/build.gradle'),
  'utf8',
);

const [defaultConfig] = launch.configurations;

assert.equal(defaultConfig?.name, 'Mobile: Android Debug (F5)');
assert.equal(defaultConfig.type, 'node-terminal');
assert.equal(defaultConfig.request, 'launch');
assert.equal(defaultConfig.preLaunchTask, undefined);
assert.match(
  defaultConfig.command,
  /bash scripts\/dev\/run-mobile-android-device\.sh/,
);
assert.equal(defaultConfig.platform, undefined);
assert.equal(defaultConfig.target, undefined);
assert.equal(defaultConfig.cwd, undefined);
assert.equal(defaultConfig.variant, undefined);
assert.equal(defaultConfig.logCatArguments, undefined);

const iosNoMetroConfig = launch.configurations.find(
  (configuration) => configuration.name === 'Mobile: iOS Simulator (no Metro)',
);
assert.ok(iosNoMetroConfig, 'Mobile: iOS Simulator (no Metro) should exist');
assert.equal(iosNoMetroConfig.type, 'node-terminal');
assert.equal(iosNoMetroConfig.request, 'launch');
assert.equal(iosNoMetroConfig.preLaunchTask, 'mobile: start metro');
assert.match(
  iosNoMetroConfig.command,
  /corepack pnpm --filter @syncflow\/mobile exec react-native run-ios --no-packager/,
);

const iosDeviceConfig = launch.configurations.find(
  (configuration) => configuration.name === 'Mobile: iOS (macOS)',
);
assert.ok(iosDeviceConfig, 'Mobile: iOS (macOS) should exist');
assert.equal(iosDeviceConfig.type, 'node-terminal');
assert.equal(iosDeviceConfig.request, 'launch');
assert.equal(iosDeviceConfig.preLaunchTask, 'mobile: start metro');
assert.match(
  iosDeviceConfig.command,
  /bash scripts\/dev\/run-mobile-ios-device\.sh/,
);

const androidIosCompound = launch.compounds?.find(
  (compound) => compound.name === 'Mobile: Android + iOS',
);
assert.ok(androidIosCompound, 'Mobile: Android + iOS compound should exist');
assert.deepEqual(androidIosCompound.configurations, [
  'Mobile: Android Debug (F5)',
  'Mobile: iOS Simulator (no Metro)',
]);
assert.equal(androidIosCompound.stopAll, false);

assert.equal(
  launch.configurations.some(
    (configuration) => configuration.name === 'Mobile: Android (quick launch)',
  ),
  false,
  'Mobile: Android (quick launch) should not be present; F5 is the Android debug entry point',
);

const metroTask = tasks.tasks.find((task) => task.label === 'mobile: start metro');

assert.ok(metroTask, 'mobile: start metro task should exist');
assert.equal(metroTask.type, 'shell');
assert.equal(metroTask.command, 'bash');
assert.deepEqual(metroTask.args, [
  '${workspaceFolder}/scripts/dev/ensure-mobile-metro.sh',
]);
assert.equal(metroTask.isBackground, true);
assert.match(
  metroTask.problemMatcher.background.beginsPattern,
  /Metro already running/,
);
assert.equal(
  metroTask.problemMatcher.background.endsPattern,
  '.*Metro launch requested.*',
);
assert.equal(mobilePackage.scripts?.start, 'react-native start');

assert.match(
  androidBuildGradle,
  /missingDimensionStrategy\s+["']store["']\s*,\s*["']play["']/,
  'Android debug builds should resolve react-native-iap to the Play store flavor',
);
