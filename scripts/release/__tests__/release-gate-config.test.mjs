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
      'pnpm verify:oss-boundary',
      'pnpm verify:legacy-names:strict',
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

test('CI runs the OSS release gate with the repository Node baseline', () => {
  const packageJson = JSON.parse(readRepoFile('package.json'));
  const workflow = readRepoFile('.github/workflows/oss-release-gate.yml');

  assert.match(workflow, /name:\s+OSS Release Gate/);
  assert.equal(packageJson.engines?.node, '>=22.12.0');
  assert.match(workflow, /node-version:\s+22\.12\.0/);
  assert.match(workflow, /pnpm gate:release/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:/);
  assert.doesNotMatch(workflow, /\bpnpm build\b/);
  assert.doesNotMatch(workflow, /\bpnpm package:/);
  assert.doesNotMatch(workflow, /\bxcodebuild\b/);
  assert.doesNotMatch(workflow, /\bgradlew\b/);
});

test('iOS OSS build does not declare background audio capability', () => {
  const infoPlist = readRepoFile('apps/mobile/ios/LynavoDrive/Info.plist');
  const appDelegate = readRepoFile('apps/mobile/ios/LynavoDrive/AppDelegate.swift');

  assert.doesNotMatch(infoPlist, /UIBackgroundModes/);
  assert.doesNotMatch(infoPlist, /<string>audio<\/string>/);
  assert.doesNotMatch(appDelegate, /AVAudioSession/);
  assert.doesNotMatch(appDelegate, /\.playback/);
});
