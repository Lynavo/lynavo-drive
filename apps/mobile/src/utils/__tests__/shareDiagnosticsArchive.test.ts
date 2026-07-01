const mockExportDiagnostics = jest.fn();
const mockShare = jest.fn();

jest.mock('i18next', () => ({
  t: jest.fn((key: string) =>
    key === 'common.diagnosticsArchiveTitle' ? 'Lynavo Drive Diagnostics' : key,
  ),
}));

import { NativeModules, Share } from 'react-native';
import {
  isDiagnosticsExportUnavailable,
  shareDiagnosticsArchive,
} from '../shareDiagnosticsArchive';

const nativeModules = NativeModules as typeof NativeModules & {
  NativeSyncEngine?: {
    exportDiagnostics?: jest.Mock;
  };
};

describe('shareDiagnosticsArchive', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    nativeModules.NativeSyncEngine = {
      exportDiagnostics: mockExportDiagnostics,
    };
    mockExportDiagnostics.mockResolvedValue('/tmp/lynavo-diagnostics.zip');
    mockShare.mockResolvedValue({ action: 'sharedAction' });
    jest.spyOn(Share, 'share').mockImplementation(mockShare);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('exports a local diagnostics archive and opens the system share sheet', async () => {
    await expect(shareDiagnosticsArchive()).resolves.toBe(
      '/tmp/lynavo-diagnostics.zip',
    );

    expect(mockExportDiagnostics).toHaveBeenCalledTimes(1);
    expect(mockShare).toHaveBeenCalledWith({
      title: 'Lynavo Drive Diagnostics',
      url: 'file:///tmp/lynavo-diagnostics.zip',
    });
  });

  it('keeps existing file URLs intact', async () => {
    mockExportDiagnostics.mockResolvedValueOnce(
      'file:///tmp/lynavo-diagnostics.zip',
    );

    await expect(shareDiagnosticsArchive()).resolves.toBe(
      'file:///tmp/lynavo-diagnostics.zip',
    );

    expect(mockShare).toHaveBeenCalledWith({
      title: 'Lynavo Drive Diagnostics',
      url: 'file:///tmp/lynavo-diagnostics.zip',
    });
  });

  it('fails closed when native diagnostics export is unavailable', async () => {
    nativeModules.NativeSyncEngine = {};

    let thrown: unknown;
    try {
      await shareDiagnosticsArchive();
    } catch (error) {
      thrown = error;
    }

    expect(isDiagnosticsExportUnavailable(thrown)).toBe(true);
    expect(mockShare).not.toHaveBeenCalled();
  });
});
