declare const process: { cwd(): string };

type FsModule = {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: 'utf8'): string;
};

type PathModule = {
  join(...paths: string[]): string;
};

const fs = require('fs') as FsModule;
const path = require('path') as PathModule;

const BATTERY_OPTIMIZATION_PERMISSION =
  'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS';

const PHONE_ONLY_SCREEN_DECLARATIONS = [
  'android:smallScreens="true"',
  'android:normalScreens="true"',
  'android:largeScreens="false"',
  'android:xlargeScreens="false"',
  'android:requiresSmallestWidthDp="320"',
] as const;

function readManifest(sourceSet: 'main' | 'cn' | 'global'): string | null {
  const manifestPath = path.join(
    process.cwd(),
    'android',
    'app',
    'src',
    sourceSet,
    'AndroidManifest.xml',
  );

  return fs.existsSync(manifestPath)
    ? fs.readFileSync(manifestPath, 'utf8')
    : null;
}

describe('Android manifest market policy', () => {
  it('keeps battery optimization exemption permission out of the shared manifest', () => {
    expect(readManifest('main') ?? '').not.toContain(
      BATTERY_OPTIMIZATION_PERMISSION,
    );
  });

  it('declares battery optimization exemption permission only for China Android', () => {
    expect(readManifest('cn')).toContain(BATTERY_OPTIMIZATION_PERMISSION);
    expect(readManifest('global') ?? '').not.toContain(
      BATTERY_OPTIMIZATION_PERMISSION,
    );
  });

  it('declares mobile phone screen support without tablet screens in the shared manifest', () => {
    const manifest = readManifest('main') ?? '';

    for (const declaration of PHONE_ONLY_SCREEN_DECLARATIONS) {
      expect(manifest).toContain(declaration);
    }
  });

  it('overrides China payment SDK tablet support declarations for phone-only release builds', () => {
    expect(readManifest('cn')).toContain(
      'tools:replace="android:largeScreens"',
    );
    expect(readManifest('global') ?? '').not.toContain('tools:replace=');
  });
});
