const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const sidecarRoot = path.resolve(__dirname, '..', '..', '..', 'services', 'sidecar-go');
const resourcesDir = path.resolve(__dirname, '..', 'resources');
const buildDir = path.join(resourcesDir, '.sidecar-build');
const outputPath = path.join(resourcesDir, 'lynavo-drive-sidecar');
const target = process.argv[2] ?? 'universal';
const supportedTargets = new Set(['arm64', 'x64', 'universal']);

if (process.platform !== 'darwin') {
  console.error('build-sidecar-mac.cjs must run on macOS.');
  process.exit(1);
}

if (!supportedTargets.has(target)) {
  console.error(`Unsupported target "${target}". Expected one of: arm64, x64, universal.`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });

  if (result.status && result.status !== 0) {
    process.exit(result.status);
  }

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  if (result.status && result.status !== 0) {
    process.exit(result.status);
  }

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  return result.stdout.trim();
}

function buildArch(arch, sdkPath) {
  const goArch = arch === 'x64' ? 'amd64' : 'arm64';
  const clangArch = arch === 'x64' ? 'x86_64' : 'arm64';
  const output = path.join(buildDir, `lynavo-drive-sidecar-${arch}`);
  const archFlags = `-arch ${clangArch} -isysroot ${sdkPath} -mmacosx-version-min=11.0`;

  console.log(`Building macOS sidecar for ${arch}...`);

  run('go', ['build', '-o', output, './cmd/syncflow-sidecar/'], {
    cwd: sidecarRoot,
    env: {
      ...process.env,
      GOOS: 'darwin',
      GOARCH: goArch,
      CGO_ENABLED: '1',
      CC: 'clang',
      CXX: 'clang++',
      SDKROOT: sdkPath,
      MACOSX_DEPLOYMENT_TARGET: '11.0',
      CGO_CFLAGS: archFlags,
      CGO_CXXFLAGS: archFlags,
      CGO_LDFLAGS: archFlags,
    },
  });

  return output;
}

fs.mkdirSync(buildDir, { recursive: true });

const sdkPath = capture('xcrun', ['--sdk', 'macosx', '--show-sdk-path']);

if (!sdkPath) {
  console.error('Failed to resolve macOS SDK path via xcrun.');
  process.exit(1);
}

if (target === 'universal') {
  const arm64Binary = buildArch('arm64', sdkPath);
  const x64Binary = buildArch('x64', sdkPath);

  console.log('Combining arm64 and x64 sidecar binaries with lipo...');
  run('lipo', ['-create', '-output', outputPath, arm64Binary, x64Binary]);
} else {
  const binary = buildArch(target, sdkPath);
  fs.copyFileSync(binary, outputPath);
}

fs.chmodSync(outputPath, 0o755);

console.log(`macOS sidecar ready: ${outputPath}`);
