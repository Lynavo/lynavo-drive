"use client"

import { useState, useMemo } from "react"
import {
  FolderOpen,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  X,
  FileVideo,
  Image,
  FileAudio,
  File,
  ExternalLink,
  FileVideo2,
  HardDrive,
  Smartphone,
  Monitor,
} from "lucide-react"
import type { Device } from "@/lib/mock-data"
import { mockHistory } from "@/lib/mock-data"

interface DeviceDetailModalProps {
  device: Device | null
  open: boolean
  onClose: () => void
}

type SortField = "name" | "size" | "completedAt" | "createdAt" | "duration"
type SortDirection = "asc" | "desc"

function FileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  const isVideo = ["mp4", "mov", "avi", "braw", "mxf", "r3d"].includes(ext)
  const isImage = ["jpg", "jpeg", "png", "heic", "raw", "arw", "dng"].includes(ext)
  const isAudio = ["wav", "aif", "mp3", "aac"].includes(ext)
  const Icon  = isVideo ? FileVideo : isImage ? Image : isAudio ? FileAudio : File
  const color = isVideo ? "#3b82f6" : isImage ? "#0ea5c9" : isAudio ? "#a855f7" : "#6b7a8d"
  const bg    = isVideo ? "rgba(59,130,246,0.09)" : isImage ? "rgba(14,165,201,0.09)" : isAudio ? "rgba(168,85,247,0.09)" : "rgba(107,122,141,0.09)"
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: bg }}>
      <Icon className="h-4 w-4" style={{ color }} />
    </div>
  )
}

export function DeviceDetailModal({ device, open, onClose }: DeviceDetailModalProps) {
  const [selectedDate, setSelectedDate] = useState(mockHistory[0]?.date || "")
  const [sortField, setSortField] = useState<SortField>("completedAt")
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc")
  const [showDateDropdown, setShowDateDropdown] = useState(false)

  const selectedRecord = mockHistory.find((r) => r.date === selectedDate)
  const files = selectedRecord?.files || []

  const filteredFiles = useMemo(() => {
    const result = [...files]
    result.sort((a, b) => {
      let cmp = 0
      if (sortField === "name") cmp = a.name.localeCompare(b.name)
      else if (sortField === "size") cmp = a.sizeBytes - b.sizeBytes
      else if (sortField === "completedAt") cmp = (a.completedAt || "").localeCompare(b.completedAt || "")
      else if (sortField === "createdAt") cmp = (a.createdAt || "").localeCompare(b.createdAt || "")
      else if (sortField === "duration") cmp = (a.duration || "").localeCompare(b.duration || "")
      return sortDirection === "asc" ? cmp : -cmp
    })
    return result
  }, [files, sortField, sortDirection])

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDirection((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortField(field); setSortDirection("desc") }
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 opacity-30" />
    return sortDirection === "asc"
      ? <ArrowUp className="h-3 w-3 text-blue-500" />
      : <ArrowDown className="h-3 w-3 text-blue-500" />
  }

  if (!open || !device) return null

  const dateLabel = selectedDate === new Date().toISOString().slice(0, 10)
    ? `\u4ECA\u5929 (${selectedDate.slice(5).replace("-", "\u6708") + "\u65E5"})`
    : selectedDate.slice(5).replace("-", "\u6708") + "\u65E5"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(180,210,235,0.35)", backdropFilter: "blur(8px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="relative flex flex-col overflow-hidden"
        style={{
          background: "rgba(248,252,255,0.88)",
          backdropFilter: "blur(24px)",
          border: "1px solid rgba(255,255,255,0.85)",
          borderRadius: 20,
          boxShadow: "0 24px 80px rgba(80,150,200,0.18), 0 4px 20px rgba(0,0,0,0.06)",
          width: "min(720px, 92vw)",
          maxHeight: "82vh",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-4 px-6 py-5" style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{ background: "linear-gradient(135deg, #3b82f6 0%, #60c4f0 100%)", boxShadow: "0 2px 8px rgba(59,130,246,0.3)" }}
          >
            {/iphone|ipad|galaxy|pixel|android|mobile/i.test(device.name)
              ? <Smartphone className="h-5 w-5 text-white" />
              : <Monitor className="h-5 w-5 text-white" />
            }
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold" style={{ color: "#1a2a3a" }}>
              {device.name}
              <span className="ml-2 text-xs font-normal" style={{ color: "#8a9ab0" }}>{device.ip}</span>
            </h2>
            <p className="text-xs truncate" style={{ color: "#8a9ab0" }}>
              <span className="font-medium" style={{ color: "#6b7a8d" }}>{"当前接收目录："}</span>
              {device.storagePath}
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: "#aab4c0" }}>
              {"以下为该设备历史上传记录，文件可能分布在不同接收目录中"}
            </p>
          </div>

          <button
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-colors"
            style={{ background: "rgba(59,130,246,0.08)", color: "#3b82f6", border: "1px solid rgba(59,130,246,0.15)" }}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {"打开当前接收目录"}
          </button>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-black/5"
            style={{ color: "#8a9ab0" }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 px-6 py-3">
          {/* Date dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowDateDropdown(!showDateDropdown)}
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors"
              style={{ background: "rgba(255,255,255,0.8)", border: "1px solid rgba(0,0,0,0.08)", color: "#1a2a3a" }}
            >
              {dateLabel}
              <ChevronDown className="h-3.5 w-3.5" style={{ color: "#8a9ab0" }} />
            </button>
            {showDateDropdown && (
              <div
                className="absolute top-full left-0 z-50 mt-1 w-44 overflow-hidden rounded-xl py-1 shadow-xl"
                style={{ background: "rgba(255,255,255,0.96)", backdropFilter: "blur(16px)", border: "1px solid rgba(0,0,0,0.08)" }}
              >
                {mockHistory.map((record) => (
                  <button
                    key={record.date}
                    onClick={() => { setSelectedDate(record.date); setShowDateDropdown(false) }}
                    className="w-full px-4 py-2.5 text-left text-sm transition-colors hover:bg-blue-50"
                    style={{ color: selectedDate === record.date ? "#3b82f6" : "#1a2a3a", fontWeight: selectedDate === record.date ? 600 : 400 }}
                  >
                    {record.date}
                  </button>
                ))}
              </div>
            )}
          </div>


        </div>

        {/* Stats bar */}
        {filteredFiles.length > 0 && (
          <div
            className="mx-6 mb-3 flex items-center gap-4 rounded-xl px-4 py-2.5"
            style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.10)" }}
          >
            <div className="flex items-center gap-2">
              <FileVideo2 className="h-3.5 w-3.5" style={{ color: "#3b82f6" }} />
              <span className="text-xs font-semibold" style={{ color: "#1a2a3a" }}>
                {filteredFiles.length}
                <span className="ml-1 font-normal" style={{ color: "#8a9ab0" }}>{"\u4e2a\u6587\u4ef6"}</span>
              </span>
            </div>
            <div className="h-3 w-px" style={{ background: "rgba(59,130,246,0.15)" }} />
            <div className="flex items-center gap-2">
              <HardDrive className="h-3.5 w-3.5" style={{ color: "#7c6fdd" }} />
              <span className="text-xs font-semibold" style={{ color: "#1a2a3a" }}>
                {(filteredFiles.reduce((s, f) => s + f.sizeBytes, 0) / 1e9).toFixed(1)}
                <span className="ml-1 font-normal" style={{ color: "#8a9ab0" }}>GB</span>
              </span>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto px-6 pb-6">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
                <th className="pb-2.5 text-left pr-4">
                  <button onClick={() => handleSort("name")} className="flex items-center gap-1 text-xs font-medium transition-colors hover:text-blue-500" style={{ color: "#8a9ab0" }}>
                    {"\u6587\u4EF6\u540D\u79F0"} <SortIcon field="name" />
                  </button>
                </th>
                <th className="pb-2.5 text-left pr-4">
                  <button onClick={() => handleSort("size")} className="flex items-center gap-1 text-xs font-medium transition-colors hover:text-blue-500" style={{ color: "#8a9ab0" }}>
                    {"\u6587\u4EF6\u5927\u5C0F"} <SortIcon field="size" />
                  </button>
                </th>
                <th className="pb-2.5 text-left pr-4">
                  <button onClick={() => handleSort("completedAt")} className="flex items-center gap-1 text-xs font-medium transition-colors hover:text-blue-500" style={{ color: "#8a9ab0" }}>
                    {"\u5B8C\u6210\u65F6\u95F4"} <SortIcon field="completedAt" />
                  </button>
                </th>
                <th className="pb-2.5 text-left pr-4">
                  <button onClick={() => handleSort("createdAt")} className="flex items-center gap-1 text-xs font-medium transition-colors hover:text-blue-500" style={{ color: "#8a9ab0" }}>
                    {"\u521B\u5EFA\u65F6\u95F4"} <SortIcon field="createdAt" />
                  </button>
                </th>
                <th className="pb-2.5 text-left pr-4">
                  <button onClick={() => handleSort("duration")} className="flex items-center gap-1 text-xs font-medium transition-colors hover:text-blue-500" style={{ color: "#8a9ab0" }}>
                    {"\u4F20\u8F93\u8017\u65F6"} <SortIcon field="duration" />
                  </button>
                </th>
                <th className="pb-2.5 text-right text-xs font-medium" style={{ color: "#8a9ab0" }}>
                  {"\u64CD\u4F5C"}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredFiles.map((file, i) => (
                <tr
                  key={file.id}
                  className="transition-colors hover:bg-blue-50/40"
                  style={{ borderBottom: i < filteredFiles.length - 1 ? "1px solid rgba(0,0,0,0.05)" : "none" }}
                >
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-3">
                      <FileIcon name={file.name} />
                      <span className="font-medium" style={{ color: "#1a2a3a" }}>{file.name}</span>
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-sm" style={{ color: "#6b7a8d" }}>{file.size}</td>
                  <td className="py-3 pr-4 text-sm" style={{ color: "#6b7a8d" }}>{file.completedAt}</td>
                  <td className="py-3 pr-4 text-sm" style={{ color: "#6b7a8d" }}>{file.createdAt ?? "—"}</td>
                  <td className="py-3 pr-4 text-sm" style={{ color: "#6b7a8d" }}>{file.duration}</td>
                  <td className="py-3 text-right">
                    {/* Open file — replaces delete */}
                    <button
                      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-blue-50"
                      style={{ color: "#3b82f6", border: "1px solid rgba(59,130,246,0.18)" }}
                      title={"\u6253\u5f00\u6587\u4ef6"}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {"\u6253\u5f00"}
                    </button>
                  </td>
                </tr>
              ))}
              {filteredFiles.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-sm" style={{ color: "#8a9ab0" }}>
                    {"\u8BE5\u65E5\u671F\u6682\u65E0\u4F20\u8F93\u8BB0\u5F55"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
