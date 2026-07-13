import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';

const repoRoot = new URL('../../..', import.meta.url);
const ACTION_SHA = /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/;

function readRepoFile(path) {
  return readFileSync(new URL(path, repoRoot), 'utf8');
}

function workflow(path) {
  return parse(readRepoFile(path));
}

function assertCommonTriggers(config) {
  assert.ok(config.on?.pull_request !== undefined);
  assert.ok(config.on?.merge_group !== undefined);
  assert.deepEqual(config.on?.push?.branches, ['main']);
  assert.ok(config.on?.workflow_dispatch !== undefined);
}

function assertReadOnlyWorkflow(config) {
  assert.deepEqual(config.permissions, { contents: 'read' });
  assert.equal(config.concurrency?.['cancel-in-progress'], true);
  assert.match(config.concurrency?.group ?? '', /workflow/);
  assert.match(config.concurrency?.group ?? '', /pull_request/);
}

function assertActionsPinned(steps) {
  for (const step of steps) {
    if (step.uses) assert.match(step.uses, ACTION_SHA);
  }
}

function findStep(steps, name) {
  const step = steps.find(candidate => candidate.name === name);
  assert.ok(step, `missing workflow step: ${name}`);
  return step;
}

test('OSS Release Gate workflow is stable, read-only, and toolchain-pinned', () => {
  const config = workflow('.github/workflows/oss-release-gate.yml');
  const job = config.jobs?.['oss-release-gate'];

  assert.equal(config.name, 'OSS Release Gate');
  assertCommonTriggers(config);
  assertReadOnlyWorkflow(config);
  assert.equal(job?.name, 'OSS Release Gate');
  assert.equal(job?.['runs-on'], 'ubuntu-24.04');
  assert.equal(job?.['timeout-minutes'], 30);
  assertActionsPinned(job?.steps ?? []);

  const pnpm = findStep(job.steps, 'Setup pnpm');
  assert.equal(pnpm.with?.version, '10.32.1');

  const node = findStep(job.steps, 'Setup Node.js');
  assert.equal(node.with?.['node-version'], '22.12.0');
  assert.equal(node.with?.cache, 'pnpm');

  assert.equal(
    findStep(job.steps, 'Install dependencies').run,
    'pnpm install --frozen-lockfile',
  );
  assert.equal(findStep(job.steps, 'Run OSS release gate').run, 'pnpm gate:release');

  const commands = job.steps.map(step => step.run ?? '').join('\n');
  assert.doesNotMatch(commands, /\bpnpm build\b/);
  assert.doesNotMatch(commands, /\bpnpm package:/);
  assert.doesNotMatch(commands, /\bxcodebuild\b/);
  assert.doesNotMatch(commands, /\bgradlew\b/);
});

test('repository CI workflow runs TypeScript quality and Go tests', () => {
  const config = workflow('.github/workflows/ci.yml');
  const mobilePackage = JSON.parse(readRepoFile('apps/mobile/package.json'));
  const tsJob = config.jobs?.['ts-quality'];
  const goJob = config.jobs?.['go-tests'];

  assert.equal(config.name, 'CI');
  assert.equal(mobilePackage.scripts?.test, 'jest --no-watchman');
  assertCommonTriggers(config);
  assertReadOnlyWorkflow(config);

  assert.equal(tsJob?.name, 'TS Quality');
  assert.equal(tsJob?.['runs-on'], 'ubuntu-24.04');
  assert.equal(tsJob?.['timeout-minutes'], 45);
  assertActionsPinned(tsJob?.steps ?? []);
  assert.equal(findStep(tsJob.steps, 'Setup pnpm').with?.version, '10.32.1');
  const node = findStep(tsJob.steps, 'Setup Node.js');
  assert.equal(node.with?.['node-version'], '22.12.0');
  assert.equal(node.with?.cache, 'pnpm');

  const tsCommands = tsJob.steps.map(step => step.run).filter(Boolean);
  assert.deepEqual(tsCommands, [
    'pnpm install --frozen-lockfile',
    'pnpm build --filter=!@lynavo-drive/mobile',
    'pnpm format:check',
    'pnpm lint',
    'pnpm typecheck',
    'pnpm --filter @lynavo-drive/mobile exec tsc --noEmit',
    'pnpm test',
  ]);

  assert.equal(goJob?.name, 'Go Tests');
  assert.equal(goJob?.['runs-on'], 'ubuntu-24.04');
  assert.equal(goJob?.['timeout-minutes'], 20);
  assertActionsPinned(goJob?.steps ?? []);
  const go = findStep(goJob.steps, 'Setup Go');
  assert.equal(go.with?.['go-version'], '1.25.6');
  assert.equal(go.with?.cache, true);
  assert.equal(go.with?.['cache-dependency-path'], 'services/sidecar-go/go.sum');
  const goTest = findStep(goJob.steps, 'Run Go tests');
  assert.equal(goTest.run, 'go test ./...');
  assert.equal(goTest['working-directory'], 'services/sidecar-go');
});

test('Dependabot proposes reviewed monthly dependency updates', () => {
  const config = workflow('.github/dependabot.yml');
  const updates = config.updates ?? [];
  const pnpm = updates.find(update => update['package-ecosystem'] === 'npm');
  const actions = updates.find(
    update => update['package-ecosystem'] === 'github-actions',
  );

  assert.equal(config.version, 2);
  for (const update of [pnpm, actions]) {
    assert.ok(update);
    assert.equal(update.directory, '/');
    assert.equal(update.schedule?.interval, 'monthly');
    assert.equal(update['open-pull-requests-limit'], 5);
  }
});
