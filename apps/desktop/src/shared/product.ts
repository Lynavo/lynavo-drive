import type { ReleaseChannel } from '@lynavo-drive/contracts';

export const PRODUCT_NAME = 'LynavoDriveDemo';
export const APP_STORAGE_IDENTITY_NAME = 'Lynavo Drive';

type Env = NodeJS.ProcessEnv;

function parseReleaseChannel(value: string | undefined): ReleaseChannel | null {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'dev' || normalized === 'review' || normalized === 'prod'
    ? normalized
    : null;
}

export function getProductName(): string {
  return PRODUCT_NAME;
}

export function getProductReleaseChannel(env: Env = process.env): ReleaseChannel {
  return parseReleaseChannel(env.LYNAVO_RELEASE_CHANNEL) ?? 'prod';
}
