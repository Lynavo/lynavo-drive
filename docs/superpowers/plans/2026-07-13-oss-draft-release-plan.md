# OSS Draft Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild all approved unsigned verification outputs from an immutable stable tag and create or update a guarded draft GitHub Release with exact assets and SHA-256 checksums.

**Architecture:** A portable tag verifier fails before native runners when the tag and four app version sources disagree. A separate assembly CLI admits only the six expected non-empty assets, renames nothing implicitly, rejects siblings, writes `SHA256SUMS`, and produces a manifest consumed by a tag-only release job whose sole write permission is `contents: write`; manual dispatch remains build-only.

**Tech Stack:** Node.js 22.12.0, Node test runner, GitHub Actions reusable workflows, GitHub CLI, SHA-256, YAML contract tests

---

## File Map

- Create `scripts/release/release-version.mjs` for reading and comparing desktop, mobile, iOS, and Android versions.
- Create `scripts/release/verify-release-tag.mjs` as a thin CLI around the version module.
- Create `scripts/release/__tests__/release-tag.test.mjs` for stable, malformed, prerelease, and per-source mismatch cases.
- Create `scripts/release/assemble-release-assets.mjs` for allowlisted staging validation and checksum generation.
- Create `scripts/release/__tests__/assemble-release-assets.test.mjs` for missing, empty, duplicate, unexpected, checksum, and filename cases.
- Modify `package.json` with `verify:release-tag` and `assemble:release-assets` scripts.
- Create `.github/workflows/release.yml` for tag releases and manual build-only rehearsals.
- Modify workflow and documentation contract tests plus release docs.

### Task 1: Add A Testable Four-Source Release Version Verifier

**Files:**

- Create: `scripts/release/release-version.mjs`
- Create: `scripts/release/verify-release-tag.mjs`
- Create: `scripts/release/__tests__/release-tag.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing verifier tests**

Create temporary fixture roots containing desktop/mobile `package.json`, iOS `project.pbxproj`, and Android `app/build.gradle`. Cover exact `v1.2.3`, malformed `1.2.3`, prerelease `v1.2.3-rc.1`, and one mismatch for each of desktop, mobile, iOS, and Android.

The test API is:

```js
const result = verifyReleaseTag({ repoRoot: fixtureRoot, tag: 'v1.2.3' });
assert.deepEqual(result, { tag: 'v1.2.3', version: '1.2.3' });
```

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/release/__tests__/release-tag.test.mjs`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement strict parsing**

Export `readReleaseVersions(repoRoot)` and `verifyReleaseTag({ repoRoot, tag })`. Accept only `/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/`; require one unambiguous `MARKETING_VERSION`; resolve Android `versionName` either as the same literal or through the committed iOS-derived expression; throw source-specific mismatch messages.

- [ ] **Step 4: Add and test the CLI**

The CLI accepts `--tag`, defaults the root to the repository, prints only the version on success, and exits nonzero with the validation message on failure. Add:

```json
"verify:release-tag": "node scripts/release/verify-release-tag.mjs"
```

Run:

```bash
node --test scripts/release/__tests__/release-tag.test.mjs
pnpm verify:release-tag -- --tag v1.0.1
```

Expected: tests PASS and the CLI prints `1.0.1`.

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/release/release-version.mjs scripts/release/verify-release-tag.mjs scripts/release/__tests__/release-tag.test.mjs
git commit -m "build: verify stable release tags"
```

### Task 2: Add Strict Release Asset Assembly

**Files:**

- Create: `scripts/release/assemble-release-assets.mjs`
- Create: `scripts/release/__tests__/assemble-release-assets.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing assembly tests**

For version `1.2.3`, create six platform files under named download directories and assert the output contains exactly:

```text
LynavoDrive-1.2.3-macos-arm64.dmg
LynavoDrive-1.2.3-macos-x64.dmg
LynavoDrive-1.2.3-windows-x64.exe
LynavoDrive-1.2.3-windows-x64.zip
LynavoDrive-1.2.3-android-arm64-x86_64.apk
LynavoDrive-1.2.3-android-arm64-x86_64.aab
SHA256SUMS
```

Add separate tests for missing, empty, unexpected, duplicate-basename, and wrong-version inputs. Verify checksum lines sort by filename and use 64 lowercase hex characters followed by two spaces and the basename.

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/release/__tests__/assemble-release-assets.test.mjs`

Expected: FAIL because the assembler does not exist.

- [ ] **Step 3: Implement the allowlist assembler**

Accept `--version`, repeated `--input-dir`, and `--output-dir`. Recursively enumerate only regular files in the input directories, compare basenames to the exact version-derived allowlist, require exactly one of each, require non-zero size, copy with exclusive creation, compute SHA-256 from the copied outputs, then write `SHA256SUMS` last. Reject a non-empty output directory.

- [ ] **Step 4: Verify GREEN and expose the script**

Add:

```json
"assemble:release-assets": "node scripts/release/assemble-release-assets.mjs"
```

Run: `node --test scripts/release/__tests__/assemble-release-assets.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/release/assemble-release-assets.mjs scripts/release/__tests__/assemble-release-assets.test.mjs
git commit -m "build: assemble allowlisted release assets"
```

### Task 3: Define Release Workflow Contracts

**Files:**

- Modify: `scripts/release/__tests__/workflow-contracts.test.mjs`

- [ ] **Step 1: Write a failing parsed release workflow test**

Assert tag trigger `v*`, manual dispatch, no `pull_request_target`, read-only workflow permissions, verifier before native calls, complete gate/CI/native reusable calls, manual dispatch never reaching release creation, only the final tag-gated job receiving `contents: write`, seven-day intermediate artifacts, exact six-asset allowlist plus `SHA256SUMS`, draft creation, generated notes, unsigned warning text, and published-release overwrite protection.

- [ ] **Step 2: Assert full-SHA action pins and no prohibited release paths**

Require pinned checkout/upload/download actions. Reject signing, notarization, store upload, auto-update, external release services, Linux assets, and any artifact upload glob broader than a named staging directory.

- [ ] **Step 3: Verify RED**

Run: `node --test --test-name-pattern='draft release workflow' scripts/release/__tests__/workflow-contracts.test.mjs`

Expected: FAIL because `.github/workflows/release.yml` does not exist.

### Task 4: Implement Build-Only Rehearsal And Tag Gates

**Files:**

- Create: `.github/workflows/release.yml`
- Test: `scripts/release/__tests__/workflow-contracts.test.mjs`

- [ ] **Step 1: Create triggers, concurrency, and version verification**

Use `push.tags: ['v*']` and `workflow_dispatch`. Default to `contents: read`. A `verify-tag` job checks out the triggering commit and runs `pnpm verify:release-tag -- --tag "$GITHUB_REF_NAME"` for tag events; manual dispatch reads the committed version and emits it without accepting an arbitrary release tag.

- [ ] **Step 2: Invoke complete gates from the same commit**

Call the existing `oss-release-gate.yml`, `ci.yml`, and `native-builds.yml` through `workflow_call`. Add `workflow_call` to the first two workflows without changing their normal triggers or visible job names. The release workflow must not consume artifacts from any older PR/main run.

- [ ] **Step 3: Preserve manual build-only behavior**

For manual dispatch, stop after successful reusable builds. Native artifacts remain ordinary seven-day Actions artifacts; no job with write permission is eligible.

- [ ] **Step 4: Run contracts**

Run: `node --test --test-name-pattern='draft release workflow' scripts/release/__tests__/workflow-contracts.test.mjs`

Expected: release trigger, permissions, gate, and rehearsal assertions PASS; assembly assertions remain RED until Task 5.

### Task 5: Assemble And Idempotently Update A Draft Release

**Files:**

- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Add tag-only artifact assembly**

After all reusable jobs succeed, download only the four explicitly named native artifact groups into separate directories. Run `pnpm assemble:release-assets` with the verified version, then upload the final staging directory as a seven-day Actions artifact for diagnosis.

- [ ] **Step 2: Add published-release protection**

In the only `contents: write` job, query `gh release view "$GITHUB_REF_NAME" --json isDraft`. If a release exists with `isDraft == false`, exit nonzero before deleting or uploading any asset. If no release exists, create it as draft with generated notes and the fixed unsigned warning body.

- [ ] **Step 3: Make draft retries idempotent**

For an existing draft, delete only the seven allowlisted asset names with `--yes` and ignore a missing individual asset, update the warning body, then upload exactly the staged seven files with `--clobber`. Never delete or recreate the tag.

- [ ] **Step 4: Use this warning in the release body**

```markdown
These files are unsigned OSS build-verification outputs, not an official signed
distribution. macOS Gatekeeper, Windows SmartScreen, and Android sideloading
controls may block installation or display warnings. Verify the matching entry
in `SHA256SUMS` before testing an asset.
```

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
node --test --test-name-pattern='draft release workflow' scripts/release/__tests__/workflow-contracts.test.mjs
pnpm test:release
```

Expected: PASS.

```bash
git add .github/workflows/oss-release-gate.yml .github/workflows/ci.yml .github/workflows/release.yml scripts/release/__tests__/workflow-contracts.test.mjs
git commit -m "ci: create guarded OSS draft releases"
```

### Task 6: Document Release Operations And Repository Rules

**Files:**

- Modify: `README.md`
- Modify: `CONTRIBUTING.md`
- Modify: `docs/release/release-playbook.md`
- Modify: `docs/testing/oss-verification-matrix.md`
- Modify: `scripts/release/__tests__/release-gate-config.test.mjs`

- [ ] **Step 1: Write failing documentation contracts**

Require exact stable tag syntax, six asset names, `SHA256SUMS`, iOS build-only behavior, unsigned warnings, manual build-only dispatch, draft-only creation, published-release immutability, rerun behavior, branch required checks, and maintainer-only `v*` tag ruleset guidance.

- [ ] **Step 2: Verify RED and update docs**

Run the focused test, add the release rehearsal/incident steps, then rerun:

```bash
node --test --test-name-pattern='draft release operations' scripts/release/__tests__/release-gate-config.test.mjs
```

Expected: RED before documentation changes and GREEN after them.

- [ ] **Step 3: Document the external rollout boundary**

State that branch rules and tag rulesets are GitHub repository settings, not enforced by committed YAML. Document expected required checks: `OSS Release Gate`, `TS Quality`, `Go Tests`, and `Native Builds`.

- [ ] **Step 4: Commit**

```bash
git add README.md CONTRIBUTING.md docs/release/release-playbook.md docs/testing/oss-verification-matrix.md scripts/release/__tests__/release-gate-config.test.mjs
git commit -m "docs: add OSS draft release operations"
```

### Task 7: Final Regression And Rehearsal Gate

**Files:**

- Review only.

- [ ] **Step 1: Run the complete local suite**

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

Expected: PASS.

- [ ] **Step 2: Run host-supported native checks**

Run iOS Debug/Release and macOS packaging on the current macOS host when toolchains are available. Record Android/Windows as pending GitHub manual dispatch if those host toolchains are unavailable.

- [ ] **Step 3: Perform the GitHub rollout only after publishing the branch**

Manually dispatch the release workflow and verify it creates Actions artifacts but no release. Then push one disposable stable-format tag matching all committed versions, verify the draft assets/checksums/warnings, rerun to verify idempotency, and delete only the disposable draft/tag after review. Configure branch checks and the maintainer-only `v*` tag ruleset. These external mutations require explicit repository access and are not implied by local implementation.

- [ ] **Step 4: Final contamination review**

Confirm no runtime app behavior, shared DTO/protocol, persistence, queue semantics, sync state machine, permissions/account gates, history statistics, signing, notarization, store upload, auto-update, private infrastructure, Linux hosted builds, or external distribution services were introduced.
