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

    expect(screen.getByText('帮助中心')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '帮助分类' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '基础功能介绍' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('button', { name: '首次使用引导' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上传与共享说明' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '常见问题' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '联系我们' })).toBeInTheDocument();
  });

  it('does not render dialog content when open is false', () => {
    useAppStore.setState({ isHelpOpen: false });
    render(<HelpDialog />);

    expect(screen.queryByText('帮助中心')).not.toBeInTheDocument();
  });

  it('shows the basic feature introduction by default', () => {
    render(<HelpDialog />);

    expect(screen.getByText('ViviDrop 是什么')).toBeInTheDocument();
    expect(screen.getByText('如何连接电脑')).toBeInTheDocument();
    expect(screen.getByText('如何上传素材')).toBeInTheDocument();
    expect(screen.getByText('如何访问共享目录')).toBeInTheDocument();
  });

  it('switches to the first-use guide section', () => {
    render(<HelpDialog />);

    fireEvent.click(screen.getByRole('button', { name: '首次使用引导' }));

    expect(screen.getByText('连接电脑')).toBeInTheDocument();
    expect(screen.getByText('开启自动上传')).toBeInTheDocument();
    expect(screen.getByText('手动上传')).toBeInTheDocument();
    expect(screen.getByText('查看共享目录')).toBeInTheDocument();
  });

  it('switches to upload and sharing instructions', () => {
    render(<HelpDialog />);

    fireEvent.click(screen.getByRole('button', { name: '上传与共享说明' }));

    expect(screen.getByText('自动上传 vs 手动上传')).toBeInTheDocument();
    expect(screen.getByText('received 目录与 shared 目录')).toBeInTheDocument();
    expect(screen.getByText('共享目录是只读访问')).toBeInTheDocument();
  });

  it('switches to faq content', () => {
    render(<HelpDialog />);

    fireEvent.click(screen.getByRole('button', { name: '常见问题' }));

    expect(screen.getByText('设备离线怎么办？')).toBeInTheDocument();
    expect(screen.getByText('上传失败怎么办？')).toBeInTheDocument();
    expect(screen.getByText('是否需要账号或订阅？')).toBeInTheDocument();
    expect(screen.getByText('OSS 版本包含官方远程访问吗？')).toBeInTheDocument();
  });

  it('switches to contact content', () => {
    render(<HelpDialog />);

    fireEvent.click(screen.getByRole('button', { name: '联系我们' }));

    expect(screen.getByText('客服邮箱')).toBeInTheDocument();
    expect(screen.getByText(/support@vividrop.cn/)).toBeInTheDocument();
    expect(screen.getByText('导出诊断包')).toBeInTheDocument();
    expect(screen.getByText('反馈入口')).toBeInTheDocument();
  });
});
