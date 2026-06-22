const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const sidecarRoot = path.resolve(__dirname, '..', '..', '..', 'services', 'sidecar-go');
const outputPath = path.resolve(__dirname, '..', 'resources', 'syncflow-sidecar');

function mapElectronArchToGoArch(arch) {
  if (arch === 'x64') return 'amd64';
  if (arch === 'arm64') return 'arm64';
  throw new Error(`Unsupported Linux sidecar arch "${arch}". Expected x64 or arm64.`);
}

function resolveLinuxArch(args = process.argv.slice(2), processArch = process.arch) {
  const archFlagIndex = args.indexOf('--arch');
  if (archFlagIndex >= 0) {
    const value = args[archFlagIndex + 1];
    if (!value) {
      throw new Error('--arch requires x64 or arm64.');
    }
    mapElectronArchToGoArch(value);
    return value;
  }

  const positional = args.find((arg) => !arg.startsWith('-'));
  if (positional) {
    mapElectronArchToGoArch(positional);
    return positional;
  }

  if (processArch === 'x64' || processArch === 'arm64') return processArch;
  throw new Error(`Unsupported host arch "${processArch}". Expected x64 or arm64.`);
}

function buildLinuxSidecarEnv(arch, baseEnv = process.env) {
  return {
    ...baseEnv,
    GOOS: 'linux',
    GOARCH: mapElectronArchToGoArch(arch),
    CGO_ENABLED: '1',
  };
}

function run() {
  if (process.platform !== 'linux') {
    console.error('build-sidecar-linux.cjs must run on Linux for release builds.');
    process.exit(1);
  }

  let arch;
  try {
    arch = resolveLinuxArch();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const child = spawn('go', ['build', '-o', outputPath, './cmd/syncflow-sidecar/'], {
    cwd: sidecarRoot,
    env: buildLinuxSidecarEnv(arch),
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    if ((code ?? 0) === 0) {
      fs.chmodSync(outputPath, 0o755);
    }

    process.exit(code ?? 0);
  });

  child.on('error', (error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  buildLinuxSidecarEnv,
  mapElectronArchToGoArch,
  outputPath,
  resolveLinuxArch,
  sidecarRoot,
};

if (require.main === module) {
  run();
}
