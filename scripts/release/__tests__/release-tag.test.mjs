import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { verifyReleaseTag } from '../release-version.mjs';

const cli = new URL('../verify-release-tag.mjs', import.meta.url);
const canonicalAndroidHelper = [
  'def resolveIosBuildSetting(String settingName) {',
  '    def projectFile = file("../../ios/LynavoDrive.xcodeproj/project.pbxproj")',
  '    def matcher = projectFile.text =~ /${settingName} = ([^;]+);/',
  '',
  '    if (!matcher.find()) {',
  '        throw new GradleException("Failed to resolve ${settingName} from ${projectFile}")',
  '    }',
  '',
  '    return matcher.group(1).trim()',
  '}',
].join('\n');

function writeFixtureFile(root, relativePath, content) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function fixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lynavo-release-tag-'));
  const versions = {
    desktop: '1.2.3',
    mobile: '1.2.3',
    ios: '1.2.3',
    android: 'resolveIosMarketingVersion()',
    androidHelper: canonicalAndroidHelper,
    androidResolver: [
      'def resolveIosMarketingVersion() {',
      '    return resolveIosBuildSetting("MARKETING_VERSION")',
      '}',
    ].join('\n'),
    ...overrides,
  };

  writeFixtureFile(
    root,
    'apps/desktop/package.json',
    `${JSON.stringify({ name: '@lynavo-drive/desktop', version: versions.desktop })}\n`,
  );
  writeFixtureFile(
    root,
    'apps/mobile/package.json',
    `${JSON.stringify({ name: '@lynavo-drive/mobile', version: versions.mobile })}\n`,
  );
  writeFixtureFile(
    root,
    'apps/mobile/ios/LynavoDrive.xcodeproj/project.pbxproj',
    [
      `MARKETING_VERSION = ${versions.ios};`,
      `MARKETING_VERSION = ${versions.ios};`,
      '',
    ].join('\n'),
  );
  writeFixtureFile(
    root,
    'apps/mobile/android/app/build.gradle',
    `${versions.androidHelper}\n${versions.androidResolver}\nversionName ${versions.android}\n`,
  );

  return root;
}

test('accepts an exact stable tag when all four version sources match', () => {
  const result = verifyReleaseTag({ repoRoot: fixture(), tag: 'v1.2.3' });
  assert.deepEqual(result, { tag: 'v1.2.3', version: '1.2.3' });
});

for (const tag of ['1.2.3', 'v1.2', 'v01.2.3', 'v1.2.3-rc.1']) {
  test(`rejects a non-stable release tag: ${tag}`, () => {
    assert.throws(
      () => verifyReleaseTag({ repoRoot: fixture(), tag }),
      /stable release tag|vX\.Y\.Z/i,
    );
  });
}

for (const [source, overrides] of [
  ['desktop', { desktop: '1.2.4' }],
  ['mobile', { mobile: '1.2.4' }],
  ['iOS', { ios: '1.2.4' }],
  ['Android', { android: "'1.2.4'" }],
]) {
  test(`rejects a ${source} version mismatch`, () => {
    assert.throws(
      () => verifyReleaseTag({ repoRoot: fixture(overrides), tag: 'v1.2.3' }),
      new RegExp(`${source}.*1\\.2\\.4|1\\.2\\.4.*${source}`, 'i'),
    );
  });
}

test('rejects ambiguous iOS marketing versions', () => {
  const root = fixture();
  writeFixtureFile(
    root,
    'apps/mobile/ios/LynavoDrive.xcodeproj/project.pbxproj',
    'MARKETING_VERSION = 1.2.3;\nMARKETING_VERSION = 1.2.4;\n',
  );

  assert.throws(
    () => verifyReleaseTag({ repoRoot: root, tag: 'v1.2.3' }),
    /iOS.*ambiguous|ambiguous.*iOS/i,
  );
});

test('accepts an Android literal version matching the tag', () => {
  const root = fixture({
    android: "'1.2.3'",
    androidResolver: '',
  });
  assert.deepEqual(verifyReleaseTag({ repoRoot: root, tag: 'v1.2.3' }), {
    tag: 'v1.2.3',
    version: '1.2.3',
  });
});

test('accepts the Android resolver with single quotes and flexible whitespace', () => {
  const root = fixture({
    androidResolver: [
      'def resolveIosMarketingVersion( ) {',
      "  return resolveIosBuildSetting( 'MARKETING_VERSION' );",
      '}',
    ].join('\n'),
  });

  assert.deepEqual(verifyReleaseTag({ repoRoot: root, tag: 'v1.2.3' }), {
    tag: 'v1.2.3',
    version: '1.2.3',
  });
});

test('rejects extra resolver references inside comments and strings', () => {
  const root = fixture({
    androidResolver: [
      'def documentation = "${resolveIosMarketingVersion()}"',
      '// resolveIosMarketingVersion()',
      '/* resolveIosMarketingVersion */',
      'def resolveIosMarketingVersion() {',
      '    return resolveIosBuildSetting("MARKETING_VERSION")',
      '}',
    ].join('\n'),
  });

  assert.throws(
    () => verifyReleaseTag({ repoRoot: root, tag: 'v1.2.3' }),
    /Android.*resolver.*MARKETING_VERSION/i,
  );
});

test('rejects a same-name closure shadowing the Android version resolver', () => {
  const root = fixture();
  writeFixtureFile(
    root,
    'apps/mobile/android/app/build.gradle',
    [
      'def resolveIosMarketingVersion() {',
      '    return resolveIosBuildSetting("MARKETING_VERSION")',
      '}',
      'android {',
      '    defaultConfig {',
      "        def resolveIosMarketingVersion = { '9.9.9' }",
      '        versionName resolveIosMarketingVersion()',
      '    }',
      '}',
      '',
    ].join('\n'),
  );

  assert.throws(
    () => verifyReleaseTag({ repoRoot: root, tag: 'v1.2.3' }),
    /Android.*resolver.*MARKETING_VERSION/i,
  );
});

test('accepts the canonical Android build-setting helper', () => {
  const root = fixture();

  assert.deepEqual(verifyReleaseTag({ repoRoot: root, tag: 'v1.2.3' }), {
    tag: 'v1.2.3',
    version: '1.2.3',
  });
});

for (const [name, androidHelper] of [
  [
    'a build-setting helper returning a fixed version',
    [
      'def resolveIosBuildSetting(String settingName) {',
      "    return '1.2.3'",
      '}',
    ].join('\n'),
  ],
  ['a missing build-setting helper', ''],
  [
    'duplicate build-setting helper definitions',
    [canonicalAndroidHelper, canonicalAndroidHelper].join('\n'),
  ],
  [
    'a same-name closure shadowing the build-setting helper',
    [
      canonicalAndroidHelper,
      "def resolveIosBuildSetting = { settingName -> '9.9.9' }",
    ].join('\n'),
  ],
]) {
  test(`rejects ${name}`, () => {
    assert.throws(
      () =>
        verifyReleaseTag({
          repoRoot: fixture({ androidHelper }),
          tag: 'v1.2.3',
        }),
      /Android.*helper.*project\.pbxproj/i,
    );
  });
}

for (const [name, wrapperStart, wrapperEnd] of [
  ['a block comment', '/*', '*/'],
  ['a multiline string', 'def documentation = """', '"""'],
]) {
  test(`rejects versionName found only inside ${name}`, () => {
    const root = fixture();
    writeFixtureFile(
      root,
      'apps/mobile/android/app/build.gradle',
      [
        'def resolveIosMarketingVersion() {',
        '    return resolveIosBuildSetting("MARKETING_VERSION")',
        '}',
        wrapperStart,
        'versionName resolveIosMarketingVersion()',
        wrapperEnd,
        '',
      ].join('\n'),
    );

    assert.throws(
      () => verifyReleaseTag({ repoRoot: root, tag: 'v1.2.3' }),
      /Android.*versionName|versionName.*Android/i,
    );
  });
}

for (const [name, androidResolver] of [
  ['a missing resolver', ''],
  [
    'a resolver returning a fixed version',
    [
      'def resolveIosMarketingVersion() {',
      "    return '1.2.3'",
      '}',
    ].join('\n'),
  ],
  [
    'a resolver reading CURRENT_PROJECT_VERSION',
    [
      'def resolveIosMarketingVersion() {',
      '    return resolveIosBuildSetting("CURRENT_PROJECT_VERSION")',
      '}',
    ].join('\n'),
  ],
  [
    'a resolver with additional statements',
    [
      'def resolveIosMarketingVersion() {',
      '    def version = resolveIosBuildSetting("MARKETING_VERSION")',
      '    return version',
      '}',
    ].join('\n'),
  ],
  [
    'a resolver with an additional multiline string statement',
    [
      'def resolveIosMarketingVersion() {',
      '    """metadata"""',
      '    return resolveIosBuildSetting("MARKETING_VERSION")',
      '}',
    ].join('\n'),
  ],
  [
    'duplicate resolver definitions',
    [
      'def resolveIosMarketingVersion() {',
      '    return resolveIosBuildSetting("MARKETING_VERSION")',
      '}',
      'def resolveIosMarketingVersion() {',
      '    return resolveIosBuildSetting("MARKETING_VERSION")',
      '}',
    ].join('\n'),
  ],
  [
    'duplicate resolver definitions with a line comment in the parameter list',
    [
      'def resolveIosMarketingVersion() {',
      '    return resolveIosBuildSetting("MARKETING_VERSION")',
      '}',
      'def resolveIosMarketingVersion( // duplicate declaration',
      ') {',
      '    return resolveIosBuildSetting("MARKETING_VERSION")',
      '}',
    ].join('\n'),
  ],
  [
    'a resolver definition inside a block comment',
    [
      '/*',
      'def resolveIosMarketingVersion() {',
      '    return resolveIosBuildSetting("MARKETING_VERSION")',
      '}',
      '*/',
    ].join('\n'),
  ],
  [
    'a resolver definition inside a multiline string',
    [
      'def documentation = """',
      'def resolveIosMarketingVersion() {',
      '    return resolveIosBuildSetting("MARKETING_VERSION")',
      '}',
      '"""',
    ].join('\n'),
  ],
  [
    'a resolver definition inside a multiline slashy string',
    [
      'def documentation = /',
      'def resolveIosMarketingVersion() {',
      '    return resolveIosBuildSetting("MARKETING_VERSION")',
      '}',
      '/',
    ].join('\n'),
  ],
  [
    'a resolver definition inside a returned multiline slashy string',
    [
      'def documentation() {',
      '    return /',
      'def resolveIosMarketingVersion() {',
      '    return resolveIosBuildSetting("MARKETING_VERSION")',
      '}',
      '/',
      '}',
    ].join('\n'),
  ],
  [
    'a resolver definition inside a multiline dollar-slashy string',
    [
      'def documentation = $/',
      'def resolveIosMarketingVersion() {',
      '    return resolveIosBuildSetting("MARKETING_VERSION")',
      '}',
      '/$',
    ].join('\n'),
  ],
  [
    'a resolver definition after an escaped dollar-slashy closing delimiter',
    [
      'def documentation = $/',
      'escaped closing delimiter: $/$',
      'def resolveIosMarketingVersion() {',
      '    return resolveIosBuildSetting("MARKETING_VERSION")',
      '}',
      '/$',
    ].join('\n'),
  ],
  [
    'an incorrect resolver hidden between division-like slashes',
    [
      'def quotient = total /',
      'def resolveIosMarketingVersion() {',
      "    return '1.2.3'",
      '}',
      '/ scale',
      'def resolveIosMarketingVersion() {',
      '    return resolveIosBuildSetting("MARKETING_VERSION")',
      '}',
    ].join('\n'),
  ],
]) {
  test(`rejects ${name}`, () => {
    assert.throws(
      () =>
        verifyReleaseTag({
          repoRoot: fixture({ androidResolver }),
          tag: 'v1.2.3',
        }),
      /Android.*resolver.*MARKETING_VERSION/i,
    );
  });
}

test('CLI prints only the verified version', () => {
  const result = spawnSync(
    process.execPath,
    [cli.pathname, '--repo-root', fixture(), '--tag', 'v1.2.3'],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '1.2.3\n');
  assert.equal(result.stderr, '');
});

test('CLI accepts the pnpm argument separator before the tag flag', () => {
  const result = spawnSync(
    process.execPath,
    [cli.pathname, '--', '--repo-root', fixture(), '--tag', 'v1.2.3'],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '1.2.3\n');
});
