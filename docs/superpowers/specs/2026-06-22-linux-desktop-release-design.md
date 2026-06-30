# Linux Desktop Release Design

## Context

Vivi Drop desktop currently has production paths for macOS and Windows. The next platform is Linux, with a formal release requirement rather than a development-only preview.

The Linux support target is:

- Ubuntu 22.04 LTS and newer.
- `amd64` and `arm64`.
- `.deb` packages.
- CN and Global release profiles.
- Mobile real-device pairing and upload parity with existing desktop platforms.

The repo already has platform abstractions for macOS and Windows, a Go sidecar that uses CGO through `mattn/go-sqlite3`, and Electron builder configuration for macOS and Windows. Linux integration should extend those boundaries instead of adding one-off Linux branches.

## Goals

1. Build and package Linux desktop artifacts through the normal release profile entrypoint.
2. Bundle a Linux sidecar binary in the Electron app resources.
3. Keep renderer code platform-neutral where possible, with explicit capability checks for platform-specific UI.
4. Make Linux installable and testable on Ubuntu 22.04+ for both `amd64` and `arm64`.
5. Validate mobile pairing, upload, app restart recovery, and local path browsing on real Linux desktop installations.

## Non-Goals

- No Snap, Flatpak, AppImage, or tarball artifact in the first Linux release.
- No automatic Samba share detection or setup in the first Linux release.
- No macOS-based cross-compilation as the formal release baseline for Linux CGO artifacts.
- No support claim for non-Ubuntu distributions in the first release, even if the `.deb` may install elsewhere.

## Platform Baseline

The first release baseline is Ubuntu 22.04 LTS because it is the minimum supported Ubuntu version and gives the oldest glibc target in scope.

Release verification should use:

- Ubuntu 22.04 `arm64` VM on Apple Silicon through UTM virtualization.
- Ubuntu 22.04 `amd64` VM through UTM emulation, or a local physical/VM x86_64 Linux machine when available.
- A newer Ubuntu LTS smoke test before production release when practical.

The formal build baseline is native Linux per architecture:

- Build `arm64.deb` on Ubuntu `arm64`.
- Build `amd64.deb` on Ubuntu `amd64`.

This avoids CGO and glibc compatibility issues from cross-compiling the sqlite-backed sidecar on macOS.

## Architecture

### Desktop Platform Capabilities

Keep existing preload compatibility methods:

- `platform.isMac()`
- `platform.isWindows()`
- `platform.supportsAppleAuth()`

Add Linux-aware platform capability without forcing every renderer caller to branch on `process.platform`:

- Add `platform.isLinux()` to the preload API and its type declaration.
- Do not add a normalized `platform.kind()` in the first implementation pass; the existing boolean capability style is already used throughout the renderer.
- Apple OAuth remains macOS-only.
- Non-macOS titlebar overlay behavior applies to both Windows and Linux unless Linux testing shows a desktop-environment-specific issue.
- Application menu hiding remains non-macOS.

Renderer components should prefer capability checks over direct Windows checks. Existing Windows-specific UI, such as Windows sharing settings, should remain hidden on Linux.

### Sidecar Runtime

Linux uses the existing sidecar manager resource lookup:

- Development: `go run ./cmd/syncflow-sidecar/`.
- Production: `process.resourcesPath/syncflow-sidecar`.

The sidecar binary name remains `syncflow-sidecar` on macOS and Linux, and `syncflow-sidecar.exe` on Windows.

Linux mDNS should use the existing zeroconf path. No bundled `dns-sd` runtime is required for Linux in the first release.

### Go Sidecar

The Go sidecar already has mostly portable filesystem, disk, API, and mDNS code.

Expected Linux behavior:

- `disk.Check` uses the existing non-Windows `syscall.Statfs` implementation.
- default data directory comes from `os.UserConfigDir()`, normally `~/.config/Vivi Drop`.
- default receive directory remains `<dataDir>/received`.
- default personal share directory remains the user home directory when available.
- share detection returns `needs_manual_enable` on Linux until Samba-specific support is designed.
- wake metadata uses the non-darwin fallback.

Linux changes should not alter queue semantics, upload state machine behavior, DTO contracts, or persisted schema unless a test exposes a platform-specific bug.

### Packaging

Add Linux packaging to all desktop builder configs:

- `apps/desktop/electron-builder.yml`
- `apps/desktop/electron-builder.cn.yml`
- `apps/desktop/electron-builder.global.yml`

Linux packaging should use:

- `target: deb`
- `category: Utility`
- `executableName: Vivi Drop`
- extra resources containing `syncflow-sidecar`
- artifact names that include platform and arch, for example:
  - `ViviDrop-${version}-linux-amd64.deb`
  - `ViviDrop-${version}-linux-arm64.deb`

The `.deb` package should install a usable `.desktop` entry and application icon through electron-builder defaults/resources.

### Sidecar Build Script

Add `apps/desktop/scripts/build-sidecar-linux.cjs`.

The script should:

- Accept an arch argument: `x64` or `arm64`.
- Map Electron `x64` to Go `amd64`, and Electron `arm64` to Go `arm64`.
- Require Linux host builds for formal release.
- Set:
  - `GOOS=linux`
  - `GOARCH=<mapped arch>`
  - `CGO_ENABLED=1`
- Build `services/sidecar-go/cmd/syncflow-sidecar`.
- Output `apps/desktop/resources/syncflow-sidecar`.
- `chmod 755` the output binary.

First release does not require one machine to build both architectures. Each VM can build its native arch.

### Package Scripts

Add desktop scripts equivalent to Windows/macOS entries:

- `build:sidecar:linux`
- `package:linux`
- `package:linux:cn`
- `package:linux:global`

The Linux package scripts should:

1. Build workspace packages.
2. Build the Linux sidecar for the current/native architecture.
3. Run electron-builder with Linux `deb` target and explicit arch.

The root package should expose:

- `package:desktop:linux`

### Release Profiles

Extend `scripts/release/release-profiles.mjs`:

- Add `linux` to the supported target set.
- Add `desktopLinuxScript` per profile, or derive it from market.
- Build release steps so `pnpm release --profile <profile> --targets linux` works.

The release profile environment remains authoritative for:

- `SYNCFLOW_MARKET`
- `SYNCFLOW_API_BASE_URL`
- `VIVIDROP_API_BASE_URL`
- gift card/auth/client config base URLs

Manual environment composition must not replace release profiles.

## UX Behavior

Linux should behave like a first-class desktop platform but avoid platform-specific promises that are not implemented.

- Apple sign-in is hidden.
- Windows advanced sharing buttons and `ms-settings:` links are hidden.
- Mac file sharing guide remains Mac-only.
- Linux uses a neutral manual sharing/help state; Mac and Windows help text must not be presented as Linux guidance.
- Receive, shared, and personal paths should remain visible and openable through the preload bridge.
- If Linux share detection returns `needs_manual_enable`, the settings UI should present a neutral manual sharing state rather than Windows-only instructions.

## Installation Environment

Each Linux VM should include:

```bash
sudo apt update
sudo apt install -y \
  git curl ca-certificates build-essential pkg-config python3 make \
  dpkg-dev fakeroot lintian desktop-file-utils patchelf \
  libsqlite3-dev avahi-utils qemu-guest-agent spice-vdagent
```

Runtime networking must allow:

- TCP `39393`
- TCP `39394`
- UDP `5353` for mDNS

UTM networking should use bridged mode for real-device pairing tests.

## Testing

### Automated

Run before Linux packaging:

- `pnpm --filter @lynavo-drive/desktop test`
- `pnpm --filter @lynavo-drive/desktop typecheck`
- `cd services/sidecar-go && go test ./...`
- release profile tests for Linux target parsing and command generation
- package script tests for sidecar Linux arch mapping where practical

### Manual VM Validation

For each Ubuntu 22.04 architecture:

1. Build the `.deb`.
2. Install with `sudo apt install ./<artifact>.deb`.
3. Launch from the desktop app menu and from terminal if needed.
4. Confirm sidecar starts and health reaches healthy.
5. Confirm ports `39393` and `39394` listen locally.
6. Confirm mDNS advertises the desktop or the mobile app can discover it.
7. Pair a real iOS device.
8. Pair a real Android device.
9. Upload photos/videos from each mobile platform.
10. Restart the Linux desktop app and confirm paired state/history remains.
11. Open receive/shared/personal folders from the UI.
12. Uninstall and reinstall the `.deb`; confirm expected persistence behavior.

## Risks

- `amd64` UTM emulation on Apple Silicon may be too slow for productive builds. A physical or hosted local x86_64 Linux builder may be needed for release speed.
- Electron-builder `.deb` dependencies may need tuning after install tests on clean Ubuntu.
- mDNS behavior depends on bridged networking and local firewall settings.
- Linux desktop environments differ. First release should validate Ubuntu GNOME and avoid broader distro claims.
- CGO links against system libraries. Building on Ubuntu 22.04 is required for the 22.04+ compatibility floor.

## Rollout

1. Add Linux platform capability tests and renderer behavior tests.
2. Add sidecar Linux build script and package scripts.
3. Add electron-builder Linux deb config.
4. Add release profile target support.
5. Build and install `arm64.deb` on Ubuntu 22.04 arm64.
6. Build and install `amd64.deb` on Ubuntu 22.04 amd64.
7. Run real-device pairing/upload validation.
8. Update release playbook and beta test matrix with Linux entries.
