const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');

const sidecarRoot = path.resolve(__dirname, '..', '..', '..', 'services', 'sidecar-go');
const outputPath = path.resolve(__dirname, '..', 'resources', 'syncflow-sidecar.exe');
const syncScriptPath = path.resolve(__dirname, 'sync-bonjour-runtime.cjs');
const env = {
  ...process.env,
  GOOS: 'windows',
  GOARCH: 'amd64',
  CGO_ENABLED: '1',
};

if (process.platform !== 'win32' && !env.CC) {
  env.CC = 'x86_64-w64-mingw32-gcc';
}

const syncResult = spawnSync(process.execPath, [syncScriptPath], {
  cwd: path.resolve(__dirname, '..'),
  env: process.env,
  stdio: 'inherit',
});

if (syncResult.status && syncResult.status !== 0) {
  process.exit(syncResult.status);
}

const child = spawn(
  'go',
  ['build', '-o', outputPath, './cmd/syncflow-sidecar/'],
  {
    cwd: sidecarRoot,
    env,
    stdio: 'inherit',
  },
);

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

