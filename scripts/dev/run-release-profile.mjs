#!/usr/bin/env node

import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildDevChildEnv,
  buildDevRunPlan,
  buildSourceDefaultMobileReleaseProfileSource,
} from './release-profile-dev.mjs';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const mobileReleaseProfilePath = resolve(repoRoot, 'apps/mobile/src/release-profile.ts');

main();

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));

    if (options.resetMobileProfile) {
      writeMobileReleaseProfile(buildSourceDefaultMobileReleaseProfileSource());
      console.log(`Reset mobile release profile: ${mobileReleaseProfilePath}`);
      return;
    }

    const plan = buildDevRunPlan({
      profileName: options.profile,
      target: options.target,
      extraArgs: options.extraArgs,
    });

    printPlan(plan, options);

    if (plan.writeMobileReleaseProfile && !options.dryRun) {
      writeMobileReleaseProfile(plan.mobileReleaseProfileSource);
    }

    if (options.dryRun || options.setMobileProfileOnly) return;

    const result = spawnSync(plan.command, plan.args, {
      cwd: repoRoot,
      env: buildDevChildEnv(process.env, plan.env),
      stdio: 'inherit',
    });

    if (result.signal) {
      throw new Error(`[dev-profile] ${plan.target} terminated by signal ${result.signal}.`);
    }
    process.exit(result.status ?? 0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function parseArgs(args) {
  const options = {
    profile: '',
    target: 'desktop',
    dryRun: false,
    resetMobileProfile: false,
    setMobileProfileOnly: false,
    extraArgs: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') {
      options.extraArgs = args.slice(index + 1);
      break;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--reset-mobile-profile') {
      options.resetMobileProfile = true;
    } else if (arg === '--set-mobile-profile-only') {
      options.setMobileProfileOnly = true;
    } else if (arg === '--profile') {
      options.profile = args[++index] || '';
    } else if (arg.startsWith('--profile=')) {
      options.profile = arg.slice('--profile='.length);
    } else if (arg === '--target') {
      options.target = args[++index] || '';
    } else if (arg.startsWith('--target=')) {
      options.target = arg.slice('--target='.length);
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument "${arg}".`);
    }
  }

  if (!options.resetMobileProfile && !options.profile) {
    throw new Error('--profile is required.');
  }

  return options;
}

function printUsage() {
  console.log(`Usage:
  node scripts/dev/run-release-profile.mjs --profile <profile> --target <target> [--dry-run] [-- extra args]
  node scripts/dev/run-release-profile.mjs --reset-mobile-profile

Targets:
  desktop
  mobile-metro
  mobile-ios
  mobile-ios-device
  mobile-android
`);
}

function printPlan(plan, options) {
  console.log(`Profile:  ${plan.profile.name}`);
  console.log(`Channel:  ${plan.profile.channel}`);
  console.log(`Review:   ${plan.profile.review ? 'yes' : 'no'}`);
  console.log(`Target:   ${plan.target}`);
  console.log(
    `Mode:     ${options.dryRun ? 'DRY RUN' : options.setMobileProfileOnly ? 'set mobile profile only' : 'run'}`,
  );
  console.log('');
  console.log('Environment:');
  for (const key of Object.keys(plan.env).sort()) {
    console.log(`  - ${key}=${plan.env[key]}`);
  }
  console.log('');
  if (plan.writeMobileReleaseProfile) {
    console.log(`Mobile profile: ${mobileReleaseProfilePath}`);
  }
  console.log(`Command: ${plan.command} ${plan.args.join(' ')}`);
}

function writeMobileReleaseProfile(source) {
  writeFileSync(mobileReleaseProfilePath, source);
}
