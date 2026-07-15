import { readFileSync } from 'node:fs';

const desktopPackage = JSON.parse(
  readFileSync(new URL('../../apps/desktop/package.json', import.meta.url), 'utf8'),
);

const prefix = String(desktopPackage.productName ?? '').replace(/\s+/g, '');
if (!/^[A-Za-z0-9]+$/.test(prefix)) {
  throw new Error('Desktop productName must produce an alphanumeric release artifact prefix.');
}

export const RELEASE_ARTIFACT_PREFIX = prefix;
