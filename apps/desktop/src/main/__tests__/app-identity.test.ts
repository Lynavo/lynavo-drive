import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('desktop Electron identity', () => {
  it('sets the Lynavo userData path explicitly before Electron startup', () => {
    const source = readFileSync(resolve(__dirname, '../index.ts'), 'utf8');

    expect(source).toContain('APP_STORAGE_IDENTITY_NAME');
    expect(source).toContain(
      "app.setPath('userData', join(app.getPath('appData'), APP_STORAGE_IDENTITY_NAME));",
    );
    expect(source.indexOf("app.setPath('userData'")).toBeLessThan(
      source.indexOf('app.whenReady()'),
    );
    expect(source).not.toContain('storage-identity');
    expect(source).not.toMatch(/app\.setName\(/);
    expect(source).not.toContain(['Vivi', 'Drop'].join(' '));
  });
});
