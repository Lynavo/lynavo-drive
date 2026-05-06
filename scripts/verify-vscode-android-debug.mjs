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
assert.equal(defaultConfig.preLaunchTask, 'mobile: start metro');
assert.match(
  defaultConfig.command,
  /corepack pnpm --filter @syncflow\/mobile exec react-native run-android --mode debug --no-packager/,
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
assert.equal(metroTask.isBackground, true);
assert.deepEqual(metroTask.args, ['pnpm', '--filter', '@syncflow/mobile', 'start:reset']);
assert.equal(metroTask.problemMatcher.background.beginsPattern, '.*Welcome to React Native.*');
assert.match(metroTask.problemMatcher.background.endsPattern, /Welcome to Metro/);
assert.equal(mobilePackage.scripts?.['start:reset'], 'react-native start --reset-cache');

assert.match(
  androidBuildGradle,
  /missingDimensionStrategy\s+["']store["']\s*,\s*["']play["']/,
  'Android debug builds should resolve react-native-iap to the Play store flavor',
);
