import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '@renderer/i18n';
import { useDashboardStore } from '@renderer/stores/dashboard-store';
import { DiskWarningBanner } from '../DiskWarningBanner';

describe('DiskWarningBanner', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-Hant');
    useDashboardStore.setState({
      summary: {
        todayUploadCount: 0,
        todayOccupiedBytes: 0,
        remainingBytes: 128 * 1024 * 1024,
        isDiskLow: true,
        lastSuccessfulSyncAt: undefined,
        lastSuccessfulDeviceName: undefined,
      },
      diskWarningDismissed: false,
    });
  });

  it('renders localized warning copy and dismiss label', () => {
    render(<DiskWarningBanner />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      '接收磁碟剩餘空間小於 500MB，已暫停新的接收任務',
    );
    expect(screen.getByRole('button', { name: '關閉磁碟空間提醒' })).toBeInTheDocument();
  });

  it('dismisses the warning through the dashboard store', () => {
    render(<DiskWarningBanner />);

    fireEvent.click(screen.getByRole('button', { name: '關閉磁碟空間提醒' }));

    expect(useDashboardStore.getState().diskWarningDismissed).toBe(true);
  });
});
