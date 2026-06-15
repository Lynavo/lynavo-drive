"use client"

import { useState } from "react"
import { MonitorSmartphone, ScanLine, Zap, Copy, ChevronRight, Check } from "lucide-react"

const DOWNLOAD_URL = "https://www.vividrop.cn/"

const HOW_STEPS = [
  {
    icon: MonitorSmartphone,
    label: "下载 PC 端",
    desc: "在电脑上安装 Vivi Drop",
  },
  {
    icon: ScanLine,
    label: "手机扫码",
    desc: "扫描 PC 端二维码连接",
  },
  {
    icon: Zap,
    label: "开始同步",
    desc: "素材自动传输到电脑",
  },
]

interface OnboardingOverlayProps {
  onDismiss: () => void
  onNavigateScan: () => void
  onNavigateHelp: () => void
}

export function OnboardingOverlay({ onDismiss, onNavigateScan }: OnboardingOverlayProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(DOWNLOAD_URL)
    } catch {
      // fallback for environments without clipboard API
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleGoScan = () => {
    onNavigateScan()
  }

  return (
    <div
      className="flex min-h-screen w-full flex-col items-center justify-center px-5"
      style={{ background: "linear-gradient(160deg, #dceefa 0%, #eaf4fb 60%, #f5faff 100%)" }}
    >
      {/* Skip */}
      <button
        onClick={onDismiss}
        className="absolute top-14 right-5 flex h-8 items-center justify-center rounded-full px-3 transition-all active:scale-90"
        style={{ background: "rgba(26,58,92,0.08)" }}
        aria-label="跳过"
      >
        <span className="text-[13px] font-medium" style={{ color: "#5a7a96" }}>{"跳过"}</span>
      </button>

      {/* Card */}
      <div
        className="w-full rounded-3xl px-5 pt-7 pb-6 flex flex-col"
        style={{
          background: "rgba(255,255,255,0.93)",
          boxShadow: "0 20px 48px rgba(10,30,55,0.15)",
        }}
      >
        {/* Top icon */}
        <div className="flex items-center justify-center mb-5">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{ background: "rgba(59,130,246,0.10)" }}
          >
            <MonitorSmartphone className="h-8 w-8" style={{ color: "#3b82f6" }} />
          </div>
        </div>

        {/* Title */}
        <p className="text-[20px] font-bold text-center mb-1.5 text-balance" style={{ color: "#1a3a5c" }}>
          {"开始使用 Vivi Drop"}
        </p>
        <p className="text-[13px] text-center leading-relaxed mb-5" style={{ color: "#7a90a4" }}>
          {"手机与电脑无线同步素材，三步搞定"}
        </p>

        {/* Three steps */}
        <div className="flex items-start gap-0 mb-6">
          {HOW_STEPS.map((s, i) => {
            const Icon = s.icon
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1.5 relative">
                {/* Connector line */}
                {i < HOW_STEPS.length - 1 && (
                  <div
                    className="absolute top-4 left-1/2 w-full h-px"
                    style={{ background: "rgba(59,130,246,0.18)" }}
                  />
                )}
                <div
                  className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full"
                  style={{ background: "rgba(59,130,246,0.10)" }}
                >
                  <Icon className="h-4 w-4" style={{ color: "#3b82f6" }} />
                </div>
                <span className="text-[11px] font-semibold text-center leading-tight" style={{ color: "#1a3a5c" }}>
                  {s.label}
                </span>
                <span className="text-[10px] text-center leading-tight px-1" style={{ color: "#94a3b8" }}>
                  {s.desc}
                </span>
              </div>
            )
          })}
        </div>

        {/* Divider */}
        <div className="mb-5" style={{ height: "1px", background: "rgba(26,58,92,0.07)" }} />

        {/* URL Card */}
        <div
          className="w-full rounded-2xl flex items-center gap-3 px-4 py-3.5"
          style={{
            background: "rgba(241,245,249,0.85)",
            border: "1px solid rgba(203,213,225,0.7)",
            backdropFilter: "blur(12px)",
          }}
        >
          {/* URL text */}
          <span
            className="flex-1 text-[13px] tracking-tight truncate font-mono"
            style={{ color: "#475569" }}
          >
            {"www.vividrop.cn"}
          </span>

          {/* Copy button */}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all active:scale-95 shrink-0"
            style={{
              background: copied ? "rgba(22,163,74,0.10)" : "rgba(59,130,246,0.10)",
              color: copied ? "#16a34a" : "#2563eb",
            }}
          >
            {copied
              ? <Check className="h-3.5 w-3.5" />
              : <Copy className="h-3.5 w-3.5" />
            }
            <span className="text-[13px] font-semibold">
              {copied ? "已复制" : "复制"}
            </span>
          </button>
        </div>

        <p className="text-[11px] text-center mt-2 mb-2" style={{ color: "#94a3b8" }}>
          {"复制后在电脑浏览器中打开即可下载"}
        </p>

        {/* Go scan text link */}
        <button
          onClick={handleGoScan}
          className="mt-5 flex items-center justify-center gap-1 text-[13px] transition-opacity active:opacity-50"
          style={{ color: "#7a90a4" }}
        >
          {"我已经下载好了，去连接设备"}
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="mt-4 text-[11px] text-center" style={{ color: "#94a3b8" }}>
        {"首次使用引导 · 随时可在帮助页重新查看"}
      </p>
    </div>
  )
}
