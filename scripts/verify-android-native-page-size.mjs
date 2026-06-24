#!/usr/bin/env node

import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const artifact = process.argv[2];

if (!artifact) {
  console.error('Usage: node scripts/verify-android-native-page-size.mjs <apk|aab|aar>');
  process.exit(1);
}

const artifactPath = artifact.startsWith('/') ? artifact : join(process.cwd(), artifact);

if (!existsSync(artifactPath)) {
  console.error(`Artifact not found: ${artifactPath}`);
  process.exit(1);
}

const readobj = findReadobj();
const workDir = mkdtempSync(join(tmpdir(), 'vividrop-native-page-size-'));

try {
  const unzip = spawnSync('unzip', ['-o', '-q', artifactPath, '-d', workDir], {
    encoding: 'utf8',
  });
  if (unzip.status !== 0) {
    console.error(unzip.stderr || unzip.stdout);
    process.exit(unzip.status ?? 1);
  }

  const nativeLibs = listFiles(workDir).filter((file) => file.endsWith('.so'));
  const failures = [];

  for (const lib of nativeLibs) {
    const result = spawnSync(readobj, ['--program-headers', lib], { encoding: 'utf8' });
    if (result.status !== 0) {
      failures.push(`${relative(workDir, lib)}: failed to inspect (${result.stderr.trim()})`);
      continue;
    }

    const badAlignments = collectBadLoadAlignments(result.stdout);
    if (badAlignments.length > 0) {
      failures.push(`${relative(workDir, lib)}: PT_LOAD alignments ${badAlignments.join(', ')}`);
    }
  }

  if (failures.length > 0) {
    console.error(`Found ${failures.length} native libraries that do not support 16 KB pages:`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(
    `Verified ${nativeLibs.length} native libraries in ${basename(artifactPath)} support 16 KB pages.`,
  );
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

function collectBadLoadAlignments(output) {
  const lines = output.split('\n');
  const bad = [];
  let inLoad = false;

  for (const line of lines) {
    if (line.includes('Type: PT_LOAD')) {
      inLoad = true;
      continue;
    }
    if (inLoad && line.includes('Alignment:')) {
      const alignment = Number(line.split('Alignment:')[1].trim());
      if (Number.isFinite(alignment) && alignment < 16 * 1024) {
        bad.push(alignment);
      }
      inLoad = false;
    }
  }

  return bad;
}

function listFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

function findReadobj() {
  const sdkRoot =
    process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || join(process.env.HOME, 'Library/Android/sdk');
  const ndkRoot = join(sdkRoot, 'ndk');

  if (!existsSync(ndkRoot)) {
    throw new Error(`Android NDK directory not found under ${ndkRoot}`);
  }

  const candidates = readdirSync(ndkRoot)
    .sort(compareVersions)
    .reverse()
    .map((version) => join(ndkRoot, version, 'toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-readobj'));

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`llvm-readobj not found under ${ndkRoot}`);
  }

  return found;
}

function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  const count = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < count; index += 1) {
    const diff = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}
