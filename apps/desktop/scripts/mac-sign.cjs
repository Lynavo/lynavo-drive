const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function buildCodesignArgs(identity, target, signOptions = {}, extraArgs = []) {
  const args = ['--force', '--sign', identity];

  if (signOptions.timestamp === false) {
    args.push('--timestamp=none');
  } else if (typeof signOptions.timestamp === 'string' && signOptions.timestamp.length > 0) {
    args.push(`--timestamp=${signOptions.timestamp}`);
  } else {
    args.push('--timestamp');
  }

  if (signOptions.hardenedRuntime) {
    args.push('--options', 'runtime');
  }

  if (signOptions.entitlements) {
    args.push('--entitlements', signOptions.entitlements);
  }

  if (signOptions.requirements) {
    args.push('--requirements', signOptions.requirements);
  }

  if (Array.isArray(signOptions.additionalArguments) && signOptions.additionalArguments.length > 0) {
    args.push(...signOptions.additionalArguments);
  }

  if (extraArgs.length > 0) {
    args.push(...extraArgs);
  }

  args.push(target);
  return args;
}

async function runCodesign(identity, target, signOptions, extraArgs = []) {
  const args = buildCodesignArgs(identity, target, signOptions, extraArgs);
  const attempts = signOptions.timestamp === false ? 1 : 4;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await execFileAsync('codesign', args, { maxBuffer: 10 * 1024 * 1024 });
      return;
    } catch (error) {
      const stderr = `${error.stderr || ''}`;
      const shouldRetry =
        attempt < attempts &&
        stderr.includes('The timestamp service is not available.');

      if (!shouldRetry) {
        throw error;
      }

      const backoffMs = attempt * 5000;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function listImmediateChildren(dir, suffix) {
  if (!(await pathExists(dir))) {
    return [];
  }

  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.name.endsWith(suffix))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

async function collectExecutableFiles(dir, files = []) {
  if (!(await pathExists(dir))) {
    return files;
  }

  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      await collectExecutableFiles(fullPath, files);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (entry.name.endsWith('.dylib')) {
      files.push(fullPath);
      continue;
    }

    const stat = await fs.stat(fullPath);
    if ((stat.mode & 0o111) !== 0) {
      files.push(fullPath);
    }
  }

  return files;
}

async function signTarget(opts, target, extraArgs = []) {
  const signOptions = opts.optionsForFile ? opts.optionsForFile(target) : {};

  // For MAS: Ensure helpers and nested executables have at least the inherit entitlements (which includes sandbox)
  if (!signOptions.entitlements && target !== opts.app) {
    if (target.includes('LoginItems') && target.endsWith('.app')) {
      signOptions.entitlements = path.join(__dirname, '..', 'resources', 'entitlements.mas.login-helper.plist');
      console.log(`[Sign] Applied specialized LoginHelper entitlements for: ${path.relative(opts.app, target)}`);
    } else {
      const defaultInherit = path.join(__dirname, '..', 'resources', 'entitlements.mas.inherit.plist');
      signOptions.entitlements = opts.entitlementsInherit || defaultInherit;
      console.log(`[Sign] Applied fallback inherit entitlements for: ${path.relative(opts.app, target)}`);
    }
  }

  console.log(`[Sign] ${path.relative(opts.app, target) || 'Main App'} with entitlements: ${signOptions.entitlements || 'NONE'}`);
  await runCodesign(opts.identity, target, signOptions, extraArgs);
}

module.exports = async function sign(opts) {
  if (!opts.identity || opts.identity === '-') {
    return;
  }

  // For MAS: Ensure the provisioning profile is embedded in the bundle
  if (opts.provisioningProfile) {
    const dest = path.join(opts.app, 'Contents', 'embedded.provisionprofile');
    try {
      await fs.copyFile(opts.provisioningProfile, dest);
      console.log(`[Sign] Embedded provisioning profile: ${opts.provisioningProfile} -> ${dest}`);
    } catch (err) {
      console.error(`[Sign] Failed to embed provisioning profile: ${err.message}`);
    }
  }

  const frameworksDir = path.join(opts.app, 'Contents', 'Frameworks');
  const loginItemsDir = path.join(opts.app, 'Contents', 'Library', 'LoginItems');
  const helpersDir = path.join(opts.app, 'Contents', 'Helpers');

  const helperApps = [
    ...(await listImmediateChildren(frameworksDir, '.app')),
    ...(await listImmediateChildren(loginItemsDir, '.app')),
    ...(await listImmediateChildren(helpersDir, '.app')),
  ];

  const frameworks = await listImmediateChildren(frameworksDir, '.framework');

  const nestedExecutables = [
    ...(await collectExecutableFiles(frameworksDir)),
    ...(await collectExecutableFiles(loginItemsDir)),
    ...(await collectExecutableFiles(helpersDir)),
  ];

  const binaries = Array.isArray(opts.binaries) ? opts.binaries : [];
  for (const binary of binaries) {
    await signTarget(opts, binary);
  }

  for (const executable of nestedExecutables) {
    if (binaries.includes(executable)) {
      continue;
    }
    await signTarget(opts, executable);
  }

  for (const helperApp of helperApps) {
    await signTarget(opts, helperApp);
  }

  for (const framework of frameworks) {
    await signTarget(opts, framework);
  }

  await signTarget(opts, opts.app);
};
