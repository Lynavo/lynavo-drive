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
  assert.match(script, /-c\.dmg\.title=\$\{DMG_CREATE_VOLUME_NAME\}"/);
  assert.doesNotMatch(
    script,
    /-c\.dmg\.title=\$\{DESKTOP_PRODUCT_NAME\} \$\{DESKTOP_VERSION\}-\$\{arch\}/,
  );
  assert.match(script, /finalize_dmg_volume_name "\$\{arch\}"/);
  assert.match(script, /validate_dmg_payload "\$\{arch\}"/);
  assert.match(script, /DMG artifact does not contain \$\{DESKTOP_PRODUCT_NAME\}\.app/);
  assert.match(script, /rebuild_dmg_from_app "\$\{arch\}"/);
  assert.match(script, /remove_stale_dmg_blockmap "\$\{arch\}"/);
  assert.match(script, /DMG_CREATE_VOLUME_NAME="\$\{DESKTOP_PRODUCT_NAME\} DMG"/);
  assert.match(script, /diskutil rename "\$\{mount_dir\}" "\$\{DESKTOP_PRODUCT_NAME\}"/);
});

test('signed macOS packaging resolves Lynavo App Store Connect key without market branching', () => {
  const script = readFileSync(
    resolve(repoRoot, 'apps/desktop/scripts/package-macos-signed.sh'),
    'utf8',
  );

  assert.doesNotMatch(script, /SYNCFLOW_MARKET/);
  assert.doesNotMatch(script, /DEFAULT_CN_API_KEY_ID|HY8CAHGPW9|AuthKey_China/);
  assert.match(script, /DEFAULT_API_KEY_ID="AMY9XVV3LD"/);
  assert.match(script, /DEFAULT_API_ISSUER="8de17ec0-4bff-4ab2-8c01-ace1f9307147"/);
  assert.match(script, /APPLE_API_KEY_ID="\$\{APPLE_API_KEY_ID:-\$\{DEFAULT_API_KEY_ID\}\}"/);
  assert.doesNotMatch(script, /AuthKey_Global/);
  assert.match(script, /AuthKey_Lynavo_\$\{APPLE_API_KEY_ID\}\.p8/);
});

test('signed macOS packaging always uses the single desktop builder config', () => {
  const script = readFileSync(
    resolve(repoRoot, 'apps/desktop/scripts/package-macos-signed.sh'),
    'utf8',
  );

  assert.match(script, /ELECTRON_BUILDER_CONFIG="electron-builder\.yml"/);
  assert.match(script, /"--config"/);
  assert.match(script, /"\$\{ELECTRON_BUILDER_CONFIG\}"/);
  assert.doesNotMatch(script, /ELECTRON_BUILDER_CONFIG:-/);
  assert.doesNotMatch(script, /electron-builder\.(cn|global)\.yml/);
});

test('signed macOS packaging resolves Lynavo Developer ID team without market branching', () => {
  const script = readFileSync(
    resolve(repoRoot, 'apps/desktop/scripts/package-macos-signed.sh'),
    'utf8',
  );

  assert.doesNotMatch(script, /DEFAULT_CN_CSC_TEAM_ID|GKN7JQNCMC/);
  assert.match(script, /DEFAULT_CSC_TEAM_ID="S44ANBLMF9"/);
  assert.match(script, /echo "\$\{CSC_TEAM_ID:-\$\{DEFAULT_CSC_TEAM_ID\}\}"/);
  assert.match(script, /list_certificates_for_team\(\)/);
  assert.match(script, /EXPECTED_CSC_TEAM_ID="\$\(resolve_expected_csc_team_id\)"/);
  assert.match(script, /detect_identity_for_team "\$\{EXPECTED_CSC_TEAM_ID\}"/);
  assert.match(script, /macOS DMG requires Developer ID Application/);
  assert.match(script, /not a usable Developer ID Application signing identity/);
  assert.match(script, /Selected CSC_NAME does not match expected Team ID/);
  assert.match(script, /set CSC_TEAM_ID\/CSC_NAME explicitly/);
  assert.match(script, /Expected Team ID: \$\{EXPECTED_CSC_TEAM_ID\}/);
});

test('desktop builder config does not commit a MAS provisioning profile path', () => {
  const builderConfig = readFileSync(resolve(repoRoot, 'apps/desktop/electron-builder.yml'), 'utf8');

  assert.doesNotMatch(builderConfig, /embedded\.provisionprofile/);
  assert.doesNotMatch(builderConfig, /^  provisioningProfile:/m);
});

test('MAS packaging requires an external provisioning profile input', () => {
  const script = readFileSync(
    resolve(repoRoot, 'apps/desktop/scripts/package-macos-mas.sh'),
    'utf8',
  );

  assert.match(script, /MAS_PROVISIONING_PROFILE/);
  assert.match(script, /Missing MAS provisioning profile/);
  assert.match(script, /-c\.mas\.provisioningProfile=\$\{MAS_PROVISIONING_PROFILE\}/);
  assert.doesNotMatch(script, /embedded\.provisionprofile/);
});
