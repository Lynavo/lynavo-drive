"use client"

import { useState } from "react"
import { ArrowLeft, Download, FileImage, File, CheckCircle2, Lock, Play, X, Pause } from "lucide-react"

interface SharedFile {
  id: string
  name: string
  size: string
  sizeBytes: number
  type: "video" | "photo" | "other"
  publishedAt: string
  publisher: string
  downloaded: boolean
  // For video: duration string and a mock thumbnail color
  duration?: string
  thumbnailColor?: string
}

const MOCK_SHARED_FILES: SharedFile[] = [
  { id: "p1", name: "Final_Cut_Ep01.mp4",       size: "2.4 GB", sizeBytes: 2576980377, type: "video", publishedAt: "今天 14:30",   publisher: "剪辑工作站-A", downloaded: false, duration: "24:32", thumbnailColor: "#1a3a5c" },
  { id: "p2", name: "Final_Cut_Ep02.mp4",       size: "2.1 GB", sizeBytes: 2254857830, type: "video", publishedAt: "今天 14:28",   publisher: "剪辑工作站-A", downloaded: false, duration: "21:08", thumbnailColor: "#374151" },
  { id: "p3", name: "BTS_Highlight_Reel.mp4",   size: "890 MB", sizeBytes: 933232640,  type: "video", publishedAt: "昨天 22:10",   publisher: "剪辑工作站-A", downloaded: true,  duration: "08:45", thumbnailColor: "#4B5563" },
  { id: "p4", name: "Poster_A_Final.jpg",       size: "28 MB",  sizeBytes: 29360128,   type: "photo", publishedAt: "昨天 20:45",   publisher: "MacBook Pro",  downloaded: false },
  { id: "p5", name: "Interview_Clean.mp4",      size: "1.6 GB", sizeBytes: 1717986918, type: "video", publishedAt: "03-18 18:30", publisher: "剪辑工作站-A", downloaded: true,  duration: "16:23", thumbnailColor: "#1e3a8a" },
  { id: "p6", name: "Product_Shoot_Graded.mp4", size: "3.2 GB", sizeBytes: 3435973837, type: "video", publishedAt: "03-17 09:15", publisher: "MacBook Pro",  downloaded: true,  duration: "32:10", thumbnailColor: "#312e81" },
  { id: "p7", name: "Color_LUT_Pack.zip",       size: "45 MB",  sizeBytes: 47185920,   type: "other", publishedAt: "03-16 11:00", publisher: "MacBook Pro",  downloaded: false },
]

interface PublicFilesPageProps {
  onBack: () => void
  isPro: boolean
  onUpgradePro: () => void
}

export function PublicFilesPage({ onBack, isPro, onUpgradePro }: PublicFilesPageProps) {
  const [downloading, setDownloading] = useState<Set<string>>(new Set())
  const [downloaded, setDownloaded] = useState<Set<string>>(
    new Set(MOCK_SHARED_FILES.filter((f) => f.downloaded).map((f) => f.id))
  )
  // Video player preview state
  const [previewFile, setPreviewFile] = useState<SharedFile | null>(null)
  const [playing, setPlaying] = useState(false)
  const [previewProgress, setPreviewProgress] = useState(28)

  const handleDownload = (file: SharedFile) => {
    if (!isPro) return
    if (downloading.has(file.id) || downloaded.has(file.id)) return
    setDownloading((prev) => new Set(prev).add(file.id))
    setTimeout(() => {
      setDownloading((prev) => { const n = new Set(prev); n.delete(file.id); return n })
      setDownloaded((prev) => new Set(prev).add(file.id))
    }, 2200)
  }

  const openPreview = (file: SharedFile) => {
    setPreviewFile(file)
    setPlaying(false)
    setPreviewProgress(28)
  }

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden"
      style={{ background: "#dceefa" }}
    >
      {/* Header */}
      <header className="shrink-0 px-4 pt-12 pb-3" style={{ background: "#dceefa" }}>
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="p-2 -ml-2" style={{ color: "#1a3a5c" }}>
            <ArrowLeft className="h-6 w-6" strokeWidth={2.5} />
          </button>
          <h1 className="text-lg font-bold" style={{ color: "#1a3a5c" }}>{"共享目录"}</h1>
          <div className="w-10" />
        </div>
      </header>

      <main className="flex flex-1 flex-col overflow-y-auto pb-8 pt-1">

        {/* Pro lock banner */}
        {!isPro && (
          <button
            onClick={onUpgradePro}
            className="mx-4 mb-3 flex items-center gap-3 rounded-2xl p-3 w-auto text-left transition-all active:scale-[0.98]"
            style={{ background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.28)" }}
          >
            <Lock className="h-4 w-4 shrink-0" style={{ color: "#d97706" }} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold" style={{ color: "#92400e" }}>{"试用已结束，订阅后继续使用"}</p>
            </div>
            <span className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: "#f59e0b", color: "#fff" }}>
              {"立即订阅"}
            </span>
          </button>
        )}

        {/* Video/photo grid */}
        <div className="grid grid-cols-3 gap-0.5 px-0.5">
          {MOCK_SHARED_FILES.map((file) => {
            const isDone = downloaded.has(file.id)
            const isLoading = downloading.has(file.id)
            const isVideo = file.type === "video"

            return (
              <button
                key={file.id}
                className="relative overflow-hidden aspect-square"
                style={{ background: isVideo ? (file.thumbnailColor ?? "#1a3a5c") : "rgba(200,220,240,0.5)" }}
                onClick={() => isVideo ? openPreview(file) : undefined}
              >
                {/* Non-video icon */}
                {!isVideo && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    {file.type === "photo"
                      ? <FileImage className="h-8 w-8" style={{ color: "#5a9ab8" }} />
                      : <File className="h-8 w-8" style={{ color: "#8aabbd" }} />
                    }
                  </div>
                )}

                {/* Video vignette */}
                {isVideo && (
                  <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 55%)" }} />
                )}

                {/* Play icon (video only) */}
                {isVideo && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div
                      className="flex h-9 w-9 items-center justify-center rounded-full"
                      style={{ background: "rgba(255,255,255,0.20)", border: "1.5px solid rgba(255,255,255,0.50)" }}
                    >
                      <Play className="h-4 w-4 text-white ml-0.5" fill="white" />
                    </div>
                  </div>
                )}

                {/* Duration badge — bottom right */}
                {isVideo && file.duration && (
                  <span
                    className="absolute bottom-1.5 right-1.5 rounded px-1 py-0.5 text-[10px] font-bold text-white leading-none"
                    style={{ background: "rgba(0,0,0,0.58)" }}
                  >
                    {file.duration}
                  </span>
                )}

                {/* File name — bottom left */}
                <span
                  className="absolute bottom-1.5 left-1.5 text-[9px] font-semibold truncate max-w-[80%] leading-tight"
                  style={{ color: isVideo ? "#fff" : "#1a3a5c", textShadow: isVideo ? "0 1px 3px rgba(0,0,0,0.7)" : "none" }}
                >
                  {file.name}
                </span>

                {/* Downloaded badge — top right */}
                {isDone && (
                  <div
                    className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full"
                    style={{ background: "rgba(34,197,94,0.85)" }}
                  >
                    <CheckCircle2 className="h-3 w-3 text-white" />
                  </div>
                )}

                {/* Loading spinner — top right */}
                {isLoading && (
                  <div className="absolute top-1.5 right-1.5 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                )}
              </button>
            )
          })}
        </div>
      </main>

      {/* Video preview modal */}
      {previewFile && (
        <>
          <div className="absolute inset-0 z-50 bg-black/80" onClick={() => setPreviewFile(null)} />
          <div
            className="absolute inset-x-0 z-50"
            style={{ top: "50%", transform: "translateY(-50%)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Video area */}
            <div
              className="relative mx-4 rounded-2xl overflow-hidden flex items-center justify-center"
              style={{ height: "220px", background: previewFile.thumbnailColor ?? "#111" }}
            >
              <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 50%)" }} />

              {/* Big play/pause */}
              <button
                className="relative flex h-16 w-16 items-center justify-center rounded-full transition-all active:scale-95"
                style={{ background: "rgba(255,255,255,0.20)", border: "2px solid rgba(255,255,255,0.5)", backdropFilter: "blur(6px)" }}
                onClick={() => setPlaying(!playing)}
              >
                {playing
                  ? <Pause className="h-7 w-7 text-white" fill="white" />
                  : <Play className="h-7 w-7 text-white ml-1" fill="white" />
                }
              </button>

              {/* Close button */}
              <button
                className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full"
                style={{ background: "rgba(0,0,0,0.4)", color: "#fff" }}
                onClick={() => setPreviewFile(null)}
              >
                <X className="h-4 w-4" />
              </button>

              {/* Duration */}
              {previewFile.duration && (
                <span className="absolute bottom-3 right-3 rounded-md px-1.5 py-0.5 text-xs font-bold text-white" style={{ background: "rgba(0,0,0,0.55)" }}>
                  {previewFile.duration}
                </span>
              )}
            </div>

            {/* Progress bar + info */}
            <div className="mx-4 mt-0 rounded-b-2xl px-4 pb-4 pt-3" style={{ background: "#1a2a3a" }}>
              {/* Scrub bar */}
              <div className="h-1 w-full rounded-full mb-3 overflow-hidden" style={{ background: "rgba(255,255,255,0.15)" }}>
                <div className="h-full rounded-full" style={{ background: "#3b82f6", width: `${previewProgress}%` }} />
              </div>
              <p className="text-sm font-semibold truncate text-white mb-0.5">{previewFile.name}</p>
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: "rgba(255,255,255,0.55)" }}>{previewFile.publisher} · {previewFile.size}</span>
                {isPro ? (
                  <button
                    onClick={() => handleDownload(previewFile)}
                    className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all active:scale-95"
                    style={{ background: "rgba(59,130,246,0.25)", color: "#60a5fa" }}
                  >
                    <Download className="h-3.5 w-3.5" />
                    {"下载"}
                  </button>
                ) : (
                  <button
                    onClick={() => { setPreviewFile(null); onUpgradePro() }}
                    className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all active:scale-95"
                    style={{ background: "rgba(245,158,11,0.25)", color: "#fbbf24" }}
                  >
                    <Lock className="h-3.5 w-3.5" />
                    {"开通会员"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
