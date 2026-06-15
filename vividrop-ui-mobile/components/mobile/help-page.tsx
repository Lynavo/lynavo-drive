"use client"

import { useState } from "react"
import {
  ArrowLeft,
  ChevronDown,
  HelpCircle,
} from "lucide-react"

interface HelpPageProps {
  onBack: () => void
}

// FAQ Data
const FAQS = [
  {
    q: "什么是 ViviDrop Global？",
    a: "ViviDrop Global 是一款无线媒体传输工具，可将手机上的照片和视频通过局域网快速传输到电脑，适合创作者与编辑，以及需要高效移动媒体文件的用户。",
  },
  {
    q: "如何连接我的电脑？",
    a: "首先从 vividrop.cn 下载并安装 ViviDrop 桌面端。然后在手机和电脑上同时打开应用，可扫描电脑屏幕上的二维码，或在桌面应用中手动输入六位连接码完成配对。",
  },
  {
    q: "什么是自动上传？",
    a: "自动上传会在后台将手机上的新照片和视频自动传输到已连接的电脑。开启后，您拍摄的媒体会自动发送，无需手动操作；可在设置中自定义包含的相册。",
  },
  {
    q: "什么是远程访问？",
    a: "远程访问允许您通过互联网连接电脑，不仅限于本地 Wi‑Fi 网络。该功能需要 Pro 订阅，启用后即使不在同一网络也能传输文件。",
  },
  {
    q: "为什么我的设备显示为离线？",
    a: "当 ViviDrop 桌面应用未运行、电脑处于睡眠状态或存在网络问题时，设备会显示为离线。请确认桌面应用已打开且电脑处于唤醒状态；如问题持续，请重启手机和桌面应用。",
  },
  {
    q: "如何切换设备？",
    a: "前往 设置 > 已连接设备 查看所有已配对的电脑，点击任一在线设备右侧的“连接”按钮即可切换活动连接。一次只能连接一台电脑。",
  },
  {
    q: "如何兑换礼品卡？",
    a: "前往 设置 > 我的账户 > 兑换礼品卡，在输入框中输入礼品码并点击“兑换”。若礼品码有效，7 天试用将立即激活。",
  },
]

export function HelpPage({ onBack }: HelpPageProps) {
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null)

  return (
    <div className="flex min-h-screen w-full flex-col" style={{ background: "#F7F9FC" }}>
      {/* Header */}
      <header className="flex items-center gap-3 px-5 pt-14 pb-4">
        <button
          onClick={onBack}
          className="flex h-10 w-10 items-center justify-center rounded-full transition-all active:scale-95"
          style={{ background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}
          aria-label="返回"
        >
          <ArrowLeft className="h-5 w-5" style={{ color: "#1c1c1e" }} />
        </button>
        <h1 className="text-[22px] font-bold tracking-tight" style={{ color: "#1c1c1e" }}>帮助</h1>
      </header>

      <main className="flex-1 px-4 pb-12">
        {/* FAQ Section */}
        <section>
          <p className="text-[11px] font-semibold tracking-wider uppercase px-4 mb-3" style={{ color: "#8e8e93" }}>
            常见问题
          </p>
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: "#ffffff",
              border: "1px solid rgba(0,0,0,0.06)",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            {FAQS.map((item, idx) => {
              const isOpen = expandedFaq === idx
              const isLast = idx === FAQS.length - 1
              return (
                <div
                  key={idx}
                  style={{ borderBottom: !isLast ? "1px solid rgba(0,0,0,0.06)" : "none" }}
                >
                  <button
                    onClick={() => setExpandedFaq(isOpen ? null : idx)}
                    className="flex items-center w-full gap-3 px-4 py-4 text-left transition-colors active:bg-black/[0.02]"
                  >
                    <div
                      className="flex h-9 w-9 items-center justify-center rounded-xl shrink-0"
                      style={{ background: isOpen ? "rgba(99,102,241,0.10)" : "rgba(0,0,0,0.04)" }}
                    >
                      <HelpCircle
                        className="h-[18px] w-[18px]"
                        style={{ color: isOpen ? "#6366f1" : "#8e8e93" }}
                      />
                    </div>
                    <p
                      className="flex-1 text-[15px] font-medium leading-snug pr-2"
                      style={{ color: "#1c1c1e" }}
                    >
                      {item.q}
                    </p>
                    <ChevronDown
                      className="h-5 w-5 shrink-0 transition-transform duration-200"
                      style={{
                        color: "#c7c7cc",
                        transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                      }}
                    />
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 pl-16">
                      <p
                        className="text-[14px] leading-[1.6]"
                        style={{ color: "#6b7280" }}
                      >
                        {item.a}
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </main>
    </div>
  )
}
