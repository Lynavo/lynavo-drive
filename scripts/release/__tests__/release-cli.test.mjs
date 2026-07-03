import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const token = (parts) => parts.join('');
const desktopUpdateEnv = token(['LYNAVO_DESKTOP', '_UPDATE_URL']);
const diagnosticsUploadEnv = token(['LYNAVO_DIAGNOSTICS', '_UPLOAD_URL']);
const unsupportedReleaseCommandPattern = new RegExp(
  [
    token(['Test', 'Flight']),
    token(['archive', '-upload']),
    token(['package:desktop', ':signed']),
  ].join('|'),
);

function runReleaseDryRun(profile, targets = 'ios,android,win,linux') {
  return spawnSync(
    process.execPath,
    ['scripts/release/release.mjs', '--profile', profile, '--targets', targets, '--dry-run'],
    {
      cwd: new URL('../../..', import.meta.url),
      encoding: 'utf8',
    },
  );
}

function runReleaseHelp() {
  return spawnSync(process.execPath, ['scripts/release/release.mjs', '--help'], {
    cwd: new URL('../../..', import.meta.url),
    encoding: 'utf8',
  });
}

test('prints linux in release target help', () => {
  const result = runReleaseHelp();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--targets ios,android,mac,win,linux/);
});

test('prints the review release plan without running build commands in dry-run mode', () => {
  const result = runReleaseDryRun('review');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Profile:\s+review/);
  assert.match(result.stdout, /Channel:\s+review/);
  assert.match(result.stdout, /DRY RUN/);
  assert.match(result.stdout, /LYNAVO_RELEASE_CHANNEL=review/);
  assert.doesNotMatch(result.stdout, /Support API URL:/);
  assert.doesNotMatch(result.stdout, /LYNAVO_SUPPORT_API_BASE_URL=/);
  assert.equal(result.stdout.includes(`${desktopUpdateEnv}=`), false);
  assert.equal(result.stdout.includes(`${diagnosticsUploadEnv}=`), false);
  assert.doesNotMatch(result.stdout, /LYNAVO_API_BASE_URL=/);
  assert.doesNotMatch(result.stdout, /LYNAVO_CLIENT_CONFIG_BASE_URL=/);
  assert.doesNotMatch(result.stdout, /LYNAVO_GIFTCARD_REDEEM_BASE_URL=/);
  assert.doesNotMatch(result.stdout, unsupportedReleaseCommandPattern);
  assert.match(result.stdout, /ELECTRON_BUILDER_CONFIG=electron-builder\.yml/);
  assert.match(result.stdout, /pnpm --filter @lynavo-drive\/mobile build:ios:release/);
  assert.match(
    result.stdout,
    /bash -lc cd apps\/mobile\/android && \.\/gradlew assembleRelease bundleRelease -PreactNativeArchitectures=arm64-v8a,x86_64/,
  );
  assert.match(result.stdout, /pnpm --filter @lynavo-drive\/desktop package:win/);
  assert.match(result.stdout, /pnpm --filter @lynavo-drive\/desktop package:linux/);
});

test('prints the prod release plan without external API env in dry-run mode', () => {
  const result = runReleaseDryRun('prod', 'mac,win,linux');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Profile:\s+prod/);
  assert.match(result.stdout, /Channel:\s+prod/);
  assert.match(result.stdout, /DRY RUN/);
  assert.match(result.stdout, /LYNAVO_RELEASE_CHANNEL=prod/);
  assert.doesNotMatch(result.stdout, /Support API URL:/);
  assert.doesNotMatch(result.stdout, /LYNAVO_SUPPORT_API_BASE_URL=/);
  assert.equal(result.stdout.includes(`${desktopUpdateEnv}=`), false);
  assert.equal(result.stdout.includes(`${diagnosticsUploadEnv}=`), false);
  assert.doesNotMatch(result.stdout, /LYNAVO_API_BASE_URL=/);
  assert.doesNotMatch(result.stdout, unsupportedReleaseCommandPattern);
  assert.match(result.stdout, /ELECTRON_BUILDER_CONFIG=electron-builder\.yml/);
  assert.match(result.stdout, /pnpm package:desktop/);
  assert.match(result.stdout, /pnpm --filter @lynavo-drive\/desktop package:win/);
  assert.match(result.stdout, /pnpm --filter @lynavo-drive\/desktop package:linux/);
});

test('release execution removes external sensitive env before spawning children', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'lynavo-release-env-'));
  const capturePath = join(tempDir, 'child-env.json');
  const fakePnpmPath = join(tempDir, 'pnpm');
  writeFileSync(
    fakePnpmPath,
    [
      '#!/usr/bin/env node',
      "require('node:fs').writeFileSync(process.env.CAPTURE_ENV_PATH, JSON.stringify(process.env, null, 2));",
    ].join('\n'),
  );
  chmodSync(fakePnpmPath, 0o755);

  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/release/release.mjs', '--profile', 'review', '--targets', 'mac'],
      {
        cwd: new URL('../../..', import.meta.url),
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${tempDir}:${process.env.PATH ?? ''}`,
          CAPTURE_ENV_PATH: capturePath,
          LYNAVO_API_BASE_URL: 'https://external-api.example',
          LYNAVO_CLIENT_CONFIG_BASE_URL: 'https://external-config.example',
          LYNAVO_GIFTCARD_REDEEM_BASE_URL: 'https://gift.example',
          LYNAVO_ANDROID_APP_ID: 'com.example.mobile',
          LYNAVO_GOOGLE_CLIENT_CONFIG_FILE: '/secure/google-client.json',
          GOOGLE_CLIENT_ID: 'google-client-id',
          APPLE_OAUTH_CLIENT_ID: 'com.example.signin',
          APPLE_ID: 'maintainer@example.com',
          APPLE_APP_SPECIFIC_PASSWORD: 'app-password',
          APPLE_TEAM_ID: 'TEAMID1234',
          CSC_LINK: '/secure/cert.p12',
          CSC_KEY_PASSWORD: 'cert-password',
          ELECTRON_BUILDER_PUBLISH: 'always',
          GH_TOKEN: 'github-token',
          GITHUB_TOKEN: 'github-token',
          WIN_CSC_LINK: '/secure/win-cert.p12',
        },
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const childEnv = JSON.parse(readFileSync(capturePath, 'utf8'));

    assert.equal(childEnv.LYNAVO_RELEASE_CHANNEL, 'review');
    assert.equal(Object.hasOwn(childEnv, 'LYNAVO_SUPPORT_API_BASE_URL'), false);
    assert.equal(Object.hasOwn(childEnv, desktopUpdateEnv), false);
    assert.equal(Object.hasOwn(childEnv, diagnosticsUploadEnv), false);
    assert.equal(Object.hasOwn(childEnv, 'LYNAVO_API_BASE_URL'), false);
    assert.equal(childEnv.ELECTRON_BUILDER_CONFIG, 'electron-builder.yml');
    assert.equal(Object.hasOwn(childEnv, 'LYNAVO_CLIENT_CONFIG_BASE_URL'), false);
    assert.equal(Object.hasOwn(childEnv, 'LYNAVO_GIFTCARD_REDEEM_BASE_URL'), false);
    assert.equal(Object.hasOwn(childEnv, 'LYNAVO_ANDROID_APP_ID'), false);
    assert.equal(Object.hasOwn(childEnv, 'LYNAVO_GOOGLE_CLIENT_CONFIG_FILE'), false);
    assert.equal(Object.hasOwn(childEnv, 'GOOGLE_CLIENT_ID'), false);
    assert.equal(Object.hasOwn(childEnv, 'APPLE_OAUTH_CLIENT_ID'), false);
    assert.equal(Object.hasOwn(childEnv, 'APPLE_ID'), false);
    assert.equal(Object.hasOwn(childEnv, 'APPLE_APP_SPECIFIC_PASSWORD'), false);
    assert.equal(Object.hasOwn(childEnv, 'APPLE_TEAM_ID'), false);
    assert.equal(Object.hasOwn(childEnv, 'CSC_LINK'), false);
    assert.equal(Object.hasOwn(childEnv, 'CSC_KEY_PASSWORD'), false);
    assert.equal(Object.hasOwn(childEnv, 'ELECTRON_BUILDER_PUBLISH'), false);
    assert.equal(Object.hasOwn(childEnv, 'GH_TOKEN'), false);
    assert.equal(Object.hasOwn(childEnv, 'GITHUB_TOKEN'), false);
    assert.equal(Object.hasOwn(childEnv, 'WIN_CSC_LINK'), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('rejects missing profile', () => {
  const result = spawnSync(process.execPath, ['scripts/release/release.mjs', '--dry-run'], {
    cwd: new URL('../../..', import.meta.url),
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--profile is required/);
});
