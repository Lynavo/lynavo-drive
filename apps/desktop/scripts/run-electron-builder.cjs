const { spawn } = require('node:child_process');
const path = require('node:path');
const { buildReleaseChildEnv } = require('../../../scripts/dev/release-child-env.cjs');

const projectRoot = path.resolve(__dirname, '..');
const binName = process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder';
const binPath = path.join(projectRoot, 'node_modules', '.bin', binName);
const spawnCommand = process.platform === 'win32' ? 'cmd.exe' : binPath;
const requestedArgs = process.argv.slice(2);
const publishArgIndex = requestedArgs.findIndex(
  (arg) => arg === '--publish' || arg.startsWith('--publish='),
);

if (publishArgIndex >= 0) {
  const publishValue = requestedArgs[publishArgIndex].startsWith('--publish=')
    ? requestedArgs[publishArgIndex].slice('--publish='.length)
    : requestedArgs[publishArgIndex + 1];

  if (publishValue !== 'never') {
    console.error('OSS desktop packaging does not support Electron Builder publishing.');
    process.exit(1);
  }
}

const builderArgs = publishArgIndex >= 0 ? requestedArgs : [...requestedArgs, '--publish', 'never'];
const spawnArgs =
  process.platform === 'win32' ? ['/d', '/c', binPath, ...builderArgs] : builderArgs;

const child = spawn(spawnCommand, spawnArgs, {
  cwd: projectRoot,
  env: buildReleaseChildEnv(process.env, {
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    ELECTRON_BUILDER_DISABLE_BUILD_CACHE: 'true',
    ELECTRON_BUILDER_PUBLISH: 'never',
  }),
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
