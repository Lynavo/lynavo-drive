import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules } from 'react-native';
import type { AutoUploadState, UploadTaskSource } from '@syncflow/contracts';

export interface AutoUploadRoundOverview {
  uploadState: string;
  completedCount: number;
  totalCount: number;
  roundBaselineCompletedCount?: number;
  currentTaskSource?: UploadTaskSource | null;
  autoPending?: number;
  autoUploadState?: AutoUploadState | null;
}

interface AutoUploadRoundSnapshot {
  overview: AutoUploadRoundOverview;
  completedThisRound: number;
}

interface AutoUploadSessionBaseline {
  baselineTransferredCount: number;
  startedAt: string;
}

const AUTO_UPLOAD_ROUND_STATES = new Set([
  'discovering',
  'reconciling',
  'scanning',
  'preparing',
  'uploading',
  'cloud_downloading',
  'reconnecting',
  'backoff_waiting',
  'completed',
]);

const AUTO_UPLOAD_SESSION_STORAGE_KEY = '@vividrop/auto-upload-session/v1';

let cachedSnapshot: AutoUploadRoundSnapshot | null = null;
let cachedSessionBaseline: AutoUploadSessionBaseline | null | undefined;

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

export function buildAutoUploadRoundOverview(
  payload: Record<string, unknown> | null | undefined,
  previous: AutoUploadRoundOverview | null,
): AutoUploadRoundOverview | null {
  if (!payload) return previous;

  const hasRoundBaseline = Object.prototype.hasOwnProperty.call(
    payload,
    'roundBaselineCompletedCount',
  );
  const hasCurrentTaskSource = Object.prototype.hasOwnProperty.call(
    payload,
    'currentTaskSource',
  );
  const hasAutoUploadState = Object.prototype.hasOwnProperty.call(
    payload,
    'autoUploadState',
  );

  const currentTaskSource =
    payload.currentTaskSource === 'auto' ||
    payload.currentTaskSource === 'manual'
      ? payload.currentTaskSource
      : hasCurrentTaskSource
        ? null
        : previous?.currentTaskSource;
  const autoUploadState =
    payload.autoUploadState === 'active' ||
    payload.autoUploadState === 'disabled' ||
    payload.autoUploadState === 'interrupted'
      ? payload.autoUploadState
      : hasAutoUploadState
        ? null
        : previous?.autoUploadState;

  return {
    uploadState:
      typeof payload.uploadState === 'string'
        ? payload.uploadState
        : (previous?.uploadState ?? 'idle'),
    completedCount:
      readNumber(payload.completedCount) ?? previous?.completedCount ?? 0,
    totalCount:
      readNumber(payload.totalCount) ??
      readNumber(payload.queueTotalCount) ??
      previous?.totalCount ??
      0,
    roundBaselineCompletedCount: hasRoundBaseline
      ? readNumber(payload.roundBaselineCompletedCount)
      : previous?.roundBaselineCompletedCount,
    currentTaskSource,
    autoPending: readNumber(payload.autoPending) ?? previous?.autoPending,
    autoUploadState,
  };
}

function getCompletedThisRound(
  overview: AutoUploadRoundOverview,
): number | null {
  if (
    overview.autoUploadState !== undefined &&
    overview.autoUploadState !== null &&
    overview.autoUploadState !== 'active'
  ) {
    return null;
  }
  if (overview.currentTaskSource === 'manual') return null;
  if (!AUTO_UPLOAD_ROUND_STATES.has(overview.uploadState)) return null;
  if (overview.totalCount <= 0 && overview.completedCount <= 0) return null;

  const baseline = overview.roundBaselineCompletedCount ?? 0;
  return Math.max(0, overview.completedCount - baseline);
}

export function getAutoUploadRoundCompletedCount(
  overview: AutoUploadRoundOverview | null,
  isAutoUploadActive: boolean,
): number | null {
  if (!isAutoUploadActive) return null;
  if (overview) {
    const completedThisRound = getCompletedThisRound(overview);
    if (completedThisRound !== null) {
      return completedThisRound;
    }
  }

  return cachedSnapshot?.completedThisRound ?? null;
}

export function rememberAutoUploadRoundProgress(
  overview: AutoUploadRoundOverview | null,
): void {
  if (!overview) return;

  const completedThisRound = getCompletedThisRound(overview);
  if (completedThisRound === null) {
    if (
      overview.autoUploadState !== undefined &&
      overview.autoUploadState !== 'active'
    ) {
      cachedSnapshot = null;
    }
    return;
  }

  cachedSnapshot = {
    overview,
    completedThisRound,
  };
  rememberAutoUploadSessionBaselineFromRound(overview, completedThisRound);
}

export function getRememberedAutoUploadRoundProgress(): AutoUploadRoundOverview | null {
  return cachedSnapshot?.overview ?? null;
}

export function clearRememberedAutoUploadRoundProgressForTest(): void {
  cachedSnapshot = null;
}

async function getTransferredAlbumCount(): Promise<number> {
  const stats = await NativeModules.NativeSyncEngine?.getAlbumStats?.();
  const transferredCount =
    typeof stats?.transferredCount === 'number' &&
    Number.isFinite(stats.transferredCount)
      ? stats.transferredCount
      : 0;
  return Math.max(0, transferredCount);
}

async function readAutoUploadSessionBaseline(): Promise<AutoUploadSessionBaseline | null> {
  if (cachedSessionBaseline !== undefined) {
    return cachedSessionBaseline;
  }

  try {
    const raw = await AsyncStorage.getItem(AUTO_UPLOAD_SESSION_STORAGE_KEY);
    if (!raw) {
      cachedSessionBaseline = null;
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<AutoUploadSessionBaseline>;
    if (
      typeof parsed.baselineTransferredCount !== 'number' ||
      !Number.isFinite(parsed.baselineTransferredCount) ||
      typeof parsed.startedAt !== 'string'
    ) {
      cachedSessionBaseline = null;
      return null;
    }
    cachedSessionBaseline = {
      baselineTransferredCount: Math.max(0, parsed.baselineTransferredCount),
      startedAt: parsed.startedAt,
    };
    return cachedSessionBaseline;
  } catch {
    cachedSessionBaseline = null;
    return null;
  }
}

async function writeAutoUploadSessionBaseline(
  baseline: AutoUploadSessionBaseline,
): Promise<void> {
  cachedSessionBaseline = baseline;
  await AsyncStorage.setItem(
    AUTO_UPLOAD_SESSION_STORAGE_KEY,
    JSON.stringify(baseline),
  );
}

function rememberAutoUploadSessionBaselineFromRound(
  overview: AutoUploadRoundOverview,
  completedThisRound: number,
): void {
  if (completedThisRound < 0) return;

  const baselineTransferredCount =
    typeof overview.roundBaselineCompletedCount === 'number'
      ? overview.roundBaselineCompletedCount
      : Math.max(0, overview.completedCount - completedThisRound);
  const baseline = {
    baselineTransferredCount,
    startedAt: new Date().toISOString(),
  };

  if (cachedSessionBaseline) return;
  if (cachedSessionBaseline === null) {
    cachedSessionBaseline = baseline;
    void AsyncStorage.setItem(
      AUTO_UPLOAD_SESSION_STORAGE_KEY,
      JSON.stringify(baseline),
    ).catch(e => {
      console.warn(
        '[AutoUploadSession] failed to persist inferred baseline:',
        e,
      );
    });
    return;
  }

  void readAutoUploadSessionBaseline()
    .then(existing => {
      if (existing) return;
      return writeAutoUploadSessionBaseline(baseline);
    })
    .catch(e => {
      console.warn('[AutoUploadSession] failed to infer session baseline:', e);
    });
}

export async function startAutoUploadSessionIfNeeded(): Promise<boolean> {
  const existing = await readAutoUploadSessionBaseline();
  if (existing) return false;

  const baselineTransferredCount = await getTransferredAlbumCount();
  await writeAutoUploadSessionBaseline({
    baselineTransferredCount,
    startedAt: new Date().toISOString(),
  });
  return true;
}

export async function clearAutoUploadSession(): Promise<void> {
  cachedSessionBaseline = null;
  await AsyncStorage.removeItem(AUTO_UPLOAD_SESSION_STORAGE_KEY);
}

export async function startAutoUploadSessionBestEffort(): Promise<boolean> {
  try {
    return await startAutoUploadSessionIfNeeded();
  } catch (e) {
    console.warn('[AutoUploadSession] failed to start session baseline:', e);
    return false;
  }
}

export async function clearAutoUploadSessionBestEffort(): Promise<void> {
  try {
    await clearAutoUploadSession();
  } catch (e) {
    console.warn('[AutoUploadSession] failed to clear session baseline:', e);
  }
}

export async function getAutoUploadSessionTransferredCount(
  isAutoUploadActive: boolean,
  transferredCountOverride?: number,
): Promise<number | null> {
  if (!isAutoUploadActive) return null;

  const baseline = await readAutoUploadSessionBaseline();
  if (!baseline) {
    return null;
  }

  const transferredCount =
    typeof transferredCountOverride === 'number' &&
    Number.isFinite(transferredCountOverride)
      ? Math.max(0, transferredCountOverride)
      : await getTransferredAlbumCount();
  return Math.max(0, transferredCount - baseline.baselineTransferredCount);
}

export async function clearAutoUploadSessionForTest(): Promise<void> {
  cachedSessionBaseline = null;
  await AsyncStorage.removeItem(AUTO_UPLOAD_SESSION_STORAGE_KEY);
}

export async function setAutoUploadSessionBaselineForTest(
  baselineTransferredCount: number,
): Promise<void> {
  await writeAutoUploadSessionBaseline({
    baselineTransferredCount,
    startedAt: new Date().toISOString(),
  });
}
