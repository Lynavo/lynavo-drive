"use client"

import { useState } from "react"
import { Home, ImageIcon, Check, CloudUpload, X, AlertTriangle } from "lucide-react"

type TabType = "home" | "album"
type TransferState = "idle" | "auto_syncing" | "manual_uploading"

// Mock photo data
const MOCK_PHOTOS = [
  { id: "1", color: "#FF6B6B", uploaded: false },
  { id: "2", color: "#4ECDC4", uploaded: true },
  { id: "3", color: "#45B7D1", uploaded: false },
  { id: "4", color: "#FFA07A", uploaded: true },
  { id: "5", color: "#98D8C8", uploaded: false },
  { id: "6", color: "#F7DC6F", uploaded: false },
  { id: "7", color: "#BB8FCE", uploaded: true },
  { id: "8", color: "#85C1E2", uploaded: false },
  { id: "9", color: "#F8B88B", uploaded: false },
]

export default function PrototypePage() {
  // Global state
  const [currentTab, setCurrentTab] = useState<TabType>("home")
  const [globalTransferState, setGlobalTransferState] = useState<TransferState>("auto_syncing")
  const [showConflictModal, setShowConflictModal] = useState(false)
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set())
  const selectedCount = selectedPhotos.size

  // Toggle photo selection
  const togglePhoto = (id: string) => {
    setSelectedPhotos((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // Handle upload button click in album view
  const handleUploadClick = () => {
    if (selectedCount === 0) return
    
    // Check if any selected photos are already uploaded
    const hasUploaded = Array.from(selectedPhotos).some((id) => {
      const photo = MOCK_PHOTOS.find((p) => p.id === id)
      return photo?.uploaded
    })
    
    if (hasUploaded) {
      setShowConflictModal(true)
    } else {
      // Direct upload without conflict
      setCurrentTab("home")
      setGlobalTransferState("manual_uploading")
    }
  }

  // Handle re-upload confirmation
  const handleReupload = () => {
    setShowConflictModal(false)
    setCurrentTab("home")
    setGlobalTransferState("manual_uploading")
  }

  // Handle skip uploaded files
  const handleSkipUploaded = () => {
    setShowConflictModal(false)
    // Remove uploaded photos from selection
    setSelectedPhotos((prev) => {
      const next = new Set(prev)
      MOCK_PHOTOS.forEach((photo) => {
        if (photo.uploaded) {
          next.delete(photo.id)
        }
      })
      return next
    })
  }

  // Cancel manual upload
  const handleCancelManual = () => {
    setGlobalTransferState("auto_syncing")
    setSelectedPhotos(new Set())
  }

  // Cancel auto sync
  const handleCancelAutoSync = () => {
    setGlobalTransferState("idle")
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "#f0f4f8" }}>
      {/* Phone Container */}
      <div className="relative w-full max-w-md h-[800px] rounded-[40px] shadow-2xl overflow-hidden" style={{ background: "#fff" }}>
        
        {/* Content Area */}
        <div className="h-full flex flex-col">
          
          {/* View Content */}
          <div className="flex-1 overflow-auto">
            
            {/* Home View */}
            {currentTab === "home" && (
              <div className="h-full flex flex-col items-center justify-center px-6">
                
                {/* Auto Syncing State */}
                {globalTransferState === "auto_syncing" && (
                  <div className="w-full max-w-sm">
                    <div className="flex flex-col items-center mb-8">
                      <div className="w-20 h-20 rounded-full flex items-center justify-center mb-4" style={{ background: "rgba(34,197,94,0.1)" }}>
                        <CloudUpload className="w-10 h-10" style={{ color: "#22c55e" }} />
                      </div>
                      <h2 className="text-2xl font-bold mb-2" style={{ color: "#1a1a1a" }}>
                        自动同步中
                      </h2>
                      <p className="text-sm text-center" style={{ color: "#6e6e73" }}>
                        正在自动上传相册中的新增素材
                      </p>
                    </div>

                    {/* Green Progress Bar */}
                    <div className="mb-6">
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(34,197,94,0.1)" }}>
                        <div className="h-full rounded-full animate-pulse" style={{ background: "#22c55e", width: "60%" }} />
                      </div>
                      <p className="text-xs text-center mt-2" style={{ color: "#6e6e73" }}>
                        已上传 12/20 个文件
                      </p>
                    </div>

                    <button
                      onClick={handleCancelAutoSync}
                      className="w-full rounded-xl py-3 text-sm font-semibold"
                      style={{ background: "#f5f5f7", color: "#6e6e73" }}
                    >
                      取消本次传输
                    </button>
                  </div>
                )}

                {/* Manual Uploading State */}
                {globalTransferState === "manual_uploading" && (
                  <div className="w-full max-w-sm">
                    <div className="flex flex-col items-center mb-8">
                      <div className="w-20 h-20 rounded-full flex items-center justify-center mb-4" style={{ background: "rgba(59,130,246,0.1)" }}>
                        <CloudUpload className="w-10 h-10" style={{ color: "#3b82f6" }} />
                      </div>
                      <h2 className="text-2xl font-bold mb-2" style={{ color: "#1a1a1a" }}>
                        手动上传中
                      </h2>
                      <p className="text-xs font-semibold mb-1" style={{ color: "#ef4444" }}>
                        自动同步已暂停
                      </p>
                      <p className="text-sm text-center" style={{ color: "#6e6e73" }}>
                        正在优先上传手动选择的 {selectedCount} 个文件
                      </p>
                    </div>

                    {/* Blue Progress Bar */}
                    <div className="mb-6">
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(59,130,246,0.1)" }}>
                        <div className="h-full rounded-full animate-pulse" style={{ background: "#3b82f6", width: "45%" }} />
                      </div>
                      <p className="text-xs text-center mt-2" style={{ color: "#6e6e73" }}>
                        已上传 3/{selectedCount} 个文件
                      </p>
                    </div>

                    <button
                      onClick={handleCancelManual}
                      className="w-full rounded-xl py-3 text-sm font-bold text-white"
                      style={{ background: "#ef4444" }}
                    >
                      取消手动传输
                    </button>
                  </div>
                )}

                {/* Idle State */}
                {globalTransferState === "idle" && (
                  <div className="w-full max-w-sm text-center">
                    <div className="w-20 h-20 rounded-full flex items-center justify-center mb-4 mx-auto" style={{ background: "#f5f5f7" }}>
                      <CloudUpload className="w-10 h-10" style={{ color: "#d1d1d6" }} />
                    </div>
                    <h2 className="text-2xl font-bold mb-2" style={{ color: "#1a1a1a" }}>
                      无传输任务
                    </h2>
                    <p className="text-sm" style={{ color: "#6e6e73" }}>
                      当前没有进行中的传输任务
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Album View */}
            {currentTab === "album" && (
              <div className="h-full flex flex-col">
                {/* Header */}
                <div className="px-4 py-4 border-b" style={{ borderColor: "rgba(0,0,0,0.05)" }}>
                  <h1 className="text-xl font-bold" style={{ color: "#1a1a1a" }}>
                    相册工作台
                  </h1>
                  <p className="text-xs mt-1" style={{ color: "#6e6e73" }}>
                    选择要上传的照片或视频
                  </p>
                </div>

                {/* Photo Grid */}
                <div className="flex-1 overflow-auto p-4 pb-24">
                  <div className="grid grid-cols-3 gap-2">
                    {MOCK_PHOTOS.map((photo) => {
                      const isSelected = selectedPhotos.has(photo.id)
                      return (
                        <button
                          key={photo.id}
                          onClick={() => togglePhoto(photo.id)}
                          className="relative aspect-square rounded-lg overflow-hidden transition-all active:scale-95"
                          style={{
                            background: photo.color,
                            outline: isSelected ? "3px solid #3b82f6" : "none",
                            outlineOffset: "-3px",
                          }}
                        >
                          {/* Selection Checkbox */}
                          <div
                            className="absolute top-1.5 left-1.5 w-6 h-6 rounded-full flex items-center justify-center transition-all"
                            style={{
                              background: isSelected ? "#3b82f6" : "rgba(0,0,0,0.3)",
                              border: isSelected ? "none" : "2px solid #fff",
                            }}
                          >
                            {isSelected && <Check className="w-4 h-4 text-white" strokeWidth={3} />}
                          </div>

                          {/* Uploaded Badge */}
                          {photo.uploaded && (
                            <div className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md flex items-center justify-center" style={{ background: "#22c55e" }}>
                              <CloudUpload className="w-3.5 h-3.5 text-white" />
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Bottom Action Bar */}
                {selectedCount > 0 && (
                  <div className="absolute bottom-20 left-0 right-0 px-4 pb-4">
                    <div className="rounded-2xl px-5 py-4 flex items-center justify-between shadow-lg" style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.06)" }}>
                      <div>
                        <p className="text-sm font-semibold" style={{ color: "#1a1a1a" }}>
                          已选 {selectedCount} 项
                        </p>
                        <p className="text-xs" style={{ color: "#6e6e73" }}>
                          {MOCK_PHOTOS.filter((p) => selectedPhotos.has(p.id) && p.uploaded).length > 0 && "包含已上传文件"}
                        </p>
                      </div>
                      <button
                        onClick={handleUploadClick}
                        className="rounded-xl px-6 py-2.5 text-sm font-bold text-white"
                        style={{ background: "#3b82f6" }}
                      >
                        上传
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Bottom Tab Bar */}
          <div className="shrink-0 border-t" style={{ borderColor: "rgba(0,0,0,0.05)", background: "#fafafa" }}>
            <div className="flex">
              <button
                onClick={() => setCurrentTab("home")}
                className="flex-1 flex flex-col items-center justify-center py-3 transition-colors"
                style={{ color: currentTab === "home" ? "#3b82f6" : "#8e8e93" }}
              >
                <Home className="w-6 h-6 mb-1" />
                <span className="text-xs font-medium">首页</span>
              </button>
              <button
                onClick={() => setCurrentTab("album")}
                className="flex-1 flex flex-col items-center justify-center py-3 transition-colors"
                style={{ color: currentTab === "album" ? "#3b82f6" : "#8e8e93" }}
              >
                <ImageIcon className="w-6 h-6 mb-1" />
                <span className="text-xs font-medium">相册</span>
              </button>
            </div>
          </div>
        </div>

        {/* Conflict Modal - Positioned inside phone container */}
        {showConflictModal && (
          <>
            {/* Overlay */}
            <div className="absolute inset-0 bg-black/50 z-40" onClick={() => setShowConflictModal(false)} />
            
            {/* Modal Panel */}
            <div className="absolute inset-0 flex items-center justify-center z-50 px-6">
              <div className="w-full rounded-3xl p-6" style={{ background: "#fff" }}>
                {/* Icon */}
                <div className="flex justify-center mb-4">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "rgba(255,149,0,0.1)" }}>
                    <AlertTriangle className="w-8 h-8" style={{ color: "#ff9500" }} />
                  </div>
                </div>

                {/* Title */}
                <h3 className="text-xl font-bold text-center mb-3" style={{ color: "#1a1a1a" }}>
                  发现已上传过的文件
                </h3>

                {/* Description */}
                <p className="text-sm text-center mb-6" style={{ color: "#6e6e73", lineHeight: 1.6 }}>
                  当前选择中包含已传输过的文件，是否强制重新传输？
                </p>

                {/* Actions */}
                <div className="flex gap-3">
                  <button
                    onClick={handleSkipUploaded}
                    className="flex-1 rounded-xl py-3 text-sm font-semibold"
                    style={{ background: "#f5f5f7", color: "#1a1a1a" }}
                  >
                    跳过已传
                  </button>
                  <button
                    onClick={handleReupload}
                    className="flex-1 rounded-xl py-3 text-sm font-bold text-white"
                    style={{ background: "#3b82f6" }}
                  >
                    重新传输
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
