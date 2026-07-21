# Android Tag Release Signing Design

## Goal

Produce Android APK and AAB assets signed with one durable project signing key
for stable `vX.Y.Z` GitHub tag releases. Keep pull requests, pushes to `main`,
manual `Native Builds` runs, and local OSS source-build verification independent
of repository secrets and release signing material.

## Scope

This change signs only the Android assets assembled by the tag-triggered OSS
Draft Release workflow. It does not sign desktop artifacts, introduce store
upload, publish a draft automatically, or change local release-profile builds.

The existing `Native Builds` workflow continues to build and upload the unsigned
Release APK and AAB as source-build verification artifacts. A new tag-only job
in `.github/workflows/release.yml` downloads those Android artifacts, signs
them, verifies them, and uploads a separate intermediate artifact consumed by
the release assembly job.

## Signing Material

One long-lived JKS keystore will be generated outside the repository and backed
up at:

```text
~/.config/lynavo-drive/signing/lynavo-drive-release.jks
```

The directory and keystore will be readable only by the current user. The store
and key passwords will be random values stored in macOS Keychain. No keystore,
password, encoded key, or generated credential file may be added to the
repository.

The repository will receive these GitHub Actions Secrets:

```text
ANDROID_RELEASE_KEYSTORE_BASE64
ANDROID_RELEASE_STORE_PASSWORD
ANDROID_RELEASE_KEY_ALIAS
ANDROID_RELEASE_KEY_PASSWORD
```

GitHub Secrets are the runtime source used by the tag workflow. The local JKS
and Keychain entries are recovery backups because GitHub does not allow secret
values to be read back after creation.

## Workflow Architecture

The existing reusable `Native Builds` workflow remains secret-free. The OSS
Draft Release workflow gains a `Sign Android Release` job with these properties:

1. It runs only for a `push` event whose ref starts with `refs/tags/v`.
2. It depends on the existing version verification and native build jobs.
3. It receives the four Android release secrets only through step-level
   environment variables.
4. It downloads the `native-android` intermediate artifact.
5. It reconstructs the keystore under `RUNNER_TEMP` with restrictive file
   permissions.
6. It signs the APK with Android `apksigner` and signs the AAB with `jarsigner`.
7. It verifies both signatures before uploading `native-android-signed`.
8. The release assembly job downloads `native-android-signed`, not the unsigned
   Android intermediate artifact.

This placement prevents untrusted pull-request code and ordinary verification
jobs from receiving release credentials. A manual dispatch remains a build-only
rehearsal and does not run signing or create a GitHub Release.

## Failure Handling

Stable tag release assembly must fail closed when any signing secret is absent,
empty, malformed, or inconsistent with the keystore. It must also fail if APK
or AAB signature verification fails. The unsigned native-build artifact remains
available for diagnosing source-build failures, but it must never be substituted
into a tag release after signing fails.

Passwords must not appear in command arguments, workflow output, artifact
names, or diagnostic messages. GitHub masking remains a secondary safeguard;
the workflow should avoid printing sensitive values in the first place.

## Release Assets And Documentation

The Android files in a tag-created draft release become signed, installable
release assets. The existing filenames remain unchanged:

```text
LynavoDriveDemo-<version>-android-arm64-x86_64.apk
LynavoDriveDemo-<version>-android-arm64-x86_64.aab
```

`SHA256SUMS` is generated after signing and therefore records the signed bytes.
Release notes and the release playbook must distinguish signed Android assets
from the still-unsigned macOS and Windows verification artifacts. Documentation
must include keystore backup, GitHub Secret setup, rotation consequences, and a
warning that losing the signing key prevents updates to existing installations.

## Tests And Verification

Repository tests will enforce that:

1. `Native Builds` remains secret-free and stages unsigned Android outputs.
2. The signing job is tag-only and depends on the native build.
3. All four signing secrets are required by the signing step.
4. APK and AAB signature verification runs before the signed artifact upload.
5. Release assembly consumes `native-android-signed`.
6. Release documentation accurately describes the mixed signed/unsigned asset
   policy and recovery requirements.

Implementation verification will run the focused release workflow contract
tests, the full release-script test suite, YAML parsing, formatting checks for
modified files, and the release gate when practical. The generated local JKS
will also be inspected with `keytool`; secret values will not be printed.

## Non-Goals

- Google Play upload or Play App Signing integration
- APK signing for pull requests, `main`, or manual verification runs
- iOS, macOS, or Windows signing
- Automatic publication of the draft GitHub Release
- Signing-key rotation or migration of previously installed packages
