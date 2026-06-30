import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../../..');
const removedBuilderConfigName = (name) => `electron-builder.${name}.yml`;
const legacyViviName = ['Vivi', 'Drop'].join(' ');
const legacyViviSlug = ['Vivi', 'Drop'].join('');
const legacySyncFlowName = ['Sync', 'Flow'].join('');

function readDesktopConfig(name) {
  return readFileSync(resolve(repoRoot, 'apps/desktop', name), 'utf8');
}

function readDesktopPackageJson() {
  return JSON.parse(readDesktopConfig('package.json'));
}

function readAndroidBuildGradle() {
  return readFileSync(resolve(repoRoot, 'apps/mobile/android/app/build.gradle'), 'utf8');
}

function readMobileIosVersions() {
  const project = readFileSync(
    resolve(repoRoot, 'apps/mobile/ios/SyncFlowMobile.xcodeproj/project.pbxproj'),
    'utf8',
  );
  const marketingVersions = new Set(
    Array.from(project.matchAll(/MARKETING_VERSION = ([^;]+);/g), (match) => match[1]),
  );
  const buildNumbers = new Set(
    Array.from(project.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g), (match) => match[1]),
  );

  assert.equal(marketingVersions.size, 1);
  assert.equal(buildNumbers.size, 1);

  return {
    version: [...marketingVersions][0],
    buildNumber: [...buildNumbers][0],
  };
}

function readTopLevelSection(config, sectionName) {
  const startMarker = `${sectionName}:`;
  const startIndex = config.indexOf(startMarker);

  if (startIndex === -1) {
    return '';
  }

  const rest = config.slice(startIndex);
  const nextSectionMatch = rest.slice(startMarker.length).match(/\n[a-z][\w-]*:/);

  if (nextSectionMatch?.index === undefined) {
    return rest;
  }

  return rest.slice(0, startMarker.length + nextSectionMatch.index);
}

test('desktop app package metadata satisfies Linux deb packaging', () => {
  const packageJson = readDesktopPackageJson();

  assert.equal(packageJson.productName, 'Lynavo Drive');
  assert.equal(packageJson.description, 'Lynavo Drive desktop app for local mobile media sync.');
  assert.equal(packageJson.homepage, 'https://www.lynavo.com');
  assert.deepEqual(packageJson.author, {
    name: 'Lynavo',
    email: 'support@lynavo.com',
  });
});

test('desktop package version and build number match the mobile iOS release train', () => {
  const packageJson = readDesktopPackageJson();
  const mobileVersion = readMobileIosVersions();

  assert.equal(packageJson.version, mobileVersion.version);
  assert.equal(packageJson.syncflowBuildNumber, mobileVersion.buildNumber);
});

test('android package version and build number resolve from the mobile iOS release train', () => {
  const buildGradle = readAndroidBuildGradle();

  assert.match(
    buildGradle,
    /file\("\.\.\/\.\.\/ios\/SyncFlowMobile\.xcodeproj\/project\.pbxproj"\)/,
  );
  assert.match(buildGradle, /versionCode\s+resolveIosBuildNumber\(\)\.toInteger\(\)/);
  assert.match(buildGradle, /versionName\s+resolveIosMarketingVersion\(\)/);
  assert.doesNotMatch(buildGradle, /^\s*versionCode\s+\d+$/m);
  assert.doesNotMatch(buildGradle, /^\s*versionName\s+"[^"]+"$/m);
});

test('desktop uses a single builder config with bundle build version from mobile iOS', () => {
  const mobileVersion = readMobileIosVersions();
  const config = readDesktopConfig('electron-builder.yml');

  assert.match(config, new RegExp(`^buildVersion: "${mobileVersion.buildNumber}"$`, 'm'));
  assert.equal(
    existsSync(resolve(repoRoot, 'apps/desktop', removedBuilderConfigName('cn'))),
    false,
  );
  assert.equal(
    existsSync(resolve(repoRoot, 'apps/desktop', removedBuilderConfigName('global'))),
    false,
  );
});

test('desktop builder config uses Lynavo Drive for visible package branding without identity migration', () => {
  const config = readDesktopConfig('electron-builder.yml');
  const macConfig = readTopLevelSection(config, 'mac');
  const winConfig = readTopLevelSection(config, 'win');
  const linuxConfig = readTopLevelSection(config, 'linux');
  const nsisConfig = readTopLevelSection(config, 'nsis');

  assert.match(config, /^appId: com\.vividrop\.desktop\.china$/m);
  assert.match(config, /^productName: Lynavo Drive$/m);
  assert.match(macConfig, /^  artifactName: LynavoDrive-\$\{version\}-\$\{arch\}\.\$\{ext\}$/m);
  assert.match(winConfig, /^  artifactName: LynavoDrive-\$\{version\}-\$\{arch\}\.\$\{ext\}$/m);
  assert.match(winConfig, /^  executableName: Vivi Drop$/m);
  assert.match(
    linuxConfig,
    /^  artifactName: LynavoDrive-\$\{version\}-linux-\$\{arch\}\.\$\{ext\}$/m,
  );
  assert.match(linuxConfig, /^  executableName: vivi-drop$/m);
  assert.match(nsisConfig, /^  shortcutName: Lynavo Drive$/m);
  assert.doesNotMatch(config, new RegExp(`^productName: ${legacySyncFlowName}$`, 'm'));
  assert.doesNotMatch(config, new RegExp(`^  artifactName: ${legacySyncFlowName}-`, 'm'));
  assert.doesNotMatch(config, /^productName: Vivi Drop$/m);
  assert.doesNotMatch(config, /^  artifactName: ViviDrop-/m);
});

test('macOS permission descriptions use Lynavo Drive as the visible app name', () => {
  const config = readDesktopConfig('electron-builder.yml');

  assert.match(config, /NSDesktopFolderUsageDescription: Lynavo Drive /);
  assert.match(config, /NSDocumentsFolderUsageDescription: Lynavo Drive /);
  assert.match(config, /NSDownloadsFolderUsageDescription: Lynavo Drive /);
  assert.doesNotMatch(config, new RegExp(`NS\\w+UsageDescription: ${legacyViviName} `));
});

test('windows installer keeps existing Vivi Drop firewall identities while scoping to renamed sidecar binary', () => {
  const installer = readDesktopConfig('resources/installer.nsh');

  assert.match(installer, new RegExp(`!define SF_RULE_TCP\\s+"${legacyViviName} Sidecar TCP"`));
  assert.match(installer, new RegExp(`!define SF_RULE_HTTP\\s+"${legacyViviName} Sidecar HTTP"`));
  assert.match(installer, new RegExp(`!define SF_RULE_MDNS\\s+"${legacyViviName} mDNS UDP"`));
  assert.match(installer, /Configuring Windows Firewall rules for Vivi Drop/);
  assert.match(installer, /description="Vivi Drop sidecar file transfer \(TCP 39393\)"/);
  assert.match(installer, /description="Vivi Drop sidecar HTTP health and API \(TCP 39394\)"/);
  assert.match(installer, /description="Vivi Drop Bonjour\/mDNS discovery \(UDP 5353\)"/);
  assert.doesNotMatch(installer, /Lynavo Drive Sidecar/);
  assert.doesNotMatch(installer, /Lynavo Drive mDNS/);
  assert.doesNotMatch(installer, new RegExp(`add rule name="${legacySyncFlowName}`));
  assert.doesNotMatch(installer, new RegExp(`description="${legacySyncFlowName}`));
  assert.doesNotMatch(installer, new RegExp(`DetailPrint ".*${legacySyncFlowName}`));
  assert.match(installer, /resources\\lynavo-drive-sidecar\.exe/);
  assert.doesNotMatch(installer, /resources\\syncflow-sidecar\.exe/);
});

test('windows installer does not delete existing Vivi Drop firewall rules during upgrade', () => {
  const installer = readDesktopConfig('resources/installer.nsh');

  assert.match(
    installer,
    new RegExp(`!define SF_LEGACY_SYNCFLOW_RULE_TCP\\s+"${legacySyncFlowName} Sidecar TCP"`),
  );
  assert.match(
    installer,
    new RegExp(`!define SF_LEGACY_SYNCFLOW_RULE_HTTP\\s+"${legacySyncFlowName} Sidecar HTTP"`),
  );
  assert.match(
    installer,
    new RegExp(`!define SF_LEGACY_SYNCFLOW_RULE_MDNS\\s+"${legacySyncFlowName} mDNS UDP"`),
  );
  assert.match(installer, /delete rule name="\$\{SF_LEGACY_SYNCFLOW_RULE_TCP\}"/);
  assert.match(installer, /delete rule name="\$\{SF_LEGACY_SYNCFLOW_RULE_HTTP\}"/);
  assert.match(installer, /delete rule name="\$\{SF_LEGACY_SYNCFLOW_RULE_MDNS\}"/);
  assert.doesNotMatch(installer, /SF_LEGACY_VIVI_RULE_/);
  assert.doesNotMatch(installer, /delete rule name="\$\{SF_LEGACY_VIVI_RULE_/);
});

test('Windows release and beta docs match preserved firewall rule identities', () => {
  const expectedRules = [
    `${legacyViviName} Sidecar TCP`,
    `${legacyViviName} Sidecar HTTP`,
    `${legacyViviName} mDNS UDP`,
  ];
  const releasePlaybook = readFileSync(
    resolve(repoRoot, 'docs/release/release-playbook.md'),
    'utf8',
  );
  const betaMatrix = readFileSync(resolve(repoRoot, 'docs/testing/beta-test-matrix.md'), 'utf8');

  for (const doc of [releasePlaybook, betaMatrix]) {
    for (const rule of expectedRules) {
      assert.match(doc, new RegExp(rule));
    }
    assert.doesNotMatch(doc, /Lynavo Drive Sidecar/);
    assert.doesNotMatch(doc, /Lynavo Drive mDNS UDP/);
    assert.match(doc, /native\/binary\/mDNS migration/i);
  }
});

test('release docs verify the renamed packaged sidecar binary paths', () => {
  const releasePlaybook = readFileSync(
    resolve(repoRoot, 'docs/release/release-playbook.md'),
    'utf8',
  );
  const macSigning = readFileSync(
    resolve(repoRoot, 'docs/release/macos-desktop-signing.md'),
    'utf8',
  );

  assert.match(releasePlaybook, /resources\\lynavo-drive-sidecar\.exe/);
  assert.doesNotMatch(releasePlaybook, /resources\\syncflow-sidecar\.exe/);
  assert.match(macSigning, /Contents\/Resources\/lynavo-drive-sidecar/);
  assert.doesNotMatch(macSigning, /Contents\/Resources\/syncflow-sidecar/);
});

test('iOS TestFlight docs defer native bundle id migration', () => {
  const doc = readFileSync(resolve(repoRoot, 'docs/release/ios-testflight.md'), 'utf8');

  assert.doesNotMatch(doc, /com\.lynavo\.drive\.mobile/);
  assert.match(doc, /native identity \/ bundle id migration is deferred/i);
});

test('desktop builder config defines Linux deb packaging', () => {
  const linuxConfig = readTopLevelSection(readDesktopConfig('electron-builder.yml'), 'linux');

  assert.match(linuxConfig, /^linux:$/m);
  assert.match(
    linuxConfig,
    /^  artifactName: LynavoDrive-\$\{version\}-linux-\$\{arch\}\.\$\{ext\}$/m,
  );
  assert.match(linuxConfig, /^  executableName: vivi-drop$/m);
  assert.match(linuxConfig, /^  category: Utility$/m);
  assert.match(linuxConfig, /^  icon: resources\/icon-1024\.png$/m);
  assert.match(linuxConfig, /^    - target: deb$/m);
  assert.match(linuxConfig, /^        - x64$/m);
  assert.match(linuxConfig, /^        - arm64$/m);
  assert.match(linuxConfig, /^    - from: resources\/lynavo-drive-sidecar$/m);
  assert.match(linuxConfig, /^      to: lynavo-drive-sidecar$/m);
});

test('desktop packaging uses the Lynavo Drive sidecar binary name', () => {
  const config = readDesktopConfig('electron-builder.yml');
  const packageJson = readDesktopConfig('package.json');

  assert.match(config, /Contents\/Resources\/lynavo-drive-sidecar/);
  assert.match(config, /resources\/lynavo-drive-sidecar/);
  assert.match(config, /lynavo-drive-sidecar\.exe/);
  assert.match(packageJson, /lynavo-drive-sidecar/);
  assert.doesNotMatch(config, /syncflow-sidecar\.exe/);
});
