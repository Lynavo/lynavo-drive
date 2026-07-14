#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, extname, resolve, sep } from 'node:path';
import process from 'node:process';

const MAX_REPORTED_DISALLOWED_FILES = 200;

const ALLOWED_EXACT_PATHS = new Map([
  [
    'apps/mobile/android/gradle/wrapper/gradle-wrapper.jar',
    'Gradle wrapper bootstrap jar is a source-build dependency, not a release artifact.',
  ],
  [
    'apps/mobile/scripts/resources/mobile-i18n.xlsx',
    'First-party translation source workbook used by the local i18n import tool.',
  ],
]);

const FILESYSTEM_WALK_IGNORED_DIRS = new Set(['.git', 'node_modules']);

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
  '.aar',
  '.apk',
  '.app',
  '.dmg',
  '.dll',
  '.docx',
  '.dylib',
  '.exe',
  '.gz',
  '.ipa',
  '.jar',
  '.node',
  '.pkg',
  '.so',
  '.tar',
  '.tgz',
  '.wasm',
  '.xls',
  '.xlsm',
  '.xlsx',
  '.xcarchive',
  '.zip',
  '.zst',
]);

const DATA_ARTIFACT_EXTENSIONS = new Set(['.db', '.log', '.sqlite', '.sqlite3', '.tsbuildinfo']);

const SIGNING_AND_SECRET_EXTENSIONS = new Set([
  '.cer',
  '.crt',
  '.jks',
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

const TEXT_SOURCE_AND_CONFIG_EXTENSIONS = new Set([
  '.bat',
  '.c',
  '.cc',
  '.cfg',
  '.cjs',
  '.cmd',
  '.conf',
  '.cpp',
  '.css',
  '.env',
  '.gradle',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.json5',
  '.jsx',
  '.kt',
  '.kts',
  '.lock',
  '.m',
  '.mjs',
  '.mm',
  '.mod',
  '.nsh',
  '.pbxproj',
  '.plist',
  '.pro',
  '.properties',
  '.ps1',
  '.py',
  '.rb',
  '.rs',
  '.sh',
  '.sql',
  '.storyboard',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xcconfig',
  '.xcprivacy',
  '.xcscheme',
  '.xcworkspacedata',
  '.xml',
  '.yaml',
  '.yml',
]);

const TEXT_SOURCE_AND_CONFIG_FILENAMES = new Set([
  'config',
  'gemfile',
  'gradlew',
  'makefile',
  'podfile',
]);

const KNOWN_MAINLAND_MODULE_FILENAMES = new Set([
  'mainland-payment-service.ts',
  'mainlandpaymentprimitives.kt',
  'nativemainlandpaymentmodule.kt',
  'nativemainlandpaymentpackage.kt',
  'nativemarketconfigmodule.kt',
  'nativemarketconfigpackage.kt',
  'wechatpay.ts',
  'wxpayentryactivity.kt',
]);

const NPMRC_DISALLOWED_PATTERN =
  /(^|\n)\s*(?:registry|.*_auth.*|.*token.*|.*proxy.*|cafile|certfile|keyfile|.*_MIRROR)\s*=/iu;
const CN_RELEASE_SETTING_PATTERN =
  /(?:^|[^a-z0-9_])(?:[a-z][a-z0-9]*_)*(?:release[_-]?profile|profile|market|region|channel|variant|flavor)\b["']?\s*[:=]\s*(?:["']cn["']|cn(?=\s*(?:[,;}\]\r\n#]|$)))/iu;
const CN_ANDROID_GRADLE_PATTERN =
  /(?:\bproductFlavors\s*(?:\{[\s\S]*?(?:\bcn\s*\{|\b(?:create|register|maybeCreate)\s*\(\s*["']cn["']\s*\))|\.\s*(?:create|register|maybeCreate)\s*\(\s*["']cn["']\s*\))|\bcnImplementation\b|["']com\.alipay\.sdk:alipaysdk-android:|["']com\.tencent\.mm\.opensdk:wechat-sdk-android:)/u;
const CN_ANDROID_SOURCE_SET_SEGMENT_PATTERN = /(?:^cn(?=$|[A-Z0-9_-])|Cn(?=$|[A-Z0-9_-]))/u;
const CN_RUNTIME_ENDPOINT_PATTERN =
  /https?:\/\/(?:api|global-api|review-api)\.vividrop\.cn(?=[:/?#"'`\s]|$)/iu;
const RETIRED_MOBILE_GLOBAL_IDENTIFIER_PATTERN =
  /\b(?:Global(?:Home|Files|Settings)Tab|GlobalLocalComputer[A-Za-z0-9_]*|(?:list|download|get|prepare|share)GlobalLocalComputer[A-Za-z0-9_]*|(?:is|shouldRender)Global(?:Preview|Empty)|downloadResourceForGlobal|formatGlobalHistoryDuration|globalPreview|TOUR_BACKGROUND_IMAGES_GLOBAL|global(?:Sync[A-Z][A-Za-z0-9_]*|Media[A-Z][A-Za-z0-9_]*|Home|RecentDownloadSection|Section(?:Empty(?:Icon|Message|State|Title)|TitleText)|Photo(?:HillLeft|HillRight|Icon|Sun)|Video(?:Dot(?:Faint|RowBottom|RowTop)?|Icon)|File(?:Corner|Icon)|PlayCircle))\b/u;
const RETIRED_GLOBAL_TRANSLATION_KEY_PATTERN =
  /\b(?:(?:deviceDiscovery|settings)\.global\.|directory\.pathCard\.globalPersonalDirectory\b)/u;

function usage() {
  return [
    'Usage: node scripts/verify-oss-source-package.mjs [--root <path>] [--manifest <file>] [--git-ref <ref>] [--include-untracked] [--advisory]',
    '',
    'Audits the source-package file list for generated artifacts, signing material, private tooling, CN market residue, and local runtime data.',
    'By default it uses `git ls-files -z` under --root, with a filesystem fallback for extracted archives without .git.',
    'Use --include-untracked to also audit non-ignored untracked worktree files before a local release.',
    'Use --git-ref to audit a committed Git tree such as HEAD before a source archive rehearsal.',
    'Use --manifest for a newline- or NUL-separated source-package manifest.',
  ].join('\n');
}

function parseArgs(argv) {
  let root = process.cwd();
  let manifest = null;
  let gitRef = null;
  let advisory = false;
  let includeUntracked = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      return { help: true, root, manifest, gitRef, advisory, includeUntracked };
    }
    if (arg === '--advisory') {
      advisory = true;
      continue;
    }
    if (arg === '--include-untracked') {
      includeUntracked = true;
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
    if (arg === '--git-ref') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('--git-ref requires a ref');
      }
      gitRef = next;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (manifest && gitRef) {
    throw new Error('--manifest and --git-ref cannot be used together');
  }
  if (gitRef && includeUntracked) {
    throw new Error('--git-ref and --include-untracked cannot be used together');
  }

  return {
    help: false,
    root: resolve(root),
    manifest: manifest ? resolve(root, manifest) : null,
    gitRef,
    advisory,
    includeUntracked,
  };
}

function normalizePath(path) {
  const normalized = path.split(sep).join('/').replaceAll('\\', '/');
  return normalized.startsWith('./') ? normalized.slice(2) : normalized;
}

function collectGitFiles(root, { includeUntracked }) {
  const args = includeUntracked
    ? ['ls-files', '-z', '--cached', '--others', '--deleted', '--exclude-standard']
    : ['ls-files', '-z'];
  const result = spawnSync('git', args, {
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
    .filter((path) => path && (includeUntracked || existsSync(resolve(root, path))));
}

function collectGitRefFiles(root, gitRef) {
  const result = spawnSync('git', ['ls-tree', '-r', '-z', '--name-only', gitRef], {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: 1024 * 1024 * 64,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.toString('utf8').trim() || 'git ls-tree failed');
  }

  return result.stdout
    .toString('utf8')
    .split('\0')
    .map((path) => normalizePath(path.trim()))
    .filter(Boolean);
}

function isGitTopLevel(root) {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: root,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    return false;
  }

  return realpathSync(result.stdout.trim()) === realpathSync(root);
}

function collectFilesystemFiles(root) {
  const files = [];

  function walk(relativeDir) {
    const absoluteDir = resolve(root, relativeDir);
    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      if (entry.name === '.' || entry.name === '..') {
        continue;
      }
      if (entry.isDirectory() && FILESYSTEM_WALK_IGNORED_DIRS.has(entry.name)) {
        continue;
      }

      const relativePath = normalizePath(relativeDir ? `${relativeDir}/${entry.name}` : entry.name);
      const absolutePath = resolve(root, relativePath);

      if (entry.isDirectory()) {
        walk(relativePath);
        continue;
      }
      if (entry.isFile()) {
        files.push(relativePath);
        continue;
      }
      if (entry.isSymbolicLink() && existsSync(absolutePath)) {
        files.push(relativePath);
      }
    }
  }

  walk('');
  return files;
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

function isDocumentationPath(path) {
  const segments = path.toLowerCase().split('/');
  return segments[0] === 'docs';
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

function cnMarketPathDisallowReason(path) {
  const lowerPath = path.toLowerCase();
  const name = basename(lowerPath);
  const androidSourceSetMatch = /^apps\/mobile\/android\/.*\/src\/([^/]+)(?:\/|$)/u.exec(path);

  if (
    androidSourceSetMatch &&
    CN_ANDROID_SOURCE_SET_SEGMENT_PATTERN.test(androidSourceSetMatch[1])
  ) {
    return 'Android CN market source set';
  }
  if (lowerPath.split('/').some((segment) => segment.endsWith('cn.xcscheme'))) {
    return 'CN-specific Xcode scheme';
  }
  if (/^apps\/desktop\/electron-builder\.cn\.ya?ml$/u.test(lowerPath)) {
    return 'CN-specific Electron builder configuration';
  }
  if (name === 'lynavodriveglobal.xcscheme') {
    return 'retired global-market Xcode scheme';
  }
  if (lowerPath === 'apps/mobile/src/theme/globalcolors.ts') {
    return 'retired mobile market-specific color palette';
  }
  if (lowerPath.startsWith('apps/mobile/src/assets/onboarding/global/')) {
    return 'retired mobile market-specific onboarding asset';
  }
  if (lowerPath.startsWith('apps/mobile/src/markets/cn/')) {
    return 'CN market source module';
  }
  if (lowerPath.includes('/china/payments/') || lowerPath.includes('/china/market/')) {
    return 'mainland payment or market module';
  }
  if (KNOWN_MAINLAND_MODULE_FILENAMES.has(name)) {
    return 'known mainland payment or market module';
  }

  return null;
}

function readFilesystemContent(root, path) {
  const absolutePath = resolve(root, path);
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : null;
}

function readGitRefContent(root, gitRef, path) {
  const result = spawnSync('git', ['show', `${gitRef}:${path}`], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git show failed for ${gitRef}:${path}`);
  }

  return result.stdout;
}

function contentDisallowReason(path, readContent) {
  const name = basename(path);
  const isNpmrc = name === '.npmrc';
  const isScannableText =
    TEXT_SOURCE_AND_CONFIG_EXTENSIONS.has(extname(path).toLowerCase()) ||
    TEXT_SOURCE_AND_CONFIG_FILENAMES.has(name.toLowerCase());
  if (!isNpmrc && !isScannableText) {
    return null;
  }

  const content = readContent(path);
  if (content === null) {
    return null;
  }

  if (isNpmrc && NPMRC_DISALLOWED_PATTERN.test(content)) {
    return '.npmrc contains registry, mirror, proxy, certificate, or auth configuration';
  }
  if (!hasSegment(path, 'zh-Hans') && CN_RELEASE_SETTING_PATTERN.test(content)) {
    return 'release market selector is set to cn';
  }
  if (
    path.startsWith('apps/mobile/android/') &&
    /\.gradle(?:\.kts)?$/u.test(path) &&
    CN_ANDROID_GRADLE_PATTERN.test(content)
  ) {
    return 'Android CN product flavor or mainland payment dependency';
  }
  if (!isDocumentationPath(path) && CN_RUNTIME_ENDPOINT_PATTERN.test(content)) {
    return 'China-only runtime service endpoint';
  }
  if (
    path.startsWith('apps/mobile/') &&
    !path.includes('/i18n/') &&
    RETIRED_MOBILE_GLOBAL_IDENTIFIER_PATTERN.test(content)
  ) {
    return 'retired mobile global-market variant naming';
  }
  if (
    (path.startsWith('apps/mobile/') || path.startsWith('apps/desktop/')) &&
    !path.includes('/i18n/') &&
    RETIRED_GLOBAL_TRANSLATION_KEY_PATTERN.test(content)
  ) {
    return 'retired global-market translation key naming';
  }

  return null;
}

function disallowReason(path, readContent) {
  const contentReason = contentDisallowReason(path, readContent);
  if (contentReason) {
    return contentReason;
  }

  const cnMarketPathReason = cnMarketPathDisallowReason(path);
  if (cnMarketPathReason) {
    return cnMarketPathReason;
  }

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

  const name = basename(path);
  if (name === '.env' || name.startsWith('.env.')) {
    return 'environment file';
  }
  if (name.startsWith('AuthKey_')) {
    return 'platform API key file';
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

function summarize(paths, readContent) {
  const uniquePaths = [...new Set(paths)].sort((left, right) => left.localeCompare(right));
  const allowed = [];
  const disallowed = [];

  for (const path of uniquePaths) {
    const allowedReason = ALLOWED_EXACT_PATHS.get(path);
    if (allowedReason) {
      allowed.push({ path, reason: allowedReason });
      continue;
    }

    const reason = disallowReason(path, readContent);
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

function collectInputFiles(options) {
  const readWorktreeContent = (path) => readFilesystemContent(options.root, path);

  if (options.manifest) {
    return {
      inputKind: 'manifest',
      paths: collectManifestFiles(options.manifest),
      readContent: readWorktreeContent,
    };
  }

  if (options.gitRef) {
    if (!isGitTopLevel(options.root)) {
      return {
        inputKind: `filesystem walk (no git metadata for ${options.gitRef})`,
        paths: collectFilesystemFiles(options.root),
        readContent: readWorktreeContent,
      };
    }

    return {
      inputKind: `git tree ${options.gitRef}`,
      paths: collectGitRefFiles(options.root, options.gitRef),
      readContent: (path) => readGitRefContent(options.root, options.gitRef, path),
    };
  }

  if (!isGitTopLevel(options.root)) {
    return {
      inputKind: 'filesystem walk',
      paths: collectFilesystemFiles(options.root),
      readContent: readWorktreeContent,
    };
  }

  try {
    return {
      inputKind: 'git ls-files',
      paths: collectGitFiles(options.root, {
        includeUntracked: options.includeUntracked,
      }),
      readContent: readWorktreeContent,
    };
  } catch {
    return {
      inputKind: 'filesystem walk',
      paths: collectFilesystemFiles(options.root),
      readContent: readWorktreeContent,
    };
  }
}

function printResults(summary, { advisory, inputKind }) {
  console.log(`OSS source package input: ${inputKind}`);
  console.log(`Audited OSS source package files: ${summary.trackedCount}`);
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

  let input;
  try {
    input = collectInputFiles(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }

  const summary = summarize(input.paths, input.readContent);
  printResults(summary, { ...options, inputKind: input.inputKind });

  if (summary.disallowed.length > 0 && !options.advisory) {
    process.exitCode = 1;
  }
}

main();
