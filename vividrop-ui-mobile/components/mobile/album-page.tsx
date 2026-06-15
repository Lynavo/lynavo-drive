"use client"

import { useState, useMemo, useRef, useCallback } from "react"
import { ArrowLeft, Grid3X3, List, Check, Video, Zap } from "lucide-react"

interface AlbumItem {
  id: string
  name: string
  type: "photo" | "video"
  date: string
  time: string
  size: string
  sizeBytes: number
  duration?: string
  dimensions?: string
  thumbnailColor: string
  transferred: boolean
  status?: "uploaded" | "queued" | "none"
}

const MOCK_ALBUMS: AlbumItem[] = [
  { id: "a1",  type: "photo", name: "IMG_5203.JPG", date: "2026-03-19", time: "16:20", size: "4.0 MB",  sizeBytes: 4194304,   dimensions: "5712 x 4284", thumbnailColor: "#8B4513", transferred: false, status: "none" },
  { id: "a2",  type: "photo", name: "IMG_5202.JPG", date: "2026-03-19", time: "16:18", size: "4.5 MB",  sizeBytes: 4718592,   dimensions: "4284 x 5712", thumbnailColor: "#A0522D", transferred: false, status: "queued" },
  { id: "a3",  type: "photo", name: "IMG_5201.JPG", date: "2026-03-19", time: "16:18", size: "5.1 MB",  sizeBytes: 5347737,   dimensions: "5712 x 4284", thumbnailColor: "#CD853F", transferred: false, status: "none" },
  { id: "a4",  type: "photo", name: "IMG_5200.JPG", date: "2026-03-19", time: "16:18", size: "4.5 MB",  sizeBytes: 4718592,   dimensions: "5712 x 4284", thumbnailColor: "#D2691E", transferred: false, status: "none" },
  { id: "a5",  type: "photo", name: "IMG_5199.JPG", date: "2026-03-19", time: "16:18", size: "4.9 MB",  sizeBytes: 5138022,   dimensions: "5712 x 4284", thumbnailColor: "#8B4513", transferred: false, status: "none" },
  { id: "a6",  type: "video", name: "IMG_5198.MOV", date: "2026-03-19", time: "16:03", size: "26.5 MB", sizeBytes: 27787264,  duration: "0:14",          thumbnailColor: "#654321", transferred: false, status: "queued" },
  { id: "a7",  type: "photo", name: "IMG_5197.JPG", date: "2026-03-19", time: "15:59", size: "5.9 MB",  sizeBytes: 6187827,   dimensions: "5712 x 4284", thumbnailColor: "#A0522D", transferred: false, status: "none" },
  { id: "a8",  type: "video", name: "IMG_5196.MOV", date: "2026-03-19", time: "15:58", size: "9.7 MB",  sizeBytes: 10171187,  duration: "0:05",          thumbnailColor: "#8B7355", transferred: false, status: "none" },
  { id: "a9",  type: "photo", name: "IMG_5195.JPG", date: "2026-03-19", time: "15:57", size: "4.2 MB",  sizeBytes: 4404019,   dimensions: "4032 x 3024", thumbnailColor: "#CD853F", transferred: false, status: "none" },
  { id: "a10", type: "video", name: "IMG_5194.MOV", date: "2026-03-19", time: "15:03", size: "10.6 MB", sizeBytes: 11114905,  duration: "0:05",          thumbnailColor: "#8B7355", transferred: false, status: "none" },
  { id: "a11", type: "photo", name: "IMG_5193.JPG", date: "2026-03-19", time: "15:02", size: "3.8 MB",  sizeBytes: 3984588,   dimensions: "4032 x 3024", thumbnailColor: "#9370DB", transferred: true,  status: "uploaded" },
  { id: "a12", type: "video", name: "IMG_5192.MOV", date: "2026-03-19", time: "14:58", size: "15.2 MB", sizeBytes: 15938355,  duration: "0:08",          thumbnailColor: "#BA55D3", transferred: true,  status: "uploaded" },
  { id: "a13", type: "photo", name: "IMG_5191.JPG", date: "2026-03-19", time: "14:55", size: "4.1 MB",  sizeBytes: 4299161,   dimensions: "5712 x 4284", thumbnailColor: "#32CD32", transferred: false, status: "none" },
  { id: "a14", type: "photo", name: "IMG_5190.JPG", date: "2026-03-19", time: "14:50", size: "3.9 MB",  sizeBytes: 4089446,   dimensions: "4032 x 3024", thumbnailColor: "#228B22", transferred: false, status: "queued" },
  { id: "a15", type: "video", name: "IMG_5189.MOV", date: "2026-03-19", time: "14:45", size: "22.3 MB", sizeBytes: 23383654,  duration: "0:12",          thumbnailColor: "#006400", transferred: false, status: "none" },
  { id: "a16", type: "photo", name: "IMG_5188.JPG", date: "2026-03-18", time: "18:30", size: "4.6 MB",  sizeBytes: 4823449,   dimensions: "5712 x 4284", thumbnailColor: "#4169E1", transferred: true,  status: "uploaded" },
  { id: "a17", type: "photo", name: "IMG_5187.JPG", date: "2026-03-18", time: "18:25", size: "5.0 MB",  sizeBytes: 5242880,   dimensions: "4284 x 5712", thumbnailColor: "#1E90FF", transferred: true,  status: "uploaded" },
  { id: "a18", type: "video", name: "IMG_5186.MOV", date: "2026-03-18", time: "18:20", size: "18.9 MB", sizeBytes: 19818086,  duration: "0:10",          thumbnailColor: "#00BFFF", transferred: false, status: "none" },
  { id: "a19", type: "photo", name: "IMG_5185.JPG", date: "2026-03-18", time: "17:15", size: "4.3 MB",  sizeBytes: 4508877,   dimensions: "5712 x 4284", thumbnailColor: "#FFD700", transferred: false, status: "none" },
  { id: "a20", type: "photo", name: "IMG_5184.JPG", date: "2026-03-18", time: "17:10", size: "3.7 MB",  sizeBytes: 3879731,   dimensions: "4032 x 3024", thumbnailColor: "#FFA500", transferred: false, status: "none" },
  { id: "a21", type: "video", name: "IMG_5183.MOV", date: "2026-03-18", time: "16:55", size: "31.2 MB", sizeBytes: 32716390,  duration: "0:18",          thumbnailColor: "#FF8C00", transferred: false, status: "none" },
  { id: "a22", type: "photo", name: "IMG_5182.JPG", date: "2026-03-17", time: "14:30", size: "4.8 MB",  sizeBytes: 5033164,   dimensions: "5712 x 4284", thumbnailColor: "#DC143C", transferred: true,  status: "uploaded" },
  { id: "a23", type: "photo", name: "IMG_5181.JPG", date: "2026-03-17", time: "14:25", size: "5.2 MB",  sizeBytes: 5452595,   dimensions: "4284 x 5712", thumbnailColor: "#FF6347", transferred: false, status: "none" },
  { id: "a24", type: "video", name: "IMG_5180.MOV", date: "2026-03-17", time: "14:20", size: "45.6 MB", sizeBytes: 47806013,  duration: "0:25",          thumbnailColor: "#FF4500", transferred: false, status: "none" },
  { id: "a25", type: "photo", name: "IMG_5179.JPG", date: "2026-03-17", time: "13:15", size: "4.0 MB",  sizeBytes: 4194304,   dimensions: "5712 x 4284", thumbnailColor: "#2E8B57", transferred: false, status: "none" },
  { id: "a26", type: "photo", name: "IMG_5178.JPG", date: "2026-03-17", time: "13:10", size: "3.5 MB",  sizeBytes: 3670016,   dimensions: "4032 x 3024", thumbnailColor: "#3CB371", transferred: false, status: "none" },
  { id: "a27", type: "video", name: "IMG_5177.MOV", date: "2026-03-17", time: "12:50", size: "28.4 MB", sizeBytes: 29780582,  duration: "0:16",          thumbnailColor: "#20B2AA", transferred: false, status: "none" },
  { id: "a28", type: "photo", name: "IMG_5176.JPG", date: "2026-03-17", time: "12:45", size: "4.4 MB",  sizeBytes: 4613734,   dimensions: "5712 x 4284", thumbnailColor: "#48D1CC", transferred: false, status: "none" },
]

type FilterType = "all" | "photo" | "video"
type TransferFilter = "all" | "untransferred" | "transferred"
type ViewMode = "grid" | "list"
type AutoUploadTimeOption = "now" | "all" | "custom"

function formatDateFull(dateStr: string, timeStr: string): string {
  const [year, month, day] = dateStr.split("-")
  return `${year}年${month}月${day}日 ${timeStr}`
}

type GlobalTransferState =
  | "idle"
  | "auto_syncing"
  | "transitioning"
  | "manual_uploading"
  | "manual_completed"
  | "auto_completed"

interface AlbumPageProps {
  onBack: () => void
  onStartTransfer: (items: { id: string; name: string; size: string }[]) => void
  transferredIds?: Set<string>
  isPro: boolean
  onUpgradePro: () => void
  globalTransferState?: GlobalTransferState
  autoUploadEnabled?: boolean
  onStartAutoSync?: () => void
  onStopAutoSync?: () => void
}

export function AlbumPage({ onBack, onStartTransfer, transferredIds = new Set(), isPro, onUpgradePro, globalTransferState = "idle", autoUploadEnabled = false, onStartAutoSync, onStopAutoSync }: AlbumPageProps) {
  const [filter, setFilter] = useState<FilterType>("all")
  const [transferFilter, setTransferFilter] = useState<TransferFilter>("all")
  const [viewMode, setViewMode] = useState<ViewMode>("grid")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [autoUploadTime, setAutoUploadTime] = useState<AutoUploadTimeOption>("all")
  const [customTimestamp, setCustomTimestamp] = useState<string>(new Date().toISOString().slice(0, 19))
  const [showTimePicker, setShowTimePicker] = useState(false)
  const [showToast, setShowToast] = useState(false)
  const [showConflictModal, setShowConflictModal] = useState(false)
  const [conflictItems, setConflictItems] = useState<AlbumItem[]>([])
  const [showInterruptModal, setShowInterruptModal] = useState(false)
  const [pendingTransferItems, setPendingTransferItems] = useState<{ id: string; name: string; size: string }[]>([])
  const [showStopAutoModal, setShowStopAutoModal] = useState(false)
  const [showSubmittedModal, setShowSubmittedModal] = useState(false)
  const [submittedCount, setSubmittedCount] = useState(0)
  const [skippedCount, setSkippedCount] = useState(0)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth())
  const [selectedDay, setSelectedDay] = useState(new Date().getDate())
  const [selectedHour, setSelectedHour] = useState(new Date().getHours())
  const [selectedMinute, setSelectedMinute] = useState(new Date().getMinutes())
  const [showAlbumSelector, setShowAlbumSelector] = useState(false)
  const [currentAlbum, setCurrentAlbum] = useState("最近项目")
  // Auto-upload inline panel (collapsed by default, expands inline)
  const [autoUploadExpanded, setAutoUploadExpanded] = useState(false)

  // ── Drag/swipe-to-select ──
  // Tracks whether a drag-select gesture is in progress
  const isDragging = useRef(false)
  // The selection mode for this drag: "select" | "deselect"
  const dragMode = useRef<"select" | "deselect">("select")
  // Set of ids toggled during current drag (to avoid re-toggling same item)
  const dragTouched = useRef<Set<string>>(new Set())
  // Ref to the grid container so we can hit-test child cells
  const gridRef = useRef<HTMLDivElement>(null)

const filtered = useMemo(() =>
  MOCK_ALBUMS.filter((i) => {
    if (filter !== "all" && i.type !== filter) return false
    if (transferFilter === "transferred") return transferredIds.has(i.id)
    if (transferFilter === "untransferred") return !transferredIds.has(i.id)
    return true
  }),
  [filter, transferFilter, transferredIds]
)

  const totalCount = filtered.length
  const selectedCount = selected.size
  const transferredCount = filtered.filter((i) => i.transferred || transferredIds.has(i.id)).length
  const newCount = filtered.filter((i) => !i.transferred && !transferredIds.has(i.id)).length

  const toggleItem = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // IDs of items that can be drag-selected (respects current filter, excludes non-selectable)
  const selectableFilteredIds = useMemo(
    () => new Set(filtered.filter((i) => !i.transferred && !transferredIds.has(i.id) && i.status !== "queued").map((i) => i.id)),
    [filtered, transferredIds]
  )

  // Hit-test: given a touch point, find the item id of the grid cell under the finger
  const getItemIdAtPoint = useCallback((x: number, y: number): string | null => {
    if (!gridRef.current) return null
    const el = document.elementFromPoint(x, y)
    if (!el) return null
    const cell = (el as HTMLElement).closest("[data-item-id]") as HTMLElement | null
    return cell ? cell.dataset.itemId ?? null : null
  }, [])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (viewMode !== "grid") return
    const touch = e.touches[0]
    const id = getItemIdAtPoint(touch.clientX, touch.clientY)
    if (!id || !selectableFilteredIds.has(id)) return

    isDragging.current = true
    dragTouched.current = new Set([id])
    // Decide mode based on current state of the first touched cell
    dragMode.current = selected.has(id) ? "deselect" : "select"
    setSelected((prev) => {
      const next = new Set(prev)
      dragMode.current === "select" ? next.add(id) : next.delete(id)
      return next
    })
  }, [viewMode, selected, selectableFilteredIds, getItemIdAtPoint])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current) return
    // Prevent page scroll while drag-selecting
    e.preventDefault()
    const touch = e.touches[0]
    const id = getItemIdAtPoint(touch.clientX, touch.clientY)
    if (!id || !selectableFilteredIds.has(id) || dragTouched.current.has(id)) return

    dragTouched.current.add(id)
    setSelected((prev) => {
      const next = new Set(prev)
      dragMode.current === "select" ? next.add(id) : next.delete(id)
      return next
    })
  }, [selectableFilteredIds, getItemIdAtPoint])

  const handleTouchEnd = useCallback(() => {
    isDragging.current = false
    dragTouched.current = new Set()
  }, [])

  // Mouse equivalents (desktop / preview)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (viewMode !== "grid") return
    const id = getItemIdAtPoint(e.clientX, e.clientY)
    if (!id || !selectableFilteredIds.has(id)) return
    isDragging.current = true
    dragTouched.current = new Set([id])
    dragMode.current = selected.has(id) ? "deselect" : "select"
    setSelected((prev) => {
      const next = new Set(prev)
      dragMode.current === "select" ? next.add(id) : next.delete(id)
      return next
    })
  }, [viewMode, selected, selectableFilteredIds, getItemIdAtPoint])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return
    const id = getItemIdAtPoint(e.clientX, e.clientY)
    if (!id || !selectableFilteredIds.has(id) || dragTouched.current.has(id)) return
    dragTouched.current.add(id)
    setSelected((prev) => {
      const next = new Set(prev)
      dragMode.current === "select" ? next.add(id) : next.delete(id)
      return next
    })
  }, [selectableFilteredIds, getItemIdAtPoint])

  const handleMouseUp = useCallback(() => {
    isDragging.current = false
    dragTouched.current = new Set()
  }, [])

  const selectedItems = filtered.filter((i) => selected.has(i.id))

  // Detect which selected items have already been transferred
  const alreadyTransferred = selectedItems.filter(
    (i) => i.transferred || transferredIds.has(i.id)
  )
  const notYetTransferred = selectedItems.filter(
    (i) => !i.transferred && !transferredIds.has(i.id)
  )

  // Final submission — called after all conflict/interrupt checks pass
  const doSubmit = (items: { id: string; name: string; size: string }[], skipped: number) => {
    if (items.length > 0) onStartTransfer(items)
    setSubmittedCount(items.length)
    setSkippedCount(skipped)
    setShowSubmittedModal(true)
  }

  // Called when user taps "上传" button
  const handleStartTransfer = () => {
    if (selectedItems.length === 0) return

    // If auto-upload is actively running ON THIS DEVICE, show interrupt confirmation first
    if (globalTransferState === "auto_syncing" && autoUploadEnabled) {
      // Determine what will be submitted after conflict check
      const toSubmit = alreadyTransferred.length > 0
        ? [] // will be handled after conflict modal
        : selectedItems.map((i) => ({ id: i.id, name: i.name, size: i.size }))
      setPendingTransferItems(toSubmit)
      setShowInterruptModal(true)
      return
    }

    // No auto conflict — check for duplicate files
    if (alreadyTransferred.length > 0) {
      setConflictItems(alreadyTransferred)
      setShowConflictModal(true)
      return
    }
    // All clean — start directly
    doSubmit(selectedItems.map((i) => ({ id: i.id, name: i.name, size: i.size })), 0)
  }

  // User confirms interrupting auto-upload to proceed with manual
  const handleConfirmInterrupt = () => {
    setShowInterruptModal(false)
    // Now check for duplicate conflicts
    if (alreadyTransferred.length > 0) {
      setConflictItems(alreadyTransferred)
      setShowConflictModal(true)
      return
    }
    doSubmit(selectedItems.map((i) => ({ id: i.id, name: i.name, size: i.size })), 0)
  }

  // "跳过已传" — only send the not-yet-transferred items
  const handleSkipTransferred = () => {
    setShowConflictModal(false)
    doSubmit(notYetTransferred.map((i) => ({ id: i.id, name: i.name, size: i.size })), alreadyTransferred.length)
  }

  // "重新传输" — send all selected items including already-transferred
  const handleForceReTransfer = () => {
    setShowConflictModal(false)
    doSubmit(selectedItems.map((i) => ({ id: i.id, name: i.name, size: i.size })), 0)
  }

  const handleConfirmAutoUpload = () => {
    onStartAutoSync?.()
    setShowToast(true)
    setTimeout(() => setShowToast(false), 2000)
  }
  
  const handleStopAutoUpload = () => {
    // Show confirm modal instead of stopping immediately
    setShowStopAutoModal(true)
  }

  const FILTERS: { key: FilterType; label: string }[] = [
    { key: "all", label: "全部" },
    { key: "photo", label: "照片" },
    { key: "video", label: "视频" },
  ]

  const TIME_OPTIONS = [
    { key: "all" as AutoUploadTimeOption, label: "全部", desc: "上传相册中所有符合条件的内容" },
    { key: "now" as AutoUploadTimeOption, label: "此时此刻", desc: "仅上传此刻之后的新拍摄素材" },
    { key: "custom" as AutoUploadTimeOption, label: "自定义时间", desc: "可精确选择到时、分、秒" },
  ]

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden" style={{ background: "#dceefa" }}>

      {/* ── Header ── */}
      <header className="relative shrink-0 px-4 pt-12 pb-2 z-30" style={{ background: "#dceefa" }}>
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="p-2 -ml-2" style={{ color: "#1a3a5c" }}>
            <ArrowLeft className="h-6 w-6" strokeWidth={2.5} />
          </button>
          <span className="text-lg font-bold" style={{ color: "#1a3a5c" }}>{"相册"}</span>
          {/* Album picker icon */}
          <button
            onClick={() => setShowAlbumSelector(!showAlbumSelector)}
            className="p-2 -mr-2"
            style={{ color: "#1a3a5c" }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <rect x="2" y="2" width="7" height="7" rx="1.5" opacity="0.7"/>
              <rect x="11" y="2" width="7" height="7" rx="1.5" opacity="0.7"/>
              <rect x="2" y="11" width="7" height="7" rx="1.5" opacity="0.7"/>
              <rect x="11" y="11" width="7" height="7" rx="1.5" opacity="0.7"/>
            </svg>
          </button>
        </div>

        {/* Album selector dropdown */}
        {showAlbumSelector && (
          <div
            className="absolute top-full left-0 w-full z-50 shadow-lg animate-in slide-in-from-top-2 duration-200"
            style={{ background: "#fff", borderRadius: "0 0 20px 20px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="overflow-y-auto" style={{ maxHeight: "360px" }}>
              {[
                { name: "最近项目", count: 1146, id: "recent" },
                { name: "全部照片", count: 1146, id: "all" },
                { name: "FXN", count: 796, id: "fxn" },
                { name: "DAM", count: 112, id: "dam" },
                { name: "GRD", count: 67, id: "grd" },
                { name: "FQS", count: 59, id: "fqs" },
                { name: "CCD", count: 45, id: "ccd" },
              ].map((album) => (
                <button
                  key={album.id}
                  onClick={() => { setCurrentAlbum(album.name); setShowAlbumSelector(false) }}
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                  style={{ borderBottom: "1px solid rgba(0,0,0,0.05)", background: currentAlbum === album.name ? "rgba(59,130,246,0.05)" : "transparent" }}
                >
                  <span className="text-sm font-medium" style={{ color: "#1a1a1a" }}>{album.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: "#8e8e93" }}>{album.count}</span>
                    {currentAlbum === album.name && <Check className="h-4 w-4" style={{ color: "#3b82f6" }} />}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      {showAlbumSelector && (
        <div className="absolute inset-0 z-20" onClick={() => setShowAlbumSelector(false)} />
      )}

      {/* ── Scrollable content area ── */}
      <div className="flex flex-col flex-1 overflow-hidden">

        {/* Auto-upload row + inline expanded panel */}
        <div className="shrink-0 mx-3 mb-2 rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.85)" }}>
          {/* Row */}
          <button
            className="w-full flex items-center gap-2 px-4 py-3"
            onClick={() => setAutoUploadExpanded(!autoUploadExpanded)}
          >
            {/* Filter icon */}
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
              <path d="M1 3h12M3 7h8M5 11h4" stroke="#5a7a96" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <span className="text-sm font-semibold" style={{ color: "#1a3a5c" }}>{"自动上传"}</span>
            {/* Status pill */}
            <span
              className="text-[11px] font-bold px-2 py-0.5 rounded-full"
              style={{
                background: autoUploadEnabled ? "rgba(34,197,94,0.12)" : "rgba(255,59,48,0.10)",
                color: autoUploadEnabled ? "#16a34a" : "#ef4444",
              }}
            >
              {autoUploadEnabled ? "运行中" : "已暂停"}
            </span>
            <div className="flex-1" />
            {/* Chevron */}
            <svg
              width="14" height="14" viewBox="0 0 14 14" fill="none"
                  className="transition-transform duration-200 shrink-0"
                  style={{ transform: autoUploadExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
            >
              <path d="M3 5l4 4 4-4" stroke="#5a7a96" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {/* Expanded settings */}
          {autoUploadExpanded && (
            <div className="px-4 pb-4" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
              {/* Toggle row */}
              <div className="flex items-center justify-between py-3">
                <span className="text-sm" style={{ color: "#1a3a5c" }}>
                  {autoUploadEnabled ? "暂停自动上传" : "恢复自动上传"}
                </span>
                <button
                  onClick={() => autoUploadEnabled ? handleStopAutoUpload() : handleConfirmAutoUpload()}
                  className="relative h-7 w-12 rounded-full transition-colors duration-200"
                  style={{ background: autoUploadEnabled ? "#34c759" : "#d1d1d6" }}
                >
                  <span
                    className="absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all duration-200"
                    style={{ left: autoUploadEnabled ? "22px" : "2px" }}
                  />
                </button>
              </div>

              {/* Time range */}
              <p className="text-xs font-semibold mb-2" style={{ color: "#8aabbd" }}>{"时间范围"}</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {TIME_OPTIONS.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setAutoUploadTime(key)}
                    className="rounded-full px-3 py-1.5 text-xs font-semibold transition-all"
                    style={{
                      background: autoUploadTime === key ? "#1a3a5c" : "rgba(0,0,0,0.06)",
                      color: autoUploadTime === key ? "#fff" : "#5a7a96",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Custom time input */}
              {autoUploadTime === "custom" && (
                <button
                  onClick={() => setShowTimePicker(true)}
                  className="w-full rounded-xl px-3 py-2.5 text-sm text-left mb-3"
                  style={{ background: "#f5f5f7", border: "1px solid rgba(0,0,0,0.08)", color: "#1a1a1a" }}
                >
                  {customTimestamp ? new Date(customTimestamp).toLocaleString("zh-CN", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "选择时间"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* 4-column stats row — only when auto-upload is OFF */}
        {!autoUploadEnabled && <div className="shrink-0 grid grid-cols-4 gap-0 mx-3 mb-3 rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.85)" }}>
          {[
            { label: "总数", value: totalCount, color: "#1a3a5c" },
            { label: "已选", value: selectedCount, color: selectedCount > 0 ? "#3b82f6" : "#1a3a5c" },
            { label: "已传", value: transferredCount, color: transferredCount > 0 ? "#22c55e" : "#1a3a5c" },
            { label: "新增", value: newCount, color: newCount > 0 ? "#ff9500" : "#1a3a5c" },
          ].map(({ label, value, color }, i) => (
            <div
              key={label}
              className="flex flex-col items-center py-3"
              style={{ borderRight: i < 3 ? "1px solid rgba(0,0,0,0.06)" : "none" }}
            >
              <span className="text-base font-bold" style={{ color }}>{value}</span>
              <span className="text-[10px] mt-0.5 font-medium" style={{ color: "#8aabbd" }}>{label}</span>
            </div>
          ))}
        </div>}

        {autoUploadEnabled ? (
          /* ── Auto-upload ON: show running status card ── */
          <main className="flex-1 overflow-y-auto px-3">
            <div
              className="rounded-2xl p-5"
              style={{ background: "rgba(255,255,255,0.88)", border: "1px solid rgba(52,199,89,0.18)", boxShadow: "0 2px 16px rgba(52,199,89,0.06)" }}
            >
              {/* Status header */}
              <div className="flex items-center gap-2.5 mb-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: "rgba(52,199,89,0.12)" }}>
                  <div className="h-2.5 w-2.5 rounded-full" style={{ background: "#34c759", boxShadow: "0 0 0 4px rgba(52,199,89,0.25)" }} />
                </div>
                <div>
                  <p className="text-sm font-bold" style={{ color: "#1a3a5c" }}>{"自动上传运行中"}</p>
                  <p className="text-xs" style={{ color: "#8aabbd" }}>{"新素材将自动传输到 PC 端"}</p>
                </div>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-2 mb-4">
                {[
                  { label: "本次已传", value: `${transferredCount} 个`, color: "#22c55e" },
                  { label: "待上传", value: `${totalCount - transferredCount} 个`, color: "#ff9500" },
                  { label: "素材总数", value: `${totalCount} 个`, color: "#1a3a5c" },
                  { label: "时间范围", value: autoUploadTime === "all" ? "全部" : autoUploadTime === "now" ? "此时此刻" : "自定义", color: "#3b82f6" },
                ].map(({ label, value, color }) => (
                  <div
                    key={label}
                    className="rounded-xl px-3 py-3"
                    style={{ background: "rgba(240,248,255,0.8)", border: "1px solid rgba(59,130,210,0.08)" }}
                  >
                    <p className="text-[10px] font-medium mb-1" style={{ color: "#8aabbd" }}>{label}</p>
                    <p className="text-sm font-bold" style={{ color }}>{value}</p>
                  </div>
                ))}
              </div>

            </div>
          </main>
        ) : (
          /* ── Auto-upload OFF: show full manual upload UI ── */
          <>
            {/* Filter tabs + Select all + View toggle */}
            <div className="shrink-0 flex items-center px-3 mb-2 gap-2">
              {/* Unified filter chips: 全部 / 照片 / 视频 / 未传 / 已传 */}
              <div className="flex items-center gap-1">
                {/* Type chips */}
                {FILTERS.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => { setFilter(key); if (key !== "all") setTransferFilter("all") }}
                    className="rounded-full px-3 py-1 text-xs font-semibold transition-all whitespace-nowrap"
                    style={{
                      background: filter === key && transferFilter === "all" ? "#1a3a5c" : "rgba(255,255,255,0.7)",
                      color: filter === key && transferFilter === "all" ? "#fff" : "#5a7a96",
                    }}
                  >
                    {label}
                  </button>
                ))}
                {/* Transfer chips — no extra 全部 */}
                {([
                  { key: "untransferred" as TransferFilter, label: "未传" },
                  { key: "transferred" as TransferFilter, label: "已传" },
                ]).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => { setTransferFilter(key); setFilter("all") }}
                    className="rounded-full px-3 py-1 text-xs font-semibold transition-all whitespace-nowrap"
                    style={{
                      background: transferFilter === key ? "#1a3a5c" : "rgba(255,255,255,0.7)",
                      color: transferFilter === key ? "#fff" : "#5a7a96",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex-1" />

              {/* View toggle */}
              <div className="flex items-center gap-0.5 rounded-lg p-0.5" style={{ background: "rgba(255,255,255,0.7)" }}>
                <button
                  onClick={() => setViewMode("grid")}
                  className="flex h-7 w-7 items-center justify-center rounded-md transition-all"
                  style={{ background: viewMode === "grid" ? "#fff" : "transparent" }}
                >
                  <Grid3X3 className="h-3.5 w-3.5" style={{ color: viewMode === "grid" ? "#1a3a5c" : "#8aabbd" }} />
                </button>
                <button
                  onClick={() => setViewMode("list")}
                  className="flex h-7 w-7 items-center justify-center rounded-md transition-all"
                  style={{ background: viewMode === "list" ? "#fff" : "transparent" }}
                >
                  <List className="h-3.5 w-3.5" style={{ color: viewMode === "list" ? "#1a3a5c" : "#8aabbd" }} />
                </button>
              </div>


            </div>

            {/* Photo grid / list */}
            <main className="flex-1 overflow-y-auto">
          {viewMode === "grid" ? (
            <div
              ref={gridRef}
              className="grid grid-cols-3 gap-0.5 px-0.5 select-none"
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              style={{ touchAction: isDragging.current ? "none" : "pan-y" }}
            >
              {filtered.map((item) => {
                const isSel = selected.has(item.id)
                const isTransferred = item.transferred || transferredIds.has(item.id)
                return (
                  <button
                    key={item.id}
                    data-item-id={item.id}
                    onClick={() => !isTransferred && toggleItem(item.id)}
                    disabled={isTransferred}
                    className="relative aspect-square overflow-hidden transition-all active:scale-95 disabled:cursor-default"
                    style={{
                      outline: isSel ? "3px solid #3b82f6" : "none",
                      outlineOffset: "-3px",
                    }}
                  >
                    <div className="absolute inset-0" style={{ background: item.thumbnailColor }} />

                    {/* Dim overlay for transferred items */}
                    {isTransferred && (
                      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.38)" }} />
                    )}

                    {/* Status badge: queued */}
                    {item.status === "queued" && !isTransferred && (
                      <div className="absolute top-1 left-1 flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: "rgba(59,130,246,0.85)", color: "#fff" }}>
                        {"排队中"}
                      </div>
                    )}

                    {/* Uploaded checkmark */}
                    {isTransferred && (
                      <div className="absolute top-1 right-1 flex items-center justify-center h-5 w-5 rounded-full" style={{ background: "#34c759" }}>
                        <Check className="h-3 w-3 text-white" strokeWidth={3} />
                      </div>
                    )}

                    {/* Video icon */}
                    {item.type === "video" && (
                      <div className="absolute bottom-1 right-1 flex items-center justify-center h-5 w-5 rounded-full" style={{ background: "rgba(0,0,0,0.55)" }}>
                        <svg width="8" height="10" viewBox="0 0 8 10" fill="white"><path d="M1 1l6 4-6 4V1z"/></svg>
                      </div>
                    )}

                    {/* Selection circle */}
                    {isSel && !isTransferred && (
                      <div className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full" style={{ background: "#3b82f6" }}>
                        <Check className="h-3 w-3 text-white" strokeWidth={3} />
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-col bg-white">
              {filtered.map((item) => {
                const isSel = selected.has(item.id)
                const isTransferred = item.transferred || transferredIds.has(item.id)
                return (
                  <button
                    key={item.id}
                    onClick={() => !isTransferred && toggleItem(item.id)}
                    disabled={isTransferred}
                    className="flex items-center gap-3 px-4 py-2.5 text-left transition-all active:scale-[0.99] disabled:cursor-default"
                    style={{
                      background: isSel ? "rgba(59,130,246,0.08)" : isTransferred ? "rgba(0,0,0,0.02)" : "#fff",
                      borderBottom: "1px solid rgba(0,0,0,0.05)",
                      borderLeft: isSel ? "3px solid #3b82f6" : "3px solid transparent",
                      opacity: isTransferred ? 0.55 : 1,
                    }}
                  >
                    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg" style={{ background: item.thumbnailColor }}>
                      {item.type === "video" && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: "rgba(0,0,0,0.5)" }}>
                            <svg width="8" height="10" viewBox="0 0 8 10" fill="white"><path d="M1 1l6 4-6 4V1z"/></svg>
                          </div>
                        </div>
                      )}
                      {isTransferred && (
                        <div className="absolute top-0.5 right-0.5 flex items-center justify-center rounded-full h-5 w-5" style={{ background: "#34c759" }}>
                          <Check className="h-3 w-3 text-white" strokeWidth={3} />
                        </div>
                      )}
                      {item.status === "queued" && !isTransferred && (
                        <div className="absolute top-0.5 left-0.5 rounded px-1 py-0.5 text-[8px] font-bold" style={{ background: "rgba(59,130,246,0.85)", color: "#fff" }}>
                          {"排队"}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: isTransferred ? "#8aabbd" : "#1a1a1a" }}>{item.name}</p>
                      <p className="text-xs mt-0.5" style={{ color: "#6e6e73" }}>
                        {item.size}{" · "}{formatDateFull(item.date, item.time)}
                      </p>
                      <p className="text-xs" style={{ color: "#8aabbd" }}>
                        {item.type === "video" ? `时长: ${item.duration}` : `${item.dimensions}`}
                      </p>
                    </div>
                    {isSel && !isTransferred && (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full shrink-0" style={{ background: "#3b82f6" }}>
                        <Check className="h-3.5 w-3.5 text-white" />
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
            </main>
          </>
        )}
      </div>

      {/* ── Floating bottom action bar — slides up when items are selected ── */}
      {!autoUploadEnabled && (() => {
        const selectableIds = filtered.filter((i) => !i.transferred && !transferredIds.has(i.id)).map((i) => i.id)
        const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id))
        return (
          <div
            className="absolute bottom-0 left-0 right-0 z-30 px-4 pb-5 pt-3 transition-all duration-300"
            style={{
              transform: selectedCount > 0 ? "translateY(0)" : "translateY(110%)",
              opacity: selectedCount > 0 ? 1 : 0,
              pointerEvents: selectedCount > 0 ? "auto" : "none",
              background: "linear-gradient(to top, rgba(220,238,250,0.3) 0%, transparent 100%)",
            }}
          >
            <div
              className="flex items-center justify-between rounded-2xl px-4 py-3 gap-3"
              style={{
                background: "rgba(255,255,255,0.72)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                boxShadow: "0 8px 32px rgba(26,58,92,0.18), 0 1.5px 0 rgba(255,255,255,0.6) inset",
                border: "1px solid rgba(255,255,255,0.55)",
              }}
            >
              {/* Left: select all / deselect */}
              <button
                onClick={() => {
                  if (allSelected) {
                    setSelected(new Set())
                  } else {
                    setSelected(new Set(selectableIds))
                  }
                }}
                className="flex items-center gap-1.5 shrink-0 transition-all active:scale-95"
              >
                <div
                  className="flex h-5 w-5 items-center justify-center rounded-full transition-all"
                  style={{
                    background: allSelected ? "#1a3a5c" : "transparent",
                    border: allSelected ? "none" : "1.5px solid #8aabbd",
                  }}
                >
                  {allSelected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                </div>
                <span className="text-xs font-semibold" style={{ color: "#1a3a5c" }}>
                  {allSelected ? "取消全选" : "全选"}
                </span>
              </button>

              {/* Center: count info */}
              <span className="text-xs flex-1 text-center" style={{ color: "#5a7a96" }}>
                {`已选 ${selectedCount} 个素材`}
              </span>

              {/* Right: upload button */}
              <button
                onClick={handleStartTransfer}
                className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold transition-all active:scale-95 shrink-0"
                style={{ background: "#1a3a5c", color: "#fff" }}
              >
                {"上传"}
                <span
                  className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold"
                  style={{ background: "rgba(255,255,255,0.25)", color: "#fff" }}
                >
                  {selectedCount}
                </span>
              </button>
            </div>
          </div>
        )
      })()}

      {/* Mobile Wheel Time Picker - iOS Style */}
      {showTimePicker && (
        <>
          {/* Overlay */}
          <div
            className="absolute inset-0 z-50 bg-black/50"
            onClick={() => setShowTimePicker(false)}
          />
          
          {/* Picker Bottom Sheet */}
          <div
            className="absolute bottom-0 left-0 w-full z-50 bg-white rounded-t-[32px] animate-in slide-in-from-bottom duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "rgba(0,0,0,0.08)" }}>
              <button
                onClick={() => setShowTimePicker(false)}
                className="text-sm font-medium"
                style={{ color: "#3b82f6" }}
              >
                {"取消"}
              </button>
              <h3 className="text-sm font-semibold" style={{ color: "#1a1a1a" }}>{"选择时间"}</h3>
              <button
                onClick={() => {
                  const targetDate = new Date(selectedYear, selectedMonth, selectedDay, selectedHour, selectedMinute, 0)
                  setCustomTimestamp(targetDate.toISOString().slice(0, 19))
                  setShowTimePicker(false)
                }}
                className="text-sm font-semibold"
                style={{ color: "#3b82f6" }}
              >
                {"确定"}
              </button>
            </div>

            {/* Wheel Pickers */}
            <div className="relative h-64 overflow-hidden">
              {/* Selection indicator - center highlight */}
              <div 
                className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-10 pointer-events-none z-10" 
                style={{ 
                  borderTop: "1px solid rgba(0,0,0,0.1)", 
                  borderBottom: "1px solid rgba(0,0,0,0.1)",
                  background: "rgba(0,0,0,0.02)"
                }} 
              />
              
              {/* 3D Gradient mask - fade effect at top and bottom */}
              <div 
                className="absolute inset-0 pointer-events-none z-20"
                style={{
                  background: "linear-gradient(to bottom, rgba(255,255,255,1) 0%, rgba(255,255,255,0.8) 15%, rgba(255,255,255,0) 35%, rgba(255,255,255,0) 65%, rgba(255,255,255,0.8) 85%, rgba(255,255,255,1) 100%)"
                }}
              />
              
              <div className="flex h-full">
                {/* Year Column */}
                <div className="flex-1 overflow-y-auto snap-y snap-mandatory hide-scrollbar">
                  <div className="py-24">
                    {Array.from({ length: 11 }).map((_, i) => {
                      const year = new Date().getFullYear() - 5 + i
                      const isSelected = selectedYear === year
                      return (
                        <div
                          key={year}
                          onClick={() => setSelectedYear(year)}
                          className="h-10 flex items-center justify-center snap-center cursor-pointer transition-all"
                          style={{
                            color: isSelected ? "#1a1a1a" : "#c7c7cc",
                            fontSize: isSelected ? "17px" : "15px",
                            fontWeight: isSelected ? 600 : 400,
                            lineHeight: "40px",
                          }}
                        >
                          {`${year}年`}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Month Column */}
                <div className="flex-1 overflow-y-auto snap-y snap-mandatory hide-scrollbar">
                  <div className="py-24">
                    {Array.from({ length: 12 }).map((_, m) => {
                      const isSelected = selectedMonth === m
                      return (
                        <div
                          key={m}
                          onClick={() => setSelectedMonth(m)}
                          className="h-10 flex items-center justify-center snap-center cursor-pointer transition-all"
                          style={{
                            color: isSelected ? "#1a1a1a" : "#c7c7cc",
                            fontSize: isSelected ? "17px" : "15px",
                            fontWeight: isSelected ? 600 : 400,
                            lineHeight: "40px",
                          }}
                        >
                          {`${m + 1}月`}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Day Column */}
                <div className="flex-1 overflow-y-auto snap-y snap-mandatory hide-scrollbar">
                  <div className="py-24">
                    {Array.from({ length: new Date(selectedYear, selectedMonth + 1, 0).getDate() }).map((_, i) => {
                      const day = i + 1
                      const isSelected = selectedDay === day
                      return (
                        <div
                          key={day}
                          onClick={() => setSelectedDay(day)}
                          className="h-10 flex items-center justify-center snap-center cursor-pointer transition-all"
                          style={{
                            color: isSelected ? "#1a1a1a" : "#c7c7cc",
                            fontSize: isSelected ? "17px" : "15px",
                            fontWeight: isSelected ? 600 : 400,
                            lineHeight: "40px",
                          }}
                        >
                          {`${day}日`}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Hour Column */}
                <div className="flex-1 overflow-y-auto snap-y snap-mandatory hide-scrollbar">
                  <div className="py-24">
                    {Array.from({ length: 24 }).map((_, h) => {
                      const isSelected = selectedHour === h
                      return (
                        <div
                          key={h}
                          onClick={() => setSelectedHour(h)}
                          className="h-10 flex items-center justify-center snap-center cursor-pointer transition-all"
                          style={{ 
                            color: isSelected ? "#1a1a1a" : "#c7c7cc",
                            fontSize: isSelected ? "17px" : "15px",
                            fontWeight: isSelected ? 600 : 400,
                            lineHeight: "40px",
                          }}
                        >
                          {h.toString().padStart(2, "0")}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Minute Column */}
                <div className="flex-1 overflow-y-auto snap-y snap-mandatory hide-scrollbar">
                  <div className="py-24">
                    {Array.from({ length: 60 }).map((_, m) => {
                      const isSelected = selectedMinute === m
                      return (
                        <div
                          key={m}
                          onClick={() => setSelectedMinute(m)}
                          className="h-10 flex items-center justify-center snap-center cursor-pointer transition-all"
                          style={{ 
                            color: isSelected ? "#1a1a1a" : "#c7c7cc",
                            fontSize: isSelected ? "17px" : "15px",
                            fontWeight: isSelected ? 600 : 400,
                            lineHeight: "40px",
                          }}
                        >
                          {m.toString().padStart(2, "0")}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Stop Auto-Upload Confirm Modal */}
      {showStopAutoModal && (
        <>
          <div className="absolute inset-0 z-50 bg-black/40" />
          <div
            className="absolute inset-0 z-50 flex items-center justify-center px-10"
            onClick={() => setShowStopAutoModal(false)}
          >
            <div
              className="w-full rounded-2xl text-center overflow-hidden"
              style={{ background: "#fff", boxShadow: "0 12px 40px rgba(0,0,0,0.22)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 pt-6 pb-4">
                <p className="text-base font-semibold mb-2" style={{ color: "#1a1a1a" }}>{"关闭自动上传"}</p>
                <p className="text-sm" style={{ color: "#6e6e73", lineHeight: 1.55 }}>
                  {"确认关闭自动上传？关闭后新素材将不再自动传输到 PC 端。"}
                </p>
              </div>
              <div style={{ height: "1px", background: "rgba(0,0,0,0.10)" }} />
              <div className="flex">
                <button
                  onClick={() => setShowStopAutoModal(false)}
                  className="flex-1 py-3 text-base font-medium transition-colors active:bg-black/5"
                  style={{ color: "#8a8a8e" }}
                >
                  {"继续上传"}
                </button>
                <div style={{ width: "1px", background: "rgba(0,0,0,0.10)" }} />
                <button
                  onClick={() => { setShowStopAutoModal(false); onStopAutoSync?.() }}
                  className="flex-1 py-3 text-base font-medium transition-colors active:bg-black/5"
                  style={{ color: "#ef4444" }}
                >
                  {"确认关闭"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Interrupt Auto-Upload Confirm Modal */}
      {showInterruptModal && (
        <>
          <div className="absolute inset-0 z-50 bg-black/40" />
          <div
            className="absolute inset-0 z-50 flex items-center justify-center px-10"
            onClick={() => setShowInterruptModal(false)}
          >
            <div
              className="w-full rounded-2xl text-center overflow-hidden"
              style={{ background: "#fff", boxShadow: "0 12px 40px rgba(0,0,0,0.22)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 pt-6 pb-4">
                <p className="text-base font-semibold mb-2" style={{ color: "#1a1a1a" }}>{"中断自动上传"}</p>
                <p className="text-sm" style={{ color: "#6e6e73", lineHeight: 1.55 }}>
                  {"当前正在进行自动上传，继续手动上传将中断自动上传，是否继续？"}
                </p>
              </div>
              <div style={{ height: "1px", background: "rgba(0,0,0,0.10)" }} />
              <div className="flex">
                <button
                  onClick={() => setShowInterruptModal(false)}
                  className="flex-1 py-3 text-base font-medium transition-colors active:bg-black/5"
                  style={{ color: "#8a8a8e" }}
                >
                  {"取消"}
                </button>
                <div style={{ width: "1px", background: "rgba(0,0,0,0.10)" }} />
                <button
                  onClick={handleConfirmInterrupt}
                  className="flex-1 py-3 text-base font-medium transition-colors active:bg-black/5"
                  style={{ color: "#3b82f6" }}
                >
                  {"继续上传"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Submitted modal */}
      {showSubmittedModal && (
        <>
          <div className="absolute inset-0 z-50 bg-black/40" />
          <div
            className="absolute inset-0 z-50 flex items-center justify-center px-10"
            onClick={() => setShowSubmittedModal(false)}
          >
            <div
              className="w-full rounded-2xl text-center overflow-hidden"
              style={{ background: "#fff", boxShadow: "0 12px 40px rgba(0,0,0,0.22)" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Body */}
              <div className="px-5 pt-6 pb-4">
                <p className="text-base font-semibold mb-2" style={{ color: "#1a1a1a" }}>{"已提交"}</p>
                <p className="text-sm" style={{ color: "#6e6e73", lineHeight: 1.55 }}>
                  {`已入队 ${submittedCount} 个文件，跳过 ${skippedCount} 个重复项`}
                </p>
              </div>
              {/* Divider */}
              <div style={{ height: "1px", background: "rgba(0,0,0,0.10)" }} />
              {/* OK button */}
              <button
                onClick={() => setShowSubmittedModal(false)}
                className="w-full py-3 text-base font-medium transition-colors active:bg-black/5"
                style={{ color: "#3b82f6" }}
              >
                {"OK"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Toast Notification */}
      {showToast && (
        <div
          className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-lg animate-in fade-in slide-in-from-top-2 duration-300"
          style={{ background: "rgba(0,0,0,0.85)", color: "#fff" }}
        >
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4" fill="currentColor" />
            <span className="text-sm font-medium">{"自动上传已开启"}</span>
          </div>
        </div>
      )}

      {/* Conflict Modal - File Already Uploaded */}
      {showConflictModal && (
        <>
          {/* Overlay */}
          <div
            className="absolute inset-0 z-50 bg-black/50"
            onClick={() => setShowConflictModal(false)}
          />
          
          {/* Modal Panel */}
          <div
            className="absolute bottom-0 left-0 w-full z-50 bg-white rounded-t-[32px] animate-in slide-in-from-bottom duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drag Handle */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full" style={{ background: "#d1d1d6" }} />
            </div>

            <div className="px-5 pb-8">
              {/* Title & Icon */}
              <div className="flex flex-col items-center mb-4">
                <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3" style={{ background: "rgba(255,149,0,0.1)" }}>
                  <Check className="h-6 w-6" style={{ color: "#ff9500" }} />
                </div>
                <h3 className="text-lg font-bold text-center" style={{ color: "#1a1a1a" }}>
                  {"发现已上传过的文件"}
                </h3>
              </div>

              {/* Description */}
              <p className="text-sm text-center mb-6" style={{ color: "#6e6e73", lineHeight: 1.6 }}>
                {`当前包含 ${alreadyTransferred.length} 个已上传过的文件，是否重新传输？`}
              </p>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={handleSkipTransferred}
                  className="flex-1 rounded-xl py-3.5 text-base font-semibold"
                  style={{ background: "#f5f5f7", color: "#1a1a1a", border: "1px solid #e5e5ea" }}
                >
                  {"跳过已传"}
                </button>
                <button
                  onClick={handleForceReTransfer}
                  className="flex-1 rounded-xl py-3.5 text-base font-bold text-white"
                  style={{ background: "#3b82f6" }}
                >
                  {"重新传输"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

    </div>
  )
}
