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

Native iOS, Android, macOS, Windows, and Linux build verification must run on a
local machine with the required platform toolchains.

## Pull Requests

Before opening a pull request:

1. Run focused tests for the files you changed.
2. Run `pnpm gate:release`.
3. Update documentation when behavior, build paths, or OSS boundaries change.
4. Keep unrelated formatting and generated artifacts out of the diff.
