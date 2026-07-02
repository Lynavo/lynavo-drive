# Lynavo Drive Build Profile Flow

Lynavo Drive is a global-only OSS baseline. Release profiles remain as
build-channel selectors for local verification only.

## Release Channels

```bash
pnpm release --profile review --targets ios,android,mac,win,linux --dry-run
pnpm release --profile prod --targets ios,android,mac,win,linux --dry-run
```

Rules:

1. `review` uses `LYNAVO_RELEASE_CHANNEL=review`.
2. `prod` uses `LYNAVO_RELEASE_CHANNEL=prod`.
3. Neither profile injects support, update, diagnostics, auth, or historical
   market environment variables.
4. Targets resolve to local build/package commands only.

## Build Targets

- `ios`: generic Release build with `CODE_SIGNING_ALLOWED=NO`.
- `android`: unsigned Gradle `assembleRelease bundleRelease` source build.
- `mac`: unsigned macOS DMG package via `pnpm package:desktop`.
- `win`: Windows NSIS/ZIP package.
- `linux`: Linux `.deb` package on Linux hosts.
