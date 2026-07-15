# Network Port Migration Design

## Goal

Move Lynavo Drive's local protocol and sidecar HTTP listeners away from ports
already used by sibling applications while preserving Lynavo Drive's existing,
non-conflicting DNS-SD service type.

## Approved Network Identity

- LMUP/TCP protocol port: `39593`
- Sidecar HTTP API port: `39594`
- DNS-SD service type: `_lynavodrive._tcp`

The occupied values `39393`, `39394`, `39493`, `39494`, `_syncflow._tcp`, and
`_vividrop._tcp` must not be used by current Lynavo Drive runtime code,
configuration, tests, or operational documentation. Historical completed design
and implementation records remain unchanged because they describe the state at
the time they were written.

## Architecture

`@lynavo-drive/contracts` remains the source of truth for TypeScript consumers.
The Go sidecar and native iOS and Android implementations cannot consume those
TypeScript constants directly, so their platform defaults must be updated in the
same atomic change. The Windows installer firewall rules and the checked-in
sidecar YAML configuration must match the new listener ports.

The DNS-SD type remains `_lynavodrive._tcp`. Discovery continues to advertise
the actual protocol port through DNS-SD, while manual-entry and recovery paths
use `39593` as their fallback. HTTP health, presence, shared-file, and received
library URLs use `39594`.

## Compatibility And Error Handling

This is an intentional network identity migration. Old app builds using the
previous ports are not guaranteed to interoperate with new builds through manual
fallback paths. DNS-SD discovery remains compatible at the service-type level
and supplies the advertised protocol port dynamically.

No fallback to occupied ports is retained. Existing connection failures,
timeouts, discovery fallback, and health-check behavior remain unchanged.

## Testing

Tests first assert the new shared constants, Go defaults, and Windows firewall
ports. Platform fixtures and native source defaults are then updated together.
Validation includes targeted tests, Go tests, TypeScript type checks/builds,
native Android verification where available, formatting checks, and a repository
scan for occupied identifiers outside historical records.

## Non-Goals

- Changing `_lynavodrive._tcp`
- Changing DTOs, protocol messages, persistence, queue behavior, or sync state
- Adding compatibility listeners on occupied ports
- Modifying signing, package identity, account, or remote-capability behavior
