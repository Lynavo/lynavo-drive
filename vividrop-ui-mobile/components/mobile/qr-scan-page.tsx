"use client"

import { useState, useEffect } from "react"
import { ArrowLeft, Monitor, ChevronRight } from "lucide-react"

interface QrScanPageProps {
  onBack: () => void
  onScanSuccess: (deviceInfo: { name: string; ip: string }) => void
  onManualInput?: () => void
  onNavigateHelp?: () => void
}

export function QrScanPage({ onBack, onScanSuccess, onManualInput, onNavigateHelp }: QrScanPageProps) {
  const [scanning, setScanning] = useState(true)
  const [showManualModal, setShowManualModal] = useState(false)
  const [code, setCode] = useState("")

  // Simulate auto scan success after 6s for demo
  useEffect(() => {
    const timer = setTimeout(() => {
      onScanSuccess({ name: "PC-20210821CWWC", ip: "192.168.0.122" })
    }, 6000)
    return () => clearTimeout(timer)
  }, [onScanSuccess])

  const handleManualSubmit = () => {
    if (code.trim().length === 6) {
      setShowManualModal(false)
      onScanSuccess({ name: "手动连接设备", ip: "192.168.0.1" })
    }
  }

  return (
    <div
      className="relative flex min-h-screen w-full flex-col overflow-hidden"
      style={{ background: "#0d1117" }}
    >
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2"
        style={{
          width: 340,
          height: 340,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(59,159,216,0.10) 0%, transparent 70%)",
        }}
      />

      {/* Header */}
      <header className="relative z-10 flex items-center gap-3 px-4 pt-14 pb-4">
        <button
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-full transition-all active:scale-90"
          style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.10)" }}
          aria-label="返回"
        >
          <ArrowLeft className="h-4 w-4 text-white" />
        </button>
        <h1 className="text-[17px] font-semibold text-white">{"连接设备"}</h1>
      </header>

      {/* Scan area */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-8 px-6">

        {/* Viewfinder */}
        <div className="relative flex items-center justify-center" style={{ width: 240, height: 240 }}>

          {/* Dark overlay corners (vignette feel) */}
          <div
            className="absolute inset-0 rounded-3xl"
            style={{ boxShadow: "inset 0 0 40px rgba(0,0,0,0.5)" }}
          />

          {/* Simulated camera feed */}
          <div
            className="absolute inset-0 rounded-3xl overflow-hidden"
            style={{ background: "linear-gradient(145deg, #1c2330 0%, #151c25 50%, #1a2030 100%)" }}
          >
            {/* Subtle grid pattern */}
            <div
              className="absolute inset-0 opacity-10"
              style={{
                backgroundImage: "linear-gradient(rgba(59,159,216,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(59,159,216,0.4) 1px, transparent 1px)",
                backgroundSize: "24px 24px",
              }}
            />
          </div>

          {/* Corner brackets */}
          <svg
            className="absolute inset-0 z-10"
            width="240"
            height="240"
            viewBox="0 0 240 240"
            fill="none"
          >
            {/* Top-left */}
            <path d="M2 48 L2 18 Q2 2 18 2 L48 2" stroke="#3b9fd8" strokeWidth="3" strokeLinecap="round" />
            {/* Top-right */}
            <path d="M192 2 L222 2 Q238 2 238 18 L238 48" stroke="#3b9fd8" strokeWidth="3" strokeLinecap="round" />
            {/* Bottom-left */}
            <path d="M2 192 L2 222 Q2 238 18 238 L48 238" stroke="#3b9fd8" strokeWidth="3" strokeLinecap="round" />
            {/* Bottom-right */}
            <path d="M192 238 L222 238 Q238 238 238 222 L238 192" stroke="#3b9fd8" strokeWidth="3" strokeLinecap="round" />
          </svg>

          {/* Scanning line */}
          {scanning && (
            <div className="absolute inset-x-4 z-20 h-px" style={{ animation: "scanLine 2.4s ease-in-out infinite" }}>
              <div
                className="h-full w-full"
                style={{
                  background: "linear-gradient(90deg, transparent 0%, #3b9fd8 30%, #7dd3fc 50%, #3b9fd8 70%, transparent 100%)",
                  boxShadow: "0 0 12px 2px rgba(59,159,216,0.6)",
                }}
              />
            </div>
          )}
        </div>

        {/* Liquid Glass hint card */}
        <div
          className="flex w-full items-start gap-3 rounded-2xl px-4 py-4"
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.10)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
          }}
        >
          <div
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
            style={{ background: "rgba(59,159,216,0.15)", border: "1px solid rgba(59,159,216,0.20)" }}
          >
            <Monitor className="h-4 w-4" style={{ color: "#7dd3fc" }} />
          </div>
          <div className="flex-1">
            <p className="text-[13px] font-semibold leading-snug" style={{ color: "rgba(255,255,255,0.90)" }}>
              {"如何获取二维码？"}
            </p>
            <p className="mt-1 text-[12px] leading-relaxed" style={{ color: "rgba(255,255,255,0.50)" }}>
              {"打开电脑端 Vivi Drop，在「全局设置」中找到连接码，用摄像头对准二维码即可自动连接。"}
            </p>
            <button
              onClick={onNavigateHelp}
              className="mt-2 text-[12px] font-medium transition-opacity active:opacity-60"
              style={{ color: "rgba(125,211,252,0.90)" }}
            >
              {"查看详细图文教程 >"}
            </button>
          </div>
        </div>

        {/* Back to device list entry */}
        <button
          onClick={onBack}
          className="flex w-full items-center justify-between rounded-2xl px-4 py-4 transition-all active:scale-[0.98]"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div className="flex flex-col items-start gap-0.5">
            <p className="text-[13px] font-medium" style={{ color: "rgba(255,255,255,0.75)" }}>
              {"扫描遇到问题？"}
            </p>
            <p className="text-[12px]" style={{ color: "rgba(255,255,255,0.35)" }}>
              {"返回设备列表，手动选择设备并输入连接码"}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "rgba(255,255,255,0.25)" }} />
        </button>
      </div>

      {/* Manual code modal */}
      {showManualModal && (
        <div
          className="absolute inset-0 z-50 flex items-end justify-center"
          style={{ background: "rgba(0,0,0,0.60)" }}
          onClick={() => setShowManualModal(false)}
        >
          <div
            className="w-full rounded-t-3xl px-6 pt-6 pb-10"
            style={{
              background: "rgba(20,26,35,0.98)",
              border: "1px solid rgba(255,255,255,0.08)",
              backdropFilter: "blur(30px)",
              WebkitBackdropFilter: "blur(30px)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle */}
            <div className="mx-auto mb-5 h-1 w-10 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }} />

            <p className="mb-1 text-[17px] font-semibold text-white">{"输入连接码"}</p>

            {/* Code input boxes */}
            <div className="mb-5 flex gap-2.5 mt-5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="flex-1 flex items-center justify-center rounded-xl py-4 text-xl font-bold text-white"
                  style={{
                    background: code[i] ? "rgba(59,159,216,0.15)" : "rgba(255,255,255,0.06)",
                    border: code[i] ? "1px solid rgba(59,159,216,0.40)" : "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  {code[i] ?? ""}
                </div>
              ))}
            </div>

            {/* Hidden input */}
            <input
              type="number"
              value={code}
              onChange={(e) => setCode(e.target.value.slice(0, 6))}
              className="sr-only"
              autoFocus
              maxLength={6}
            />

            <button
              onClick={handleManualSubmit}
              disabled={code.length < 6}
              className="w-full rounded-2xl py-4 text-[15px] font-semibold text-white transition-all disabled:opacity-30"
              style={{
                background: code.length === 6 ? "#3b9fd8" : "rgba(255,255,255,0.10)",
              }}
            >
              {"连接"}
            </button>

            {/* Instructional callout */}
            <div
              className="mt-5 flex items-start gap-3 rounded-2xl px-4 py-4"
              style={{
                background: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.10)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
              }}
            >
              {/* PC + gear icon */}
              <div
                className="relative mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                style={{ background: "rgba(59,159,216,0.14)", border: "1px solid rgba(59,159,216,0.20)" }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <rect x="2" y="3" width="20" height="13" rx="2" stroke="#7dd3fc" strokeWidth="1.6" />
                  <path d="M8 20h8M12 16v4" stroke="#7dd3fc" strokeWidth="1.6" strokeLinecap="round" />
                  <circle cx="12" cy="9.5" r="2" stroke="#7dd3fc" strokeWidth="1.4" />
                  <path d="M12 7v-1M12 13v-1M9.5 9.5h-1M14.5 9.5h1" stroke="#7dd3fc" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold leading-snug" style={{ color: "rgba(255,255,255,0.90)" }}>
                  {"去哪里找连接码和 IP？"}
                </p>
                <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: "rgba(255,255,255,0.48)" }}>
                  {"请在电脑端 Vivi Drop 左侧导航栏点击「全局设置」，即可查看 6 位连接码、设备 IP 或展示二维码。"}
                </p>
                <button
                  onClick={onNavigateHelp}
                  className="mt-2 text-[12px] font-medium transition-opacity active:opacity-60"
                  style={{ color: "rgba(125,211,252,0.90)" }}
                >
                  {"查看详细图文教程 >"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes scanLine {
          0%   { top: 16px;  opacity: 0; }
          8%   { opacity: 1; }
          92%  { opacity: 1; }
          100% { top: 216px; opacity: 0; }
        }
      `}</style>
    </div>
  )
}
