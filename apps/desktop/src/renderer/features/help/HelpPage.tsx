import { Wifi, AlertTriangle, HardDrive, UploadCloud, Shield, FolderOpen, Globe, Apple, Monitor } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { GlassCard } from '@renderer/components/shared/GlassCard';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@renderer/components/ui/accordion';

/* ------------------------------------------------------------------ */
/*  Data                                                               */
/* ------------------------------------------------------------------ */

const quickStartSteps = [
  {
    title: '选择同步目录',
    description:
      '打开 Vivi Drop，选择一个本地文件夹作为同步根目录（macOS 如 ~/ViviDrop，Windows 如 D:\\ViviDrop）',
  },
  {
    title: '获取连接码并连接',
    description: '在设置页面找到 6 位连接码，在手机端输入该连接码完成配对',
  },
  {
    title: '确认网络环境',
    description: '确保电脑与手机连接同一 Wi-Fi 网络，建议使用 5GHz 频段以获得最佳传输速度',
  },
  {
    title: '上传素材',
    description: '在手机相册中开启自动上传，或手动选择素材上传到电脑',
  },
  {
    title: '电脑端查看文件',
    description: '在"目录管理"页的接收目录中查看已接收的素材，也可直接在文件管理器中打开',
  },
  {
    title: '手机查看共享',
    description: '将成品放入 shared 目录后，手机端可在"共享目录"中查看、预览和下载',
  },
] as const;

const directoryCards = [
  {
    title: '接收目录 (received)',
    points: [
      '用于接收手机上传的原片、视频等素材',
      '按设备名 + 日期自动分类存放',
      '仅供电脑端处理使用，手机端不可见',
    ],
  },
  {
    title: '共享目录 (shared)',
    points: [
      '用于存放电脑端处理好的成品内容',
      '手机端可查看、预览、在线播放和下载',
      '手机端只读访问，不能修改或删除',
    ],
  },
] as const;

const directoryTree = `ViviDrop/
├── received/  （接收手机上传的素材）
└── shared/    （共享给手机查看的成品）`;

const macPermissionSections = [
  {
    icon: Shield,
    title: '防火墙',
    steps: [
      '系统设置 → 网络 → 防火墙',
      '如防火墙已开启，点击"选项…"确保 Vivi Drop 被设为"允许传入连接"',
      '首次启动时 macOS 会弹出防火墙提示，请点击"允许"',
    ],
  },
  {
    icon: Globe,
    title: '本地网络权限',
    steps: [
      '系统设置 → 隐私与安全性 → 本地网络',
      '确保 Vivi Drop 的开关已打开（手机发现电脑依赖此权限）',
      '如果手机搜索不到电脑，请先检查此项',
    ],
  },
  {
    icon: FolderOpen,
    title: '文件与文件夹访问',
    steps: [
      '系统设置 → 隐私与安全性 → 文件和文件夹',
      '确保 Vivi Drop 有权限访问所选的同步根目录',
      '若同步目录在外置硬盘上，还需在"完全磁盘访问权限"中授权',
    ],
  },
  {
    icon: Apple,
    title: 'Gatekeeper 与首次启动',
    steps: [
      '首次打开时若提示"无法验证开发者"，右键点击应用选择"打开"',
      '或前往 系统设置 → 隐私与安全性 → 下方点击"仍要打开"',
      '授权一次后后续启动不会再次弹窗',
    ],
  },
] as const;

const windowsPermissionSections = [
  {
    icon: Shield,
    title: '防火墙',
    steps: [
      '首次启动时系统可能弹出防火墙提示，请选择"允许访问"',
      '如被阻止：设置 → 隐私和安全性 → Windows 安全中心 → 防火墙和网络保护',
      '点击"允许应用通过防火墙"，确保 Vivi Drop 的"专用"和"公用"均已勾选',
    ],
  },
  {
    icon: Globe,
    title: '网络发现',
    steps: [
      '设置 → 网络和 Internet → 高级网络设置 → 高级共享设置',
      '确保当前网络配置文件下"网络发现"已开启',
      '如果手机搜索不到电脑，请确认网络类型为"专用网络"而非"公用网络"',
    ],
  },
  {
    icon: FolderOpen,
    title: '文件夹访问权限',
    steps: [
      '确保同步根目录所在磁盘有足够的读写权限',
      '避免将同步目录设在系统保护文件夹内（如 C:\\Program Files）',
      '若使用外置硬盘，确保传输过程中硬盘保持连接',
    ],
  },
  {
    icon: Monitor,
    title: 'SmartScreen 与首次启动',
    steps: [
      '首次打开时若提示"Windows 已保护你的电脑"，点击"更多信息" → "仍要运行"',
      '或在文件属性中勾选"解除锁定"后再运行',
      '授权一次后后续启动不会再次弹窗',
    ],
  },
] as const;

const uploadRules = [
  '自动上传与手动上传可并行存在，手动上传项优先于自动项',
  '每个文件上传完成后重新取队首，确保手动素材优先传输',
  '手动上传形成持续追加的队列，新素材去重后追加到当前手动队列',
  '同一时刻仅允许 1 个文件处于传输中，队列按顺序逐一上传',
  '支持暂停/恢复自动上传、取消手动批次，不支持单项删除或调序',
];

const faqItems = [
  {
    question: '手机找不到电脑怎么办？',
    answer:
      '请依次检查：1) 电脑和手机是否连接同一 Wi-Fi；2) macOS 用户检查"本地网络"权限是否已授予 Vivi Drop（系统设置 → 隐私与安全性 → 本地网络）；3) Windows 用户确认网络类型为"专用网络"且"网络发现"已开启；4) 检查防火墙是否阻止了传入连接；5) 尝试关闭后重新打开 Vivi Drop',
  },
  {
    question: '为什么断线重连后需要手动恢复同步？',
    answer:
      '自动上传被关闭后不会自动恢复，需要在手机相册页面重新开启。这是为了避免在不知情时占用传输通道',
  },
  {
    question: '为什么上传速度不够稳定？',
    answer:
      '传输速度受局域网环境影响，包括 Wi-Fi 信号强度、路由器负载和频段选择。建议使用 5GHz 频段，并确保电脑和手机靠近路由器',
  },
  {
    question: '为什么有些素材无法上传或上传失败？',
    answer:
      '常见原因：1) 素材存储在 iCloud 云端尚未下载到本地（导出时会自动触发下载）；2) 传输过程中网络中断。已完成的文件会保留，未完成的可在恢复后重试',
  },
  {
    question: '为什么电脑上显示的文件名跟手机上的不一样？',
    answer:
      'iOS 相册中的文件名由系统自动生成（如 IMG_xxxx），导出时可能因格式转换而重新命名。实际接收的文件内容与原始素材一致',
  },
  {
    question: '同步目录可以放在外置硬盘上吗？',
    answer:
      '可以。选择外置硬盘上的文件夹作为根目录即可。请确保硬盘在传输过程中保持连接。macOS 用户还需在"完全磁盘访问权限"中授权 Vivi Drop',
  },
  {
    question: '电脑休眠后传输会中断吗？',
    answer:
      '会。电脑进入休眠后网络连接断开，传输会暂停。唤醒后手机会自动重连，已完成的文件不受影响，队列中未完成的会继续',
  },
];

interface ErrorCard {
  icon: LucideIcon;
  title: string;
  description: string;
}

const errorCards: ErrorCard[] = [
  {
    icon: Wifi,
    title: '连接异常',
    description: '检查电脑和手机是否在同一局域网，确认系统网络权限已开启，尝试重新连接',
  },
  {
    icon: HardDrive,
    title: '磁盘空间不足',
    description: '剩余空间低于 500MB 时系统会暂停接收，请清理磁盘或更换存储路径',
  },
  {
    icon: AlertTriangle,
    title: '设备中断',
    description: '设备离线、电脑休眠或网络中断时任务暂停，恢复连接后可继续传输',
  },
  {
    icon: UploadCloud,
    title: '上传中断',
    description: '传输异常时已完成的文件会保留，未完成的任务可在恢复连接后自动重试',
  },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function HelpPage() {
  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto max-w-2xl px-6 py-8">
        {/* Header */}
        <h1 className="mb-1 text-xl font-semibold text-foreground">帮助中心</h1>
        <p className="mb-8 text-sm text-muted-foreground">
          为您了解和使用 Vivi Drop 提供全面的指导信息
        </p>

        {/* ---- Quick Start ---- */}
        <section className="mb-8">
          <h2 className="mb-4 text-base font-semibold text-foreground">🚀 快速开始</h2>
          <GlassCard className="p-5">
            <ol className="space-y-4">
              {quickStartSteps.map((step, idx) => (
                <li key={idx} className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500 text-xs font-bold text-white">
                    {idx + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-foreground">{step.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </GlassCard>
        </section>

        {/* ---- Directory Explanation ---- */}
        <section className="mb-8">
          <h2 className="mb-4 text-base font-semibold text-foreground">📁 目录说明</h2>
          <div className="grid grid-cols-2 gap-4">
            {directoryCards.map((card) => (
              <GlassCard key={card.title} className="p-4">
                <p className="mb-2 text-sm font-semibold text-foreground">{card.title}</p>
                <ul className="space-y-1">
                  {card.points.map((pt, i) => (
                    <li key={i} className="text-xs leading-relaxed text-muted-foreground">
                      • {pt}
                    </li>
                  ))}
                </ul>
              </GlassCard>
            ))}
          </div>

          {/* Directory tree */}
          <GlassCard className="mt-4 p-4">
            <pre className="whitespace-pre font-mono text-xs leading-relaxed text-foreground">
              {directoryTree}
            </pre>
          </GlassCard>
        </section>

        {/* ---- System Permission Guide ---- */}
        <section className="mb-8">
          <h2 className="mb-4 text-base font-semibold text-foreground">🔐 系统权限指引</h2>

          {/* macOS */}
          <div className="mb-3 flex items-center gap-2">
            <Apple className="h-4 w-4 text-gray-700" />
            <span className="text-sm font-semibold text-foreground">macOS</span>
          </div>
          <div className="mb-5 grid grid-cols-2 gap-4">
            {macPermissionSections.map((section) => {
              const Icon = section.icon;
              return (
                <GlassCard key={`mac-${section.title}`} className="p-4">
                  <div className="mb-2.5 flex items-center gap-2">
                    <Icon className="h-4 w-4 text-blue-600" />
                    <span className="text-sm font-semibold text-foreground">{section.title}</span>
                  </div>
                  <ol className="space-y-1.5 pl-1">
                    {section.steps.map((step, i) => (
                      <li key={i} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                        <span className="shrink-0 text-muted-foreground/60">{i + 1}.</span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </GlassCard>
              );
            })}
          </div>

          {/* Windows */}
          <div className="mb-3 flex items-center gap-2">
            <Monitor className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-semibold text-foreground">Windows</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {windowsPermissionSections.map((section) => {
              const Icon = section.icon;
              return (
                <GlassCard key={`win-${section.title}`} className="p-4">
                  <div className="mb-2.5 flex items-center gap-2">
                    <Icon className="h-4 w-4 text-blue-600" />
                    <span className="text-sm font-semibold text-foreground">{section.title}</span>
                  </div>
                  <ol className="space-y-1.5 pl-1">
                    {section.steps.map((step, i) => (
                      <li key={i} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                        <span className="shrink-0 text-muted-foreground/60">{i + 1}.</span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </GlassCard>
              );
            })}
          </div>
        </section>

        {/* ---- Upload Rules ---- */}
        <section className="mb-8">
          <h2 className="mb-4 text-base font-semibold text-foreground">📤 上传规则说明</h2>
          <GlassCard className="p-5">
            <ul className="space-y-1.5">
              {uploadRules.map((rule, i) => (
                <li key={i} className="text-xs leading-relaxed text-muted-foreground">
                  • {rule}
                </li>
              ))}
            </ul>
          </GlassCard>
        </section>

        {/* ---- FAQ ---- */}
        <section className="mb-8">
          <h2 className="mb-4 text-base font-semibold text-foreground">❓ 常见问题</h2>
          <GlassCard className="px-5">
            <Accordion type="multiple">
              {faqItems.map((item, idx) => (
                <AccordionItem key={idx} value={`faq-${idx}`}>
                  <AccordionTrigger className="text-sm font-medium text-foreground">
                    {item.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-xs leading-relaxed text-muted-foreground">
                    {item.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </GlassCard>
        </section>

        {/* ---- Error Handling ---- */}
        <section className="mb-8">
          <h2 className="mb-4 text-base font-semibold text-foreground">⚠️ 异常处理说明</h2>
          <div className="grid grid-cols-2 gap-4">
            {errorCards.map((card) => {
              const Icon = card.icon;
              return (
                <GlassCard key={card.title} className="p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Icon className="h-4 w-4 text-orange-500" />
                    <span className="text-sm font-semibold text-foreground">{card.title}</span>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {card.description}
                  </p>
                </GlassCard>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
