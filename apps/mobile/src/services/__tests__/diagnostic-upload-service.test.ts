// Mock api helpers — buildUrl and authHeaders are now exported from api.ts.
// We override them here to avoid any real network config or token lookup.
jest.mock('../api', () => ({
  buildUrl: (p: string) => `https://test.local${p}`,
  authHeaders: () => ({ Authorization: 'Bearer test-token' }),
}));

import {
  diagnosticUploadService,
  DiagnosticUploadError,
} from '../diagnostic-upload-service';

interface MockXHRUpload {
  onprogress?: (e: ProgressEvent) => void;
}

interface MockXHR {
  open: jest.Mock;
  setRequestHeader: jest.Mock;
  send: jest.Mock;
  abort: jest.Mock;
  upload: MockXHRUpload;
  onload?: () => void;
  onerror?: () => void;
  status: number;
  responseText: string;
}

let lastXHR: MockXHR;
const zipBlob = new Blob(['fake-zip'], {
  type: 'application/zip',
  lastModified: Date.now(),
});

async function flushUploadSetup() {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
    if (lastXHR.send.mock.calls.length > 0) return;
  }
}

beforeEach(() => {
  lastXHR = {
    open: jest.fn(),
    setRequestHeader: jest.fn(),
    send: jest.fn(),
    abort: jest.fn(),
    upload: {},
    status: 0,
    responseText: '',
  };
  // @ts-expect-error overriding global for test environment
  global.XMLHttpRequest = jest.fn(() => lastXHR);
  globalThis.fetch = jest.fn().mockResolvedValue({
    blob: jest.fn().mockResolvedValue(zipBlob),
  });
});

describe('diagnosticUploadService.upload', () => {
  test('happy path: 200 → resolves with refId + uploadedAt', async () => {
    const ctrl = new AbortController();
    const promise = diagnosticUploadService.upload(
      'file:///tmp/diagnostics-test.zip',
      'client-1',
      ctrl.signal,
    );
    await flushUploadSetup();

    lastXHR.status = 200;
    lastXHR.responseText = JSON.stringify({
      ref_id: 'ABC12XYZ',
      uploaded_at: '2026-04-25T10:00:00Z',
    });
    lastXHR.onload!();

    const result = await promise;
    expect(result.refId).toBe('ABC12XYZ');
    expect(result.uploadedAt).toBe('2026-04-25T10:00:00Z');
    expect(lastXHR.open).toHaveBeenCalledWith(
      'POST',
      'https://test.local/diagnostics/upload',
    );
    expect(lastXHR.setRequestHeader).toHaveBeenCalledWith(
      'Authorization',
      'Bearer test-token',
    );
    expect(lastXHR.setRequestHeader).toHaveBeenCalledWith(
      'Content-Type',
      expect.stringMatching(/^multipart\/form-data; boundary=syncflow-/),
    );
    const sentBody = lastXHR.send.mock.calls[0][0] as unknown as {
      text(): Promise<string>;
    };
    const multipartText = await sentBody.text();
    expect(multipartText).toContain('name="client_id"\r\n\r\nclient-1');
    expect(multipartText).toContain(
      'name="bundle"; filename="diagnostics-',
    );
    expect(multipartText).toContain('Content-Type: application/zip');
    expect(multipartText).toContain('fake-zip');
  });

  test('413 → rejects with BUNDLE_TOO_LARGE', async () => {
    const promise = diagnosticUploadService.upload(
      'file:///tmp/x.zip',
      'c',
      new AbortController().signal,
    );
    await flushUploadSetup();
    lastXHR.status = 413;
    lastXHR.onload!();
    await expect(promise).rejects.toMatchObject({
      detail: { kind: 'BUNDLE_TOO_LARGE' },
    });
  });

  test('500 → rejects with SERVER_ERROR carrying status', async () => {
    const promise = diagnosticUploadService.upload(
      'file:///tmp/x.zip',
      'c',
      new AbortController().signal,
    );
    await flushUploadSetup();
    lastXHR.status = 500;
    lastXHR.responseText = 'internal error';
    lastXHR.onload!();
    await expect(promise).rejects.toMatchObject({
      detail: { kind: 'SERVER_ERROR', status: 500 },
    });
  });

  test('network failure → rejects with NETWORK_ERROR', async () => {
    const promise = diagnosticUploadService.upload(
      'file:///tmp/x.zip',
      'c',
      new AbortController().signal,
    );
    await flushUploadSetup();
    lastXHR.onerror!();
    await expect(promise).rejects.toMatchObject({
      detail: { kind: 'NETWORK_ERROR' },
    });
  });

  test('abort signal → rejects with ABORTED + xhr.abort called', async () => {
    const ctrl = new AbortController();
    const promise = diagnosticUploadService.upload(
      'file:///tmp/x.zip',
      'c',
      ctrl.signal,
    );
    await flushUploadSetup();
    ctrl.abort();
    await expect(promise).rejects.toMatchObject({
      detail: { kind: 'ABORTED' },
    });
    expect(lastXHR.abort).toHaveBeenCalled();
  });

  test('progress callback fires when upload.onprogress emitted', async () => {
    const onProgress = jest.fn();
    const promise = diagnosticUploadService.upload(
      'file:///tmp/x.zip',
      'c',
      new AbortController().signal,
      onProgress,
    );
    await flushUploadSetup();

    lastXHR.upload.onprogress!({
      lengthComputable: true,
      loaded: 50,
      total: 100,
    } as ProgressEvent);
    expect(onProgress).toHaveBeenCalledWith(50, 100);

    lastXHR.status = 200;
    lastXHR.responseText = JSON.stringify({
      ref_id: 'X',
      uploaded_at: '2026-01-01T00:00:00Z',
    });
    lastXHR.onload!();
    await promise;
  });

  test('empty file uri rejects before touching XHR', async () => {
    await expect(
      diagnosticUploadService.upload('  ', 'c', new AbortController().signal),
    ).rejects.toMatchObject({
      detail: { kind: 'NETWORK_ERROR' },
    });
    expect(globalThis.XMLHttpRequest).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('DiagnosticUploadError has correct name and message for SERVER_ERROR', () => {
    const err = new DiagnosticUploadError({ kind: 'SERVER_ERROR', status: 422 });
    expect(err.name).toBe('DiagnosticUploadError');
    expect(err.message).toBe('server error 422');
    expect(err.detail).toEqual({ kind: 'SERVER_ERROR', status: 422 });
  });

  test('DiagnosticUploadError message equals kind for non-SERVER_ERROR variants', () => {
    const err = new DiagnosticUploadError({ kind: 'NETWORK_ERROR' });
    expect(err.message).toBe('NETWORK_ERROR');
  });
});
