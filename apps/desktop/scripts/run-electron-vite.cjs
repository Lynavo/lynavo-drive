const { spawn } = require('node:child_process');
const path = require('node:path');

const command = process.argv[2];
const extraArgs = process.argv.slice(3);

if (!command) {
  console.error('Missing electron-vite command.');
  process.exit(1);
}

const projectRoot = path.resolve(__dirname, '..');
const binName = process.platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite';
const binPath = path.join(projectRoot, 'node_modules', '.bin', binName);
const env = { ...process.env };
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
