import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = new URL('../../..', import.meta.url);

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
        'Vivi Drop',
        'ViviDrop',
        'vividrop',
        'SyncFlow',
        'syncflow',
        'SYNCFLOW',
        'VIVIDROP',
        '@syncflow',
      ].join('\n'),
    );

    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Unallowlisted legacy name hits: 8/);
    for (const legacyName of [
      'Vivi Drop',
      'ViviDrop',
      'vividrop',
      'SyncFlow',
      'syncflow',
      'SYNCFLOW',
      'VIVIDROP',
      '@syncflow',
    ]) {
      assert.match(result.stdout, new RegExp(legacyName.replace('@', '@')));
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('keeps unallowlisted legacy hits advisory when explicitly requested', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'legacy-name-allowlist-'));
  try {
    writeFileSync(join(fixtureRoot, 'unallowlisted.txt'), 'ViviDrop\n');

    const result = runVerifier(['--root', fixtureRoot, '--advisory']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Unallowlisted legacy name hits: 1/);
    assert.match(result.stdout, /Unallowlisted hits \(advisory\):/);
    assert.match(result.stdout, /unallowlisted\.txt:1 ViviDrop/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('includes hidden files while keeping generated artifacts ignored', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'legacy-name-allowlist-'));
  try {
    mkdirSync(join(fixtureRoot, '.github'), { recursive: true });
    mkdirSync(join(fixtureRoot, 'dist'), { recursive: true });
    writeFileSync(join(fixtureRoot, '.github', 'workflow.yml'), 'name: SyncFlow\n');
    writeFileSync(join(fixtureRoot, 'dist', 'bundle.js'), 'const name = "SyncFlow";\n');

    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Unallowlisted legacy name hits: 1/);
    assert.match(result.stdout, /\.github\/workflow\.yml:1 SyncFlow/);
    assert.doesNotMatch(result.stdout, /dist\/bundle\.js/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('applies exact-path allowlists only to their allowed terms', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'legacy-name-allowlist-'));
  try {
    writeFileSync(
      join(fixtureRoot, 'package.json'),
      '{"name":"@syncflow/root","title":"SyncFlow"}\n',
    );

    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Allowed legacy name hits: 1/);
    assert.match(result.stdout, /Unallowlisted legacy name hits: 1/);
    assert.match(result.stdout, /package\.json:1 SyncFlow/);
    assert.doesNotMatch(result.stdout, /package\.json:1 @syncflow/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('prints unallowlisted matches in deterministic path order', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'legacy-name-allowlist-'));
  try {
    writeFileSync(join(fixtureRoot, 'z-last.txt'), 'SyncFlow\n');
    writeFileSync(join(fixtureRoot, 'a-first.txt'), 'SyncFlow\n');

    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stdout,
      /Unallowlisted hits:\n- a-first\.txt:1 SyncFlow :: SyncFlow\n- z-last\.txt:1 SyncFlow :: SyncFlow/,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('does not broadly allow all docs/superpowers paths', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'legacy-name-allowlist-'));
  try {
    const planDir = join(fixtureRoot, 'docs', 'superpowers', 'plans');
    mkdirSync(planDir, { recursive: true });
    writeFileSync(
      join(planDir, '2026-06-29-lynavo-drive-global-only-oss.md'),
      'Task plan mentions SyncFlow.\n',
    );

    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Unallowlisted legacy name hits: 1/);
    assert.match(
      result.stdout,
      /docs\/superpowers\/plans\/2026-06-29-lynavo-drive-global-only-oss\.md:1 SyncFlow/,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
