#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyReleaseTag } from './release-version.mjs';

const defaultRepoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function parseArguments(argv) {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  const allowed = new Set(['--tag', '--repo-root']);
  const values = new Map();

  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!allowed.has(flag) || !value || values.has(flag)) {
      throw new Error('Expected --tag once and optional --repo-root once.');
    }
    values.set(flag, value);
  }

  if (!values.has('--tag')) {
    throw new Error('Expected --tag once and optional --repo-root once.');
  }

  return {
    tag: values.get('--tag'),
    repoRoot: values.get('--repo-root') ?? defaultRepoRoot,
  };
}

try {
  const result = verifyReleaseTag(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${result.version}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
