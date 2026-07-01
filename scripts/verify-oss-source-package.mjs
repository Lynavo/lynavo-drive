#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, extname, resolve, sep } from 'node:path';
import process from 'node:process';

const MAX_REPORTED_DISALLOWED_FILES = 200;

const ALLOWED_EXACT_PATHS = new Map([
  [
    'apps/desktop/resources/dns-sd.exe',
    'Exact Bonjour redistributable exception for Windows local mDNS support.',
  ],
  [
    'apps/desktop/resources/dnssd.dll',
    'Exact Bonjour redistributable exception for Windows local mDNS support.',
  ],
  [
    'apps/mobile/android/gradle/wrapper/gradle-wrapper.jar',
    'Gradle wrapper bootstrap jar is a source-build dependency, not a release artifact.',
  ],
]);

const PRIVATE_TOOLING_DIRS = new Set([
  '.agent',
  '.antigravitycli',
  '.claude',
  '.gemini',
  '.superpowers',
  '.vscode',
]);

const GENERATED_DIRS = new Set([
  '.cxx',
  '.gradle',
  '.next',
  '.parcel-cache',
  '.turbo',
  'DerivedData',
  'Pods',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
]);

const PACKAGE_ARTIFACT_EXTENSIONS = new Set([
  '.aab',
  '.apk',
  '.app',
  '.dmg',
  '.dll',
  '.docx',
  '.exe',
  '.gz',
  '.ipa',
  '.jar',
  '.pkg',
  '.tar',
  '.tgz',
  '.xcarchive',
  '.zip',
  '.zst',
]);

const DATA_ARTIFACT_EXTENSIONS = new Set(['.db', '.log', '.sqlite', '.sqlite3', '.tsbuildinfo']);

const SIGNING_AND_SECRET_EXTENSIONS = new Set([
  '.cer',
  '.crt',
  '.key',
  '.keystore',
  '.mobileprovision',
  '.p12',
  '.p8',
  '.pem',
  '.provisionprofile',
]);

const SENSITIVE_FILENAMES = new Set(['GoogleService-Info.plist', 'google-services.json']);

const GENERATED_SIDECAR_RESOURCE_PATHS = new Set([
  'apps/desktop/resources/lynavo-drive-sidecar',
  'apps/desktop/resources/lynavo-drive-sidecar.exe',
]);

function usage() {
  return [
    'Usage: node scripts/verify-oss-source-package.mjs [--root <path>] [--manifest <file>] [--advisory]',
    '',
    'Audits the tracked source-package file list for generated artifacts, signing material, private tooling, and legacy runtime paths.',
    'By default it uses `git ls-files -z` under --root. Use --manifest for a newline- or NUL-separated source-package manifest.',
  ].join('\n');
}

function parseArgs(argv) {
  let root = process.cwd();
  let manifest = null;
  let advisory = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      return { help: true, root, manifest, advisory };
    }
    if (arg === '--advisory') {
      advisory = true;
      continue;
    }
    if (arg === '--root') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('--root requires a path');
      }
      root = next;
      index += 1;
      continue;
    }
    if (arg === '--manifest') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('--manifest requires a path');
      }
      manifest = next;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    help: false,
    root: resolve(root),
    manifest: manifest ? resolve(root, manifest) : null,
    advisory,
  };
}

function normalizePath(path) {
  const normalized = path.split(sep).join('/').replaceAll('\\', '/');
  return normalized.startsWith('./') ? normalized.slice(2) : normalized;
}

function collectGitTrackedFiles(root) {
  const result = spawnSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: 1024 * 1024 * 64,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.toString('utf8').trim() || 'git ls-files failed');
  }

  return result.stdout
    .toString('utf8')
    .split('\0')
    .map((path) => normalizePath(path.trim()))
    .filter(Boolean);
}

function collectManifestFiles(manifestPath) {
  const raw = readFileSync(manifestPath, 'utf8');
  const separator = raw.includes('\0') ? '\0' : '\n';
  return raw
    .split(separator)
    .map((path) => normalizePath(path.trim()))
    .filter(Boolean);
}

function hasSegment(path, segment) {
  return path.split('/').includes(segment);
}

function firstMatchingSegment(path, segments) {
  return path.split('/').find((segment) => segments.has(segment)) ?? null;
}

function isReleaseOutputPath(path) {
  const segments = path.split('/');
  return (
    ['apps', 'packages', 'services'].includes(segments[0]) && segments.slice(1).includes('release')
  );
}

function hasLegacyProductPath(path) {
  if (path.startsWith('docs/superpowers/')) {
    return false;
  }
  return /(^|[/._-])(?:SyncFlow|syncflow|ViviDrop|vividrop|Vivi Drop|@syncflow)(?=$|[/._-])/u.test(
    path,
  );
}

function disallowReason(path) {
  if (GENERATED_SIDECAR_RESOURCE_PATHS.has(path)) {
    return 'generated sidecar binary must be built locally, not committed to the source package';
  }

  const privateToolingDir = firstMatchingSegment(path, PRIVATE_TOOLING_DIRS);
  if (privateToolingDir) {
    return `private tooling directory (${privateToolingDir})`;
  }

  const generatedDir = firstMatchingSegment(path, GENERATED_DIRS);
  if (generatedDir) {
    return `generated or cache directory (${generatedDir})`;
  }

  if (hasSegment(path, 'vendor') && hasSegment(path, 'bundle')) {
    return 'generated or cache directory (vendor/bundle)';
  }

  if (isReleaseOutputPath(path)) {
    return 'release output directory';
  }

  if (hasLegacyProductPath(path)) {
    return 'legacy product name in path';
  }

  const name = basename(path);
  if (name === '.env' || name.startsWith('.env.')) {
    return 'environment file';
  }
  if (name.startsWith('AuthKey_')) {
    return 'App Store Connect API key file';
  }
  if (SENSITIVE_FILENAMES.has(name)) {
    return 'platform service credential file';
  }

  const ext = extname(path);
  if (SIGNING_AND_SECRET_EXTENSIONS.has(ext)) {
    return `signing or secret material (${ext})`;
  }
  if (PACKAGE_ARTIFACT_EXTENSIONS.has(ext)) {
    return `package or binary artifact (${ext})`;
  }
  if (DATA_ARTIFACT_EXTENSIONS.has(ext)) {
    return `generated data or log artifact (${ext})`;
  }

  return null;
}

function summarize(paths) {
  const uniquePaths = [...new Set(paths)].sort((left, right) => left.localeCompare(right));
  const allowed = [];
  const disallowed = [];

  for (const path of uniquePaths) {
    const allowedReason = ALLOWED_EXACT_PATHS.get(path);
    if (allowedReason) {
      allowed.push({ path, reason: allowedReason });
      continue;
    }

    const reason = disallowReason(path);
    if (reason) {
      disallowed.push({ path, reason });
    }
  }

  return {
    trackedCount: uniquePaths.length,
    allowed,
    disallowed,
  };
}

function printResults(summary, { advisory, manifest }) {
  console.log(`OSS source package input: ${manifest ? 'manifest' : 'git ls-files'}`);
  console.log(`Tracked OSS source package files: ${summary.trackedCount}`);
  console.log(`Allowed OSS source package exceptions: ${summary.allowed.length}`);
  console.log(`Disallowed OSS source package files: ${summary.disallowed.length}`);

  if (summary.disallowed.length > 0) {
    console.log('');
    console.log(advisory ? 'Disallowed files (advisory):' : 'Disallowed files:');
    for (const hit of summary.disallowed.slice(0, MAX_REPORTED_DISALLOWED_FILES)) {
      console.log(`- ${hit.path} :: ${hit.reason}`);
    }
    const remaining = summary.disallowed.length - MAX_REPORTED_DISALLOWED_FILES;
    if (remaining > 0) {
      console.log(`... ${remaining} more disallowed files omitted.`);
    }
  }
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    console.log(usage());
    return;
  }

  let paths;
  try {
    paths = options.manifest
      ? collectManifestFiles(options.manifest)
      : collectGitTrackedFiles(options.root);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }

  const summary = summarize(paths);
  printResults(summary, options);

  if (summary.disallowed.length > 0 && !options.advisory) {
    process.exitCode = 1;
  }
}

main();
