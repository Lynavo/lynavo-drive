import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dialog, shell } from 'electron';
import { checkForUpdates } from '../diagnostics';
import { checkForUpdatesOnStartup } from '../startup-update-check';

vi.mock('electron', () => ({
  app: {
    getLocale: vi.fn(() => 'zh-TW'),
  },
  dialog: {
    showMessageBox: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

vi.mock('../diagnostics', () => ({
  checkForUpdates: vi.fn(),
}));

describe('checkForUpdatesOnStartup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('checks for desktop updates on launch and opens download URL when accepted', async () => {
    vi.mocked(checkForUpdates).mockResolvedValue({
      updateAvailable: true,
      latestVersion: '0.2.0',
      minimumRequired: true,
      downloadUrl: 'https://www.vividrop.cn/download',
      releaseNotes: '修正同步中斷問題',
      checkedAt: '2026-05-08T07:00:00Z',
    });
    vi.mocked(dialog.showMessageBox).mockResolvedValue({
      response: 0,
      checkboxChecked: false,
    });

    await checkForUpdatesOnStartup(() => null);

    expect(checkForUpdates).toHaveBeenCalledTimes(1);
    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'warning',
        message: '有新版本 v0.2.0 可用',
        detail: expect.stringContaining('更新內容: 修正同步中斷問題'),
        buttons: ['開啟下載頁', '稍後'],
      }),
    );
    expect(shell.openExternal).toHaveBeenCalledWith('https://www.vividrop.cn/download');
  });

  it('does not prompt when current desktop version is up to date', async () => {
    vi.mocked(checkForUpdates).mockResolvedValue({
      updateAvailable: false,
      latestVersion: '0.1.1',
      checkedAt: '2026-05-08T07:00:00Z',
    });

    await checkForUpdatesOnStartup(() => null);

    expect(dialog.showMessageBox).not.toHaveBeenCalled();
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('omits update content from the startup prompt when release notes are blank', async () => {
    vi.mocked(checkForUpdates).mockResolvedValue({
      updateAvailable: true,
      latestVersion: '0.2.0',
      minimumRequired: false,
      downloadUrl: 'https://www.vividrop.cn/download',
      releaseNotes: '   ',
      checkedAt: '2026-05-08T07:00:00Z',
    });
    vi.mocked(dialog.showMessageBox).mockResolvedValue({
      response: 1,
      checkboxChecked: false,
    });

    await checkForUpdatesOnStartup(() => null);

    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: undefined,
      }),
    );
  });
});
