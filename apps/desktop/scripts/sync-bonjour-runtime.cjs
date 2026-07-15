const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const resourcesDir = path.join(projectRoot, 'resources');
const dnsSDFileName = 'dns-sd.exe';
const dnsSDDLLName = 'dnssd.dll';

function candidatePaths() {
  const candidates = [];

  if (process.env.LYNAVO_DNSSD_PATH) {
    candidates.push(process.env.LYNAVO_DNSSD_PATH);
  }

  if (process.env.LYNAVO_BONJOUR_DIR) {
    candidates.push(path.join(process.env.LYNAVO_BONJOUR_DIR, dnsSDFileName));
  }

  // Optional local-only staging. The OSS repository and default packages do not
  // redistribute Apple Bonjour binaries.
  candidates.push(path.join(projectRoot, 'resources-vendor', 'bonjour', dnsSDFileName));

  return [...new Set(candidates)];
}

function copyIfPresent(sourcePath, destinationPath) {
  if (!fs.existsSync(sourcePath)) {
    return 'missing';
  }
  if (path.resolve(sourcePath) === path.resolve(destinationPath)) {
    return 'reused';
  }

  const sourceStat = fs.statSync(sourcePath);
  if (fs.existsSync(destinationPath)) {
    const destinationStat = fs.statSync(destinationPath);
    const sameFile =
      destinationStat.size === sourceStat.size && destinationStat.mtimeMs === sourceStat.mtimeMs;
    if (sameFile) {
      return 'reused';
    }
  }

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  try {
    fs.copyFileSync(sourcePath, destinationPath);
  } catch (error) {
    if ((error?.code === 'EBUSY' || error?.code === 'EPERM') && fs.existsSync(destinationPath)) {
      console.warn(
        `[sync-bonjour-runtime] keeping existing ${path.basename(destinationPath)} because the destination is busy`,
      );
      return 'reused';
    }
    throw error;
  }

  fs.utimesSync(destinationPath, sourceStat.atime, sourceStat.mtime);
  return 'copied';
}

const sourcePath = candidatePaths().find((candidate) => fs.existsSync(candidate));
if (!sourcePath) {
  console.warn(
    '[sync-bonjour-runtime] dns-sd.exe not found; continuing without bundled Bonjour runtime.\n' +
      '  Optional local staging requires LYNAVO_BONJOUR_DIR, LYNAVO_DNSSD_PATH,\n' +
      '  or apps/desktop/resources-vendor/bonjour/. Default OSS packages rely on\n' +
      '  user-installed Bonjour or the zeroconf-compatible fallback.',
  );
  process.exit(0);
}

const sourceDir = path.dirname(sourcePath);
const copiedDNS = copyIfPresent(sourcePath, path.join(resourcesDir, dnsSDFileName));
const copiedDLL = copyIfPresent(
  path.join(sourceDir, dnsSDDLLName),
  path.join(resourcesDir, dnsSDDLLName),
);

if (copiedDNS === 'copied') {
  console.log(`[sync-bonjour-runtime] staged ${dnsSDFileName} from ${sourcePath}`);
} else if (copiedDNS === 'reused') {
  console.log(`[sync-bonjour-runtime] reusing existing ${dnsSDFileName}`);
}
if (copiedDLL === 'copied') {
  console.log(`[sync-bonjour-runtime] staged ${dnsSDDLLName} from ${sourceDir}`);
} else if (copiedDLL === 'reused') {
  console.log(`[sync-bonjour-runtime] reusing existing ${dnsSDDLLName}`);
}
