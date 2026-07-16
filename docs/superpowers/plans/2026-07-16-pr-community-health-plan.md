# Pull Request Community Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add versioned pull request ownership, author guidance, issue intake, and contract tests for the repository's contribution workflow.

**Architecture:** Keep human-facing governance in `.github` and `CONTRIBUTING.md`. Add one Node contract suite under `scripts/release/__tests__` so missing prompts, owners, or review rules fail the existing release-test entrypoint.

**Tech Stack:** GitHub community-health files, YAML issue forms, Node `node:test`, `yaml`, pnpm

---

### Task 1: Add Failing Community Health Contracts

**Files:**
- Create: `scripts/release/__tests__/community-health-contracts.test.mjs`

- [ ] **Step 1: Create the contract test**

Create a Node test that reads repository files and asserts:

```js
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';

const repoRoot = new URL('../../..', import.meta.url);

function readRepoFile(path) {
  return readFileSync(new URL(path, repoRoot), 'utf8');
}

test('repository provides pull request community health files', () => {
  for (const path of [
    '.github/CODEOWNERS',
    '.github/pull_request_template.md',
    '.github/ISSUE_TEMPLATE/bug_report.yml',
    '.github/ISSUE_TEMPLATE/feature_request.yml',
    '.github/ISSUE_TEMPLATE/config.yml',
  ]) {
    assert.equal(existsSync(new URL(path, repoRoot)), true, `missing ${path}`);
  }
});

test('global code ownership names every current repository administrator', () => {
  const codeowners = readRepoFile('.github/CODEOWNERS');
  assert.match(
    codeowners,
    /^\* @Bloomingg @skiffer-git @std-s @EthanForAi$/m,
  );
});

test('pull request template captures impact, validation, and contamination review', () => {
  const template = readRepoFile('.github/pull_request_template.md');
  for (const heading of [
    '## Summary',
    '## Impact Scope',
    '## Validation',
    '## Visual Evidence',
    '## Contamination Review',
    '## Checklist',
  ]) {
    assert.match(template, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(template, /shared DTOs and protocol contracts/i);
  assert.match(template, /queue semantics and sync state machines/i);
  assert.match(template, /permission and account-service gates/i);
});

test('issue forms collect actionable reports and route security privately', () => {
  const bug = parse(readRepoFile('.github/ISSUE_TEMPLATE/bug_report.yml'));
  const feature = parse(readRepoFile('.github/ISSUE_TEMPLATE/feature_request.yml'));
  const config = parse(readRepoFile('.github/ISSUE_TEMPLATE/config.yml'));

  assert.equal(bug.name, 'Bug report');
  assert.equal(feature.name, 'Feature request');
  assert.ok(bug.body.some(field => field.id === 'reproduction'));
  assert.ok(bug.body.some(field => field.id === 'diagnostics'));
  assert.ok(feature.body.some(field => field.id === 'constraints'));
  assert.equal(config.blank_issues_enabled, true);
  assert.ok(
    config.contact_links.some(link =>
      String(link.url).includes('/security/advisories/new'),
    ),
  );
});

test('contributing guide defines the enforced review and merge lifecycle', () => {
  const contributing = readRepoFile('CONTRIBUTING.md');
  for (const rule of [
    /feat\//,
    /one approving review/i,
    /code owner/i,
    /stale approvals/i,
    /review conversations/i,
    /squash merge/i,
    /automatically deletes the source branch/i,
  ]) {
    assert.match(contributing, rule);
  }
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test scripts/release/__tests__/community-health-contracts.test.mjs
```

Expected: FAIL because `.github/CODEOWNERS` and the other community-health files do not exist.

### Task 2: Add Ownership And Pull Request Guidance

**Files:**
- Create: `.github/CODEOWNERS`
- Create: `.github/pull_request_template.md`

- [ ] **Step 1: Add global ownership**

Create `.github/CODEOWNERS` with:

```text
# Global ownership remains intentionally broad until component teams are established.
* @Bloomingg @skiffer-git @std-s @EthanForAi
```

- [ ] **Step 2: Add the pull request template**

Create `.github/pull_request_template.md` with sections for summary, motivation,
impact scope, affected platforms, validation command/results, visual evidence,
contamination review, and an author checklist. The contamination section must
explicitly cover shared DTOs/protocols, persistence/history, queue/sync state,
permission/account gates, OSS boundaries, and non-target paths.

- [ ] **Step 3: Run the focused test**

Run the community-health contract test. Expected: the existence, CODEOWNERS,
and pull-request-template tests pass; issue-form and contributor-guide tests
remain red.

### Task 3: Add Structured Issue Intake

**Files:**
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`

- [ ] **Step 1: Add the bug report form**

Collect affected platform, app version or commit, reproduction steps, expected
behavior, actual behavior, diagnostics availability, and an acknowledgement
that sensitive diagnostics and secrets were not attached.

- [ ] **Step 2: Add the feature request form**

Collect the problem, desired outcome, affected surfaces, alternatives, and an
acknowledgement that the request respects the local-LAN, automatic queue, and
OSS capability boundaries.

- [ ] **Step 3: Add issue routing configuration**

Allow blank issues and add links to GitHub private vulnerability reporting and
the repository's `SECURITY.md` instructions.

- [ ] **Step 4: Run the focused test**

Expected: issue-form contracts pass; the contributor-guide lifecycle test
remains red.

### Task 4: Document The Complete Contributor Lifecycle

**Files:**
- Modify: `CONTRIBUTING.md`

- [ ] **Step 1: Expand branch and commit guidance**

Document fork/branch preparation, the allowed `feat/`, `fix/`, `docs/`,
`test/`, `ci/`, and `chore/` prefixes, and concise Conventional Commit-style
subjects.

- [ ] **Step 2: Expand pull request review and merge guidance**

Document author self-review, the four required checks, one approving review,
code-owner review, stale approval dismissal, resolved conversations, strict
up-to-date checks, squash-only merge, and automatic source-branch deletion.

- [ ] **Step 3: Run the focused test and verify GREEN**

Run:

```bash
node --test scripts/release/__tests__/community-health-contracts.test.mjs
```

Expected: PASS.

### Task 5: Validate And Commit Repository Artifacts

**Files:**
- All files from Tasks 1-4
- `docs/superpowers/plans/2026-07-16-pr-community-health-plan.md`
- `docs/superpowers/plans/2026-07-16-github-pr-enforcement-plan.md`

- [ ] **Step 1: Run release contract tests**

```bash
pnpm test:release
```

Expected: all Node release/dev tests pass.

- [ ] **Step 2: Run format and release checks**

```bash
pnpm format:check
pnpm gate:release
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Self-review the diff**

Confirm there are no runtime, DTO, persistence, queue, sync-state, permission,
account-service, or release-behavior changes.

- [ ] **Step 4: Commit**

```bash
git add .github CONTRIBUTING.md scripts/release/__tests__/community-health-contracts.test.mjs docs/superpowers/plans
git commit -m "chore: establish pull request governance"
```

