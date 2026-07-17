import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';

const repoRoot = new URL('../../..', import.meta.url);
const ACTION_SHA = /^[\w.-]+(?:\/[\w.-]+)+@[0-9a-f]{40}$/;
const NODE_24_ACTIONS = new Map([
  ['actions/checkout', '9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0'],
  ['actions/setup-go', 'b7ad1dad31e06c5925ef5d2fc7ad053ef454303e'],
  ['actions/setup-java', '0f481fcb613427c0f801b606911222b5b6f3083a'],
  ['actions/setup-node', '820762786026740c76f36085b0efc47a31fe5020'],
  ['actions/upload-artifact', '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'],
  ['actions/download-artifact', '70fc10c6e5e1ce46ad2ea6f2b72d43f7d47b13c3'],
  ['actions/dependency-review-action', 'a1d282b36b6f3519aa1f3fc636f609c47dddb294'],
  ['dorny/paths-filter', '7b450fff21473bca461d4b92ce414b9d0420d706'],
  ['github/codeql-action/init', '99df26d4f13ea111d4ec1a7dddef6063f76b97e9'],
  ['github/codeql-action/analyze', '99df26d4f13ea111d4ec1a7dddef6063f76b97e9'],
  ['pnpm/action-setup', '0ebf47130e4866e96fce0953f49152a61190b271'],
]);

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

test('workflow JavaScript actions use reviewed Node 24 releases', () => {
  for (const path of [
    '.github/workflows/ci.yml',
    '.github/workflows/oss-release-gate.yml',
    '.github/workflows/native-builds.yml',
    '.github/workflows/release.yml',
    '.github/workflows/codeql.yml',
    '.github/workflows/dependency-review.yml',
  ]) {
    for (const step of allWorkflowSteps(workflow(path))) {
      const [action] = String(step.uses ?? '').split('@');
      const sha = NODE_24_ACTIONS.get(action);
      if (sha) assert.equal(step.uses, `${action}@${sha}`, `${path}: ${action}`);
    }
  }
});

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
  assert.equal(
    mobilePackage.scripts?.lint,
    'ESLINT_USE_FLAT_CONFIG=false eslint . --max-warnings 0',
  );
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

  const serialTestCommand = [
    'pnpm --filter @lynavo-drive/contracts test',
    'pnpm --filter @lynavo-drive/design-tokens test',
    'pnpm --filter @lynavo-drive/desktop test',
    'pnpm --filter @lynavo-drive/mobile test',
    '',
  ].join('\n');
  assert.equal(findStep(tsJob.steps, 'Test').run, serialTestCommand);

  const tsCommands = tsJob.steps.map(step => step.run).filter(Boolean);
  assert.deepEqual(tsCommands, [
    'pnpm install --frozen-lockfile',
    'pnpm build --filter=!@lynavo-drive/mobile',
    'pnpm format:check',
    'pnpm lint',
    'pnpm typecheck',
    'pnpm --filter @lynavo-drive/mobile exec tsc --noEmit',
    serialTestCommand,
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
  const expected = new Map([
    ['npm', '/'],
    ['github-actions', '/'],
    ['gomod', '/services/sidecar-go'],
    ['bundler', '/apps/mobile'],
    ['gradle', '/apps/mobile/android'],
  ]);

  assert.equal(config.version, 2);
  assert.equal(updates.length, expected.size);
  for (const [ecosystem, directory] of expected) {
    const update = updates.find(
      candidate => candidate['package-ecosystem'] === ecosystem,
    );
    assert.ok(update);
    assert.equal(update.directory, directory);
    assert.equal(update.schedule?.interval, 'monthly');
    assert.equal(update['open-pull-requests-limit'], 5);
  }
});

test('security workflows are least-privileged and block risky dependencies', () => {
  const codeql = workflow('.github/workflows/codeql.yml');
  const analyze = codeql.jobs?.analyze;
  const dependencyReview = workflow('.github/workflows/dependency-review.yml');
  const review = dependencyReview.jobs?.['dependency-review'];

  assert.equal(codeql.name, 'CodeQL');
  assertCommonTriggers(codeql);
  assert.deepEqual(codeql.permissions, { contents: 'read' });
  assert.deepEqual(analyze?.permissions, {
    contents: 'read',
    packages: 'read',
    'security-events': 'write',
  });
  assert.deepEqual(analyze?.strategy?.matrix?.include, [
    { language: 'javascript-typescript', 'build-mode': 'none' },
    { language: 'go', 'build-mode': 'autobuild' },
  ]);
  assertActionsPinned(analyze?.steps ?? []);

  assert.equal(dependencyReview.name, 'Dependency Review');
  assert.ok(dependencyReview.on?.pull_request !== undefined);
  assert.deepEqual(dependencyReview.permissions, { contents: 'read' });
  assert.equal(review?.name, 'Dependency Review');
  assert.equal(review?.['runs-on'], 'ubuntu-24.04');
  assert.equal(review?.['timeout-minutes'], 10);
  assert.equal(
    findStep(review?.steps ?? [], 'Review dependency changes').with?.[
      'fail-on-severity'
    ],
    'high',
  );
  assertActionsPinned(review?.steps ?? []);
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
  assert.equal(
    jobs.changes?.outputs?.artifact_prefix,
    '${{ steps.version.outputs.artifact_prefix }}',
  );

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
  assert.match(workflowText, /artifact_prefix=.*productName/);

  for (const artifact of [
    'native-macos-${{ matrix.arch }}',
    'native-windows-x64',
    'native-android',
    '${{ needs.changes.outputs.artifact_prefix }}-${{ needs.changes.outputs.version }}-macos-${{ matrix.arch }}.dmg',
    '${{ needs.changes.outputs.artifact_prefix }}-${{ needs.changes.outputs.version }}-windows-x64.exe',
    '${{ needs.changes.outputs.artifact_prefix }}-${{ needs.changes.outputs.version }}-windows-x64.zip',
    '${{ needs.changes.outputs.artifact_prefix }}-${{ needs.changes.outputs.version }}-android-arm64-x86_64.apk',
    '${{ needs.changes.outputs.artifact_prefix }}-${{ needs.changes.outputs.version }}-android-arm64-x86_64.aab',
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

test('Android native build compiles shared workspaces before mobile typecheck', () => {
  const config = workflow('.github/workflows/native-builds.yml');
  const steps = config.jobs?.android?.steps ?? [];
  const buildIndex = steps.findIndex(step => step.name === 'Build workspaces');
  const typecheckIndex = steps.findIndex(step => step.name === 'Typecheck mobile');

  assert.notEqual(buildIndex, -1, 'missing Android Build workspaces step');
  assert.equal(
    steps[buildIndex].run,
    'pnpm build --filter=!@lynavo-drive/mobile',
  );
  assert.ok(buildIndex < typecheckIndex, 'Android workspaces must build before typecheck');
});

test('iOS native build compiles shared workspaces before Xcode build', () => {
  const config = workflow('.github/workflows/native-builds.yml');
  const steps = config.jobs?.ios?.steps ?? [];
  const buildIndex = steps.findIndex(step => step.name === 'Build workspaces');
  const xcodebuildIndex = steps.findIndex(step => step.name === 'Build iOS Release');

  assert.notEqual(buildIndex, -1, 'missing iOS Build workspaces step');
  assert.equal(
    steps[buildIndex].run,
    'pnpm build --filter=!@lynavo-drive/mobile',
  );
  assert.ok(buildIndex < xcodebuildIndex, 'iOS workspaces must build before Xcode');
});

test('Windows native build compiles shared workspaces before packaging', () => {
  const config = workflow('.github/workflows/native-builds.yml');
  const steps = config.jobs?.windows?.steps ?? [];
  const buildIndex = steps.findIndex(step => step.name === 'Build workspaces');
  const packageIndex = steps.findIndex(step => step.name === 'Package Windows x64');

  assert.notEqual(buildIndex, -1, 'missing Windows Build workspaces step');
  assert.equal(
    steps[buildIndex].run,
    'pnpm build --filter=!@lynavo-drive/mobile',
  );
  assert.ok(buildIndex < packageIndex, 'Windows workspaces must build before packaging');
});

test('macOS DMG packaging retries transient hosted-runner failures', () => {
  const config = workflow('.github/workflows/native-builds.yml');
  const packageDmg = findStep(
    config.jobs?.macos?.steps ?? [],
    'Package macOS DMG',
  );
  const commands = packageDmg.run ?? '';

  assert.match(commands, /for attempt in 1 2 3; do/);
  assert.match(commands, /status=\$\?/);
  assert.match(commands, /if \[ "\$attempt" -eq 3 \]; then[\s\S]*exit "\$status"/);
  assert.match(commands, /sleep 5/);
});

test('iOS native build locks the CocoaPods toolchain to the Podfile version', () => {
  const gemfile = readRepoFile('apps/mobile/Gemfile');
  const gemfileLockUrl = new URL('apps/mobile/Gemfile.lock', repoRoot);
  const podfileLock = readRepoFile('apps/mobile/ios/Podfile.lock');

  assert.match(gemfile, /^gem 'cocoapods', '1\.17\.0'$/m);
  assert.ok(existsSync(gemfileLockUrl), 'apps/mobile/Gemfile.lock must be committed');

  const gemfileLock = readFileSync(gemfileLockUrl, 'utf8');
  assert.match(gemfileLock, /^    cocoapods \(1\.17\.0\)$/m);
  assert.match(gemfileLock, /^  cocoapods \(= 1\.17\.0\)$/m);
  assert.match(podfileLock, /^COCOAPODS: 1\.17\.0$/m);
});

test('iOS native build pins Ruby and installs the locked bundle', () => {
  const config = workflow('.github/workflows/native-builds.yml');
  const gemfileLock = readRepoFile('apps/mobile/Gemfile.lock');
  const steps = config.jobs?.ios?.steps ?? [];
  const setupRuby = findStep(steps, 'Setup Ruby');
  const installRuby = findStep(steps, 'Install Ruby dependencies');
  const installPods = findStep(steps, 'Install iOS pods');

  assert.equal(
    setupRuby.uses,
    'ruby/setup-ruby@003a5c4d8d6321bd302e38f6f0ec593f77f06600',
  );
  assert.equal(setupRuby.with?.['ruby-version'], '3.4.9');
  assert.equal(setupRuby.with?.bundler, '4.0.15');
  assert.ok(steps.indexOf(setupRuby) < steps.indexOf(installRuby));
  assert.equal(installRuby['working-directory'], 'apps/mobile');
  assert.deepEqual(installRuby.env, {
    BUNDLE_DEPLOYMENT: 'true',
    BUNDLE_FROZEN: 'true',
  });
  assert.equal(installRuby.run, 'bundle install --jobs 4 --retry 3');
  assert.deepEqual(installPods.env, installRuby.env);
  assert.match(
    gemfileLock,
    /^RUBY VERSION\n {2}ruby 3\.4\.9(?:p-?\d+)?$/m,
  );
  assert.match(gemfileLock, /^BUNDLED WITH\n {2}4\.0\.15$/m);
});

test('iOS native build permits only external source checksum refreshes', () => {
  const config = workflow('.github/workflows/native-builds.yml');
  const steps = config.jobs?.ios?.steps ?? [];
  const installPods = findStep(steps, 'Install iOS pods');
  const verifyPods = findStep(steps, 'Verify iOS pod lock');
  const debugBuild = findStep(steps, 'Build iOS Debug');

  assert.equal(
    installPods.run.trim(),
    'cp Podfile.lock "$RUNNER_TEMP/Podfile.lock.before-install"\nbundle exec pod install',
  );
  assert.equal(
    verifyPods.run,
    'node scripts/release/verify-pod-lock-portability.mjs --before "$RUNNER_TEMP/Podfile.lock.before-install" --after apps/mobile/ios/Podfile.lock',
  );
  assert.ok(steps.indexOf(installPods) < steps.indexOf(verifyPods));
  assert.ok(steps.indexOf(verifyPods) < steps.indexOf(debugBuild));
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
  assert.deepEqual(jobs.native?.permissions, {
    contents: 'read',
    'pull-requests': 'read',
  });
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
    '${ARTIFACT_PREFIX}-${VERSION}-macos-arm64.dmg',
    '${ARTIFACT_PREFIX}-${VERSION}-macos-x64.dmg',
    '${ARTIFACT_PREFIX}-${VERSION}-windows-x64.exe',
    '${ARTIFACT_PREFIX}-${VERSION}-windows-x64.zip',
    '${ARTIFACT_PREFIX}-${VERSION}-android-arm64-x86_64.apk',
    '${ARTIFACT_PREFIX}-${VERSION}-android-arm64-x86_64.aab',
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
