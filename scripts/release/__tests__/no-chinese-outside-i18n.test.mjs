import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const verifier = new URL('../../verify-no-chinese-outside-i18n.mjs', import.meta.url);

function runVerifier(args = []) {
  return spawnSync(process.execPath, [verifier.pathname, ...args], {
    encoding: 'utf8',
  });
}

test('blocks Chinese text outside localization resources', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'no-chinese-'));
  try {
    writeFileSync(join(fixtureRoot, 'README.md'), '# \u9879\u76ee\n');

    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Unallowlisted Chinese text hits: 1/);
    assert.match(result.stdout, /README\.md:1 # \u9879\u76ee/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('allows Chinese text in explicit localization resources', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'no-chinese-'));
  try {
    const desktopLocale = join(
      fixtureRoot,
      'apps/desktop/src/renderer/i18n/locales/zh-Hans',
    );
    const mobileLocale = join(fixtureRoot, 'apps/mobile/src/i18n/locales/zh-Hant');
    const iosLocale = join(fixtureRoot, 'apps/mobile/ios/zh-Hans.lproj');
    mkdirSync(desktopLocale, { recursive: true });
    mkdirSync(mobileLocale, { recursive: true });
    mkdirSync(iosLocale, { recursive: true });
    writeFileSync(join(desktopLocale, 'common.json'), '{"ok":"\u786e\u8ba4"}\n');
    writeFileSync(join(mobileLocale, 'common.json'), '{"ok":"\u78ba\u8a8d"}\n');
    writeFileSync(
      join(iosLocale, 'InfoPlist.strings'),
      '"NSPhotoLibraryUsageDescription" = "\u8bbf\u95ee\u7167\u7247";\n',
    );
    writeFileSync(join(fixtureRoot, 'README.md'), '# Lynavo Drive\n');

    const result = runVerifier(['--root', fixtureRoot]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Allowed localization hits: 3/);
    assert.match(result.stdout, /Unallowlisted Chinese text hits: 0/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('advisory mode reports unallowlisted hits without failing', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'no-chinese-'));
  try {
    writeFileSync(join(fixtureRoot, 'docs.md'), '\u4e2d\u6587\n');

    const result = runVerifier(['--root', fixtureRoot, '--advisory']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Unallowlisted Chinese text hits: 1/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
