"use client"

import { useState, useEffect } from "react"
import { FileVideo, HardDrive, AlertTriangle, Smartphone, X, Database } from "lucide-react"
import { Progress } from "@/components/ui/progress"
import type { Device } from "@/lib/mock-data"
import { mockDevices } from "@/lib/mock-data"

interface DashboardProps {
  onSelectDevice: (device: Device) => void
}

function DeviceCard({ device, onClick }: { device: Device; onClick: () => void }) {
  const [progress, setProgress] = useState(device.currentFile?.progress ?? 0)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!mounted || device.status !== "transferring") return
    const interval = setInterval(() => {
      setProgress((prev) => (prev >= 100 ? 67 : prev + 2))
    }, 800)
    return () => clearInterval(interval)
  }, [device.status, mounted])

  const isDisconnected = device.status === "disconnected"
  const isTransferring = device.status === "transferring"

  return (
    <button
      onClick={onClick}
      className="group flex flex-col text-left transition-all active:scale-[0.99]"
      style={{
        background: isDisconnected ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.72)",
        backdropFilter: "blur(16px)",
        border: isTransferring ? "1px solid rgba(59,130,246,0.35)" : "1px solid rgba(255,255,255,0.85)",
        borderRadius: 18,
        padding: "18px 20px",
        boxShadow: isTransferring
          ? "0 4px 24px rgba(59,130,246,0.12), 0 1px 4px rgba(0,0,0,0.04)"
          : "0 2px 12px rgba(100,160,210,0.08), 0 1px 3px rgba(0,0,0,0.03)",
        opacity: isDisconnected ? 0.65 : 1,
      }}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{
              background: isDisconnected
                ? "rgba(0,0,0,0.06)"
                : "linear-gradient(135deg, #3b82f6 0%, #60c4f0 100%)",
              boxShadow: isDisconnected ? "none" : "0 2px 8px rgba(59,130,246,0.3)",
            }}
          >
            <Smartphone className="h-5 w-5 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "#1a2a3a" }}>
              {device.name}
            </h3>
            <p className="mt-0.5 text-xs" style={{ color: "#8a9ab0" }}>
              {device.ip}
            </p>
          </div>
        </div>
        <span
          className="shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
          style={
            isTransferring
              ? { background: "rgba(59,130,246,0.10)", color: "#3b82f6" }
              : device.status === "connected"
              ? { background: "rgba(34,197,94,0.10)", color: "#16a34a" }
              : { background: "rgba(0,0,0,0.05)", color: "#9ca3af" }
          }
        >
          {isTransferring && (
            <span className="relative flex h-2 w-2">
              <span className="absolute h-full w-full rounded-full bg-blue-400 animate-ping opacity-75" />
              <span className="relative h-2 w-2 rounded-full bg-blue-500" />
            </span>
          )}
          {device.status === "connected" && <span className="h-2 w-2 rounded-full bg-green-500" />}
          {isDisconnected && <span className="h-2 w-2 rounded-full bg-gray-300" />}
          {isTransferring ? "\u4F20\u8F93\u4E2D" : device.status === "connected" ? "\u5DF2\u8FDE\u63A5" : "\u672A\u8FDE\u63A5"}
        </span>
      </div>

      {isTransferring && device.currentFile && (
        <div className="mb-3 rounded-xl px-3 py-2.5" style={{ background: "rgba(59,130,246,0.06)" }}>
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="max-w-44 truncate font-medium" style={{ color: "#1a2a3a" }}>{device.currentFile.name}</span>
            <span className="font-semibold text-blue-500">{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-1.5" style={{ background: "rgba(59,130,246,0.12)" }} />
        </div>
      )}

      <div className="mt-auto flex items-center gap-4 pt-2.5 text-xs" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
        <div className="flex items-center gap-1.5" style={{ color: "#8a9ab0" }}>
          <FileVideo className="h-3.5 w-3.5" />
          <span className="font-semibold" style={{ color: "#1a2a3a" }}>{device.todayFiles}</span>
          {"\u4E2A\u6587\u4EF6"}
        </div>
        <div className="flex items-center gap-1.5" style={{ color: "#8a9ab0" }}>
          <HardDrive className="h-3.5 w-3.5" />
          <span className="font-semibold" style={{ color: "#1a2a3a" }}>{device.todaySize}</span>
        </div>
      </div>
    </button>
  )
}

export function Dashboard({ onSelectDevice }: DashboardProps) {
  const [diskWarning, setDiskWarning] = useState(true)

  const sortedDevices = [...mockDevices].sort((a, b) => {
    const priority = { transferring: 0, connected: 1, disconnected: 2 }
    return priority[a.status] - priority[b.status]
  })

  const todayTotalFiles = mockDevices.reduce((sum, d) => sum + d.todayFiles, 0)
  const todayTotalSize = Math.round(mockDevices.reduce((sum, d) => sum + parseFloat(d.todaySize), 0) * 10) / 10
  // Storage left: use first connected/transferring device as representative
  const activeDevice = mockDevices.find((d) => d.status !== "disconnected")
  const storageLeft = activeDevice?.storageLeft ?? "—"

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      {diskWarning && (
        <div
          className="mx-6 mt-5 flex items-center gap-3 rounded-xl px-4 py-3 text-sm"
          style={{ background: "rgba(254,226,226,0.85)", border: "1px solid rgba(252,165,165,0.5)", color: "#dc2626", backdropFilter: "blur(8px)" }}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1 font-medium text-sm">
            {"\u9884\u6D4B\u544A\u6025\uFF1A\u63A5\u6536\u78C1\u76D8\u5269\u4F59\u7A7A\u95F4 < 500MB\uFF0C\u5DF2\u6682\u505C\u6240\u6709\u8BBE\u5907\u7684\u63A5\u6536\u4EFB\u52A1\u3002"}
          </span>
          <button
            onClick={() => setDiskWarning(false)}
            className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-red-100"
            style={{ color: "#dc2626" }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="px-6 pt-5 pb-1">
        <h1 className="text-xl font-bold" style={{ color: "#1a2a3a" }}>
          {"\u6240\u6709\u8BBE\u5907"}
        </h1>
      </div>

      {/* Stat cards: 3 cards */}
      <div className="px-6 pb-4 pt-3">
        <div className="flex gap-4 flex-wrap">
          {/* Files card */}
          <div
            className="flex items-center gap-4 rounded-2xl px-5 py-4"
            style={{ background: "rgba(255,255,255,0.75)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.9)", boxShadow: "0 2px 16px rgba(100,160,210,0.10)", minWidth: 200 }}
          >
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
              style={{ background: "linear-gradient(135deg, #3b82f6 0%, #60c4f0 100%)", boxShadow: "0 4px 12px rgba(59,130,246,0.3)" }}
            >
              <FileVideo className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-xs" style={{ color: "#8a9ab0" }}>{"\u4ECA\u65E5\u63A5\u6536\u5A92\u4F53\u603B\u6570"}</p>
              <p className="mt-0.5 text-2xl font-bold tracking-tight" style={{ color: "#1a2a3a" }}>
                {todayTotalFiles.toLocaleString()}
              </p>
            </div>
          </div>

          {/* Storage used card */}
          <div
            className="flex items-center gap-4 rounded-2xl px-5 py-4"
            style={{ background: "rgba(255,255,255,0.75)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.9)", boxShadow: "0 2px 16px rgba(100,160,210,0.10)", minWidth: 200 }}
          >
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
              style={{ background: "linear-gradient(135deg, #a855f7 0%, #c084fc 100%)", boxShadow: "0 4px 12px rgba(168,85,247,0.3)" }}
            >
              <HardDrive className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-xs" style={{ color: "#8a9ab0" }}>{"\u4ECA\u65E5\u5360\u7528\u603B\u7A7A\u95F4"}</p>
              <p className="mt-0.5 text-2xl font-bold tracking-tight" style={{ color: "#1a2a3a" }}>
                {todayTotalSize.toFixed(1)}{" "}
                <span className="text-base font-normal" style={{ color: "#8a9ab0" }}>GB</span>
              </p>
            </div>
          </div>

          {/* Storage left card */}
          <div
            className="flex items-center gap-4 rounded-2xl px-5 py-4"
            style={{ background: "rgba(255,255,255,0.75)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.9)", boxShadow: "0 2px 16px rgba(100,160,210,0.10)", minWidth: 200 }}
          >
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
              style={{ background: "linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)", boxShadow: "0 4px 12px rgba(14,165,233,0.3)" }}
            >
              <Database className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-xs" style={{ color: "#8a9ab0" }}>{"\u8bbe\u5907\u5269\u4f59\u7a7a\u95f4"}</p>
              <p className="mt-0.5 text-2xl font-bold tracking-tight" style={{ color: "#1a2a3a" }}>
                {storageLeft}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Device grid */}
      <div className="px-6 pb-8">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sortedDevices.map((device) => (
            <DeviceCard key={device.id} device={device} onClick={() => onSelectDevice(device)} />
          ))}
        </div>
      </div>
    </div>
  )
}
