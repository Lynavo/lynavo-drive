import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PowerSaveSection } from '../PowerSaveSection';

const getState = vi.fn();
const setPreventSleepDuringTransfer = vi.fn();
let sidecarEventCallback: ((event: unknown) => void) | null = null;

function setElectronAPI() {
  (window as Window & { electronAPI?: unknown }).electronAPI = {
    power: {
      getState,
      setPreventSleepDuringTransfer,
    },
    events: {
      onSidecarEvent: vi.fn((callback) => {
        sidecarEventCallback = callback;
        return vi.fn();
      }),
    },
  } as unknown as Window['electronAPI'];
}

describe('PowerSaveSection', () => {
  beforeEach(() => {
    getState.mockReset();
    setPreventSleepDuringTransfer.mockReset();
    sidecarEventCallback = null;
    getState.mockResolvedValue({
      preventSleepDuringTransfer: true,
      blockingSleep: false,
    });
    setPreventSleepDuringTransfer.mockResolvedValue({
      preventSleepDuringTransfer: false,
      blockingSleep: false,
    });
    setElectronAPI();
  });

  it('loads and displays the prevent sleep preference', async () => {
    render(<PowerSaveSection />);

    const toggle = await screen.findByRole('switch', { name: '同步期间防止电脑待机' });

    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('power-save-switch-thumb')).toHaveClass('translate-x-[18px]');
    expect(
      screen.getByText('手机同步期间保持电脑唤醒；传输时屏幕可能保持亮起，结束后会恢复系统待机设置。'),
    ).toBeInTheDocument();
  });

  it('updates the preference when toggled', async () => {
    render(<PowerSaveSection />);

    const toggle = await screen.findByRole('switch', { name: '同步期间防止电脑待机' });
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(setPreventSleepDuringTransfer).toHaveBeenCalledWith(false);
    });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('refreshes blocker status when transfer activity changes', async () => {
    getState
      .mockResolvedValueOnce({
        preventSleepDuringTransfer: true,
        blockingSleep: false,
      })
      .mockResolvedValueOnce({
        preventSleepDuringTransfer: true,
        blockingSleep: true,
      });

    render(<PowerSaveSection />);
    await screen.findByText('等待同步');

    sidecarEventCallback?.({
      type: 'transfer.active.changed',
      payload: { isActive: true },
    });

    expect(await screen.findByText('正在保持唤醒')).toBeInTheDocument();
  });
});
