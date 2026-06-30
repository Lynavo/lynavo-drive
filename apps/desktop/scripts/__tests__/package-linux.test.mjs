import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
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
const removedBuilderConfigNames = ['cn', 'global'].map((name) => `electron-builder.${name}.yml`);
const removedBuilderConfigPattern = new RegExp('electron-builder\\.(?:cn|global)\\.yml');
const removedPackageScriptPattern = new RegExp(
  `${'pack'}${'age'}:[^"'\\s]*:(?:${['cn', 'global'].join('|')})`,
);
const legacyViviName = ['Vivi', 'Drop'].join(' ');
const legacyViviSlug = ['Vivi', 'Drop'].join('');
const legacySyncFlowName = ['Sync', 'Flow'].join('');
const packageScriptName = (suffix) => `package:${suffix}`;

test('resolves Linux package defaults from host arch', () => {
  assert.deepEqual(resolvePackageLinuxOptions([], { arch: 'arm64' }), {
    arch: 'arm64',
  });
});

test('resolves explicit arch from split flag', () => {
  assert.deepEqual(resolvePackageLinuxOptions(['--arch', 'x64'], { arch: 'arm64' }), {
    arch: 'x64',
  });
});

test('resolves explicit arch from equals flag', () => {
  assert.deepEqual(resolvePackageLinuxOptions(['--arch=x64'], { arch: 'arm64' }), {
    arch: 'x64',
  });
  assert.deepEqual(resolvePackageLinuxOptions(['--arch=arm64'], { arch: 'x64' }), {
    arch: 'arm64',
  });
});

test('resolves positional arch', () => {
  assert.deepEqual(resolvePackageLinuxOptions(['arm64'], { arch: 'x64' }), {
    arch: 'arm64',
  });
});

test('rejects builder config flags and unsupported arches', () => {
  assert.throws(
    () => resolvePackageLinuxOptions(['--config'], { arch: 'x64' }),
    /Linux packaging uses the single electron-builder\.yml config/,
  );
  assert.throws(
    () => resolvePackageLinuxOptions([`--config=${removedBuilderConfigNames[1]}`], { arch: 'x64' }),
    /Linux packaging uses the single electron-builder\.yml config/,
  );
  assert.throws(
    () => resolvePackageLinuxOptions(['arm64', `--config=${removedBuilderConfigNames[0]}`], {
      arch: 'x64',
    }),
    /Linux packaging uses the single electron-builder\.yml config/,
  );
  assert.throws(
    () => resolvePackageLinuxOptions(['ia32'], { arch: 'x64' }),
    /Unsupported Linux sidecar arch/,
  );
  assert.throws(
    () => resolvePackageLinuxOptions(['--arch='], { arch: 'x64' }),
    /--arch requires x64 or arm64/,
  );
  assert.throws(
    () => resolvePackageLinuxOptions(['--arch=ia32'], { arch: 'x64' }),
    /Unsupported Linux sidecar arch/,
  );
});

test('generates workspace, sidecar, and electron-builder commands', () => {
  const commands = buildPackageLinuxCommands({
    arch: 'arm64',
  });

  assert.deepEqual(
    commands.map((command) => [command.script, command.args]),
    [
      ['run-workspace-pnpm.cjs', ['build']],
      ['build-sidecar-linux.cjs', ['--arch', 'arm64']],
      [
        'run-electron-builder.cjs',
        ['--linux', 'deb', '--arm64'],
      ],
    ],
  );
});

test('uses the default electron-builder config for Linux packaging', () => {
  const commands = buildPackageLinuxCommands({
    arch: 'x64',
  });

  assert.deepEqual(commands.at(-1), {
    script: 'run-electron-builder.cjs',
    args: ['--linux', 'deb', '--x64'],
  });
});

test('builds runtime commands with node executable, absolute script paths, and desktop cwd', () => {
  const runtimeCommands = buildRuntimeCommands({
    arch: 'x64',
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

test('desktop packaging keeps a single Lynavo Drive builder config', () => {
  const builderConfigs = readdirSync(desktopRoot)
    .filter((entry) => /^electron-builder(?:\..*)?\.yml$/.test(entry))
    .sort();
  assert.deepEqual(builderConfigs, ['electron-builder.yml']);

  const packageJson = JSON.parse(readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));
  assert.equal(packageJson.productName, 'Lynavo Drive');
  for (const scriptSuffix of ['cn', 'global', 'win:cn', 'win:global', 'linux:cn', 'linux:global']) {
    assert.equal(packageJson.scripts[packageScriptName(scriptSuffix)], undefined);
  }

  const builderConfig = readFileSync(path.join(desktopRoot, 'electron-builder.yml'), 'utf8');
  assert.match(builderConfig, /^productName: Lynavo Drive$/m);
  assert.match(builderConfig, /^  artifactName: LynavoDrive-\$\{version\}-\$\{arch\}\.\$\{ext\}$/m);
  assert.match(builderConfig, /^  artifactName: LynavoDrive-\$\{version\}-linux-\$\{arch\}\.\$\{ext\}$/m);
  assert.match(builderConfig, /^appId: com\.vividrop\.desktop\.china$/m);
  assert.match(builderConfig, /^  executableName: Vivi Drop$/m);
  assert.match(builderConfig, /^  executableName: vivi-drop$/m);
  assert.match(builderConfig, /^  shortcutName: Lynavo Drive$/m);
  assert.match(builderConfig, /lynavo-drive-sidecar/);
  assert.doesNotMatch(builderConfig, new RegExp(legacyViviSlug));
  assert.doesNotMatch(builderConfig, new RegExp(`productName: ${legacyViviName}`));
});

test('desktop packaging scripts do not reference removed market builder configs', () => {
  const filesToCheck = [
    'package.json',
    'scripts/package-linux.cjs',
    'scripts/package-macos-signed.sh',
    'scripts/package-macos-mas.sh',
    'scripts/run-electron-builder.cjs',
  ];

  for (const file of filesToCheck) {
    const content = readFileSync(path.join(desktopRoot, file), 'utf8');
    assert.doesNotMatch(content, removedBuilderConfigPattern, file);
    assert.doesNotMatch(content, removedPackageScriptPattern, file);
  }
});

test('macOS packaging scripts use Lynavo global signing defaults without market branching', () => {
  const scriptNames = [
    'scripts/package-macos-signed.sh',
    'scripts/package-macos-mas.sh',
    'scripts/upload-macos-testflight.sh',
    'scripts/watch-notarization.sh',
  ];

  for (const scriptName of scriptNames) {
    const content = readFileSync(path.join(desktopRoot, scriptName), 'utf8');
    assert.doesNotMatch(content, /SYNCFLOW_MARKET/, scriptName);
    assert.doesNotMatch(content, /DEFAULT_CN_|AuthKey_China|GKN7JQNCMC|HY8CAHGPW9/, scriptName);
    assert.match(content, /AMY9XVV3LD/, scriptName);
    assert.match(content, /8de17ec0-4bff-4ab2-8c01-ace1f9307147/, scriptName);
  }

  const signedScript = readFileSync(
    path.join(desktopRoot, 'scripts/package-macos-signed.sh'),
    'utf8',
  );
  assert.match(signedScript, /DEFAULT_CSC_TEAM_ID="S44ANBLMF9"/);
  assert.match(signedScript, /CSC_TEAM_ID:-\$\{DEFAULT_CSC_TEAM_ID\}/);
});

test('Windows installer keeps existing Vivi Drop firewall rule identities', () => {
  const installer = readFileSync(path.join(desktopRoot, 'resources', 'installer.nsh'), 'utf8');

  assert.match(installer, new RegExp(`!define SF_RULE_TCP\\s+"${legacyViviName} Sidecar TCP"`));
  assert.match(installer, new RegExp(`!define SF_RULE_HTTP\\s+"${legacyViviName} Sidecar HTTP"`));
  assert.match(installer, new RegExp(`!define SF_RULE_MDNS\\s+"${legacyViviName} mDNS UDP"`));
  assert.doesNotMatch(installer, /SF_LEGACY_VIVI_RULE_/);
  assert.match(
    installer,
    new RegExp(`!define SF_LEGACY_SYNCFLOW_RULE_TCP\\s+"${legacySyncFlowName} Sidecar TCP"`),
  );
  assert.doesNotMatch(installer, /delete rule name="\$\{SF_LEGACY_VIVI_RULE_/);
  assert.match(installer, /delete rule name="\$\{SF_LEGACY_SYNCFLOW_RULE_TCP\}"/);
  assert.doesNotMatch(installer, /add rule name="\$\{SF_LEGACY_/);
  assert.match(installer, /description="Vivi Drop sidecar file transfer \(TCP 39393\)"/);
  assert.match(installer, /lynavo-drive-sidecar\.exe/);
  assert.match(installer, /delete rule name="\$\{SF_LEGACY_SYNCFLOW_RULE_HTTP\}"/);
});
