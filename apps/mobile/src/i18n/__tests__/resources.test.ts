import { resources } from '../resources';

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
});
