# Third-Party Notices

This repository contains source code and package manifests for an OSS local LAN
sync application. Third-party JavaScript, native, Go, Android, and iOS
dependencies are declared in the relevant package manifests and lockfiles.

## Bundled Source-Build Exceptions

- `apps/mobile/android/gradle/wrapper/gradle-wrapper.jar` is kept as the Gradle
  wrapper bootstrap jar required for local source builds.

## Apple Bonjour for Windows

The OSS source package does not redistribute Apple Bonjour for Windows binaries
such as `dns-sd.exe` or `dnssd.dll`.

Windows builds may use native Bonjour only when the user has installed it
locally or a maintainer stages it locally from a permitted source. If a future
official package bundles those binaries, maintainers must first confirm
redistribution rights and record the source URL, version, hashes, and required
notices.
