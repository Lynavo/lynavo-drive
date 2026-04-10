import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HelpPage } from '../HelpPage';

vi.mock('@renderer/components/shared/GlassCard', () => ({
  GlassCard: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="glass-card" className={className}>
      {children}
    </div>
  ),
}));

vi.mock('@renderer/components/ui/accordion', () => ({
  Accordion: ({ children }: { children: React.ReactNode; type?: string }) => (
    <div data-testid="accordion">{children}</div>
  ),
  AccordionItem: ({ children }: { children: React.ReactNode; value?: string }) => (
    <div data-testid="accordion-item">{children}</div>
  ),
  AccordionTrigger: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <button data-testid="accordion-trigger" className={className}>
      {children}
    </button>
  ),
  AccordionContent: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <div data-testid="accordion-content" className={className}>
      {children}
    </div>
  ),
}));

describe('HelpPage', () => {
  it('renders page header', () => {
    render(<HelpPage />);

    expect(screen.getByText('帮助中心')).toBeInTheDocument();
    expect(screen.getByText(/快速了解如何使用 FlowSync 进行跨设备文件同步/)).toBeInTheDocument();
  });

  it('renders all 6 quick start steps', () => {
    render(<HelpPage />);

    expect(screen.getByText('快速开始', { exact: false })).toBeInTheDocument();

    const stepTitles = [
      '选择根目录',
      '自动生成子目录',
      '移动端连接电脑',
      '上传素材',
      'PC 处理成品',
      '移动端查看',
    ];

    for (const title of stepTitles) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }

    // Verify numbered badges 1-6
    for (let i = 1; i <= 6; i++) {
      expect(screen.getByText(String(i))).toBeInTheDocument();
    }
  });

  it('renders directory explanation cards', () => {
    render(<HelpPage />);

    expect(screen.getByText('目录说明', { exact: false })).toBeInTheDocument();

    expect(screen.getByText('接收目录 (received)')).toBeInTheDocument();
    expect(screen.getByText('共享目录 (shared)')).toBeInTheDocument();

    // Key content from each card
    expect(screen.getByText(/接收移动端上传的原片/, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/移动端无法查看此目录/, { exact: false })).toBeInTheDocument();
    expect(
      screen.getByText(/移动端可查看、预览、播放和下载/, { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByText(/移动端只读访问/, { exact: false })).toBeInTheDocument();

    // Directory tree
    expect(screen.getByText(/received\/.*接收移动端上传/)).toBeInTheDocument();
  });

  it('renders system permission guide for both Windows and macOS', () => {
    render(<HelpPage />);

    expect(screen.getByText('系统权限指引', { exact: false })).toBeInTheDocument();

    expect(screen.getByText('Windows 权限设置')).toBeInTheDocument();
    expect(screen.getByText('macOS 权限设置')).toBeInTheDocument();

    // Windows steps
    expect(screen.getByText(/文件夹共享的权限请求/, { exact: false })).toBeInTheDocument();

    // macOS steps
    expect(screen.getByText(/找到该应用，勾选需要访问的文件夹权限/)).toBeInTheDocument();
  });

  it('renders upload rules', () => {
    render(<HelpPage />);

    expect(screen.getByText('上传规则说明', { exact: false })).toBeInTheDocument();

    const rules = [
      '自动上传在每次打开上传窗口时启用',
      '手动上传和自动上传并行支持文件上传',
      '两者共用同一个传输队列',
      '手动队列入列的文件优先于自动任务扫描的文件',
      '同一时段只会上传一个文件，队列会按顺序逐一上传文件',
    ];

    for (const rule of rules) {
      expect(screen.getByText(new RegExp(rule))).toBeInTheDocument();
    }
  });

  it('renders FAQ questions', () => {
    render(<HelpPage />);

    expect(screen.getByText('常见问题', { exact: false })).toBeInTheDocument();

    const questions = [
      '为什么移动端已连接成功了，却看不到共享文件？',
      '为什么接收目录不能修改？',
      '为什么有些素材没有自动上传？',
      '为什么共享目录里的内容只能查看不能修改？',
    ];

    for (const q of questions) {
      expect(screen.getByText(q)).toBeInTheDocument();
    }

    // Verify all 4 accordion items rendered
    const accordionItems = screen.getAllByTestId('accordion-item');
    expect(accordionItems).toHaveLength(4);
  });

  it('renders error handling cards', () => {
    render(<HelpPage />);

    expect(screen.getByText('异常处理说明', { exact: false })).toBeInTheDocument();

    const errorTitles = ['设备离线', '目录不可访问', '空间不足', '上传中断'];

    for (const title of errorTitles) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }

    // Verify descriptions
    expect(screen.getByText(/确保 PC 和移动设备在同一局域网/)).toBeInTheDocument();
    expect(screen.getByText(/检查文件夹权限/)).toBeInTheDocument();
    expect(screen.getByText(/清理磁盘空间/)).toBeInTheDocument();
    expect(screen.getByText(/传输会自动在下次重新启动时恢复/)).toBeInTheDocument();
  });
});
