# Contributing

## Development Baseline

Read `AGENTS.md` before changing code. The short version:

- keep foreground LAN sync usable without account services
- keep non-OSS remote/background capabilities fail-closed
- do not add manual file picking as an upload path
- do not commit signing material, API keys, generated packages, local databases,
  diagnostics archives, or third-party proprietary binaries
- do not redistribute Apple Bonjour for Windows binaries in the source
  repository

## Local Setup

```bash
pnpm install
pnpm build
pnpm gate:release
```

Native iOS, Android, macOS, and Windows verification may run on contributor
machines or GitHub-hosted Actions. Hosted jobs use public source, no repository
secrets, and produce unsigned verification artifacts only. Linux build/package
verification remains local-only.

Stable tags matching `vX.Y.Z` are the only exception: the release workflow may
use repository Actions Secrets to sign Android APK/AAB assets after `Native
Builds` completes. Contributors and pull requests do not need, receive, or
access those Secrets. Third-party or external build services, desktop code
signing, notarization, store upload, auto-update, and private distribution
infrastructure are not part of this OSS repository.

## Pull Requests

Create a focused branch from the latest `main`. Use one of these prefixes so
the branch purpose is clear: `feat/`, `fix/`, `docs/`, `test/`, `ci/`, or
`chore/`. Keep commit subjects concise and use a Conventional Commit-style
type when practical, such as `fix: recover interrupted uploads`.

Before opening a pull request:

1. Run focused tests for the files you changed.
2. Run `pnpm gate:release`.
3. Update documentation when behavior, build paths, or OSS boundaries change.
4. Keep unrelated formatting and generated artifacts out of the diff.
5. Review your own diff for affected modules, call chains, user-visible
   behavior, and platforms.
6. Complete the pull request template, including validation results and the
   contamination review.

Pull requests target `main`. Keep the branch current with `main` when required
checks report that it is out of date. A pull request can merge only after all
required checks pass against the current base branch, it has one approving review
including a code owner review, all review conversations are resolved, and no
unresolved change request remains. New commits dismiss stale approvals, so
reviewers must approve the current revision.

The repository uses squash merge only. Write a final squash commit subject that
describes the completed change and follows the same concise Conventional
Commit-style convention. GitHub automatically deletes the source branch after
merge. Maintainers must not bypass these rules for routine changes.

## Repository Checks

The required checks are:

- `OSS Release Gate`
- `TS Quality`
- `Go Tests`
- `Native Builds` (added by the native verification workflow)

The `main` branch ruleset requires these checks in strict mode, so a pull
request must be tested with the current base branch before merge. Keep the
display names stable when changing workflows so existing rules do not silently
stop applying. Maintainers should periodically audit the ruleset and repository
merge settings against this document.

Protect release tags with a maintainer-only `v*` tag ruleset. Only stable tags
matching `vX.Y.Z` are accepted, and the tag version must match the desktop,
mobile, iOS, and Android version sources.

GitHub repository settings are not enforced by committed YAML. Maintainers must
audit these rulesets separately.

The tag workflow creates draft releases only. Treat a published release as
immutable: correct a bad published release with a new version instead of moving
or reusing its tag. See the release playbook before creating a release tag.

Dependabot opens reviewed monthly updates for pnpm dependencies and pinned
GitHub Actions. Each ecosystem is limited to five open pull requests; updates
must pass the same checks and are not merged automatically.
