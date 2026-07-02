import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = new URL('../../..', import.meta.url);
const token = (parts) => parts.join('');
const legacyNames = Object.freeze([
  token(['Vivi', ' Drop']),
  token(['Vivi', 'Drop']),
  token(['vivi', 'drop']),
  token(['Sync', 'Flow']),
  token(['sync', 'flow']),
  token(['SYN', 'CFLOW']),
  token(['VIVI', 'DROP']),
  token(['@', 'sync', 'flow']),
]);
const legacyFormerFlow = token(['Sync', 'Flow']);
const legacyLowerFlow = token(['sync', 'flow']);
const legacyViviSlug = token(['Vivi', 'Drop']);
const legacySidecarBin = token(['sync', 'flow', '-sidecar']);

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runVerifier(args) {
  return spawnSync(process.execPath, ['scripts/verify-legacy-name-allowlist.mjs', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

test('blocks every unallowlisted legacy name form in a scanned tree by default', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'legacy-name-allowlist-'));
  try {
    writeFileSync(
      join(fixtureRoot, 'unallowlisted.txt'),
      [
        ...legacyNames,
      ].join('\n'),
    );

    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Unallowlisted legacy name hits: 8/);
    for (const legacyName of legacyNames) {
      assert.match(result.stdout, new RegExp(escapeRegExp(legacyName)));
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('keeps unallowlisted legacy hits advisory when explicitly requested', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'legacy-name-allowlist-'));
  try {
    writeFileSync(join(fixtureRoot, 'unallowlisted.txt'), `${legacyViviSlug}\n`);

    const result = runVerifier(['--root', fixtureRoot, '--advisory']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Unallowlisted legacy name hits: 1/);
    assert.match(result.stdout, /Unallowlisted hits \(advisory\):/);
    assert.match(result.stdout, new RegExp(`unallowlisted\\.txt:1 ${legacyViviSlug}`));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('includes hidden files while keeping generated artifacts ignored', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'legacy-name-allowlist-'));
  try {
    mkdirSync(join(fixtureRoot, '.github'), { recursive: true });
    mkdirSync(join(fixtureRoot, 'dist'), { recursive: true });
    writeFileSync(join(fixtureRoot, '.github', 'workflow.yml'), `name: ${legacyFormerFlow}\n`);
    writeFileSync(join(fixtureRoot, 'dist', 'bundle.js'), `const name = "${legacyFormerFlow}";\n`);

    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Unallowlisted legacy name hits: 1/);
    assert.match(result.stdout, new RegExp(`\\.github/workflow\\.yml:1 ${legacyFormerFlow}`));
    assert.doesNotMatch(result.stdout, /dist\/bundle\.js/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('scans release scripts while excluding generated release artifacts', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'legacy-name-allowlist-'));
  try {
    const releaseScriptDir = join(fixtureRoot, 'scripts', 'release');
    const generatedReleaseDir = join(fixtureRoot, 'apps', 'desktop', 'release', 'win-unpacked');
    mkdirSync(releaseScriptDir, { recursive: true });
    mkdirSync(generatedReleaseDir, { recursive: true });
    writeFileSync(join(releaseScriptDir, 'bad.mjs'), `const oldName = "${legacyFormerFlow}";\n`);
    writeFileSync(join(generatedReleaseDir, 'bundle.js'), `const oldName = "${legacyViviSlug}";\n`);

    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Unallowlisted legacy name hits: 1/);
    assert.match(result.stdout, new RegExp(`scripts/release/bad\\.mjs:1 ${legacyFormerFlow}`));
    assert.doesNotMatch(result.stdout, /apps\/desktop\/release/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('rejects legacy Go module paths after sidecar module rename', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'legacy-name-allowlist-'));
  try {
    const sidecarDir = join(fixtureRoot, 'services', 'sidecar-go');
    mkdirSync(sidecarDir, { recursive: true });
    writeFileSync(
      join(sidecarDir, 'go.mod'),
      `module github.com/gpt-open/${legacyLowerFlow}\n// ${legacyFormerFlow}\n`,
    );

    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Allowed legacy name hits: 0/);
    assert.match(result.stdout, /Unallowlisted legacy name hits: 2/);
    assert.match(result.stdout, new RegExp(`services/sidecar-go/go\\.mod:1 ${legacyLowerFlow}`));
    assert.match(result.stdout, new RegExp(`services/sidecar-go/go\\.mod:2 ${legacyFormerFlow}`));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('rejects legacy sidecar binary and command paths after cmd rename', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'legacy-name-allowlist-'));
  try {
    const scriptDir = join(fixtureRoot, 'apps', 'desktop', 'scripts');
    mkdirSync(scriptDir, { recursive: true });
    writeFileSync(
      join(scriptDir, 'build-sidecar-mac.cjs'),
      [
        `const outputPath = path.join(resourcesDir, 'resources/${legacySidecarBin}');`,
        `run('go', ['build', '-o', output, './cmd/${legacySidecarBin}/']);`,
      ].join('\n'),
    );

    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Allowed legacy name hits: 0/);
    assert.match(result.stdout, /Unallowlisted legacy name hits: 2/);
    assert.match(
      result.stdout,
      new RegExp(`apps/desktop/scripts/build-sidecar-mac\\.cjs:1 ${legacyLowerFlow}`),
    );
    assert.match(
      result.stdout,
      new RegExp(`apps/desktop/scripts/build-sidecar-mac\\.cjs:2 ${legacyLowerFlow}`),
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('prints unallowlisted matches in deterministic path order', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'legacy-name-allowlist-'));
  try {
    writeFileSync(join(fixtureRoot, 'z-last.txt'), `${legacyFormerFlow}\n`);
    writeFileSync(join(fixtureRoot, 'a-first.txt'), `${legacyFormerFlow}\n`);

    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stdout,
      new RegExp(
        `Unallowlisted hits:\\n- a-first\\.txt:1 ${legacyFormerFlow} :: ${legacyFormerFlow}\\n- z-last\\.txt:1 ${legacyFormerFlow} :: ${legacyFormerFlow}`,
      ),
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('does not broadly allow private tool archive paths', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'legacy-name-allowlist-'));
  try {
    const planDir = join(fixtureRoot, '.superpowers', 'plans');
    mkdirSync(planDir, { recursive: true });
    writeFileSync(
      join(planDir, '2026-06-30-unlisted-rename-plan.md'),
      `Task plan mentions ${legacyFormerFlow}.\n`,
    );

    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Unallowlisted legacy name hits: 1/);
    assert.match(
      result.stdout,
      new RegExp(
        `\\.superpowers/plans/2026-06-30-unlisted-rename-plan\\.md:1 ${legacyFormerFlow}`,
      ),
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
