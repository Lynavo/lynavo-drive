"use client"

import { useState } from "react"
import {
  Check,
  Copy,
  Save,
  Monitor,
  CheckCircle2,
  Package,
  RefreshCw,
} from "lucide-react"
import { connectionCode } from "@/lib/mock-data"

export function SettingsPage() {
  const [code, setCode] = useState(connectionCode)
  const [deviceName, setDeviceName] = useState("1")
  const [copied, setCopied] = useState<string | null>(null)
  const [nameSaved, setNameSaved] = useState(false)

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  const handleRegenerate = () => {
    const newCode = Math.floor(100000 + Math.random() * 900000).toString()
    setCode(newCode.slice(0, 3) + " " + newCode.slice(3))
  }

  const handleSaveName = () => {
    setNameSaved(true)
    setTimeout(() => setNameSaved(false), 2000)
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="mb-8 text-xl font-bold" style={{ color: "#1a2a3a" }}>
          {"设置"}
        </h1>

        {/* Device Name */}
        <section className="mb-8">
          <h2 className="mb-1 text-sm font-bold" style={{ color: "#1a2a3a" }}>
            {"设备名称"}
          </h2>
          <p className="mb-4 text-xs" style={{ color: "#6b7a8d" }}>
            {"此名称将在局域网中广播，方便手机识别本台电脑"}
          </p>
          <div
            className="rounded-2xl p-5"
            style={{ background: "rgba(255,255,255,0.75)", border: "1px solid rgba(255,255,255,0.9)", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}
          >
            <label className="mb-2 block text-xs font-medium" style={{ color: "#6b7a8d" }}>
              {"设备名称"}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none transition-all focus:ring-2 focus:ring-blue-200"
                style={{ background: "rgba(240,248,255,0.8)", border: "1px solid rgba(59,159,216,0.15)", color: "#1a2a3a" }}
              />
              <button
                onClick={handleSaveName}
                className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all hover:shadow-md"
                style={{ background: "linear-gradient(135deg, #3b9fd8, #60c4f0)", boxShadow: "0 2px 8px rgba(59,159,216,0.3)" }}
              >
                {nameSaved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                {nameSaved ? "已保存" : "保存"}
              </button>
            </div>
          </div>
        </section>

        {/* Connection Code */}
        <section className="mb-8">
          <h2 className="mb-1 text-sm font-bold" style={{ color: "#1a2a3a" }}>
            {"连接码管理"}
          </h2>
          <p className="mb-4 text-xs" style={{ color: "#6b7a8d" }}>
            {"所有设备通过此连接码与电脑配对"}
          </p>
          <div
            className="rounded-2xl p-5"
            style={{ background: "rgba(255,255,255,0.75)", border: "1px solid rgba(255,255,255,0.9)", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}
          >
            <div className="flex items-start gap-6">
              {/* Left: Code digits and buttons */}
              <div className="flex-1">
                <div className="mb-4 flex items-center justify-center">
                  <div className="flex items-center gap-1.5">
                    {code
                      .replace(" ", "")
                      .split("")
                      .map((digit, i) => (
                        <div
                          key={i}
                          className="flex h-14 w-12 items-center justify-center rounded-xl text-xl font-bold"
                          style={{ background: "rgba(240,248,255,0.9)", border: "1px solid rgba(59,159,216,0.12)", color: "#1a2a3a" }}
                        >
                          {digit}
                        </div>
                      ))}
                  </div>
                </div>
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={() => handleCopy(code.replace(" ", ""), "code")}
                    className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all hover:bg-blue-50"
                    style={{ border: "1px solid rgba(0,0,0,0.08)", color: "#1a2a3a" }}
                  >
                    {copied === "code" ? <Check className="h-4 w-4" style={{ color: "#22c55e" }} /> : <Copy className="h-4 w-4" />}
                    {copied === "code" ? "已复制" : "复制"}
                  </button>
                  <button
                    onClick={handleRegenerate}
                    className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all hover:shadow-md"
                    style={{ background: "linear-gradient(135deg, #3b9fd8, #60c4f0)", boxShadow: "0 2px 8px rgba(59,159,216,0.3)" }}
                  >
                    <RefreshCw className="h-4 w-4" />
                    {"重新生成"}
                  </button>
                </div>
              </div>

              {/* Right: QR Code placeholder */}
              <div
                className="flex items-center justify-center rounded-xl p-2"
                style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.06)" }}
              >
                <svg width="88" height="88" viewBox="0 0 88 88" fill="none" xmlns="http://www.w3.org/2000/svg">
                  {/* QR Code pattern simulation */}
                  <rect width="88" height="88" fill="white"/>
                  {/* Corner squares */}
                  <rect x="4" y="4" width="24" height="24" fill="#1a2a3a"/>
                  <rect x="8" y="8" width="16" height="16" fill="white"/>
                  <rect x="12" y="12" width="8" height="8" fill="#1a2a3a"/>
                  
                  <rect x="60" y="4" width="24" height="24" fill="#1a2a3a"/>
                  <rect x="64" y="8" width="16" height="16" fill="white"/>
                  <rect x="68" y="12" width="8" height="8" fill="#1a2a3a"/>
                  
                  <rect x="4" y="60" width="24" height="24" fill="#1a2a3a"/>
                  <rect x="8" y="64" width="16" height="16" fill="white"/>
                  <rect x="12" y="68" width="8" height="8" fill="#1a2a3a"/>
                  
                  {/* Data modules - simulated pattern */}
                  <rect x="36" y="4" width="4" height="4" fill="#1a2a3a"/>
                  <rect x="44" y="4" width="4" height="4" fill="#1a2a3a"/>
                  <rect x="36" y="12" width="4" height="4" fill="#1a2a3a"/>
                  <rect x="48" y="12" width="4" height="4" fill="#1a2a3a"/>
                  <rect x="40" y="20" width="4" height="4" fill="#1a2a3a"/>
                  
                  <rect x="4" y="36" width="4" height="4" fill="#1a2a3a"/>
                  <rect x="12" y="36" width="4" height="4" fill="#1a2a3a"/>
                  <rect x="20" y="40" width="4" height="4" fill="#1a2a3a"/>
                  <rect x="4" y="44" width="4" height="4" fill="#1a2a3a"/>
                  <rect x="16" y="48" width="4" height="4" fill="#1a2a3a"/>
                  
                  <rect x="36" y="36" width="4" height="4" fill="#1a2a3a"/>
                  <rect x="44" y="40" width="4" height="4" fill="#1a2a3a"/>
                  <rect x="40" y="48" width="4" height="4" fill="#1a2a3a"/>
                  <rect x="52" y="44" width="4" height="4" fill="#1a2a3a"/>
                  
                  <rect x="64" y="36" width="4" height="4" fill="#1a2a3a"/>
                  <rect x="72" y="40" width="4" height="4" fill="#1a2a3a"/>
                  <rect x="80" y="44" width="4" height="4" fill="#1a2a3a"/>
                  <rect x="68" y="52" width="4" height="4" fill="#1a2a3a"/>
                  
                  <rect x="36" y="64" width="4" height="4" fill="#1a2a3a"/>
                  <rect x="44" y="68" width="4" height="4" fill="#1a2a3a"/>
                  <rect x="52" y="72" width="4" height="4" fill="#1a2a3a"/>
                  <rect x="40" y="80" width="4" height="4" fill="#1a2a3a"/>
                  
                  <rect x="64" y="64" width="4" height="4" fill="#1a2a3a"/>
                  <rect x="72" y="68" width="4" height="4" fill="#1a2a3a"/>
                  <rect x="80" y="72" width="4" height="4" fill="#1a2a3a"/>
                  <rect x="68" y="80" width="4" height="4" fill="#1a2a3a"/>
                  <rect x="76" y="80" width="4" height="4" fill="#1a2a3a"/>
                </svg>
              </div>
            </div>
          </div>
        </section>

        {/* Support & Diagnostics */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold" style={{ color: "#1a2a3a" }}>
                {"支持与诊��"}
              </h2>
              <p className="text-xs mt-1" style={{ color: "#6b7a8d" }}>
                {"内测阶段遇到同步、重连或共享问题时，建议先导出诊断包再反馈。"}
              </p>
            </div>
            <button
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all hover:bg-blue-50"
              style={{ border: "1px solid rgba(0,0,0,0.08)", color: "#1a2a3a" }}
            >
              <Package className="h-4 w-4" />
              {"导出诊断包"}
            </button>
          </div>

          <div
            className="rounded-2xl p-5"
            style={{ background: "rgba(255,255,255,0.75)", border: "1px solid rgba(255,255,255,0.9)", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}
          >
            <div className="flex gap-4">
              <div className="flex-1 flex items-center gap-3 rounded-xl px-4 py-3" style={{ background: "rgba(240,248,255,0.8)" }}>
                <CheckCircle2 className="h-5 w-5" style={{ color: "#22c55e" }} />
                <div>
                  <p className="text-xs" style={{ color: "#6b7a8d" }}>{"最近一次成功同步"}</p>
                  <p className="text-sm font-semibold" style={{ color: "#1a2a3a" }}>{"暂无记录"}</p>
                </div>
              </div>
              <div className="flex-1 flex items-center gap-3 rounded-xl px-4 py-3" style={{ background: "rgba(240,248,255,0.8)" }}>
                <Monitor className="h-5 w-5" style={{ color: "#3b9fd8" }} />
                <div>
                  <p className="text-xs" style={{ color: "#6b7a8d" }}>{"桌面端版本"}</p>
                  <p className="text-sm font-semibold" style={{ color: "#1a2a3a" }}>{"\u5c0f\u8c79\u95ea\u4f20 v0.1.0 (8)"}</p>
                </div>
              </div>
            </div>
          </div>
        </section>


      </div>
    </div>
  )
}
