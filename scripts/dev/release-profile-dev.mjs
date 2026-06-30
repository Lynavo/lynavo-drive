import { createRequire } from 'node:module';
import { buildReleasePlan } from '../release/release-profiles.mjs';

const require = createRequire(import.meta.url);
const { buildOssChildEnv } = require('./oss-env-scrubber.cjs');

const DEV_TARGETS = new Set([
  'desktop',
  'mobile-metro',
  'mobile-ios',
  'mobile-ios-device',
  'mobile-android',
]);
const NATIVE_IOS_SCHEME = 'SyncFlowMobile';
const NATIVE_IOS_MODE = 'Debug';

export function buildDevRunPlan({ profileName, target, extraArgs = [] }) {
  if (!DEV_TARGETS.has(target)) {
    throw new Error(
      `Unsupported dev target "${target}". Supported targets: ${[...DEV_TARGETS].join(', ')}`,
    );
  }

  const releaseTarget =
    target === 'mobile-android' ? 'android' : target.startsWith('mobile-') ? 'ios' : 'mac';
  const releasePlan = buildReleasePlan({
    profileName,
    targets: [releaseTarget],
  });
  const targetCommand = buildTargetCommand(target);
  const env = {
    ...releasePlan.env,
    ...buildTargetEnv(target),
  };

  return {
    profile: releasePlan.profile,
    target,
    env,
    command: targetCommand.command,
    args: [...targetCommand.args, ...extraArgs],
    writeMobileReleaseProfile: target.startsWith('mobile-'),
    mobileReleaseProfileSource: releasePlan.mobileReleaseProfileSource,
  };
}

export function buildSourceDefaultMobileReleaseProfileSource() {
  return `export const mobileReleaseProfile = {
  name: 'source-default',
  channel: 'dev',
  review: false,
  apiBaseUrl: '',
} as const;

export const releaseApiBaseUrl = mobileReleaseProfile.apiBaseUrl.trim() || null;
`;
}

export function buildDevChildEnv(parentEnv, profileEnv) {
  return buildOssChildEnv(parentEnv, profileEnv);
}

function buildTargetCommand(target) {
  if (target === 'desktop') {
    return {
      command: 'pnpm',
      args: ['--filter', '@syncflow/desktop', 'dev'],
    };
  }

  if (target === 'mobile-metro') {
    return {
      command: 'pnpm',
      args: ['--filter', '@syncflow/mobile', 'start'],
    };
  }

  if (target === 'mobile-ios') {
    return {
      command: 'corepack',
      args: [
        'pnpm',
        '--filter',
        '@syncflow/mobile',
        'exec',
        'react-native',
        'run-ios',
        '--scheme',
        NATIVE_IOS_SCHEME,
        '--mode',
        NATIVE_IOS_MODE,
      ],
    };
  }

  if (target === 'mobile-ios-device') {
    return {
      command: 'bash',
      args: ['scripts/dev/run-mobile-ios-device.sh'],
    };
  }

  return {
    command: 'bash',
    args: ['scripts/dev/run-mobile-android-device.sh'],
  };
}

function buildTargetEnv(target) {
  return {};
}
