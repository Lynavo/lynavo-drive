import { NativeModules, Share } from 'react-native';

const EXPORT_DIAGNOSTICS_UNAVAILABLE = 'EXPORT_DIAGNOSTICS_UNAVAILABLE';

export async function shareDiagnosticsArchive(): Promise<string> {
  const { NativeSyncEngine } = NativeModules;
  if (!NativeSyncEngine?.exportDiagnostics) {
    throw new Error(EXPORT_DIAGNOSTICS_UNAVAILABLE);
  }

  const archivePath: string = await NativeSyncEngine.exportDiagnostics();
  const archiveUrl = archivePath.startsWith('file://')
    ? archivePath
    : `file://${archivePath}`;

  await Share.share({
    title: 'Vivi Drop 诊断包',
    url: archiveUrl,
  });

  return archivePath;
}

export function isDiagnosticsExportUnavailable(error: unknown): boolean {
  return (
    error instanceof Error && error.message === EXPORT_DIAGNOSTICS_UNAVAILABLE
  );
}
