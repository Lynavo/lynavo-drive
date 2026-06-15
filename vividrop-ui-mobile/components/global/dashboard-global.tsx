"use client"

import { useState, useEffect } from "react"
import { 
  Smartphone, 
  FileVideo, 
  HardDrive, 
  Globe,
  Copy,
  Check,
  QrCode,
  ArrowUpRight,
  MoreHorizontal,
  Wifi
} from "lucide-react"
import { Progress } from "@/components/ui/progress"
import { mockDevices, type Device } from "@/lib/mock-data"

interface DashboardGlobalProps {
  onSelectDevice: (device: Device) => void
  tunnelEnabled: boolean
  onToggleTunnel: () => void
}

export function DashboardGlobal({ onSelectDevice, tunnelEnabled, onToggleTunnel }: DashboardGlobalProps) {
  const [copied, setCopied] = useState(false)
  const tunnelUrl = "https://vividrop.io/s/a8x2k9"

  const handleCopy = () => {
    navigator.clipboard.writeText(tunnelUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const todayTotalFiles = mockDevices.reduce((sum, d) => sum + d.todayFiles, 0)
  const todayTotalSize = Math.round(mockDevices.reduce((sum, d) => sum + parseFloat(d.todaySize), 0) * 10) / 10

  const sortedDevices = [...mockDevices].sort((a, b) => {
    const priority = { transferring: 0, connected: 1, disconnected: 2 }
    return priority[a.status] - priority[b.status]
  })

  return (
    <div className="h-full overflow-auto custom-scrollbar">
      <div className="px-8 py-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Connected Devices</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Manage file transfers across your devices</p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
            <QrCode className="h-4 w-4" />
            Show QR Code
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-card rounded-xl border border-border p-5 hover-lift">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <FileVideo className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Files Today</p>
                <p className="text-2xl font-semibold text-foreground">{todayTotalFiles}</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border border-border p-5 hover-lift">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100">
                <HardDrive className="h-5 w-5 text-violet-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Data Received</p>
                <p className="text-2xl font-semibold text-foreground">{todayTotalSize} <span className="text-sm font-normal text-muted-foreground">GB</span></p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border border-border p-5 hover-lift">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100">
                <Globe className="h-5 w-5 text-violet-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Tunnel Downloads</p>
                <p className="text-2xl font-semibold text-foreground">24</p>
              </div>
            </div>
          </div>
        </div>

        {/* Devices Grid */}
        <div className="mb-4">
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Active Connections</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sortedDevices.map((device) => (
            <DeviceCard key={device.id} device={device} onClick={() => onSelectDevice(device)} />
          ))}
        </div>
      </div>
    </div>
  )
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
      className={`flex flex-col text-left bg-card rounded-xl border p-5 transition-all hover-lift ${
        isTransferring ? "border-primary/30" : "border-border"
      } ${isDisconnected ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
            isDisconnected ? "bg-muted" : "bg-primary"
          }`}>
            <Smartphone className={`h-5 w-5 ${isDisconnected ? "text-muted-foreground" : "text-primary-foreground"}`} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{device.name}</h3>
            <p className="text-xs text-muted-foreground">{device.ip}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
            isTransferring
              ? "bg-primary/10 text-primary"
              : device.status === "connected"
              ? "bg-violet-100 text-violet-700"
              : "bg-muted text-muted-foreground"
          }`}>
            {isTransferring && (
              <span className="relative flex h-2 w-2">
                <span className="absolute h-full w-full rounded-full bg-primary animate-ping opacity-75" />
                <span className="relative h-2 w-2 rounded-full bg-primary" />
              </span>
            )}
            {device.status === "connected" && <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />}
            {isTransferring ? "Syncing" : device.status === "connected" ? "Connected" : "Offline"}
          </span>
          <div className="p-1 rounded hover:bg-muted transition-colors">
            <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      </div>

      {isTransferring && device.currentFile && (
        <div className="mb-4 rounded-lg bg-muted/50 px-3 py-2.5">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="truncate font-medium text-foreground max-w-[180px]">{device.currentFile.name}</span>
            <span className="font-semibold text-primary">{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-1" />
        </div>
      )}

      <div className="flex items-center gap-4 pt-3 border-t border-border text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <FileVideo className="h-3.5 w-3.5" />
          <span className="font-medium text-foreground">{device.todayFiles}</span> files
        </div>
        <div className="flex items-center gap-1.5">
          <HardDrive className="h-3.5 w-3.5" />
          <span className="font-medium text-foreground">{device.todaySize}</span>
        </div>
        {device.status !== "disconnected" && (
          <div className="flex items-center gap-1.5 ml-auto">
            <Wifi className="h-3.5 w-3.5 text-violet-500" />
            <span className="text-violet-600">LAN</span>
          </div>
        )}
      </div>
    </button>
  )
}
