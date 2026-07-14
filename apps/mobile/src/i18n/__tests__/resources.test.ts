import { resources } from '../resources';

const { readFileSync } = jest.requireActual('fs') as {
  readFileSync: (path: string, encoding: 'utf8') => string;
};
const { cwd } = jest.requireActual('process') as {
  cwd: () => string;
};

function collectLeafPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix];
  }

  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) =>
      collectLeafPaths(child, prefix ? `${prefix}.${key}` : key),
    )
    .sort();
}

describe('i18n resources', () => {
  it('keeps the same leaf keys across en, zh-Hans, and zh-Hant', () => {
    const enKeys = collectLeafPaths(resources.en.translation);
    const zhHansKeys = collectLeafPaths(resources['zh-Hans'].translation);
    const zhHantKeys = collectLeafPaths(resources['zh-Hant'].translation);

    expect(zhHansKeys).toEqual(enKeys);
    expect(zhHantKeys).toEqual(enKeys);
  });

  it('keeps production translation keys free of the retired global market namespace', () => {
    const productionFiles = [
      'src/screens/DeviceDiscoveryScreen.tsx',
      'src/screens/SettingsScreen.tsx',
    ];

    for (const relativePath of productionFiles) {
      const source = readFileSync(`${cwd()}/${relativePath}`, 'utf8');

      expect(source).not.toMatch(/(?:deviceDiscovery|settings)\.global\./);
    }
  });

  it('keeps market-neutral discovery and settings resources complete', () => {
    const supportedLocales = ['en', 'zh-Hans', 'zh-Hant'] as const;

    for (const locale of supportedLocales) {
      const { deviceDiscovery, settings } = resources[locale].translation;

      expect(deviceDiscovery).not.toHaveProperty('global');
      expect(settings).not.toHaveProperty('global');
      expect(collectLeafPaths(deviceDiscovery)).toHaveLength(184);
      expect(collectLeafPaths(settings)).toHaveLength(65);
      expect(deviceDiscovery).toHaveProperty('onboarding.unconnected');
      expect(deviceDiscovery).toHaveProperty('onboarding.step1Title');
    }
  });
});
