"use client"

import { useState, useEffect, useRef } from "react"
import { History, Settings, FileVideo, FileImage, File, Crown, Check, ChevronRight, HelpCircle } from "lucide-react"
import { UsageGuideModal } from "./usage-guide-modal"

interface TransferFile {
  id: string
  name: string
  size: string
  status: "transferring" | "preparing" | "queued"
  progress?: number
  transferred?: string
  thumbnailColor?: string
  type?: string
  uploadTime?: string
  destination?: string
  platform?: string
  albumName?: string
  category?: string
  uploadMethod?: string
  source?: "manual" | "auto"
  actions?: {
    hasMore: boolean
    onMore?: () => void
  }
}

type GlobalTransferState = "idle" | "auto_syncing" | "transitioning" | "manual_uploading" | "manual_completed" | "auto_completed"

interface QueueItem {
  id: string
  name: string
  size: string
  source: "manual" | "auto"
  status: "transferring" | "queued"
  progress?: number
}

interface TransferPageProps {
  onNavigateHistory: () => void
  onNavigateSettings: () => void
  onNavigateAlbum?: () => void
  onNavigatePublicFiles?: () => void
  onNavigateSubscription?: () => void
  onNavigateHelp?: () => void
  onNavigateScan?: () => void
  autoShowGuide?: boolean
  trialDaysLeft?: number
  isPro?: boolean
  isExpired?: boolean
  isExpiringSoon?: boolean
  daysUntilExpiry?: number | null
  syncCompleted?: boolean
  completedStats?: {
    fileCount: number
    totalSize: string
    lastSyncTime: string
    deviceName: string
  }
  manualCompletedStats?: {
    fileCount: number
    totalCount: number
    totalSize: string
  }
  autoCompletedStats?: {
    fileCount: number
    totalSize: string
    lastSyncTime: string
  }
  globalTransferState?: GlobalTransferState
  manualQueue?: QueueItem[]
  onCancelManual?: () => void
  onCancelAutoSync?: () => void
  autoUploadEnabled?: boolean
  onStartAutoSync?: () => void
  onStopAutoSync?: () => void
}

const mockTransferQueue: TransferFile[] = [
  { id: "1", name: "IMG_0442.MOV", size: "1.7 GB", status: "transferring", progress: 31, transferred: "552.0 MB", source: "manual" },
  { id: "2", name: "IMG_0441.HEIC", size: "1.7 MB", status: "preparing", source: "manual" },
  { id: "3", name: "IMG_0440.PNG", size: "165.6 KB", status: "queued", source: "manual" },
  { id: "4", name: "ScreenRecording_11-07-2025 11-01-26_1...", size: "9.5 MB", status: "queued", source: "auto" },
  { id: "5", name: "ScreenRecording_11-06-2025 10-30-00_1...", size: "10.6 MB", status: "queued", source: "auto" },
  { id: "6", name: "ScreenRecording_11-06-2025 10-13-25_1...", size: "6.5 MB", status: "queued", source: "manual" },
  { id: "7", name: "ScreenRecording_11-06-2025 09-54-07_1...", size: "10.5 MB", status: "queued", source: "auto" },
]

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase()
  if (["mp4", "mov", "braw", "avi", "mxf", "m4v"].includes(ext ?? ""))
    return <FileVideo className="h-5 w-5" style={{ color: "#3b9fd8" }} />
  if (["heic", "jpg", "jpeg", "png", "raw", "gif", "webp"].includes(ext ?? ""))
    return <FileImage className="h-5 w-5" style={{ color: "#5ba8d8" }} />
  return <File className="h-5 w-5" style={{ color: "#3b9fd8" }} />
}

function getStatusBadge(status: TransferFile["status"], progress?: number) {
  switch (status) {
    case "transferring":
      return (
        <span className="flex items-center gap-1 text-xs font-medium" style={{ color: "#3b9fd8" }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#3b9fd8" }} />
          {`传输中 ${progress ?? 0}%`}
        </span>
      )
    case "preparing":
      return (
        <span className="flex items-center gap-1 text-xs font-medium" style={{ color: "#f59e0b" }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#f59e0b" }} />
          {"准备中"}
        </span>
      )
    case "queued":
      return (
        <span className="flex items-center gap-1 text-xs font-medium" style={{ color: "#94a3b8" }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#94a3b8" }} />
          {"排队中"}
        </span>
      )
  }
}

export function TransferPage({
  onNavigateHistory,
  onNavigateSettings,
  onNavigateAlbum,
  onNavigatePublicFiles,
  onNavigateSubscription,
  onNavigateHelp,
  onNavigateScan,
  autoShowGuide,
  trialDaysLeft,
  isPro,
  isExpired = false,
  isExpiringSoon = false,
  daysUntilExpiry = null,
  syncCompleted = false,
  completedStats = {
    fileCount: 473,
    totalSize: "4.9 GB",
    lastSyncTime: "今天 16:08",
    deviceName: "bloomingdeMac-mini-2"
  },
  globalTransferState = "auto_syncing",
  manualQueue = [],
  onCancelManual,
  onCancelAutoSync,
  autoUploadEnabled = false,
  onStartAutoSync,
  onStopAutoSync,
  manualCompletedStats = { fileCount: 12, totalCount: 12, totalSize: "6.2 GB" },
  autoCompletedStats = { fileCount: 38, totalSize: "12.4 GB", lastSyncTime: "今天 14:32" },
}: TransferPageProps) {
  const [progress, setProgress] = useState(31)
  const [mounted, setMounted] = useState(false)
  const [showCancelManualModal, setShowCancelManualModal] = useState(false)
  const [showCancelAutoModal, setShowCancelAutoModal] = useState(false)
  const [showStartAutoModal, setShowStartAutoModal] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  // Refs for coach mark spotlight targets
  const refContainer = useRef<HTMLDivElement>(null)
  const refHelpBtn = useRef<HTMLButtonElement>(null)
  const refHistoryBtn = useRef<HTMLButtonElement>(null)
  const refMainCard = useRef<HTMLDivElement>(null)
  const refAlbumBtn = useRef<HTMLButtonElement>(null)
  const refSettingsBtn = useRef<HTMLButtonElement>(null)

  const isManual = globalTransferState === "manual_uploading"
  const isManualCompleted = globalTransferState === "manual_completed"
  const isAutoCompleted = globalTransferState === "auto_completed"
  const isTransitioning = globalTransferState === "transitioning"
  const isAutoSyncing = globalTransferState === "auto_syncing"
  const isIdle = globalTransferState === "idle"

  useEffect(() => { setMounted(true) }, [])

  // Show guide when parent signals it (after login)
  useEffect(() => {
    if (!autoShowGuide) return
    const timer = setTimeout(() => setShowGuide(true), 600)
    return () => clearTimeout(timer)
  }, [autoShowGuide])

  // Simulate progress
  useEffect(() => {
    if (!mounted) return
    const interval = setInterval(() => {
      setProgress((prev) => (prev >= 100 ? 0 : prev + 1))
    }, 500)
    return () => clearInterval(interval)
  }, [mounted])

  // Build the display queue: manual queue first (priority), then auto queue
  const autoMockQueue: TransferFile[] = mockTransferQueue.filter((f) => f.source === "auto")
  const displayQueue: TransferFile[] = isManual
    ? [
        ...manualQueue.map((item, i) => ({
          ...item,
          status: i === 0 ? ("transferring" as const) : ("queued" as const),
          progress: i === 0 ? progress : undefined,
        })),
        ...autoMockQueue.map((f) => ({ ...f, status: "queued" as const })),
      ]
    : mockTransferQueue

  const transferringFile = mockTransferQueue.find((f) => f.status === "transferring")
  const currentFileName = isManual
    ? (manualQueue[0]?.name ?? "")
    : (transferringFile?.name ?? "")
  const queueCount = 8041
  const currentSpeed = "0.7 MB/s"
  const transferProgress = isManual ? progress : progress
  // Stats shown in the 3-column row
  const statSpeed = isManual ? currentSpeed : "0.7 MB/s"
  const statProgress = isManual
    ? `${manualQueue.length > 0 ? 1 : 0} / ${manualQueue.length}`
    : `0 / 6042`
  const statTransferred = "0 B"

  const accentColor = isManual ? "#3b82f6" : "#3b9fd8"

  return (
    <div ref={refContainer} className="relative flex h-full w-full flex-col overflow-hidden" style={{ background: "#dceefa" }}>
      {/* Header */}
      <header className="shrink-0 px-5 pt-14 pb-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold" style={{ color: "#1a3a5c" }}>{"同步动态"}</h1>
          <div className="flex items-center gap-2">
            <button
              ref={refHelpBtn}
              onClick={onNavigateHelp}
              className="flex h-11 w-11 items-center justify-center rounded-full transition-colors active:bg-black/5"
              style={{ color: "#5a7a96" }}
              aria-label="帮助"
            >
              <HelpCircle className="h-6 w-6" strokeWidth={1.5} />
            </button>
            <button
              ref={refHistoryBtn}
              onClick={onNavigateHistory}
              className="flex h-11 w-11 items-center justify-center rounded-full transition-colors active:bg-black/5"
              style={{ color: "#5a7a96" }}
              aria-label="历史记录"
            >
              <History className="h-6 w-6" strokeWidth={1.5} />
            </button>
            <button
              ref={refSettingsBtn}
              onClick={onNavigateSettings}
              className="flex h-11 w-11 items-center justify-center rounded-full transition-colors active:bg-black/5"
              style={{ color: "#5a7a96" }}
              aria-label="设置"
            >
              <Settings className="h-6 w-6" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col overflow-y-auto px-4 pb-6 gap-0">

        {/* ── 同步动态 卡片 ── */}
        <section className="mb-0">
          <div
            ref={refMainCard}
            className="rounded-3xl overflow-hidden"
            style={{ background: "rgba(255,255,255,0.9)", boxShadow: "0 2px 16px rgba(59,130,210,0.10)" }}
          >
            {/* Device row */}
            <div className="flex items-center gap-3 px-4 pt-4 pb-3" style={{ borderBottom: "1px solid #f0f6fb" }}>
              {/* Device icon */}
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                style={{ background: "#e8f4fc" }}
              >
                {/* Mini computer icon */}
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="4" width="18" height="12" rx="2" stroke="#3b9fd8" strokeWidth="1.8"/>
                  <path d="M8 20h8M12 16v4" stroke="#3b9fd8" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-bold truncate" style={{ color: "#1a3a5c" }}>{"Mini4"}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: "#22c55e" }} />
                  <span className="text-xs font-medium" style={{ color: "#22c55e" }}>{"在线"}</span>
                </div>
              </div>
            </div>

            {/* Syncing body */}
            <div className="px-4 pt-3 pb-4">
              {/* ── Expired / paywall state ── */}
              {isExpired ? (
                <div className="flex flex-col items-center py-4 text-center">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-full mb-4"
                    style={{ background: "rgba(239,68,68,0.08)" }}
                  >
                    <Crown className="h-6 w-6" style={{ color: "#ef4444" }} />
                  </div>
                  <p className="text-[17px] font-bold mb-1.5" style={{ color: "#1a3a5c" }}>
                    {isPro ? "订阅已到期" : "试用已结束"}
                  </p>
                  <p className="text-[13px] leading-relaxed mb-5" style={{ color: "#8aabbd" }}>
                    {"续订后可继续使用素材上传、自动上传与共享文件访问"}
                  </p>
                  <div className="flex flex-col gap-2 w-full">
                    <button
                      onClick={onNavigateSubscription}
                      className="w-full rounded-xl py-2.5 text-[15px] font-bold text-white transition-all active:scale-[0.98]"
                      style={{ background: "#1a3a5c" }}
                    >
                      {isPro ? "立即续订" : "立即订阅"}
                    </button>
                    <button
                      onClick={onNavigateHelp}
                      className="w-full rounded-xl py-2.5 text-[14px] font-semibold transition-all active:scale-[0.98]"
                      style={{ color: "#5a7a96", border: "1px solid rgba(59,130,210,0.18)", background: "transparent" }}
                    >
                      {"查看帮助"}
                    </button>
                  </div>
                </div>
              ) : null}

              {!isExpired && (
              <>
              {/* Transitioning banner */}
              {isTransitioning && (
                <div
                  className="flex items-center gap-2 rounded-xl px-3 py-2 mb-3 text-xs font-medium"
                  style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", color: "#d97706" }}
                >
                  <span className="h-2 w-2 rounded-full animate-pulse shrink-0" style={{ background: "#f59e0b" }} />
                  {"正在等待当前文件完成，即将切换为手动传输..."}
                </div>
              )}

              {isManualCompleted ? (
                /* Manual upload completed state */
                <>
                  {/* Mode tag + title */}
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-[11px] font-bold px-2 py-0.5 rounded-md"
                      style={{ background: "rgba(22,163,74,0.12)", color: "#16a34a" }}
                    >
                      {"手动"}
                    </span>
                  </div>
                  <p className="text-[22px] font-bold mb-3 leading-tight" style={{ color: "#1a3a5c" }}>
                    {"手动上传已完成"}
                  </p>

                  {/* Progress bar — 100% */}
                  <div className="relative mb-1">
                    <div className="h-2 w-full rounded-full overflow-hidden" style={{ background: "#d6eaf8" }}>
                      <div className="h-full w-full rounded-full" style={{ background: "linear-gradient(90deg, #16a34a 0%, #4ade80 100%)" }} />
                    </div>
                    <span className="absolute right-0 -top-5 text-sm font-bold" style={{ color: "#16a34a" }}>{"100%"}</span>
                  </div>

                  {/* File count summary */}
                  <p className="text-xs mb-3" style={{ color: "#8aabbd" }}>
                    {`已完成 ${manualCompletedStats.fileCount} / ${manualCompletedStats.totalCount}`}
                  </p>

                  {/* 3-column stats */}
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {[
                      { label: "速度", value: "—" },
                      { label: "进度", value: `${manualCompletedStats.fileCount} / ${manualCompletedStats.totalCount}` },
                      { label: "已传输", value: manualCompletedStats.totalSize },
                    ].map(({ label, value }) => (
                      <div
                        key={label}
                        className="rounded-xl px-3 py-2.5 flex flex-col items-center"
                        style={{ background: "rgba(240,248,255,0.8)", border: "1px solid rgba(59,159,216,0.10)" }}
                      >
                        <p className="text-[10px] mb-0.5 font-medium" style={{ color: "#8aabbd" }}>{label}</p>
                        <p className="text-xs font-bold truncate w-full text-center" style={{ color: label === "速度" ? "#b0c8d8" : "#1a3a5c" }}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Secondary note */}
                  <p className="text-[11px] text-center mb-3" style={{ color: "#94a3b8" }}>
                    {"本次上传已完成"}
                    {!autoUploadEnabled && <span className="block mt-0.5">{"自动上传未开启 · 可继续手动上传或开启自动上传"}</span>}
                  </p>

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    <button
                      onClick={onNavigateAlbum}
                      className="flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all active:scale-[0.98]"
                      style={{ color: "#1a3a5c", border: "1.5px solid rgba(59,130,210,0.30)", background: "transparent" }}
                    >
                      {"去相册继续上传"}
                    </button>
                    {!autoUploadEnabled && (
                      <button
                        onClick={() => onStartAutoSync?.()}
                        className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white transition-all active:scale-[0.98]"
                        style={{ background: "#1a3a5c" }}
                      >
                        {"开启自动上传"}
                      </button>
                    )}
                  </div>
                </>
              ) : isAutoCompleted ? (
                /* Auto upload completed state */
                <>
                  {/* Mode tag + title */}
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-[11px] font-bold px-2 py-0.5 rounded-md"
                      style={{ background: "rgba(59,130,246,0.12)", color: "#3b82f6" }}
                    >
                      {"自动"}
                    </span>
                  </div>
                  <p className="text-[22px] font-bold mb-3 leading-tight" style={{ color: "#1a3a5c" }}>
                    {"自动上传已完成"}
                  </p>

                  {/* Progress bar — 100% */}
                  <div className="relative mb-1">
                    <div className="h-2 w-full rounded-full overflow-hidden" style={{ background: "#d6eaf8" }}>
                      <div className="h-full w-full rounded-full" style={{ background: "linear-gradient(90deg, #16a34a 0%, #4ade80 100%)" }} />
                    </div>
                    <span className="absolute right-0 -top-5 text-sm font-bold" style={{ color: "#16a34a" }}>{"100%"}</span>
                  </div>

                  {/* File count summary */}
                  <p className="text-xs mb-3" style={{ color: "#8aabbd" }}>
                    {`本次共同步 ${autoCompletedStats.fileCount} 个文件`}
                  </p>

                  {/* 3-column stats */}
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {[
                      { label: "速度", value: "—" },
                      { label: "文件数", value: `${autoCompletedStats.fileCount} 个` },
                      { label: "已传输", value: autoCompletedStats.totalSize },
                    ].map(({ label, value }) => (
                      <div
                        key={label}
                        className="rounded-xl px-3 py-2.5 flex flex-col items-center"
                        style={{ background: "rgba(240,248,255,0.8)", border: "1px solid rgba(59,159,216,0.10)" }}
                      >
                        <p className="text-[10px] mb-0.5 font-medium" style={{ color: "#8aabbd" }}>{label}</p>
                        <p className="text-xs font-bold truncate w-full text-center" style={{ color: label === "速度" ? "#b0c8d8" : "#1a3a5c" }}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Last sync time */}
                  <p className="text-[11px] text-center mb-3" style={{ color: "#94a3b8" }}>
                    {"最近同步："}{autoCompletedStats.lastSyncTime}
                  </p>

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    <button
                      onClick={onNavigateAlbum}
                      className="flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all active:scale-[0.98]"
                      style={{ color: "#1a3a5c", border: "1.5px solid rgba(59,130,210,0.30)", background: "transparent" }}
                    >
                      {"去相册"}
                    </button>
                    <button
                      onClick={() => onStopAutoSync?.()}
                      className="flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all active:scale-[0.98]"
                      style={{ color: "#ef4444", border: "1.5px solid rgba(239,68,68,0.25)", background: "transparent" }}
                    >
                      {"关闭自动上传"}
                    </button>
                  </div>
                </>
              ) : syncCompleted ? (
                /* Completed state (legacy) */
                <div className="flex flex-col items-center py-3">
                  <div className="relative mb-4">
                    <div className="absolute -inset-3 rounded-full" style={{ background: "radial-gradient(ellipse, rgba(180,220,240,0.4) 0%, transparent 70%)" }} />
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "#22c55e" }}>
                      <Check className="h-7 w-7 text-white" strokeWidth={3} />
                    </div>
                  </div>
                  <h2 className="text-lg font-bold mb-1" style={{ color: "#3b9fd8" }}>{"所有文件已同步"}</h2>
                  <p className="text-base font-bold mb-1" style={{ color: "#3b9fd8" }}>{completedStats.fileCount}{"个文件 · "}{completedStats.totalSize}</p>
                  <p className="text-xs mb-3" style={{ color: "#94a3b8" }}>{"本次同步已全部完成"}</p>
                  <p className="text-xs" style={{ color: "#94a3b8" }}>{"最近同步："}{completedStats.lastSyncTime}{" · "}{completedStats.deviceName}</p>
                </div>
              ) : isIdle ? (
                /* Idle state */
                <div className="flex flex-col items-center py-4">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-full mb-3"
                    style={{ background: "rgba(59,159,216,0.10)" }}
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="9" stroke="#8aabbd" strokeWidth="1.8"/>
                      <path d="M12 8v4M12 16h.01" stroke="#8aabbd" strokeWidth="1.8" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <p className="text-base font-bold mb-1" style={{ color: "#1a3a5c" }}>{"自动上传未开启"}</p>
                  <p className="text-xs mb-4" style={{ color: "#8aabbd" }}>{"开启自动上传，后台静默同步；或前往相册手动传输"}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={onNavigateAlbum}
                      className="rounded-xl px-4 py-2 text-sm font-semibold transition-all active:scale-[0.98]"
                      style={{ background: "rgba(59,130,210,0.10)", color: "#1a3a5c", border: "1px solid rgba(59,130,210,0.18)" }}
                    >
                      {"去相册"}
                    </button>
                    <button
                      onClick={() => {
                        onStartAutoSync?.()
                        onNavigateAlbum?.()
                      }}
                      className="rounded-xl px-4 py-2 text-sm font-semibold transition-all active:scale-[0.98]"
                      style={{ background: "#1a3a5c", color: "#fff" }}
                    >
                      {"开启自动上传"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Mode tag + title */}
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-[11px] font-bold px-2 py-0.5 rounded-md"
                      style={{ background: isManual ? "rgba(59,130,246,0.12)" : "rgba(59,159,216,0.12)", color: accentColor }}
                    >
                      {isManual ? "手动" : "自动"}
                    </span>
                    {isAutoSyncing && !isManual && (
                      <span className="text-[11px]" style={{ color: "#8aabbd" }}>{"自动上传已开启"}</span>
                    )}
                  </div>
                  <p className="text-[22px] font-bold mb-3 leading-tight" style={{ color: "#1a3a5c" }}>
                    {isManual ? "手动上传中" : isTransitioning ? "正在切换..." : "正在自动上传"}
                  </p>

                  {/* Progress bar */}
                  <div className="relative mb-1">
                    <div className="h-2 w-full rounded-full overflow-hidden" style={{ background: "#d6eaf8" }}>
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{ width: `${transferProgress}%`, background: `linear-gradient(90deg, ${accentColor} 0%, #60c4f0 100%)` }}
                      />
                    </div>
                    <span
                      className="absolute right-0 -top-5 text-sm font-bold"
                      style={{ color: accentColor }}
                    >
                      {`${transferProgress}%`}
                    </span>
                  </div>

                  {/* Current file name */}
                  {currentFileName !== "" && (
                    <p className="text-xs mb-3 truncate" style={{ color: "#8aabbd" }}>{currentFileName}</p>
                  )}

                  {/* 3-column stats */}
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {[
                      { label: "速度", value: statSpeed },
                      { label: "进度", value: statProgress },
                      { label: "已传输", value: statTransferred },
                    ].map(({ label, value }) => (
                      <div
                        key={label}
                        className="rounded-xl px-3 py-2.5 flex flex-col items-center"
                        style={{ background: "rgba(240,248,255,0.8)", border: "1px solid rgba(59,159,216,0.10)" }}
                      >
                        <p className="text-[10px] mb-0.5 font-medium" style={{ color: "#8aabbd" }}>{label}</p>
                        <p className="text-xs font-bold truncate w-full text-center" style={{ color: "#1a3a5c" }}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Queue count */}
                  <p className="text-xs text-center mb-3" style={{ color: "#94a3b8" }}>
                    {`排队中: ${isManual ? displayQueue.length : queueCount} 项`}
                  </p>

                  {/* Stop button */}
                  <button
                    onClick={isManual ? () => setShowCancelManualModal(true) : () => setShowCancelAutoModal(true)}
                    className="w-full rounded-xl py-2.5 text-sm font-semibold transition-all active:scale-[0.98]"
                    style={{
                      color: isManual ? "#ef4444" : "#94a3b8",
                      border: `1.5px solid ${isManual ? "#ef4444" : "#cbd5e1"}`,
                      background: "transparent",
                    }}
                  >
                    {isManual ? "取消本次手动上传" : "停止自动上传"}
                  </button>
                </>
              )}
              </>
              )}
            </div>
          </div>
        </section>

        {/* ── 快捷入口 标题 ── */}
        {!isExpired && (
        <>
        <div className="px-1 py-3">
          <p className="text-sm font-bold" style={{ color: "#1a3a5c" }}>{"快捷入口"}</p>
        </div>

        {/* ── 快捷入口 ── */}
        <div className="flex gap-3">
          {/* 相册 */}
          <button
            ref={refAlbumBtn}
            onClick={onNavigateAlbum}
            className="flex-1 rounded-2xl px-4 py-5 text-left transition-all active:scale-[0.98]"
            style={{ background: "rgba(255,255,255,0.9)", boxShadow: "0 2px 12px rgba(59,130,210,0.08)" }}
          >
            <p className="text-sm font-bold mb-1" style={{ color: "#1a3a5c" }}>{"相册"}</p>
            <p className="text-[11px] leading-snug" style={{ color: "#8aabbd" }}>{"浏览和手动上传素材"}</p>
          </button>

          {/* 共享目录 */}
          <button
            onClick={onNavigatePublicFiles}
            className="flex-1 rounded-2xl px-4 py-5 text-left transition-all active:scale-[0.98]"
            style={{ background: "rgba(255,255,255,0.9)", boxShadow: "0 2px 12px rgba(59,130,210,0.08)" }}
          >
            <p className="text-sm font-bold mb-1" style={{ color: "#1a3a5c" }}>{"共享目录"}</p>
            <p className="text-[11px] leading-snug" style={{ color: "#8aabbd" }}>{"浏览PC设备的共享目录"}</p>
          </button>
        </div>


        </>
        )}

        {/* Trial banner */}
        {!isPro && !isExpired && trialDaysLeft !== undefined && trialDaysLeft > 0 && (
          <button
            onClick={onNavigateSubscription}
            className="mt-3 flex w-full items-center gap-2.5 rounded-2xl px-4 py-3 text-left transition-all active:scale-[0.99]"
            style={{ background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.25)" }}
          >
            <Crown className="h-4 w-4 shrink-0" style={{ color: "#d97706" }} />
            <span className="flex-1 text-xs" style={{ color: "#92400e" }}>
              {"试用中，还剩 "}
              <span className="font-bold">{trialDaysLeft}</span>
              {" 天 · 试用结束后需订阅继续使用"}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "#d97706" }} />
          </button>
        )}

        {/* Renewal reminder banner — only shown when subscribed and expiring soon */}
        {isExpiringSoon && daysUntilExpiry !== null && (
          <button
            onClick={onNavigateSubscription}
            className="mt-3 flex w-full items-center gap-2.5 rounded-2xl px-4 py-3 text-left transition-all active:scale-[0.99]"
            style={
              daysUntilExpiry === 0
                ? { background: "rgba(239,68,68,0.09)", border: "1px solid rgba(239,68,68,0.28)" }
                : daysUntilExpiry <= 3
                ? { background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.30)" }
                : { background: "rgba(59,130,246,0.07)", border: "1px solid rgba(59,130,246,0.20)" }
            }
          >
            <Crown
              className="h-4 w-4 shrink-0"
              style={{ color: daysUntilExpiry === 0 ? "#ef4444" : daysUntilExpiry <= 3 ? "#d97706" : "#3b82f6" }}
            />
            <span
              className="flex-1 text-xs"
              style={{ color: daysUntilExpiry === 0 ? "#b91c1c" : daysUntilExpiry <= 3 ? "#92400e" : "#1e40af" }}
            >
              {daysUntilExpiry === 0
                ? "订阅今日到期，请续订后继续使用"
                : daysUntilExpiry <= 3
                ? `订阅将在 ${daysUntilExpiry} 天后到期，续订后可继续使用全部功能`
                : `订阅将在 ${daysUntilExpiry} 天后到期`}
            </span>
            <ChevronRight
              className="h-4 w-4 shrink-0"
              style={{ color: daysUntilExpiry === 0 ? "#ef4444" : daysUntilExpiry <= 3 ? "#d97706" : "#3b82f6" }}
            />
          </button>
        )}

      </main>

      {/* Start Auto-Upload (interrupt manual) Confirm Modal */}
      {showStartAutoModal && (
        <>
          <div className="absolute inset-0 z-50 bg-black/40" />
          <div
            className="absolute inset-0 z-50 flex items-center justify-center px-10"
            onClick={() => setShowStartAutoModal(false)}
          >
            <div
              className="w-full rounded-2xl text-center overflow-hidden"
              style={{ background: "#fff", boxShadow: "0 12px 40px rgba(0,0,0,0.22)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 pt-6 pb-4">
                <p className="text-base font-semibold mb-2" style={{ color: "#1a1a1a" }}>{"中断当前传输"}</p>
                <p className="text-sm" style={{ color: "#6e6e73", lineHeight: 1.55 }}>
                  {"当前相册正在手动传输，开启自动上传将中断本次任务，是否继续？"}
                </p>
              </div>
              <div style={{ height: "1px", background: "rgba(0,0,0,0.10)" }} />
              <div className="flex">
                <button
                  onClick={() => setShowStartAutoModal(false)}
                  className="flex-1 py-3 text-base font-medium transition-colors active:bg-black/5"
                  style={{ color: "#8a8a8e" }}
                >
                  {"取消"}
                </button>
                <div style={{ width: "1px", background: "rgba(0,0,0,0.10)" }} />
                <button
                  onClick={() => {
                    setShowStartAutoModal(false)
                    onCancelManual?.()
                    onStartAutoSync?.()
                    onNavigateAlbum?.()
                  }}
                  className="flex-1 py-3 text-base font-medium transition-colors active:bg-black/5"
                  style={{ color: "#3b82f6" }}
                >
                  {"开启自动上传"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Stop Auto Upload Confirm Modal */}
      {showCancelAutoModal && (
        <>
          <div className="absolute inset-0 z-50 bg-black/40" />
          <div
            className="absolute inset-0 z-50 flex items-center justify-center px-10"
            onClick={() => setShowCancelAutoModal(false)}
          >
            <div
              className="w-full rounded-2xl text-center overflow-hidden"
              style={{ background: "#fff", boxShadow: "0 12px 40px rgba(0,0,0,0.22)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 pt-6 pb-4">
                <p className="text-base font-semibold mb-2" style={{ color: "#1a1a1a" }}>{"停止自动上传"}</p>
                <p className="text-sm" style={{ color: "#6e6e73", lineHeight: 1.55 }}>
                  {"确认停止自动上传？停止后需要手动重新开启。"}
                </p>
              </div>
              <div style={{ height: "1px", background: "rgba(0,0,0,0.10)" }} />
              <div className="flex">
                <button
                  onClick={() => setShowCancelAutoModal(false)}
                  className="flex-1 py-3 text-base font-medium transition-colors active:bg-black/5"
                  style={{ color: "#8a8a8e" }}
                >
                  {"继续上传"}
                </button>
                <div style={{ width: "1px", background: "rgba(0,0,0,0.10)" }} />
                <button
                  onClick={() => { setShowCancelAutoModal(false); onCancelAutoSync?.() }}
                  className="flex-1 py-3 text-base font-medium transition-colors active:bg-black/5"
                  style={{ color: "#ef4444" }}
                >
                  {"确认停止"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Cancel Manual Upload Confirm Modal */}
      {showCancelManualModal && (
        <>
          <div className="absolute inset-0 z-50 bg-black/40" />
          <div
            className="absolute inset-0 z-50 flex items-center justify-center px-10"
            onClick={() => setShowCancelManualModal(false)}
          >
            <div
              className="w-full rounded-2xl text-center overflow-hidden"
              style={{ background: "#fff", boxShadow: "0 12px 40px rgba(0,0,0,0.22)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 pt-6 pb-4">
                <p className="text-base font-semibold mb-2" style={{ color: "#1a1a1a" }}>{"取消手动上传"}</p>
                <p className="text-sm" style={{ color: "#6e6e73", lineHeight: 1.55 }}>
                  {"确认取消本次手动上传？已完成文件将保留，未完成任务将停止。"}
                </p>
              </div>
              <div style={{ height: "1px", background: "rgba(0,0,0,0.10)" }} />
              <div className="flex">
                <button
                  onClick={() => setShowCancelManualModal(false)}
                  className="flex-1 py-3 text-base font-medium transition-colors active:bg-black/5"
                  style={{ color: "#8a8a8e" }}
                >
                  {"继续上传"}
                </button>
                <div style={{ width: "1px", background: "rgba(0,0,0,0.10)" }} />
                <button
                  onClick={() => { setShowCancelManualModal(false); onCancelManual?.() }}
                  className="flex-1 py-3 text-base font-medium transition-colors active:bg-black/5"
                  style={{ color: "#ef4444" }}
                >
                  {"确认取消"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Usage Guide Coach Marks */}
      {showGuide && (
        <UsageGuideModal
          onClose={() => setShowGuide(false)}
          targets={[refAlbumBtn, refMainCard, refHistoryBtn, refSettingsBtn, refHelpBtn]}
          containerRef={refContainer}
        />
      )}
    </div>
  )
}
