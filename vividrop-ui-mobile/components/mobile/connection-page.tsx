"use client"

import { useState, useRef, useEffect } from "react"
import { ArrowLeft } from "lucide-react"

interface ConnectionPageProps {
  onConnect: () => void
  onBack?: () => void
  deviceName?: string
  deviceIp?: string
  onNavigateHelp?: () => void
}

export function ConnectionPage({ onConnect, onBack, deviceName, deviceIp, onNavigateHelp }: ConnectionPageProps) {
  const [code, setCode] = useState<string[]>(Array(6).fill(""))
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const [verifying, setVerifying] = useState(false)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    setTimeout(() => inputRefs.current[0]?.focus(), 80)
  }, [])

  const handleInputChange = (index: number, value: string) => {
    if (verifying) return
    const digit = value.replace(/\D/g, "").slice(-1)
    const newCode = [...code]
    newCode[index] = digit
    setCode(newCode)
    if (digit && index < 5) inputRefs.current[index + 1]?.focus()
    if (digit && index === 5 && newCode.every((d) => d !== "")) {
      setVerifying(true)
      setTimeout(() => { setVerifying(false); onConnect() }, 1200)
    }
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && code[index] === "" && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  const filledCount = code.filter(Boolean).length

  return (
    <div
      className="flex min-h-screen w-full flex-col"
      style={{ background: "linear-gradient(180deg, #c8e6f7 0%, #dff0f9 40%, #f0f8fd 100%)" }}
    >
      {/* ── Top Nav ── */}
      <div className="flex items-center gap-3 px-4 pt-14 pb-3">
        {onBack && (
          <button
            onClick={onBack}
            className="flex h-10 w-10 items-center justify-center rounded-full transition-all active:scale-90 active:bg-black/5"
          >
            <ArrowLeft className="h-5 w-5" style={{ color: "#1a3a5c" }} />
          </button>
        )}
        <h1 className="text-[17px] font-semibold" style={{ color: "#1a3a5c" }}>
          {"连接设备"}
        </h1>
      </div>

      {/* ── Main Content ── */}
      <div className="flex flex-1 flex-col px-5 pt-8 pb-10">

        {/* Device label */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ background: "rgba(59,130,246,0.10)" }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <rect x="2" y="3" width="20" height="13" rx="2" stroke="#3b82f6" strokeWidth="1.8"/>
              <path d="M8 20h8M12 16v4" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="text-[13px]" style={{ color: "#5a7a96" }}>
            {"正在连接："}<span className="font-semibold" style={{ color: "#1a3a5c" }}>{deviceName || "我的电脑"}</span>
            {deviceIp && <span style={{ color: "#94a3b8" }}>{`  ${deviceIp}`}</span>}
          </span>
        </div>

        {/* Prompt */}
        <p className="text-center text-[15px] font-medium mb-8" style={{ color: "#1a3a5c" }}>
          {"请输入 6 位数字连接码"}
        </p>

        {/* ── 6 Input Boxes ── */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
          {code.map((digit, index) => {
            const isFocused = focusedIndex === index
            return (
              <input
                key={index}
                ref={(el) => { inputRefs.current[index] = el }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleInputChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                onFocus={() => setFocusedIndex(index)}
                onBlur={() => setFocusedIndex(null)}
                disabled={verifying}
                className="flex h-[58px] w-[44px] items-center justify-center rounded-2xl text-center text-[22px] font-semibold outline-none transition-all"
                style={{
                  background: isFocused
                    ? "#ffffff"
                    : digit
                    ? "#ffffff"
                    : "#f1f5f9",
                  color: "#1a3a5c",
                  border: isFocused
                    ? "2px solid #3b82f6"
                    : digit
                    ? "1.5px solid rgba(59,130,246,0.22)"
                    : "1.5px solid rgba(148,163,184,0.25)",
                  boxShadow: isFocused
                    ? "0 0 0 4px rgba(59,130,246,0.10)"
                    : digit
                    ? "0 2px 8px rgba(59,130,246,0.08)"
                    : "none",
                }}
              />
            )
          })}
        </div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-1.5 mb-8">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-full transition-all"
              style={{
                width: i < filledCount ? 8 : 5,
                height: 5,
                background: i < filledCount ? "#3b82f6" : "rgba(148,163,184,0.30)",
              }}
            />
          ))}
        </div>

        {/* Verifying state */}
        {verifying && (
          <div className="flex items-center justify-center gap-2 mb-6 text-[13px]" style={{ color: "#3b82f6" }}>
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            <span>{"正在验证连接码…"}</span>
          </div>
        )}

        {/* ── Instructional Callout Card ── */}
        <div
          className="rounded-2xl px-4 py-4 flex flex-col gap-4"
          style={{
            background: "#ffffff",
            border: "1px solid rgba(226,232,240,0.8)",
            boxShadow: "0 2px 12px rgba(15,23,42,0.06)",
          }}
        >
          {/* Row: icon + title + description */}
          <div className="flex items-start gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl mt-0.5"
              style={{ background: "rgba(59,130,246,0.09)", border: "1px solid rgba(59,130,246,0.14)" }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <rect x="2" y="3" width="20" height="13" rx="2" stroke="#3b82f6" strokeWidth="1.6"/>
                <path d="M8 20h8M12 16v4" stroke="#3b82f6" strokeWidth="1.6" strokeLinecap="round"/>
                <circle cx="12" cy="9.5" r="2" stroke="#3b82f6" strokeWidth="1.4"/>
                <path d="M12 7.5v-1M12 12.5v-1M9.5 9.5h-1M14.5 9.5h1" stroke="#3b82f6" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold mb-1" style={{ color: "#1a3a5c" }}>
                {"去哪里找连接码？"}
              </p>
              <p className="text-[12px] leading-relaxed" style={{ color: "#5a7a96" }}>
                {"请在电脑端 Vivi Drop 左侧导航栏点击「全局设置」，即可查看 6 位数字连接码。"}
              </p>
              <p className="text-[11px] mt-1" style={{ color: "#94a3b8" }}>
                {"连接码不会自动刷新，需手动点击「重新生成」才会更新。"}
              </p>
            </div>
          </div>

          {/* 1×6 digit preview row */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] mr-1" style={{ color: "#94a3b8" }}>{"示例"}</span>
            {[3, 8, 5, 2, 1, 7].map((n, i) => (
              <div
                key={i}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[14px] font-bold"
                style={{ background: "rgba(59,130,246,0.08)", color: "#2563eb", border: "1px solid rgba(59,130,246,0.18)" }}
              >
                {n}
              </div>
            ))}
          </div>

          {/* Tutorial link */}
          <button
            onClick={onNavigateHelp}
            className="text-left text-[12px] font-medium transition-opacity active:opacity-60"
            style={{ color: "#2563eb" }}
          >
            {"查看详细图文教程 >"}
          </button>
        </div>
      </div>
    </div>
  )
}
