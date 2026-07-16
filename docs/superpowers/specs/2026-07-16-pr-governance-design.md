# Pull Request Governance Design

**Status:** Approved
**Date:** 2026-07-16

## Goal

Turn the repository's existing pull request checks into an enforced,
reviewable contribution workflow. The result must prevent unreviewed changes
from reaching `main`, keep the required CI contexts stable, and make the
expected author and reviewer responsibilities visible in the repository.

## Current State

The repository already runs these stable checks for pull requests and merge
groups:

- `OSS Release Gate`
- `TS Quality`
- `Go Tests`
- `Native Builds`

GitHub currently has no branch protection or repository ruleset for `main`.
There is also no pull request template, issue form, or CODEOWNERS file. The
contributing guide lists pre-submission checks but does not define the complete
branch, review, and merge lifecycle.

## Chosen Approach

Use two enforcement layers:

1. Commit contributor-facing governance files and contract tests so the process
   is versioned, reviewable, and visible to forks.
2. Configure GitHub repository settings so contributors cannot bypass the
   documented process.

A documentation-only approach was rejected because it cannot prevent direct
pushes or unreviewed merges. A settings-only approach was rejected because its
rules are not visible in source and can drift without repository-level
guidance.

## Repository Artifacts

### CODEOWNERS

Create `.github/CODEOWNERS` with the four current repository administrators as
global owners:

- `@Bloomingg`
- `@skiffer-git`
- `@std-s`
- `@EthanForAi`

Any one code owner may satisfy the required approval. Start with global
ownership because no stable component-specific maintainer teams currently
exist. Component ownership can be split later without changing branch policy.

### Pull Request Template

Create `.github/pull_request_template.md` with required prompts for:

- summary and motivation
- impact scope and user-visible behavior
- affected platforms
- validation commands and results
- screenshots or recordings for UI changes
- contamination review across shared DTOs, persistence, queue semantics, sync
  state machines, permission/account gates, and non-target paths
- documentation and generated-artifact checks

The template must use English because project files may contain Chinese only in
explicit localization resources.

### Issue Forms

Create structured bug-report and feature-request forms plus an issue-template
configuration file. Bug reports must collect platform, version, reproduction,
expected/actual behavior, diagnostics availability, and OSS-boundary checks.
Feature requests must collect the problem, proposed outcome, affected surfaces,
and compatibility with the project's product constraints. Security reports
must be redirected to private vulnerability reporting.

### Contributor Guide

Expand `CONTRIBUTING.md` to define:

1. Fork or branch creation using `feat/`, `fix/`, `docs/`, `test/`, `ci/`, or
   `chore/` prefixes.
2. Focused local verification followed by applicable repository checks.
3. Pull request description, self-review, and contamination-review duties.
4. One required approval, code-owner review, stale-review dismissal after new
   pushes, resolved review conversations, and up-to-date required checks.
5. Squash-only merge and automatic source-branch deletion.

Commit messages should use a concise Conventional Commit-style subject so the
squashed history remains readable.

## GitHub Enforcement

Configure an active `main` repository ruleset with no bypass actors:

- require changes to enter through a pull request
- require one approving review
- require code-owner review where CODEOWNERS applies
- dismiss stale approvals after new commits
- require all review conversations to be resolved
- require the four stable status checks and require the branch to be current
- block branch deletion and non-fast-forward updates

Configure repository merge settings to:

- allow squash merge only
- disable merge commits and rebase merge
- delete head branches after merge
- keep automatic merge disabled until the team explicitly adopts it

The existing workflows already support `merge_group`; merge queue activation is
outside this change because the repository does not currently need queueing for
its contribution volume.

## Validation

Add a focused Node contract test that verifies the committed community-health
files exist and retain the required governance prompts and owner entries. Run
that test, the existing release contract tests, formatting checks, and
`pnpm gate:release`.

After applying GitHub settings, read them back through the GitHub API and verify
the exact ruleset, required check names, merge methods, and branch-deletion
behavior. Open the implementation as a pull request so the newly enforced flow
is exercised rather than bypassed.

## Rollout And Failure Handling

Create and push a dedicated `chore/pr-governance` branch before enabling the
ruleset. Open a pull request from that branch after the settings are active.
Because the author cannot satisfy their own required approval, another listed
code owner must review and approve the pull request.

If GitHub rejects the ruleset payload, do not weaken the policy silently. Keep
the repository files and branch intact, report the exact API error, and adjust
only the unsupported setting after confirming the equivalent supported rule.

## Out Of Scope

- CodeQL or another new security scanner
- component-specific maintainer teams
- release-tag governance changes
- merge queue activation
- automatic dependency-update merging
