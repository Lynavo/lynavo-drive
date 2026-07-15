import assert from 'node:assert/strict';
import test from 'node:test';

import { assertPortablePodLock } from '../verify-pod-lock-portability.mjs';

const originalLock = `
PODS:
  - LocalPod (1.0.0)
  - RemotePod (2.0.0)
DEPENDENCIES:
  - LocalPod (from \`../local-pod\`)
  - RemotePod (= 2.0.0)
EXTERNAL SOURCES:
  LocalPod:
    :path: ../local-pod
SPEC CHECKSUMS:
  LocalPod: local-checksum-a
  RemotePod: remote-checksum
PODFILE CHECKSUM: podfile-checksum
COCOAPODS: 1.16.2
`;

test('accepts checkout-dependent checksum changes for external source pods', () => {
  const installedLock = originalLock.replace('local-checksum-a', 'local-checksum-b');

  assert.doesNotThrow(() => assertPortablePodLock(originalLock, installedLock));
});

test('rejects checksum changes for repository pods', () => {
  const installedLock = originalLock.replace('remote-checksum', 'changed-remote-checksum');

  assert.throws(
    () => assertPortablePodLock(originalLock, installedLock),
    /Podfile.lock changed outside external source checksums/,
  );
});

test('rejects dependency version changes', () => {
  const installedLock = originalLock.replaceAll('2.0.0', '2.1.0');

  assert.throws(
    () => assertPortablePodLock(originalLock, installedLock),
    /Podfile.lock changed outside external source checksums/,
  );
});
