import { NativeModules } from 'react-native';
import { authHeaders, buildUrl } from './api';

export type UploadProgress = (loaded: number, total: number) => void;

export interface UploadResult {
  refId: string;
  uploadedAt: string;
}

export type UploadError =
  | { kind: 'BUNDLE_TOO_LARGE' }
  | { kind: 'ABORTED' }
  | { kind: 'NETWORK_ERROR' }
  | { kind: 'SERVER_ERROR'; status: number; body?: string };

export class DiagnosticUploadError extends Error {
  readonly detail: UploadError;
  constructor(detail: UploadError) {
    const msg =
      detail.kind === 'SERVER_ERROR'
        ? `server error ${detail.status}`
        : detail.kind;
    super(msg);
    this.detail = detail;
    this.name = 'DiagnosticUploadError';
  }
}

interface NativeDiagnosticsUploadModule {
  uploadDiagnosticsArchive?: (params: {
    url: string;
    archivePath: string;
    client_id: string;
    headers: Record<string, string>;
  }) => Promise<{ ref_id: string; uploaded_at: string }>;
}

function normalizeFileUri(zipFileUri: string): string {
  return zipFileUri.trim();
}

function buildMultipartBundle(
  zipBlob: Blob,
  clientId: string,
  filename: string,
): { body: Blob; contentType: string } {
  const boundary = `syncflow-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  const body = new Blob(
    [
      `--${boundary}\r\n`,
      'Content-Disposition: form-data; name="client_id"',
      '\r\n\r\n',
      clientId,
      '\r\n',
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="bundle"; filename="${filename}"`,
      '\r\n',
      'Content-Type: application/zip',
      '\r\n\r\n',
      zipBlob,
      '\r\n',
      `--${boundary}--\r\n`,
    ],
    {
      type: `multipart/form-data; boundary=${boundary}`,
      lastModified: Date.now(),
    },
  );

  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

export interface DiagnosticUploadService {
  upload(
    zipFileUri: string,
    clientId: string,
    signal: AbortSignal,
    onProgress?: UploadProgress,
  ): Promise<UploadResult>;
}

class XHRDiagnosticUploadService implements DiagnosticUploadService {
  upload(
    zipFileUri: string,
    clientId: string,
    signal: AbortSignal,
    onProgress?: UploadProgress,
  ): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      const normalizedUri = normalizeFileUri(zipFileUri);
      if (!normalizedUri) {
        reject(new DiagnosticUploadError({ kind: 'NETWORK_ERROR' }));
        return;
      }

      const nativeSyncEngine = NativeModules.NativeSyncEngine as
        | NativeDiagnosticsUploadModule
        | undefined;
      if (nativeSyncEngine?.uploadDiagnosticsArchive) {
        if (signal.aborted) {
          reject(new DiagnosticUploadError({ kind: 'ABORTED' }));
          return;
        }

        onProgress?.(0, 1);
        nativeSyncEngine
          .uploadDiagnosticsArchive({
            url: buildUrl('/diagnostics/upload'),
            archivePath: normalizedUri,
            client_id: clientId,
            headers: authHeaders(),
          })
          .then(result => {
            if (signal.aborted) {
              reject(new DiagnosticUploadError({ kind: 'ABORTED' }));
              return;
            }
            onProgress?.(1, 1);
            resolve({
              refId: result.ref_id,
              uploadedAt: result.uploaded_at,
            });
          })
          .catch(error => {
            const code = String(error?.code ?? '');
            if (code === 'BUNDLE_TOO_LARGE') {
              reject(new DiagnosticUploadError({ kind: 'BUNDLE_TOO_LARGE' }));
            } else if (code === 'ABORTED') {
              reject(new DiagnosticUploadError({ kind: 'ABORTED' }));
            } else if (code === 'SERVER_ERROR') {
              reject(
                new DiagnosticUploadError({
                  kind: 'SERVER_ERROR',
                  status: 422,
                  body: String(error?.message ?? ''),
                }),
              );
            } else {
              reject(new DiagnosticUploadError({ kind: 'NETWORK_ERROR' }));
            }
          });
        return;
      }

      void (async () => {
        if (signal.aborted) {
          reject(new DiagnosticUploadError({ kind: 'ABORTED' }));
          return;
        }

        let zipBlob: Blob;
        try {
          zipBlob = await fetch(normalizedUri).then(r => r.blob());
        } catch {
          reject(new DiagnosticUploadError({ kind: 'NETWORK_ERROR' }));
          return;
        }

        if (signal.aborted) {
          reject(new DiagnosticUploadError({ kind: 'ABORTED' }));
          return;
        }

        const xhr = new XMLHttpRequest();
        xhr.open('POST', buildUrl('/diagnostics/upload'));
        const { body, contentType } = buildMultipartBundle(
          zipBlob,
          clientId,
          `diagnostics-${Date.now()}.zip`,
        );

        const headers = authHeaders();
        Object.entries(headers).forEach(([k, v]) =>
          xhr.setRequestHeader(k, v),
        );
        xhr.setRequestHeader('Content-Type', contentType);

        if (onProgress) {
          xhr.upload.onprogress = (e: ProgressEvent) => {
            if (e.lengthComputable) onProgress(e.loaded, e.total);
          };
        }

        let aborted = false;
        const onAbort = () => {
          aborted = true;
          try {
            xhr.abort();
          } catch {
            // noop
          }
          reject(new DiagnosticUploadError({ kind: 'ABORTED' }));
        };
        signal.addEventListener('abort', onAbort);

        const cleanup = () => signal.removeEventListener('abort', onAbort);

        xhr.onload = () => {
          cleanup();
          if (aborted) return;
          if (xhr.status === 200) {
            try {
              const parsed = JSON.parse(xhr.responseText) as {
                ref_id: string;
                uploaded_at: string;
              };
              resolve({ refId: parsed.ref_id, uploadedAt: parsed.uploaded_at });
            } catch {
              reject(
                new DiagnosticUploadError({
                  kind: 'SERVER_ERROR',
                  status: 200,
                  body: xhr.responseText,
                }),
              );
            }
          } else if (xhr.status === 413) {
            reject(new DiagnosticUploadError({ kind: 'BUNDLE_TOO_LARGE' }));
          } else {
            reject(
              new DiagnosticUploadError({
                kind: 'SERVER_ERROR',
                status: xhr.status,
                body: xhr.responseText,
              }),
            );
          }
        };

        xhr.onerror = () => {
          cleanup();
          if (aborted) return;
          reject(new DiagnosticUploadError({ kind: 'NETWORK_ERROR' }));
        };

        xhr.send(body as unknown as Document);
      })();
    });
  }
}

export const diagnosticUploadService: DiagnosticUploadService =
  new XHRDiagnosticUploadService();
