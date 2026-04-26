# RNIap Podspec — Manual Patch Required After `pnpm install`

> Status: temporary local workaround. Re-apply manually after each `pnpm install` in `apps/mobile/`.
> If/when `patch-package` is added to the project, convert this into a real patch file.

## Background

`react-native-iap@^12.16.4` declares Pod dependencies on:

- `RCT-Folly`
- `RCTRequired`
- `RCTTypeSafety`

These were the right thing to depend on under the classic React Native source build.
However, the iOS app now builds with **`RCT_USE_RN_DEP=1`** (prebuilt React Native
dependencies), which means those three modules are **already provided by the
prebuilt `ReactNativeDependencies.xcframework`**. Letting `RNIap.podspec` declare
them again forces CocoaPods to also build the source-form pods, which:

1. Conflicts with the prebuilt xcframework symbols.
2. Drags in `RCT-Folly` source compilation, which fails on Xcode 16 / Swift 6.

There is also a related, separate issue (CocoaPods #12866 — "pathname contains
null byte") triggered by pnpm's deeply-nested `.pnpm/...` path for
`react-native-iap`. That one is mitigated at the developer's own machine
(e.g. by symlinking the package to a short path); it is **not** addressed here
and must **not** be checked in.

## Required Patch (re-apply after every `pnpm install`)

File: `apps/mobile/node_modules/react-native-iap/RNIap.podspec`

Inside the `if ENV['RCT_NEW_ARCH_ENABLED'] == '1' then` block, comment out
the three offending `s.dependency` lines so the block looks like:

```ruby
if ENV['RCT_NEW_ARCH_ENABLED'] == '1' then
  s.compiler_flags = folly_compiler_flags + " -DRCT_NEW_ARCH_ENABLED=1"
  s.pod_target_xcconfig    = {
      "HEADER_SEARCH_PATHS" => "\"$(PODS_ROOT)/boost\"",
      "CLANG_CXX_LANGUAGE_STANDARD" => "c++17"
  }

  # PATCH: provided via prebuilt ReactNativeDependencies xcframework — s.dependency "RCT-Folly"
  # PATCH: provided via prebuilt ReactNativeDependencies xcframework — s.dependency "RCTRequired"
  # PATCH: provided via prebuilt ReactNativeDependencies xcframework — s.dependency "RCTTypeSafety"
  s.dependency "ReactCommon/turbomodule/core"
end
```

The three lines being commented out (verbatim, in order):

```ruby
s.dependency "RCT-Folly"
s.dependency "RCTRequired"
s.dependency "RCTTypeSafety"
```

Leave `s.dependency "React-Core"` (line 21, outside the `if` block) and
`s.dependency "ReactCommon/turbomodule/core"` (last line of the block) **alone**.

## After Patching

From `apps/mobile/ios/`:

```bash
RCT_USE_RN_DEP=1 pod install
```

`Podfile.lock` should now show `RNIap` with only:

```
- RNIap (12.16.4):
  - React-Core
  - ReactCommon/turbomodule/core
```

and `RCTRequired` / `RCTTypeSafety` / `ReactNativeDependencies` should
**not** appear under `RNIap`'s nested deps.

## When To Drop This Doc

Delete this file once **either** of the following is true:

1. Upstream `react-native-iap` ships a podspec that respects `RCT_USE_RN_DEP`
   and conditionally drops the three deps; **or**
2. The project adopts `patch-package` (or a CocoaPods post-install hook) and
   this patch is applied automatically — at which point the patch file lives
   in `apps/mobile/patches/react-native-iap+<version>.patch` and this doc
   becomes stale.

## Why Not Commit the `react-native.config.js` / `Podfile.lock` Workaround?

The `/tmp/rniap-<pid>/` redirect in `react-native.config.js` and the
matching `:path:` rewrite in `Podfile.lock` are **per-developer-machine**
(the `/tmp` directory and the PID-suffixed folder do not exist on anyone
else's machine, and the relative `../../../../...` path baked into
`Podfile.lock` is brittle). Those edits must stay local — see commit
hygiene notes in the task brief.
