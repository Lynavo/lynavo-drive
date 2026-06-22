const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { resolveLinuxArch } = require('./build-sidecar-linux.cjs');

const projectRoot = path.resolve(__dirname, '..');
const scriptsRoot = path.join(projectRoot, 'scripts');

function resolvePackageLinuxOptions(args = process.argv.slice(2), processInfo = process) {
  let builderConfig = null;
  const archArgs = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--config') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('--config requires an electron-builder config filename.');
      }
      builderConfig = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--config=')) {
      const value = arg.slice('--config='.length);
      if (!value) {
        throw new Error('--config requires an electron-builder config filename.');
      }
      builderConfig = value;
      continue;
    }

    archArgs.push(arg);
  }

  return {
    arch: resolveLinuxArch(archArgs, processInfo.arch),
    builderConfig,
  };
}

function buildPackageLinuxCommands({ arch, builderConfig }) {
  const builderArgs = [];
  if (builderConfig) {
    builderArgs.push('--config', builderConfig);
  }
  builderArgs.push('--linux', 'deb', `--${arch}`);

  return [
    {
      script: 'run-workspace-pnpm.cjs',
      args: ['build'],
    },
    {
      script: 'build-sidecar-linux.cjs',
      args: ['--arch', arch],
    },
    {
      script: 'run-electron-builder.cjs',
      args: builderArgs,
    },
  ];
}

function buildRuntimeCommands(options) {
  return buildPackageLinuxCommands(options).map((step) => ({
    command: process.execPath,
    args: [path.join(scriptsRoot, step.script), ...step.args],
    options: {
      cwd: projectRoot,
      env: process.env,
      stdio: 'inherit',
    },
  }));
}

function run() {
  if (process.platform !== 'linux') {
    console.error('package-linux.cjs must run on Linux for release builds.');
    process.exit(1);
  }

  let options;
  try {
    options = resolvePackageLinuxOptions();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  for (const step of buildRuntimeCommands(options)) {
    const result = spawnSync(step.command, step.args, step.options);
    if (result.signal) {
      process.kill(process.pid, result.signal);
      return;
    }
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
}

module.exports = {
  buildPackageLinuxCommands,
  buildRuntimeCommands,
  resolvePackageLinuxOptions,
};

if (require.main === module) {
  run();
}
