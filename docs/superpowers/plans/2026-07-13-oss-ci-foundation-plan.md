# OSS CI Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the approved hosted-build policy, a green repository lint baseline, and stable secret-free OSS release-gate, TypeScript quality, and Go test checks.

**Architecture:** Keep `OSS Release Gate` as a separate stable status check and add a read-only `CI` workflow with independent `TS Quality` and `Go Tests` jobs. Contract tests parse workflow YAML and policy documents so permissions, triggers, toolchain versions, action pinning, and prohibited release behavior remain reviewable in ordinary Node tests.

**Tech Stack:** GitHub Actions, Node.js 22.12.0, pnpm 10.32.1, Turbo, ESLint 9, YAML 2.x, Node test runner, Go 1.25.6

---

## File Map

- Modify `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `docs/release/release-playbook.md`, and `docs/testing/oss-verification-matrix.md` to define GitHub-hosted, secret-free, unsigned OSS verification as an approved environment while preserving local Linux verification and all non-OSS prohibitions.
- Modify `package.json`, `pnpm-lock.yaml`, `apps/mobile/package.json`, and `apps/mobile/.eslintrc.js` to align mobile linting with the repository ESLint baseline and add the YAML parser used by contract tests.
- Modify the focused TypeScript files reported by the clean-branch lint baseline; changes are type/test cleanup only and must not alter runtime behavior.
- Create `scripts/release/__tests__/workflow-contracts.test.mjs` as the structured contract suite for all committed workflows.
- Modify `.github/workflows/oss-release-gate.yml` to add merge queue coverage, concurrency, pnpm caching, timeouts, and full-SHA action pins without adding native builds.
- Create `.github/workflows/ci.yml` with the stable `TS Quality` and `Go Tests` jobs.
- Create `.github/dependabot.yml` for reviewed monthly pnpm and GitHub Actions updates.

### Task 1: Lock The Hosted Verification Policy

**Files:**

- Modify: `scripts/release/__tests__/release-gate-config.test.mjs`
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`
- Modify: `docs/release/release-playbook.md`
- Modify: `docs/testing/oss-verification-matrix.md`

- [ ] **Step 1: Write the failing policy contract test**

Add a test that loads all five policy entry points and asserts each contains an approved GitHub-hosted verification statement. Also assert the combined text still rejects signing, notarization, store upload, auto-update, and external build services, and still describes Linux as local verification only.

```js
test('policy permits only secret-free unsigned GitHub-hosted verification builds', () => {
  const paths = [
    'AGENTS.md',
    'README.md',
    'CONTRIBUTING.md',
    'docs/release/release-playbook.md',
    'docs/testing/oss-verification-matrix.md',
  ];
  const docs = paths.map(readRepoFile);

  for (const doc of docs) {
    assert.match(doc, /GitHub-hosted/i);
    assert.match(doc, /unsigned/i);
  }

  const policy = docs.join('\n');
  assert.match(policy, /no repository secrets/i);
  assert.match(policy, /Linux.+local.+verification/is);
  assert.match(policy, /signing|code signing/i);
  assert.match(policy, /notarization/i);
  assert.match(policy, /store upload|app-store upload/i);
  assert.match(policy, /auto-update/i);
  assert.match(policy, /external.+build|third-party.+build/i);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test --test-name-pattern='policy permits only' scripts/release/__tests__/release-gate-config.test.mjs`

Expected: FAIL because the current policy requires every build and package to run locally.

- [ ] **Step 3: Apply the approved policy wording**

Use this normative boundary consistently in each document, adapted to the local section:

```markdown
GitHub-hosted Actions may run public, secret-free OSS source builds and create
unsigned package-verification artifacts for this repository. These artifacts
are verification outputs, not official signed distributions. Contributor-local
builds remain supported, and Linux remains local verification only.

Third-party remote build services, signing, notarization, store upload,
auto-update, and private distribution infrastructure remain unavailable.
```

Do not change release profile commands or claim Linux user support.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test --test-name-pattern='policy permits only' scripts/release/__tests__/release-gate-config.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the policy boundary**

```bash
git add AGENTS.md README.md CONTRIBUTING.md docs/release/release-playbook.md docs/testing/oss-verification-matrix.md scripts/release/__tests__/release-gate-config.test.mjs
git commit -m "docs: allow hosted OSS verification builds"
```

### Task 2: Make Repository Lint Deterministic And Green

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/.eslintrc.js`
- Modify: `packages/contracts/src/__tests__/exports.test.ts`
- Modify: `packages/design-tokens/src/__tests__/tokens.test.ts`
- Modify: `apps/desktop/src/main/__tests__/ipc-handlers.test.ts`
- Modify: `apps/desktop/src/main/__tests__/video-thumbnail-generator.test.ts`
- Modify: `apps/desktop/src/renderer/features/dashboard/__tests__/Dashboard.test.tsx`
- Modify: `apps/desktop/src/renderer/features/devices/DevicesPage.tsx`
- Modify: `apps/desktop/src/renderer/features/layout/__tests__/Sidebar.test.tsx`
- Modify: `apps/desktop/src/renderer/features/library/__tests__/ReceivedLibraryPage.test.tsx`
- Modify: `apps/desktop/src/renderer/features/shared/__tests__/SharedResourcesPage.test.tsx`
- Modify: `apps/desktop/src/renderer/stores/__tests__/resources-store.test.ts`

- [ ] **Step 1: Record the failing baseline**

Run: `pnpm lint`

Expected: FAIL with one contracts unused helper, one design-token unused binding, 35 desktop errors, and a mobile ESLint 8/9 rule-loading exception.

- [ ] **Step 2: Align mobile with ESLint 9 without weakening rules**

Set the mobile development dependency to the repository major and make the legacy React Native configuration explicit:

```json
"eslint": "^9.22.0"
```

```js
module.exports = {
  root: true,
  extends: '@react-native',
};
```

Set the mobile lint script to `ESLINT_USE_FLAT_CONFIG=false eslint .` so ESLint 9 intentionally loads the committed React Native eslintrc until that upstream preset has a native flat-config migration. Run `pnpm install` to update the lockfile.

- [ ] **Step 3: Remove true unused values**

Delete unused imports/locals, change the design-token loop to `for (const value of Object.values(colors))`, and call the contracts compile-time helper from a test with typed fixtures so its imported DTO types remain validated.

- [ ] **Step 4: Replace desktop test `any` casts with narrow test types**

Use `Window & { electronAPI: ElectronAPI }` for bridge assignments and `typeof useResourcesStore & { persist: { clearStorage(): Promise<void> } }` for Zustand persist access. Where a mock only implements part of a production interface, use `Partial<T>` plus an explicit final cast to `T`; do not disable `no-explicit-any` and do not change production DTOs.

- [ ] **Step 5: Verify each workspace and then the aggregate lint**

Run:

```bash
pnpm --filter @lynavo-drive/contracts lint
pnpm --filter @lynavo-drive/design-tokens lint
pnpm --filter @lynavo-drive/desktop lint
pnpm --filter @lynavo-drive/mobile lint
pnpm lint
```

Expected: all commands PASS with zero errors.

- [ ] **Step 6: Run affected tests and type checks**

Run:

```bash
pnpm --filter @lynavo-drive/contracts test
pnpm --filter @lynavo-drive/design-tokens test
pnpm --filter @lynavo-drive/desktop test
pnpm --filter @lynavo-drive/desktop typecheck
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
```

Expected: all commands PASS.

- [ ] **Step 7: Commit the lint baseline**

```bash
git add package.json pnpm-lock.yaml apps/mobile/package.json apps/mobile/.eslintrc.js packages/contracts/src/__tests__/exports.test.ts packages/design-tokens/src/__tests__/tokens.test.ts apps/desktop/src
git commit -m "fix: establish green repository lint baseline"
```

### Task 3: Add Structured Workflow Contract Tests

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `scripts/release/__tests__/workflow-contracts.test.mjs`

- [ ] **Step 1: Add the YAML test dependency**

Run: `pnpm add -Dw yaml@^2.8.1`

Expected: `package.json` and `pnpm-lock.yaml` contain a direct `yaml` dev dependency.

- [ ] **Step 2: Write helpers and failing OSS gate contracts**

Create the test file with `parse(readFileSync(...))`, a `workflow(path)` helper, and assertions for `pull_request`, `merge_group`, `push.main`, `workflow_dispatch`, `contents: read`, concurrency cancellation, exact stable job name, full-SHA `uses` values, Node 22.12.0, pnpm 10.32.1, and absence of native/package commands.

Use this full-SHA assertion:

```js
const ACTION_SHA = /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/;

function assertActionsPinned(steps) {
  for (const step of steps) {
    if (step.uses) assert.match(step.uses, ACTION_SHA);
  }
}
```

- [ ] **Step 3: Run the OSS gate contract and verify RED**

Run: `node --test --test-name-pattern='OSS Release Gate workflow' scripts/release/__tests__/workflow-contracts.test.mjs`

Expected: FAIL on missing merge queue, concurrency, pnpm setup/cache, and SHA pins.

- [ ] **Step 4: Commit the test harness with the next workflow task**

Do not commit a permanently red test alone; include this file in Task 4's commit after GREEN.

### Task 4: Harden The Stable OSS Release Gate

**Files:**

- Modify: `.github/workflows/oss-release-gate.yml`
- Modify: `scripts/release/__tests__/release-gate-config.test.mjs`
- Test: `scripts/release/__tests__/workflow-contracts.test.mjs`

- [ ] **Step 1: Update the workflow**

Keep workflow and job display names exactly `OSS Release Gate`. Add `merge_group`, concurrency keyed by workflow and PR/branch, `ubuntu-24.04`, a 30-minute timeout, and these pinned setup actions:

```yaml
- uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5
- uses: pnpm/action-setup@f40ffcd9367d9f12939873eb1018b921a783ffaa
  with:
    version: 10.32.1
- uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
  with:
    node-version: 22.12.0
    cache: pnpm
```

Install with `pnpm install --frozen-lockfile` and run only `pnpm gate:release`.

- [ ] **Step 2: Remove brittle raw-YAML assertions superseded by parsed contracts**

Keep the package script test and explicit assertion that `gate:release` contains no native build/package execution. Let `workflow-contracts.test.mjs` own YAML structure and pinning assertions.

- [ ] **Step 3: Verify GREEN**

Run:

```bash
node --test --test-name-pattern='OSS Release Gate workflow' scripts/release/__tests__/workflow-contracts.test.mjs
pnpm test:release
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml .github/workflows/oss-release-gate.yml scripts/release/__tests__/release-gate-config.test.mjs scripts/release/__tests__/workflow-contracts.test.mjs
git commit -m "ci: harden OSS release gate"
```

### Task 5: Add Fast TypeScript And Go CI

**Files:**

- Modify: `scripts/release/__tests__/workflow-contracts.test.mjs`
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write failing parsed contracts for `CI`**

Assert the same four triggers, read-only permissions and concurrency policy. Assert job names `TS Quality` and `Go Tests`, `ubuntu-24.04`, timeouts, full-SHA pins, Node 22.12.0, pnpm 10.32.1, Go 1.25.6, and exact commands:

```text
pnpm install --frozen-lockfile
pnpm build
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
go test ./...
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test --test-name-pattern='repository CI workflow' scripts/release/__tests__/workflow-contracts.test.mjs`

Expected: FAIL because `.github/workflows/ci.yml` does not exist.

- [ ] **Step 3: Create the workflow**

Use pinned `checkout`, `pnpm/action-setup`, `setup-node`, and `setup-go@40f1582b2485089dde7abd97c1529aa768e1baff`. Give `TS Quality` a 45-minute timeout and `Go Tests` a 20-minute timeout. Configure setup-go caching against `services/sidecar-go/go.sum`, and run Go tests with `working-directory: services/sidecar-go`.

- [ ] **Step 4: Verify GREEN and local equivalents**

Run:

```bash
node --test --test-name-pattern='repository CI workflow' scripts/release/__tests__/workflow-contracts.test.mjs
pnpm build
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
(cd services/sidecar-go && go test ./...)
```

Expected: all commands PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml scripts/release/__tests__/workflow-contracts.test.mjs
git commit -m "ci: add TypeScript and Go quality checks"
```

### Task 6: Add Dependency Update Automation And Contributor Guidance

**Files:**

- Modify: `scripts/release/__tests__/workflow-contracts.test.mjs`
- Create: `.github/dependabot.yml`
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`

- [ ] **Step 1: Write a failing Dependabot contract**

Parse `.github/dependabot.yml` and assert monthly `npm` updates at `/` and monthly `github-actions` updates at `/`, both with an open PR limit of 5.

- [ ] **Step 2: Verify RED**

Run: `node --test --test-name-pattern='Dependabot' scripts/release/__tests__/workflow-contracts.test.mjs`

Expected: FAIL because the file does not exist.

- [ ] **Step 3: Add Dependabot and CI documentation**

Create the two update entries. Document the four intended required checks (`OSS Release Gate`, `TS Quality`, `Go Tests`, and later `Native Builds`), explain that repository rules are configured in GitHub after checks first appear, and add badges for the two existing workflows without implying signed releases.

- [ ] **Step 4: Verify and commit**

Run:

```bash
node --test --test-name-pattern='Dependabot' scripts/release/__tests__/workflow-contracts.test.mjs
pnpm test:release
pnpm format:check
```

Expected: PASS.

```bash
git add .github/dependabot.yml README.md CONTRIBUTING.md scripts/release/__tests__/workflow-contracts.test.mjs
git commit -m "chore: configure reviewed dependency updates"
```

### Task 7: Foundation Regression Gate

**Files:**

- Review only; no planned runtime file changes.

- [ ] **Step 1: Run the complete foundation checks**

```bash
pnpm test:release
pnpm gate:release
pnpm build
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
(cd services/sidecar-go && go test ./...)
```

Expected: all commands PASS.

- [ ] **Step 2: Review contamination boundaries**

Run `git diff 97f22e1a --stat` and `git diff 97f22e1a -- packages/contracts/src apps/desktop/src apps/mobile/src services/sidecar-go`. Confirm only lint-only test typing and unused-import cleanup appears; shared DTO exports, protocol constants, persistence, queue semantics, sync state machine, permissions/account gates, and history statistics are unchanged.

- [ ] **Step 3: Record hosted follow-up**

The GitHub `workflow_dispatch` run and branch-rule configuration are rollout actions that require the committed branch to be published. Do not claim they were executed locally.
