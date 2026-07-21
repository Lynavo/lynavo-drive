# Android Tag Release Signing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sign stable-tag Android APK and AAB release assets with a durable GitHub-managed keystore while keeping all ordinary hosted and local verification builds secret-free.

**Architecture:** Keep `.github/workflows/native-builds.yml` unchanged as the unsigned source-build producer. Add a tag-only `sign-android` job to `.github/workflows/release.yml` that downloads `native-android`, restores a JKS from GitHub Secrets, signs and verifies both Android assets, and uploads `native-android-signed` for the existing release assembly job.

**Tech Stack:** GitHub Actions YAML, Node.js built-in test runner, `yaml`, Android SDK `apksigner`, JDK `jarsigner`/`keytool`, GitHub CLI, macOS Keychain.

---

## File Map

- Modify `.github/workflows/release.yml`: add tag-only Android signing and route release assembly to signed Android artifacts.
- Modify `scripts/release/__tests__/workflow-contracts.test.mjs`: enforce job gating, secret handling, signature verification, and signed artifact routing.
- Modify `scripts/release/__tests__/release-gate-config.test.mjs`: enforce the split between secret-free verification builds and tag-only signed Android releases.
- Modify `AGENTS.md`: update the repository boundary for the narrow Android stable-tag signing exception.
- Modify `README.md`: accurately describe signed Android tag assets and unsigned verification artifacts.
- Modify `CONTRIBUTING.md`: document that contributors do not need or receive signing secrets.
- Modify `docs/release/release-playbook.md`: document Secrets, keystore recovery, release behavior, and verification commands.
- Modify `docs/testing/oss-verification-matrix.md`: add stable-tag signing acceptance criteria without changing mobile sync regression semantics.
- Create local `~/.config/lynavo-drive/signing/lynavo-drive-release.jks`: durable recovery copy, never committed.
- Create four GitHub Actions Secrets: runtime signing material for stable tag runs.

### Task 1: Add Failing Workflow Contract Tests

**Files:**
- Modify: `scripts/release/__tests__/workflow-contracts.test.mjs`
- Test: `scripts/release/__tests__/workflow-contracts.test.mjs`

- [ ] **Step 1: Rename the existing release workflow contract test**

Change the test name from:

```js
test('draft release workflow is tag-gated, unsigned, and idempotent', () => {
```

to:

```js
test('draft release workflow signs Android assets only for stable tags', () => {
```

- [ ] **Step 2: Add assertions for the tag-only signing job**

Immediately after the existing `tagOnly` declaration, add these assertions:

```js
const signAndroid = jobs['sign-android'];
assert.equal(signAndroid?.name, 'Sign Android Release');
assert.match(signAndroid?.if ?? '', tagOnly);
assert.deepEqual(signAndroid?.needs, ['verify-tag', 'native']);
assert.equal(signAndroid?.['runs-on'], 'ubuntu-24.04');
assert.equal(signAndroid?.['timeout-minutes'], 10);
assert.deepEqual(signAndroid?.permissions, { contents: 'read' });

const signingSteps = signAndroid?.steps ?? [];
const restore = findStep(signingSteps, 'Restore Android signing keystore');
assert.deepEqual(Object.keys(restore.env ?? {}).sort(), [
  'ANDROID_RELEASE_KEYSTORE_BASE64',
]);
assert.match(restore.run, /base64 --decode/);
assert.match(restore.run, /chmod 600/);

const sign = findStep(signingSteps, 'Sign and verify Android artifacts');
assert.deepEqual(Object.keys(sign.env ?? {}).sort(), [
  'ANDROID_RELEASE_KEY_ALIAS',
  'ANDROID_RELEASE_KEY_PASSWORD',
  'ANDROID_RELEASE_STORE_PASSWORD',
]);
assert.match(sign.run, /apksigner sign/);
assert.match(sign.run, /--ks-pass env:ANDROID_RELEASE_STORE_PASSWORD/);
assert.match(sign.run, /--key-pass env:ANDROID_RELEASE_KEY_PASSWORD/);
assert.match(sign.run, /apksigner verify --verbose --print-certs/);
assert.match(sign.run, /jarsigner/);
assert.match(sign.run, /-verify/);

assert.equal(
  findStep(signingSteps, 'Upload signed Android artifacts').with?.name,
  'native-android-signed',
);
```

- [ ] **Step 3: Require release assembly to consume the signed artifact**

Change the expected Android download artifact in the existing array from
`native-android` to `native-android-signed`, and assert that `assemble.needs`
contains `sign-android`:

```js
assert.match(JSON.stringify(jobs.assemble?.needs), /sign-android/);
```

- [ ] **Step 4: Narrow the old no-secrets assertion**

Replace the workflow-wide assertion that forbids `secrets.` with assertions
that the strings occur only in the two signing steps. Continue forbidding
`pull_request_target`, desktop signing credentials, store upload, and
auto-update behavior.

- [ ] **Step 5: Run the focused test and verify RED**

Run:

```bash
node --test --test-name-pattern='draft release workflow signs Android' scripts/release/__tests__/workflow-contracts.test.mjs
```

Expected: FAIL because `jobs['sign-android']` does not exist and assembly still
downloads `native-android`.

- [ ] **Step 6: Commit the failing contract test**

```bash
git add scripts/release/__tests__/workflow-contracts.test.mjs
git commit -m "test: require signed Android tag artifacts"
```

### Task 2: Implement Tag-Only Android Signing

**Files:**
- Modify: `.github/workflows/release.yml`
- Test: `scripts/release/__tests__/workflow-contracts.test.mjs`

- [ ] **Step 1: Add the `sign-android` job after `native`**

The job must use the same `tagOnly` expression as `assemble` and `release`,
download `native-android`, and restore the JKS under `RUNNER_TEMP`. The restore
step must fail on an empty Base64 secret before decoding:

```yaml
  sign-android:
    name: Sign Android Release
    if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')
    needs:
      - verify-tag
      - native
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    permissions:
      contents: read

    steps:
      - name: Download unsigned Android artifacts
        uses: actions/download-artifact@70fc10c6e5e1ce46ad2ea6f2b72d43f7d47b13c3
        with:
          name: native-android
          path: build/release-downloads/native-android

      - name: Restore Android signing keystore
        env:
          ANDROID_RELEASE_KEYSTORE_BASE64: ${{ secrets.ANDROID_RELEASE_KEYSTORE_BASE64 }}
        run: |
          set -euo pipefail
          if [ -z "$ANDROID_RELEASE_KEYSTORE_BASE64" ]; then
            echo "Missing ANDROID_RELEASE_KEYSTORE_BASE64." >&2
            exit 1
          fi
          KEYSTORE_PATH="$RUNNER_TEMP/lynavo-drive-release.jks"
          printf '%s' "$ANDROID_RELEASE_KEYSTORE_BASE64" | base64 --decode > "$KEYSTORE_PATH"
          chmod 600 "$KEYSTORE_PATH"
          echo "ANDROID_RELEASE_KEYSTORE_PATH=$KEYSTORE_PATH" >> "$GITHUB_ENV"
```

- [ ] **Step 2: Sign and verify the exact APK and AAB**

Use build tools `36.0.0`, fail when any password or alias is empty, use
environment-based password inputs, and sign files in place:

```yaml
      - name: Sign and verify Android artifacts
        env:
          ANDROID_RELEASE_STORE_PASSWORD: ${{ secrets.ANDROID_RELEASE_STORE_PASSWORD }}
          ANDROID_RELEASE_KEY_ALIAS: ${{ secrets.ANDROID_RELEASE_KEY_ALIAS }}
          ANDROID_RELEASE_KEY_PASSWORD: ${{ secrets.ANDROID_RELEASE_KEY_PASSWORD }}
        run: |
          set -euo pipefail
          : "${ANDROID_RELEASE_STORE_PASSWORD:?Missing ANDROID_RELEASE_STORE_PASSWORD}"
          : "${ANDROID_RELEASE_KEY_ALIAS:?Missing ANDROID_RELEASE_KEY_ALIAS}"
          : "${ANDROID_RELEASE_KEY_PASSWORD:?Missing ANDROID_RELEASE_KEY_PASSWORD}"

          APK_PATH="build/release-downloads/native-android/${{ needs.verify-tag.outputs.artifact_prefix }}-${{ needs.verify-tag.outputs.version }}-android-arm64-x86_64.apk"
          AAB_PATH="build/release-downloads/native-android/${{ needs.verify-tag.outputs.artifact_prefix }}-${{ needs.verify-tag.outputs.version }}-android-arm64-x86_64.aab"
          APKSIGNER="$ANDROID_HOME/build-tools/36.0.0/apksigner"

          "$APKSIGNER" sign \
            --ks "$ANDROID_RELEASE_KEYSTORE_PATH" \
            --ks-key-alias "$ANDROID_RELEASE_KEY_ALIAS" \
            --ks-pass env:ANDROID_RELEASE_STORE_PASSWORD \
            --key-pass env:ANDROID_RELEASE_KEY_PASSWORD \
            "$APK_PATH"
          "$APKSIGNER" verify --verbose --print-certs "$APK_PATH"

          jarsigner \
            -keystore "$ANDROID_RELEASE_KEYSTORE_PATH" \
            -storepass:env ANDROID_RELEASE_STORE_PASSWORD \
            -keypass:env ANDROID_RELEASE_KEY_PASSWORD \
            "$AAB_PATH" "$ANDROID_RELEASE_KEY_ALIAS"
          jarsigner -verify -strict -certs "$AAB_PATH"
```

- [ ] **Step 3: Upload only the two exact signed files**

Add a pinned `actions/upload-artifact` step named `Upload signed Android
artifacts`, with artifact name `native-android-signed`, the exact APK/AAB paths,
`if-no-files-found: error`, seven-day retention, and overwrite enabled.

- [ ] **Step 4: Route assembly through the signing job**

Add `sign-android` to `assemble.needs` and change the Android download step to:

```yaml
      - name: Download signed Android artifacts
        uses: actions/download-artifact@70fc10c6e5e1ce46ad2ea6f2b72d43f7d47b13c3
        with:
          name: native-android-signed
          path: build/release-downloads/native-android-signed
```

Update the `assemble:release-assets` input directory to
`build/release-downloads/native-android-signed`.

- [ ] **Step 5: Update the draft warning**

State that Android assets are signed for direct installation while desktop
assets remain unsigned verification outputs. Retain the checksum warning and
platform security warning for macOS/Windows.

- [ ] **Step 6: Run the focused test and verify GREEN**

Run:

```bash
node --test --test-name-pattern='draft release workflow signs Android' scripts/release/__tests__/workflow-contracts.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit workflow implementation**

```bash
git add .github/workflows/release.yml
git commit -m "ci: sign Android stable tag assets"
```

### Task 3: Update Release Policy Documentation With Tests

**Files:**
- Modify: `scripts/release/__tests__/release-gate-config.test.mjs`
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`
- Modify: `docs/release/release-playbook.md`
- Modify: `docs/testing/oss-verification-matrix.md`

- [ ] **Step 1: Write failing documentation contract assertions**

Rename the policy test to describe secret-free verification plus tag-only
Android signing. Assert that the combined policy documentation contains all
four Secret names, `native-android-signed`, stable-tag-only language, keystore
backup/recovery language, and loss-of-key update consequences. Replace the old
expectation that every path is unsigned with exact assertions that hosted
verification remains unsigned and stable-tag Android release assets are signed.

- [ ] **Step 2: Run the policy tests and verify RED**

Run:

```bash
node --test scripts/release/__tests__/release-gate-config.test.mjs
```

Expected: FAIL because documentation still prohibits all repository secrets and
describes every draft asset as unsigned.

- [ ] **Step 3: Update repository boundary documentation**

Make the same narrow distinction in every policy source:

```text
Native Builds and local source-build verification remain secret-free and
unsigned. Stable vX.Y.Z tag releases may use repository Actions Secrets only
to sign Android APK/AAB assets; no signing material is present in source or
exposed to pull requests.
```

Do not weaken prohibitions on official desktop signing, notarization, store
upload, auto-update, external build services, or secret access from PRs.

- [ ] **Step 4: Add maintainer setup and recovery instructions**

In `docs/release/release-playbook.md`, document the four exact Secret names,
Base64 JKS encoding, local backup path, macOS Keychain password storage,
signature verification commands, and the requirement never to rotate or lose
the key without an explicit package migration plan.

- [ ] **Step 5: Update release matrix acceptance criteria**

Require tag release failure when signing secrets are absent or verification
fails, require signed Android assets before checksum assembly, and retain all
existing draft immutability and mobile sync gates.

- [ ] **Step 6: Run policy tests and verify GREEN**

Run:

```bash
node --test scripts/release/__tests__/release-gate-config.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit policy updates**

```bash
git add AGENTS.md README.md CONTRIBUTING.md docs/release/release-playbook.md docs/testing/oss-verification-matrix.md scripts/release/__tests__/release-gate-config.test.mjs
git commit -m "docs: define Android tag signing boundary"
```

### Task 4: Generate Durable Signing Material And Configure GitHub

**Files:**
- Create outside repository: `~/.config/lynavo-drive/signing/lynavo-drive-release.jks`
- Modify external state: macOS Keychain
- Modify external state: GitHub repository Actions Secrets

- [ ] **Step 1: Create the protected backup directory**

```bash
install -d -m 700 "$HOME/.config/lynavo-drive/signing"
```

- [ ] **Step 2: Generate random passwords without printing them**

Create independent store and key passwords with `openssl rand -base64 48`, keep
them only in shell variables for the current operation, and never enable shell
tracing.

- [ ] **Step 3: Generate the long-lived JKS**

Use alias `lynavo-drive-release`, RSA 4096, SHA-256, 36,500-day validity, and
environment-based password arguments:

```bash
ANDROID_RELEASE_STORE_PASSWORD="$store_password" \
ANDROID_RELEASE_KEY_PASSWORD="$key_password" \
keytool -genkeypair \
  -keystore "$HOME/.config/lynavo-drive/signing/lynavo-drive-release.jks" \
  -storetype JKS \
  -storepass:env ANDROID_RELEASE_STORE_PASSWORD \
  -keypass:env ANDROID_RELEASE_KEY_PASSWORD \
  -alias lynavo-drive-release \
  -keyalg RSA \
  -keysize 4096 \
  -sigalg SHA256withRSA \
  -validity 36500 \
  -dname 'CN=Lynavo Drive Android Release, OU=Lynavo Drive, O=Lynavo, L=Taipei, ST=Taiwan, C=TW'
```

- [ ] **Step 4: Store passwords in macOS Keychain**

Use `security add-generic-password -U` with account `lynavo-drive-release` and
services:

```text
dev.lynavo.drive.android.release-store-password
dev.lynavo.drive.android.release-key-password
```

- [ ] **Step 5: Upload the four GitHub Actions Secrets**

Pipe each value directly into `gh secret set --repo Lynavo/lynavo-drive`. Encode
the JKS without line breaks and do not create a Base64 file:

```bash
base64 < "$HOME/.config/lynavo-drive/signing/lynavo-drive-release.jks" | tr -d '\n' | gh secret set ANDROID_RELEASE_KEYSTORE_BASE64 --repo Lynavo/lynavo-drive
printf '%s' "$store_password" | gh secret set ANDROID_RELEASE_STORE_PASSWORD --repo Lynavo/lynavo-drive
printf '%s' 'lynavo-drive-release' | gh secret set ANDROID_RELEASE_KEY_ALIAS --repo Lynavo/lynavo-drive
printf '%s' "$key_password" | gh secret set ANDROID_RELEASE_KEY_PASSWORD --repo Lynavo/lynavo-drive
```

- [ ] **Step 6: Verify identity and Secret names without exposing values**

Run `keytool -list` with `-storepass:env`, confirm alias and certificate
fingerprint, then run:

```bash
gh secret list --repo Lynavo/lynavo-drive --app actions
```

Expected: all four Secret names are listed. No Secret value is printed.

### Task 5: Full Verification And Self-Review

**Files:**
- Review all modified tracked files
- Verify external signing state without printing secrets

- [ ] **Step 1: Run release tests**

```bash
pnpm test:release
```

Expected: all release and dev script tests pass.

- [ ] **Step 2: Run YAML and formatting validation**

```bash
node -e "const fs=require('node:fs'); const yaml=require('yaml'); yaml.parse(fs.readFileSync('.github/workflows/release.yml','utf8'));"
pnpm exec prettier --check .github/workflows/release.yml scripts/release/__tests__/workflow-contracts.test.mjs scripts/release/__tests__/release-gate-config.test.mjs AGENTS.md README.md CONTRIBUTING.md docs/release/release-playbook.md docs/testing/oss-verification-matrix.md docs/superpowers/specs/2026-07-21-android-tag-release-signing-design.md docs/superpowers/plans/2026-07-21-android-tag-release-signing.md
```

Expected: YAML parses and all modified files pass formatting.

- [ ] **Step 3: Run the release gate**

```bash
pnpm gate:release
```

Expected: version checks, source-package checks, release tests, and profile
dry-runs pass without accessing signing Secrets.

- [ ] **Step 4: Review security and behavior boundaries**

Confirm from the final diff that Secrets appear only in the tag-only signing
job, the unsigned `Native Builds` workflow is unchanged, no credential file is
tracked, checksums are generated after signing, and no mobile runtime, DTO,
queue, persistence, sync state, permission gate, or platform implementation was
modified.

- [ ] **Step 5: Inspect repository and external state**

Run:

```bash
git status --short
git diff --check
gh secret list --repo Lynavo/lynavo-drive --app actions
```

Expected: only intentional tracked changes remain, no whitespace errors exist,
and the four Secret names are present.

- [ ] **Step 6: Commit final verification adjustments if needed**

If formatting or verification required tracked-file changes, commit only those
specific changes with:

```bash
git add .github/workflows/release.yml scripts/release/__tests__/workflow-contracts.test.mjs scripts/release/__tests__/release-gate-config.test.mjs AGENTS.md README.md CONTRIBUTING.md docs/release/release-playbook.md docs/testing/oss-verification-matrix.md
git commit -m "test: verify Android tag release signing"
```
