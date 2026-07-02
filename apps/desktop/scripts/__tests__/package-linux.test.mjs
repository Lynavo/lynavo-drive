import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
const legacyFormerFlowName = ['Sync', 'Flow'].join('');
const legacyViviDomain = ['vivi', 'drop'].join('');
const legacyEnvPrefix = ['SYN', 'CFLOW'].join('');
const packageScriptName = (suffix) => `package:${suffix}`;
const token = (parts) => parts.join('');

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
    () =>
      resolvePackageLinuxOptions(['arm64', `--config=${removedBuilderConfigNames[0]}`], {
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
      ['run-electron-builder.cjs', ['--linux', 'deb', '--arm64']],
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
  assert.match(
    builderConfig,
    /^  artifactName: LynavoDrive-\$\{version\}-linux-\$\{arch\}\.\$\{ext\}$/m,
  );
  assert.match(builderConfig, /^appId: com\.lynavo\.drive\.desktop$/m);
  assert.match(builderConfig, /^  executableName: Lynavo Drive$/m);
  assert.match(builderConfig, /^  executableName: lynavo-drive$/m);
  assert.match(builderConfig, /^  shortcutName: Lynavo Drive$/m);
  assert.match(builderConfig, /lynavo-drive-sidecar/);
  assert.doesNotMatch(builderConfig, new RegExp(legacyViviSlug));
  assert.doesNotMatch(builderConfig, new RegExp(`productName: ${legacyViviName}`));
  assert.doesNotMatch(
    builderConfig,
    new RegExp(`^appId: com\\.${legacyViviDomain}\\.desktop\\.china$`, 'm'),
  );
});

test('desktop packaging scripts do not reference removed market builder configs', () => {
  const filesToCheck = [
    'package.json',
    'scripts/package-linux.cjs',
    'scripts/run-electron-builder.cjs',
  ];

  for (const file of filesToCheck) {
    const content = readFileSync(path.join(desktopRoot, file), 'utf8');
    assert.doesNotMatch(content, removedBuilderConfigPattern, file);
    assert.doesNotMatch(content, removedPackageScriptPattern, file);
  }
});

test('desktop OSS package scripts do not ship official Apple signing or upload helpers', () => {
  const removedScripts = [
    'scripts/package-macos-signed.sh',
    'scripts/package-macos-mas.sh',
    token(['scripts/upload-macos-', 'test', 'flight.sh']),
    token(['scripts/watch-', 'not', 'arization.sh']),
    'scripts/mac-sign.cjs',
  ];

  for (const scriptName of removedScripts) {
    assert.equal(existsSync(path.join(desktopRoot, scriptName)), false, scriptName);
  }

  const packageJson = JSON.parse(readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts[token(['package', ':signed'])], undefined);
  assert.equal(packageJson.scripts[token(['package', ':signed:dir'])], undefined);
  assert.equal(packageJson.scripts[token(['package', ':mas'])], undefined);
  assert.equal(packageJson.scripts[token(['upload', ':test', 'flight'])], undefined);

  const builderConfig = readFileSync(path.join(desktopRoot, 'electron-builder.yml'), 'utf8');
  assert.match(
    builderConfig,
    /^files:\n  - out\/\*\*\/\*\n  - node_modules\/\*\*\/\*\n  - package\.json$/m,
  );
  assert.match(builderConfig, /^  identity: null$/m);
  assert.match(builderConfig, /^  forceCodeSigning: false$/m);
  assert.match(builderConfig, /^  verifyUpdateCodeSignature: false$/m);
  assert.match(builderConfig, /^  signExts:\n    - '!\.exe'$/m);
  assert.doesNotMatch(builderConfig, /sign:\s+\.\/scripts\/mac-sign\.cjs/);
  assert.doesNotMatch(builderConfig, /signtoolOptions:/);
  assert.doesNotMatch(builderConfig, /azureSignOptions:/);
  assert.doesNotMatch(builderConfig, /\bmas:/);
  assert.doesNotMatch(builderConfig, /entitlements(?:Inherit)?:/);
  assert.doesNotMatch(builderConfig, /dns-sd\.exe/);
  assert.doesNotMatch(builderConfig, /dnssd\.dll/);
  assert.equal(builderConfig.includes(token(['not', 'arize:'])), false);
});

test('desktop electron-builder wrapper disables local signing auto discovery', () => {
  const wrapper = readFileSync(
    path.join(desktopRoot, 'scripts', 'run-electron-builder.cjs'),
    'utf8',
  );

  assert.match(wrapper, /CSC_IDENTITY_AUTO_DISCOVERY:\s+'false'/);
  assert.match(wrapper, /ELECTRON_BUILDER_DISABLE_BUILD_CACHE:\s+'true'/);
});

test('Windows installer uses Lynavo Drive firewall rule identities', () => {
  const installer = readFileSync(path.join(desktopRoot, 'resources', 'installer.nsh'), 'utf8');

  assert.match(installer, /!define SF_RULE_TCP\s+"Lynavo Drive Sidecar TCP"/);
  assert.match(installer, /!define SF_RULE_HTTP\s+"Lynavo Drive Sidecar HTTP"/);
  assert.match(installer, /!define SF_RULE_MDNS\s+"Lynavo Drive mDNS UDP"/);
  assert.doesNotMatch(installer, /SF_LEGACY_VIVI_RULE_/);
  assert.equal(installer.includes(`SF_LEGACY_${legacyEnvPrefix}_RULE_`), false);
  assert.doesNotMatch(installer, /delete rule name="\$\{SF_LEGACY_/);
  assert.doesNotMatch(installer, /add rule name="\$\{SF_LEGACY_/);
  assert.match(installer, /description="Lynavo Drive sidecar file transfer \(TCP 39393\)"/);
  assert.match(installer, /lynavo-drive-sidecar\.exe/);
  assert.doesNotMatch(installer, new RegExp(`${legacyViviName} Sidecar`));
  assert.doesNotMatch(installer, new RegExp(`${legacyFormerFlowName} Sidecar`));
});
