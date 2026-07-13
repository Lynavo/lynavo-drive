# OSS CI/CD Design

**Date:** 2026-07-13
**Status:** Awaiting written-spec review

## Context

Lynavo Drive currently has one GitHub Actions workflow named `OSS Release Gate`.
It runs `pnpm gate:release` on Ubuntu for pull requests, pushes to `main`, and
manual dispatches. Native mobile builds, desktop packages, and release artifacts
remain local-only workflows.

The repository is becoming a public open-source project and needs stronger pull
request validation plus a conservative continuous-delivery path. The selected
delivery target is unsigned build-verification artifacts attached to a draft
GitHub Release. It is not an official signed distribution channel.

The current repository policy explicitly prohibits remote build and package
environments, and the verification matrix explicitly limits GitHub Actions to
the release gate. This design intentionally changes that policy before adding
hosted builds. GitHub-hosted runners will become an approved environment for
public, reproducible, secret-free OSS source builds and package verification.

## Goals

1. Give pull requests stable automated checks for OSS boundaries, formatting,
   linting, type safety, TypeScript tests, and Go tests.
2. Verify affected iOS, Android, macOS, and Windows build paths on
   GitHub-hosted runners.
3. Rebuild release artifacts from an immutable `v<major>.<minor>.<patch>` tag.
4. Attach unsigned macOS, Windows, and Android verification artifacts and a
   checksum manifest to a draft GitHub Release.
5. Preserve the existing local release profiles and local verification paths.
6. Keep workflow permissions minimal and make fork pull requests safe.
7. Make release retries idempotent and prevent partial or ambiguous releases.

## Non-Goals

1. Do not add Linux CI builds or Linux release artifacts in the first version.
   Existing local Linux verification paths remain intact.
2. Do not add Apple or Windows code signing, Apple notarization, an Android
   keystore, app-store upload, auto-update, or any external distribution
   service.
3. Do not produce or publish an unsigned iOS IPA. iOS is build verification
   only.
4. Do not introduce self-hosted runners or expose maintainer infrastructure to
   fork pull requests.
5. Do not add SBOM generation, artifact attestations, SLSA provenance, or
   release automation beyond GitHub draft releases in the first version.
6. Do not change runtime behavior, shared DTOs, protocol events, ports,
   persistence, queue semantics, pairing, history statistics, permission gates,
   or the sync state machine.

## Chosen Approach

Use layered GitHub Actions workflows with GitHub-hosted runners:

1. Preserve the existing `OSS Release Gate` status-check identity.
2. Add fast repository quality and sidecar test jobs.
3. Add path-aware native build and package jobs for pull requests, with complete
   platform coverage after merges to `main`.
4. On a stable version tag, rerun the complete gates and builds from the tag,
   assemble an explicit artifact allowlist, and create or update a draft GitHub
   Release.

This gives contributors useful feedback without treating unsigned artifacts as
official end-user binaries. It also keeps signing, store credentials, private
services, and non-OSS release capabilities outside the public repository.

## Policy Change

The project policy and release documentation must be changed before hosted
native builds are enabled. The new boundary is:

- contributor-local builds and GitHub-hosted Actions builds are approved OSS
  source-build and package-verification environments;
- GitHub-hosted builds must use public source, require no repository secrets,
  and produce unsigned verification artifacts only;
- third-party remote compilation or packaging services remain prohibited;
- official signing, notarization, app-store upload, external release upload,
  auto-update, and private distribution infrastructure remain unavailable;
- attaching approved unsigned artifacts to this repository's GitHub Release is
  allowed, but the release must clearly identify them as unsigned OSS
  verification artifacts.

At minimum, update these sources of truth and contributor entry points:

- `AGENTS.md`
- `README.md`
- `CONTRIBUTING.md`
- `docs/release/release-playbook.md`
- `docs/testing/oss-verification-matrix.md`

Wording that currently says release profiles are local-only should continue to
describe the profiles themselves accurately. The GitHub workflows invoke those
source-build commands in an approved hosted environment; they do not turn the
profiles into signing, upload, or official distribution profiles.

## Workflow Architecture

### 1. OSS Release Gate

Keep `.github/workflows/oss-release-gate.yml` and preserve the visible workflow
and job name `OSS Release Gate`. This avoids invalidating an existing branch
protection rule while the additional checks are introduced.

The workflow continues to run on pull requests, merge queues, pushes to `main`,
and manual dispatch. It runs `pnpm gate:release` with the repository Node and
pnpm versions. It must not run native builds or create packages.

Add concurrency so a newer run for the same pull request or branch cancels an
obsolete in-progress run. Keep permissions at `contents: read`.

### 2. Repository CI

Add `.github/workflows/ci.yml` for pull requests, merge queues, pushes to
`main`, and manual dispatch. It exposes two stable jobs:

- `TS Quality`: install with `pnpm install --frozen-lockfile`, then run the
  workspace build, formatting check, lint, typecheck, and TypeScript tests;
- `Go Tests`: set up the repository Go baseline and run `go test ./...` in
  `services/sidecar-go`.

The workflow uses read-only contents permission, pinned actions, dependency
caches keyed by lockfiles and toolchain versions, timeouts, and concurrency
cancellation. A failed command fails the job immediately. Build and test output
is retained in the Actions log, but logs, databases, diagnostics, and generated
packages are not uploaded as artifacts.

`OSS Release Gate`, `TS Quality`, and `Go Tests` are the baseline required
checks for branch protection.

### 3. Native Builds

Add `.github/workflows/native-builds.yml`. It supports normal repository events
and reusable `workflow_call` execution so the release workflow can invoke the
same build definitions.

For pull requests, a read-only path-classification job selects affected builds:

- changes under `apps/mobile/**`, `packages/contracts/**`, mobile build scripts,
  shared workflow files, or `pnpm-lock.yaml` select iOS and Android;
- changes under `apps/desktop/**`, `services/sidecar-go/**`,
  `packages/contracts/**`, `packages/design-tokens/**`, release/package scripts,
  shared workflow files, or `pnpm-lock.yaml` select macOS and Windows;
- changes to native-build workflow definitions or shared toolchain settings
  select all four platforms.

Pushes to `main`, reusable release calls, and manual dispatches run all four
platforms. Documentation-only pull requests do not consume native runners.

The jobs are:

- `iOS Build`: use a GitHub-hosted macOS image with the Xcode generation
  required by the committed project, install the locked Node and CocoaPods
  dependencies, run Pod installation against `Podfile.lock`, and run generic
  unsigned Debug and Release device builds with `CODE_SIGNING_ALLOWED=NO`;
- `Android Build`: use Ubuntu with Node 22.12.0, Go 1.25.6 where required by the
  workspace, and JDK 17, then run TypeScript validation plus `assembleDebug`,
  `assembleRelease`, and `bundleRelease` with the committed Release
  architectures;
- `macOS Package`: use a GitHub-hosted macOS runner and the existing package
  wrapper to produce unsigned arm64 and x64 DMGs with the expected sidecar
  binaries;
- `Windows Package`: use a GitHub-hosted Windows runner and the existing
  package wrapper to produce unsigned x64 NSIS and ZIP packages, verify the
  packaged sidecar, and keep Bonjour redistribution disabled.

A final `Native Builds` aggregation job always runs and reports failure if any
selected platform failed or was cancelled. When no native scope is selected,
it succeeds with a clear no-build result. This gives branch protection one
stable required-check name without forcing native builds for documentation-only
pull requests.

The first version has no Linux job. The existing release-gate dry-run may still
inspect the Linux local release profile because that check protects the local
source-build contract; it does not add Linux to the hosted build or release
matrix.

### 4. Draft Release

Add `.github/workflows/release.yml` with two entry paths:

- a pushed tag matching `v*` runs the release path;
- manual dispatch runs a build-only rehearsal and retains short-lived Actions
  artifacts without creating a GitHub Release.

The release path accepts only exact stable semantic-version tags in the form
`v<major>.<minor>.<patch>`. A release-tag verification script compares the tag
with the desktop package version, mobile package version, iOS marketing version,
and Android `versionName`. Existing build-number consistency remains enforced
by the current release tests. A mismatch fails before native builds begin.

The release workflow invokes the complete OSS gate, repository CI, and native
build definitions against the tag commit. It does not reuse artifacts from a
pull request or `main` run.

Only the final assembly job receives `contents: write`; all prerequisite and
build jobs remain read-only. Assembly starts only after all required jobs pass.

## Release Artifacts

The assembly job downloads only explicitly named build artifacts and accepts
only these release assets:

- `LynavoDrive-<version>-macos-arm64.dmg`
- `LynavoDrive-<version>-macos-x64.dmg`
- `LynavoDrive-<version>-windows-x64.exe`
- `LynavoDrive-<version>-windows-x64.zip`
- `LynavoDrive-<version>-android-arm64-x86_64.apk`
- `LynavoDrive-<version>-android-arm64-x86_64.aab`
- `SHA256SUMS`

Before release creation, assembly verifies that every expected file exists, is
non-empty, has the expected versioned name, and has no unapproved sibling file
in the staging directory. It then calculates SHA-256 hashes from the final
renamed assets and writes `SHA256SUMS`.

The release body uses generated change notes plus a fixed warning that the
assets are unsigned OSS verification outputs. It explains that macOS
Gatekeeper, Windows SmartScreen, and Android sideloading controls may block or
warn about installation. Source archives supplied automatically by GitHub are
not duplicated as uploaded assets.

The workflow creates a draft release only after successful assembly. If a draft
for the tag already exists, a rerun replaces the allowlisted assets and updates
that draft. It must not overwrite or mutate an already published release. The
short-lived intermediate Actions artifacts use a seven-day retention period;
release assets follow GitHub Release retention.

## Security Model

1. Never use `pull_request_target` for build, test, or release workflows.
2. Fork pull requests receive no secrets and only read repository contents.
3. Pin every third-party and first-party action to a full commit SHA. Configure
   Dependabot to propose GitHub Actions updates while preserving review.
4. Give `contents: write` only to the final tag-gated assembly job.
5. Do not configure signing certificates, provisioning profiles, keystores,
   notarization credentials, app-store credentials, or external service tokens.
6. Upload artifacts from exact paths, never broad release, build, temporary, or
   workspace directories.
7. Keep source-package boundary checks active before release builds so secrets,
   proprietary binaries, local databases, diagnostics, and generated packages
   fail the release early.
8. Protect `v*` tag creation with a GitHub repository ruleset restricted to
   maintainers. This repository setting is documented but cannot be enforced
   solely by committed workflow YAML.

## Error Handling And Retry Behavior

- Any failed or cancelled required check prevents release assembly.
- Missing, empty, misnamed, duplicate, or unexpected assets fail assembly.
- A version/tag mismatch fails before runner-expensive native jobs.
- A manual dispatch never creates or updates a GitHub Release.
- A rerun may safely update an existing draft for the same tag.
- A published release is immutable to automation; changing it requires an
  explicit maintainer action outside the workflow.
- Transient GitHub-hosted runner failures are handled with GitHub's failed-job
  rerun. The workflow must not require deleting and recreating a tag.
- Build commands receive explicit timeouts so stalled CocoaPods, Gradle,
  Electron packaging, or native compilation does not consume a runner
  indefinitely.

## Workflow Contract Tests

Extend `scripts/release/__tests__` with tests that parse the committed workflow
YAML and verify:

1. expected triggers and stable required-check names;
2. absence of `pull_request_target`;
3. read-only default permissions and release-write isolation;
4. full-SHA action pinning;
5. repository Node, pnpm, Go, and Java baselines;
6. native path filters and the always-present aggregation job;
7. no Linux hosted job or Linux release asset in the first version;
8. release artifact allowlist and seven-day intermediate retention;
9. draft-only release creation and published-release overwrite protection;
10. absence of signing, notarization, store-upload, auto-update, and external
    release-service commands.

Add focused tests for the tag-version verifier, including a valid tag, malformed
tag, prerelease tag, and mismatches across desktop, mobile, iOS, and Android.
Keep the existing tests that prove `gate:release` itself does not execute native
builds.

Validation during implementation includes:

- `pnpm test:release`
- `pnpm gate:release`
- `pnpm format:check`
- workflow YAML parsing and contract tests
- focused local Go, TypeScript, iOS, Android, macOS, and Windows verification
  where the current host supports it
- GitHub `workflow_dispatch` build-only rehearsal for all four hosted platforms
- one disposable stable-format test tag that creates a draft, followed by
  verification of filenames, checksums, warnings, and rerun behavior before any
  public release is published

## Rollout

1. Commit the approved policy and documentation changes with workflow contract
   tests and the release-tag verifier.
2. Add repository CI while preserving the existing `OSS Release Gate` status
   identity.
3. Add path-aware native builds and validate all four platforms through manual
   dispatch.
4. Add the tag workflow and perform one draft-release rehearsal.
5. Configure branch rules for `OSS Release Gate`, `TS Quality`, `Go Tests`, and
   `Native Builds` after their status names have appeared in GitHub.
6. Configure the maintainer-only `v*` tag ruleset.
7. Publish the GitHub Release from its draft only after a maintainer verifies
   artifacts, checksums, warnings, and platform job results.

## Expected Impact

Direct changes are limited to repository policy and release documentation,
GitHub workflow configuration, release validation scripts/tests, dependency
automation configuration, and package metadata needed for deterministic CI.

There is no intended application runtime or protocol behavior change. Shared
DTOs, sidecar APIs, sync state transitions, queue ordering, single-file upload,
LAN fail-open behavior, remote/background fail-closed behavior, persistence,
permissions, and history statistics remain untouched.

The operational impact is additional GitHub Actions usage, especially macOS and
Windows minutes after merges to `main` and for release tags. Path-aware pull
request jobs and concurrency cancellation bound that cost.

## Acceptance Criteria

1. The policy explicitly permits secret-free unsigned OSS verification on
   GitHub-hosted runners while continuing to prohibit official and external
   distribution infrastructure.
2. Pull requests report stable OSS gate, TypeScript quality, Go test, and native
   aggregation checks.
3. Documentation-only pull requests do not start native platform runners.
4. Relevant source changes start the correct iOS, Android, macOS, and Windows
   jobs; pushes to `main` run all four.
5. Linux remains local-only and absent from hosted builds and release assets.
6. A mismatched or malformed version tag fails before native release builds.
7. A valid stable tag rebuilds from the tag commit and creates one draft release
   containing exactly the approved artifacts and valid SHA-256 checksums.
8. iOS is verified without signing and contributes no IPA release asset.
9. Fork pull requests have no write permission or secret access.
10. Rerunning a failed release safely updates an existing draft and never
    mutates an already published release.
11. No signing, notarization, store upload, auto-update, external release
    service, or non-OSS runtime capability is introduced.
12. Workflow contract tests, release tests, formatting checks, and the OSS
    release gate pass.
