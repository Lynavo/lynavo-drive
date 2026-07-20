import { NativeModules } from 'react-native';
import type { RootStackParamList } from '../navigation/RootNavigator';

declare const __DEV__: boolean | undefined;
declare const process: { env?: Record<string, string | undefined> } | undefined;

type VisualQaRoute = Extract<
  keyof RootStackParamList,
  | 'DeviceDiscovery'
  | 'QRScanner'
  | 'ConnectionTutorial'
  | 'SyncActivity'
  | 'AlbumWorkbench'
  | 'SharedFiles'
  | 'PhoneSyncSpace'
  | 'LocalComputer'
  | 'DownloadRecords'
  | 'History'
  | 'Settings'
  | 'Help'
  | 'AutoUploadSettings'
>;

type SharedFilesPreviewGlobal = typeof globalThis & {
  __LYNAVO_SHARED_FILES_PREVIEW__?: boolean;
};

type VisualQaNativeConstants = {
  LYNAVO_VISUAL_QA?: unknown;
  LYNAVO_VISUAL_QA_HOME_EMPTY?: unknown;
  LYNAVO_VISUAL_QA_ROUTE?: unknown;
  LYNAVO_VISUAL_QA_SHARED_FILES_PREVIEW?: unknown;
  getConstants?: () => VisualQaNativeConstants;
};

const VISUAL_QA_ROUTE_WHITELIST: ReadonlySet<string> = new Set<VisualQaRoute>([
  'DeviceDiscovery',
  'QRScanner',
  'ConnectionTutorial',
  'SyncActivity',
  'AlbumWorkbench',
  'SharedFiles',
  'PhoneSyncSpace',
  'LocalComputer',
  'DownloadRecords',
  'History',
  'Settings',
  'Help',
  'AutoUploadSettings',
]);

function getEnv(name: string): string | undefined {
  if (typeof process === 'undefined') return undefined;
  return process.env?.[name];
}

function readNativeValue(
  name: keyof VisualQaNativeConstants,
): string | undefined {
  const nativeAppRuntimeConfig = NativeModules.NativeAppRuntimeConfig as
    VisualQaNativeConstants | undefined;
  const nativeAppRuntimeConstants = nativeAppRuntimeConfig?.getConstants?.();
  const value =
    nativeAppRuntimeConfig?.[name] ?? nativeAppRuntimeConstants?.[name];
  return typeof value === 'string' ? value : undefined;
}

function getVisualQaValue(
  name: keyof VisualQaNativeConstants,
): string | undefined {
  return readNativeValue(name) ?? getEnv(name);
}

function isDevRuntime(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

export function isVisualQaEnabled(): boolean {
  const nativeValue = readNativeValue('LYNAVO_VISUAL_QA');
  if (nativeValue !== undefined) {
    return nativeValue === '1';
  }
  return isDevRuntime() ? getEnv('LYNAVO_VISUAL_QA') === '1' : false;
}

export function resolveVisualQaInitialRoute(): VisualQaRoute | null {
  if (!isVisualQaEnabled()) return null;
  const route = getVisualQaValue('LYNAVO_VISUAL_QA_ROUTE');
  if (!route || !VISUAL_QA_ROUTE_WHITELIST.has(route)) return null;
  return route as VisualQaRoute;
}

export function isVisualQaHomeEmptyStateEnabled(): boolean {
  return (
    isVisualQaEnabled() &&
    getVisualQaValue('LYNAVO_VISUAL_QA_HOME_EMPTY') === '1'
  );
}

export function applyVisualQaSharedFilesPreviewFlag(): void {
  if (
    isVisualQaEnabled() &&
    getVisualQaValue('LYNAVO_VISUAL_QA_SHARED_FILES_PREVIEW') === '1'
  ) {
    (globalThis as SharedFilesPreviewGlobal).__LYNAVO_SHARED_FILES_PREVIEW__ =
      true;
  }
}
