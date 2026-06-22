#!/usr/bin/env node

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildReleasePlan, listReleaseProfileNames, parseTargets } from './release-profiles.mjs';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const mobileReleaseProfilePath = resolve(repoRoot, 'apps/mobile/src/release-profile.ts');

main();

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const targets = parseTargets(options.targets);
    const plan = buildReleasePlan({ profileName: options.profile, targets });

    printPlan(plan, options.dryRun);

    if (options.dryRun) return;

    const restoreMobileProfile = targets.some((target) => target === 'ios' || target === 'android')
      ? writeTemporaryMobileReleaseProfile(plan.mobileReleaseProfileSource)
      : () => {};

    try {
      for (const step of plan.steps) {
        runStep(step, plan.env);
      }
    } finally {
      restoreMobileProfile();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function parseArgs(args) {
  const options = {
    profile: '',
    targets: 'ios,mac,win',
    dryRun: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--profile') {
      options.profile = args[++index] || '';
    } else if (arg.startsWith('--profile=')) {
      options.profile = arg.slice('--profile='.length);
    } else if (arg === '--targets') {
      options.targets = args[++index] || '';
    } else if (arg.startsWith('--targets=')) {
      options.targets = arg.slice('--targets='.length);
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument "${arg}".`);
    }
  }

  if (!options.profile) {
    throw new Error('--profile is required.');
  }

  return options;
}

function printUsage() {
  console.log(`Usage:
  pnpm release --profile <profile> [--targets ios,android,mac,win,linux] [--dry-run]

Profiles:
  ${listReleaseProfileNames().join('\n  ')}
`);
}

function printPlan(plan, dryRun) {
  console.log(`Profile:  ${plan.profile.name}`);
  console.log(`Market:   ${plan.profile.market}`);
  console.log(`Review:   ${plan.profile.review ? 'yes' : 'no'}`);
  console.log(`Base URL: ${plan.profile.apiBaseUrl}`);
  console.log(`Targets:  ${plan.steps.map((step) => step.target).join(', ')}`);
  console.log(`Mode:     ${dryRun ? 'DRY RUN' : 'execute'}`);
  console.log('');
  console.log('Environment:');
  for (const key of Object.keys(plan.env).sort()) {
    console.log(`  - ${key}=${plan.env[key]}`);
  }
  console.log('');
  console.log('Commands:');
  for (const step of plan.steps) {
    console.log(`  - ${step.command} ${step.args.join(' ')}`);
  }
}

function writeTemporaryMobileReleaseProfile(source) {
  const hadOriginal = existsSync(mobileReleaseProfilePath);
  const original = hadOriginal ? readFileSync(mobileReleaseProfilePath, 'utf8') : '';
  writeFileSync(mobileReleaseProfilePath, source);

  return () => {
    if (hadOriginal) {
      writeFileSync(mobileReleaseProfilePath, original);
    } else if (existsSync(mobileReleaseProfilePath)) {
      unlinkSync(mobileReleaseProfilePath);
    }
  };
}

function runStep(step, profileEnv) {
  console.log('');
  console.log(`[release] ${step.target}: ${step.command} ${step.args.join(' ')}`);

  const result = spawnSync(step.command, step.args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...profileEnv,
    },
    stdio: 'inherit',
  });

  if (result.signal) {
    throw new Error(`[release] ${step.target} terminated by signal ${result.signal}.`);
  }
  if (result.status !== 0) {
    throw new Error(`[release] ${step.target} failed with exit code ${result.status}.`);
  }
}
