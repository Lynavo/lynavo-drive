import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function readText(repoRoot, relativePath) {
  try {
    return readFileSync(join(repoRoot, relativePath), 'utf8');
  } catch (error) {
    throw new Error(
      `Unable to read release version source ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readPackageVersion(repoRoot, source, relativePath) {
  let packageJson;
  try {
    packageJson = JSON.parse(readText(repoRoot, relativePath));
  } catch (error) {
    throw new Error(
      `${source} release version source is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new Error(`${source} release version source is missing version.`);
  }
  return packageJson.version;
}

function readIosVersion(repoRoot) {
  const project = readText(
    repoRoot,
    'apps/mobile/ios/LynavoDrive.xcodeproj/project.pbxproj',
  );
  const matches = [...project.matchAll(/\bMARKETING_VERSION\s*=\s*([^;\r\n]+)\s*;/g)].map(
    match => match[1].trim(),
  );
  const versions = new Set(matches);

  if (versions.size === 0) {
    throw new Error('iOS release version source is missing MARKETING_VERSION.');
  }
  if (versions.size !== 1) {
    throw new Error(
      `iOS release version source is ambiguous: ${[...versions].join(', ')}.`,
    );
  }
  return versions.values().next().value;
}

function readAndroidVersion(repoRoot, iosVersion) {
  const buildGradle = readText(repoRoot, 'apps/mobile/android/app/build.gradle');
  const matches = [
    ...buildGradle.matchAll(
      /^\s*versionName\s+(?:["']([^"']+)["']|(resolveIosMarketingVersion\(\)))\s*$/gm,
    ),
  ];

  if (matches.length !== 1) {
    throw new Error(
      `Android release version source must contain one unambiguous versionName; found ${matches.length}.`,
    );
  }

  return matches[0][2] === 'resolveIosMarketingVersion()'
    ? iosVersion
    : matches[0][1];
}

export function readReleaseVersions(repoRoot) {
  const root = resolve(repoRoot);
  const ios = readIosVersion(root);
  return {
    desktop: readPackageVersion(
      root,
      'Desktop',
      'apps/desktop/package.json',
    ),
    mobile: readPackageVersion(root, 'Mobile', 'apps/mobile/package.json'),
    ios,
    android: readAndroidVersion(root, ios),
  };
}

export function verifyReleaseTag({ repoRoot, tag }) {
  const match = STABLE_TAG.exec(tag);
  if (!match) {
    throw new Error('Expected a stable release tag in exact vX.Y.Z form.');
  }

  const version = tag.slice(1);
  const versions = readReleaseVersions(repoRoot);
  for (const [source, sourceVersion] of Object.entries(versions)) {
    if (sourceVersion !== version) {
      throw new Error(
        `${source} release version ${sourceVersion} does not match tag version ${version}.`,
      );
    }
  }

  return { tag, version };
}
