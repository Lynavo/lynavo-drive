"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

const helpSections = [
  { id: "intro", label: "基础功能介绍" },
  { id: "guide", label: "首次使用引导" },
  { id: "upload", label: "上传与共享说明" },
  { id: "faq", label: "常见问题" },
  { id: "contact", label: "联系我们" },
] as const

type HelpSectionId = (typeof helpSections)[number]["id"]

function HelpEntry({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-white/70 bg-white/52 px-4 py-3.5">
      <p className="text-[13px] font-semibold text-[#17191c]">{title}</p>
      <p className="mt-1.5 text-xs leading-5 text-[#59616d]">{body}</p>
    </div>
  )
}

function SectionContent({ section }: { section: HelpSectionId }) {
  if (section === "intro") {
    return (
      <div className="flex flex-col gap-2.5">
        <HelpEntry
          title="ViviDrop 是什么"
          body="ViviDrop 是一款局域网素材同步工具，帮助短视频团队将手机素材无缝传输到 PC 端。只要手机和电脑处于同一 Wi-Fi 环境，即可一键连接、自动同步。"
        />
        <HelpEntry
          title="如何连接电脑"
          body="打开 App 后扫描局域网内的 ViviDrop PC 端，或使用 PC 端的二维码扫码直连。连接成功后即可开始上传。"
        />
        <HelpEntry
          title="如何上传素材"
          body="支持自动上传和手动上传两种方式。自动上传在后台静默同步新增素材；手动上传可在相册中勾选照片和视频后一次性提交。"
        />
        <HelpEntry
          title="如何访问共享目录"
          body="在首页点击「共享目录」可浏览电脑端的共享文件夹，支持预览图片和视频，订阅用户还可下载文件到手机。"
        />
      </div>
    )
  }

  if (section === "guide") {
    const steps = [
      {
        title: "连接电脑",
        body: "确保手机和电脑在同一 Wi-Fi 下，打开 ViviDrop PC 端，在手机端点击「扫描设备」找到电脑并连接，或使用 PC 端二维码扫码。",
      },
      {
        title: "开启自动上传",
        body: "进入相册页，展开「自动上传」面板，打开开关。此后新增素材将在后台自动传输到电脑，无需手动操作。",
      },
      {
        title: "手动上传",
        body: "在相册页勾选想要上传的照片或视频（已传输的素材会置灰），点击底部「上传」按钮提交到传输队列。",
      },
      {
        title: "查看共享目录",
        body: "在首页点击「共享目录」卡片，浏览电脑端共享文件夹中的内容，可预览图片和视频，订阅用户可下载文件。",
      },
    ]
    return (
      <ol className="flex flex-col gap-2.5">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3 rounded-lg border border-white/70 bg-white/52 px-4 py-3.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1677d2] text-xs font-bold text-white [font-variant-numeric:tabular-nums]">
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-[#17191c]">{step.title}</p>
              <p className="mt-1.5 text-xs leading-5 text-[#59616d]">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    )
  }

  if (section === "upload") {
    return (
      <div className="flex flex-col gap-2.5">
        <HelpEntry
          title="自动上传 vs 手动上传"
          body="自动上传在后台持续监听相册新增素材，连接期间静默同步，无需用户介入。手动上传则由用户主动在相册页勾选文件提交，适合按需精选传输。"
        />
        <HelpEntry
          title="received 目录与 shared 目录"
          body="received 目录存放从手机传到电脑的所有素材，是上传的默认目标路径。shared 目录是 PC 端设置的共享文件夹，手机端可以浏览和预览，订阅用户可下载其中的文件。"
        />
        <HelpEntry
          title="共享目录是只读访问"
          body="手机端只能浏览和预览共享目录中的内容，无法通过手机端修改、删除或上传文件到共享目录。"
        />
      </div>
    )
  }

  if (section === "faq") {
    const faqs = [
      {
        title: "设备离线怎么办？",
        body: "请确认手机和电脑处于同一 Wi-Fi 网络，且 ViviDrop PC 端正在运行。若电脑已休眠或 PC 端已关闭，请重新启动 PC 端后，手机端点击「刷新」重新扫描。",
      },
      {
        title: "上传失败怎么办？",
        body: "检查网络连接是否稳定，确认 PC 端仍在运行。可在传输页点击失败任务重试，或前往设置页「导出诊断包」获取日志联系客服排查。",
      },
      {
        title: "共享目录为空怎么办？",
        body: "请在 PC 端 ViviDrop 的设置中确认已设置共享目录路径，并确认该目录下有文件。设置完成后在手机端下拉刷新即可。",
      },
      {
        title: "无法连接电脑怎么办？",
        body: "确认手机和电脑在同一局域网；检查电脑防火墙是否拦截了 ViviDrop；尝试重启 PC 端或使用二维码扫码连接。",
      },
      {
        title: "试用期是多久？",
        body: "新用户注册后可免费试用全部功能 7 天，试用结束后需订阅才能继续使用。",
      },
      {
        title: "如何管理订阅？",
        body: "前往「设置 → 管理订阅」即可查看当前订阅状态、有效期，或重新购买。",
      },
    ]
    return (
      <div className="flex flex-col gap-2.5">
        {faqs.map((faq) => (
          <HelpEntry key={faq.title} title={faq.title} body={faq.body} />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      <HelpEntry title="客服邮箱" body="support@vividrop.cn，工作日 24 小时内回复。" />
      <HelpEntry
        title="导出诊断包"
        body="前往「我的 → 导出诊断包」将运行日志发给客服，以协助快速排查问题。"
      />
      <HelpEntry title="反馈入口" body="在「我的 → 意见反馈」中描述问题或建议，我们会持续收集并改进产品。" />
    </div>
  )
}

export function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [activeSection, setActiveSection] = useState<HelpSectionId>("intro")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-0 border-white/70 bg-[#f7fbff]/96 p-0 text-[#17191c] shadow-[0_30px_90px_rgba(23,25,28,0.18)] sm:max-w-[640px]">
        <DialogHeader className="border-b border-white/70 px-5 py-4 text-left">
          <DialogTitle className="text-base font-semibold text-[#17191c]">帮助中心</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1">
          <nav className="flex w-[150px] shrink-0 flex-col gap-1 border-r border-white/70 p-2.5" aria-label="帮助分类">
            {helpSections.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSection(item.id)}
                aria-current={activeSection === item.id ? "true" : undefined}
                className={`rounded-md px-3 py-2 text-left text-[13px] font-medium transition ${
                  activeSection === item.id
                    ? "bg-[#eaf6ff] font-semibold text-[#1677d2]"
                    : "text-[#4f5b68] hover:bg-white/74 hover:text-[#17191c]"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            <SectionContent section={activeSection} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
