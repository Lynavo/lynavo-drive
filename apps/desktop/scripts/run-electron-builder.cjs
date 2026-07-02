const { spawn } = require('node:child_process');
const path = require('node:path');
const { buildReleaseChildEnv } = require('../../../scripts/dev/release-child-env.cjs');

const projectRoot = path.resolve(__dirname, '..');
const binName = process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder';
const binPath = path.join(projectRoot, 'node_modules', '.bin', binName);
const spawnCommand = process.platform === 'win32' ? 'cmd.exe' : binPath;
const spawnArgs =
  process.platform === 'win32'
    ? ['/d', '/c', binPath, ...process.argv.slice(2)]
    : process.argv.slice(2);

const child = spawn(spawnCommand, spawnArgs, {
  cwd: projectRoot,
  env: buildReleaseChildEnv(process.env, {
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    ELECTRON_BUILDER_DISABLE_BUILD_CACHE: 'true',
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
