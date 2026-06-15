"use client"

import { useState } from "react"
import { 
  Globe, 
  Download, 
  FileVideo, 
  FileImage, 
  File, 
  CheckCircle2, 
  Copy, 
  Check,
  ArrowUpRight,
  Play,
  Link2,
  MoreHorizontal,
  Search,
  Grid3X3,
  List,
  Filter,
  Users,
  Folder
} from "lucide-react"

type DirectoryType = "teamSpace" | "inbox" | "myFiles"

interface SharedFile {
  id: string
  name: string
  size: string
  type: "video" | "photo" | "other"
  publishedAt: string
  downloaded: boolean
  downloads: number
  duration?: string
}

const MOCK_FILES: SharedFile[] = [
  { id: "1", name: "Final_Cut_Ep01.mp4", size: "2.4 GB", type: "video", publishedAt: "2 hours ago", downloaded: false, downloads: 12, duration: "24:32" },
  { id: "2", name: "Final_Cut_Ep02.mp4", size: "2.1 GB", type: "video", publishedAt: "2 hours ago", downloaded: false, downloads: 8, duration: "21:08" },
  { id: "3", name: "BTS_Highlight.mp4", size: "890 MB", type: "video", publishedAt: "Yesterday", downloaded: true, downloads: 45, duration: "08:45" },
  { id: "4", name: "Poster_Final.jpg", size: "28 MB", type: "photo", publishedAt: "Yesterday", downloaded: true, downloads: 23 },
  { id: "5", name: "Interview_Clean.mp4", size: "1.6 GB", type: "video", publishedAt: "Mar 18", downloaded: true, downloads: 67, duration: "16:23" },
  { id: "6", name: "Product_Graded.mp4", size: "3.2 GB", type: "video", publishedAt: "Mar 17", downloaded: true, downloads: 34, duration: "32:10" },
  { id: "7", name: "Color_LUT_Pack.zip", size: "45 MB", type: "other", publishedAt: "Mar 16", downloaded: false, downloads: 156 },
]

interface SharedListGlobalProps {
  tunnelEnabled: boolean
  directoryType: DirectoryType
}

const directoryConfig = {
  teamSpace: {
    title: "Team Space",
    subtitle: "Files shared with LAN devices",
    icon: Users,
    iconBg: "bg-blue-100",
    iconColor: "text-blue-600"
  },
  inbox: {
    title: "Inbox",
    subtitle: "Files received from other devices",
    icon: Download,
    iconBg: "bg-amber-100",
    iconColor: "text-amber-600"
  },
  myFiles: {
    title: "My Files",
    subtitle: "Personal files synced across same account",
    icon: Folder,
    iconBg: "bg-orange-100",
    iconColor: "text-orange-600"
  }
}

export function SharedListGlobal({ tunnelEnabled, directoryType }: SharedListGlobalProps) {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [copied, setCopied] = useState<string | null>(null)
  const tunnelUrl = "https://vividrop.io/s/a8x2k9"

  const config = directoryConfig[directoryType]
  const Icon = config.icon

  const handleCopyLink = (fileId: string) => {
    navigator.clipboard.writeText(`${tunnelUrl}/${fileId}`)
    setCopied(fileId)
    setTimeout(() => setCopied(null), 2000)
  }

  const totalDownloads = MOCK_FILES.reduce((sum, f) => sum + f.downloads, 0)

  return (
    <div className="h-full overflow-auto custom-scrollbar">
      <div className="px-8 py-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${config.iconBg}`}>
              <Icon className={`h-5 w-5 ${config.iconColor}`} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-foreground">{config.title}</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {config.subtitle}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
              <button
                onClick={() => setViewMode("grid")}
                className={`p-2 rounded-md transition-colors ${viewMode === "grid" ? "bg-card shadow-sm" : "hover:bg-card/50"}`}
              >
                <Grid3X3 className="h-4 w-4 text-muted-foreground" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`p-2 rounded-md transition-colors ${viewMode === "list" ? "bg-card shadow-sm" : "hover:bg-card/50"}`}
              >
                <List className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          </div>
        </div>

        {/* Tunnel Banner */}
        {tunnelEnabled && (
          <div className="mb-6 rounded-xl bg-gradient-to-r from-violet-50 to-purple-50 border border-violet-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500">
                  <Globe className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-sm font-medium text-violet-900">Public Link Active</p>
                  <p className="text-xs text-violet-700">
                    <span className="font-semibold">{totalDownloads}</span> total downloads via tunnel
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-violet-800 bg-white/50 px-3 py-1.5 rounded-lg border border-violet-200">
                  {tunnelUrl}
                </code>
                <button 
                  onClick={() => handleCopyLink("root")}
                  className="p-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors"
                >
                  {copied === "root" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Search and Filter */}
        <div className="flex items-center gap-3 mb-6">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search files..."
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            />
          </div>
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:bg-muted transition-colors">
            <Filter className="h-4 w-4" />
            Filter
          </button>
        </div>

        {/* Files Grid/List */}
        {viewMode === "grid" ? (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
            {MOCK_FILES.map((file) => (
              <FileGridCard 
                key={file.id} 
                file={file} 
                tunnelEnabled={tunnelEnabled}
                onCopyLink={() => handleCopyLink(file.id)}
                copied={copied === file.id}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {MOCK_FILES.map((file) => (
              <FileListRow 
                key={file.id} 
                file={file} 
                tunnelEnabled={tunnelEnabled}
                onCopyLink={() => handleCopyLink(file.id)}
                copied={copied === file.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function FileGridCard({ 
  file, 
  tunnelEnabled, 
  onCopyLink, 
  copied 
}: { 
  file: SharedFile
  tunnelEnabled: boolean
  onCopyLink: () => void
  copied: boolean
}) {
  const isVideo = file.type === "video"
  
  return (
    <div className="group bg-card rounded-xl border border-border overflow-hidden hover-lift">
      {/* Thumbnail */}
      <div className={`relative aspect-video ${isVideo ? "bg-slate-800" : "bg-muted"} flex items-center justify-center`}>
        {isVideo ? (
          <>
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            <button className="relative flex h-12 w-12 items-center justify-center rounded-full bg-white/20 border border-white/30 backdrop-blur-sm hover:bg-white/30 transition-colors">
              <Play className="h-5 w-5 text-white ml-0.5" fill="white" />
            </button>
            {file.duration && (
              <span className="absolute bottom-2 right-2 text-[10px] font-medium text-white bg-black/60 px-1.5 py-0.5 rounded">
                {file.duration}
              </span>
            )}
          </>
        ) : file.type === "photo" ? (
          <FileImage className="h-10 w-10 text-muted-foreground" />
        ) : (
          <File className="h-10 w-10 text-muted-foreground" />
        )}
        
        {file.downloaded && (
          <div className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-violet-500">
            <CheckCircle2 className="h-3.5 w-3.5 text-white" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <p className="text-sm font-medium text-foreground truncate mb-1">{file.name}</p>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{file.size}</span>
          {tunnelEnabled && (
            <div className="flex items-center gap-1 text-xs text-violet-600">
              <Download className="h-3 w-3" />
              {file.downloads}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      {tunnelEnabled && (
        <div className="px-3 pb-3 pt-0">
          <button
            onClick={onCopyLink}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-violet-50 text-violet-700 text-xs font-medium hover:bg-violet-100 transition-colors"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
            {copied ? "Copied!" : "Copy Public Link"}
          </button>
        </div>
      )}
    </div>
  )
}

function FileListRow({ 
  file, 
  tunnelEnabled, 
  onCopyLink, 
  copied 
}: { 
  file: SharedFile
  tunnelEnabled: boolean
  onCopyLink: () => void
  copied: boolean
}) {
  return (
    <div className="flex items-center gap-4 bg-card rounded-xl border border-border p-4 hover:bg-muted/30 transition-colors">
      {/* Icon */}
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
        file.type === "video" ? "bg-slate-800" : "bg-muted"
      }`}>
        {file.type === "video" ? (
          <Play className="h-4 w-4 text-white ml-0.5" fill="white" />
        ) : file.type === "photo" ? (
          <FileImage className="h-5 w-5 text-muted-foreground" />
        ) : (
          <File className="h-5 w-5 text-muted-foreground" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
          {file.downloaded && (
            <CheckCircle2 className="h-4 w-4 text-violet-500 shrink-0" />
          )}
        </div>
        <p className="text-xs text-muted-foreground">{file.size} • {file.publishedAt}</p>
      </div>

      {/* Stats */}
      {tunnelEnabled && (
        <div className="flex items-center gap-1.5 text-xs text-violet-600 bg-violet-50 px-2.5 py-1 rounded-full">
          <Download className="h-3 w-3" />
          {file.downloads} downloads
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        {tunnelEnabled && (
          <button
            onClick={onCopyLink}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-50 text-violet-700 text-xs font-medium hover:bg-violet-100 transition-colors"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
            {copied ? "Copied!" : "Copy Link"}
          </button>
        )}
        <button className="p-2 rounded-lg hover:bg-muted transition-colors">
          <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  )
}
