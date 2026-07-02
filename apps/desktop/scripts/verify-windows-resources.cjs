const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const resourcesDir = path.join(projectRoot, 'resources');

const required = [
  {
    file: 'lynavo-drive-sidecar.exe',
    hint: 'Run `pnpm build:sidecar:win` — requires Go + a Windows C compiler (e.g. x86_64-w64-mingw32-gcc on macOS/Linux).',
  },
];

const optional = [
  {
    file: 'dns-sd.exe',
    hint:
      'Native Bonjour runtime was not bundled. Windows users can install Apple Bonjour Print Services,\n' +
      '      or the app will use the built-in zeroconf-compatible fallback.',
  },
  {
    file: 'dnssd.dll',
    hint: 'Native Bonjour runtime DLL was not bundled; continuing with fallback support.',
  },
];

const missing = required.filter(({ file }) => !fs.existsSync(path.join(resourcesDir, file)));
const missingOptional = optional.filter(
  ({ file }) => !fs.existsSync(path.join(resourcesDir, file)),
);

if (missing.length === 0) {
  console.log('[verify-windows-resources] all required Windows resources present ✓');
  if (missingOptional.length > 0) {
    console.warn('[verify-windows-resources] optional Windows resources missing:');
    for (const { file, hint } of missingOptional) {
      console.warn(`  ! apps/desktop/resources/${file}`);
      console.warn(`    → ${hint}`);
    }
    console.warn(
      '  Continuing; sidecar will use the built-in zeroconf-compatible fallback when needed.',
    );
  }
  process.exit(0);
}

console.error(
  '\n[verify-windows-resources] refusing to package — required Windows resources missing:',
);
for (const { file, hint } of missing) {
  console.error(`  ✗ apps/desktop/resources/${file}`);
  console.error(`    → ${hint}`);
}
console.error('');
process.exit(1);
