import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ANDROID_RESOLVER_ERROR =
  'Android release version resolver must have exactly one resolveIosMarketingVersion() definition whose body directly returns resolveIosBuildSetting("MARKETING_VERSION").';
const ANDROID_HELPER_ERROR =
  'Android release version helper must have exactly one canonical resolveIosBuildSetting() definition that reads project.pbxproj.';

function maskNonNewlineCharacters(text) {
  return text.replace(/[^\r\n]/g, ' ');
}

function maskGroovyCommentsAndQuotedStrings(source) {
  const masked = source.split('');
  const hideRange = (start, end) => {
    for (let index = start; index < end; index += 1) {
      if (source[index] !== '\r' && source[index] !== '\n') {
        masked[index] = ' ';
      }
    }
  };

  let index = 0;
  while (index < source.length) {
    if (source.startsWith('//', index)) {
      let end = index + 2;
      while (end < source.length && !['\r', '\n'].includes(source[end])) {
        end += 1;
      }
      hideRange(index, end);
      index = end;
      continue;
    }

    if (source.startsWith('/*', index)) {
      const closingIndex = source.indexOf('*/', index + 2);
      const end = closingIndex === -1 ? source.length : closingIndex + 2;
      hideRange(index, end);
      index = end;
      continue;
    }

    const delimiter = source.startsWith('"""', index)
      ? '"""'
      : source.startsWith("'''", index)
        ? "'''"
        : source[index] === '"' || source[index] === "'"
          ? source[index]
          : null;

    if (delimiter === null) {
      index += 1;
      continue;
    }

    let end = index + delimiter.length;
    while (end < source.length) {
      if (source[end] === '\\') {
        end = Math.min(end + 2, source.length);
        continue;
      }
      if (source.startsWith(delimiter, end)) {
        end += delimiter.length;
        break;
      }
      end += 1;
    }

    hideRange(index, end);
    index = end;
  }

  return masked.join('');
}

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
  const nonQuotedStructure = maskGroovyCommentsAndQuotedStrings(buildGradle);
  const resolverStructureSource = nonQuotedStructure.replace(
    /^[ \t]*def matcher = projectFile\.text =~ \/\$\{settingName\} = \(\[\^;\]\+\);\/[ \t]*$/gm,
    maskNonNewlineCharacters,
  );

  if (resolverStructureSource.includes('/')) {
    throw new Error(ANDROID_RESOLVER_ERROR);
  }

  const versionNameLines = [
    ...resolverStructureSource.matchAll(
      /^[^\r\n]*\bversionName\b[^\r\n]*$/gm,
    ),
  ];

  if (versionNameLines.length !== 1) {
    throw new Error(
      `Android release version source must contain one unambiguous versionName; found ${versionNameLines.length}.`,
    );
  }

  const versionNameLine = buildGradle.slice(
    versionNameLines[0].index,
    versionNameLines[0].index + versionNameLines[0][0].length,
  );
  const versionNameMatch =
    /^[ \t]*versionName[ \t]+(?:(['"])([^'"\r\n]+)\1|(resolveIosMarketingVersion\(\)))[ \t]*$/.exec(
      versionNameLine,
    );

  if (versionNameMatch === null) {
    throw new Error(
      'Android release version source contains an unsupported versionName directive.',
    );
  }

  if (versionNameMatch[3] !== 'resolveIosMarketingVersion()') {
    return versionNameMatch[2];
  }

  const resolverDefinitions = [
    ...resolverStructureSource.matchAll(
      /^[ \t]*[^\r\n{}]*\bresolveIosMarketingVersion\s*\(\s*\)\s*\{/gm,
    ),
  ];
  const rawResolverIdentifierOccurrences = [
    ...buildGradle.matchAll(/\bresolveIosMarketingVersion\b/g),
  ];
  const codeResolverIdentifierOccurrences = [
    ...resolverStructureSource.matchAll(/\bresolveIosMarketingVersion\b/g),
  ];
  const validResolvers = [
    ...buildGradle.matchAll(
      /^([ \t]*)def[ \t]+resolveIosMarketingVersion\s*\(\s*\)\s*\{\s*return\s+resolveIosBuildSetting\s*\(\s*(["'])MARKETING_VERSION\2\s*\)\s*;?\s*\}[ \t]*$/gm,
    ),
  ].filter(match =>
    resolverStructureSource.startsWith(
      'def',
      match.index + match[1].length,
    ),
  );

  if (
    resolverDefinitions.length !== 1 ||
    rawResolverIdentifierOccurrences.length !== 2 ||
    codeResolverIdentifierOccurrences.length !== 2 ||
    validResolvers.length !== 1
  ) {
    throw new Error(ANDROID_RESOLVER_ERROR);
  }

  const validHelpers = [
    ...buildGradle.matchAll(
      /^([ \t]*)def[ \t]+resolveIosBuildSetting[ \t]*\([ \t]*String[ \t]+settingName[ \t]*\)[ \t]*\{[ \t]*\r?\n[ \t]*def[ \t]+projectFile[ \t]*=[ \t]*file[ \t]*\([ \t]*"\.\.\/\.\.\/ios\/LynavoDrive\.xcodeproj\/project\.pbxproj"[ \t]*\)[ \t]*\r?\n[ \t]*def[ \t]+matcher[ \t]*=[ \t]*projectFile\.text[ \t]*=~[ \t]*\/\$\{settingName\} = \(\[\^;\]\+\);\/[ \t]*\r?\n[ \t]*\r?\n[ \t]*if[ \t]*\([ \t]*!matcher\.find\(\)[ \t]*\)[ \t]*\{[ \t]*\r?\n[ \t]*throw[ \t]+new[ \t]+GradleException[ \t]*\([ \t]*"Failed to resolve \$\{settingName\} from \$\{projectFile\}"[ \t]*\)[ \t]*\r?\n[ \t]*\}[ \t]*\r?\n[ \t]*\r?\n[ \t]*return[ \t]+matcher\.group[ \t]*\([ \t]*1[ \t]*\)\.trim[ \t]*\([ \t]*\)[ \t]*\r?\n[ \t]*\}[ \t]*$/gm,
    ),
  ].filter(match =>
    resolverStructureSource.startsWith(
      'def',
      match.index + match[1].length,
    ),
  );
  const validBuildNumberResolvers = [
    ...buildGradle.matchAll(
      /^([ \t]*)def[ \t]+resolveIosBuildNumber\s*\(\s*\)\s*\{\s*return\s+resolveIosBuildSetting\s*\(\s*"CURRENT_PROJECT_VERSION"\s*\)\s*;?\s*\}[ \t]*$/gm,
    ),
  ].filter(match =>
    resolverStructureSource.startsWith(
      'def',
      match.index + match[1].length,
    ),
  );
  const rawHelperIdentifierOccurrences = [
    ...buildGradle.matchAll(/\bresolveIosBuildSetting\b/g),
  ];
  const codeHelperIdentifierOccurrences = [
    ...resolverStructureSource.matchAll(/\bresolveIosBuildSetting\b/g),
  ];
  const expectedHelperOccurrences = 2 + validBuildNumberResolvers.length;

  if (
    validHelpers.length !== 1 ||
    validBuildNumberResolvers.length > 1 ||
    rawHelperIdentifierOccurrences.length !== expectedHelperOccurrences ||
    codeHelperIdentifierOccurrences.length !== expectedHelperOccurrences
  ) {
    throw new Error(ANDROID_HELPER_ERROR);
  }

  return iosVersion;
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
