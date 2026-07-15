const { spawn } = require('node:child_process');

const packageManagerEntrypoint = process.env.npm_execpath;

if (!packageManagerEntrypoint) {
  console.error('Missing npm_execpath; cannot locate workspace package manager.');
  process.exit(1);
}

const child = spawn(process.execPath, [packageManagerEntrypoint, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
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
