"use client"

import { useState, useMemo } from "react"
import {
  FileVideo, Image, File, FileAudio,
  ArrowUpDown, ArrowUp, ArrowDown, ExternalLink, RefreshCw,
  FolderOpen, AlertTriangle,
} from "lucide-react"

interface DirFile {
  id: string
  name: string
  size: string
  sizeBytes: number
  type: "video" | "photo" | "audio" | "other"
  receivedAt: string
  deviceName: string
  publishedToPublic: boolean
}

const PRIVATE_FILES: DirFile[] = [
  // Mobile uploads
  { id: "pv1",  name: "DJI_0021_PRO.mp4",         size: "1.5 GB", sizeBytes: 1610612736, type: "video", receivedAt: "今天 14:29", deviceName: "iPhone 15 Pro",     publishedToPublic: false },
  { id: "pv2",  name: "DJI_0022_PRO.mp4",         size: "1.8 GB", sizeBytes: 1932735283, type: "video", receivedAt: "今天 14:28", deviceName: "iPhone 15 Pro",     publishedToPublic: false },
  { id: "pv3",  name: "IMG_8493.HEIC",            size: "12 MB",  sizeBytes: 12582912,   type: "photo", receivedAt: "今天 14:27", deviceName: "iPhone 15 Pro",     publishedToPublic: false },
  { id: "pv4",  name: "A001_C012_1024.braw",      size: "4.2 GB", sizeBytes: 4509715660, type: "video", receivedAt: "今天 14:20", deviceName: "Galaxy S24 Ultra",  publishedToPublic: false },
  // PC imports / edits
  { id: "pv5",  name: "Project_Draft_v2.prproj",  size: "156 MB", sizeBytes: 163577856,  type: "other", receivedAt: "今天 11:35", deviceName: "PC 本地导入",        publishedToPublic: false },
  { id: "pv6",  name: "Color_Graded_Ep01.mp4",    size: "2.8 GB", sizeBytes: 3006477107, type: "video", receivedAt: "今天 10:20", deviceName: "PC 渲染输出",        publishedToPublic: false },
  { id: "pv7",  name: "Sony_A7S3_BTS.mp4",        size: "3.6 GB", sizeBytes: 3865470566, type: "video", receivedAt: "昨天 22:10", deviceName: "iPhone 15 Pro",     publishedToPublic: true  },
  { id: "pv8",  name: "GoPro_Scene01.mp4",        size: "890 MB", sizeBytes: 933232640,  type: "video", receivedAt: "昨天 09:32", deviceName: "iPhone 15 Pro",     publishedToPublic: true  },
  { id: "pv9",  name: "Interview_Main_Cam.mp4",   size: "6.2 GB", sizeBytes: 6657413734, type: "video", receivedAt: "03-18 18:16", deviceName: "iPad Pro",         publishedToPublic: false },
  { id: "pv10", name: "BRoll_CityWalk.mov",       size: "3.1 GB", sizeBytes: 3328706150, type: "video", receivedAt: "03-18 18:00", deviceName: "Galaxy S24 Ultra", publishedToPublic: false },
]

const PUBLIC_FILES: DirFile[] = [
  { id: "pb1", name: "Final_Cut_Ep01.mp4",        size: "2.4 GB", sizeBytes: 2576980377, type: "video", receivedAt: "今天 14:30", deviceName: "剪辑工作站-A",     publishedToPublic: true },
  { id: "pb2", name: "Final_Cut_Ep02.mp4",        size: "2.1 GB", sizeBytes: 2254857830, type: "video", receivedAt: "今天 14:28", deviceName: "剪辑工作站-A",     publishedToPublic: true },
  { id: "pb3", name: "BTS_Highlight_Reel.mp4",    size: "890 MB", sizeBytes: 933232640,  type: "video", receivedAt: "昨天 22:10", deviceName: "剪辑工作站-A",     publishedToPublic: true },
  { id: "pb4", name: "Poster_A_Final.jpg",        size: "28 MB",  sizeBytes: 29360128,   type: "photo", receivedAt: "昨天 20:45", deviceName: "MacBook Pro",      publishedToPublic: true },
]

type Tab = "private" | "public"
type SortField = "name" | "size" | "receivedAt"

function FileIcon({ type }: { type: DirFile["type"] }) {
  const Icon  = type === "video" ? FileVideo : type === "photo" ? Image : type === "audio" ? FileAudio : File
  const color = type === "video" ? "#3b82f6" : type === "photo" ? "#0ea5c9" : type === "audio" ? "#a855f7" : "#6b7a8d"
  const bg    = type === "video" ? "rgba(59,130,246,0.09)" : type === "photo" ? "rgba(14,165,201,0.09)" : type === "audio" ? "rgba(168,85,247,0.09)" : "rgba(107,122,141,0.09)"
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: bg }}>
      <Icon className="h-4 w-4" style={{ color }} />
    </div>
  )
}



export function DirectoryPage() {
  const [tab, setTab] = useState<Tab>("private")
  const [sortField, setSortField] = useState<SortField>("receivedAt")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [isRefreshing, setIsRefreshing] = useState(false)
  
  // Directory configuration state
  const [rootPath, setRootPath] = useState("D:\\FlowSync_Media")
  const [isReceiving, setIsReceiving] = useState(false)
  const [showPathChangeError, setShowPathChangeError] = useState(false)
  
  const receivedPath = `${rootPath}\\received`
  const sharedPath = `${rootPath}\\shared`

  const handleRefresh = () => {
    setIsRefreshing(true)
    setTimeout(() => setIsRefreshing(false), 800)
  }
  
  const handleChangeDirectory = () => {
    if (isReceiving) {
      setShowPathChangeError(true)
      setTimeout(() => setShowPathChangeError(false), 3000)
      return
    }
    console.log("[v0] Opening folder picker...")
  }

  const handleOpenFolder = (folderType: "received" | "shared") => {
    console.log(`[v0] Opening ${folderType} folder...`)
  }

  const files = tab === "private" ? PRIVATE_FILES : PUBLIC_FILES

  const sorted = useMemo(() => {
    const result = [...files]
    result.sort((a, b) => {
      let cmp = 0
      if (sortField === "name") cmp = a.name.localeCompare(b.name)
      else if (sortField === "size") cmp = a.sizeBytes - b.sizeBytes
      else if (sortField === "receivedAt") cmp = a.receivedAt.localeCompare(b.receivedAt)
      return sortDir === "asc" ? cmp : -cmp
    })
    return result
  }, [files, sortField, sortDir])

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortField(field); setSortDir("desc") }
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 opacity-30" />
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3 text-blue-500" /> : <ArrowDown className="h-3 w-3 text-blue-500" />
  }



  const totalSize = (arr: DirFile[]) => {
    const bytes = arr.reduce((s, f) => s + f.sizeBytes, 0)
    return (bytes / 1e9).toFixed(1) + " GB"
  }

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <div className="px-6 pt-5 pb-3">
        <h1 className="text-xl font-bold" style={{ color: "#1a2a3a" }}>{"目录管理"}</h1>
        <p className="text-sm mt-1" style={{ color: "#6b7a8d" }}>
          {"配置根目录路径并管理接收与共享目录的内容"}
        </p>
      </div>

      {/* Directory Configuration Section - Compact */}
      <div className="px-6 pb-4">
        <div
          className="rounded-xl p-4"
          style={{ background: "rgba(255,255,255,0.85)", border: "1px solid rgba(255,255,255,0.95)", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}
        >
          {/* Root Path - Inline Layout */}
          <div className="mb-3">
            <label className="mb-1.5 block text-xs font-semibold" style={{ color: "#1a2a3a" }}>
              {"根目录路径"}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={rootPath}
                readOnly
                className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
                style={{ background: "rgba(240,248,255,0.5)", border: "1px solid rgba(59,159,216,0.15)", color: "#6b7a8d" }}
              />
              <button
                onClick={handleChangeDirectory}
                disabled={isReceiving}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-all hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                style={{ 
                  background: isReceiving ? "#d1d5db" : "linear-gradient(135deg, #3b9fd8, #60c4f0)", 
                  color: "white",
                  boxShadow: isReceiving ? "none" : "0 2px 8px rgba(59,159,216,0.3)"
                }}
                title={isReceiving ? "接收传输中，无法更改接收目录" : "更改根目录"}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {"更改"}
              </button>
            </div>
            {/* Error Toast */}
            {showPathChangeError && (
              <div
                className="mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
                style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#dc2626" }}
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {"接收传输中，无法更改接收目录"}
              </div>
            )}
          </div>

          {/* Sub Directories - Compact */}
          <div className="grid grid-cols-2 gap-2.5">
            {/* Received Directory */}
            <div
              className="rounded-lg p-3"
              style={{ background: "rgba(240,248,255,0.4)", border: "1px solid rgba(59,159,216,0.12)" }}
            >
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-sm">📥</span>
                <h3 className="text-xs font-semibold" style={{ color: "#1a2a3a" }}>
                  {"接收目录"}
                </h3>
              </div>
              <div
                className="mb-2 rounded-lg px-2.5 py-1.5 text-xs truncate"
                style={{ background: "rgba(255,255,255,0.6)", border: "1px solid rgba(59,159,216,0.08)", color: "#6b7a8d" }}
              >
                {receivedPath}
              </div>
              <button
                onClick={() => handleOpenFolder("received")}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all hover:bg-blue-50 w-full justify-center"
                style={{ border: "1px solid rgba(59,130,246,0.2)", color: "#3b82f6" }}
              >
                <FolderOpen className="h-3 w-3" />
                {"打开"}
              </button>
            </div>

            {/* Shared Directory */}
            <div
              className="rounded-lg p-3"
              style={{ background: "rgba(240,248,255,0.4)", border: "1px solid rgba(59,159,216,0.12)" }}
            >
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-sm">📤</span>
                <h3 className="text-xs font-semibold" style={{ color: "#1a2a3a" }}>
                  {"共享目录"}
                </h3>
              </div>
              <div
                className="mb-2 rounded-lg px-2.5 py-1.5 text-xs truncate"
                style={{ background: "rgba(255,255,255,0.6)", border: "1px solid rgba(59,159,216,0.08)", color: "#6b7a8d" }}
              >
                {sharedPath}
              </div>
              <button
                onClick={() => handleOpenFolder("shared")}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all hover:bg-blue-50 w-full justify-center"
                style={{ border: "1px solid rgba(34,197,94,0.2)", color: "#16a34a" }}
              >
                <FolderOpen className="h-3 w-3" />
                {"打开"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content Management Section - Tab switcher */}
      <div className="px-6 mb-4">
        <div className="flex gap-2">
          {/* Private tab */}
          <button
            onClick={() => setTab("private")}
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all"
            style={
              tab === "private"
                ? { background: "rgba(255,255,255,0.88)", color: "#4f46e5", boxShadow: "0 2px 12px rgba(99,102,241,0.12)", border: "1.5px solid rgba(99,102,241,0.25)" }
                : { background: "rgba(255,255,255,0.45)", color: "#8a9ab0", border: "1.5px solid transparent" }
            }
          >
            <span>📥</span>
            {"接收目录"}
            <span
              className="rounded-full px-2 py-0.5 text-xs font-bold"
              style={{ background: tab === "private" ? "rgba(99,102,241,0.12)" : "rgba(0,0,0,0.06)", color: tab === "private" ? "#4f46e5" : "#9ca3af" }}
            >
              {PRIVATE_FILES.length}
            </span>
          </button>

          {/* Public tab */}
          <button
            onClick={() => setTab("public")}
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all"
            style={
              tab === "public"
                ? { background: "rgba(255,255,255,0.88)", color: "#16a34a", boxShadow: "0 2px 12px rgba(34,197,94,0.12)", border: "1.5px solid rgba(34,197,94,0.30)" }
                : { background: "rgba(255,255,255,0.45)", color: "#8a9ab0", border: "1.5px solid transparent" }
            }
          >
            <span>🌐</span>
            {"共享目录"}
            <span
              className="rounded-full px-2 py-0.5 text-xs font-bold"
              style={{ background: tab === "public" ? "rgba(34,197,94,0.12)" : "rgba(0,0,0,0.06)", color: tab === "public" ? "#16a34a" : "#9ca3af" }}
            >
              {PUBLIC_FILES.length}
            </span>
          </button>
        </div>
      </div>

      {/* Directory description */}
      <div className="px-6 mb-3">
        <div
          className="rounded-xl px-4 py-2.5"
          style={
            tab === "private"
              ? { background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.15)" }
              : { background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)" }
          }
        >
          <p className="text-xs" style={{ color: tab === "private" ? "#4a4a9a" : "#167a3a", lineHeight: 1.6 }}>
            {tab === "private" ? "接收移动端上传的素材文件，仅供 PC 本地管理使用" : "剪辑完成后，将文件放入此目录供移动端实时查看和下载"}
          </p>
        </div>
      </div>

      {/* Stats bar + action buttons */}
      <div className="px-6 mb-3">
        <div
          className="flex items-center gap-4 rounded-xl px-4 py-2.5"
          style={{ background: "rgba(255,255,255,0.60)", border: "1px solid rgba(255,255,255,0.85)", backdropFilter: "blur(8px)" }}
        >
          {/* Stats */}
          <span className="text-xs" style={{ color: "#8a9ab0" }}>{"共"}<span className="ml-1 font-semibold" style={{ color: "#1a2a3a" }}>{files.length}</span>{" 个文件"}</span>
          <div className="h-3 w-px" style={{ background: "rgba(0,0,0,0.08)" }} />
          <span className="text-xs" style={{ color: "#8a9ab0" }}>{"总大小 "}<span className="font-semibold" style={{ color: "#1a2a3a" }}>{totalSize(files)}</span></span>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Action buttons — available for both directories */}
          <div className="flex items-center gap-2">
            {/* Refresh button */}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all hover:bg-white/80 disabled:opacity-60"
              style={{ color: "#6b7a8d", border: "1px solid rgba(0,0,0,0.08)", background: "rgba(255,255,255,0.50)" }}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
              {"刷新"}
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 pb-8">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
              <th className="pb-2.5 text-left pr-4">
                <button onClick={() => handleSort("name")} className="flex items-center gap-1 text-xs font-medium hover:text-blue-500" style={{ color: "#8a9ab0" }}>
                  {"文件名称"} <SortIcon field="name" />
                </button>
              </th>
              <th className="pb-2.5 text-left pr-4">
                <button onClick={() => handleSort("size")} className="flex items-center gap-1 text-xs font-medium hover:text-blue-500" style={{ color: "#8a9ab0" }}>
                  {"大小"} <SortIcon field="size" />
                </button>
              </th>
              <th className="pb-2.5 text-left pr-4">
                <button onClick={() => handleSort("receivedAt")} className="flex items-center gap-1 text-xs font-medium hover:text-blue-500" style={{ color: "#8a9ab0" }}>
                  {tab === "private" ? "接收时间" : "共享时间"} <SortIcon field="receivedAt" />
                </button>
              </th>
              <th className="pb-2.5 text-left pr-4 text-xs font-medium" style={{ color: "#8a9ab0" }}>
                {"来源设备"}
              </th>
              <th className="pb-2.5 text-right text-xs font-medium" style={{ color: "#8a9ab0" }}>
                {"操作"}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((file, i) => {
              return (
                <tr
                  key={file.id}
                  className="transition-colors hover:bg-blue-50/40"
                  style={{ borderBottom: i < sorted.length - 1 ? "1px solid rgba(0,0,0,0.05)" : "none" }}
                >
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-3">
                      <FileIcon type={file.type} />
                      <div className="min-w-0">
                        <span className="font-medium truncate block max-w-[200px]" style={{ color: "#1a2a3a" }}>{file.name}</span>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-sm" style={{ color: "#6b7a8d" }}>{file.size}</td>
                  <td className="py-3 pr-4 text-sm" style={{ color: "#6b7a8d" }}>{file.receivedAt}</td>
                  <td className="py-3 pr-4 text-sm" style={{ color: "#6b7a8d" }}>{file.deviceName}</td>
                  <td className="py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {/* Open file */}
                      <button
                        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-blue-50"
                        style={{ color: "#3b82f6", border: "1px solid rgba(59,130,246,0.18)" }}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        {"打开"}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Publish confirm dialog */}
    </div>
  )
}
