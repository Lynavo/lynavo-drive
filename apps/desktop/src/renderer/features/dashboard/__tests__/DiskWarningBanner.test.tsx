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
    const zhHant = i18n.getFixedT('zh-Hant');

    expect(screen.getByRole('alert')).toHaveTextContent(zhHant('dashboard.diskWarning'));
    expect(
      screen.getByRole('button', { name: zhHant('dashboard.dismissDiskWarning') }),
    ).toBeInTheDocument();
  });

  it('dismisses the warning through the dashboard store', () => {
    render(<DiskWarningBanner />);
    const zhHant = i18n.getFixedT('zh-Hant');

    fireEvent.click(screen.getByRole('button', { name: zhHant('dashboard.dismissDiskWarning') }));

    expect(useDashboardStore.getState().diskWarningDismissed).toBe(true);
  });
});
