import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { HelpPage } from '../HelpPage';

const electronAPIMock = vi.hoisted(() => ({
  getClientConfig: vi.fn(),
}));

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

vi.mock('@renderer/features/settings/GiftCardSection', () => ({
  GiftCardSection: () => <div data-testid="gift-card-section">兌換禮品卡</div>,
}));

vi.mock('@renderer/hooks/use-electron-api', () => ({
  useElectronAPI: () => ({
    sidecar: {
      getClientConfig: electronAPIMock.getClientConfig,
    },
  }),
}));

describe('HelpPage', () => {
  beforeEach(() => {
    electronAPIMock.getClientConfig.mockReset();
    electronAPIMock.getClientConfig.mockResolvedValue({ features: { giftCard: { enabled: true } } });
  });

  it('renders page header', () => {
    render(<HelpPage />);

    expect(screen.getByText('帮助中心')).toBeInTheDocument();
    expect(screen.getByText(/为您了解和使用 Vivi Drop 提供全面的指导信息/)).toBeInTheDocument();
  });

  it('renders gift card redeem entry at the bottom of help when config enables it', async () => {
    render(<HelpPage />);

    const giftCardSection = await screen.findByTestId('gift-card-section');

    expect(giftCardSection).toBeInTheDocument();
    expect(screen.getByText('兌換禮品卡')).toBeInTheDocument();
    expect(giftCardSection.closest('section')?.nextElementSibling).toBeNull();
  });

  it('hides gift card redeem entry when config disables it', async () => {
    electronAPIMock.getClientConfig.mockResolvedValue({
      features: { giftCard: { enabled: false } },
    });

    render(<HelpPage />);

    await waitFor(() => {
      expect(electronAPIMock.getClientConfig).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId('gift-card-section')).not.toBeInTheDocument();
    expect(screen.queryByText('兌換禮品卡')).not.toBeInTheDocument();
  });

  it('renders all 6 quick start steps', () => {
    render(<HelpPage />);

    expect(screen.getByText('快速开始', { exact: false })).toBeInTheDocument();

    const stepTitles = [
      '选择同步目录',
      '获取连接码并连接',
      '确认网络环境',
      '上传素材',
      '电脑端查看文件',
      '手机查看共享',
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
    expect(screen.getByText('个人共享目录 (personal)')).toBeInTheDocument();
    expect(screen.getByText('团队共享目录 (shared)')).toBeInTheDocument();

    // Key content from each card
    expect(screen.getByText(/用于接收局域网手机上传的原片/, { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText(/只有登入相同账号的手机与桌面/, { exact: false }).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/局域网内连接设备可查看、预览、在线播放和下载/, { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByText(/手机端只读访问/, { exact: false })).toBeInTheDocument();

    // Directory tree
    expect(screen.getByText(/received\/.*接收局域网手机上传/)).toBeInTheDocument();
    expect(screen.getByText(/PersonalShare\/.*个人共享目录/)).toBeInTheDocument();
  });

  it('renders system permission guide for both Windows and macOS', () => {
    render(<HelpPage />);

    expect(screen.getByText('系统权限指引', { exact: false })).toBeInTheDocument();

    expect(screen.getByText('Windows')).toBeInTheDocument();
    expect(screen.getByText('macOS')).toBeInTheDocument();

    // Windows steps
    expect(screen.getByText(/首次启动时系统可能弹出防火墙提示/, { exact: false })).toBeInTheDocument();

    // macOS steps
    expect(screen.getByText(/确保 Vivi Drop 有权限访问所选的同步根目录/)).toBeInTheDocument();
  });

  it('renders upload rules', () => {
    render(<HelpPage />);

    expect(screen.getByText('上传规则说明', { exact: false })).toBeInTheDocument();

    const rules = [
      '自动上传与手动上传可并行存在，手动上传项优先于自动项',
      '每个文件上传完成后重新取队首，确保手动素材优先传输',
      '手动上传形成持续追加的队列，新素材去重后追加到当前手动队列',
      '同一时刻仅允许 1 个文件处于传输中，队列按顺序逐一上传',
      '支持暂停/恢复自动上传、取消手动批次，不支持单项删除或调序',
    ];

    for (const rule of rules) {
      expect(screen.getByText(new RegExp(rule))).toBeInTheDocument();
    }
  });

  it('renders FAQ questions', () => {
    render(<HelpPage />);

    expect(screen.getByText('常见问题', { exact: false })).toBeInTheDocument();

    const questions = [
      '手机找不到电脑怎么办？',
      '为什么断线重连后需要手动恢复同步？',
      '为什么上传速度不够稳定？',
      '为什么有些素材无法上传或上传失败？',
      '为什么电脑上显示的文件名跟手机上的不一样？',
      '同步目录可以放在外置硬盘上吗？',
      '电脑休眠后传输会中断吗？',
    ];

    for (const q of questions) {
      expect(screen.getByText(q)).toBeInTheDocument();
    }

    // Verify all accordion items rendered
    const accordionItems = screen.getAllByTestId('accordion-item');
    expect(accordionItems).toHaveLength(7);
  });

  it('renders error handling cards', () => {
    render(<HelpPage />);

    expect(screen.getByText('异常处理说明', { exact: false })).toBeInTheDocument();

    const errorTitles = ['连接异常', '磁盘空间不足', '设备中断', '上传中断'];

    for (const title of errorTitles) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }

    // Verify descriptions
    expect(screen.getByText(/检查电脑和手机是否在同一局域网/)).toBeInTheDocument();
    expect(screen.getByText(/剩余空间低于 500MB/)).toBeInTheDocument();
    expect(screen.getByText(/设备离线、电脑休眠或网络中断/)).toBeInTheDocument();
    expect(screen.getByText(/未完成的任务可在恢复连接后自动重试/)).toBeInTheDocument();
  });
});
