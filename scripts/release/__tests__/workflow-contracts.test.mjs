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

function allWorkflowSteps(config) {
  return Object.values(config.jobs ?? {}).flatMap(job => job.steps ?? []);
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

test('native build workflow is path-aware, unsigned, and platform-bounded', () => {
  const config = workflow('.github/workflows/native-builds.yml');
  const jobs = config.jobs ?? {};

  assert.equal(config.name, 'Native Builds');
  assertCommonTriggers(config);
  assert.ok(config.on?.workflow_call !== undefined);
  assertReadOnlyWorkflow(config);
  assert.equal(config.on?.pull_request_target, undefined);

  assert.equal(jobs.changes?.name, 'Detect Changes');
  assert.equal(jobs.ios?.name, 'iOS Build');
  assert.equal(jobs.android?.name, 'Android Build');
  assert.equal(jobs.macos?.name, 'macOS Package');
  assert.equal(jobs.windows?.name, 'Windows Package');
  assert.equal(jobs.aggregate?.name, 'Native Builds');

  const paths = findStep(jobs.changes?.steps ?? [], 'Filter changed paths');
  const filters = paths.with?.filters ?? '';
  for (const path of [
    'apps/mobile/**',
    'apps/desktop/**',
    'services/sidecar-go/**',
    'packages/contracts/**',
    'packages/design-tokens/**',
    'scripts/release/**',
    'pnpm-lock.yaml',
    '.github/workflows/native-builds.yml',
  ]) {
    assert.match(filters, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.equal(jobs.ios?.['runs-on'], 'macos-26');
  assert.equal(jobs.android?.['runs-on'], 'ubuntu-24.04');
  assert.equal(jobs.windows?.['runs-on'], 'windows-2025');
  assert.deepEqual(jobs.macos?.strategy?.matrix?.include, [
    { arch: 'arm64', runner: 'macos-26' },
    { arch: 'x64', runner: 'macos-26-intel' },
  ]);
  assert.equal(jobs.macos?.['runs-on'], '${{ matrix.runner }}');
  assert.equal(
    findStep(jobs.macos?.steps ?? [], 'Build macOS sidecar').run,
    'node apps/desktop/scripts/build-sidecar-mac.cjs ${{ matrix.arch }}',
  );

  const steps = allWorkflowSteps(config);
  assertActionsPinned(steps);
  const workflowText = readRepoFile('.github/workflows/native-builds.yml');
  assert.match(workflowText, /22\.12\.0/);
  assert.match(workflowText, /10\.32\.1/);
  assert.match(workflowText, /1\.25\.6/);
  assert.match(workflowText, /java-version:\s*['"]?17['"]?/);
  assert.match(workflowText, /CODE_SIGNING_ALLOWED=NO/);
  assert.match(workflowText, /retention-days:\s*7/);

  for (const artifact of [
    'native-macos-${{ matrix.arch }}',
    'native-windows-x64',
    'native-android',
    'LynavoDrive-${{ needs.changes.outputs.version }}-macos-${{ matrix.arch }}.dmg',
    'LynavoDrive-${{ needs.changes.outputs.version }}-windows-x64.exe',
    'LynavoDrive-${{ needs.changes.outputs.version }}-windows-x64.zip',
    'LynavoDrive-${{ needs.changes.outputs.version }}-android-arm64-x86_64.apk',
    'LynavoDrive-${{ needs.changes.outputs.version }}-android-arm64-x86_64.aab',
  ]) {
    assert.ok(workflowText.includes(artifact), `missing native artifact: ${artifact}`);
  }

  assert.equal(jobs.aggregate?.if, 'always()');
  assert.deepEqual(jobs.aggregate?.needs, [
    'changes',
    'ios',
    'android',
    'macos',
    'windows',
  ]);
  const aggregateStep = findStep(
    jobs.aggregate?.steps ?? [],
    'Verify native build results',
  );
  assert.equal(aggregateStep.env?.CHANGES_RESULT, '${{ needs.changes.result }}');
  const aggregateCommands = aggregateStep.run ?? '';
  assert.match(aggregateCommands, /CHANGES_RESULT.+success/s);
  assert.match(aggregateCommands, /success/);
  assert.match(aggregateCommands, /skipped/);
  assert.match(aggregateCommands, /No native build scope selected\./);

  assert.doesNotMatch(workflowText, /pull_request_target/);
  assert.doesNotMatch(workflowText, /ubuntu-(?:20\.04|22\.04)|runs-on:\s*.*linux/i);
  assert.doesNotMatch(workflowText, /(?:artifact|asset)[^\n]*linux|linux[^\n]*(?:artifact|asset)/i);
  assert.doesNotMatch(workflowText, /notari[sz]|apple-id|app-store|play-store|auto.?update/i);
  assert.doesNotMatch(workflowText, /secrets\.|CSC_LINK|APPLE_ID|signing-certificate/i);
  for (const step of steps.filter(candidate => candidate.uses?.startsWith('actions/upload-artifact@'))) {
    assert.doesNotMatch(String(step.with?.path ?? ''), /[*?]/);
  }
});

test('native change detection has the pull request permission required by paths-filter', () => {
  const config = workflow('.github/workflows/native-builds.yml');

  assert.deepEqual(config.permissions, { contents: 'read' });
  assert.deepEqual(config.jobs?.changes?.permissions, {
    contents: 'read',
    'pull-requests': 'read',
  });
});

test('native path filters select every platform for shared build inputs', () => {
  const config = workflow('.github/workflows/native-builds.yml');
  const paths = findStep(
    config.jobs?.changes?.steps ?? [],
    'Filter changed paths',
  );
  const filters = parse(paths.with?.filters ?? '');
  const sharedInputs = [
    'package.json',
    '.npmrc',
    'pnpm-workspace.yaml',
    'tsconfig.base.json',
    'turbo.json',
    'scripts/sync-version-manifest.mjs',
    'scripts/dev/release-child-env.cjs',
  ];

  for (const platform of ['ios', 'android', 'macos', 'windows']) {
    assert.ok(Array.isArray(filters[platform]), `missing path filter: ${platform}`);
    for (const input of sharedInputs) {
      assert.ok(
        filters[platform].includes(input),
        `${input} must select the ${platform} native build`,
      );
    }
  }
  assert.equal(filters.linux, undefined);
});

test('Android path filter includes its native artifact staging script', () => {
  const config = workflow('.github/workflows/native-builds.yml');
  const paths = findStep(
    config.jobs?.changes?.steps ?? [],
    'Filter changed paths',
  );
  const filters = parse(paths.with?.filters ?? '');

  assert.ok(
    filters.android?.includes('scripts/release/stage-native-artifact.mjs'),
  );
});

test('Android build verifies the effective APK version before staging', () => {
  const config = workflow('.github/workflows/native-builds.yml');
  const verifyVersion = findStep(
    config.jobs?.android?.steps ?? [],
    'Verify Android package version',
  );

  assert.equal(
    verifyVersion.env?.EXPECTED_VERSION,
    '${{ needs.changes.outputs.version }}',
  );
  assert.match(verifyVersion.run, /apkanalyzer.*manifest version-name/);
  assert.match(verifyVersion.run, /ACTUAL_VERSION/);
  assert.match(verifyVersion.run, /EXPECTED_VERSION/);
  assert.match(verifyVersion.run, /exit 1/);
});

test('native artifact uploads overwrite same-run artifacts on rerun', () => {
  const config = workflow('.github/workflows/native-builds.yml');
  const uploads = allWorkflowSteps(config).filter(step =>
    step.uses?.startsWith('actions/upload-artifact@'),
  );

  assert.equal(uploads.length, 3);
  for (const upload of uploads) {
    assert.equal(
      upload.with?.overwrite,
      true,
      `${upload.name} must enable artifact overwrite`,
    );
  }
});

test('assembled release artifact upload overwrites same-run artifacts on rerun', () => {
  const config = workflow('.github/workflows/release.yml');
  const upload = findStep(
    config.jobs?.assemble?.steps ?? [],
    'Upload assembled release assets',
  );

  assert.equal(upload.with?.overwrite, true);
});

test('draft release reruns preserve generated notes', () => {
  const config = workflow('.github/workflows/release.yml');
  const releaseStep = findStep(
    config.jobs?.release?.steps ?? [],
    'Create or update draft release',
  );
  const commands = releaseStep.run;

  assert.equal(releaseStep.env?.GH_REPO, '${{ github.repository }}');
  assert.match(commands, /gh release create/);
  assert.match(commands, /--generate-notes/);
  assert.match(commands, /--notes-file "\$RUNNER_TEMP\/release-body\.md"/);
  assert.doesNotMatch(commands, /gh release edit/);
});

test('draft release assets are uploaded once after a final draft check', () => {
  const config = workflow('.github/workflows/release.yml');
  const commands = findStep(
    config.jobs?.release?.steps ?? [],
    'Create or update draft release',
  ).run;
  const draftChecks = commands.match(/gh release view "\$TAG" --json isDraft/g) ?? [];
  const uploads = commands.match(/gh release upload /g) ?? [];
  const finalDraftCheckIndex = commands.lastIndexOf(
    'gh release view "$TAG" --json isDraft',
  );
  const uploadIndex = commands.indexOf(
    'gh release upload "$TAG" "${ASSET_PATHS[@]}" --clobber',
  );

  assert.equal(draftChecks.length, 2);
  assert.equal(uploads.length, 1);
  assert.notEqual(finalDraftCheckIndex, -1);
  assert.notEqual(uploadIndex, -1);
  assert.ok(finalDraftCheckIndex < uploadIndex);
  const finalGuardToUpload = commands.slice(
    finalDraftCheckIndex,
    uploadIndex,
  );
  assert.match(
    finalGuardToUpload,
    /if \[ "\$\(jq -r '\.isDraft' <<< "\$RELEASE_JSON"\)" != "true" \]; then[\s\S]*?Refusing to overwrite published release[\s\S]*?exit 1[\s\S]*?fi\s*$/,
  );
  assert.doesNotMatch(finalGuardToUpload, /gh release (?:delete-asset|upload)/);
  assert.doesNotMatch(commands, /gh release delete-asset/);
});

test('draft release workflow is tag-gated, unsigned, and idempotent', () => {
  const config = workflow('.github/workflows/release.yml');
  const jobs = config.jobs ?? {};
  const workflowText = readRepoFile('.github/workflows/release.yml');

  assert.equal(config.name, 'OSS Draft Release');
  assert.deepEqual(config.on?.push?.tags, ['v*']);
  assert.ok(config.on?.workflow_dispatch !== undefined);
  assert.equal(config.on?.pull_request_target, undefined);
  assert.deepEqual(config.permissions, { contents: 'read' });

  assert.ok(jobs['verify-tag']);
  assert.equal(jobs['verify-tag'].outputs?.version, '${{ steps.version.outputs.version }}');
  const verifyCommands = findStep(
    jobs['verify-tag'].steps ?? [],
    'Verify release version',
  ).run;
  assert.match(verifyCommands, /verify-release-tag\.mjs/);
  assert.match(verifyCommands, /GITHUB_REF_NAME/);
  assert.match(verifyCommands, /apps\/desktop\/package\.json/);

  assert.equal(jobs.gate?.uses, './.github/workflows/oss-release-gate.yml');
  assert.equal(jobs.ci?.uses, './.github/workflows/ci.yml');
  assert.equal(jobs.native?.uses, './.github/workflows/native-builds.yml');
  for (const jobName of ['gate', 'ci', 'native']) {
    assert.match(JSON.stringify(jobs[jobName].needs), /verify-tag|gate|ci/);
  }
  assert.ok(workflow('.github/workflows/oss-release-gate.yml').on?.workflow_call);
  assert.ok(workflow('.github/workflows/ci.yml').on?.workflow_call);
  assert.match(
    workflow('.github/workflows/oss-release-gate.yml').concurrency?.group ?? '',
    /^oss-release-gate-/,
  );
  assert.match(workflow('.github/workflows/ci.yml').concurrency?.group ?? '', /^ci-/);
  assert.match(
    workflow('.github/workflows/native-builds.yml').concurrency?.group ?? '',
    /^native-builds-/,
  );

  const tagOnly = /github\.event_name == 'push'.*refs\/tags\/v/;
  assert.match(jobs.assemble?.if ?? '', tagOnly);
  assert.match(jobs.release?.if ?? '', tagOnly);
  assert.deepEqual(jobs.release?.permissions, { contents: 'write' });
  for (const [jobName, job] of Object.entries(jobs)) {
    if (jobName !== 'release') {
      assert.notEqual(job.permissions?.contents, 'write');
    }
  }

  const steps = allWorkflowSteps(config);
  assertActionsPinned(steps);
  const downloadSteps = jobs.assemble?.steps?.filter(step =>
    step.uses?.startsWith('actions/download-artifact@'),
  );
  assert.deepEqual(
    downloadSteps?.map(step => step.with?.name),
    [
      'native-macos-arm64',
      'native-macos-x64',
      'native-windows-x64',
      'native-android',
    ],
  );
  assert.equal(
    findStep(jobs.assemble?.steps ?? [], 'Upload assembled release assets').with?.[
      'retention-days'
    ],
    7,
  );
  assert.equal(
    findStep(jobs.assemble?.steps ?? [], 'Upload assembled release assets').with?.path,
    'build/release-assets',
  );

  const releaseCommands = jobs.release?.steps
    ?.map(step => step.run ?? '')
    .join('\n');
  const assets = [
    'LynavoDrive-${VERSION}-macos-arm64.dmg',
    'LynavoDrive-${VERSION}-macos-x64.dmg',
    'LynavoDrive-${VERSION}-windows-x64.exe',
    'LynavoDrive-${VERSION}-windows-x64.zip',
    'LynavoDrive-${VERSION}-android-arm64-x86_64.apk',
    'LynavoDrive-${VERSION}-android-arm64-x86_64.aab',
    'SHA256SUMS',
  ];
  const declaredAssets = releaseCommands
    .match(/ASSETS=\(([\s\S]*?)\)/)?.[1]
    ?.match(/"([^"]+)"/g)
    ?.map(asset => asset.slice(1, -1));
  assert.deepEqual(declaredAssets, assets);
  for (const asset of assets) {
    assert.ok(workflowText.includes(asset), `missing draft release asset: ${asset}`);
  }

  assert.match(releaseCommands, /gh release view.*--json isDraft/);
  assert.match(releaseCommands, /isDraft/);
  assert.match(releaseCommands, /published release/i);
  assert.match(releaseCommands, /gh release create/);
  assert.match(releaseCommands, /--draft/);
  assert.match(releaseCommands, /--generate-notes/);
  assert.match(releaseCommands, /--verify-tag/);
  assert.match(releaseCommands, /gh release upload/);
  assert.match(releaseCommands, /--clobber/);
  assert.match(releaseCommands, /unsigned OSS build-verification outputs/);
  assert.match(releaseCommands, /SHA256SUMS/);

  assert.doesNotMatch(workflowText, /pull_request_target/);
  assert.doesNotMatch(workflowText, /(?:artifact|asset)[^\n]*linux|linux[^\n]*(?:artifact|asset)/i);
  assert.doesNotMatch(workflowText, /notari[sz]|apple-id|app-store|play-store|auto.?update/i);
  assert.doesNotMatch(workflowText, /secrets\.|CSC_LINK|APPLE_ID|signing-certificate/i);
  assert.doesNotMatch(workflowText, /curl[^\n]*(?:upload|release)|electron-updater/i);
  for (const step of steps.filter(candidate =>
    candidate.uses?.startsWith('actions/upload-artifact@'),
  )) {
    assert.doesNotMatch(String(step.with?.path ?? ''), /[*?]/);
  }
});
