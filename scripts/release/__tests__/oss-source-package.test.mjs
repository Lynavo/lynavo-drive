import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = new URL('../../..', import.meta.url);
const token = (parts) => parts.join('');
const legacyFormerFlow = token(['Sync', 'Flow']);
const legacyLowerVivi = token(['vivi', 'drop']);

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
  });
  try {
    rmSync(join(fixtureRoot, 'apps', 'desktop', 'resources', 'dns-sd.exe'), { force: true });

    const result = runVerifier(['--root', fixtureRoot, '--include-untracked']);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Audited OSS source package files: 2/);
    assert.match(result.stdout, /Disallowed OSS source package files: 1/);
    assert.match(result.stdout, /apps\/desktop\/resources\/dns-sd\.exe/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('ignores tracked files deleted from the working tree before staging', () => {
  const fixtureRoot = createTrackedFixture({
    [`docs/${legacyFormerFlow}-plan.md`]: 'legacy\n',
  });
  try {
    rmSync(join(fixtureRoot, 'docs', `${legacyFormerFlow}-plan.md`), { force: true });

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
    [`docs/${legacyFormerFlow}-plan.md`]: 'legacy\n',
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
    rmSync(join(fixtureRoot, 'docs', `${legacyFormerFlow}-plan.md`), { force: true });

    const result = runVerifier(['--root', fixtureRoot, '--git-ref', 'HEAD']);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /OSS source package input: git tree HEAD/);
    assert.match(result.stdout, /Audited OSS source package files: 1/);
    assert.match(result.stdout, new RegExp(`docs/${legacyFormerFlow}-plan\\.md`));
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

test('blocks private tooling directories and legacy source-package paths', () => {
  const fixtureRoot = createTrackedFixture({
    '.vscode/launch.json': '{}\n',
    '.superpowers/plans/old.md': 'plan\n',
    [`docs/${legacyFormerFlow}-plan.md`]: 'legacy\n',
    [`apps/mobile/src/assets/icons/${legacyLowerVivi}-logo.png`]: 'png\n',
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
          '- \\.superpowers/plans/old\\.md .*private tooling directory.*',
          '- \\.vscode/launch\\.json .*private tooling directory.*',
          `- apps/mobile/src/assets/icons/${legacyLowerVivi}-logo\\.png .*legacy product name in path`,
          `- docs/${legacyFormerFlow}-plan\\.md .*legacy product name in path`,
        ].join('\\n'),
      ),
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
