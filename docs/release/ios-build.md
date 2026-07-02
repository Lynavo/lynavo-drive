# iOS Build Verification

Use this page for local iOS build verification.

## Local Build

From the repository root:

```bash
pnpm build:mobile
pnpm build:mobile:ios:release
```

These commands run generic iOS device builds with `CODE_SIGNING_ALLOWED=NO`.
They verify that the React Native app and native iOS sources compile without
requiring an Apple Developer account.

## Release Profile Dry Run

The repository release profile keeps iOS as a build verification target:

```bash
pnpm release --profile review --targets ios --dry-run
pnpm release --profile prod --targets ios --dry-run
```

Expected iOS command:

```bash
pnpm --filter @lynavo-drive/mobile build:ios:release
```
