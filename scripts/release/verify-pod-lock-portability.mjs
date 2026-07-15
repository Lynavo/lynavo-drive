#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

function normalizeExternalSourceChecksums(lockText) {
  const lock = parse(lockText);
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) {
    throw new Error('Expected Podfile.lock to contain a YAML mapping.');
  }

  const normalized = structuredClone(lock);
  const externalSources = normalized['EXTERNAL SOURCES'];
  const specChecksums = normalized['SPEC CHECKSUMS'];

  if (
    externalSources &&
    typeof externalSources === 'object' &&
    !Array.isArray(externalSources) &&
    specChecksums &&
    typeof specChecksums === 'object' &&
    !Array.isArray(specChecksums)
  ) {
    for (const podName of Object.keys(externalSources)) {
      delete specChecksums[podName];
    }
  }

  return normalized;
}

export function assertPortablePodLock(beforeText, afterText) {
  try {
    assert.deepStrictEqual(
      normalizeExternalSourceChecksums(afterText),
      normalizeExternalSourceChecksums(beforeText),
    );
  } catch (error) {
    if (error instanceof assert.AssertionError) {
      throw new Error('Podfile.lock changed outside external source checksums.');
    }
    throw error;
  }
}

function parseArguments(argv) {
  const allowed = new Set(['--before', '--after']);
  const values = new Map();

  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || !value || values.has(flag)) {
      throw new Error('Expected exactly --before and --after with one value each.');
    }
    values.set(flag, value);
  }

  if (values.size !== allowed.size) {
    throw new Error('Expected exactly --before and --after with one value each.');
  }

  return {
    before: values.get('--before'),
    after: values.get('--after'),
  };
}

function main(argv) {
  const { before, after } = parseArguments(argv);
  assertPortablePodLock(readFileSync(before, 'utf8'), readFileSync(after, 'utf8'));
  process.stdout.write('Podfile.lock dependency graph is unchanged.\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
