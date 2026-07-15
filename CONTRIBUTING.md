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

Third-party or external build services, code signing, notarization, store
upload, auto-update, and private distribution infrastructure are not part of
this OSS repository.

## Pull Requests

Before opening a pull request:

1. Run focused tests for the files you changed.
2. Run `pnpm gate:release`.
3. Update documentation when behavior, build paths, or OSS boundaries change.
4. Keep unrelated formatting and generated artifacts out of the diff.

## Repository Checks

The intended required checks are:

- `OSS Release Gate`
- `TS Quality`
- `Go Tests`
- `Native Builds` (added by the native verification workflow)

Repository rules are configured in GitHub after each check has appeared at
least once. Keep the display names stable when changing workflows so existing
rules do not silently stop applying.

Protect release tags with a maintainer-only `v*` tag ruleset. Only stable tags
matching `vX.Y.Z` are accepted, and the tag version must match the desktop,
mobile, iOS, and Android version sources. Branch protection and tag rulesets are
GitHub repository settings, not enforced by committed YAML; maintainers must
configure and audit them separately.

The tag workflow creates draft releases only. Treat a published release as
immutable: correct a bad published release with a new version instead of moving
or reusing its tag. See the release playbook before creating a release tag.

Dependabot opens reviewed monthly updates for pnpm dependencies and pinned
GitHub Actions. Each ecosystem is limited to five open pull requests; updates
must pass the same checks and are not merged automatically.
