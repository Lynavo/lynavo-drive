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
    assert.match(
      template,
      new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
  }
  assert.match(template, /shared DTOs and protocol contracts/i);
  assert.match(template, /queue semantics and sync state machines/i);
  assert.match(template, /permission and account-service gates/i);
});

test('issue forms collect actionable reports and route security privately', () => {
  const bug = parse(readRepoFile('.github/ISSUE_TEMPLATE/bug_report.yml'));
  const feature = parse(
    readRepoFile('.github/ISSUE_TEMPLATE/feature_request.yml'),
  );
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
