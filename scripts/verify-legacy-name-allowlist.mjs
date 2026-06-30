#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { relative, resolve, sep } from 'node:path';
import process from 'node:process';

const LEGACY_PATTERN = 'Vivi Drop|ViviDrop|vividrop|SyncFlow|syncflow|SYNCFLOW|VIVIDROP|@syncflow';
const MAX_REPORTED_UNALLOWLISTED_HITS = 200;

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

function allowTerms(terms, reason) {
  return { terms: new Set(terms), reason };
}

const HISTORICAL_SUPERPOWERS_DOC_REASON =
  'Temporary historical-doc exception for pre-rename implementation plans and specs; keep exact so new rename work is still reported.';

const HISTORICAL_SUPERPOWERS_DOC_PATHS = [
  'docs/superpowers/plans/2026-04-17-apple-iap.md',
  'docs/superpowers/plans/2026-04-17-mobile-i18n.md',
  'docs/superpowers/plans/2026-04-20-album-preview-and-select-redesign.md',
  'docs/superpowers/plans/2026-04-23-multi-device-upload-scheduler.md',
  'docs/superpowers/plans/2026-04-23-switch-device.md',
  'docs/superpowers/plans/2026-04-28-mobile-onboarding-guide.md',
  'docs/superpowers/plans/2026-04-29-market-branching-plan.md',
  'docs/superpowers/plans/2026-05-25-p2p-tunnel-shared-download.md',
  'docs/superpowers/plans/2026-05-26-android-cn-review-apk-plan.md',
  'docs/superpowers/plans/2026-05-26-device-pairing-version-compatibility-alert.md',
  'docs/superpowers/plans/2026-06-03-team-personal-directories.md',
  'docs/superpowers/plans/2026-06-09-sleep-wake-optimization.md',
  'docs/superpowers/plans/2026-06-09-wake-bound-desktop.md',
  'docs/superpowers/plans/2026-06-10-connection-device-management.md',
  'docs/superpowers/plans/2026-06-15-vividrop-desktop-local-product-expansion.md',
  'docs/superpowers/plans/2026-06-16-global-connection-feature-guide-plan.md',
  'docs/superpowers/plans/2026-06-16-global-real-business-integration-plan.md',
  'docs/superpowers/plans/2026-06-17-global-remote-access-personal-root.md',
  'docs/superpowers/plans/2026-06-22-linux-desktop-release.md',
  'docs/superpowers/plans/2026-06-22-received-library-deleted-status.md',
  'docs/superpowers/plans/2026-06-22-video-thumbnails.md',
  'docs/superpowers/plans/2026-06-23-desktop-received-library-pairing-access.md',
  'docs/superpowers/plans/2026-06-24-mobile-pairing-invalidation.md',
  'docs/superpowers/specs/2026-04-17-apple-iap-design.md',
  'docs/superpowers/specs/2026-04-17-mobile-i18n-design.md',
  'docs/superpowers/specs/2026-04-18-account-identity-reset-design.md',
  'docs/superpowers/specs/2026-04-20-album-preview-and-select-redesign-design.md',
  'docs/superpowers/specs/2026-04-23-switch-device-design.md',
  'docs/superpowers/specs/2026-05-22-rename-app-run-ios-design.md',
  'docs/superpowers/specs/2026-05-26-android-cn-review-apk-design.md',
  'docs/superpowers/specs/2026-05-26-device-pairing-version-compatibility-alert-design.md',
  'docs/superpowers/specs/2026-05-26-global-country-code-picker-design.md',
  'docs/superpowers/specs/2026-06-03-team-personal-directories-design.md',
  'docs/superpowers/specs/2026-06-09-public-wake-design.md',
  'docs/superpowers/specs/2026-06-10-connection-device-management-design.md',
  'docs/superpowers/specs/2026-06-15-vividrop-desktop-local-product-expansion-design.md',
  'docs/superpowers/specs/2026-06-15-vividrop-mobile-ui-v0-alignment-design.md',
  'docs/superpowers/specs/2026-06-16-global-connection-feature-guide-design.md',
  'docs/superpowers/specs/2026-06-17-global-remote-access-personal-root-design.md',
  'docs/superpowers/specs/2026-06-22-linux-desktop-release-design.md',
  'docs/superpowers/specs/2026-06-22-video-thumbnails-design.md',
];

const ALLOWED_EXACT_PATHS = new Map([
  [
    'docs/product/lynavo-drive-global-only-oss-commercial-plan.md',
    allowAny('Product rename source plan; legacy names are quoted for migration scope.'),
  ],
  [
    'docs/rename/legacy-name-allowlist.md',
    allowAny('This allowlist document necessarily names legacy forms.'),
  ],
  [
    'scripts/verify-legacy-name-allowlist.mjs',
    allowAny('The verifier owns the legacy-name pattern and compatibility allowlist.'),
  ],
  [
    'scripts/release/__tests__/legacy-name-allowlist.test.mjs',
    allowAny('Regression test fixture for unallowlisted legacy-name detection.'),
  ],
  [
    'services/sidecar-go/go.mod',
    allowTerms(['syncflow'], 'Go module path before sidecar module rename.'),
  ],
  [
    'services/sidecar-go/go.sum',
    allowTerms(['syncflow'], 'Go module path checksums before sidecar module rename.'),
  ],
  [
    'services/sidecar-go/Makefile',
    allowTerms(['syncflow'], 'Sidecar binary and Go module path before sidecar rename.'),
  ],
  [
    'packages/contracts/src/protocol.ts',
    allowTerms(['syncflow'], 'Protocol service type remains _syncflow._tcp for LAN compatibility.'),
  ],
  [
    'packages/contracts/src/service-endpoints.ts',
    allowTerms(
      ['syncflow'],
      'Protocol service type and sidecar health service compatibility constants.',
    ),
  ],
  [
    'services/sidecar-go/internal/mdns/broadcast.go',
    allowTerms(['syncflow'], 'Protocol service type remains _syncflow._tcp for LAN compatibility.'),
  ],
  [
    'services/sidecar-go/internal/mdns/broadcast_test.go',
    allowTerms(['syncflow'], 'Protocol service type compatibility test coverage.'),
  ],
  [
    'services/sidecar-go/internal/api/handlers_health.go',
    allowTerms(
      ['syncflow'],
      'Sidecar health service name remains syncflow-sidecar for compatibility.',
    ),
  ],
  [
    'services/sidecar-go/internal/api/router_test.go',
    allowTerms(['syncflow'], 'Sidecar health service compatibility test coverage.'),
  ],
  [
    'apps/mobile/ios/SyncFlowMobile/AuthKeychainCleaner.swift',
    allowAny('Keychain migration strings preserve access to existing credentials.'),
  ],
  [
    'apps/mobile/ios/SyncFlowMobile/AppleAuthModule.swift',
    allowAny('Keychain migration strings and build settings preserve existing installs.'),
  ],
  [
    'apps/mobile/src/utils/clearUserScopedStorage.ts',
    allowAny('Shared-preference and storage migration strings preserve existing installs.'),
  ],
  [
    'apps/mobile/src/utils/__tests__/clearUserScopedStorage.test.ts',
    allowAny('Shared-preference migration test coverage.'),
  ],
  [
    'services/sidecar-go/internal/config/config.go',
    allowAny('Old data-dir migration paths preserve existing desktop installs.'),
  ],
  [
    'services/sidecar-go/internal/config/config_test.go',
    allowAny('Old data-dir migration test coverage.'),
  ],
  [
    'services/sidecar-go/cmd/syncflow-sidecar/main.go',
    allowAny('Sidecar binary, Go module path, and old data-dir migration compatibility.'),
  ],
  [
    'services/sidecar-go/cmd/syncflow-sidecar/main_test.go',
    allowAny('Sidecar compatibility and old data-dir migration test coverage.'),
  ],
]);

for (const path of HISTORICAL_SUPERPOWERS_DOC_PATHS) {
  ALLOWED_EXACT_PATHS.set(path, allowAny(HISTORICAL_SUPERPOWERS_DOC_REASON));
}

function usage() {
  return [
    'Usage: node scripts/verify-legacy-name-allowlist.mjs [--root <path>] [--advisory]',
    '',
    'Scans for legacy Vivi Drop / SyncFlow names and reports hits outside the allowlist.',
    'By default, unallowlisted hits exit 1 for CI blocking. Use --advisory to report and exit 0.',
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

function allowReason(match) {
  const exactRule = ALLOWED_EXACT_PATHS.get(match.path);
  if (exactRule && (!exactRule.terms || exactRule.terms.has(match.term))) {
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
    LEGACY_PATTERN,
    '.',
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
  console.log(`Legacy name scan pattern: ${LEGACY_PATTERN}`);
  console.log(`Allowed legacy name hits: ${allowed.length}`);
  console.log(`Unallowlisted legacy name hits: ${unallowlisted.length}`);

  if (unallowlisted.length > 0) {
    console.log('');
    console.log(advisory ? 'Unallowlisted hits (advisory):' : 'Unallowlisted hits:');
    for (const hit of unallowlisted.slice(0, MAX_REPORTED_UNALLOWLISTED_HITS)) {
      console.log(`- ${hit.path}:${hit.line} ${hit.term} :: ${hit.lineText}`);
    }
    const remaining = unallowlisted.length - MAX_REPORTED_UNALLOWLISTED_HITS;
    if (remaining > 0) {
      console.log(`... ${remaining} more unallowlisted hits omitted from advisory output.`);
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

  const result = runRipgrep(options.root);
  if (result.error) {
    console.error(`Failed to run rg: ${result.error.message}`);
    process.exitCode = 2;
    return;
  }
  if (result.status !== 0 && result.status !== 1) {
    console.error(result.stderr);
    process.exitCode = result.status ?? 2;
    return;
  }

  const matches = collectMatches(options.root, result.stdout);
  const summary = summarize(matches);
  printResults(summary, { advisory: options.advisory });
  if (!options.advisory && summary.unallowlisted.length > 0) {
    process.exitCode = 1;
  }
}

main();
