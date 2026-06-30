# Global Remote Access Personal Root Design

## Context

The global mobile app labels the old `My Computer` entry as `Remote Resources -> Remote Access Computer`. The displayed contents must remain the old `My Computer` contents: on macOS this is the configured user-home based personal root, and on Windows this is the local computer virtual drive root.

The sidecar already exposes this behavior through the account-scoped personal directory API. The `/personal/*` HTTP route is an API namespace, not a filesystem path. It resolves to `Config.PersonalDir()`, whose default is `os.UserHomeDir()` when available, and supports Windows virtual drives through `personalPathMode=windowsDrives`.

## Requirements

- Global `RemoteAccessGlobalScreen` must browse the desktop personal directory, not the managed shared resource registry or legacy team shared directory fallback.
- Folder browsing, download, preview, and share operations must use the existing native shared-file bridge with `scope='personal'`.
- The UI title may stay `Remote Access`; the content source is the former `My Computer`.
- Existing CN legacy shared-resource behavior must not change.
- No desktop sidecar route or filesystem root change is required.

## Design

Add a small adapter in `apps/mobile/src/services/desktop-local-service.ts` that represents personal directory files as `DesktopSharedResourceDTO` items for the global remote access screen.

The adapter will:

- Call `browseDirectory('personal')` for root and folder listing.
- Encode personal directory paths with a local-only `personal-dir:` resource id prefix.
- Use `downloadDirectoryFile('personal')`, `prepareDirectoryFilePreview('personal')`, and native cache/share helpers for personal file operations.
- Keep the existing managed shared-resource and `shared-dir:` fallback functions intact for non-global legacy paths.

## Testing

Focused tests will cover:

- Listing global remote access root calls the personal directory bridge and maps folders/files into remote resource items.
- Listing a nested personal folder decodes the `personal-dir:` id and calls the personal directory bridge with the joined path.
- Download, preview, and share for `personal-dir:` items call the personal directory bridge instead of `/shared/*` or `/resources/mobile/shared`.

The regression command is:

```bash
pnpm --filter @lynavo-drive/mobile test -- desktop-local-service.test.ts
```
