import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../../..');
const removedBuilderConfigName = (name) => `electron-builder.${name}.yml`;
const legacyViviName = ['Vivi', 'Drop'].join(' ');
const legacyViviSlug = ['Vivi', 'Drop'].join('');
const legacyFormerFlowName = ['Sync', 'Flow'].join('');
const legacyViviDomain = ['vivi', 'drop'].join('');
const legacySidecarBin = ['sync', 'flow', '-sidecar'].join('');

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
    resolve(repoRoot, 'apps/mobile/ios/LynavoDrive.xcodeproj/project.pbxproj'),
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
  assert.equal(packageJson.lynavoDriveBuildNumber, mobileVersion.buildNumber);
});

test('android package version and build number resolve from the mobile iOS release train', () => {
  const buildGradle = readAndroidBuildGradle();

  assert.match(
    buildGradle,
    /file\("\.\.\/\.\.\/ios\/LynavoDrive\.xcodeproj\/project\.pbxproj"\)/,
  );
  assert.match(buildGradle, /versionCode\s+resolveIosBuildNumber\(\)\.toInteger\(\)/);
  assert.match(buildGradle, /versionName\s+resolveIosMarketingVersion\(\)/);
  assert.doesNotMatch(buildGradle, /^\s*versionCode\s+\d+$/m);
  assert.doesNotMatch(buildGradle, /^\s*versionName\s+"[^"]+"$/m);
});

test('desktop uses a single builder config with bundle build version from mobile iOS', () => {
  const mobileVersion = readMobileIosVersions();
  const config = readDesktopConfig('electron-builder.yml');

  assert.match(
    config,
    new RegExp(`^buildVersion: ['"]${mobileVersion.buildNumber}['"]$`, 'm'),
  );
  assert.equal(
    existsSync(resolve(repoRoot, 'apps/desktop', removedBuilderConfigName('cn'))),
    false,
  );
  assert.equal(
    existsSync(resolve(repoRoot, 'apps/desktop', removedBuilderConfigName('global'))),
    false,
  );
});

test('desktop builder config uses Lynavo Drive for package branding and public app identity', () => {
  const config = readDesktopConfig('electron-builder.yml');
  const macConfig = readTopLevelSection(config, 'mac');
  const winConfig = readTopLevelSection(config, 'win');
  const linuxConfig = readTopLevelSection(config, 'linux');
  const nsisConfig = readTopLevelSection(config, 'nsis');

  assert.match(config, /^appId: com\.lynavo\.drive\.desktop$/m);
  assert.match(config, /^productName: Lynavo Drive$/m);
  assert.match(macConfig, /^  artifactName: LynavoDrive-\$\{version\}-\$\{arch\}\.\$\{ext\}$/m);
  assert.match(winConfig, /^  artifactName: LynavoDrive-\$\{version\}-\$\{arch\}\.\$\{ext\}$/m);
  assert.match(winConfig, /^  executableName: Lynavo Drive$/m);
  assert.match(
    linuxConfig,
    /^  artifactName: LynavoDrive-\$\{version\}-linux-\$\{arch\}\.\$\{ext\}$/m,
  );
  assert.match(linuxConfig, /^  executableName: lynavo-drive$/m);
  assert.match(nsisConfig, /^  shortcutName: Lynavo Drive$/m);
  assert.doesNotMatch(config, new RegExp(`^productName: ${legacyFormerFlowName}$`, 'm'));
  assert.doesNotMatch(config, new RegExp(`^  artifactName: ${legacyFormerFlowName}-`, 'm'));
  assert.doesNotMatch(config, new RegExp(`^productName: ${legacyViviName}$`, 'm'));
  assert.doesNotMatch(config, new RegExp(`^  artifactName: ${legacyViviSlug}-`, 'm'));
  assert.doesNotMatch(config, new RegExp(`^appId: com\\.${legacyViviDomain}\\.desktop\\.china$`, 'm'));
  assert.doesNotMatch(config, new RegExp(`^  executableName: ${legacyViviName}$`, 'm'));
  assert.doesNotMatch(config, /^  executableName: vivi-drop$/m);
});

test('macOS permission descriptions use Lynavo Drive as the visible app name', () => {
  const config = readDesktopConfig('electron-builder.yml');

  assert.match(config, /NSDesktopFolderUsageDescription: Lynavo Drive /);
  assert.match(config, /NSDocumentsFolderUsageDescription: Lynavo Drive /);
  assert.match(config, /NSDownloadsFolderUsageDescription: Lynavo Drive /);
  assert.doesNotMatch(config, new RegExp(`NS\\w+UsageDescription: ${legacyViviName} `));
});

test('windows installer uses Lynavo Drive firewall identities scoped to the sidecar binary', () => {
  const installer = readDesktopConfig('resources/installer.nsh');

  assert.match(installer, /!define SF_RULE_TCP\s+"Lynavo Drive Sidecar TCP"/);
  assert.match(installer, /!define SF_RULE_HTTP\s+"Lynavo Drive Sidecar HTTP"/);
  assert.match(installer, /!define SF_RULE_MDNS\s+"Lynavo Drive mDNS UDP"/);
  assert.match(installer, /Configuring Windows Firewall rules for Lynavo Drive/);
  assert.match(installer, /description="Lynavo Drive sidecar file transfer \(TCP 39393\)"/);
  assert.match(installer, /description="Lynavo Drive sidecar HTTP health and API \(TCP 39394\)"/);
  assert.match(installer, /description="Lynavo Drive Bonjour\/mDNS discovery \(UDP 5353\)"/);
  assert.doesNotMatch(installer, new RegExp(`add rule name="${legacyFormerFlowName}`));
  assert.doesNotMatch(installer, new RegExp(`description="${legacyFormerFlowName}`));
  assert.doesNotMatch(installer, new RegExp(`DetailPrint ".*${legacyFormerFlowName}`));
  assert.doesNotMatch(installer, new RegExp(`${legacyViviName} Sidecar`));
  assert.doesNotMatch(installer, new RegExp(`${legacyViviName} mDNS`));
  assert.match(installer, /resources\\lynavo-drive-sidecar\.exe/);
  assert.doesNotMatch(installer, new RegExp(`resources\\\\${legacySidecarBin}\\.exe`));
});

test('windows installer no longer deletes legacy firewall rules during upgrade', () => {
  const installer = readDesktopConfig('resources/installer.nsh');

  assert.doesNotMatch(installer, /SF_LEGACY_/);
  assert.doesNotMatch(installer, /delete rule name="\$\{SF_LEGACY_/);
});

test('Windows release and beta docs match Lynavo Drive firewall rule identities', () => {
  const expectedRules = [
    'Lynavo Drive Sidecar TCP',
    'Lynavo Drive Sidecar HTTP',
    'Lynavo Drive mDNS UDP',
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
    assert.doesNotMatch(doc, new RegExp(`${legacyViviName} Sidecar`));
    assert.doesNotMatch(doc, new RegExp(`${legacyViviName} mDNS UDP`));
  }
});

test('release docs verify the renamed packaged sidecar binary paths', () => {
  const releasePlaybook = readFileSync(
    resolve(repoRoot, 'docs/release/release-playbook.md'),
    'utf8',
  );
  const macBuild = readFileSync(
    resolve(repoRoot, 'docs/release/macos-desktop-build.md'),
    'utf8',
  );

  assert.match(releasePlaybook, /resources\\lynavo-drive-sidecar\.exe/);
  assert.doesNotMatch(releasePlaybook, new RegExp(`resources\\\\${legacySidecarBin}\\.exe`));
  assert.match(macBuild, /Contents\/Resources\/lynavo-drive-sidecar/);
  assert.doesNotMatch(macBuild, new RegExp(`Contents/Resources/${legacySidecarBin}`));
});

test('iOS build docs do not expose external beta upload steps', () => {
  const doc = readFileSync(resolve(repoRoot, 'docs/release/ios-build.md'), 'utf8');
  const archiveUploadTerm = ['archive', '-upload'].join('');
  const appleUploadToolTerm = ['not', 'arytool'].join('');

  assert.match(doc, /build:mobile:ios:release/);
  assert.match(doc, /CODE_SIGNING_ALLOWED=NO/);
  assert.equal(doc.includes(archiveUploadTerm), false);
  assert.equal(doc.includes('xcrun altool'), false);
  assert.equal(doc.includes(appleUploadToolTerm), false);
  assert.doesNotMatch(doc, /native identity \/ bundle id migration is deferred/i);
});

test('desktop builder config defines Linux deb packaging', () => {
  const linuxConfig = readTopLevelSection(readDesktopConfig('electron-builder.yml'), 'linux');

  assert.match(linuxConfig, /^linux:$/m);
  assert.match(
    linuxConfig,
    /^  artifactName: LynavoDrive-\$\{version\}-linux-\$\{arch\}\.\$\{ext\}$/m,
  );
  assert.match(linuxConfig, /^  executableName: lynavo-drive$/m);
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
  assert.doesNotMatch(config, new RegExp(`${legacySidecarBin}\\.exe`));
});
