# macOS Desktop Build Verification

Use this page for local macOS desktop package verification.

## Local Package

From the repository root:

```bash
pnpm package:desktop
```

This builds the workspace, builds the macOS sidecar, and produces unsigned
macOS DMGs for local verification:

- `apps/desktop/release/LynavoDrive-<version>-arm64.dmg`
- `apps/desktop/release/LynavoDrive-<version>-x64.dmg`
- `apps/desktop/release/mac*/Lynavo Drive.app`

## Local Checks

```bash
hdiutil verify apps/desktop/release/LynavoDrive-<version>-arm64.dmg
hdiutil verify apps/desktop/release/LynavoDrive-<version>-x64.dmg
file apps/desktop/release/mac*/Lynavo\ Drive.app/Contents/Resources/lynavo-drive-sidecar
```

The app may be unsigned or ad-hoc signed depending on Electron builder and
host behavior. That is acceptable for OSS source-build verification.
