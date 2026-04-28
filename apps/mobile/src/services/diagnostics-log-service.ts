import { NativeModules } from 'react-native';

type DiagnosticsLogValue = string | number | boolean | null | undefined;

interface NativeDiagnosticsLogger {
  recordDiagnosticsLog?: (category: string, message: string) => void;
}

function normalizeLogValue(value: DiagnosticsLogValue): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  return String(value);
}

export function recordDiagnosticsLog(
  category: string,
  message: string,
  details?: Record<string, DiagnosticsLogValue>,
): void {
  const nativeSyncEngine = NativeModules.NativeSyncEngine as
    | NativeDiagnosticsLogger
    | undefined;
  if (!nativeSyncEngine?.recordDiagnosticsLog) return;

  const trimmedCategory = category.trim() || 'JS';
  const trimmedMessage = message.trim() || '<empty>';
  const detailText = details
    ? Object.entries(details)
        .map(([key, value]) => `${key}=${normalizeLogValue(value)}`)
        .join(' ')
    : '';

  try {
    nativeSyncEngine.recordDiagnosticsLog(
      trimmedCategory,
      detailText ? `${trimmedMessage} ${detailText}` : trimmedMessage,
    );
  } catch {
    // Diagnostics logging must never affect user-facing flows.
  }
}
