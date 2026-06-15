"use client"

import { useState, useEffect } from "react"
import { Wifi, Monitor, RefreshCw, Settings, QrCode, X } from "lucide-react"

interface LanDevice {
  id: string
  name: string
  ip: string
  model: string
}

const mockLanDevices: LanDevice[] = [
  { id: "pc1", name: "1", ip: "192.168.1.215", model: "macOS" },
  { id: "pc2", name: "bloomingdeMac-mini-2", ip: "192.168.1.204", model: "macOS" },
]

interface ScanPageProps {
  onSelectDevice: (device: LanDevice) => void
  onNavigateQrScan?: () => void
  onNavigateHelp?: () => void
}

function TroubleshootingCard({ onNavigateHelp }: { onNavigateHelp?: () => void }) {
  return (
    <div
      className="rounded-2xl px-4 py-4"
      style={{ background: "rgba(219,234,254,0.45)" }}
    >
      <p className="text-[13px] font-semibold mb-2.5" style={{ color: "#1e40af" }}>
        {"找不到设备或不知道怎么连？"}
      </p>
      <ul className="space-y-2">
        <li className="flex items-start gap-2">
          <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "#3b82f6" }} />
          <span className="text-[12px] leading-relaxed" style={{ color: "#3b5a8a" }}>
            {"确保手机与电脑连接在同一个 Wi-Fi（局域网）下。"}
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "#3b82f6" }} />
          <span className="text-[12px] leading-relaxed" style={{ color: "#3b5a8a" }}>
            {"请在电脑端浏览器访问 www.vividrop.cn 下载并打开 PC 端。"}
          </span>
        </li>
      </ul>
      <button
        onClick={onNavigateHelp}
        className="mt-3 text-[12px] font-medium transition-opacity active:opacity-60"
        style={{ color: "#2563eb" }}
      >
        {"查看详细图文教程 >"}
      </button>
    </div>
  )
}

export function ScanPage({ onSelectDevice, onNavigateQrScan, onNavigateHelp }: ScanPageProps) {
  const [scanning, setScanning] = useState(true)
  const [devices, setDevices] = useState<LanDevice[]>([])
  const [showPairMenu, setShowPairMenu] = useState(false)
  const [showIpModal, setShowIpModal] = useState(false)
  const [manualIp, setManualIp] = useState("")

  useEffect(() => {
    const timer = setTimeout(() => {
      setDevices(mockLanDevices)
      setScanning(false)
    }, 1800)
    return () => clearTimeout(timer)
  }, [])

  const handleRescan = () => {
    setScanning(true)
    setDevices([])
    setTimeout(() => {
      setDevices(mockLanDevices)
      setScanning(false)
    }, 1800)
  }

  const handleManualConnect = () => {
    if (manualIp.trim()) {
      setShowIpModal(false)
      onSelectDevice({
        id: `manual-${Date.now()}`,
        name: manualIp,
        ip: manualIp,
        model: "手动连接",
      })
    }
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-gradient-to-b from-sky-200 via-sky-100 to-white">
      {/* Header */}
      <header className="flex items-center justify-between px-5 pt-14 pb-2">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{ background: "rgba(59,159,216,0.12)" }}
        >
          <Wifi className="h-6 w-6" style={{ color: "#3b9fd8" }} />
        </div>

        {/* Manual Pair Button - white pill shape */}
        <div className="relative">
          <button
            onClick={() => setShowPairMenu(!showPairMenu)}
            className="flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium shadow-sm"
            style={{ background: "#fff", color: "#3b9fd8" }}
          >
            <Settings className="h-4 w-4" />
            {"手动配对"}
          </button>

          {/* Dropdown Menu */}
          {showPairMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowPairMenu(false)} />
              <div
                className="absolute right-0 top-full mt-2 z-50 rounded-xl py-1 min-w-[140px]"
                style={{
                  background: "#fff",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
                }}
              >
                <button
                  onClick={() => {
                    setShowPairMenu(false)
                    setShowIpModal(true)
                  }}
                  className="flex w-full items-center px-4 py-2.5 text-left transition-colors active:bg-gray-50"
                >
                  <span className="text-sm" style={{ color: "#1a3a5c" }}>
                    {"手动输入 IP"}
                  </span>
                </button>

                <button
                  onClick={() => {
                    setShowPairMenu(false)
                    onNavigateQrScan?.()
                  }}
                  className="flex w-full items-center px-4 py-2.5 text-left transition-colors active:bg-gray-50"
                >
                  <span className="text-sm" style={{ color: "#1a3a5c" }}>
                    {"扫码配对"}
                  </span>
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* Title */}
      <div className="px-5 pt-2 pb-4">
        <h1 className="text-xl font-bold" style={{ color: "#1a3a5c" }}>
          {"搜索设备"}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "#6a96b8" }}>
          {scanning ? "正在扫描局域网中的电脑端应用..." : `发现 ${devices.length} 台设备`}
        </p>
      </div>

      {/* Troubleshooting Card — top when no devices found, bottom when devices exist */}
      {!scanning && devices.length === 0 && (
        <div className="px-5 pb-4">
          <TroubleshootingCard onNavigateHelp={onNavigateHelp} />
        </div>
      )}

      {/* Device List */}
      <div className="flex-1 px-5">
        {scanning ? (
          <div className="flex flex-col items-center py-10 gap-5">
            <div className="relative flex items-center justify-center">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="absolute rounded-full border-2"
                  style={{
                    width: 60 + i * 36,
                    height: 60 + i * 36,
                    borderColor: `rgba(59,159,216,${0.35 - i * 0.1})`,
                    animation: `ping 1.8s ease-out ${i * 0.4}s infinite`,
                  }}
                />
              ))}
              <div
                className="relative flex h-14 w-14 items-center justify-center rounded-full"
                style={{ background: "rgba(59,159,216,0.15)", border: "2px solid rgba(59,159,216,0.4)" }}
              >
                <Wifi className="h-6 w-6" style={{ color: "#3b9fd8" }} />
              </div>
            </div>
            <p className="text-sm" style={{ color: "#6a96b8" }}>{"扫描中，请稍候..."}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {devices.map((device) => (
              <button
                key={device.id}
                onClick={() => onSelectDevice(device)}
                className="flex items-center gap-4 rounded-2xl px-4 py-4 text-left transition-all active:scale-[0.98]"
                style={{
                  background: "rgba(255,255,255,0.85)",
                  border: "1px solid rgba(255,255,255,0.95)",
                  boxShadow: "0 2px 12px rgba(80,160,210,0.08)",
                }}
              >
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: "rgba(59,159,216,0.10)" }}
                >
                  <Monitor className="h-5 w-5" style={{ color: "#3b9fd8" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm" style={{ color: "#1a3a5c" }}>{device.name}</p>
                  <p className="text-xs mt-0.5" style={{ color: "#8aabbd" }}>
                    {device.model} · {device.ip}
                  </p>
                </div>
              </button>
            ))}

            {/* Rescan */}
            <button
              onClick={handleRescan}
              className="mt-4 flex items-center justify-center gap-2 py-3 text-sm font-medium"
              style={{ color: "#5a9abf" }}
            >
              <RefreshCw className="h-4 w-4" />
              {"重新扫描"}
            </button>

            {/* Troubleshooting card — bottom when devices exist */}
            <div className="mt-2 mb-4">
              <TroubleshootingCard onNavigateHelp={onNavigateHelp} />
            </div>
          </div>
        )}
      </div>

      {/* Manual IP Modal - Centered */}
      {showIpModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-5"
          style={{ background: "rgba(0,0,0,0.3)" }}
          onClick={() => setShowIpModal(false)}
        >
          <div
            className="w-full rounded-2xl p-5 animate-in fade-in zoom-in-95 duration-200"
            style={{ background: "#fff", maxWidth: 360 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-2" style={{ color: "#1a2a3a" }}>
              {"手动输入 IP 配对"}
            </h3>

            <p className="text-[13px] mb-4" style={{ color: "#7a9ab8", lineHeight: 1.6 }}>
              {"如果扫描不到电脑，尤其是 Windows 设备，可直接输入电脑端 IPv4 地址继续配对。"}
            </p>

            <div className="flex items-center gap-2.5 mb-3">
              <input
                type="text"
                value={manualIp}
                onChange={(e) => setManualIp(e.target.value)}
                placeholder="192.168.0.1"
                className="flex-1 rounded-xl border-0 px-4 py-3.5 text-sm outline-none"
                style={{ background: "#f0f5f8", color: "#1a3a5c" }}
                autoFocus
              />
              <button
                onClick={handleManualConnect}
                disabled={!manualIp.trim()}
                className="rounded-xl px-5 py-3.5 text-sm font-semibold text-white transition-all disabled:opacity-50"
                style={{ background: "#3b9fd8" }}
              >
                {"继续"}
              </button>
            </div>

            {/* IP hint bar */}
            <div
              className="mt-1 flex items-start gap-2.5 rounded-2xl px-3.5 py-3"
              style={{ background: "rgba(219,234,254,0.55)", border: "1px solid rgba(147,197,253,0.35)" }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="mt-0.5 shrink-0">
                <rect x="2" y="3" width="20" height="13" rx="2" stroke="#3b82f6" strokeWidth="1.6" />
                <path d="M8 20h8M12 16v4" stroke="#3b82f6" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] leading-relaxed" style={{ color: "#334e6e" }}>
                  {"去哪里找 IP 地址？在电脑端 Vivi Drop 的"}
                  <span className="font-bold">{"「全局设置」"}</span>
                  {"最下方，查看"}
                  <span className="font-bold">{"「广播 IP」"}</span>
                  {"并在上方填入。"}
                </p>
                <button
                  onClick={onNavigateHelp}
                  className="mt-1.5 text-[12px] font-medium transition-opacity active:opacity-60"
                  style={{ color: "#2563eb" }}
                >
                  {"查看详细图文教程 >"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes ping {
          0% { transform: scale(0.85); opacity: 0.8; }
          70% { transform: scale(1.2); opacity: 0; }
          100% { transform: scale(1.2); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
