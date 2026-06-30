# Team Shared, Receive, And Personal Shared Directories

> Current implementation note for agentic workers. The older `personal/received`
> layout is intentionally obsolete.

## Requirement Summary

- **Team shared directory (`shared`)**
  - Visible to LAN-connected devices.
  - Desktop exposes it as the team shared folder.
  - Its effective path is derived from the root path: `<rootPath>/shared`.
  - It remains available without account bearer-token authorization.

- **Receive directory (`received`)**
  - Destination for LAN mobile-to-desktop uploads.
  - Desktop exposes it as the receive folder.
  - Its effective path is derived from the root path: `<rootPath>/received`.
  - It is not automatically included in the personal shared directory.

- **Personal shared directory (`personal`)**
  - Visible only when the mobile and desktop are signed in to the same account.
  - Desktop can configure it independently.
  - It is not affected by `rootPath`.
  - It may point at a whole disk or volume root, such as `C:\`, `D:\`, or
    `Macintosh HD`.

## Implemented Shape

- Contracts add `SettingsDTO.personalPath`, `DirectoryScope`, and
  `DirectoryListingDTO`.
- Sidecar keeps `/shared/*` as the LAN team-shared surface.
- Sidecar adds `/personal/*` as an account-gated browse/download/stream surface.
- Updating `rootPath` updates receive/team-shared paths only.
- Updating `personalPath` updates only the personal shared path.
- Mobile shared-files browsing has `team` and `personal` scopes.
- Desktop settings and directory views show receive, team shared, and personal
  shared paths as separate concepts.

## Verification Targets

```bash
go test ./...
pnpm --filter @lynavo-drive/desktop test
pnpm --filter @lynavo-drive/desktop typecheck
pnpm --filter @lynavo-drive/mobile test -- SharedFilesDownloadGate.test.tsx --runInBand
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
pnpm --filter @lynavo-drive/contracts build
git diff --check
```
