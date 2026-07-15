import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resources } from '../resources';

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const staticTranslationCallPattern =
  /\b(?:t|i18n\.t)\(\s*(['"])([a-zA-Z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)\1/g;
const dynamicRendererKeys = [
  'layout.sidecar.runtimeMessages.bonjourNativeDetected',
  'layout.sidecar.runtimeMessages.bonjourFallbackDetected',
  'layout.sidecar.runtimeMessages.starting',
  'layout.sidecar.runtimeMessages.retrying',
  'layout.sidecar.runtimeMessages.startFailed',
  'layout.sidecar.runtimeMessages.exited',
  'layout.sidecar.runtimeMessages.healthCheckFailed',
  'layout.sidecar.runtimeMessages.retryingAfterFailure',
  'layout.sidecar.runtimeMessages.failedCheckExecutable',
];
const hardcodedUserFacingCopyFiles = [
  'features/dashboard/Dashboard.tsx',
  'features/dashboard/DiskWarningBanner.tsx',
  'features/devices/DeviceDetailPanel.tsx',
  'features/help/HelpDialog.tsx',
  'features/layout/AppShell.tsx',
  'features/layout/Sidebar.tsx',
  'features/library/ReceivedLibraryPage.tsx',
  'features/records/RecordsPage.tsx',
  'features/settings/SettingsPage.tsx',
];
const chineseTextPattern = /[\p{Script=Han}]/u;
const translatedFallbackPattern = /defaultValue:\s*['"`][^'"`]*[\p{Script=Han}]/u;
const allowedHardcodedChinesePatterns = [
  /console\.(?:warn|error|log)/,
  /encodeURIComponent\(/,
  /subject = encodeURIComponent/,
  /body = encodeURIComponent/,
  /const localeLabels:/,
  /'zh-Hans':/,
  /'zh-Hant':/,
  /title="LynavoDrive/,
  /LynavoDrive/,
  /Lynavo Drive/,
];

function collectLeafPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix];
  }

  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => collectLeafPaths(child, prefix ? `${prefix}.${key}` : key))
    .sort();
}

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stats = statSync(path);

    if (stats.isDirectory()) {
      if (
        entry === 'locales' ||
        entry === '__tests__' ||
        entry === 'mocks' ||
        entry === 'test-utils'
      ) {
        return [];
      }
      return collectSourceFiles(path);
    }

    if (!/\.(ts|tsx)$/.test(entry) || /\.test\.(ts|tsx)$/.test(entry)) {
      return [];
    }

    return [path];
  });
}

function collectStaticTranslationKeys(): Array<{ file: string; key: string }> {
  return collectSourceFiles(sourceRoot).flatMap((path) => {
    const source = readFileSync(path, 'utf8');
    const keys: Array<{ file: string; key: string }> = [];

    for (const match of source.matchAll(staticTranslationCallPattern)) {
      keys.push({ file: relative(sourceRoot, path), key: match[2] });
    }

    return keys;
  });
}

function collectHardcodedChineseCopy(): string[] {
  return hardcodedUserFacingCopyFiles.flatMap((file) => {
    const path = join(sourceRoot, file);
    const source = readFileSync(path, 'utf8');

    return source.split('\n').flatMap((line, index) => {
      if (!chineseTextPattern.test(line)) return [];
      if (translatedFallbackPattern.test(line)) return [];
      if (allowedHardcodedChinesePatterns.some((pattern) => pattern.test(line))) return [];

      return [`${file}:${index + 1}: ${line.trim()}`];
    });
  });
}

describe('i18n resources', () => {
  it('keeps the same leaf keys across en, zh-Hans, and zh-Hant', () => {
    const enKeys = collectLeafPaths(resources.en.translation);
    const zhHansKeys = collectLeafPaths(resources['zh-Hans'].translation);
    const zhHantKeys = collectLeafPaths(resources['zh-Hant'].translation);

    expect(zhHansKeys).toEqual(enKeys);
    expect(zhHantKeys).toEqual(enKeys);
  });

  it('contains every static translation key referenced by renderer code', () => {
    const enKeys = new Set(collectLeafPaths(resources.en.translation));
    const missingKeys = [
      ...collectStaticTranslationKeys(),
      ...dynamicRendererKeys.map((key) => ({ file: 'dynamic renderer keys', key })),
    ]
      .filter(({ key }) => !enKeys.has(key))
      .map(({ file, key }) => `${file}: ${key}`);

    expect(missingKeys).toEqual([]);
  });

  it('does not leave hardcoded Chinese user-facing copy in active renderer pages', () => {
    expect(collectHardcodedChineseCopy()).toEqual([]);
  });
});
