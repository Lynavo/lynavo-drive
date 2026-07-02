import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HelpDialog } from '../HelpDialog';
import { useAppStore } from '@renderer/stores/app-store';

describe('HelpDialog', () => {
  beforeEach(() => {
    useAppStore.setState({
      isHelpOpen: true,
      currentView: 'dashboard',
    });
  });

  it('renders the reference help center shell', () => {
    render(<HelpDialog />);

    expect(screen.getByText('Help Center')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Help categories' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Introduction' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('button', { name: 'First-use guide' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload and sharing' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'FAQ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Contact us' })).toBeInTheDocument();
  });

  it('does not render dialog content when open is false', () => {
    useAppStore.setState({ isHelpOpen: false });
    render(<HelpDialog />);

    expect(screen.queryByText('Help Center')).not.toBeInTheDocument();
  });

  it('shows the basic feature introduction by default', () => {
    render(<HelpDialog />);

    expect(screen.getByText('What is Lynavo Drive')).toBeInTheDocument();
    expect(screen.getByText('How to connect to the computer')).toBeInTheDocument();
    expect(screen.getByText('How to upload media')).toBeInTheDocument();
    expect(screen.getByText('How to access the shared folder')).toBeInTheDocument();
  });

  it('switches to the first-use guide section', () => {
    render(<HelpDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'First-use guide' }));

    expect(screen.getByText('Connect to the computer')).toBeInTheDocument();
    expect(screen.getByText('Enable automatic upload')).toBeInTheDocument();
    expect(screen.getByText('Foreground LAN queue')).toBeInTheDocument();
    expect(screen.getByText('View the shared folder')).toBeInTheDocument();
  });

  it('switches to upload and sharing instructions', () => {
    render(<HelpDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Upload and sharing' }));

    expect(screen.getByText('Automatic incremental upload')).toBeInTheDocument();
    expect(screen.getByText('received folder and shared folder')).toBeInTheDocument();
    expect(screen.getByText('Shared folder access is read-only')).toBeInTheDocument();
  });

  it('switches to faq content', () => {
    render(<HelpDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'FAQ' }));

    expect(screen.getByText('What if the device is offline?')).toBeInTheDocument();
    expect(screen.getByText('What if upload fails?')).toBeInTheDocument();
    expect(screen.getByText('Do I need a cloud login?')).toBeInTheDocument();
    expect(
      screen.getByText('Does the OSS edition include official internet relay?'),
    ).toBeInTheDocument();
  });

  it('switches to contact content', () => {
    render(<HelpDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Contact us' }));

    expect(screen.getByText('Community support')).toBeInTheDocument();
    expect(screen.getByText(/GitHub issue/)).toBeInTheDocument();
    expect(screen.getByText('Export diagnostics package')).toBeInTheDocument();
    expect(screen.getByText('Feedback entry')).toBeInTheDocument();
  });
});
