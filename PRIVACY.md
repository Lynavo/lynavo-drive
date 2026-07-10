# Privacy

Lynavo Drive OSS is designed for local LAN operation.

## Data That Stays Local

- media scanning state and pending upload queues
- pairing state and desktop/device identity
- desktop receive/shared folder settings
- transfer history and diagnostics logs

The OSS runtime does not include official account login, cloud relay, remote
diagnostic upload, or automatic update checks.

## Diagnostics

Diagnostics are exported to a local file. Users decide whether and how to share
that file with maintainers. Diagnostics may include local paths, device names,
network addresses, runtime logs, and transfer metadata. Local database snapshots
should only be included or shared with explicit user opt-in, and public reports
should redact sensitive paths, device names, addresses, filenames, and local
history.

## Network Behavior

The app uses local discovery, pairing, and file transfer on the LAN. Remote
access, tunnel credentials, server-side capability services, and cloud-assisted
routing are outside the OSS runtime.
