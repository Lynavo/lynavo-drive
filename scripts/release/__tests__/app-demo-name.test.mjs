import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const appName = 'LynavoDriveDemo';

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('desktop and mobile app names identify demo builds consistently', () => {
  const desktopPackage = JSON.parse(readRepoFile('apps/desktop/package.json'));
  const desktopBuilder = readRepoFile('apps/desktop/electron-builder.yml');
  const desktopIndex = readRepoFile('apps/desktop/src/renderer/index.html');
  const desktopProduct = readRepoFile('apps/desktop/src/shared/product.ts');
  const mobileApp = JSON.parse(readRepoFile('apps/mobile/app.json'));
  const mobileConfig = readRepoFile('apps/mobile/src/config/app-config.ts');
  const androidSettings = readRepoFile('apps/mobile/android/settings.gradle');
  const androidStrings = readRepoFile(
    'apps/mobile/android/app/src/main/res/values/strings.xml',
  );
  const iosInfo = readRepoFile('apps/mobile/ios/LynavoDrive/Info.plist');
  const iosEnglishInfo = readRepoFile('apps/mobile/ios/en.lproj/InfoPlist.strings');
  const iosChineseInfo = readRepoFile('apps/mobile/ios/zh-Hans.lproj/InfoPlist.strings');
  const iosAppDelegate = readRepoFile('apps/mobile/ios/LynavoDrive/AppDelegate.swift');
  const iosProject = readRepoFile(
    'apps/mobile/ios/LynavoDrive.xcodeproj/project.pbxproj',
  );
  const iosScheme = readRepoFile(
    'apps/mobile/ios/LynavoDrive.xcodeproj/xcshareddata/xcschemes/LynavoDrive.xcscheme',
  );

  assert.equal(desktopPackage.productName, appName);
  assert.match(desktopBuilder, new RegExp(`^productName: ${appName}$`, 'm'));
  assert.match(desktopIndex, new RegExp(`<title>${appName}</title>`));
  assert.match(desktopProduct, new RegExp(`PRODUCT_NAME = '${appName}'`));
  assert.deepEqual(mobileApp, { name: appName, displayName: appName });
  assert.match(mobileConfig, new RegExp(`productName: '${appName}'`));
  assert.match(androidSettings, new RegExp(`rootProject\\.name = "${appName}"`));
  assert.match(androidStrings, new RegExp(`<string name="app_name">${appName}</string>`));
  assert.match(iosInfo, new RegExp(`<string>${appName}</string>`, 'g'));
  assert.match(iosEnglishInfo, new RegExp(`"CFBundleDisplayName" = "${appName}"`));
  assert.match(iosEnglishInfo, new RegExp(`"CFBundleName" = "${appName}"`));
  assert.match(iosChineseInfo, new RegExp(`"CFBundleDisplayName" = "${appName}"`));
  assert.match(iosChineseInfo, new RegExp(`"CFBundleName" = "${appName}"`));
  assert.doesNotMatch(iosInfo, /Lynavo Drive/);
  assert.doesNotMatch(iosEnglishInfo, /Lynavo Drive/);
  assert.doesNotMatch(iosChineseInfo, /Lynavo Drive/);
  assert.match(iosAppDelegate, new RegExp(`withModuleName: "${appName}"`));
  assert.match(iosProject, new RegExp(`productName = ${appName};`));
  assert.match(iosProject, new RegExp(`PRODUCT_NAME = ${appName};`, 'g'));
  assert.match(iosScheme, new RegExp(`BuildableName = "${appName}\\.app"`, 'g'));
});
