"use client"

import { useState, useRef, useCallback } from "react"
import {
  ArrowLeft, Wifi, ScanLine, Hash,
  CheckCircle2, ChevronRight, AlertTriangle,
  Monitor, QrCode, KeyRound,
} from "lucide-react"

interface ConnectionTutorialPageProps {
  onBack: () => void
  onNavigateQrScan?: () => void
  onNavigateScan?: () => void
}

type TabId = "lan" | "qr" | "code" | "ip"

const TABS: { id: TabId; label: string }[] = [
  { id: "lan",  label: "搜索" },
  { id: "qr",   label: "扫码" },
  { id: "code", label: "连接码" },
  { id: "ip",   label: "IP直连" },
]

// ── Visual illustrations ───────────────────────────────────────────────────────

function LanVisual() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-5">
      {/* Wi-Fi ring */}
      <div className="relative flex items-center justify-center">
        <div className="absolute h-28 w-28 rounded-full border-2 animate-ping opacity-10" style={{ borderColor: "#3b82f6" }} />
        <div className="absolute h-20 w-20 rounded-full border-2 animate-ping opacity-20 delay-200" style={{ borderColor: "#3b82f6", animationDelay: "0.4s" }} />
        <div
          className="flex h-14 w-14 items-center justify-center rounded-full"
          style={{ background: "rgba(59,130,246,0.12)", border: "2px solid rgba(59,130,246,0.25)" }}
        >
          <Wifi className="h-7 w-7" style={{ color: "#2563eb" }} />
        </div>
      </div>
      {/* Phone + PC */}
      <div className="flex items-center gap-6 mt-2">
        <div className="flex flex-col items-center gap-1">
          <div className="h-10 w-6 rounded-lg border-2 flex items-center justify-center" style={{ borderColor: "#93c5fd", background: "rgba(219,234,254,0.5)" }}>
            <div className="h-1.5 w-1.5 rounded-full" style={{ background: "#3b82f6" }} />
          </div>
          <span className="text-[10px]" style={{ color: "#94a3b8" }}>手机</span>
        </div>
        <div className="flex gap-1 items-center">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-1.5 w-1.5 rounded-full" style={{ background: i === 1 ? "#3b82f6" : "rgba(59,130,246,0.3)" }} />
          ))}
        </div>
        <div className="flex flex-col items-center gap-1">
          <div className="h-8 w-12 rounded-md border-2 flex items-center justify-center" style={{ borderColor: "#93c5fd", background: "rgba(219,234,254,0.5)" }}>
            <Monitor className="h-4 w-4" style={{ color: "#3b82f6" }} />
          </div>
          <span className="text-[10px]" style={{ color: "#94a3b8" }}>电脑</span>
        </div>
      </div>
    </div>
  )
}

function QrVisual() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      {/* Simulated QR frame */}
      <div className="relative">
        <div
          className="h-32 w-32 rounded-2xl flex items-center justify-center"
          style={{ background: "rgba(219,234,254,0.4)", border: "2px solid rgba(59,130,246,0.2)" }}
        >
          <QrCode className="h-16 w-16" style={{ color: "#2563eb", opacity: 0.6 }} />
        </div>
        {/* Scan line animation */}
        <div
          className="absolute left-2 right-2 h-0.5 rounded-full animate-bounce"
          style={{ background: "linear-gradient(90deg, transparent, #3b82f6, transparent)", top: "30%", animationDuration: "1.8s" }}
        />
        {/* Corner brackets */}
        {[["top-0 left-0","border-t-2 border-l-2 rounded-tl-lg"], ["top-0 right-0","border-t-2 border-r-2 rounded-tr-lg"],
          ["bottom-0 left-0","border-b-2 border-l-2 rounded-bl-lg"], ["bottom-0 right-0","border-b-2 border-r-2 rounded-br-lg"]
        ].map(([pos, cls], i) => (
          <div key={i} className={`absolute h-5 w-5 ${pos} ${cls}`} style={{ borderColor: "#2563eb" }} />
        ))}
      </div>
      <p className="text-[12px]" style={{ color: "#94a3b8" }}>用摄像头对准 PC 端显示的二维码</p>
    </div>
  )
}

function CodeVisual() {
  const digits = ["3", "8", "5", "2", "1", "7"]
  return (
    <div className="flex flex-col items-center justify-center h-full gap-5">
      {/* Mini PC screen mock */}
      <div
        className="rounded-2xl px-5 py-4 flex flex-col items-center gap-3"
        style={{ background: "rgba(219,234,254,0.35)", border: "1px solid rgba(59,130,246,0.18)" }}
      >
        <p className="text-[11px] font-medium" style={{ color: "#64748b" }}>PC 端「全局设置」连接码</p>
        <div className="flex gap-2">
          {digits.map((d, i) => (
            <div
              key={i}
              className="h-9 w-8 rounded-xl flex items-center justify-center text-[16px] font-bold"
              style={{ background: "#fff", color: "#1e40af", boxShadow: "0 1px 6px rgba(59,130,210,0.12)" }}
            >
              {d}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg px-3 py-1" style={{ background: "rgba(59,130,246,0.10)" }}>
            <KeyRound className="h-3 w-3" style={{ color: "#3b82f6" }} />
            <span className="text-[11px] font-medium" style={{ color: "#2563eb" }}>手动重新生成</span>
          </div>
        </div>
      </div>
      <p className="text-[12px] text-center px-4 leading-relaxed" style={{ color: "#94a3b8" }}>{"以上为 PC 端连接码示例，请以电脑上实际显示的数字为准"}</p>
    </div>
  )
}

function IpVisual() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      {/* PC monitor with settings icon */}
      <div className="relative flex items-center justify-center">
        <div
          className="flex h-20 w-28 items-center justify-center rounded-2xl"
          style={{ background: "rgba(219,234,254,0.45)", border: "2px solid rgba(59,130,246,0.22)" }}
        >
          <Monitor className="h-10 w-10" style={{ color: "#2563eb", opacity: 0.7 }} />
        </div>
        {/* Gear badge */}
        <div
          className="absolute -top-2 -right-2 flex h-7 w-7 items-center justify-center rounded-full"
          style={{ background: "#eff6ff", border: "2px solid rgba(59,130,246,0.25)" }}
        >
          <ScanLine className="h-3.5 w-3.5" style={{ color: "#2563eb" }} />
        </div>
      </div>
      {/* IP label */}
      <div
        className="flex items-center gap-2 rounded-xl px-4 py-2"
        style={{ background: "rgba(255,255,255,0.75)", border: "1px solid rgba(59,130,246,0.18)" }}
      >
        <div className="h-2 w-2 rounded-full animate-pulse" style={{ background: "#22c55e" }} />
        <span className="text-[13px] font-mono font-semibold" style={{ color: "#1e40af" }}>{"192.168.1.x"}</span>
      </div>
      <p className="text-[11px]" style={{ color: "#94a3b8" }}>{"PC 端广播 IP 示例"}</p>
    </div>
  )
}

// ── Slide cards data ────────────────────────────────────────────────────────────

const CARDS: Record<TabId, {
  visual: React.ReactNode
  steps: string[]
  warn?: string
}> = {
  lan: {
    visual: <LanVisual />,
    steps: [
      "确保手机与电脑接入同一个 Wi-Fi 网络",
      "在电脑打开 Vivi Drop 客户端并保持运行",
      "手机端点击「搜索设备」，稍等片刻即可发现电脑",
    ],
    warn: "如在公司网络，请确认未开启网络隔离；如开了 VPN 请先关闭后再搜索。",
  },
  qr: {
    visual: <QrVisual />,
    steps: [
      "在电脑端 Vivi Drop「全局设置」中展示二维码",
      "手机端点击「扫码配对」打开摄像头",
      "对准屏幕上的二维码，自动识别完成配对",
    ],
  },
  code: {
    visual: <CodeVisual />,
    steps: [
      "在电脑端「全局设置 → 连接码管理」中查看 6 位数字",
      "连接码不会自动刷新，需手动点击「重新生成」才会变更",
      "在手机端输入连接码，点击连接完成配对",
    ],
  },
  ip: {
    visual: <IpVisual />,
    steps: [
      "在电脑端左侧导航栏打开「全局设置」",
      "划至最底部，找到「广播 IP（iPhone 连接地址）」",
      "在手机端「手动配对」中输入该地址并连接",
    ],
  },
}

// ── Troubleshoot bottom sheet ──────────────────────────────────────────────────

const TROUBLESHOOT_ITEMS = [
  "确认手机与电脑在同一 Wi-Fi 下，公司网络请关闭「网络隔离」。",
  "检查电脑是否开启了 VPN，如有请先关闭后重新搜索。",
  "仍然无法连接？尝试使用「输入连接码」手动配对方式。",
]

function TroubleshootSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const dragStartY = useRef<number>(0)

  const handleSheetTouchStart = (e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY
  }
  const handleSheetTouchEnd = (e: React.TouchEvent) => {
    const dy = e.changedTouches[0].clientY - dragStartY.current
    if (dy > 48) onClose()
  }

  return (
    <>
      {/* Overlay */}
      <div
        className="absolute inset-0 z-40 transition-opacity"
        style={{
          background: "rgba(0,0,0,0.35)",
          backdropFilter: "blur(2px)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
        }}
        onClick={onClose}
      />

      {/* Bottom sheet */}
      <div
        ref={sheetRef}
        className="absolute left-0 right-0 bottom-0 z-50 rounded-t-3xl"
        style={{
          background: "#fff",
          boxShadow: "0 -4px 32px rgba(0,0,0,0.12)",
          transform: open ? "translateY(0%)" : "translateY(100%)",
          transition: "transform 0.32s cubic-bezier(0.32,0.72,0,1)",
        }}
        onTouchStart={handleSheetTouchStart}
        onTouchEnd={handleSheetTouchEnd}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full" style={{ background: "#e2e8f0" }} />
        </div>

        {/* Header */}
        <div className="flex items-center gap-2 px-5 pt-2 pb-4">
          <AlertTriangle className="h-5 w-5 shrink-0" style={{ color: "#f59e0b" }} />
          <h3 className="text-[16px] font-bold" style={{ color: "#1a3a5c" }}>{"连接排障指南"}</h3>
        </div>

        {/* Items */}
        <div className="px-5 pb-2 space-y-4">
          {TROUBLESHOOT_ITEMS.map((t, i) => (
            <div key={i} className="flex items-start gap-3">
              <div
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                style={{ background: "rgba(245,158,11,0.12)", color: "#d97706" }}
              >
                {i + 1}
              </div>
              <p className="text-[13px] leading-relaxed" style={{ color: "#475569" }}>{t}</p>
            </div>
          ))}
        </div>

        {/* Contact support divider */}
        <div className="mx-5 mt-5 mb-4" style={{ borderTop: "1px solid #f1f5f9" }} />

        {/* Contact support row */}
        <div className="px-5 pb-2">
          <p className="text-[13px] font-semibold" style={{ color: "#1a3a5c" }}>{"仍然无法解决？"}</p>
          <p className="text-[12px] mt-1 leading-relaxed" style={{ color: "#64748b" }}>
            {"发邮件联系我们，通常 24 小时内回复："}
          </p>
          <p className="text-[13px] font-semibold mt-1" style={{ color: "#2563eb" }}>{"support@vividrop.cn"}</p>
        </div>

        {/* safe area spacer */}
        <div className="h-6" />
      </div>
    </>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function ConnectionTutorialPage({
  onBack,
  onNavigateQrScan,
  onNavigateScan,
}: ConnectionTutorialPageProps) {
  const TAB_IDS: TabId[] = ["lan", "qr", "code", "ip"]
  const [activeTab, setActiveTab] = useState<TabId>("lan")
  const [cardIndex, setCardIndex] = useState(0)
  const [sheetOpen, setSheetOpen] = useState(false)

  // Touch swipe handling
  const touchStartX = useRef<number>(0)
  const trackRef = useRef<HTMLDivElement>(null)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }, [])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current
    if (Math.abs(dx) < 40) return
    const dir = dx < 0 ? 1 : -1
    const next = Math.max(0, Math.min(TAB_IDS.length - 1, cardIndex + dir))
    setCardIndex(next)
    setActiveTab(TAB_IDS[next])
  }, [cardIndex])

  const goToTab = (id: TabId) => {
    const idx = TAB_IDS.indexOf(id)
    setCardIndex(idx)
    setActiveTab(id)
  }

  const card = CARDS[activeTab]

  return (
    <div
      className="relative flex flex-col overflow-hidden"
      style={{
        height: "100%",
        background: "linear-gradient(160deg, #e8f0fb 0%, #f0f6ff 50%, #e6effa 100%)",
      }}
    >
      {/* ── Top nav ── */}
      <div className="flex items-center gap-3 px-4 pt-14 pb-3 shrink-0">
        <button
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-full transition-colors active:bg-black/5"
          style={{ color: "#1a3a5c" }}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-[17px] font-semibold" style={{ color: "#1a3a5c" }}>{"连接教程"}</h1>
      </div>

      {/* ── Prereq banner ── */}
      <div className="px-4 shrink-0">
        <div
          className="flex items-center gap-2.5 rounded-2xl px-4 py-2.5 mb-3"
          style={{ background: "rgba(37,99,235,0.07)", border: "1px solid rgba(37,99,235,0.13)" }}
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: "#2563eb" }} />
          <p className="text-[12px] font-medium leading-snug" style={{ color: "#1e40af" }}>
            {"��提：请确保电脑已安装并打开 Vivi Drop 客户端"}
          </p>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="px-4 mb-4 shrink-0">
        <div
          className="flex rounded-2xl p-1 gap-1"
          style={{ background: "rgba(255,255,255,0.55)", backdropFilter: "blur(8px)" }}
        >
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => goToTab(tab.id)}
              className="flex-1 rounded-xl py-2 text-[12px] font-semibold transition-all"
              style={activeTab === tab.id
                ? { background: "#2563eb", color: "#fff" }
                : { color: "#7a90a4" }
              }
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Swipeable card area ── */}
      <div
        className="flex-1 px-4 min-h-0"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        ref={trackRef}
      >
        <div
          className="flex flex-col h-full rounded-3xl overflow-hidden"
          style={{
            background: "rgba(255,255,255,0.88)",
            backdropFilter: "blur(16px)",
            boxShadow: "0 4px 24px rgba(59,130,210,0.11)",
            border: "1px solid rgba(255,255,255,0.7)",
          }}
        >
          {/* Visual area — top half */}
          <div
            className="shrink-0"
            style={{ height: "44%", background: "linear-gradient(160deg, #dbeafe 0%, #eff6ff 100%)" }}
          >
            {card.visual}
          </div>

          {/* Steps — bottom half */}
          <div className="flex-1 px-5 py-5 flex flex-col justify-between min-h-0">
            <div className="space-y-3.5">
              {card.steps.map((step, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                    style={{ background: "rgba(37,99,235,0.10)", color: "#2563eb" }}
                  >
                    {i + 1}
                  </div>
                  <p className="text-[13.5px] leading-relaxed pt-0.5" style={{ color: "#334155" }}>
                    {step}
                  </p>
                </div>
              ))}
            </div>

            {/* Download hint — LAN tab only */}
            {activeTab === "lan" && (
              <p className="text-[11.5px] leading-relaxed mt-3" style={{ color: "#94a3b8" }}>
                {"还没有电脑端？请在电脑浏览器访问 "}
                <span className="font-semibold" style={{ color: "#2563eb" }}>{"www.vividrop.cn"}</span>
                {" 下载安装"}
              </p>
            )}

            {/* Troubleshoot CTA — lan, qr and ip cards */}
            {(activeTab === "lan" || activeTab === "qr" || activeTab === "ip") && (
              <button
                onClick={() => setSheetOpen(true)}
                className="mt-4 w-full flex items-center rounded-2xl px-3.5 py-3 transition-opacity active:opacity-80"
                style={{
                  background: "rgba(255,237,213,0.7)",
                  border: "1px solid rgba(251,146,60,0.30)",
                }}
              >
                <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: "#d97706" }} />
                <span className="ml-2.5 flex-1 text-left text-[13px] font-semibold" style={{ color: "#92400e" }}>
                  {"一直搜不到设备？"}
                </span>
                <span className="text-[12px] font-medium" style={{ color: "#2563eb" }}>{"查看排障指南 >"}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Dot indicators ── */}
      <div className="flex items-center justify-center gap-2 py-3 shrink-0">
        {TAB_IDS.map((id, i) => (
          <button
            key={id}
            onClick={() => goToTab(id)}
            className="rounded-full transition-all"
            style={{
              height: 6,
              width: activeTab === id ? 20 : 6,
              background: activeTab === id ? "#2563eb" : "rgba(59,130,246,0.25)",
            }}
          />
        ))}
      </div>

      {/* ── Troubleshoot bottom sheet (triggered from card CTA) ── */}
      <TroubleshootSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </div>
  )
}
