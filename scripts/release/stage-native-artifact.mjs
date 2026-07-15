#!/usr/bin/env node

import {
  constants,
  copyFileSync,
  mkdirSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { basename, join } from 'node:path';

function parseArguments(argv) {
  const allowed = new Set(['--source', '--output-dir', '--name']);
  const values = new Map();

  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || !value || values.has(flag)) {
      throw new Error(
        'Expected exactly --source, --output-dir, and --name with one value each.',
      );
    }
    values.set(flag, value);
  }

  if (values.size !== allowed.size) {
    throw new Error(
      'Expected exactly --source, --output-dir, and --name with one value each.',
    );
  }

  return {
    source: values.get('--source'),
    outputDir: values.get('--output-dir'),
    name: values.get('--name'),
  };
}

function stageNativeArtifact({ source, outputDir, name }) {
  if (basename(name) !== name || name.includes('\\')) {
    throw new Error('Artifact name must be a filename without path separators.');
  }

  let sourceStats;
  try {
    sourceStats = statSync(source);
  } catch {
    throw new Error(`Source artifact does not exist: ${source}`);
  }
  if (!sourceStats.isFile() || sourceStats.size === 0) {
    throw new Error(`Source artifact must be a non-empty regular file: ${source}`);
  }

  mkdirSync(outputDir, { recursive: true });
  if (readdirSync(outputDir).length !== 0) {
    throw new Error(`Output directory must be empty: ${outputDir}`);
  }

  const destination = join(outputDir, name);
  copyFileSync(source, destination, constants.COPYFILE_EXCL);
  return destination;
}

try {
  const destination = stageNativeArtifact(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${destination}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
