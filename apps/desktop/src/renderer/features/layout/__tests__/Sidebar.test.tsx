import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '@renderer/stores/app-store';
import { Sidebar } from '../Sidebar';

describe('Sidebar', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    useAppStore.setState({
      currentView: 'dashboard',
      selectedDevice: null,
      isModalOpen: false,
    });
  });

  it('does not expose sign-in controls inside the desktop shell', () => {
    render(<Sidebar />);

    expect(screen.queryByText('Remote transfer is available after login.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Login' })).not.toBeInTheDocument();
  });

  it('does not render an authenticated account card in the OSS shell', async () => {
    render(<Sidebar />);

    expect(screen.queryByText('+8613800138000')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Log out')).not.toBeInTheDocument();
    expect(screen.queryByText('Remote transfer is available after login.')).not.toBeInTheDocument();
  });

  it('does not render authenticated email account state', async () => {
    render(<Sidebar />);

    expect(screen.queryByText('ada@example.com')).not.toBeInTheDocument();
    expect(screen.queryByText('Remote transfer is available after login.')).not.toBeInTheDocument();
  });

  it('does not render authenticated account labels', async () => {
    render(<Sidebar />);

    expect(screen.queryByText('ada@example.com')).not.toBeInTheDocument();
    expect(screen.queryByText('Remote transfer is available after login.')).not.toBeInTheDocument();
  });

  it('does not expose sign-out from the OSS sidebar', async () => {
    render(<Sidebar />);

    expect(screen.queryByTitle('Log out')).not.toBeInTheDocument();
  });

  it('exposes the desktop-local navigation entries and hides legacy folder management', async () => {
    render(<Sidebar />);

    expect(screen.getByRole('button', { name: 'Share Management' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Device Management' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync Records' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Access Records' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Me' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Folders' })).not.toBeInTheDocument();
  });

  it('uses the reference navigation icon mapping', async () => {
    const { container } = render(<Sidebar />);

    expect(container.querySelector('button svg.lucide-hard-drive')).toBeInTheDocument();
    expect(container.querySelector('button svg.lucide-smartphone')).toBeInTheDocument();
    expect(container.querySelector('button svg.lucide-folder-open')).toBeInTheDocument();
    expect(container.querySelector('button svg.lucide-history')).toBeInTheDocument();
    expect(container.querySelector('button svg.lucide-settings')).toBeInTheDocument();
  });

  it('switches to each desktop-local view from the sidebar', async () => {
    render(<Sidebar />);

    fireEvent.click(screen.getByRole('button', { name: 'Device Management' }));
    expect(useAppStore.getState().currentView).toBe('devices');

    fireEvent.click(screen.getByRole('button', { name: 'Sync Records' }));
    expect(useAppStore.getState().currentView).toBe('library');

    fireEvent.click(screen.getByRole('button', { name: 'Access Records' }));
    expect(useAppStore.getState().currentView).toBe('records');

    fireEvent.click(screen.getByRole('button', { name: 'Me' }));
    expect(useAppStore.getState().currentView).toBe('settings');
  });
});
