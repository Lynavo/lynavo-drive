import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const generatedVersionFiles = [
  'packages/contracts/src/version.generated.ts',
  'services/sidecar-go/internal/protocol/version_generated.go',
  'apps/mobile/ios/SyncEngine/LynavoVersion.generated.swift',
  'apps/mobile/android/app/src/main/java/com/lynavo/drive/mobile/sync/LynavoVersion.kt',
];

test('generated version files use LF line endings on every checkout platform', () => {
  for (const file of generatedVersionFiles) {
    const attributes = execFileSync(
      'git',
      ['check-attr', 'text', 'eol', '--', file],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      },
    );

    assert.equal(
      attributes,
      `${file}: text: set\n${file}: eol: lf\n`,
    );
  }
});
