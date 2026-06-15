"use client"

import { useState } from "react"
import { ArrowLeft, Server, FolderOpen, ChevronRight, Lock, AlertCircle, Download } from "lucide-react"

interface SmbConnectPageProps {
  onBack: () => void
  onConnected: (path: string) => void
  isPro: boolean
  onUpgradePro: () => void
}

type ConnectStep = "form" | "connecting" | "browser"

interface FolderNode {
  name: string
  path: string
  children?: FolderNode[]
}

const MOCK_FOLDERS: FolderNode[] = [
  {
    name: "SyncFlow",
    path: "\\\\192.168.1.100\\SyncFlow",
    children: [
      { name: "Public",  path: "\\\\192.168.1.100\\SyncFlow\\Public" },
      { name: "Private", path: "\\\\192.168.1.100\\SyncFlow\\Private" },
      { name: "Archive", path: "\\\\192.168.1.100\\SyncFlow\\Archive" },
    ],
  },
  {
    name: "Shared",
    path: "\\\\192.168.1.100\\Shared",
    children: [
      { name: "Movies", path: "\\\\192.168.1.100\\Shared\\Movies" },
      { name: "Docs",   path: "\\\\192.168.1.100\\Shared\\Docs" },
    ],
  },
]

export function SmbConnectPage({ onBack, onConnected, isPro, onUpgradePro }: SmbConnectPageProps) {
  const [step, setStep] = useState<ConnectStep>("form")
  const [host, setHost] = useState("192.168.1.100")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  if (!isPro) {
    return (
      <div
        className="relative flex flex-col items-center overflow-hidden"
        style={{ minHeight: "100vh", background: "linear-gradient(180deg, #d6ecf8 0%, #c5e2f5 22%, #e6f2fb 52%, #f4f9fd 100%)" }}
      >
        <header className="flex w-full items-center gap-3 px-4 pt-12 pb-4">
          <button onClick={onBack} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/60">
            <ArrowLeft className="h-4 w-4" style={{ color: "#1a3a5c" }} />
          </button>
          <h1 className="text-lg font-bold" style={{ color: "#1a3a5c" }}>{"SMB 手动连接"}</h1>
        </header>
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl" style={{ background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.25)" }}>
            <Lock className="h-9 w-9" style={{ color: "#d97706" }} />
          </div>
          <h2 className="mb-2 text-xl font-bold" style={{ color: "#1a2a3a" }}>{"试用已结束"}</h2>
          <p className="mb-8 text-sm" style={{ color: "#5a7a96", lineHeight: 1.6 }}>
            {"你的 7 天全功能试用已结束，订阅后可继续使用 Vivi Drop，包括连接局域网共享目录等全部功能。"}
          </p>
          <button
            onClick={onUpgradePro}
            className="w-full rounded-2xl py-4 text-base font-bold text-white"
            style={{ background: "#1a3a5c", boxShadow: "0 6px 20px rgba(26,58,92,0.28)" }}
          >
            {"立即订阅"}
          </button>
          <button onClick={onBack} className="mt-4 text-sm" style={{ color: "#8a9ab0" }}>{"返回"}</button>
        </div>
      </div>
    )
  }

  const handleConnect = () => {
    if (!host.trim()) { setError("请输入服务器地址"); return }
    setError("")
    setStep("connecting")
    setTimeout(() => setStep("browser"), 1500)
  }

  const toggleExpand = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }

  return (
    <div
      className="relative flex flex-col overflow-hidden"
      style={{ minHeight: "100vh", background: "linear-gradient(180deg, #d6ecf8 0%, #c5e2f5 22%, #e6f2fb 52%, #f4f9fd 100%)" }}
    >
      <header className="sticky top-0 z-20" style={{ background: "rgba(214,236,248,0.88)", backdropFilter: "blur(12px)" }}>
        <div className="flex items-center gap-3 px-4 pt-12 pb-4">
          <button onClick={step === "browser" ? () => setStep("form") : onBack} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/60">
            <ArrowLeft className="h-4 w-4" style={{ color: "#1a3a5c" }} />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: "linear-gradient(135deg, #3b82f6, #60c4f0)", boxShadow: "0 2px 8px rgba(59,130,246,0.3)" }}>
              <Server className="h-3.5 w-3.5 text-white" />
            </div>
            <h1 className="text-lg font-bold" style={{ color: "#1a3a5c" }}>{"SMB 手动连接"}</h1>
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col px-4 py-4">
        {step === "form" && (
          <div className="flex flex-col gap-4">
            {/* Instructional callout */}
            <div
              className="flex items-start gap-3 rounded-2xl px-4 py-4"
              style={{
                background: "rgba(255,255,255,0.68)",
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
                border: "1px solid rgba(255,255,255,0.55)",
                boxShadow: "0 2px 12px rgba(59,130,210,0.08)",
              }}
            >
              {/* PC + gear icon */}
              <div
                className="relative mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                style={{ background: "rgba(59,130,246,0.09)", border: "1px solid rgba(59,130,246,0.16)" }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <rect x="2" y="3" width="20" height="13" rx="2" stroke="#3b82f6" strokeWidth="1.6" />
                  <path d="M8 20h8M12 16v4" stroke="#3b82f6" strokeWidth="1.6" strokeLinecap="round" />
                  <circle cx="12" cy="9.5" r="2" stroke="#3b82f6" strokeWidth="1.4" />
                  <path d="M12 7v-1M12 13v-1M9.5 9.5h-1M14.5 9.5h1" stroke="#3b82f6" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold leading-snug" style={{ color: "#1a3a5c" }}>
                  {"去哪里找连接码和 IP？"}
                </p>
                <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: "#5a7a96" }}>
                  {"请在电脑端 Vivi Drop 左侧导航栏点击「全局设置」，即可查看 6 位连接码、设备 IP 或展示二维码。"}
                </p>
              </div>
            </div>

            {/* Server address */}
            <div className="rounded-2xl bg-white/80 p-4" style={{ border: "1px solid rgba(255,255,255,0.85)" }}>
              <label className="mb-2 block text-xs font-semibold" style={{ color: "#5a7a96" }}>{"服务器地址"}</label>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.1.100 或 hostname"
                className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                style={{ background: "rgba(240,248,255,0.8)", border: "1.5px solid rgba(59,130,246,0.18)", color: "#1a2a3a" }}
              />
            </div>

            {/* Auth (optional) */}
            <div className="rounded-2xl bg-white/80 p-4" style={{ border: "1px solid rgba(255,255,255,0.85)" }}>
              <label className="mb-2 block text-xs font-semibold" style={{ color: "#5a7a96" }}>{"认证（可选）"}</label>
              <div className="flex flex-col gap-2">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="用户名（留空为匿名）"
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                  style={{ background: "rgba(240,248,255,0.8)", border: "1.5px solid rgba(59,130,246,0.12)", color: "#1a2a3a" }}
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="密码（留空为匿名）"
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                  style={{ background: "rgba(240,248,255,0.8)", border: "1.5px solid rgba(59,130,246,0.12)", color: "#1a2a3a" }}
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-xl px-4 py-3" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.20)" }}>
                <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
                <span className="text-xs text-red-500">{error}</span>
              </div>
            )}

            <button
              onClick={handleConnect}
              className="w-full rounded-2xl py-4 text-base font-bold text-white"
              style={{ background: "linear-gradient(135deg, #3b82f6, #60c4f0)", boxShadow: "0 6px 20px rgba(59,130,246,0.35)" }}
            >
              {"连接"}
            </button>
          </div>
        )}

        {step === "connecting" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-200 border-t-blue-500" />
            <p className="text-sm font-semibold" style={{ color: "#3b82f6" }}>{`正在连接 ${host}…`}</p>
          </div>
        )}

        {step === "browser" && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.20)" }}>
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <span className="text-xs font-semibold" style={{ color: "#16a34a" }}>{`已连接 \\\\${host}`}</span>
            </div>

            <div className="rounded-2xl bg-white/80 overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.85)" }}>
              {MOCK_FOLDERS.map((folder, i) => (
                <div key={folder.path}>
                  <button
                    onClick={() => toggleExpand(folder.path)}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-blue-50/40"
                    style={{ borderBottom: expanded.has(folder.path) || i < MOCK_FOLDERS.length - 1 ? "1px solid rgba(0,0,0,0.05)" : "none" }}
                  >
                    <FolderOpen className="h-5 w-5 shrink-0" style={{ color: "#f59e0b" }} />
                    <span className="flex-1 text-sm font-semibold" style={{ color: "#1a2a3a" }}>{folder.name}</span>
                    <ChevronRight
                      className="h-4 w-4 transition-transform"
                      style={{ color: "#b0c4d0", transform: expanded.has(folder.path) ? "rotate(90deg)" : "rotate(0deg)" }}
                    />
                  </button>

                  {expanded.has(folder.path) && folder.children?.map((child, ci) => {
                    const isPrivate = child.name === "Private"
                    const isPublic = child.name === "Public"
                    return (
                      <button
                        key={child.path}
                        onClick={() => !isPrivate && onConnected(child.path)}
                        disabled={isPrivate}
                        className={`flex w-full items-center gap-3 pl-10 pr-4 py-3 text-left transition-colors ${isPrivate ? "cursor-not-allowed opacity-60" : "hover:bg-blue-50/60"}`}
                        style={{ borderBottom: ci < (folder.children?.length ?? 0) - 1 ? "1px solid rgba(0,0,0,0.04)" : "none", background: "rgba(240,248,255,0.5)" }}
                      >
                        {isPrivate ? (
                          <Lock className="h-4 w-4 shrink-0" style={{ color: "#9ca3af" }} />
                        ) : (
                          <FolderOpen className="h-4 w-4 shrink-0" style={{ color: isPublic ? "#22c55e" : "#8a9ab0" }} />
                        )}
                        <span className="flex-1 text-sm" style={{ color: isPrivate ? "#9ca3af" : "#1a2a3a" }}>{child.name}</span>
                        {isPublic && (
                          <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(34,197,94,0.12)", color: "#16a34a" }}>
                            <Download className="h-2.5 w-2.5" />
                            {"\u53ef\u8bbf\u95ee"}
                          </span>
                        )}
                        {isPrivate && (
                          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(156,163,175,0.12)", color: "#6b7280" }}>{"\u65e0\u6743\u9650"}</span>
                        )}
                        {!isPrivate && <ChevronRight className="h-3.5 w-3.5 shrink-0" style={{ color: "#b0c4d0" }} />}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
