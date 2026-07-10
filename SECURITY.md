# Security Policy

## Supported Versions

The public open-source baseline is supported from the default branch. Historical
private release branches are not part of the OSS support surface.

## Reporting a Vulnerability

Do not post exploitable security details in a public issue. Report suspected
vulnerabilities through GitHub private vulnerability reporting:

<https://github.com/lynavo/lynavo-drive/security/advisories/new>

If GitHub private vulnerability reporting is unavailable, open a public issue
titled "Security contact request" without exploit details so maintainers can
provide a private contact path.

Include:

- affected platform and version
- reproduction steps
- impact assessment
- whether credentials, pairing codes, local files, or LAN services are exposed

## Security Scope

Lynavo Drive OSS is a local LAN sync tool. Official account services, remote
relay, server-side capability checks, update services, and diagnostic upload
services are not part of this repository.

Do not submit secrets, signing material, local databases, diagnostic archives,
or generated packages to public issues or pull requests.
