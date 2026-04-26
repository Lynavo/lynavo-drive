const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const resourcesDir = path.join(projectRoot, 'resources');

const required = [
  {
    file: 'syncflow-sidecar.exe',
    hint: 'Run `pnpm build:sidecar:win` — requires Go + a Windows C compiler (e.g. x86_64-w64-mingw32-gcc on macOS/Linux).',
  },
  {
    file: 'dns-sd.exe',
    hint:
      'Bonjour runtime missing. Either install Apple Bonjour Print Services on a Windows host, or drop\n' +
      '      dns-sd.exe + dnssd.dll into apps/desktop/resources-vendor/bonjour/, or set SYNCFLOW_BONJOUR_DIR.',
  },
  {
    file: 'dnssd.dll',
    hint: 'Bonjour runtime DLL missing — same resolution as dns-sd.exe above.',
  },
];

const missing = required.filter(({ file }) => !fs.existsSync(path.join(resourcesDir, file)));

if (missing.length === 0) {
  console.log('[verify-windows-resources] all required Windows resources present ✓');
  process.exit(0);
}

console.error('\n[verify-windows-resources] refusing to package — required Windows resources missing:');
for (const { file, hint } of missing) {
  console.error(`  ✗ apps/desktop/resources/${file}`);
  console.error(`    → ${hint}`);
}
console.error('');
process.exit(1);
