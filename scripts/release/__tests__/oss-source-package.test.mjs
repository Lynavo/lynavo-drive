import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = new URL('../../..', import.meta.url);

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
    assert.match(result.stdout, /Tracked OSS source package files: 1/);
    assert.match(result.stdout, /Disallowed OSS source package files: 0/);
    assert.doesNotMatch(result.stdout, /\.env\.local/);
    assert.doesNotMatch(result.stdout, /untracked\.dmg/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('allows normal source files and explicit redistributable exceptions', () => {
  const fixtureRoot = createTrackedFixture({
    'apps/mobile/src/App.tsx': 'export const App = () => null;\n',
    'packages/contracts/src/index.ts': 'export const ok = true;\n',
    'apps/mobile/android/gradle/wrapper/gradle-wrapper.jar': 'jar\n',
    'apps/desktop/resources/dns-sd.exe': 'bonjour\n',
    'apps/desktop/resources/dnssd.dll': 'bonjour\n',
  });
  try {
    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Tracked OSS source package files: 5/);
    assert.match(result.stdout, /Allowed OSS source package exceptions: 3/);
    assert.match(result.stdout, /Disallowed OSS source package files: 0/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('blocks private tooling directories and legacy source-package paths', () => {
  const fixtureRoot = createTrackedFixture({
    '.vscode/launch.json': '{}\n',
    '.superpowers/plans/old.md': 'plan\n',
    'docs/SyncFlow-plan.md': 'legacy\n',
    'apps/mobile/src/assets/icons/vividrop-logo.png': 'png\n',
  });
  try {
    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Disallowed OSS source package files: 4/);
    assert.match(
      result.stdout,
      /Disallowed files:\n- \.superpowers\/plans\/old\.md .*private tooling directory.*\n- \.vscode\/launch\.json .*private tooling directory.*\n- apps\/mobile\/src\/assets\/icons\/vividrop-logo\.png .*legacy product name in path\n- docs\/SyncFlow-plan\.md .*legacy product name in path/,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
