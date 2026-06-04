const { spawn, spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { VIVIDROP_REVIEW_API_BASE_URL } = require('@syncflow/contracts');
const {
  resolveDefaultAppleSignConfigDir,
  resolveDefaultGoogleClientConfigDir,
} = require('./run-electron-vite-config.cjs');

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
const reviewApiBaseUrl = VIVIDROP_REVIEW_API_BASE_URL;

if (command === 'dev' && !env.SYNCFLOW_API_BASE_URL && !env.VIVIDROP_API_BASE_URL) {
  env.SYNCFLOW_API_BASE_URL = reviewApiBaseUrl;
}

if (command === 'dev' && !env.SYNCFLOW_GIFTCARD_REDEEM_BASE_URL) {
  env.SYNCFLOW_GIFTCARD_REDEEM_BASE_URL = reviewApiBaseUrl;
}

const googleClientConfigDir = resolveDefaultGoogleClientConfigDir({
  command,
  env,
  existsSync,
  projectRoot,
});
if (googleClientConfigDir) {
  env.SYNCFLOW_GOOGLE_CLIENT_CONFIG_DIR = googleClientConfigDir;
}

const appleSignConfigDir = resolveDefaultAppleSignConfigDir({
  command,
  env,
  existsSync,
  projectRoot,
});
if (appleSignConfigDir) {
  env.SYNCFLOW_APPLE_SIGN_CONFIG_DIR = appleSignConfigDir;
}

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
