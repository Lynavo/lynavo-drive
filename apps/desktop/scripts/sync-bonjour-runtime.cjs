const fs = require('node:fs');
const path = require('node:path');

const isWindows = process.platform === 'win32';
const projectRoot = path.resolve(__dirname, '..');
const resourcesDir = path.join(projectRoot, 'resources');
const dnsSDFileName = 'dns-sd.exe';
const dnsSDDLLName = 'dnssd.dll';

if (!isWindows) {
  process.exit(0);
}

function candidatePaths() {
  const candidates = [];
  const pathEntries = (process.env.PATH || process.env.Path || '')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (process.env.SYNCFLOW_DNSSD_PATH) {
    candidates.push(process.env.SYNCFLOW_DNSSD_PATH);
  }

  if (process.env.SYNCFLOW_BONJOUR_DIR) {
    candidates.push(path.join(process.env.SYNCFLOW_BONJOUR_DIR, dnsSDFileName));
  }

  for (const entry of pathEntries) {
    candidates.push(path.join(entry, dnsSDFileName));
  }

  for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
    if (!root) {
      continue;
    }
    candidates.push(path.join(root, 'Bonjour', dnsSDFileName));
    candidates.push(path.join(root, 'Bonjour Print Services', dnsSDFileName));
  }

  return [...new Set(candidates)];
}

function copyIfPresent(sourcePath, destinationPath) {
  if (!fs.existsSync(sourcePath)) {
    return false;
  }
  if (path.resolve(sourcePath) === path.resolve(destinationPath)) {
    return true;
  }
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
  return true;
}

const sourcePath = candidatePaths().find((candidate) => fs.existsSync(candidate));
if (!sourcePath) {
  console.warn('[sync-bonjour-runtime] dns-sd.exe not found; continuing without bundled Bonjour runtime');
  process.exit(0);
}

const sourceDir = path.dirname(sourcePath);
const copiedDNS = copyIfPresent(sourcePath, path.join(resourcesDir, dnsSDFileName));
const copiedDLL = copyIfPresent(path.join(sourceDir, dnsSDDLLName), path.join(resourcesDir, dnsSDDLLName));

if (copiedDNS) {
  console.log(`[sync-bonjour-runtime] staged ${dnsSDFileName} from ${sourcePath}`);
}
if (copiedDLL) {
  console.log(`[sync-bonjour-runtime] staged ${dnsSDDLLName} from ${sourceDir}`);
}
