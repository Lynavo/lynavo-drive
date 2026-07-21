import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const repoRoot = new URL('../../..', import.meta.url);
const token = (parts) => parts.join('');
const mobileBetaPackageScript = token(['package:mobile:', 'test', 'flight']);

function readRepoFile(path) {
  return readFileSync(new URL(path, repoRoot), 'utf8');
}

test('package scripts expose an OSS release gate without native builds', () => {
  const packageJson = JSON.parse(readRepoFile('package.json'));
  const scripts = packageJson.scripts ?? {};

  assert.equal(
    scripts['verify:oss-source-package:head'],
    'node scripts/verify-oss-source-package.mjs --git-ref HEAD',
  );
  assert.equal(
    scripts['gate:release'],
    [
      'pnpm sync:versions:check',
      'pnpm verify:oss-source-package:worktree',
      'pnpm verify:oss-source-package:head',
      'pnpm test:release',
      'pnpm release --profile review --targets ios,android,mac,win,linux --dry-run',
      'pnpm release --profile prod --targets ios,android,mac,win,linux --dry-run',
    ].join(' && '),
  );
  assert.match(scripts.check, /pnpm gate:release/);
  assert.doesNotMatch(scripts['gate:release'], /\b(package|build):desktop\b/);
  assert.doesNotMatch(scripts['gate:release'], /\bbuild:mobile\b/);
  assert.equal(scripts['gate:release'].includes(mobileBetaPackageScript), false);
  assert.equal(scripts[mobileBetaPackageScript], undefined);
  assert.equal(scripts[token([mobileBetaPackageScript, ':archive'])], undefined);
  assert.equal(scripts[token([mobileBetaPackageScript, ':upload'])], undefined);
  assert.equal(scripts[token(['package:desktop', ':signed'])], undefined);
  assert.equal(scripts[token(['package:desktop', ':signed:dir'])], undefined);
  assert.equal(scripts[token(['tag:', 'beta'])], undefined);
  assert.equal(scripts[token(['tag:', 'beta:push'])], undefined);
});

test('policy keeps verification secret-free and permits tag-only Android signing', () => {
  const policyPaths = [
    'AGENTS.md',
    'README.md',
    'CONTRIBUTING.md',
    'docs/release/release-playbook.md',
    'docs/testing/oss-verification-matrix.md',
  ];
  const docs = policyPaths.map(readRepoFile);

  for (const doc of docs) {
    assert.match(doc, /GitHub-hosted/i);
    assert.match(doc, /unsigned/i);
  }

  const policy = docs.join('\n');
  for (const secret of [
    'ANDROID_RELEASE_KEYSTORE_BASE64',
    'ANDROID_RELEASE_STORE_PASSWORD',
    'ANDROID_RELEASE_KEY_ALIAS',
    'ANDROID_RELEASE_KEY_PASSWORD',
  ]) {
    assert.ok(policy.includes(`\`${secret}\``), `missing signing Secret: ${secret}`);
  }
  assert.match(policy, /Native Builds.+secret-free.+unsigned/is);
  assert.match(policy, /stable.+`vX\.Y\.Z`.+only.+signed Android/is);
  assert.match(policy, /native-android-signed/);
  assert.match(policy, /~\/\.config\/lynavo-drive\/signing\/lynavo-drive-release\.jks/);
  assert.match(policy, /keystore.+backup|backup.+keystore/is);
  assert.match(policy, /recover|recovery/i);
  assert.match(policy, /los(?:e|ing|s).+key.+(?:update|upgrade)|key loss.+(?:update|upgrade)/is);
  assert.match(policy, /Linux.+local.+verification/is);
  assert.match(policy, /signing|code signing/i);
  assert.match(policy, /notarization/i);
  assert.match(policy, /store upload|app-store upload/i);
  assert.match(policy, /auto-update/i);
  assert.match(policy, /external.+build|third-party.+build/i);
});

test('native hosted verification docs define jobs, artifacts, and Linux exclusion', () => {
  const playbook = readRepoFile('docs/release/release-playbook.md');
  const matrix = readRepoFile('docs/testing/oss-verification-matrix.md');
  const docs = `${playbook}\n${matrix}`;

  for (const check of [
    'Native Builds',
    'iOS Build',
    'Android Build',
    'macOS Package',
    'Windows Package',
  ]) {
    assert.ok(docs.includes(`\`${check}\``), `missing hosted check: ${check}`);
  }
  for (const artifact of [
    'native-android',
    'native-macos-arm64',
    'native-macos-x64',
    'native-windows-x64',
  ]) {
    assert.ok(docs.includes(`\`${artifact}\``), `missing hosted artifact: ${artifact}`);
  }

  assert.match(docs, /seven-day|7-day/i);
  assert.match(docs, /manual dispatch.+Actions artifacts only/is);
  assert.match(docs, /fork.+no repository secrets/is);
  assert.match(docs, /unsigned/i);
  assert.match(docs, /Linux.+no hosted job.+no release artifact/is);
});

test('draft release operations document tags, assets, retries, and repository rules', () => {
  const readme = readRepoFile('README.md');
  const contributing = readRepoFile('CONTRIBUTING.md');
  const playbook = readRepoFile('docs/release/release-playbook.md');
  const matrix = readRepoFile('docs/testing/oss-verification-matrix.md');
  const docs = `${readme}\n${contributing}\n${playbook}\n${matrix}`;

  assert.match(readme, /stable tags matching `vX\.Y\.Z`/i);
  assert.match(readme, /draft GitHub Release/i);

  for (const asset of [
    'LynavoDriveDemo-<version>-macos-arm64.dmg',
    'LynavoDriveDemo-<version>-macos-x64.dmg',
    'LynavoDriveDemo-<version>-windows-x64.exe',
    'LynavoDriveDemo-<version>-windows-x64.zip',
    'LynavoDriveDemo-<version>-android-arm64-x86_64.apk',
    'LynavoDriveDemo-<version>-android-arm64-x86_64.aab',
    'SHA256SUMS',
  ]) {
    assert.ok(playbook.includes(`\`${asset}\``), `missing release asset: ${asset}`);
  }

  assert.match(playbook, /iOS.+build-only.+no IPA/is);
  assert.match(playbook, /manual dispatch.+build-only.+no GitHub Release/is);
  assert.match(playbook, /draft-only/i);
  assert.match(playbook, /published release.+immutable/is);
  assert.match(playbook, /rerun.+same tag.+existing draft/is);
  assert.match(playbook, /Gatekeeper.+SmartScreen.+sideloading/is);
  assert.match(playbook, /matching entry in `SHA256SUMS`/i);

  for (const check of ['OSS Release Gate', 'TS Quality', 'Go Tests', 'Native Builds']) {
    assert.ok(contributing.includes(`\`${check}\``), `missing required check: ${check}`);
  }
  assert.match(contributing, /maintainer-only `v\*` tag ruleset/i);
  assert.match(contributing, /GitHub repository settings.+not enforced by committed YAML/is);

  assert.match(matrix, /stable tag.+`vX\.Y\.Z`/is);
  assert.match(matrix, /published release.+must fail/is);
  assert.match(matrix, /rerun.+draft.+seven allowlisted assets/is);
  assert.match(docs, /unsigned OSS build-verification outputs/i);
});

test('iOS OSS build does not declare background audio capability', () => {
  const infoPlist = readRepoFile('apps/mobile/ios/LynavoDrive/Info.plist');
  const appDelegate = readRepoFile('apps/mobile/ios/LynavoDrive/AppDelegate.swift');

  assert.doesNotMatch(infoPlist, /UIBackgroundModes/);
  assert.doesNotMatch(infoPlist, /<string>audio<\/string>/);
  assert.doesNotMatch(appDelegate, /AVAudioSession/);
  assert.doesNotMatch(appDelegate, /\.playback/);
});
