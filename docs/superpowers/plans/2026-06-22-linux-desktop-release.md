# Linux Desktop Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add formal Ubuntu 22.04+ Linux desktop release support for `amd64` and `arm64` `.deb` packages.

**Architecture:** Extend the existing macOS/Windows desktop release path instead of adding a separate Linux-only pipeline. Linux uses the existing Electron main/preload/renderer boundaries, bundles the same Go sidecar name as macOS, builds the sidecar natively per architecture, and packages through release profiles.

**Tech Stack:** Electron 41, electron-builder 26, React 18, Vitest 4, Node `node:test`, Go 1.25.6 with CGO sqlite, Ubuntu `.deb`.

---

## File Structure

- Modify `apps/desktop/src/shared/platform-capabilities.ts`: add Linux platform capability helper.
- Modify `apps/desktop/src/shared/__tests__/platform-capabilities.test.ts`: cover Linux capability behavior.
- Modify `apps/desktop/src/preload/api.d.ts`: expose `platform.isLinux()`.
- Modify `apps/desktop/src/preload/index.ts`: bridge `isLinux`.
- Modify `apps/desktop/src/preload/__tests__/index.test.ts`: assert preload exposes Linux capability.
- Modify `apps/desktop/src/renderer/hooks/use-electron-api.ts`: keep dev mock API type-complete.
- Modify `apps/desktop/src/renderer/features/settings/ShareAddressSection.tsx`: use neutral Linux share text and hide Mac/Windows guides.
- Modify `apps/desktop/src/renderer/features/settings/SystemGuideSection.tsx`: render Mac, Windows, or Linux-specific guidance by platform.
- Modify `apps/desktop/src/renderer/features/settings/__tests__/ShareAddressSection.test.tsx`: add Linux sharing regression.
- Create `apps/desktop/src/renderer/features/settings/__tests__/SystemGuideSection.test.tsx`: cover Linux/macOS/Windows guide gating.
- Modify `apps/desktop/src/renderer/i18n/locales/en/settings.json`, `zh-Hans/settings.json`, `zh-Hant/settings.json`: add Linux manual share text.
- Create `apps/desktop/scripts/build-sidecar-linux.cjs`: build Linux sidecar with native CGO.
- Create `apps/desktop/scripts/package-linux.cjs`: run workspace build, sidecar build, and electron-builder for the current Linux architecture.
- Create `apps/desktop/scripts/__tests__/build-sidecar-linux.test.mjs`: test sidecar arch/env mapping.
- Create `apps/desktop/scripts/__tests__/package-linux.test.mjs`: test package command generation.
- Modify `apps/desktop/package.json`: add Linux build and package scripts.
- Modify root `package.json`: add `package:desktop:linux`.
- Modify `apps/desktop/electron-builder.yml`, `electron-builder.cn.yml`, `electron-builder.global.yml`: add Linux `deb` target.
- Modify `scripts/release/__tests__/desktop-branding.test.mjs`: assert Linux `.deb` branding/config.
- Modify `scripts/release/release-profiles.mjs`: add `linux` release target.
- Modify `scripts/release/__tests__/release-profiles.test.mjs`: cover Linux target parsing and steps.
- Modify `scripts/release/__tests__/release-cli.test.mjs`: cover Linux dry-run output.
- Modify `docs/release/release-playbook.md`: document Linux release commands and smoke checks.
- Modify `docs/testing/beta-test-matrix.md`: add Linux desktop smoke matrix.

## Task 1: Linux Platform Capability Bridge

**Files:**
- Modify: `apps/desktop/src/shared/platform-capabilities.ts`
- Modify: `apps/desktop/src/shared/__tests__/platform-capabilities.test.ts`
- Modify: `apps/desktop/src/preload/api.d.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/preload/__tests__/index.test.ts`
- Modify: `apps/desktop/src/renderer/hooks/use-electron-api.ts`

- [ ] **Step 1: Write the failing platform capability test**

Add `isLinuxPlatform` to the imports and a test case in `apps/desktop/src/shared/__tests__/platform-capabilities.test.ts`:

```ts
import {
  isLinuxPlatform,
  shouldHideApplicationMenu,
  supportsAppleAuth,
  usesTitleBarOverlayControls,
} from '../platform-capabilities';

it('detects Linux hosts explicitly', () => {
  expect(isLinuxPlatform('linux')).toBe(true);
  expect(isLinuxPlatform('darwin')).toBe(false);
  expect(isLinuxPlatform('win32')).toBe(false);
});
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
pnpm --filter @lynavo-drive/desktop exec vitest run src/shared/__tests__/platform-capabilities.test.ts
```

Expected: fail with an export error for `isLinuxPlatform`.

- [ ] **Step 3: Implement the platform helper**

Update `apps/desktop/src/shared/platform-capabilities.ts`:

```ts
export function isLinuxPlatform(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'linux';
}

export function supportsAppleAuth(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'darwin';
}

export function usesTitleBarOverlayControls(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== 'darwin';
}

export function shouldHideApplicationMenu(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== 'darwin';
}
```

- [ ] **Step 4: Add preload API typing and bridge**

Update `apps/desktop/src/preload/api.d.ts` platform block:

```ts
  platform: {
    isMac(): boolean;
    isWindows(): boolean;
    isLinux(): boolean;
    supportsAppleAuth(): boolean;
    usesTitleBarOverlayControls(): boolean;
    getHomeDir(): string;
    getHostName(): string;
  };
```

Update imports and platform bridge in `apps/desktop/src/preload/index.ts`:

```ts
import {
  isLinuxPlatform,
  supportsAppleAuth,
  usesTitleBarOverlayControls,
} from '../shared/platform-capabilities';

platform: {
  isMac: () => process.platform === 'darwin',
  isWindows: () => process.platform === 'win32',
  isLinux: () => isLinuxPlatform(),
  supportsAppleAuth: () => supportsAppleAuth(),
  usesTitleBarOverlayControls: () => usesTitleBarOverlayControls(),
  getHomeDir: () => os.homedir(),
  getHostName: () => os.hostname(),
},
```

- [ ] **Step 5: Add preload and mock API tests**

Extend the hoisted API type in `apps/desktop/src/preload/__tests__/index.test.ts` with:

```ts
        platform: {
          isLinux(): boolean;
        };
```

Add a test:

```ts
  it('exposes Linux platform capability', async () => {
    await import('../index');

    expect(exposed.api?.platform.isLinux()).toBe(process.platform === 'linux');
  });
```

Update `apps/desktop/src/renderer/hooks/use-electron-api.ts` mock platform:

```ts
  isMac: () => true,
  isWindows: () => false,
  isLinux: () => false,
  supportsAppleAuth: () => true,
  usesTitleBarOverlayControls: () => false,
```

- [ ] **Step 6: Run focused verification**

Run:

```bash
pnpm --filter @lynavo-drive/desktop exec vitest run \
  src/shared/__tests__/platform-capabilities.test.ts \
  src/preload/__tests__/index.test.ts
pnpm --filter @lynavo-drive/desktop typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/shared/platform-capabilities.ts \
  apps/desktop/src/shared/__tests__/platform-capabilities.test.ts \
  apps/desktop/src/preload/api.d.ts \
  apps/desktop/src/preload/index.ts \
  apps/desktop/src/preload/__tests__/index.test.ts \
  apps/desktop/src/renderer/hooks/use-electron-api.ts
git commit -m "feat(desktop): expose linux platform capability"
```

## Task 2: Linux-Neutral Sharing UI

**Files:**
- Modify: `apps/desktop/src/renderer/features/settings/ShareAddressSection.tsx`
- Modify: `apps/desktop/src/renderer/features/settings/SystemGuideSection.tsx`
- Modify: `apps/desktop/src/renderer/features/settings/__tests__/ShareAddressSection.test.tsx`
- Create: `apps/desktop/src/renderer/features/settings/__tests__/SystemGuideSection.test.tsx`
- Modify: `apps/desktop/src/renderer/i18n/locales/en/settings.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/zh-Hans/settings.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/zh-Hant/settings.json`

- [ ] **Step 1: Add failing Linux share status test**

Extend `setElectronAPI` in `ShareAddressSection.test.tsx` to accept a platform:

```ts
function setElectronAPI(platform: 'windows' | 'linux' = 'windows') {
  (window as Window & { electronAPI?: unknown }).electronAPI = {
    platform: {
      isMac: () => false,
      isWindows: () => platform === 'windows',
      isLinux: () => platform === 'linux',
      getHostName: () => (platform === 'windows' ? 'STUDIO-PC' : 'studio-linux'),
    },
    files: {
      openExternal: vi.fn(),
      openFolder: vi.fn(),
      copyToClipboard: vi.fn(),
    },
  } as unknown as Window['electronAPI'];
}
```

Add the Linux regression:

```ts
  it('uses neutral manual sharing copy on Linux', () => {
    setElectronAPI('linux');

    render(<ShareAddressSection />);

    expect(screen.getByText('需要手动开启共享')).toBeInTheDocument();
    expect(screen.getByText('请在系统中手动配置文件共享后重新检测。')).toBeInTheDocument();
    expect(screen.queryByText('Windows 快速配置')).not.toBeInTheDocument();
    expect(screen.queryByText('打开系统共享指南')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the failing share test**

Run:

```bash
pnpm --filter @lynavo-drive/desktop exec vitest run src/renderer/features/settings/__tests__/ShareAddressSection.test.tsx
```

Expected: fail because Linux currently receives Windows detail text.

- [ ] **Step 3: Add Linux i18n keys**

Add these keys under `settings.shareAddress` in `apps/desktop/src/renderer/i18n/locales/zh-Hans/settings.json`:

```json
"needsManualEnableDetailLinux": "请在系统中手动配置文件共享后重新检测。",
"shareRegisteredDetailLinux": "系统已检测到共享配置，但共享路径可能还没有覆盖团队共享目录。"
```

Add Traditional Chinese:

```json
"needsManualEnableDetailLinux": "請在系統中手動設定檔案共享後重新檢測。",
"shareRegisteredDetailLinux": "系統已偵測到共享設定，但共享路徑可能尚未覆蓋團隊共享目錄。"
```

Add English:

```json
"needsManualEnableDetailLinux": "Configure file sharing in the system, then run the check again.",
"shareRegisteredDetailLinux": "A sharing configuration was detected, but it may not cover the team shared folder yet."
```

- [ ] **Step 4: Implement Linux share metadata selection**

Update `ShareAddressSection.tsx` platform reads:

```ts
  const isMac = window.electronAPI?.platform.isMac() ?? true;
  const isWindows = window.electronAPI?.platform.isWindows?.() ?? false;
  const isLinux = window.electronAPI?.platform.isLinux?.() ?? false;
```

Add helper inside the component before `statusMeta`:

```ts
  const platformShareDetail = (
    macKey: string,
    windowsKey: string,
    linuxKey: string,
  ): string => {
    if (isMac) return t(macKey);
    if (isWindows) return t(windowsKey);
    if (isLinux) return t(linuxKey);
    return t(linuxKey);
  };
```

Use it for `needs_manual_enable` and `share_registered`:

```ts
    needs_manual_enable: {
      label: t('settings.shareAddress.needsManualEnable'),
      detail: platformShareDetail(
        'settings.shareAddress.needsManualEnableDetailMac',
        'settings.shareAddress.needsManualEnableDetailWindows',
        'settings.shareAddress.needsManualEnableDetailLinux',
      ),
      tone: 'text-amber-700 bg-amber-50 border-amber-200',
      icon: Settings2,
      iconClassName: '',
      showGuide: isMac,
    },
    share_registered: {
      label: t('settings.shareAddress.shareRegistered'),
      detail: platformShareDetail(
        'settings.shareAddress.shareRegisteredDetailMac',
        'settings.shareAddress.shareRegisteredDetailWindows',
        'settings.shareAddress.shareRegisteredDetailLinux',
      ),
      tone: 'text-sky-700 bg-sky-50 border-sky-200',
      icon: Link2,
      iconClassName: '',
      showGuide: isMac,
    },
```

- [ ] **Step 5: Add failing SystemGuideSection tests**

Create `apps/desktop/src/renderer/features/settings/__tests__/SystemGuideSection.test.tsx`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SystemGuideSection } from '../SystemGuideSection';
import { useSettingsStore } from '@renderer/stores/settings-store';

function setElectronAPI(platform: 'mac' | 'windows' | 'linux') {
  (window as Window & { electronAPI?: unknown }).electronAPI = {
    platform: {
      isMac: () => platform === 'mac',
      isWindows: () => platform === 'windows',
      isLinux: () => platform === 'linux',
    },
    files: {
      openExternal: vi.fn(),
      openFolder: vi.fn(),
    },
  } as unknown as Window['electronAPI'];
}

describe('SystemGuideSection', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: {
        sharedPath: '/home/alice/.config/Vivi Drop/shared',
      },
    });
  });

  it('shows Linux manual sharing guidance without Mac or Windows actions', () => {
    setElectronAPI('linux');

    render(<SystemGuideSection />);

    expect(screen.getByText('Linux 文件共享')).toBeInTheDocument();
    expect(screen.getByText('在系统中手动配置 Samba 或文件共享后，回到 Vivi Drop 重新检测。')).toBeInTheDocument();
    expect(screen.queryByText('macOS 文件共享')).not.toBeInTheDocument();
    expect(screen.queryByText('Windows 文件共享')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run the failing SystemGuideSection test**

Run:

```bash
pnpm --filter @lynavo-drive/desktop exec vitest run src/renderer/features/settings/__tests__/SystemGuideSection.test.tsx
```

Expected: fail because Linux-specific guide text does not exist.

- [ ] **Step 7: Add Linux system guide i18n keys**

Add under `settings.systemGuide` in all three settings locale files.

Simplified Chinese:

```json
"linuxTitle": "Linux 文件共享",
"linuxDescription": "在系统中手动配置 Samba 或文件共享后，回到 Vivi Drop 重新检测。"
```

Traditional Chinese:

```json
"linuxTitle": "Linux 檔案共享",
"linuxDescription": "在系統中手動設定 Samba 或檔案共享後，回到 Vivi Drop 重新檢測。"
```

English:

```json
"linuxTitle": "Linux File Sharing",
"linuxDescription": "Configure Samba or file sharing in the system, then return to Vivi Drop and run the check again."
```

- [ ] **Step 8: Implement platform-gated SystemGuideSection**

Update `SystemGuideSection.tsx`:

```ts
  const isMac = window.electronAPI?.platform.isMac?.() ?? true;
  const isWindows = window.electronAPI?.platform.isWindows?.() ?? false;
  const isLinux = window.electronAPI?.platform.isLinux?.() ?? false;
```

Render the Mac card only when `isMac`, the Windows card only when `isWindows`, and add the Linux card:

```tsx
      {isLinux ? (
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-3">
            <p className="text-sm font-medium text-foreground">
              {t('settings.systemGuide.linuxTitle')}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('settings.systemGuide.linuxDescription')}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void window.electronAPI?.files.openFolder(sharedPath)}
            disabled={!sharedPath}
          >
            <FolderOpen className="h-4 w-4" />
            {t('settings.filePath.openShared')}
          </Button>
        </div>
      ) : null}
```

- [ ] **Step 9: Run focused UI tests**

Run:

```bash
pnpm --filter @lynavo-drive/desktop exec vitest run \
  src/renderer/features/settings/__tests__/ShareAddressSection.test.tsx \
  src/renderer/features/settings/__tests__/SystemGuideSection.test.tsx
pnpm --filter @lynavo-drive/desktop typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/src/renderer/features/settings/ShareAddressSection.tsx \
  apps/desktop/src/renderer/features/settings/SystemGuideSection.tsx \
  apps/desktop/src/renderer/features/settings/__tests__/ShareAddressSection.test.tsx \
  apps/desktop/src/renderer/features/settings/__tests__/SystemGuideSection.test.tsx \
  apps/desktop/src/renderer/i18n/locales/en/settings.json \
  apps/desktop/src/renderer/i18n/locales/zh-Hans/settings.json \
  apps/desktop/src/renderer/i18n/locales/zh-Hant/settings.json
git commit -m "fix(desktop): show linux sharing guidance"
```

## Task 3: Linux Sidecar Build Script

**Files:**
- Create: `apps/desktop/scripts/build-sidecar-linux.cjs`
- Create: `apps/desktop/scripts/__tests__/build-sidecar-linux.test.mjs`

- [ ] **Step 1: Write failing script helper tests**

Create `apps/desktop/scripts/__tests__/build-sidecar-linux.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildLinuxSidecarEnv,
  mapElectronArchToGoArch,
  resolveLinuxArch,
} = require('../build-sidecar-linux.cjs');

test('maps Electron Linux package arches to Go arches', () => {
  assert.equal(mapElectronArchToGoArch('x64'), 'amd64');
  assert.equal(mapElectronArchToGoArch('arm64'), 'arm64');
  assert.throws(() => mapElectronArchToGoArch('ia32'), /Unsupported Linux sidecar arch/);
});

test('resolves current process arch into an Electron arch', () => {
  assert.equal(resolveLinuxArch([], 'x64'), 'x64');
  assert.equal(resolveLinuxArch([], 'arm64'), 'arm64');
  assert.equal(resolveLinuxArch(['arm64'], 'x64'), 'arm64');
  assert.equal(resolveLinuxArch(['--arch', 'x64'], 'arm64'), 'x64');
});

test('builds CGO Linux sidecar environment', () => {
  assert.deepEqual(
    {
      GOOS: buildLinuxSidecarEnv('arm64').GOOS,
      GOARCH: buildLinuxSidecarEnv('arm64').GOARCH,
      CGO_ENABLED: buildLinuxSidecarEnv('arm64').CGO_ENABLED,
    },
    {
      GOOS: 'linux',
      GOARCH: 'arm64',
      CGO_ENABLED: '1',
    },
  );
});
```

- [ ] **Step 2: Run the failing helper test**

Run:

```bash
node --test apps/desktop/scripts/__tests__/build-sidecar-linux.test.mjs
```

Expected: fail because `build-sidecar-linux.cjs` does not exist.

- [ ] **Step 3: Implement `build-sidecar-linux.cjs`**

Create `apps/desktop/scripts/build-sidecar-linux.cjs`:

```js
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');

const sidecarRoot = path.resolve(__dirname, '..', '..', '..', 'services', 'sidecar-go');
const outputPath = path.resolve(__dirname, '..', 'resources', 'syncflow-sidecar');

function mapElectronArchToGoArch(arch) {
  if (arch === 'x64') return 'amd64';
  if (arch === 'arm64') return 'arm64';
  throw new Error(`Unsupported Linux sidecar arch "${arch}". Expected x64 or arm64.`);
}

function resolveLinuxArch(args = process.argv.slice(2), processArch = process.arch) {
  const archFlagIndex = args.indexOf('--arch');
  if (archFlagIndex >= 0) {
    const value = args[archFlagIndex + 1];
    if (!value) {
      throw new Error('--arch requires x64 or arm64.');
    }
    mapElectronArchToGoArch(value);
    return value;
  }

  const positional = args.find((arg) => arg === 'x64' || arg === 'arm64');
  if (positional) return positional;

  if (processArch === 'x64' || processArch === 'arm64') return processArch;
  throw new Error(`Unsupported host arch "${processArch}". Expected x64 or arm64.`);
}

function buildLinuxSidecarEnv(arch, baseEnv = process.env) {
  return {
    ...baseEnv,
    GOOS: 'linux',
    GOARCH: mapElectronArchToGoArch(arch),
    CGO_ENABLED: '1',
  };
}

function run() {
  if (process.platform !== 'linux') {
    console.error('build-sidecar-linux.cjs must run on Linux for release builds.');
    process.exit(1);
  }

  let arch;
  try {
    arch = resolveLinuxArch();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const child = spawn(
    'go',
    ['build', '-o', outputPath, './cmd/syncflow-sidecar/'],
    {
      cwd: sidecarRoot,
      env: buildLinuxSidecarEnv(arch),
      stdio: 'inherit',
    },
  );

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    if ((code ?? 0) === 0) {
      fs.chmodSync(outputPath, 0o755);
    }
    process.exit(code ?? 0);
  });

  child.on('error', (error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  buildLinuxSidecarEnv,
  mapElectronArchToGoArch,
  outputPath,
  resolveLinuxArch,
  sidecarRoot,
};

if (require.main === module) {
  run();
}
```

- [ ] **Step 4: Run script helper tests**

Run:

```bash
node --test apps/desktop/scripts/__tests__/build-sidecar-linux.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/scripts/build-sidecar-linux.cjs \
  apps/desktop/scripts/__tests__/build-sidecar-linux.test.mjs
git commit -m "feat(desktop): add linux sidecar build script"
```

## Task 4: Linux Package Wrapper and Scripts

**Files:**
- Create: `apps/desktop/scripts/package-linux.cjs`
- Create: `apps/desktop/scripts/__tests__/package-linux.test.mjs`
- Modify: `apps/desktop/package.json`
- Modify: `package.json`

- [ ] **Step 1: Write failing package helper tests**

Create `apps/desktop/scripts/__tests__/package-linux.test.mjs`:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildPackageLinuxCommands, resolvePackageLinuxOptions } = require('../package-linux.cjs');

test('resolves Linux package defaults from host arch', () => {
  assert.deepEqual(resolvePackageLinuxOptions([], { arch: 'arm64' }), {
    arch: 'arm64',
    builderConfig: null,
  });
});

test('resolves explicit arch and builder config', () => {
  assert.deepEqual(
    resolvePackageLinuxOptions(['--arch', 'x64', '--config', 'electron-builder.global.yml'], {
      arch: 'arm64',
    }),
    {
      arch: 'x64',
      builderConfig: 'electron-builder.global.yml',
    },
  );
});

test('generates workspace, sidecar, and electron-builder commands', () => {
  const commands = buildPackageLinuxCommands({
    arch: 'arm64',
    builderConfig: 'electron-builder.cn.yml',
  });

  assert.deepEqual(
    commands.map((command) => [command.script, command.args]),
    [
      ['run-workspace-pnpm.cjs', ['build']],
      ['build-sidecar-linux.cjs', ['--arch', 'arm64']],
      ['run-electron-builder.cjs', ['--config', 'electron-builder.cn.yml', '--linux', 'deb', '--arm64']],
    ],
  );
});
```

- [ ] **Step 2: Run the failing package helper test**

Run:

```bash
node --test apps/desktop/scripts/__tests__/package-linux.test.mjs
```

Expected: fail because `package-linux.cjs` does not exist.

- [ ] **Step 3: Implement `package-linux.cjs`**

Create `apps/desktop/scripts/package-linux.cjs`:

```js
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { resolveLinuxArch } = require('./build-sidecar-linux.cjs');

const projectRoot = path.resolve(__dirname, '..');

function resolvePackageLinuxOptions(args = process.argv.slice(2), processInfo = process) {
  let builderConfig = null;
  const archArgs = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--config') {
      builderConfig = args[index + 1] || '';
      index += 1;
    } else if (arg.startsWith('--config=')) {
      builderConfig = arg.slice('--config='.length);
    } else {
      archArgs.push(arg);
    }
  }

  if (builderConfig === '') {
    throw new Error('--config requires an electron-builder config filename.');
  }

  return {
    arch: resolveLinuxArch(archArgs, processInfo.arch),
    builderConfig,
  };
}

function buildPackageLinuxCommands({ arch, builderConfig }) {
  const builderArgs = ['run-electron-builder.cjs'];
  if (builderConfig) {
    builderArgs.push('--config', builderConfig);
  }
  builderArgs.push('--linux', 'deb', `--${arch}`);

  return [
    {
      script: 'run-workspace-pnpm.cjs',
      args: ['build'],
    },
    {
      script: 'build-sidecar-linux.cjs',
      args: ['--arch', arch],
    },
    {
      script: 'run-electron-builder.cjs',
      args: builderArgs.slice(1),
    },
  ];
}

function buildRuntimeCommands(options) {
  const script = (name) => path.join(projectRoot, 'scripts', name);
  return buildPackageLinuxCommands(options).map((step) => ({
    command: process.execPath,
    args: [script(step.script), ...step.args],
  }));
}

function run() {
  if (process.platform !== 'linux') {
    console.error('package-linux.cjs must run on Linux for release builds.');
    process.exit(1);
  }

  let options;
  try {
    options = resolvePackageLinuxOptions();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  for (const step of buildRuntimeCommands(options)) {
    const result = spawnSync(step.command, step.args, {
      cwd: projectRoot,
      env: process.env,
      stdio: 'inherit',
    });
    if (result.signal) {
      throw new Error(`Linux package step terminated by signal ${result.signal}.`);
    }
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
}

module.exports = {
  buildPackageLinuxCommands,
  resolvePackageLinuxOptions,
};

if (require.main === module) {
  run();
}
```

- [ ] **Step 4: Add package scripts**

Modify `apps/desktop/package.json` scripts:

```json
"build:sidecar:linux": "node ./scripts/build-sidecar-linux.cjs",
"package:linux": "node ./scripts/package-linux.cjs",
"package:linux:cn": "SYNCFLOW_MARKET=cn node ./scripts/package-linux.cjs --config electron-builder.cn.yml",
"package:linux:global": "SYNCFLOW_MARKET=global node ./scripts/package-linux.cjs --config electron-builder.global.yml"
```

Modify root `package.json` scripts:

```json
"package:desktop:linux": "pnpm --filter @lynavo-drive/desktop package:linux"
```

- [ ] **Step 5: Run package helper tests and JSON validation**

Run:

```bash
node --test apps/desktop/scripts/__tests__/package-linux.test.mjs
node -e "JSON.parse(require('node:fs').readFileSync('package.json','utf8')); JSON.parse(require('node:fs').readFileSync('apps/desktop/package.json','utf8'))"
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/scripts/package-linux.cjs \
  apps/desktop/scripts/__tests__/package-linux.test.mjs \
  apps/desktop/package.json \
  package.json
git commit -m "feat(desktop): add linux package scripts"
```

## Task 5: Electron Builder Linux Debian Configuration

**Files:**
- Modify: `apps/desktop/electron-builder.yml`
- Modify: `apps/desktop/electron-builder.cn.yml`
- Modify: `apps/desktop/electron-builder.global.yml`
- Modify: `scripts/release/__tests__/desktop-branding.test.mjs`

- [ ] **Step 1: Add failing config test**

Add to `scripts/release/__tests__/desktop-branding.test.mjs`:

```js
test('desktop builder configs define Linux deb packaging', () => {
  for (const name of [
    'electron-builder.yml',
    'electron-builder.cn.yml',
    'electron-builder.global.yml',
  ]) {
    const config = readDesktopConfig(name);

    assert.match(config, /^linux:$/m);
    assert.match(config, /^  artifactName: ViviDrop-\$\{version\}-linux-\$\{arch\}\.\$\{ext\}$/m);
    assert.match(config, /^  executableName: Vivi Drop$/m);
    assert.match(config, /^  category: Utility$/m);
    assert.match(config, /^    - target: deb$/m);
    assert.match(config, /^        - x64$/m);
    assert.match(config, /^        - arm64$/m);
    assert.match(config, /from: resources\/syncflow-sidecar/);
    assert.match(config, /to: syncflow-sidecar/);
  }
});
```

- [ ] **Step 2: Run the failing config test**

Run:

```bash
node --test scripts/release/__tests__/desktop-branding.test.mjs
```

Expected: fail because the Linux config blocks do not exist.

- [ ] **Step 3: Add Linux config blocks**

Add this block to all three electron-builder config files after the `win:` block:

```yaml
linux:
  artifactName: ViviDrop-${version}-linux-${arch}.${ext}
  target:
    - target: deb
      arch:
        - x64
        - arm64
  category: Utility
  executableName: Vivi Drop
  icon: resources/icon-1024.png
  extraResources:
    - from: resources/syncflow-sidecar
      to: syncflow-sidecar
```

- [ ] **Step 4: Run config test**

Run:

```bash
node --test scripts/release/__tests__/desktop-branding.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/electron-builder.yml \
  apps/desktop/electron-builder.cn.yml \
  apps/desktop/electron-builder.global.yml \
  scripts/release/__tests__/desktop-branding.test.mjs
git commit -m "feat(desktop): configure linux deb packaging"
```

## Task 6: Release Profile Linux Target

**Files:**
- Modify: `scripts/release/release-profiles.mjs`
- Modify: `scripts/release/__tests__/release-profiles.test.mjs`
- Modify: `scripts/release/__tests__/release-cli.test.mjs`

- [ ] **Step 1: Update failing release profile tests**

In `release-profiles.test.mjs`, change target parsing test:

```js
test('parses targets predictably', () => {
  assert.deepEqual(parseTargets('ios,android,mac,win,linux'), [
    'ios',
    'android',
    'mac',
    'win',
    'linux',
  ]);
  assert.deepEqual(parseTargets(' android , mac , linux '), ['android', 'mac', 'linux']);
  assert.throws(() => parseTargets('freebsd'), /Unsupported release target/);
});
```

Update `builds commands and env from the selected profile` target list to include Linux:

```js
  const plan = buildReleasePlan({
    profileName: 'global-review',
    targets: ['ios', 'android', 'mac', 'win', 'linux'],
  });
```

Add the expected Linux step:

```js
      ['linux', 'pnpm', ['--filter', '@lynavo-drive/desktop', 'package:linux:global']],
```

- [ ] **Step 2: Add dry-run CLI Linux assertions**

In `release-cli.test.mjs`, add to both review plan tests:

```js
  assert.match(result.stdout, /pnpm --filter @syncflow\/desktop package:linux:cn/);
```

and:

```js
  assert.match(result.stdout, /pnpm --filter @syncflow\/desktop package:linux:global/);
```

Update the default helper target list:

```js
function runReleaseDryRun(profile, targets = 'ios,android,win,linux') {
```

- [ ] **Step 3: Run failing release tests**

Run:

```bash
node --test scripts/release/__tests__/release-profiles.test.mjs scripts/release/__tests__/release-cli.test.mjs
```

Expected: fail because Linux is not a supported target.

- [ ] **Step 4: Implement release profile Linux target**

Modify `scripts/release/release-profiles.mjs`:

```js
const TARGETS = new Set(['ios', 'android', 'mac', 'win', 'linux']);
```

Add `desktopLinuxScript` to each profile:

```js
desktopLinuxScript: 'package:linux:cn',
```

or:

```js
desktopLinuxScript: 'package:linux:global',
```

Update the unsupported target error string:

```js
`Unsupported release target "${target}". Supported targets: ios, android, mac, win, linux`
```

Add Linux step before the Windows fallback return:

```js
  if (target === 'linux') {
    return {
      target,
      command: 'pnpm',
      args: ['--filter', '@lynavo-drive/desktop', profile.desktopLinuxScript],
    };
  }
```

- [ ] **Step 5: Run release tests**

Run:

```bash
node --test scripts/release/__tests__/release-profiles.test.mjs scripts/release/__tests__/release-cli.test.mjs
pnpm release --profile global-review --targets linux --dry-run
pnpm release --profile cn-prod --targets linux --dry-run
```

Expected: tests pass; dry-run prints Linux package commands and profile environment.

- [ ] **Step 6: Commit**

```bash
git add scripts/release/release-profiles.mjs \
  scripts/release/__tests__/release-profiles.test.mjs \
  scripts/release/__tests__/release-cli.test.mjs
git commit -m "feat(release): add linux desktop target"
```

## Task 7: Release Documentation and Test Matrix

**Files:**
- Modify: `docs/release/release-playbook.md`
- Modify: `docs/testing/beta-test-matrix.md`

- [ ] **Step 1: Update release playbook commands**

In `docs/release/release-playbook.md`, update target examples from:

```bash
pnpm release --profile cn-prod --targets ios,mac,win
pnpm release --profile global-prod --targets ios,mac,win
pnpm release --profile cn-review --targets ios,mac,win
pnpm release --profile global-review --targets ios,mac,win
```

to:

```bash
pnpm release --profile cn-prod --targets ios,mac,win,linux
pnpm release --profile global-prod --targets ios,mac,win,linux
pnpm release --profile cn-review --targets ios,mac,win,linux
pnpm release --profile global-review --targets ios,mac,win,linux
```

Add a Linux subsection after Windows smoke checks:

```md
### 8.5 Linux

1. 從 `ViviDrop-*-linux-*.deb` fresh install
2. app 正常啟動
3. sidecar 正常監聽 `39393/TCP` 與 `39394/TCP`
4. mDNS / zeroconf 廣播可被真機 mobile 發現
5. 設定頁 Linux 共享提示不顯示 macOS 或 Windows 專屬操作
6. iOS / Android 真機可配對並完成一輪真實素材上傳
7. 重啟 desktop 後 paired state、history、received library 正常保留
```

Add root command:

```bash
pnpm package:desktop:linux
```

- [ ] **Step 2: Update beta test matrix**

Add Linux to the desktop smoke list in `docs/testing/beta-test-matrix.md`:

```md
### 4.6 Linux desktop 冒烟

1. 在 Ubuntu 22.04 arm64 安装 `arm64.deb`
2. 在 Ubuntu 22.04 amd64 安装 `amd64.deb`
3. 启动 app，确认 sidecar health 进入 healthy
4. 确认 `ss -ltnup` 能看到 `39393/TCP`、`39394/TCP`，并允许 `5353/UDP`
5. 设置页显示 Linux 手动共享提示，不显示 Apple Bonjour 安装或 Windows 高级共享按钮
6. iOS 真机发现 Linux desktop、配对并上传一轮素材
7. Android 真机发现 Linux desktop、配对并上传一轮素材
8. 重启 app 后确认历史、received library、paired devices 保持
```

After adding this section, renumber the following local headings so the document remains ordered.

- [ ] **Step 3: Run docs checks**

Run:

```bash
pnpm format:check docs/release/release-playbook.md docs/testing/beta-test-matrix.md
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add docs/release/release-playbook.md docs/testing/beta-test-matrix.md
git commit -m "docs: add linux desktop release checks"
```

## Task 8: Full Automated Verification

**Files:**
- No code changes.

- [ ] **Step 1: Run desktop tests and typecheck**

Run:

```bash
pnpm --filter @lynavo-drive/desktop test
pnpm --filter @lynavo-drive/desktop typecheck
```

Expected: all tests pass and typecheck succeeds.

- [ ] **Step 2: Run release tests**

Run:

```bash
node --test scripts/release/__tests__/*.mjs
node --test apps/desktop/scripts/__tests__/*.mjs
```

Expected: all Node script tests pass.

- [ ] **Step 3: Run sidecar tests**

Run:

```bash
cd services/sidecar-go && go test ./...
```

Expected: all Go tests pass.

- [ ] **Step 4: Run release dry-runs**

Run:

```bash
pnpm release --profile global-review --targets linux --dry-run
pnpm release --profile cn-prod --targets linux --dry-run
```

Expected: dry-run prints `package:linux:global` and `package:linux:cn` with the correct profile environment.

- [ ] **Step 5: Confirm verification leaves the tree clean**

Run:

```bash
git status --short
```

Expected: no output.

## Task 9: Linux VM Build and Install Smoke

**Files:**
- No repo code changes.

- [ ] **Step 1: Build arm64 deb on Ubuntu 22.04 arm64**

Run inside the Ubuntu 22.04 arm64 VM:

```bash
pnpm install
pnpm release --profile global-review --targets linux --dry-run
pnpm release --profile global-review --targets linux
```

Expected: a `ViviDrop-*-linux-arm64.deb` artifact appears under `apps/desktop/release`.

- [ ] **Step 2: Install and launch arm64 deb**

Run inside the Ubuntu 22.04 arm64 VM:

```bash
sudo apt install ./apps/desktop/release/ViviDrop-*-linux-arm64.deb
vivi-drop
```

Expected: the desktop app launches and sidecar reaches healthy.

- [ ] **Step 3: Check Linux sidecar ports and mDNS**

Run inside the VM:

```bash
ss -ltnup | rg '39393|39394|5353'
avahi-browse -rt _syncflow._tcp
```

Expected: TCP ports are listening; `_syncflow._tcp` advertises on the bridged LAN.

- [ ] **Step 4: Build amd64 deb on Ubuntu 22.04 amd64**

Run inside the Ubuntu 22.04 amd64 VM:

```bash
pnpm install
pnpm release --profile global-review --targets linux --dry-run
pnpm release --profile global-review --targets linux
```

Expected: a `ViviDrop-*-linux-x64.deb` artifact appears under `apps/desktop/release`.

- [ ] **Step 5: Install and launch amd64 deb**

Run inside the Ubuntu 22.04 amd64 VM:

```bash
sudo apt install ./apps/desktop/release/ViviDrop-*-linux-*.deb
vivi-drop
```

Expected: the desktop app launches and sidecar reaches healthy.

- [ ] **Step 6: Real-device pairing and upload smoke**

Use one iOS device and one Android device on the same bridged LAN:

```text
1. Launch Linux desktop.
2. Confirm settings shows the Linux machine as online.
3. Pair iOS mobile with the Linux desktop.
4. Upload one photo and one video from iOS.
5. Pair Android mobile with the Linux desktop.
6. Upload one photo and one video from Android.
7. Restart the Linux desktop app.
8. Confirm paired devices, history, received library, and file paths remain available.
```

Expected: pairing and upload complete without queue resets, manual file selection, or protocol changes.
