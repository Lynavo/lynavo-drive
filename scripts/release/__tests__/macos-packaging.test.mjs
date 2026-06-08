import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../../..');

test('signed macOS packaging builds DMGs one architecture at a time', () => {
  const script = readFileSync(
    resolve(repoRoot, 'apps/desktop/scripts/package-macos-signed.sh'),
    'utf8',
  );

  assert.doesNotMatch(script, /electron-builder --mac dmg --arm64 --x64/);
  assert.match(script, /for arch in x64 arm64/);
  assert.match(script, /electron-builder --mac "\$\{target\}" "--\$\{arch\}"/);
  assert.match(script, /-c\.dmg\.title=\$\{DESKTOP_PRODUCT_NAME\} \$\{DESKTOP_VERSION\}-\$\{arch\}/);
  assert.match(script, /validate_dmg_payload "\$\{arch\}"/);
  assert.match(script, /DMG artifact does not contain \$\{DESKTOP_PRODUCT_NAME\}\.app/);
});
