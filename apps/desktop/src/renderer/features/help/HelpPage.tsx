import { Wifi, FolderX, HardDrive, UploadCloud, Monitor, Apple } from 'lucide-react';
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
    title: '选择根目录',
    description: '首次启动时，选择一个本地文件夹作为根目录（如 D:\\FlowSync_Media）',
  },
  {
    title: '自动生成子目录',
    description: '系统将自动在根目录下创建 received（接收目录）和 shared（共享目录）',
  },
  {
    title: '移动端连接电脑',
    description: '打开手机端 App 并输入 PC 端显示的连接码进行配对',
  },
  {
    title: '上传素材',
    description: '本机素材将自动上传到 received 接收目录',
  },
  {
    title: 'PC 处理成品',
    description: '在 PC 端处理完成后，将成品文件放入 shared 共享目录',
  },
  {
    title: '移动端查看',
    description: '移动端即可实时查看，可在手机上直接分享目录中的成品',
  },
] as const;

const directoryCards = [
  {
    title: '接收目录 (received)',
    points: [
      '用于接收移动端上传的原片、视频等素材',
      '仅供 PC 端处理使用与存储',
      '移动端无法查看此目录中的内容',
    ],
  },
  {
    title: '共享目录 (shared)',
    points: [
      '用于存放 PC 端处理好的作品/视频/成品内容',
      '移动端可查看、预览、播放和下载',
      '移动端只读访问，不能修改、删除、上传',
    ],
  },
] as const;

const directoryTree = `D:\\FlowSync_Media\\
├── received/  （接收移动端上传）
└── shared/    （共享给移动端查看）`;

const windowsPermissionSteps = [
  '首次启用共享时，系统会自动发送文件夹共享的权限请求',
  '如果被系统阻止，请打开"设置" → "隐私与安全性" → "文件和文件夹共享"进行手动开启',
  '如果打开目录失败，请尝试手动授权您的实际基本操作目录',
];

const macPermissionSteps = [
  '打开"系统设置" → "隐私与安全性" → "文件和文件夹"',
  '找到该应用，勾选需要访问的文件夹权限',
  '如果打开目录失败，请查看权限列表中的权限是否包含你的接收/共享目录',
];

const uploadRules = [
  '自动上传在每次打开上传窗口时启用',
  '手动上传和自动上传并行支持文件上传',
  '两者共用同一个传输队列',
  '手动队列入列的文件优先于自动任务扫描的文件',
  '同一时段只会上传一个文件，队列会按顺序逐一上传文件',
];

const faqItems = [
  {
    question: '为什么移动端已连接成功了，却看不到共享文件？',
    answer:
      '可能原因：1) 该 PC 不在线；2) shared 目录为空；3) 目录未被正确共享配置；4) 设备未连接至同一个网络',
  },
  {
    question: '为什么接收目录不能修改？',
    answer:
      '因为系统正在进行文件传输，传输过程中无法切换接收目录。请先停止当前传输，再修改接收目录',
  },
  {
    question: '为什么有些素材没有自动上传？',
    answer:
      '可能原因：1) 该素材已上传过（去重机制）；2) 该文件上传失败（需重试）；3) 该文件不匹配自动扫描设定的格式',
  },
  {
    question: '为什么共享目录里的内容只能查看不能修改？',
    answer:
      '因为移动端对共享目录只拥有只读访问权限，仅支持查看、预览、播放和下载，不能删除、修改或上传文件',
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
    title: '设备离线',
    description: '检查网络连接，确保 PC 和移动设备在同一局域网',
  },
  {
    icon: FolderX,
    title: '目录不可访问',
    description: '检查文件夹权限，查看权限设置或调整路径配置',
  },
  {
    icon: HardDrive,
    title: '空间不足',
    description: '清理磁盘空间或更改接收路径至更大容量的磁盘目录',
  },
  {
    icon: UploadCloud,
    title: '上传中断',
    description: '检查网络连接，传输会自动在下次重新启动时恢复',
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
          快速了解如何使用 FlowSync 进行跨设备文件同步
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
          <GlassCard className="p-5">
            {/* Windows */}
            <div className="mb-5">
              <div className="mb-2 flex items-center gap-2">
                <Monitor className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-semibold text-foreground">Windows 权限设置</span>
              </div>
              <ul className="space-y-1 pl-6">
                {windowsPermissionSteps.map((step, i) => (
                  <li key={i} className="text-xs leading-relaxed text-muted-foreground">
                    • {step}
                  </li>
                ))}
              </ul>
            </div>

            {/* macOS */}
            <div>
              <div className="mb-2 flex items-center gap-2">
                <Apple className="h-4 w-4 text-gray-700" />
                <span className="text-sm font-semibold text-foreground">macOS 权限设置</span>
              </div>
              <ul className="space-y-1 pl-6">
                {macPermissionSteps.map((step, i) => (
                  <li key={i} className="text-xs leading-relaxed text-muted-foreground">
                    • {step}
                  </li>
                ))}
              </ul>
            </div>
          </GlassCard>
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
