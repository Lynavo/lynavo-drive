# Lynavo Drive Mobile

React Native mobile app for Lynavo Drive OSS.

## Scope

- iOS and Android local LAN discovery, pairing, and foreground automatic upload
- media scanning into the local pending queue
- shared-folder browsing and downloads from the desktop sidecar

The OSS mobile runtime does not include official identity service,
server-side account recovery, cloud relay credentials, off-LAN routing,
OS-level continuation while the app is not foregrounded, or manual file picking
as an upload path.

## Commands

Run from the repository root unless noted:

```bash
pnpm --filter @lynavo-drive/mobile start
pnpm --filter @lynavo-drive/mobile android
pnpm --filter @lynavo-drive/mobile ios
pnpm --filter @lynavo-drive/mobile exec tsc --noEmit
pnpm --filter @lynavo-drive/mobile build:ios:release
pnpm --filter @lynavo-drive/mobile build:android
```

For iOS native builds, install CocoaPods dependencies in `apps/mobile/ios` when
native dependencies change.

## Release Boundary

Use the root release profile commands for OSS verification:

```bash
pnpm release --profile review --targets ios,android --dry-run
pnpm release --profile prod --targets ios,android --dry-run
```

Do not add official store-upload, signing, account-service, hosted-service, or
remote diagnostic upload paths to the OSS mobile app.
