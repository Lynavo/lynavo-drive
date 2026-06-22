import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildPackageLinuxCommands,
  buildRuntimeCommands,
  resolvePackageLinuxOptions,
} = require('../package-linux.cjs');

const desktopRoot = path.resolve(import.meta.dirname, '..', '..');
const scriptsRoot = path.join(desktopRoot, 'scripts');

test('resolves Linux package defaults from host arch', () => {
  assert.deepEqual(resolvePackageLinuxOptions([], { arch: 'arm64' }), {
    arch: 'arm64',
    builderConfig: null,
  });
});

test('resolves explicit arch and builder config from split flags', () => {
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

test('resolves positional arch and builder config from equals flag', () => {
  assert.deepEqual(
    resolvePackageLinuxOptions(['arm64', '--config=electron-builder.cn.yml'], {
      arch: 'x64',
    }),
    {
      arch: 'arm64',
      builderConfig: 'electron-builder.cn.yml',
    },
  );
});

test('rejects missing builder config values and unsupported arches', () => {
  assert.throws(
    () => resolvePackageLinuxOptions(['--config'], { arch: 'x64' }),
    /--config requires an electron-builder config filename/,
  );
  assert.throws(
    () => resolvePackageLinuxOptions(['--config='], { arch: 'x64' }),
    /--config requires an electron-builder config filename/,
  );
  assert.throws(
    () => resolvePackageLinuxOptions(['--config', '--arch', 'x64'], { arch: 'x64' }),
    /--config requires an electron-builder config filename/,
  );
  assert.throws(
    () => resolvePackageLinuxOptions(['ia32'], { arch: 'x64' }),
    /Unsupported Linux sidecar arch/,
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
      [
        'run-electron-builder.cjs',
        ['--config', 'electron-builder.cn.yml', '--linux', 'deb', '--arm64'],
      ],
    ],
  );
});

test('omits electron-builder config when none is provided', () => {
  const commands = buildPackageLinuxCommands({
    arch: 'x64',
    builderConfig: null,
  });

  assert.deepEqual(commands.at(-1), {
    script: 'run-electron-builder.cjs',
    args: ['--linux', 'deb', '--x64'],
  });
});

test('builds runtime commands with node executable, absolute script paths, and desktop cwd', () => {
  const runtimeCommands = buildRuntimeCommands({
    arch: 'x64',
    builderConfig: 'electron-builder.global.yml',
  });

  assert.deepEqual(
    runtimeCommands.map((step) => ({
      command: step.command,
      scriptPath: step.args[0],
      options: step.options,
    })),
    [
      {
        command: process.execPath,
        scriptPath: path.join(scriptsRoot, 'run-workspace-pnpm.cjs'),
        options: {
          cwd: desktopRoot,
          env: process.env,
          stdio: 'inherit',
        },
      },
      {
        command: process.execPath,
        scriptPath: path.join(scriptsRoot, 'build-sidecar-linux.cjs'),
        options: {
          cwd: desktopRoot,
          env: process.env,
          stdio: 'inherit',
        },
      },
      {
        command: process.execPath,
        scriptPath: path.join(scriptsRoot, 'run-electron-builder.cjs'),
        options: {
          cwd: desktopRoot,
          env: process.env,
          stdio: 'inherit',
        },
      },
    ],
  );

  for (const step of runtimeCommands) {
    assert.ok(path.isAbsolute(step.args[0]));
    assert.ok(step.args[0].startsWith(scriptsRoot));
  }
});
