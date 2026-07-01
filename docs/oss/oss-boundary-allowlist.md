# OSS Boundary Allowlist

This document tracks the strict OSS boundary scanner introduced for the global-only open-source baseline.

Run:

```bash
pnpm verify:oss-boundary
```

The scanner checks code paths and file names for commercial, account, entitlement, billing, paywall, remote-tunnel, third-party auth, and legacy `RemoteAccess*` naming. It intentionally scans code and build scripts, not historical product/commercial audit docs.

## Default Scope

Included by default:

- `apps/`
- `packages/`
- `services/`
- `scripts/`
- root workspace config files

Excluded by default:

- generated artifacts such as `node_modules`, `.turbo`, `dist`, `build`, `out`, `release`, coverage, DerivedData, Pods, and native build intermediates
- documentation outside the scanner/allowlist fixtures

## Allowed Compatibility Buckets

| Bucket                                     | Rationale                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Negative assertion tests and env scrubbers | These files name commercial/account inputs only to prove OSS runtime surfaces do not expose them. |
| React Native event subscriptions           | Listener handles named `subscription` are framework cleanup objects, not commercial state.        |
| LAN protocol auth wording                  | The iOS sync protocol comment uses `/auth/` for pairing/HMAC wire terminology, not account login. |
| Apple signing entitlements                 | Code-signing entitlements are platform packaging metadata, not commercial feature entitlements.   |

Every allowed hit is encoded in `scripts/verify-oss-boundary.mjs`. New hits should either be removed or added with a narrow path and rationale; do not broaden the default scan exclusions for active code.
