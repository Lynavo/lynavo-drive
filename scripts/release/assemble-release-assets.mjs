#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  constants,
  copyFileSync,
  createReadStream,
  lstatSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { RELEASE_ARTIFACT_PREFIX } from './release-artifact-prefix.mjs';

const RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function releaseAssetNames(version) {
  return [
    `${RELEASE_ARTIFACT_PREFIX}-${version}-macos-arm64.dmg`,
    `${RELEASE_ARTIFACT_PREFIX}-${version}-macos-x64.dmg`,
    `${RELEASE_ARTIFACT_PREFIX}-${version}-windows-x64.exe`,
    `${RELEASE_ARTIFACT_PREFIX}-${version}-windows-x64.zip`,
    `${RELEASE_ARTIFACT_PREFIX}-${version}-android-arm64-x86_64.apk`,
    `${RELEASE_ARTIFACT_PREFIX}-${version}-android-arm64-x86_64.aab`,
  ];
}

function parseArguments(argv) {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  let version;
  let outputDir;
  const inputDirs = [];

  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value) {
      throw new Error(
        'Expected --version, one or more --input-dir values, and --output-dir.',
      );
    }

    if (flag === '--input-dir') {
      inputDirs.push(value);
    } else if (flag === '--version' && version === undefined) {
      version = value;
    } else if (flag === '--output-dir' && outputDir === undefined) {
      outputDir = value;
    } else {
      throw new Error(
        'Expected --version, one or more --input-dir values, and --output-dir.',
      );
    }
  }

  if (!version || !RELEASE_VERSION.test(version) || !outputDir || inputDirs.length === 0) {
    throw new Error(
      'Expected --version in X.Y.Z form, one or more --input-dir values, and --output-dir.',
    );
  }

  return { version, inputDirs, outputDir };
}

function collectRegularFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectRegularFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    } else {
      throw new Error(`Unexpected non-regular input: ${path}`);
    }
  }
  return files;
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function assembleReleaseAssets({ version, inputDirs, outputDir }) {
  mkdirSync(outputDir, { recursive: true });
  if (readdirSync(outputDir).length !== 0) {
    throw new Error(`Output directory must be empty: ${outputDir}`);
  }

  const allowedNames = releaseAssetNames(version);
  const allowed = new Set(allowedNames);
  const inputs = new Map();

  for (const inputDir of inputDirs) {
    for (const path of collectRegularFiles(inputDir)) {
      const name = basename(path);
      if (!allowed.has(name)) {
        throw new Error(`Unexpected release asset: ${name}`);
      }
      if (inputs.has(name)) {
        throw new Error(`Duplicate release asset: ${name}`);
      }
      const stats = lstatSync(path);
      if (stats.size === 0) {
        throw new Error(`Release asset must be non-empty: ${name}`);
      }
      inputs.set(name, path);
    }
  }

  const missing = allowedNames.filter(name => !inputs.has(name));
  if (missing.length > 0) {
    throw new Error(`Missing release assets: ${missing.join(', ')}`);
  }

  for (const name of allowedNames) {
    copyFileSync(inputs.get(name), join(outputDir, name), constants.COPYFILE_EXCL);
  }

  const checksumLines = [];
  for (const name of [...allowedNames].sort()) {
    checksumLines.push(`${await sha256(join(outputDir, name))}  ${name}`);
  }
  writeFileSync(join(outputDir, 'SHA256SUMS'), `${checksumLines.join('\n')}\n`, {
    flag: 'wx',
  });

  return outputDir;
}

try {
  const outputDir = await assembleReleaseAssets(
    parseArguments(process.argv.slice(2)),
  );
  process.stdout.write(`${outputDir}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
