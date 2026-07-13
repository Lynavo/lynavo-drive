# CN Market Removal Design

**Date:** 2026-07-13
**Status:** Approved for implementation planning

## Context

Lynavo Drive is a single global-only OSS baseline. Earlier cleanup removed the
active CN/Global market branching, commercial authentication, mainland payment
integrations, market build flavors, and dedicated release profiles. The current
tree still contains naming, data, metadata, tests, and unreachable UI inherited
from the former dual-market structure.

The cleanup must remove CN market and country-specific residue without removing
Simplified Chinese localization. `zh-Hans` remains a supported UI language on
desktop and mobile.

## Goals

1. Leave one market-neutral OSS application structure.
2. Remove CN-specific country data, test fixtures, locale defaults, and build or
   runtime metadata outside localization resources.
3. Remove unreachable desktop and mobile code inherited from market switching.
4. Replace active `Global` product-variant naming with neutral application
   naming.
5. Preserve all supported i18n languages, including `zh-Hans`.
6. Add repository checks that prevent CN market paths and configuration from
   returning.

## Non-Goals

1. Do not remove `zh-Hans` translation files, resource registration, language
   selection, locale resolution, or translation parity tests.
2. Do not change shared sync DTOs, protocol messages, event names, or ports.
3. Do not change queue ordering, serial upload, persistence, history bucketing,
   pairing identity, or sync state-machine behavior.
4. Do not add account, subscription, remote access, tunnel, update, signing,
   upload, or hosted release capabilities.
5. Do not rename package scopes, bundle identifiers, application identifiers,
   mDNS services, or legacy data directories.

## Chosen Approach

Use a full single-baseline cleanup instead of a literal token-only purge.
Removing only `CN` strings would leave dead variant branches and active
`Global*` names that imply another market still exists. The chosen approach
removes the obsolete branch structure and gives the surviving OSS application
neutral names.

## Design

### 1. Shared Country-Code Surface

The shared `COUNTRY_CODES` module has no production consumers. Removing only
the `CN/+86` entry would leave an intentionally incomplete international data
set. Remove the unused country-code contract as a whole:

- remove the country-code source module and tests;
- remove its package subpath and barrel exports;
- remove the mobile re-export shim;
- rebuild shared packages before dependent validation.

This does not affect pairing or sync identity, which use `clientId` and do not
consume phone country codes.

### 2. Desktop Variant Residue

Remove the always-true `isLynavoGlobalProduct()` helper and its tests. Remove
the permanently false settings branch that once hid regional sharing guidance.
The unreachable `ShareAddressSection` and `SystemGuideSection`, their isolated
tests, and translation keys used only by those components are removed.

Existing sidecar sharing APIs and settings persistence remain unchanged. The
cleanup removes only UI that is unreachable in the current committed runtime.

Set the renderer HTML document language to neutral English at bootstrap. The
runtime i18n initialization should synchronize `document.documentElement.lang`
with the selected supported locale so English, Traditional Chinese, and
Simplified Chinese all expose correct document metadata.

### 3. Mobile Screen Naming And Dead Variants

The runtime currently imports only `*GlobalScreen` components, while older
unsuffixed screen files are not part of production navigation. For each paired
screen family:

1. remove the unreachable unsuffixed implementation and tests that cover only
   that implementation;
2. rename the active `*GlobalScreen` implementation to the canonical
   `*Screen` name;
3. update production imports, Jest mocks, test names, and component identifiers;
4. rename helper identifiers containing `Global` when they represent the one
   surviving application rather than an external protocol concept.

Route names and navigation behavior stay unchanged. This is a source-level
normalization, not a user-visible navigation redesign.

### 4. Locale And Platform Metadata

Keep `zh-Hans` i18n resources and explicit language selection. Remove the
country-specific assumptions around them:

- replace CN-specific locale fixtures with script-based `zh-Hans` fixtures;
- keep resolver tests that prove Simplified Chinese support without requiring a
  China country code;
- derive sorting and date-picker locale from the active i18n language or system
  locale instead of hard-coded `zh-CN` or `zh-Hans` values;
- initialize settings language state from the current i18n preference instead
  of defaulting to `zh-Hans`;
- change the iOS development region to `en` while retaining `zh-Hans` as a
  supported localization;
- keep the existing `zh-Hans.lproj` resource and its localized permission copy.

The resulting application still supports Simplified Chinese, but no longer
uses China as a product default or test-environment assumption.

### 5. iOS App Icon

The `AppIcon` and `AppIconGlobal` asset catalogs contain identical image data.
Use the neutral `AppIcon` catalog for all build configurations and remove the
duplicate `AppIconGlobal` catalog. No visual icon change is expected.

### 6. OSS Boundary Guard

Extend the OSS source-package verification with narrowly defined checks for
market residue. The guard should reject source paths or configuration that
reintroduce known CN market structures, such as:

- `src/cn` product-flavor directories;
- CN-specific build schemes or builder configurations;
- market-switch environment variables and release profiles;
- known mainland payment or market configuration modules;
- China-only service endpoints in runtime configuration.

The guard must not reject:

- `zh-Hans` localization paths or resource identifiers;
- ordinary `cn()` CSS class-name helpers;
- historical prose in this approved design or other documentation that
  explains the removed boundary;
- negative test fixtures used only to verify the guard itself.

## Error Handling And Compatibility

This cleanup does not add runtime error paths. Build and test failures are the
primary compatibility signal:

- missing screen imports expose incomplete renames during TypeScript/Jest runs;
- missing translation keys expose over-removal during i18n parity and component
  tests;
- Xcode build settings expose incomplete app-icon or localization changes;
- package build failures expose stale shared country-code exports;
- the OSS source guard exposes newly introduced market configuration.

Existing persisted locale preferences remain valid because `zh-Hans`,
`zh-Hant`, and `en` identifiers are preserved.

## Test Strategy

Implementation follows test-first removal where behavior changes:

1. Add or update the OSS guard test and observe it fail against a representative
   forbidden CN market path before implementing the guard.
2. Add locale metadata tests that fail while HTML and runtime document language
   remain China-specific.
3. Add mobile locale behavior tests that fail while sorting, date selection, or
   settings initialization uses a hard-coded Simplified Chinese default.
4. Update navigation tests alongside the canonical screen-name transition and
   verify the surviving routes render the same components.
5. Remove tests only when their entire production subject is removed as dead
   code; do not replace behavioral coverage with deletion alone.

Validation targets:

- contracts and design-token build through the root `pnpm build` path;
- relevant desktop Vitest suites and desktop typecheck;
- relevant mobile Jest suites and mobile TypeScript typecheck;
- `pnpm gate:release`;
- iOS generic Debug and Release builds where locally feasible;
- Android Debug and Release source builds where locally feasible;
- final tracked-file and content scan for CN market residue with documented
  i18n and test-guard exceptions.

## Expected Impact

Directly affected areas are shared contract exports, desktop settings and i18n
metadata, mobile navigation/screens/tests, mobile locale handling, iOS project
metadata and icons, and OSS source verification.

User-visible behavior should remain the same except that locale-dependent
sorting, date controls, and document metadata follow the selected language or
system locale. Simplified Chinese remains available. Sync, queue, persistence,
pairing, permissions, and sidecar behavior remain untouched.

## Acceptance Criteria

1. No active CN market build, release, payment, account, endpoint, or runtime
   branch exists.
2. No active source component uses a product-variant `Global` suffix where only
   one OSS implementation remains.
3. No hard-coded China locale or country-code fixture remains outside approved
   i18n resources and guard documentation/tests.
4. The unused phone country-code contract surface is removed completely.
5. Desktop and mobile continue to support `en`, `zh-Hant`, and `zh-Hans`.
6. iOS uses the neutral app-icon catalog and an English development region.
7. The OSS guard rejects representative CN market structures without rejecting
   legitimate `zh-Hans` localization or the `cn()` styling helper.
8. Relevant tests, typechecks, builds, and the release gate pass, or any local
   platform limitation is explicitly reported.
