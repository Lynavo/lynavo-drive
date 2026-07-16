## Summary

<!-- Describe what changed and why. Link related issues when applicable. -->

## Impact Scope

<!-- List directly modified modules, call chains, user-visible behavior, and affected platforms. -->

- Modules:
- User-visible behavior:
- Platforms: <!-- iOS / Android / macOS / Windows / Linux verification only / N/A -->

## Validation

<!-- List each command or manual check and its result. Explain anything not run. -->

| Check               | Result |
| ------------------- | ------ |
| Focused tests       |        |
| `pnpm gate:release` |        |

## Visual Evidence

<!-- Add before/after screenshots or recordings for UI changes. Write "N/A" otherwise. -->

## Contamination Review

<!-- Mark each item and explain any intentional impact. -->

- [ ] Shared DTOs and protocol contracts are unchanged or explicitly documented.
- [ ] Persistence, migrations, and history statistics are unchanged or explicitly documented.
- [ ] Queue semantics and sync state machines are unchanged or explicitly documented.
- [ ] Permission and account-service gates are unchanged or explicitly documented.
- [ ] OSS capability, signing, packaging, and distribution boundaries remain intact.
- [ ] Non-target paths were reviewed for accidental changes.

## Checklist

- [ ] I reviewed my own diff and removed unrelated changes.
- [ ] I added or updated tests for behavior changes.
- [ ] I updated documentation for changed behavior, build paths, or OSS boundaries.
- [ ] I did not add secrets, signing material, generated packages, local databases, diagnostics archives, or proprietary binaries.
- [ ] I preserved foreground guest LAN sync and fail-closed non-OSS capabilities.
