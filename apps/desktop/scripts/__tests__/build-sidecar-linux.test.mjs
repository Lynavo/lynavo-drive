import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildLinuxSidecarEnv,
  mapElectronArchToGoArch,
  outputPath,
  resolveLinuxArch,
  sidecarRoot,
} = require('../build-sidecar-linux.cjs');

test('maps Electron Linux package arches to Go arches', () => {
  assert.equal(mapElectronArchToGoArch('x64'), 'amd64');
  assert.equal(mapElectronArchToGoArch('arm64'), 'arm64');
  assert.throws(() => mapElectronArchToGoArch('ia32'), /Unsupported Linux sidecar arch/);
});

test('resolves explicit Linux sidecar arches from positional and flag arguments', () => {
  assert.equal(resolveLinuxArch(['arm64'], 'x64'), 'arm64');
  assert.equal(resolveLinuxArch(['x64'], 'arm64'), 'x64');
  assert.equal(resolveLinuxArch(['--arch', 'x64'], 'arm64'), 'x64');
  assert.equal(resolveLinuxArch(['--arch', 'arm64'], 'x64'), 'arm64');
});

test('defaults Linux sidecar arch from supported host process arches', () => {
  assert.equal(resolveLinuxArch([], 'x64'), 'x64');
  assert.equal(resolveLinuxArch([], 'arm64'), 'arm64');
});

test('rejects unsupported Linux sidecar arches', () => {
  assert.throws(() => resolveLinuxArch(['ia32'], 'x64'), /Unsupported Linux sidecar arch/);
  assert.throws(() => resolveLinuxArch(['--arch'], 'x64'), /--arch requires x64 or arm64/);
  assert.throws(() => resolveLinuxArch([], 'ppc64'), /Unsupported host arch/);
});

test('builds a CGO Linux sidecar environment while preserving the base env', () => {
  const baseEnv = {
    CGO_ENABLED: '0',
    GOARCH: '386',
    GOOS: 'darwin',
    PATH: '/usr/bin',
    LYNAVO_RELEASE_CHANNEL: 'prod',
  };

  const env = buildLinuxSidecarEnv('x64', baseEnv);

  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.LYNAVO_RELEASE_CHANNEL, 'prod');
  assert.equal(env.GOOS, 'linux');
  assert.equal(env.GOARCH, 'amd64');
  assert.equal(env.CGO_ENABLED, '1');
  assert.equal(baseEnv.GOOS, 'darwin');
  assert.equal(baseEnv.GOARCH, '386');
  assert.equal(baseEnv.CGO_ENABLED, '0');
});

test('exports deterministic sidecar paths for release packaging', () => {
  assert.match(sidecarRoot, /services[/\\]sidecar-go$/);
  assert.match(outputPath, /apps[/\\]desktop[/\\]resources[/\\]lynavo-drive-sidecar$/);
});
