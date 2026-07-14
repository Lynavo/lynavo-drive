import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = new URL('../../..', import.meta.url);
const cnMarketValue = ['c', 'n'].join('');
const cnRuntimeEndpoint = ['https://api.vividrop', '.cn'].join('');

function runVerifier(args) {
  return spawnSync(process.execPath, ['scripts/verify-oss-source-package.mjs', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function writeFixture(root, path, content = 'fixture\n') {
  const fullPath = join(root, ...path.split('/'));
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content);
}

function createTrackedFixture(files) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'oss-source-package-'));
  git(fixtureRoot, ['init', '-q']);
  const excludesFile = join(fixtureRoot, '.git', 'empty-excludes');
  writeFileSync(excludesFile, '');
  git(fixtureRoot, ['config', 'core.excludesFile', excludesFile]);
  for (const [path, content] of Object.entries(files)) {
    writeFixture(fixtureRoot, path, content);
  }
  git(fixtureRoot, ['add', '-A']);
  return fixtureRoot;
}

function createFilesystemFixture(files) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'oss-source-package-'));
  for (const [path, content] of Object.entries(files)) {
    writeFixture(fixtureRoot, path, content);
  }
  return fixtureRoot;
}

test('blocks tracked package artifacts and signing material by default', () => {
  const fixtureRoot = createTrackedFixture({
    'apps/desktop/release/LynavoDrive.dmg': 'binary\n',
    'apps/desktop/resources/embedded.provisionprofile': 'profile\n',
    'apps/desktop/resources/lynavo-drive-sidecar': 'mach-o\n',
    'apps/mobile/android/app/debug.keystore': 'keystore\n',
    'apps/mobile/android/app/release.keystore': 'keystore\n',
    'apps/mobile/ios/GoogleService-Info.plist': '<plist />\n',
    '.env.prod': 'TOKEN=secret\n',
    'AuthKey_Lynavo_ABC123.p8': 'key\n',
  });
  try {
    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Disallowed OSS source package files: 8/);
    assert.match(result.stdout, /apps\/desktop\/release\/LynavoDrive\.dmg/);
    assert.match(result.stdout, /apps\/desktop\/resources\/embedded\.provisionprofile/);
    assert.match(result.stdout, /apps\/desktop\/resources\/lynavo-drive-sidecar/);
    assert.match(result.stdout, /apps\/mobile\/android\/app\/debug\.keystore/);
    assert.match(result.stdout, /apps\/mobile\/android\/app\/release\.keystore/);
    assert.match(result.stdout, /apps\/mobile\/ios\/GoogleService-Info\.plist/);
    assert.match(result.stdout, /\.env\.prod/);
    assert.match(result.stdout, /AuthKey_Lynavo_ABC123\.p8/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('keeps source package findings advisory when requested', () => {
  const fixtureRoot = createTrackedFixture({
    'services/sidecar-go/sidecar.db': 'sqlite\n',
  });
  try {
    const result = runVerifier(['--root', fixtureRoot, '--advisory']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Disallowed OSS source package files: 1/);
    assert.match(result.stdout, /Disallowed files \(advisory\):/);
    assert.match(result.stdout, /services\/sidecar-go\/sidecar\.db/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('audits only tracked source-package files', () => {
  const fixtureRoot = createTrackedFixture({
    'apps/mobile/src/App.tsx': 'export const App = () => null;\n',
  });
  try {
    writeFixture(fixtureRoot, '.env.local', 'TOKEN=secret\n');
    writeFixture(fixtureRoot, 'apps/desktop/release/untracked.dmg', 'binary\n');

    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Audited OSS source package files: 1/);
    assert.match(result.stdout, /Disallowed OSS source package files: 0/);
    assert.doesNotMatch(result.stdout, /\.env\.local/);
    assert.doesNotMatch(result.stdout, /untracked\.dmg/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('audits non-ignored untracked worktree files when requested', () => {
  const fixtureRoot = createTrackedFixture({
    'apps/mobile/src/App.tsx': 'export const App = () => null;\n',
    '.gitignore': ['.env.local', 'apps/desktop/release/'].join('\n'),
  });
  try {
    writeFixture(fixtureRoot, 'apps/mobile/src/Untracked.tsx', 'export const Untracked = true;\n');
    writeFixture(fixtureRoot, '.env.local', 'TOKEN=secret\n');
    writeFixture(fixtureRoot, 'apps/desktop/release/untracked.dmg', 'binary\n');
    writeFixture(fixtureRoot, 'apps/mobile/ios/GoogleService-Info.plist', '<plist />\n');

    const result = runVerifier(['--root', fixtureRoot, '--include-untracked']);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Audited OSS source package files: 4/);
    assert.match(result.stdout, /Disallowed OSS source package files: 1/);
    assert.match(result.stdout, /apps\/mobile\/ios\/GoogleService-Info\.plist/);
    assert.doesNotMatch(result.stdout, /\.env\.local/);
    assert.doesNotMatch(result.stdout, /untracked\.dmg/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('audits deleted tracked source-package files when untracked worktree files are requested', () => {
  const fixtureRoot = createTrackedFixture({
    'apps/desktop/resources/dns-sd.exe': 'binary\n',
    'apps/mobile/src/App.tsx': 'export const App = () => null;\n',
    'scripts/release/release-profiles.mjs': `export const market = '${cnMarketValue}';\n`,
  });
  try {
    rmSync(join(fixtureRoot, 'apps', 'desktop', 'resources', 'dns-sd.exe'), { force: true });
    rmSync(join(fixtureRoot, 'scripts', 'release', 'release-profiles.mjs'), { force: true });

    const result = runVerifier(['--root', fixtureRoot, '--include-untracked']);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Audited OSS source package files: 3/);
    assert.match(result.stdout, /Disallowed OSS source package files: 1/);
    assert.match(result.stdout, /apps\/desktop\/resources\/dns-sd\.exe/);
    assert.doesNotMatch(result.stdout, /release-profiles\.mjs/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('ignores tracked files deleted from the working tree before staging', () => {
  const fixtureRoot = createTrackedFixture({
    'docs/source-plan.md': 'plan\n',
  });
  try {
    rmSync(join(fixtureRoot, 'docs', 'source-plan.md'), { force: true });

    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Audited OSS source package files: 0/);
    assert.match(result.stdout, /Disallowed OSS source package files: 0/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('audits a committed git tree when a git ref is requested', () => {
  const fixtureRoot = createTrackedFixture({
    'apps/desktop/release/LynavoDrive.dmg': 'binary\n',
  });
  try {
    git(fixtureRoot, [
      '-c',
      'user.email=oss-source-test@example.invalid',
      '-c',
      'user.name=OSS Source Test',
      'commit',
      '-qm',
      'fixture',
    ]);
    rmSync(join(fixtureRoot, 'apps', 'desktop', 'release', 'LynavoDrive.dmg'), {
      force: true,
    });

    const result = runVerifier(['--root', fixtureRoot, '--git-ref', 'HEAD']);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /OSS source package input: git tree HEAD/);
    assert.match(result.stdout, /Audited OSS source package files: 1/);
    assert.match(result.stdout, /apps\/desktop\/release\/LynavoDrive\.dmg/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('audits content from the requested git tree instead of the worktree', () => {
  const fixtureRoot = createTrackedFixture({
    'configs/release profile [legacy].mjs': `export const market = '${cnMarketValue}';\n`,
    'apps/mobile/src/config/runtime endpoint.ts':
      `export const apiBaseUrl = '${cnRuntimeEndpoint}';\n`,
  });
  try {
    git(fixtureRoot, [
      '-c',
      'user.email=oss-source-test@example.invalid',
      '-c',
      'user.name=OSS Source Test',
      'commit',
      '-qm',
      'fixture',
    ]);
    writeFixture(
      fixtureRoot,
      'configs/release profile [legacy].mjs',
      "export const market = 'global';\n",
    );
    rmSync(join(fixtureRoot, 'apps', 'mobile', 'src', 'config', 'runtime endpoint.ts'), {
      force: true,
    });

    const result = runVerifier(['--root', fixtureRoot, '--git-ref', 'HEAD']);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Audited OSS source package files: 2/);
    assert.match(result.stdout, /Disallowed OSS source package files: 2/);
    assert.match(result.stdout, /configs\/release profile \[legacy\]\.mjs/);
    assert.match(result.stdout, /apps\/mobile\/src\/config\/runtime endpoint\.ts/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('allows normal source files and exact source-build exceptions', () => {
  const fixtureRoot = createTrackedFixture({
    'apps/mobile/src/App.tsx': 'export const App = () => null;\n',
    'packages/contracts/src/index.ts': 'export const ok = true;\n',
    'apps/mobile/android/gradle/wrapper/gradle-wrapper.jar': 'jar\n',
    'apps/mobile/scripts/resources/mobile-i18n.xlsx': 'xlsx\n',
  });
  try {
    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Audited OSS source package files: 4/);
    assert.match(result.stdout, /Allowed OSS source package exceptions: 2/);
    assert.match(result.stdout, /Disallowed OSS source package files: 0/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('blocks unallowlisted binary source-package artifacts', () => {
  const fixtureRoot = createTrackedFixture({
    'apps/desktop/native-addon.node': 'native\n',
    'apps/mobile/android/libs/feature.aar': 'aar\n',
    'apps/mobile/scripts/input.xlsx': 'xlsx\n',
    'services/sidecar-go/plugin.wasm': 'wasm\n',
  });
  try {
    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Disallowed OSS source package files: 4/);
    assert.match(result.stdout, /apps\/desktop\/native-addon\.node/);
    assert.match(result.stdout, /apps\/mobile\/android\/libs\/feature\.aar/);
    assert.match(result.stdout, /apps\/mobile\/scripts\/input\.xlsx/);
    assert.match(result.stdout, /services\/sidecar-go\/plugin\.wasm/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('blocks npmrc mirrors, registries, proxies, certificates, and auth config', () => {
  const fixtureRoot = createTrackedFixture({
    '.npmrc': [
      'shamefully-hoist=false',
      'ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"',
    ].join('\n'),
  });
  try {
    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Disallowed OSS source package files: 1/);
    assert.match(result.stdout, /\.npmrc/);
    assert.match(result.stdout, /registry, mirror, proxy, certificate, or auth configuration/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('blocks tracked CN market source and build residue without broad CN string matching', () => {
  const cnImplementation = [cnMarketValue, 'Implementation'].join('');
  const fixtureRoot = createTrackedFixture({
    'apps/mobile/android/app/src/cn/AndroidManifest.xml': '<manifest />\n',
    'apps/mobile/ios/LynavoDrive.xcodeproj/xcshareddata/xcschemes/LynavoDriveCN.xcscheme':
      '<Scheme />\n',
    'apps/desktop/electron-builder.cn.yml': 'productName: Lynavo Drive\n',
    'apps/desktop/electron-builder.cn.yaml': 'productName: Lynavo Drive\n',
    'scripts/release/release-profiles.mjs': `export const review = { market: '${cnMarketValue}' };\n`,
    'apps/mobile/config/release.json': `${JSON.stringify({ profile: cnMarketValue })}\n`,
    'apps/mobile/config/runtime.yml': `region: ${cnMarketValue}\n`,
    'apps/mobile/config/channel.json': `${JSON.stringify({ channel: cnMarketValue })}\n`,
    'apps/mobile/config/variant.yml': `variant: ${cnMarketValue}\n`,
    'apps/mobile/config/flavor.ts': `export const flavor = '${cnMarketValue}';\n`,
    'apps/mobile/android/app/build.gradle': `android {
  flavorDimensions "market"
  productFlavors {
    ${cnMarketValue} { dimension "market" }
  }
}
dependencies {
  ${cnImplementation} "com.alipay.sdk:alipaysdk-android:15.8.41"
  ${cnImplementation} "com.tencent.mm.opensdk:wechat-sdk-android:6.8.34"
}\n`,
    'apps/mobile/android/app/src/global/java/com/lynavo/drive/mobile/china/payments/NativeMainlandPaymentModule.kt':
      'class NativeMainlandPaymentModule\n',
    'apps/mobile/src/markets/cn/config.ts': 'export const enabled = true;\n',
    'apps/mobile/src/services/mainland-payment-service.ts': 'export const pay = () => null;\n',
    'apps/mobile/src/i18n/locales/zh-Hans/common.json': `${JSON.stringify({
      region: cnMarketValue.toUpperCase(),
    })}\n`,
    'apps/desktop/src/renderer/lib/styles.ts': "export const className = cn('grid', 'gap-2');\n",
    'apps/mobile/ios/LynavoDrive.xcodeproj/xcshareddata/xcschemes/LynavoDriveGlobal.xcscheme':
      '<Scheme />\n',
    'apps/mobile/src/theme/globalColors.ts': 'export const colors = {};\n',
    'apps/mobile/src/assets/onboarding/global/sync-activity-panel.png': 'image\n',
  });
  try {
    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Audited OSS source package files: 19/);
    assert.match(result.stdout, /Disallowed OSS source package files: 17/);
    assert.match(result.stdout, /apps\/mobile\/android\/app\/src\/cn\/AndroidManifest\.xml/);
    assert.match(result.stdout, /LynavoDriveCN\.xcscheme/);
    assert.match(result.stdout, /apps\/desktop\/electron-builder\.cn\.yml/);
    assert.match(result.stdout, /apps\/desktop\/electron-builder\.cn\.yaml/);
    assert.match(result.stdout, /scripts\/release\/release-profiles\.mjs/);
    assert.match(result.stdout, /apps\/mobile\/config\/release\.json/);
    assert.match(result.stdout, /apps\/mobile\/config\/runtime\.yml/);
    assert.match(result.stdout, /apps\/mobile\/config\/channel\.json/);
    assert.match(result.stdout, /apps\/mobile\/config\/variant\.yml/);
    assert.match(result.stdout, /apps\/mobile\/config\/flavor\.ts/);
    assert.match(result.stdout, /apps\/mobile\/android\/app\/build\.gradle/);
    assert.match(result.stdout, /NativeMainlandPaymentModule\.kt/);
    assert.match(result.stdout, /apps\/mobile\/src\/markets\/cn\/config\.ts/);
    assert.match(result.stdout, /apps\/mobile\/src\/services\/mainland-payment-service\.ts/);
    assert.match(result.stdout, /LynavoDriveGlobal\.xcscheme/);
    assert.match(result.stdout, /apps\/mobile\/src\/theme\/globalColors\.ts/);
    assert.match(result.stdout, /apps\/mobile\/src\/assets\/onboarding\/global/);
    assert.doesNotMatch(result.stdout, /zh-Hans\/common\.json/);
    assert.doesNotMatch(result.stdout, /renderer\/lib\/styles\.ts/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('blocks TypeScript CN market selectors with type assertions', () => {
  const fixtureRoot = createTrackedFixture({
    'apps/mobile/src/config/asserted-market.ts':
      `export const config = { market: '${cnMarketValue}' as const };\n`,
    'apps/mobile/src/config/satisfied-market.ts':
      `export const market = '${cnMarketValue}' satisfies Market;\n`,
  });
  try {
    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Audited OSS source package files: 2/);
    assert.match(result.stdout, /Disallowed OSS source package files: 2/);
    assert.match(result.stdout, /asserted-market\.ts/);
    assert.match(result.stdout, /satisfied-market\.ts/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('allows selector-like variables that use the cn helper or namespace', () => {
  const fixtureRoot = createTrackedFixture({
    'apps/desktop/src/renderer/lib/region.ts':
      `export const region = ${cnMarketValue}('grid');\n`,
    'apps/desktop/src/renderer/lib/variant.ts':
      `export const variant = ${cnMarketValue}(baseClass);\n`,
    'apps/desktop/src/renderer/lib/channel.ts':
      `export const channel = ${cnMarketValue}.channels.default;\n`,
  });
  try {
    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Audited OSS source package files: 3/);
    assert.match(result.stdout, /Disallowed OSS source package files: 0/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('blocks Android CN build-variant source sets', () => {
  const fixtureRoot = createTrackedFixture({
    'apps/mobile/android/app/src/cnDebug/kotlin/DebugOnly.kt': 'class DebugOnly\n',
    'apps/mobile/android/app/src/cnRelease/kotlin/ReleaseOnly.kt': 'class ReleaseOnly\n',
    'apps/mobile/android/app/src/cnBenchmark/kotlin/BenchmarkOnly.kt':
      'class BenchmarkOnly\n',
    'apps/mobile/android/app/src/freeCnDebug/kotlin/FreeCnDebugOnly.kt':
      'class FreeCnDebugOnly\n',
    'apps/mobile/android/app/src/testCn/kotlin/CnTest.kt': 'class CnTest\n',
    'apps/mobile/android/app/src/testCnBenchmark/kotlin/CnBenchmarkTest.kt':
      'class CnBenchmarkTest\n',
    'apps/mobile/android/app/src/testFreeCnDebug/kotlin/FreeCnDebugTest.kt':
      'class FreeCnDebugTest\n',
    'apps/mobile/android/app/src/androidTestCn/kotlin/CnInstrumentedTest.kt':
      'class CnInstrumentedTest\n',
    'apps/mobile/android/app/src/androidTestCnBenchmark/kotlin/CnBenchmarkInstrumentedTest.kt':
      'class CnBenchmarkInstrumentedTest\n',
    'apps/mobile/android/app/src/androidTestFreeCnDebug/kotlin/FreeCnDebugInstrumentedTest.kt':
      'class FreeCnDebugInstrumentedTest\n',
  });
  try {
    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Audited OSS source package files: 10/);
    assert.match(result.stdout, /Disallowed OSS source package files: 10/);
    assert.match(result.stdout, /src\/cnDebug\/kotlin\/DebugOnly\.kt/);
    assert.match(result.stdout, /src\/cnRelease\/kotlin\/ReleaseOnly\.kt/);
    assert.match(result.stdout, /src\/cnBenchmark\/kotlin\/BenchmarkOnly\.kt/);
    assert.match(result.stdout, /src\/freeCnDebug\/kotlin\/FreeCnDebugOnly\.kt/);
    assert.match(result.stdout, /src\/testCn\/kotlin\/CnTest\.kt/);
    assert.match(result.stdout, /src\/testCnBenchmark\/kotlin\/CnBenchmarkTest\.kt/);
    assert.match(result.stdout, /src\/testFreeCnDebug\/kotlin\/FreeCnDebugTest\.kt/);
    assert.match(result.stdout, /src\/androidTestCn\/kotlin\/CnInstrumentedTest\.kt/);
    assert.match(
      result.stdout,
      /src\/androidTestCnBenchmark\/kotlin\/CnBenchmarkInstrumentedTest\.kt/,
    );
    assert.match(
      result.stdout,
      /src\/androidTestFreeCnDebug\/kotlin\/FreeCnDebugInstrumentedTest\.kt/,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('blocks Kotlin DSL declarations of the Android CN product flavor', () => {
  const fixtureRoot = createTrackedFixture({
    'apps/mobile/android/app/build.gradle.kts': `android {
  productFlavors {
    create("${cnMarketValue}") { dimension = "market" }
  }
}\n`,
    'apps/mobile/android/feature/build.gradle.kts': `android {
  productFlavors {
    register("${cnMarketValue}") { dimension = "market" }
  }
}\n`,
    'apps/mobile/android/library/build.gradle.kts': `android {
  productFlavors {
    maybeCreate("${cnMarketValue}").dimension = "market"
  }
}\n`,
    'apps/mobile/android/direct-create/build.gradle.kts': `android.productFlavors.create("${cnMarketValue}") {
  dimension = "market"
}\n`,
    'apps/mobile/android/direct-register/build.gradle.kts': `android.productFlavors.register("${cnMarketValue}") {
  dimension = "market"
}\n`,
    'apps/mobile/android/direct-maybe-create/build.gradle.kts':
      `android.productFlavors.maybeCreate("${cnMarketValue}").dimension = "market"\n`,
  });
  try {
    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Audited OSS source package files: 6/);
    assert.match(result.stdout, /Disallowed OSS source package files: 6/);
    assert.match(result.stdout, /apps\/mobile\/android\/app\/build\.gradle\.kts/);
    assert.match(result.stdout, /apps\/mobile\/android\/feature\/build\.gradle\.kts/);
    assert.match(result.stdout, /apps\/mobile\/android\/library\/build\.gradle\.kts/);
    assert.match(result.stdout, /apps\/mobile\/android\/direct-create\/build\.gradle\.kts/);
    assert.match(result.stdout, /apps\/mobile\/android\/direct-register\/build\.gradle\.kts/);
    assert.match(
      result.stdout,
      /apps\/mobile\/android\/direct-maybe-create\/build\.gradle\.kts/,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('blocks remaining CN runtime configuration and mainland payment residue', () => {
  const fixtureRoot = createTrackedFixture({
    'apps/mobile/src/config/runtime.ts': `export const apiBaseUrl = '${cnRuntimeEndpoint}';\n`,
    'scripts/release/market.properties': `LYNAVO_MARKET=${cnMarketValue}\n`,
    'apps/mobile/scripts/region.sh': `SYNCFLOW_REGION=${cnMarketValue}\n`,
    'apps/mobile/ios/LynavoDrive.xcodeproj/project.pbxproj':
      `SYNCFLOW_MARKET = ${cnMarketValue};\n`,
    'apps/mobile/ios/LynavoDrive.xcodeproj/xcshareddata/xcschemes/LynavoDriveCN.xcscheme/contents.xcscheme':
      '<Scheme />\n',
    'apps/mobile/src/payments/WeChatPay.ts': 'export const pay = () => null;\n',
    'docs/runtime-endpoints.md': `Example only: ${cnRuntimeEndpoint}\n`,
    'apps/mobile/src/i18n/locales/en/runtime.json': `${JSON.stringify({
      endpointExample: cnRuntimeEndpoint,
    })}\n`,
    'apps/mobile/src/i18n/locales/zh-Hans/common.json': `${JSON.stringify({
      region: cnMarketValue.toUpperCase(),
      label: 'Simplified Chinese',
    })}\n`,
  });
  try {
    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Audited OSS source package files: 9/);
    assert.match(result.stdout, /Disallowed OSS source package files: 7/);
    assert.match(result.stdout, /apps\/mobile\/src\/config\/runtime\.ts/);
    assert.match(result.stdout, /scripts\/release\/market\.properties/);
    assert.match(result.stdout, /apps\/mobile\/scripts\/region\.sh/);
    assert.match(result.stdout, /LynavoDrive\.xcodeproj\/project\.pbxproj/);
    assert.match(result.stdout, /LynavoDriveCN\.xcscheme\/contents\.xcscheme/);
    assert.match(result.stdout, /apps\/mobile\/src\/payments\/WeChatPay\.ts/);
    assert.match(result.stdout, /i18n\/locales\/en\/runtime\.json/);
    assert.doesNotMatch(result.stdout, /docs\/runtime-endpoints\.md/);
    assert.doesNotMatch(result.stdout, /i18n\/locales\/zh-Hans\/common\.json/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('scans native source and common config files for CN residue', () => {
  const fixtureRoot = createTrackedFixture({
    'services/sidecar-go/main.go': `const apiBaseURL = "${cnRuntimeEndpoint}"\n`,
    'apps/mobile/scripts/release.py': `market = '${cnMarketValue}'\n`,
    'apps/mobile/ios/RuntimeConfig.m': `NSString *endpoint = @"${cnRuntimeEndpoint}";\n`,
    'apps/mobile/ios/RuntimeConfig.h': `static const char *market = "${cnMarketValue}";\n`,
    'services/sidecar-go/migrations/market.sql': `-- region = ${cnMarketValue}\n`,
    'services/sidecar-go/Makefile': `MARKET = ${cnMarketValue}\n`,
    'apps/mobile/ios/Podfile': `region = '${cnMarketValue}'\n`,
    'apps/mobile/Gemfile': `channel = '${cnMarketValue}'\n`,
    'config/release.ini': `profile=${cnMarketValue}\n`,
    'config/release.cfg': `variant=${cnMarketValue}\n`,
    'config/release.conf': `flavor=${cnMarketValue}\n`,
    'apps/mobile/ios/.xcode.env': `MARKET=${cnMarketValue}\n`,
    'apps/mobile/ios/Podfile.lock': `endpoint: ${cnRuntimeEndpoint}\n`,
    'services/sidecar-go/go.mod': `// region = ${cnMarketValue}\n`,
    'apps/mobile/android/app/proguard-rules.pro': `# channel = ${cnMarketValue}\n`,
    'apps/mobile/ios/LaunchScreen.storyboard': `<string value="${cnRuntimeEndpoint}" />\n`,
    'apps/desktop/dummy.txt': `profile=${cnMarketValue}\n`,
  });
  try {
    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Audited OSS source package files: 17/);
    assert.match(result.stdout, /Disallowed OSS source package files: 17/);
    assert.match(result.stdout, /services\/sidecar-go\/main\.go/);
    assert.match(result.stdout, /apps\/mobile\/scripts\/release\.py/);
    assert.match(result.stdout, /apps\/mobile\/ios\/RuntimeConfig\.m/);
    assert.match(result.stdout, /apps\/mobile\/ios\/RuntimeConfig\.h/);
    assert.match(result.stdout, /services\/sidecar-go\/migrations\/market\.sql/);
    assert.match(result.stdout, /services\/sidecar-go\/Makefile/);
    assert.match(result.stdout, /apps\/mobile\/ios\/Podfile/);
    assert.match(result.stdout, /apps\/mobile\/Gemfile/);
    assert.match(result.stdout, /config\/release\.ini/);
    assert.match(result.stdout, /config\/release\.cfg/);
    assert.match(result.stdout, /config\/release\.conf/);
    assert.match(result.stdout, /apps\/mobile\/ios\/\.xcode\.env/);
    assert.match(result.stdout, /apps\/mobile\/ios\/Podfile\.lock/);
    assert.match(result.stdout, /services\/sidecar-go\/go\.mod/);
    assert.match(result.stdout, /apps\/mobile\/android\/app\/proguard-rules\.pro/);
    assert.match(result.stdout, /apps\/mobile\/ios\/LaunchScreen\.storyboard/);
    assert.match(result.stdout, /apps\/desktop\/dummy\.txt/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('falls back to filesystem walk for extracted source archives without git metadata', () => {
  const fixtureRoot = createFilesystemFixture({
    'package.json': '{}\n',
    'apps/mobile/src/App.tsx': 'export const App = () => null;\n',
    'apps/mobile/android/gradle/wrapper/gradle-wrapper.jar': 'jar\n',
    'apps/desktop/release/LynavoDrive.dmg': 'binary\n',
    'node_modules/pkg/private.key': 'ignored dependency fixture\n',
  });
  try {
    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /OSS source package input: filesystem walk/);
    assert.match(result.stdout, /Audited OSS source package files: 4/);
    assert.match(result.stdout, /Allowed OSS source package exceptions: 1/);
    assert.match(result.stdout, /Disallowed OSS source package files: 1/);
    assert.match(result.stdout, /apps\/desktop\/release\/LynavoDrive\.dmg/);
    assert.doesNotMatch(result.stdout, /node_modules/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('blocks exact retired mobile global identifiers without broad phrase matching', () => {
  const globalHomeTab = ['Global', 'HomeTab'].join('');
  const globalDownloadHelper = ['downloadResourceFor', 'Global'].join('');
  const globalDurationHelper = ['format', 'GlobalHistoryDuration'].join('');
  const globalLocalComputerType = ['Global', 'LocalComputerResource'].join('');
  const listGlobalLocalComputer = ['list', 'GlobalLocalComputerResources'].join('');
  const downloadGlobalLocalComputer = [
    'download',
    'GlobalLocalComputerResource',
  ].join('');
  const getGlobalLocalComputer = [
    'get',
    'GlobalLocalComputerPreviewUrl',
  ].join('');
  const prepareGlobalLocalComputer = [
    'prepare',
    'GlobalLocalComputerPreview',
  ].join('');
  const shareGlobalLocalComputer = [
    'share',
    'GlobalLocalComputerResources',
  ].join('');
  const globalPreview = ['global', 'Preview'].join('');
  const globalTourImages = ['TOUR_BACKGROUND_IMAGES', 'GLOBAL'].join('_');
  const globalSyncStyle = ['global', 'SyncRecordCard'].join('');
  const globalMediaStyle = ['global', 'MediaPreviewWrap'].join('');
  const isGlobalPreview = ['is', 'GlobalPreview'].join('');
  const shouldRenderGlobalEmpty = ['shouldRender', 'GlobalEmpty'].join('');
  const globalRecentDownloadStyle = ['global', 'RecentDownloadSection'].join('');
  const globalSectionStyle = ['global', 'SectionEmptyState'].join('');
  const globalPhotoStyle = ['global', 'PhotoHillLeft'].join('');
  const globalVideoStyle = ['global', 'VideoDot'].join('');
  const globalFileStyle = ['global', 'FileCorner'].join('');
  const globalPlayStyle = ['global', 'PlayCircle'].join('');
  const globalHomeGradient = ['global', 'Home'].join('');
  const deviceDiscoveryGlobalKey = ['deviceDiscovery', 'global', 'connected'].join('.');
  const settingsGlobalKey = ['settings', 'global', 'connected'].join('.');
  const globalPersonalDirectoryKey = [
    'directory',
    'pathCard',
    'globalPersonalDirectory',
  ].join('.');
  const fixtureRoot = createTrackedFixture({
    'apps/mobile/src/navigation/RootNavigator.tsx': `const route = '${globalHomeTab}';\n`,
    'apps/mobile/src/services/desktop-local-service.ts':
      `export function ${globalDownloadHelper}() {}\n`,
    'apps/mobile/src/screens/SyncActivityScreen.tsx':
      `function ${globalDurationHelper}() {}\n`,
    'apps/mobile/src/screens/PhoneSyncSpaceScreen.tsx':
      "recordDiagnosticsLog('PhoneSyncSpace', 'global screen load start');\n",
    'apps/mobile/src/components/__tests__/ReferenceLayout.test.tsx':
      "test('matches the global reference layout', () => {});\n",
    'apps/mobile/src/i18n/locales/en/common.json': '{"label":"global screen"}\n',
    'apps/mobile/src/services/SyncEngineModule.ts':
      'export function listGlobalReceivedFiles() {}\n',
    'apps/mobile/src/stores/connection-store.ts':
      '// Aggregate the global connection state across paired desktops.\n',
    'apps/mobile/src/types/local-computer.ts':
      `export type ${globalLocalComputerType} = {};\n`,
    'apps/mobile/src/services/list-local-computer.ts':
      `export function ${listGlobalLocalComputer}() {}\n`,
    'apps/mobile/src/services/download-local-computer.ts':
      `export function ${downloadGlobalLocalComputer}() {}\n`,
    'apps/mobile/src/services/get-local-computer.ts':
      `export function ${getGlobalLocalComputer}() {}\n`,
    'apps/mobile/src/services/prepare-local-computer.ts':
      `export function ${prepareGlobalLocalComputer}() {}\n`,
    'apps/mobile/src/services/share-local-computer.ts':
      `export function ${shareGlobalLocalComputer}() {}\n`,
    'apps/mobile/src/screens/components/Preview.tsx':
      `const variant = '${globalPreview}';\n`,
    'apps/mobile/src/components/onboarding/tour-assets.ts':
      `export const ${globalTourImages} = [];\n`,
    'apps/mobile/src/screens/styles/sync.ts':
      `export const ${globalSyncStyle} = {};\n`,
    'apps/mobile/src/screens/styles/media.ts':
      `export const ${globalMediaStyle} = {};\n`,
    'apps/mobile/src/screens/components/variant.ts':
      `const ${isGlobalPreview} = true;\n`,
    'apps/mobile/src/screens/components/empty.ts':
      `const ${shouldRenderGlobalEmpty} = true;\n`,
    'apps/mobile/src/screens/styles/recent-download.ts':
      `export const ${globalRecentDownloadStyle} = {};\n`,
    'apps/mobile/src/screens/styles/section.ts':
      `export const ${globalSectionStyle} = {};\n`,
    'apps/mobile/src/screens/styles/photo.ts':
      `export const ${globalPhotoStyle} = {};\n`,
    'apps/mobile/src/screens/styles/video.ts':
      `export const ${globalVideoStyle} = {};\n`,
    'apps/mobile/src/screens/styles/file.ts':
      `export const ${globalFileStyle} = {};\n`,
    'apps/mobile/src/screens/styles/play.ts':
      `export const ${globalPlayStyle} = {};\n`,
    'apps/mobile/src/screens/styles/gradient.ts':
      `const gradientId = \`${globalHomeGradient}\${type}MediaGradient\`;\n`,
    'apps/mobile/src/screens/DeviceDiscoveryScreen.tsx':
      `const label = t('${deviceDiscoveryGlobalKey}');\n`,
    'apps/mobile/src/screens/SettingsScreen.tsx': `const label = t('${settingsGlobalKey}');\n`,
    'apps/desktop/src/renderer/features/directory/DirectoryPathCard.tsx':
      `const label = t('${globalPersonalDirectoryKey}');\n`,
  });
  try {
    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Audited OSS source package files: 30/);
    assert.match(result.stdout, /Disallowed OSS source package files: 25/);
    assert.match(result.stdout, /navigation\/RootNavigator\.tsx/);
    assert.match(result.stdout, /services\/desktop-local-service\.ts/);
    assert.match(result.stdout, /screens\/SyncActivityScreen\.tsx/);
    assert.doesNotMatch(result.stdout, /screens\/PhoneSyncSpaceScreen\.tsx/);
    assert.doesNotMatch(
      result.stdout,
      /components\/__tests__\/ReferenceLayout\.test\.tsx/,
    );
    assert.doesNotMatch(result.stdout, /i18n\/locales\/en\/common\.json/);
    assert.doesNotMatch(result.stdout, /services\/SyncEngineModule\.ts/);
    assert.doesNotMatch(result.stdout, /stores\/connection-store\.ts/);
    assert.match(result.stdout, /types\/local-computer\.ts/);
    assert.match(result.stdout, /services\/list-local-computer\.ts/);
    assert.match(result.stdout, /services\/download-local-computer\.ts/);
    assert.match(result.stdout, /services\/get-local-computer\.ts/);
    assert.match(result.stdout, /services\/prepare-local-computer\.ts/);
    assert.match(result.stdout, /services\/share-local-computer\.ts/);
    assert.match(result.stdout, /screens\/components\/Preview\.tsx/);
    assert.match(result.stdout, /components\/onboarding\/tour-assets\.ts/);
    assert.match(result.stdout, /screens\/styles\/sync\.ts/);
    assert.match(result.stdout, /screens\/styles\/media\.ts/);
    assert.match(result.stdout, /screens\/components\/variant\.ts/);
    assert.match(result.stdout, /screens\/components\/empty\.ts/);
    assert.match(result.stdout, /screens\/styles\/recent-download\.ts/);
    assert.match(result.stdout, /screens\/styles\/section\.ts/);
    assert.match(result.stdout, /screens\/styles\/photo\.ts/);
    assert.match(result.stdout, /screens\/styles\/video\.ts/);
    assert.match(result.stdout, /screens\/styles\/file\.ts/);
    assert.match(result.stdout, /screens\/styles\/play\.ts/);
    assert.match(result.stdout, /screens\/styles\/gradient\.ts/);
    assert.match(result.stdout, /screens\/DeviceDiscoveryScreen\.tsx/);
    assert.match(result.stdout, /screens\/SettingsScreen\.tsx/);
    assert.match(result.stdout, /features\/directory\/DirectoryPathCard\.tsx/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('falls back to filesystem walk for git-ref audits in extracted source archives', () => {
  const fixtureRoot = createFilesystemFixture({
    'package.json': '{}\n',
    'apps/mobile/src/App.tsx': 'export const App = () => null;\n',
    'apps/mobile/android/gradle/wrapper/gradle-wrapper.jar': 'jar\n',
    'apps/desktop/release/LynavoDrive.dmg': 'binary\n',
    'node_modules/pkg/private.key': 'ignored dependency fixture\n',
  });
  try {
    const result = runVerifier(['--root', fixtureRoot, '--git-ref', 'HEAD']);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /OSS source package input: filesystem walk \(no git metadata for HEAD\)/);
    assert.match(result.stdout, /Audited OSS source package files: 4/);
    assert.match(result.stdout, /Allowed OSS source package exceptions: 1/);
    assert.match(result.stdout, /Disallowed OSS source package files: 1/);
    assert.match(result.stdout, /apps\/desktop\/release\/LynavoDrive\.dmg/);
    assert.doesNotMatch(result.stdout, /node_modules/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('does not reuse parent git metadata for a nested extracted source archive', () => {
  const fixtureRoot = createTrackedFixture({
    'README.md': 'parent repository\n',
  });
  const extractedRoot = join(fixtureRoot, 'tmp', 'extracted-source');
  try {
    git(fixtureRoot, [
      '-c',
      'user.email=oss-source-test@example.invalid',
      '-c',
      'user.name=OSS Source Test',
      'commit',
      '-qm',
      'fixture',
    ]);
    writeFixture(extractedRoot, 'package.json', '{}\n');
    writeFixture(extractedRoot, 'apps/desktop/release/LynavoDrive.dmg', 'binary\n');

    for (const verifierArgs of [[], ['--git-ref', 'HEAD']]) {
      const result = runVerifier(['--root', extractedRoot, ...verifierArgs]);

      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stdout, /OSS source package input: filesystem walk/);
      assert.match(result.stdout, /Audited OSS source package files: 2/);
      assert.match(result.stdout, /Disallowed OSS source package files: 1/);
      assert.match(result.stdout, /apps\/desktop\/release\/LynavoDrive\.dmg/);
      assert.doesNotMatch(result.stdout, /README\.md/);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('blocks private tooling directories and local runtime artifacts', () => {
  const fixtureRoot = createTrackedFixture({
    '.vscode/launch.json': '{}\n',
    '.superpowers/plans/build.md': 'plan\n',
    'services/sidecar-go/sidecar.db': 'sqlite\n',
    'services/sidecar-go/sidecar.log': 'log\n',
  });
  try {
    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Disallowed OSS source package files: 4/);
    assert.match(
      result.stdout,
      new RegExp(
        [
          'Disallowed files:',
          '- \\.superpowers/plans/build\\.md .*private tooling directory.*',
          '- \\.vscode/launch\\.json .*private tooling directory.*',
          '- services/sidecar-go/sidecar\\.db .*generated data or log artifact.*',
          '- services/sidecar-go/sidecar\\.log .*generated data or log artifact.*',
        ].join('\\n'),
      ),
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
