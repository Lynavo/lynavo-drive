#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { relative, resolve, sep } from 'node:path';
import process from 'node:process';

const MAX_REPORTED_UNALLOWLISTED_HITS = 200;

const OSS_BOUNDARY_TERMS = [
  'RemoteAccess',
  'remoteAccess',
  'remote-access',
  'Remote Access',
  'remote access',
  'GlobalRemoteAccess',
  'REMOTE_ACCESS',
  'RemoteResourcesPreview',
  'remoteResources',
  'RemoteResource',
  'remote-resource',
  'remote-toolbar',
  'canUseRemoteTunnel',
  'remoteTunnel',
  'remote tunnel',
  'tunnel credentials',
  'tunnel credential',
  'subscription',
  'entitlement',
  'entitlements',
  'billing',
  'paywall',
  'GoogleSignIn',
  'GoogleSignin',
  '@react-native-google-signin',
  'GoogleService-Info.plist',
  'googleusercontent',
  'AppleAuth',
  'AppleAuthModule',
  'supportsAppleAuth',
  'LYNAVO_APPLE_REDIRECT_URI',
  'appleRedirectUri',
  'loginWith',
  '/auth/',
  'OAuth',
  'AUTH_BASE',
  'LYNAVO_AUTH_BASE_URL',
  'SYNC' + 'FLOW_AUTH_BASE_URL',
];

const OSS_BOUNDARY_PATTERN = OSS_BOUNDARY_TERMS.map(escapeRegExp).join('|');

const OSS_BOUNDARY_PATH_TERMS = [
  'RemoteAccess',
  'remoteAccess',
  'remote-access',
  'GoogleSignIn',
  'GoogleSignin',
  'GoogleService-Info.plist',
  'AppleAuthModule',
  'subscription',
  'paywall',
  'billing',
  'tunnel',
];

const DEFAULT_SCAN_TARGETS = [
  'apps',
  'packages',
  'services',
  'scripts',
  'package.json',
  'pnpm-workspace.yaml',
  'turbo.json',
];

const IGNORE_GLOBS = [
  '!node_modules/**',
  '!**/node_modules/**',
  '!.git/**',
  '!**/.git/**',
  '!.turbo/**',
  '!**/.turbo/**',
  '!dist/**',
  '!**/dist/**',
  '!build/**',
  '!**/build/**',
  '!out/**',
  '!**/out/**',
  '!release/**',
  '!**/release/**',
  '!coverage/**',
  '!**/coverage/**',
  '!DerivedData/**',
  '!**/DerivedData/**',
  '!**/.cxx/**',
  '!**/Pods/**',
  '!**/vendor/bundle/**',
];

function allowAny(reason) {
  return { reason };
}

function allowMatches(matchers, reason) {
  return {
    matchers: matchers.map((matcher) => ({
      terms: new Set(matcher.terms),
      linePattern: matcher.linePattern,
    })),
    reason,
  };
}

const APPLE_SIGNING_ENTITLEMENTS_REASON =
  'Apple code-signing entitlements are platform signing metadata, not commercial feature entitlements.';

const NEGATIVE_ASSERTION_REASON =
  'Regression test or scrubber names commercial/account inputs to prove the OSS runtime does not expose them.';

const ALLOWED_EXACT_PATHS = new Map([
  [
    'scripts/verify-oss-boundary.mjs',
    allowAny('The verifier owns the OSS boundary patterns and allowlist.'),
  ],
  [
    'scripts/verify-legacy-name-allowlist.mjs',
    allowAny('Legacy-name verifier quotes historical docs paths and compatibility module names.'),
  ],
  ['scripts/dev/oss-env-scrubber.cjs', allowAny(NEGATIVE_ASSERTION_REASON)],
  ['scripts/dev/__tests__/release-profile-dev.test.mjs', allowAny(NEGATIVE_ASSERTION_REASON)],
  [
    'apps/desktop/scripts/__tests__/run-electron-vite-config.test.mjs',
    allowAny(NEGATIVE_ASSERTION_REASON),
  ],
  ['apps/desktop/src/main/__tests__/sidecar-client.test.ts', allowAny(NEGATIVE_ASSERTION_REASON)],
  ['apps/desktop/src/preload/__tests__/index.test.ts', allowAny(NEGATIVE_ASSERTION_REASON)],
  ['apps/desktop/src/shared/__tests__/product.test.ts', allowAny(NEGATIVE_ASSERTION_REASON)],
  [
    'apps/desktop/src/renderer/features/dashboard/__tests__/Dashboard.test.tsx',
    allowAny(NEGATIVE_ASSERTION_REASON),
  ],
  [
    'apps/mobile/src/services/__tests__/SyncEngineModule.background-service.test.ts',
    allowAny(NEGATIVE_ASSERTION_REASON),
  ],
  [
    'apps/mobile/src/services/__tests__/app-config-service.test.ts',
    allowAny(NEGATIVE_ASSERTION_REASON),
  ],
  ['apps/mobile/src/config/__tests__/app-config.test.ts', allowAny(NEGATIVE_ASSERTION_REASON)],
  [
    'apps/mobile/ios/LynavoDrive.xcodeproj/project.pbxproj',
    allowAny(APPLE_SIGNING_ENTITLEMENTS_REASON),
  ],
  [
    'apps/mobile/ios/SyncEngine/SyncEngineManager.swift',
    allowMatches(
      [
        {
          terms: ['/auth/'],
          linePattern: /connection\/auth\/protocol/,
        },
      ],
      'LAN sync protocol auth wording is not commercial account auth.',
    ),
  ],
  ['apps/desktop/electron-builder.yml', allowAny(APPLE_SIGNING_ENTITLEMENTS_REASON)],
  ['apps/desktop/scripts/mac-sign.cjs', allowAny(APPLE_SIGNING_ENTITLEMENTS_REASON)],
]);

const GLOBAL_ALLOWED_LINE_MATCHERS = [
  {
    terms: new Set(['subscription']),
    reason: 'React Native event subscription handle, not commercial subscription state.',
    linePattern:
      /\b(?:const|let|var)\s+subscriptions?\b|subscriptions?\.(?:remove|push|forEach)\(|subscription\s*=\s*[^;]*(?:addListener|addEventListener)\(|addEventListener\([^)]*=>\s*\{|subscription\?\.remove\(/,
  },
  {
    terms: new Set(['entitlement', 'entitlements']),
    reason: APPLE_SIGNING_ENTITLEMENTS_REASON,
    linePattern:
      /CODE_SIGN_ENTITLEMENTS|entitlements(?:Inherit)?[:=]|entitlements\.(?:mac|mas|plist)/,
  },
];

function usage() {
  return [
    'Usage: node scripts/verify-oss-boundary.mjs [--root <path>] [--advisory]',
    '',
    'Scans code paths for commercial/account/remote-access boundary terms and reports hits outside the allowlist.',
    'Default scan targets: apps, packages, services, scripts, package.json, pnpm-workspace.yaml, turbo.json.',
  ].join('\n');
}

function parseArgs(argv) {
  let root = process.cwd();
  let advisory = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      return { help: true, root, advisory };
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
      root = resolve(next);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { help: false, root: resolve(root), advisory };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePath(path) {
  const normalized = path.split(sep).join('/');
  return normalized.startsWith('./') ? normalized.slice(2) : normalized;
}

function relativePath(scanRoot, path) {
  const normalized = normalizePath(path);
  if (!normalized.startsWith('/')) {
    return normalized;
  }
  return normalizePath(relative(scanRoot, path));
}

function existingScanTargets(scanRoot) {
  const targets = DEFAULT_SCAN_TARGETS.filter((target) => existsSync(resolve(scanRoot, target)));
  return targets.length > 0 ? targets : ['.'];
}

function globalAllowReason(match) {
  for (const matcher of GLOBAL_ALLOWED_LINE_MATCHERS) {
    if (matcher.terms.has(match.term) && matcher.linePattern.test(match.lineText)) {
      return matcher.reason;
    }
  }
  return null;
}

function ruleAllows(rule, match) {
  if (!rule.terms && !rule.matchers) {
    return true;
  }
  if (rule.terms?.has(match.term)) {
    return true;
  }
  return (
    rule.matchers?.some(
      (matcher) => matcher.terms.has(match.term) && matcher.linePattern.test(match.lineText),
    ) ?? false
  );
}

function allowReason(match) {
  const globalReason = globalAllowReason(match);
  if (globalReason) {
    return globalReason;
  }
  const exactRule = ALLOWED_EXACT_PATHS.get(match.path);
  if (exactRule && ruleAllows(exactRule, match)) {
    return exactRule.reason;
  }
  return null;
}

function runRipgrep(scanRoot) {
  const args = [
    '--json',
    '--line-number',
    '--hidden',
    '--sort',
    'path',
    '--with-filename',
    '--no-heading',
    ...IGNORE_GLOBS.flatMap((glob) => ['--glob', glob]),
    '-e',
    OSS_BOUNDARY_PATTERN,
    ...existingScanTargets(scanRoot),
  ];

  return spawnSync('rg', args, {
    cwd: scanRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  });
}

function collectMatches(scanRoot, stdout) {
  const matches = [];
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') {
      continue;
    }

    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw new Error(`Failed to parse rg JSON output: ${error.message}`);
    }

    if (event.type !== 'match') {
      continue;
    }

    const path = relativePath(scanRoot, event.data.path.text);
    const lineText = event.data.lines.text.trimEnd();
    for (const submatch of event.data.submatches) {
      matches.push({
        path,
        line: event.data.line_number,
        term: submatch.match.text,
        lineText,
      });
    }
  }
  return matches.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.term.localeCompare(right.term) ||
      left.lineText.localeCompare(right.lineText),
  );
}

function runPathList(scanRoot) {
  const args = [
    '--files',
    '--hidden',
    '--sort',
    'path',
    ...IGNORE_GLOBS.flatMap((glob) => ['--glob', glob]),
    ...existingScanTargets(scanRoot),
  ];

  return spawnSync('rg', args, {
    cwd: scanRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  });
}

function collectPathMatches(stdout) {
  const matches = [];
  for (const rawPath of stdout.split('\n')) {
    const path = rawPath.trim();
    if (path === '') {
      continue;
    }
    for (const term of OSS_BOUNDARY_PATH_TERMS) {
      if (path.includes(term)) {
        matches.push({
          path,
          line: 0,
          term,
          lineText: path,
          source: 'path',
        });
      }
    }
  }
  return matches;
}

function summarize(matches) {
  const allowed = [];
  const unallowlisted = [];

  for (const match of matches) {
    const reason = allowReason(match);
    if (reason) {
      allowed.push({ ...match, reason });
    } else {
      unallowlisted.push(match);
    }
  }

  return { allowed, unallowlisted };
}

function printResults({ allowed, unallowlisted }, { advisory }) {
  console.log(`OSS boundary scan pattern: ${OSS_BOUNDARY_PATTERN}`);
  console.log(`Allowed OSS boundary hits: ${allowed.length}`);
  console.log(`Unallowlisted OSS boundary hits: ${unallowlisted.length}`);

  if (unallowlisted.length > 0) {
    console.log('');
    console.log(advisory ? 'Unallowlisted hits (advisory):' : 'Unallowlisted hits:');
    for (const hit of unallowlisted.slice(0, MAX_REPORTED_UNALLOWLISTED_HITS)) {
      console.log(`- ${hit.path}:${hit.line} ${hit.term} :: ${hit.lineText}`);
    }
    if (unallowlisted.length > MAX_REPORTED_UNALLOWLISTED_HITS) {
      console.log(
        `... ${unallowlisted.length - MAX_REPORTED_UNALLOWLISTED_HITS} more unallowlisted hits omitted`,
      );
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
    process.exit(2);
  }

  if (options.help) {
    console.log(usage());
    return;
  }

  const result = runRipgrep(options.root);
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && result.status !== 1) {
    console.error(result.stderr);
    process.exit(result.status ?? 2);
  }

  const pathResult = runPathList(options.root);
  if (pathResult.error) {
    throw pathResult.error;
  }
  if (pathResult.status !== 0) {
    console.error(pathResult.stderr);
    process.exit(pathResult.status ?? 2);
  }

  const matches = [
    ...collectMatches(options.root, result.stdout),
    ...collectPathMatches(pathResult.stdout),
  ].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.term.localeCompare(right.term) ||
      left.lineText.localeCompare(right.lineText),
  );
  const summary = summarize(matches);
  printResults(summary, options);

  if (summary.unallowlisted.length > 0 && !options.advisory) {
    process.exit(1);
  }
}

main();
