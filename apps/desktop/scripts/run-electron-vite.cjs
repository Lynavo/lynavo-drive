const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const { buildReleaseChildEnv } = require('../../../scripts/dev/release-child-env.cjs');

function main() {
  const command = process.argv[2];
  const extraArgs = process.argv.slice(3);

  if (!command) {
    console.error('Missing electron-vite command.');
    process.exit(1);
  }

  const projectRoot = path.resolve(__dirname, '..');
  const binName = process.platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite';
  const binPath = path.join(projectRoot, 'node_modules', '.bin', binName);
  const env = buildElectronViteEnv({
    command,
    parentEnv: process.env,
  });

  if (process.platform === 'win32') {
    const syncScriptPath = path.join(__dirname, 'sync-bonjour-runtime.cjs');
    const syncResult = spawnSync(process.execPath, [syncScriptPath], {
      cwd: projectRoot,
      env,
      stdio: 'inherit',
    });
    if (syncResult.status && syncResult.status !== 0) {
      process.exit(syncResult.status);
    }
  }

  const spawnCommand = process.platform === 'win32' ? 'cmd.exe' : binPath;
  const spawnArgs =
    process.platform === 'win32'
      ? ['/d', '/c', binPath, command, ...extraArgs]
      : [command, ...extraArgs];

  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(spawnCommand, spawnArgs, {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  child.on('error', (error) => {
    console.error(error);
    process.exit(1);
  });
}

function buildElectronViteEnv({ command, parentEnv }) {
  const env = buildReleaseChildEnv(parentEnv);

  if (command === 'dev') {
    bridgeLynavoDevEnv(env);
  }

  return env;
}

function bridgeLynavoDevEnv(env) {
  const releaseChannel = firstNonEmpty(env.LYNAVO_RELEASE_CHANNEL);

  if (releaseChannel) {
    env.LYNAVO_RELEASE_CHANNEL = releaseChannel;
  }
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) {
      return trimmed;
    }
  }
  return '';
}

if (require.main === module) {
  main();
}

module.exports = {
  buildElectronViteEnv,
};
