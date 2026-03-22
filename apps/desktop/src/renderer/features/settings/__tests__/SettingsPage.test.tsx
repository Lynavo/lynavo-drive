import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingsPage } from '../SettingsPage';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { mockSettings } from '@renderer/mocks/settings';

describe('SettingsPage', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: mockSettings,
      copiedField: null,
    });
  });

  it('renders section headings', () => {
    render(<SettingsPage />);

    expect(screen.getByRole('heading', { name: '设备名称' })).toBeInTheDocument();
    expect(screen.getByText('连接码管理')).toBeInTheDocument();
    expect(screen.getByText('文件地址配置')).toBeInTheDocument();
    expect(screen.getByText('系统权限指引')).toBeInTheDocument();
  });

  it('displays 6 individual code digit boxes', () => {
    render(<SettingsPage />);

    const digits = screen.getAllByTestId('code-digit');
    expect(digits).toHaveLength(6);
  });

  it('renders the page title', () => {
    render(<SettingsPage />);

    expect(screen.getByText('设置')).toBeInTheDocument();
  });

  it('displays the connection code digits from the store', () => {
    render(<SettingsPage />);

    const digits = screen.getAllByTestId('code-digit');
    const code = mockSettings.connectionCode;
    digits.forEach((el, i) => {
      expect(el.textContent).toBe(code[i]);
    });
  });

  it('displays the receive path', () => {
    render(<SettingsPage />);

    const input = screen.getByDisplayValue(mockSettings.receivePath);
    expect(input).toBeInTheDocument();
  });

  it('displays the share address', () => {
    render(<SettingsPage />);

    expect(screen.getByText(mockSettings.shareAddress)).toBeInTheDocument();
  });

  it('displays the system guide card', () => {
    render(<SettingsPage />);

    expect(
      screen.getByText('Mac 开启本地共享操作手册'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('适用于 macOS Ventura 及以上'),
    ).toBeInTheDocument();
  });
});
