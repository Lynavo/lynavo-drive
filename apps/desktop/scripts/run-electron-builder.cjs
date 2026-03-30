const { spawn } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const binName = process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder';
const binPath = path.join(projectRoot, 'node_modules', '.bin', binName);
const env = {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
};
const spawnCommand = process.platform === 'win32' ? 'cmd.exe' : binPath;
const spawnArgs =
  process.platform === 'win32'
    ? ['/d', '/c', binPath, ...process.argv.slice(2)]
    : process.argv.slice(2);

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
