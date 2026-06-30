import { LYNAVO_API_BASE_URL } from '@lynavo-drive/contracts';
import type { Distribution, ReleaseChannel } from '@lynavo-drive/contracts';

export const PRODUCT_NAME = 'Lynavo Drive';
export const APP_STORAGE_IDENTITY_NAME = 'Vivi Drop';
export const PRODUCT_DISTRIBUTION: Distribution = 'community';

type Env = NodeJS.ProcessEnv;

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return '';
}

function parseReleaseChannel(value: string | undefined): ReleaseChannel | null {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'dev' || normalized === 'review' || normalized === 'prod'
    ? normalized
    : null;
}

function isReviewUrl(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return Boolean(normalized?.includes('review-api') || normalized?.includes('review.'));
}

export function getProductName(): string {
  return PRODUCT_NAME;
}

export function isLynavoGlobalProduct(): boolean {
  return true;
}

export function getProductReleaseChannel(env: Env = process.env): ReleaseChannel {
  return parseReleaseChannel(env.LYNAVO_RELEASE_CHANNEL) ?? 'prod';
}

export function resolveLynavoApiBaseUrl(env: Env = process.env): string {
  return firstNonEmpty(
    env.LYNAVO_API_BASE_URL,
    LYNAVO_API_BASE_URL,
  );
}

export function shouldUseLynavoReviewTarget(env: Env = process.env): boolean {
  const releaseChannel = parseReleaseChannel(env.LYNAVO_RELEASE_CHANNEL);
  if (releaseChannel) {
    return releaseChannel === 'review';
  }

  return isReviewUrl(env.LYNAVO_API_BASE_URL);
}
