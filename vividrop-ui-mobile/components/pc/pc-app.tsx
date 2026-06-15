"use client"

import { useState } from "react"
import { LayoutDashboard, Settings, FolderKanban, HelpCircle } from "lucide-react"
import { Dashboard } from "./dashboard"
import { SettingsPage } from "./settings-page"
import { DirectoryPage } from "./directory-page"
import { DeviceDetailModal } from "./device-detail-modal"
import type { Device } from "@/lib/mock-data"

type PCView = "dashboard" | "directory" | "settings" | "help"

export function PCApp() {
  const [view, setView] = useState<PCView>("dashboard")
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  const handleSelectDevice = (device: Device) => {
    setSelectedDevice(device)
    setModalOpen(true)
  }

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{
        background: "linear-gradient(135deg, #daeef8 0%, #e8f5fb 40%, #f0f8fd 70%, #f8fbff 100%)",
      }}
    >
      {/* Sidebar */}
      <aside
        className="flex w-56 flex-col z-10"
        style={{
          background: "rgba(255,255,255,0.55)",
          backdropFilter: "blur(20px)",
          borderRight: "1px solid rgba(255,255,255,0.7)",
          boxShadow: "2px 0 16px rgba(100,170,220,0.08)",
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5">
          <img
            src="/logo.png"
            alt="Vivi drop"
            className="h-8 w-auto object-contain"
          />
          <span className="text-base font-bold" style={{ color: "#1a2a3a" }}>{"Vivi drop"}</span>
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-1 px-3 py-2">
          <button
            onClick={() => setView("dashboard")}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
              view === "dashboard"
                ? "text-primary"
                : "text-[#6b7a8d] hover:text-[#1a2a3a]"
            }`}
            style={
              view === "dashboard"
                ? {
                    background: "rgba(255,255,255,0.85)",
                    boxShadow: "0 2px 12px rgba(59,130,246,0.10)",
                  }
                : {}
            }
          >
            <LayoutDashboard className="h-4 w-4" />
            {"\u9996\u9875\u770B\u677F"}
          </button>
          <button
            onClick={() => setView("directory")}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
              view === "directory"
                ? "text-primary"
                : "text-[#6b7a8d] hover:text-[#1a2a3a]"
            }`}
            style={
              view === "directory"
                ? { background: "rgba(255,255,255,0.85)", boxShadow: "0 2px 12px rgba(59,130,246,0.10)" }
                : {}
            }
          >
            <FolderKanban className="h-4 w-4" />
            {"\u76ee\u5f55\u7ba1\u7406"}
          </button>
          <button
            onClick={() => setView("settings")}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
              view === "settings"
                ? "text-primary"
                : "text-[#6b7a8d] hover:text-[#1a2a3a]"
            }`}
            style={
              view === "settings"
                ? {
                    background: "rgba(255,255,255,0.85)",
                    boxShadow: "0 2px 12px rgba(59,130,246,0.10)",
                  }
                : {}
            }
          >
            <Settings className="h-4 w-4" />
            {"\u5168\u5C40\u8BBE\u7F6E"}
          </button>
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom nav */}
        <nav className="flex flex-col gap-1 px-3 py-4 border-t" style={{ borderColor: "rgba(255,255,255,0.7)" }}>
          <button
            onClick={() => setView("help")}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
              view === "help"
                ? "text-primary"
                : "text-[#6b7a8d] hover:text-[#1a2a3a]"
            }`}
            style={
              view === "help"
                ? {
                    background: "rgba(255,255,255,0.85)",
                    boxShadow: "0 2px 12px rgba(59,130,246,0.10)",
                  }
                : {}
            }
          >
            <HelpCircle className="h-4 w-4" />
            {"帮助"}
          </button>
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {view === "dashboard" ? (
          <Dashboard onSelectDevice={handleSelectDevice} />
        ) : view === "directory" ? (
          <DirectoryPage />
        ) : view === "help" ? (
          <div className="flex-1 overflow-auto" style={{ background: "linear-gradient(180deg, #e6f2f8 0%, #f4f9fc 60%, #fefefe 100%)" }}>
            <div className="mx-auto max-w-4xl px-6 py-8">
              <h1 className="mb-2 text-xl font-bold" style={{ color: "#1a2a3a" }}>
                {"帮助中心"}
              </h1>
              <p className="text-sm mb-8" style={{ color: "#6b7a8d" }}>
                {"快速了解如何使用 FlowSync 进行跨设备文件同步"}
              </p>

              {/* 1. Quick Start Guide */}
              <section className="mb-8">
                <h2 className="mb-4 text-base font-bold flex items-center gap-2" style={{ color: "#1a2a3a" }}>
                  <span className="text-lg">🚀</span>
                  {"快速开始"}
                </h2>
                <div className="rounded-2xl p-5" style={{ background: "rgba(255,255,255,0.85)", border: "1px solid rgba(255,255,255,0.9)", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
                  <div className="space-y-4">
                    {[
                      { step: 1, title: "选择根目录", desc: "首次使用时，选择一个本地文件夹作为根目录（如 D:\\FlowSync_Media）" },
                      { step: 2, title: "自动生成子目录", desc: "系统将自动在根目录下创建 received（接收目录）和 shared（共享目录）" },
                      { step: 3, title: "移动端连接电脑", desc: "在移动端 App 中扫描或输入 PC 端的连接信息" },
                      { step: 4, title: "上传素材", desc: "手机素材会自动上传到 received 接收目录" },
                      { step: 5, title: "PC 处理成品", desc: "在 PC 端剪辑完成后，将成品文件放入 shared 共享目录" },
                      { step: 6, title: "移动端查看", desc: "移动端即可实时查看、预览和下载共享目录中的成品" }
                    ].map(({ step, title, desc }) => (
                      <div key={step} className="flex gap-3">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: "linear-gradient(135deg, #3b9fd8, #60c4f0)" }}>
                          {step}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-semibold mb-0.5" style={{ color: "#1a2a3a" }}>{title}</p>
                          <p className="text-xs" style={{ color: "#6b7a8d", lineHeight: 1.6 }}>{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              {/* 2. Directory Explanation */}
              <section className="mb-8">
                <h2 className="mb-4 text-base font-bold flex items-center gap-2" style={{ color: "#1a2a3a" }}>
                  <span className="text-lg">📁</span>
                  {"目录说明"}
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-2xl p-5" style={{ background: "rgba(255,255,255,0.85)", border: "1px solid rgba(255,255,255,0.9)", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-2xl">📥</span>
                      <h3 className="text-sm font-bold" style={{ color: "#1a2a3a" }}>{"接收目录 (received)"}</h3>
                    </div>
                    <ul className="space-y-2 text-xs" style={{ color: "#6b7a8d", lineHeight: 1.6 }}>
                      <li>{"• 用于接收移动端上传的照片、视频等素材"}</li>
                      <li>{"• 仅供 PC 端管理与处理"}</li>
                      <li>{"• 移动端无法查看此目录内容"}</li>
                    </ul>
                  </div>
                  <div className="rounded-2xl p-5" style={{ background: "rgba(255,255,255,0.85)", border: "1px solid rgba(255,255,255,0.9)", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-2xl">📤</span>
                      <h3 className="text-sm font-bold" style={{ color: "#1a2a3a" }}>{"共享目录 (shared)"}</h3>
                    </div>
                    <ul className="space-y-2 text-xs" style={{ color: "#6b7a8d", lineHeight: 1.6 }}>
                      <li>{"• 用于存放 PC 端准备共享给移动端的成品内容"}</li>
                      <li>{"• 移动端可查看、预览、播放和下载"}</li>
                      <li>{"• 移动端只读访问，不能修改、删除、上传"}</li>
                    </ul>
                  </div>
                </div>
                <div className="mt-4 rounded-xl p-4 font-mono text-xs" style={{ background: "rgba(240,248,255,0.6)", border: "1px solid rgba(59,159,216,0.15)", color: "#6b7a8d" }}>
                  <div>{"D:\\FlowSync_Media\\"}</div>
                  <div className="ml-4">{"├── received/   (接收移动端上传)"}</div>
                  <div className="ml-4">{"└── shared/     (共享给移动端访问)"}</div>
                </div>
              </section>

              {/* 3. System Permissions */}
              <section className="mb-8">
                <h2 className="mb-4 text-base font-bold flex items-center gap-2" style={{ color: "#1a2a3a" }}>
                  <span className="text-lg">🔐</span>
                  {"系统权限指引"}
                </h2>
                <div className="space-y-4">
                  <div className="rounded-2xl p-5" style={{ background: "rgba(255,255,255,0.85)", border: "1px solid rgba(255,255,255,0.9)", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
                    <h3 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: "#1a2a3a" }}>
                      <span>💻</span>
                      {"Windows 权限设置"}
                    </h3>
                    <ul className="space-y-2 text-xs" style={{ color: "#6b7a8d", lineHeight: 1.6 }}>
                      <li>{"• 首次选择根目录后，系统会自动请求文件夹访问权限"}</li>
                      <li>{"• 如果被系统拦截，请前往「设置 → 隐私和安全性 → 文件和文件夹」允许本应用访问"}</li>
                      <li>{"• 如果打开目录失败，请检查目录是否存在且未被占用"}</li>
                    </ul>
                  </div>
                  <div className="rounded-2xl p-5" style={{ background: "rgba(255,255,255,0.85)", border: "1px solid rgba(255,255,255,0.9)", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
                    <h3 className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: "#1a2a3a" }}>
                      <span>🍎</span>
                      {"macOS 权限设置"}
                    </h3>
                    <ul className="space-y-2 text-xs" style={{ color: "#6b7a8d", lineHeight: 1.6 }}>
                      <li>{"• 前往「系统设置 → 隐私与安全性 → 文件和文件夹」"}</li>
                      <li>{"• 找到本应用，勾选需要访问的文件夹权限"}</li>
                      <li>{"• 如果打开目录失败，请重新授权或在「完全磁盘访问权限」中添加本应用"}</li>
                    </ul>
                  </div>
                </div>
              </section>

              {/* 4. Upload Rules */}
              <section className="mb-8">
                <h2 className="mb-4 text-base font-bold flex items-center gap-2" style={{ color: "#1a2a3a" }}>
                  <span className="text-lg">⬆️</span>
                  {"上传规则说明"}
                </h2>
                <div className="rounded-2xl p-5" style={{ background: "rgba(255,255,255,0.85)", border: "1px solid rgba(255,255,255,0.9)", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
                  <ul className="space-y-2 text-xs" style={{ color: "#6b7a8d", lineHeight: 1.6 }}>
                    <li>{"• 自动上传和手动上传可同时存在"}</li>
                    <li>{"• 自动上传开启后，用户仍可手动选择文件上传"}</li>
                    <li>{"• 两者共用同一个传输队列"}</li>
                    <li>{"• 手动加入的文件优先于自动同步的文件"}</li>
                    <li>{"• 同一素材不会重复上传，系统会自动跳过已上传的文件"}</li>
                  </ul>
                </div>
              </section>

              {/* 5. FAQ */}
              <section className="mb-8">
                <h2 className="mb-4 text-base font-bold flex items-center gap-2" style={{ color: "#1a2a3a" }}>
                  <span className="text-lg">❓</span>
                  {"常见问题"}
                </h2>
                <div className="space-y-3">
                  {[
                    {
                      q: "为什么移动端连接成功了，却看不到共享文件？",
                      a: "可能原因：① 当前 PC 不在线；② shared 目录为空；③ 目录权限异常；④ 设备未连接到正确的电脑"
                    },
                    {
                      q: "为什么接收目录不能修改？",
                      a: "因为当前正在接收传输，传输过程中禁止切换接收目录。请先停止当前传输，再修改目录路径。"
                    },
                    {
                      q: "为什么有些素材没有自动上传？",
                      a: "可能原因：① 自动上传未开启；② 时间范围不包含该素材；③ 素材已上传过，被系统自动跳过；④ 当前连接设备不可用"
                    },
                    {
                      q: "为什么共享目录里的内容只能看不能改？",
                      a: "因为移动端对共享目录是只读权限，只支持查看、预览、播放和下载，不支持修改、删除或上传新文件。"
                    }
                  ].map(({ q, a }, i) => (
                    <div key={i} className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.85)", border: "1px solid rgba(255,255,255,0.9)", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
                      <p className="text-sm font-semibold mb-2" style={{ color: "#1a2a3a" }}>{q}</p>
                      <p className="text-xs" style={{ color: "#6b7a8d", lineHeight: 1.6 }}>{a}</p>
                    </div>
                  ))}
                </div>
              </section>

              {/* 6. Error Handling */}
              <section className="mb-8">
                <h2 className="mb-4 text-base font-bold flex items-center gap-2" style={{ color: "#1a2a3a" }}>
                  <span className="text-lg">⚠️</span>
                  {"异常处理说明"}
                </h2>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { icon: "📡", title: "设备离线", desc: "检查网络连接，确保 PC 和移动端在同一局域网" },
                    { icon: "🚫", title: "目录不可访问", desc: "检查目录权限，重新授权或选择其他目录" },
                    { icon: "💾", title: "空间不足", desc: "清理磁盘空间或选择其他磁盘作为根目录" },
                    { icon: "⏸️", title: "上传中断", desc: "检查网络连接，传输会在恢复后自动继续" }
                  ].map(({ icon, title, desc }, i) => (
                    <div key={i} className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.85)", border: "1px solid rgba(255,255,255,0.9)", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-lg">{icon}</span>
                        <h3 className="text-sm font-semibold" style={{ color: "#1a2a3a" }}>{title}</h3>
                      </div>
                      <p className="text-xs" style={{ color: "#6b7a8d", lineHeight: 1.6 }}>{desc}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        ) : (
          <SettingsPage />
        )}
      </div>

      <DeviceDetailModal
        device={selectedDevice}
        open={modalOpen}
        onClose={() => {
          setModalOpen(false)
          setSelectedDevice(null)
        }}
      />
    </div>
  )
}
