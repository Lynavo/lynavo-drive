import { NativeModules, Share } from 'react-native';
import i18next from 'i18next';
import { AppError } from './app-error';

const EXPORT_DIAGNOSTICS_UNAVAILABLE_CODE =
  'errors.exportDiagnosticsUnavailable';

export async function shareDiagnosticsArchive(): Promise<string> {
  const { NativeSyncEngine } = NativeModules;
  if (!NativeSyncEngine?.exportDiagnostics) {
    throw new AppError(EXPORT_DIAGNOSTICS_UNAVAILABLE_CODE);
  }

  const archivePath: string = await NativeSyncEngine.exportDiagnostics();
  const archiveUrl = archivePath.startsWith('file://')
    ? archivePath
    : `file://${archivePath}`;

  await Share.share({
    title: i18next.t('common.diagnosticsArchiveTitle'),
    url: archiveUrl,
  });

  return archivePath;
}

export function isDiagnosticsExportUnavailable(error: unknown): boolean {
  return (
    error instanceof AppError &&
    error.code === EXPORT_DIAGNOSTICS_UNAVAILABLE_CODE
  );
}
