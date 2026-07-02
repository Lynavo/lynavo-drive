#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { relative, resolve, sep } from 'node:path';
import process from 'node:process';

const HAN_PATTERN = String.raw`[\p{Unified_Ideograph}]`;
const MAX_REPORTED_HITS = 200;

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

const ALLOWED_PREFIXES = [
  [
    'apps/desktop/src/renderer/i18n/locales/zh-Hans/',
    'Desktop Simplified Chinese renderer locale resources.',
  ],
  [
    'apps/desktop/src/renderer/i18n/locales/zh-Hant/',
    'Desktop Traditional Chinese renderer locale resources.',
  ],
  ['apps/mobile/src/i18n/locales/zh-Hans/', 'Mobile Simplified Chinese locale resources.'],
  ['apps/mobile/src/i18n/locales/zh-Hant/', 'Mobile Traditional Chinese locale resources.'],
  ['apps/mobile/ios/zh-Hans.lproj/', 'iOS Simplified Chinese Info.plist localization.'],
];

const ALLOWED_EXACT_PATHS = new Map([
  [
    'scripts/verify-no-chinese-outside-i18n.mjs',
    'The verifier owns the CJK ideograph pattern and localization allowlist.',
  ],
  [
    'apps/mobile/scripts/resources/mobile-i18n.xlsx',
    'First-party translation source workbook for the local i18n import tool.',
  ],
]);

function usage() {
  return [
    'Usage: node scripts/verify-no-chinese-outside-i18n.mjs [--root <path>] [--advisory]',
    '',
    'Scans project text files for Chinese/Han characters outside explicit localization resources.',
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

function allowReason(path) {
  const exactReason = ALLOWED_EXACT_PATHS.get(path);
  if (exactReason) {
    return exactReason;
  }
  const prefixRule = ALLOWED_PREFIXES.find(([prefix]) => path.startsWith(prefix));
  return prefixRule?.[1] ?? null;
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
    '--pcre2',
    ...IGNORE_GLOBS.flatMap((glob) => ['--glob', glob]),
    '-e',
    HAN_PATTERN,
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
    } catch {
      continue;
    }

    if (event.type !== 'match') {
      continue;
    }

    const path = relativePath(scanRoot, event.data.path.text);
    const lineNumber = event.data.line_number;
    const lineText = event.data.lines.text.replace(/\r?\n$/, '');
    matches.push({ path, lineNumber, lineText });
  }

  return matches.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.lineNumber - right.lineNumber ||
      left.lineText.localeCompare(right.lineText),
  );
}

function formatMatch(match) {
  return `${match.path}:${match.lineNumber} ${match.lineText.trim()}`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const result = runRipgrep(options.root);
  if (result.status !== 0 && result.status !== 1) {
    process.stderr.write(result.stderr);
    return result.status ?? 1;
  }

  const matches = collectMatches(options.root, result.stdout);
  const allowed = [];
  const unallowlisted = [];
  for (const match of matches) {
    const reason = allowReason(match.path);
    if (reason) {
      allowed.push({ ...match, reason });
    } else {
      unallowlisted.push(match);
    }
  }

  console.log(`Chinese text scan pattern: ${HAN_PATTERN}`);
  console.log(`Allowed localization hits: ${allowed.length}`);
  console.log(`Unallowlisted Chinese text hits: ${unallowlisted.length}`);

  if (unallowlisted.length > 0) {
    console.log('');
    console.log('Unallowlisted Chinese text hits:');
    for (const match of unallowlisted.slice(0, MAX_REPORTED_HITS)) {
      console.log(`- ${formatMatch(match)}`);
    }
    if (unallowlisted.length > MAX_REPORTED_HITS) {
      console.log(`- ... ${unallowlisted.length - MAX_REPORTED_HITS} more hit(s) omitted`);
    }
    if (!options.advisory) {
      return 1;
    }
  }

  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
