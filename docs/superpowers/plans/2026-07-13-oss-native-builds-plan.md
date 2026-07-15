# OSS Native Builds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one path-aware, reusable, secret-free GitHub Actions workflow that verifies iOS, Android, macOS, and Windows while exposing a stable `Native Builds` required check and no Linux hosted job.

**Architecture:** A read-only `changes` job maps pull-request paths to mobile and desktop build groups; main pushes, manual dispatches, and reusable calls select every supported hosted platform. Platform jobs emit only exact, seven-day verification artifacts, while an always-running aggregation job turns conditional platform outcomes into one stable branch-protection result.

**Tech Stack:** GitHub Actions, dorny/paths-filter, Xcode 26, CocoaPods, JDK 17, Gradle, Go 1.25.6, Electron Builder 26, Node.js 22.12.0, pnpm 10.32.1

---

## File Map

- Modify `scripts/release/__tests__/workflow-contracts.test.mjs` with parsed native workflow contracts.
- Create `.github/workflows/native-builds.yml` as the only hosted native build definition.
- Create `scripts/release/stage-native-artifact.mjs` to enforce source filename, destination filename, non-empty output, and one-file staging.
- Create `scripts/release/__tests__/stage-native-artifact.test.mjs` for platform-neutral artifact staging coverage.
- Modify `package.json` to expose the staging helper only if a root script materially improves workflow readability.
- Modify `docs/release/release-playbook.md` and `docs/testing/oss-verification-matrix.md` with hosted rehearsal instructions and explicit Linux exclusion.

### Task 1: Define Native Workflow Contracts Before YAML

**Files:**

- Modify: `scripts/release/__tests__/workflow-contracts.test.mjs`

- [ ] **Step 1: Add a failing native workflow test**

Assert triggers `pull_request`, `merge_group`, `push.main`, `workflow_dispatch`, and `workflow_call`; `contents: read`; no `pull_request_target`; full-SHA pins; and jobs named `Detect Changes`, `iOS Build`, `Android Build`, `macOS Package`, `Windows Package`, and `Native Builds`.

- [ ] **Step 2: Assert path classification**

Require mobile filters for `apps/mobile/**`, `packages/contracts/**`, `pnpm-lock.yaml`, and the workflow itself. Require desktop filters for `apps/desktop/**`, `services/sidecar-go/**`, `packages/contracts/**`, `packages/design-tokens/**`, `scripts/release/**`, `pnpm-lock.yaml`, and the workflow itself.

- [ ] **Step 3: Assert the platform and security boundaries**

Require `macos-26`, `macos-26-intel`, `ubuntu-24.04`, and `windows-2025`; Node 22.12.0, pnpm 10.32.1, Go 1.25.6, JDK 17; exact artifact names; `retention-days: 7`; `CODE_SIGNING_ALLOWED=NO`; and absence of Linux runners/assets, signing, notarization, store upload, and broad artifact globs.

- [ ] **Step 4: Verify RED**

Run: `node --test --test-name-pattern='native build workflow' scripts/release/__tests__/workflow-contracts.test.mjs`

Expected: FAIL because `.github/workflows/native-builds.yml` does not exist.

### Task 2: Add Tested Cross-Platform Artifact Staging

**Files:**

- Create: `scripts/release/stage-native-artifact.mjs`
- Create: `scripts/release/__tests__/stage-native-artifact.test.mjs`

- [ ] **Step 1: Write failing CLI tests**

Use temporary directories and spawn the CLI. Cover: copying one non-empty file to an exact filename, rejecting a missing source, rejecting an empty source, rejecting a destination basename with `/` or `\\`, and refusing to overwrite a staged sibling.

Expected invocation:

```bash
node scripts/release/stage-native-artifact.mjs \
  --source apps/desktop/release/LynavoDrive-1.0.1-arm64.dmg \
  --output-dir build/release-assets/macos-arm64 \
  --name LynavoDrive-1.0.1-macos-arm64.dmg
```

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/release/__tests__/stage-native-artifact.test.mjs`

Expected: FAIL because the CLI does not exist.

- [ ] **Step 3: Implement the minimal CLI**

Parse exactly `--source`, `--output-dir`, and `--name`; require `basename(name) === name`; use `statSync` to require a non-empty regular file; create an empty output directory or reject unexpected siblings; copy with `COPYFILE_EXCL`; print the final path.

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --test scripts/release/__tests__/stage-native-artifact.test.mjs`

Expected: PASS.

```bash
git add scripts/release/stage-native-artifact.mjs scripts/release/__tests__/stage-native-artifact.test.mjs
git commit -m "build: add strict native artifact staging"
```

### Task 3: Implement Change Detection And Stable Aggregation

**Files:**

- Create: `.github/workflows/native-builds.yml`
- Test: `scripts/release/__tests__/workflow-contracts.test.mjs`

- [ ] **Step 1: Create the event and permissions shell**

Use read-only default permissions and concurrency cancellation. The `changes` job runs on `ubuntu-24.04`, uses pinned checkout and `dorny/paths-filter@6852f92c20ea7fd3b0c25de3b5112db3a98da050`, and emits `ios`, `android`, `macos`, and `windows` booleans. For non-PR events, set all outputs to `true` without running the path filter.

- [ ] **Step 2: Add the always-running aggregation job**

Give it `if: always()` and `needs: [changes, ios, android, macos, windows]`. A shell step must accept `success` or `skipped` for each platform, reject `failure` and `cancelled`, and print `No native build scope selected.` only when every platform is skipped.

- [ ] **Step 3: Run contracts and keep expected platform failures isolated**

Run: `node --test --test-name-pattern='native build workflow' scripts/release/__tests__/workflow-contracts.test.mjs`

Expected: still FAIL only for platform steps not yet added; trigger, path, permission, and aggregation assertions PASS.

### Task 4: Add iOS And Android Verification Jobs

**Files:**

- Modify: `.github/workflows/native-builds.yml`

- [ ] **Step 1: Add `iOS Build`**

Use `macos-26`, 60-minute timeout, pinned checkout/pnpm/setup-node, frozen install, `bundle exec pod install --deployment` when a committed Gemfile is available or `pod install --deployment` with the runner CocoaPods otherwise, and generic device Debug and Release builds:

```bash
xcodebuild -workspace LynavoDrive.xcworkspace -scheme LynavoDrive \
  -destination 'generic/platform=iOS' -configuration Debug \
  CODE_SIGNING_ALLOWED=NO build
xcodebuild -workspace LynavoDrive.xcworkspace -scheme LynavoDrive \
  -destination 'generic/platform=iOS' -configuration Release \
  CODE_SIGNING_ALLOWED=NO build
```

Run from `apps/mobile/ios`. Do not upload an IPA.

- [ ] **Step 2: Add `Android Build`**

Use `ubuntu-24.04`, 60-minute timeout, pinned checkout/pnpm/setup-node/setup-go/setup-java, frozen install, mobile `tsc --noEmit`, then:

```bash
./gradlew --no-daemon assembleDebug assembleRelease bundleRelease
```

Stage and upload only the unsigned release APK and AAB using versioned final names and seven-day retention.

- [ ] **Step 3: Verify contracts**

Run: `node --test --test-name-pattern='native build workflow' scripts/release/__tests__/workflow-contracts.test.mjs`

Expected: iOS and Android assertions PASS; desktop package assertions remain RED.

### Task 5: Add macOS And Windows Package Jobs

**Files:**

- Modify: `.github/workflows/native-builds.yml`

- [ ] **Step 1: Add macOS matrix packaging**

Use a matrix mapping `arm64 -> macos-26` and `x64 -> macos-26-intel`. Run frozen install, workspace build, the existing sidecar package path for the selected architecture, and electron-builder with `--mac dmg --${{ matrix.arch }}` and no identity. Stage exactly one DMG per matrix entry as `LynavoDrive-<version>-macos-<arch>.dmg` and upload it for seven days.

- [ ] **Step 2: Add Windows x64 packaging**

Use `windows-2025`, frozen install, Go 1.25.6, and `pnpm package:desktop:win`. Verify `apps/desktop/resources/lynavo-drive-sidecar.exe`, stage exactly the NSIS `.exe` and `.zip` as the approved Windows names, and upload only those two files for seven days. Do not install or redistribute Bonjour.

- [ ] **Step 3: Verify the full native contract GREEN**

Run:

```bash
node --test --test-name-pattern='native build workflow' scripts/release/__tests__/workflow-contracts.test.mjs
pnpm test:release
```

Expected: PASS.

- [ ] **Step 4: Commit the workflow**

```bash
git add .github/workflows/native-builds.yml scripts/release/__tests__/workflow-contracts.test.mjs
git commit -m "ci: add path-aware native verification builds"
```

### Task 6: Document Native Rehearsal And Linux Exclusion

**Files:**

- Modify: `docs/release/release-playbook.md`
- Modify: `docs/testing/oss-verification-matrix.md`

- [ ] **Step 1: Add workflow documentation contracts**

Extend the release config test to require the `Native Builds` check name, all four hosted platforms, seven-day intermediate retention, unsigned wording, and an explicit statement that Linux remains local-only and has no hosted job or release artifact.

- [ ] **Step 2: Verify RED, update docs, then verify GREEN**

Run the focused test before and after edits:

```bash
node --test --test-name-pattern='native hosted verification docs' scripts/release/__tests__/release-gate-config.test.mjs
```

Expected: RED before documentation changes and GREEN after them.

- [ ] **Step 3: Document manual dispatch expectations**

List expected job names, artifacts, unsigned limitations, fork safety, and the fact that a manual native dispatch creates Actions artifacts only. Preserve the existing local Linux commands unchanged.

- [ ] **Step 4: Commit**

```bash
git add docs/release/release-playbook.md docs/testing/oss-verification-matrix.md scripts/release/__tests__/release-gate-config.test.mjs
git commit -m "docs: add hosted native verification runbook"
```

### Task 7: Native Build Regression Gate

**Files:**

- Review only.

- [ ] **Step 1: Run local portable checks**

```bash
pnpm test:release
pnpm gate:release
pnpm format:check
pnpm lint
pnpm typecheck
(cd services/sidecar-go && go test ./...)
```

Expected: PASS.

- [ ] **Step 2: Run host-supported native verification**

On the current macOS host run iOS Debug/Release and macOS packaging if toolchains are installed. Record Android and Windows as requiring their platform or the eventual GitHub manual dispatch; do not claim local verification that did not run.

- [ ] **Step 3: Review security and contamination**

Confirm no `pull_request_target`, secrets, signing inputs, notarization, upload, auto-update, Linux hosted job, broad artifact upload, runtime TypeScript/Swift/Kotlin/Go behavior, DTO, protocol, persistence, queue, or sync-state changes.
