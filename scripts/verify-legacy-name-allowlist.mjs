#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { relative, resolve, sep } from 'node:path';
import process from 'node:process';

const token = (parts) => parts.join('');
const LEGACY_TERMS = Object.freeze([
  token(['Vivi', ' Drop']),
  token(['Vivi', 'Drop']),
  token(['vivi', 'drop']),
  token(['Sync', 'Flow']),
  token(['sync', 'flow']),
  token(['SYN', 'CFLOW']),
  token(['VIVI', 'DROP']),
  token(['@', 'sync', 'flow']),
]);
const LEGACY_PATTERN = LEGACY_TERMS.join('|');
const legacyLowerFlow = token(['sync', 'flow']);
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
  '!apps/**/release/**',
  '!packages/**/release/**',
  '!services/**/release/**',
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

const ALLOWED_EXACT_PATHS = new Map([
  [
    '.gitignore',
    allowMatches(
      [
        {
          terms: [legacyLowerFlow],
          linePattern: new RegExp(
            `services/sidecar-go/${legacyLowerFlow}(?:-sidecar|\\.db(?:-(?:wal|shm))?)$`,
          ),
        },
      ],
      'Local generated legacy sidecar/db artifacts stay ignored until sidecar cmd/db rename.',
    ),
  ],
  [
    'scripts/verify-legacy-name-allowlist.mjs',
    allowAny('The verifier owns the legacy-name pattern and compatibility allowlist.'),
  ],
  [
    'scripts/verify-oss-source-package.mjs',
    allowAny('Source-package verifier owns the legacy path pattern it blocks.'),
  ],
  [
    'scripts/release/__tests__/legacy-name-allowlist.test.mjs',
    allowAny('Regression test fixture for unallowlisted legacy-name detection.'),
  ],
  [
    'scripts/release/__tests__/desktop-branding.test.mjs',
    allowAny('Regression test fixture asserts legacy desktop branding does not return.'),
  ],
  [
    'scripts/release/__tests__/release-profiles.test.mjs',
    allowAny('Regression test fixture asserts legacy release profile/env names do not return.'),
  ],
  ['AGENTS.md', allowAny('Repository handoff instructions quote external historical repo paths.')],
  [
    'apps/desktop/scripts/__tests__/package-linux.test.mjs',
    allowAny('Regression test fixture asserts legacy package/env names do not return.'),
  ],
  [
    'apps/desktop/scripts/__tests__/run-electron-vite-config.test.mjs',
    allowAny('Regression test fixture asserts legacy market/env injection stays scrubbed.'),
  ],
  [
    'scripts/dev/oss-env-scrubber.cjs',
    allowAny('OSS env scrubber must name legacy commercial env vars to remove them.'),
  ],
  [
    'scripts/dev/__tests__/release-profile-dev.test.mjs',
    allowAny('Regression test fixture asserts legacy release/profile envs stay scrubbed.'),
  ],
  [
    'scripts/release/__tests__/release-cli.test.mjs',
    allowAny('Regression test fixture asserts release CLI ignores legacy envs.'),
  ],
  [
    'scripts/release/__tests__/oss-source-package.test.mjs',
    allowAny('Regression test fixture asserts legacy source-package paths stay blocked.'),
  ],
  [
    'apps/mobile/ios/LynavoDrive/AuthKeychainCleaner.swift',
    allowAny('Keychain migration strings preserve access to existing credentials.'),
  ],
  [
    'apps/mobile/src/utils/clearUserScopedStorage.ts',
    allowAny('Shared-preference and storage migration strings preserve existing installs.'),
  ],
  [
    'apps/mobile/src/utils/__tests__/clearUserScopedStorage.test.ts',
    allowAny('Shared-preference migration test coverage.'),
  ],
]);

const ALLOWED_PATH_PREFIXES = [];

function usage() {
  return [
    'Usage: node scripts/verify-legacy-name-allowlist.mjs [--root <path>] [--advisory]',
    '',
    `Scans for legacy ${LEGACY_TERMS[0]} / ${LEGACY_TERMS[3]} names and reports hits outside the allowlist.`,
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
  const exactRule = ALLOWED_EXACT_PATHS.get(match.path);
  if (exactRule && ruleAllows(exactRule, match)) {
    return exactRule.reason;
  }
  for (const [prefix, prefixRule] of ALLOWED_PATH_PREFIXES) {
    if (match.path.startsWith(prefix) && ruleAllows(prefixRule, match)) {
      return prefixRule.reason;
    }
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
