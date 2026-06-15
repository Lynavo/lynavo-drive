"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import type { RefObject } from "react"
import { mockHistoryDays } from "../../lib/mock-data"
import { 
  Wifi, 
  Globe, 
  Download, 
  Upload, 
  Settings, 
  Folder, 
  FileVideo, 
  FileImage,
  File,
  Play,
  ArrowRight,
  QrCode,
  Link2,
  Copy,
  Check,
  ChevronRight,
  ChevronLeft,
  MoreHorizontal,
  Home,
  CloudDownload,
  Monitor,
  Users,
  User,
  FolderOpen,
  Image,
  ToggleRight,
  Calendar,
  Clock,
  History,
  ArrowDownCircle,
  Smartphone,
  Laptop,
  Crown,
  Gift,
  Languages,
  LogOut,
  HelpCircle,
  FileQuestion,
  MessageSquare,
  FolderPlus,
  ScanLine,
  ArrowUpToLine,
  CheckSquare,
  Rows3,
  Grid2X2,
  RectangleHorizontal,
  RefreshCw,
  Pencil,
  ShieldCheck,
  Trash2
} from "lucide-react"

// Types
interface SharedFile {
  id: string
  name: string
  size: string
  type: "video" | "photo" | "other"
  downloaded: boolean
  duration?: string
}

const MOCK_FILES: SharedFile[] = [
  { id: "1", name: "Final_Cut_Ep01.mp4", size: "2.4 GB", type: "video", downloaded: false, duration: "24:32" },
  { id: "2", name: "BTS_Highlight.mp4", size: "890 MB", type: "video", downloaded: true, duration: "08:45" },
  { id: "3", name: "Poster_Final.jpg", size: "28 MB", type: "photo", downloaded: true },
  { id: "4", name: "Interview.mp4", size: "1.6 GB", type: "video", downloaded: false, duration: "16:23" },
]

type LanDesktopDevice = {
  id: string
  name: string
  type: "desktop" | "laptop"
  ip: string
  status: "available" | "busy"
}

const MOCK_LAN_DEVICES: LanDesktopDevice[] = [
  { id: "lan-1", name: "openimdeMac-mini", type: "desktop", ip: "192.168.31.21", status: "available" },
  { id: "lan-2", name: "MacBook Pro", type: "laptop", ip: "192.168.31.36", status: "available" },
  { id: "lan-3", name: "Windows Workstation", type: "desktop", ip: "192.168.31.52", status: "busy" },
]

type MobileView =
  | "auth"
  | "connectDesktop"
  | "history"
  | "recentDownloads"
  | "home"
  | "settings"
  | "language"
  | "autoUploadSettings"
  | "giftCard"
  | "helpCenter"
  | "files"
  | "phoneSyncSpace"
  | "remoteAccess"
  | "membership"

const MOBILE_PAGE_BACKGROUND = "#DCEEFE"

const RECENT_DOWNLOADS = [
  { id: "download-1", name: "Vacation-01.JPG", type: "照片", size: "8.4 MB", time: "今天 10:42", preview: "photo" as const },
  { id: "download-2", name: "Interview-Final.mp4", type: "视频", size: "186 MB", time: "今天 09:18", preview: "video" as const },
  { id: "download-3", name: "Project-Brief.pdf", type: "文件", size: "2.1 MB", time: "昨天 21:06", preview: "file" as const },
  { id: "download-4", name: "Poster-Pack.zip", type: "文件", size: "34 MB", time: "昨天 16:33", preview: "file" as const },
]

const MOBILE_ONBOARDING_STORAGE_KEY = "vividrop.mobile.onboarding.seen"

type MobileOnboardingTargetKey =
  | "connectDevices"
  | "autoUploadButton"
  | "uploadSources"
  | "uploadRange"
  | "confirmUpload"
  | "uploadStatus"
  | "remoteResourcesTab"
  | "remoteAccessCard"

type MobileOnboardingStep = {
  id: number
  view: MobileView
  targetKey: MobileOnboardingTargetKey
  title: string
  description: string
  actionLabel: string
}

const MOBILE_ONBOARDING_STEPS: MobileOnboardingStep[] = [
  {
    id: 0,
    view: "connectDesktop",
    targetKey: "connectDevices",
    title: "先连接电脑",
    description: "选择同一局域网内的电脑，连接后手机素材会上传到电脑端。",
    actionLabel: "去连接",
  },
  {
    id: 1,
    view: "home",
    targetKey: "autoUploadButton",
    title: "开启自动上传",
    description: "开启后，手机里的照片、视频和选中文件会自动同步到电脑。",
    actionLabel: "下一步",
  },
  {
    id: 2,
    view: "autoUploadSettings",
    targetKey: "uploadSources",
    title: "选择上传内容",
    description: "可以同步相册，也可以从系统文件里选择指定文件上传。",
    actionLabel: "继续",
  },
  {
    id: 3,
    view: "autoUploadSettings",
    targetKey: "uploadRange",
    title: "设置上传范围",
    description: "选择全部、从现在开始或自定义范围，控制要上传哪些内容。",
    actionLabel: "继续",
  },
  {
    id: 4,
    view: "autoUploadSettings",
    targetKey: "confirmUpload",
    title: "开始同步",
    description: "确认后返回首页，你可以看到上传进度。",
    actionLabel: "完成设置",
  },
  {
    id: 5,
    view: "home",
    targetKey: "uploadStatus",
    title: "查看上传进度",
    description: "这里会显示已上传数量、传输进度和最近同步时间。",
    actionLabel: "知道了",
  },
  {
    id: 6,
    view: "home",
    targetKey: "remoteResourcesTab",
    title: "打开远程资源",
    description: "点击底部远程资源，可以进入电脑文件和手机同步空间。",
    actionLabel: "点击远程资源",
  },
  {
    id: 7,
    view: "files",
    targetKey: "remoteAccessCard",
    title: "远程访问电脑",
    description: "点击这里可以查看电脑中的所有文件和文件夹。",
    actionLabel: "查看电脑文件",
  },
]

export function MobileAppGlobal() {
  const [view, setView] = useState<MobileView>("auth")
  const [connectEntrySource, setConnectEntrySource] = useState<"auth" | "home">("auth")
  const [connected, setConnected] = useState(false)
  const [tunnelEnabled, setTunnelEnabled] = useState(true)
  const [autoUpload, setAutoUpload] = useState(false)
  const [autoUploadRange, setAutoUploadRange] = useState<"all" | "now" | "custom">("all")
  const [deviceName, setDeviceName] = useState("iPhone 15 Pro")
  const [lastSync, setLastSync] = useState<{ count: number; size: string; time: string | null }>({ count: 0, size: "0 MB", time: null })
  const [isTransferring, setIsTransferring] = useState(autoUpload)
  const [showOnboardingGuide, setShowOnboardingGuide] = useState(false)
  const [onboardingStep, setOnboardingStep] = useState(0)
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState(false)
  const connectDevicesRef = useRef<HTMLDivElement | null>(null)
  const autoUploadButtonRef = useRef<HTMLButtonElement | null>(null)
  const uploadSourcesRef = useRef<HTMLDivElement | null>(null)
  const uploadRangeRef = useRef<HTMLDivElement | null>(null)
  const confirmUploadRef = useRef<HTMLButtonElement | null>(null)
  const uploadStatusRef = useRef<HTMLDivElement | null>(null)
  const remoteResourcesTabRef = useRef<HTMLButtonElement | null>(null)
  const remoteAccessCardRef = useRef<HTMLButtonElement | null>(null)
  const appFrameRef = useRef<HTMLDivElement | null>(null)
  const tunnelUrl = "vividrop.io/s/a8x2k9"
  const onboardingTargets = useMemo<Record<MobileOnboardingTargetKey, RefObject<HTMLElement | null>>>(
    () => ({
      connectDevices: connectDevicesRef,
      autoUploadButton: autoUploadButtonRef,
      uploadSources: uploadSourcesRef,
      uploadRange: uploadRangeRef,
      confirmUpload: confirmUploadRef,
      uploadStatus: uploadStatusRef,
      remoteResourcesTab: remoteResourcesTabRef,
      remoteAccessCard: remoteAccessCardRef,
    }),
    []
  )

  const toggleAutoUpload = () => {
    setAutoUpload((prev) => {
      const next = !prev
      if (next) setView("home")
      return next
    })
  }

  const selectUploadRange = (range: "all" | "now" | "custom") => {
    setAutoUploadRange(range)
  }

  const confirmAutoUpload = () => {
    setAutoUpload(true)
    setIsTransferring(true)
    setView("home")
    if (showOnboardingGuide && onboardingStep === 4) setOnboardingStep(5)
    // simulate a transfer and record last sync when done
    setTimeout(() => {
      setIsTransferring(false)
      setLastSync({ count: 12, size: "34.2 MB", time: new Date().toLocaleString() })
    }, 3000)
  }

  const disableAutoUpload = () => {
    setAutoUpload(false)
    setIsTransferring(false)
    setView("home")
  }

  useEffect(() => {
    if (autoUpload) setIsTransferring(true)
  }, [autoUpload])

  useEffect(() => {
    const seen = window.localStorage.getItem(MOBILE_ONBOARDING_STORAGE_KEY) === "true"
    setHasSeenOnboarding(seen)
  }, [])

  const startOnboarding = () => {
    if (hasSeenOnboarding) return
    setShowOnboardingGuide(true)
    setOnboardingStep(0)
  }

  const dismissOnboarding = () => {
    window.localStorage.setItem(MOBILE_ONBOARDING_STORAGE_KEY, "true")
    setHasSeenOnboarding(true)
    setShowOnboardingGuide(false)
  }

  const handleOnboardingNext = () => {
    const step = MOBILE_ONBOARDING_STEPS[onboardingStep]
    const nextStep = Math.min(onboardingStep + 1, MOBILE_ONBOARDING_STEPS.length - 1)

    if (step.id === 0) {
      setConnected(true)
      setOnboardingStep(nextStep)
      setView("home")
      return
    }

    if (step.id === 1) {
      setOnboardingStep(nextStep)
      setView("autoUploadSettings")
      return
    }

    if (step.id === 4) {
      confirmAutoUpload()
      return
    }

    if (step.id === 6) {
      setOnboardingStep(nextStep)
      setView("files")
      return
    }

    if (step.id === 7) {
      setView("remoteAccess")
      dismissOnboarding()
      return
    }

    if (step.id === MOBILE_ONBOARDING_STEPS.length - 1) {
      dismissOnboarding()
      return
    }

    setOnboardingStep(nextStep)
  }

  const handleOnboardingTargetMissing = () => {
    if (!showOnboardingGuide) return
    setOnboardingStep((step) => {
      if (step >= MOBILE_ONBOARDING_STEPS.length - 1) return step
      return step + 1
    })
  }

  // Initialize lastSync from mock history for this device if available
  useEffect(() => {
    if (lastSync.count === 0) {
      for (const day of mockHistoryDays) {
        const found = day.sessions.find((s) => s.deviceName === deviceName)
        if (found) {
          setLastSync({ count: found.fileCount, size: found.totalSize, time: `${day.date} ${found.lastSyncTime}` })
          break
        }
      }
    }
  }, [deviceName])

  return (
    <div ref={appFrameRef} className="relative flex h-full flex-col overflow-hidden" style={{ backgroundColor: MOBILE_PAGE_BACKGROUND }}>
      {/* Content */}
      <div className="flex-1 overflow-auto">
        {view === "auth" && (
          <AuthView
            onContinue={() => {
              setConnectEntrySource("auth")
              setView("connectDesktop")
              startOnboarding()
            }}
          />
        )}
        {view === "connectDesktop" && (
          <FirstConnectView
            onBack={() => setView(connectEntrySource === "auth" ? "auth" : "home")}
            onConnected={() => {
              setConnected(true)
              setView("home")
            }}
            connectDevicesRef={connectDevicesRef}
          />
        )}
        {view === "history" && (
          <HistoryView onBack={() => setView("home")} />
        )}
        {view === "recentDownloads" && (
          <RecentDownloadsView onBack={() => setView("home")} />
        )}
        {view === "home" && (
          <HomeView 
            connected={connected} 
            tunnelEnabled={tunnelEnabled}
            tunnelUrl={tunnelUrl}
            autoUpload={autoUpload}
            autoUploadRange={autoUploadRange}
            isTransferring={isTransferring}
            setIsTransferring={setIsTransferring}
            lastSync={lastSync}
            onNavigateAutoUpload={() => setView("autoUploadSettings")}
            onDisableAutoUpload={disableAutoUpload}
            onNavigateHelp={() => setView("helpCenter")}
            onNavigateRecentDownloads={() => setView("recentDownloads")}
            onQuickConnect={() => {
              setConnectEntrySource("home")
              setView("connectDesktop")
            }}
            autoUploadButtonRef={autoUploadButtonRef}
            uploadStatusRef={uploadStatusRef}
          />
        )}
        {view === "settings" && (
          <SettingsView 
            deviceName={deviceName}
            onDeviceNameChange={setDeviceName}
            onNavigateGiftCard={() => setView("giftCard")}
            onNavigateMembership={() => setView("membership")}
            onNavigateLanguage={() => setView("language")}
            onNavigateHelp={() => setView("helpCenter")}
            onBack={() => setView("home")}
          />
        )}
        {view === "language" && (
          <LanguageView
            onBack={() => setView("settings")}
          />
        )}
        {view === "autoUploadSettings" && (
          <AutoUploadSettingsView
            autoUpload={autoUpload}
            autoUploadRange={autoUploadRange}
            onConfirmAutoUpload={confirmAutoUpload}
            onSelectRange={selectUploadRange}
            onBack={() => setView("home")}
            uploadSourcesRef={uploadSourcesRef}
            uploadRangeRef={uploadRangeRef}
            confirmUploadRef={confirmUploadRef}
          />
        )}
        {view === "giftCard" && (
          <GiftCardView onBack={() => setView("settings")} />
        )}
        {view === "helpCenter" && (
          <HelpCenterView onBack={() => setView("settings")} />
        )}
        {view === "membership" && (
          <MembershipView
            onBack={() => setView("settings")}
            onNavigateGiftCard={() => setView("giftCard")}
          />
        )}
        {view === "files" && (
          <RemoteResourcesView
            onOpenPhoneSync={() => setView("phoneSyncSpace")}
            onOpenRemoteAccess={() => setView("remoteAccess")}
            remoteAccessCardRef={remoteAccessCardRef}
          />
        )}
        {view === "phoneSyncSpace" && (
          <PhoneSyncSpaceView onBack={() => setView("files")} />
        )}
        {view === "remoteAccess" && (
          <FilesView onBack={() => setView("files")} />
        )}
      </div>

      {showOnboardingGuide ? (
        <MobileOnboardingGuide
          currentView={view}
          step={MOBILE_ONBOARDING_STEPS[onboardingStep]}
          stepIndex={onboardingStep}
          totalSteps={MOBILE_ONBOARDING_STEPS.length}
          targets={onboardingTargets}
          frameRef={appFrameRef}
          onNext={handleOnboardingNext}
          onSkip={dismissOnboarding}
          onTargetMissing={handleOnboardingTargetMissing}
        />
      ) : null}

      {/* Bottom Nav */}
      {view !== "auth" && view !== "connectDesktop" ? (
        <nav
          className="flex items-center justify-around border-t px-4 py-3 pb-8"
          style={{ backgroundColor: MOBILE_PAGE_BACKGROUND, borderColor: "rgba(56, 92, 128, 0.12)" }}
        >
          {[
            { id: "home" as const, icon: Home, label: "首页" },
            { id: "files" as const, icon: Monitor, label: "远程资源" },
            { id: "settings" as const, icon: User, label: "我的" },
          ].map((item) => {
            const Icon = item.icon
            const isActive =
            view === item.id ||
            (item.id === "home" && view === "autoUploadSettings") ||
            (item.id === "settings" && (view === "giftCard" || view === "helpCenter" || view === "membership" || view === "language")) ||
            (item.id === "home" && (view === "history" || view === "recentDownloads")) ||
            (item.id === "files" && (view === "phoneSyncSpace" || view === "remoteAccess"))
            return (
              <button
                key={item.id}
                ref={item.id === "files" ? remoteResourcesTabRef : undefined}
                onClick={() => {
                  if (item.id === "files") {
                    setView("files")
                  } else {
                    setView(item.id)
                  }
                }}
                className={`flex flex-col items-center gap-1 transition-colors ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-medium">{item.label}</span>
              </button>
            )
          })}
        </nav>
      ) : null}
    </div>
  )
}

function MobileOnboardingGuide({
  currentView,
  step,
  stepIndex,
  totalSteps,
  targets,
  frameRef,
  onNext,
  onSkip,
  onTargetMissing,
}: {
  currentView: MobileView
  step: MobileOnboardingStep
  stepIndex: number
  totalSteps: number
  targets: Record<MobileOnboardingTargetKey, RefObject<HTMLElement | null>>
  frameRef: RefObject<HTMLDivElement | null>
  onNext: () => void
  onSkip: () => void
  onTargetMissing: () => void
}) {
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const [frameSize, setFrameSize] = useState({ width: 375, height: 812 })

  useEffect(() => {
    if (currentView !== step.view) {
      setRect(null)
      return
    }

    let frame = 0
    let attempts = 0

    const measure = () => {
      const frameElement = frameRef.current
      const target = targets[step.targetKey]?.current
      const frameRect = frameElement?.getBoundingClientRect()
      const targetRect = target?.getBoundingClientRect()

      if (frameRect && targetRect && targetRect.width > 0 && targetRect.height > 0) {
        setFrameSize({ width: frameRect.width, height: frameRect.height })
        setRect({
          left: targetRect.left - frameRect.left,
          top: targetRect.top - frameRect.top,
          width: targetRect.width,
          height: targetRect.height,
        })
        return
      }

      if (attempts < 12) {
        attempts += 1
        frame = window.requestAnimationFrame(measure)
      } else {
        setRect(null)
        onTargetMissing()
      }
    }

    frame = window.requestAnimationFrame(measure)
    window.addEventListener("resize", measure)
    window.addEventListener("scroll", measure, true)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener("resize", measure)
      window.removeEventListener("scroll", measure, true)
    }
  }, [currentView, step, targets, frameRef, onTargetMissing])

  if (currentView !== step.view || !rect) return null

  const padding = 10
  const spot = {
    left: Math.max(rect.left - padding, 8),
    top: Math.max(rect.top - padding, 8),
    width: Math.min(rect.width + padding * 2, frameSize.width - 16),
    height: rect.height + padding * 2,
  }
  const tipTop = spot.top + spot.height + 14
  const shouldPlaceAbove = tipTop > frameSize.height - 190
  const cardTop = shouldPlaceAbove ? Math.max(20, spot.top - 178) : tipTop

  return (
    <div className="absolute inset-0 z-[80] overflow-hidden" style={{ pointerEvents: "auto" }}>
      <svg className="absolute inset-0 h-full w-full">
        <defs>
          <mask id="mobile-onboarding-spotlight">
            <rect width="100%" height="100%" fill="white" />
            <rect
              x={spot.left}
              y={spot.top}
              width={spot.width}
              height={spot.height}
              rx="18"
              ry="18"
              fill="black"
            />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(14, 31, 52, 0.36)" mask="url(#mobile-onboarding-spotlight)" />
        <rect
          x={spot.left - 2}
          y={spot.top - 2}
          width={spot.width + 4}
          height={spot.height + 4}
          rx="20"
          ry="20"
          fill="none"
          stroke="rgba(255,255,255,0.48)"
          strokeWidth="1.5"
        />
      </svg>

      <div
        className="absolute left-4 right-4 rounded-[24px] border border-white/35 bg-white/78 px-5 py-4 shadow-[0_18px_50px_rgba(0,0,0,0.14)] backdrop-blur-xl"
        style={{ top: cardTop }}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {MOBILE_ONBOARDING_STEPS.map((item, index) => (
              <span
                key={item.id}
                className="h-1.5 rounded-full transition-all"
                style={{
                  width: index === stepIndex ? 20 : 6,
                  background: index === stepIndex ? "#357CFF" : "#C9DAEE",
                }}
              />
            ))}
          </div>
          <span className="text-[11px] font-medium text-[#7D97B5]">
            {stepIndex + 1}/{totalSteps}
          </span>
        </div>

        <p className="text-[17px] font-semibold text-[#1C365A]">{step.title}</p>
        <p className="mt-2 text-[13px] leading-6 text-[#6E8CAD]">{step.description}</p>

        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={onSkip}
            className="rounded-full px-2 py-2 text-[13px] font-medium text-[#8DA5BF] transition-opacity active:opacity-60"
          >
            跳过引导
          </button>
          <button
            onClick={onNext}
            className="rounded-full bg-[#357CFF] px-5 py-2.5 text-[14px] font-semibold text-white shadow-sm transition-transform active:scale-[0.98]"
          >
            {step.actionLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function AuthView({ onContinue }: { onContinue: () => void }) {
  const [authProvider, setAuthProvider] = useState<"google" | "apple" | null>(null)
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [pendingProvider, setPendingProvider] = useState<"google" | "apple" | null>(null)

  const beginProviderLogin = (provider: "google" | "apple") => {
    if (!agreedToTerms) {
      setPendingProvider(provider)
      return
    }
    setAuthProvider(provider)
  }

  return (
    <div className="relative min-h-full overflow-hidden" style={{ backgroundColor: MOBILE_PAGE_BACKGROUND }}>
      <div className="min-h-[34%]" />
      <div className="min-h-[66%] bg-white/78" />

      <div className="absolute inset-0 px-6 pb-8 pt-12">
        <div className="flex min-h-full flex-col items-center">
          <div className="mt-[54px] flex h-[88px] w-[88px] items-center justify-center">
            <img src="/assets/vividrop-logo.png" alt="Vivi Drop logo" className="h-[82px] w-[82px] object-contain opacity-72" />
          </div>

          <h1 className="mt-4 text-[28px] font-semibold tracking-[-0.04em] text-[#1C2D45]">Vivi Drop</h1>
          <p className="mt-2 text-center text-[12px] leading-6 text-[#6889AE]">
            Connect your desktop and keep media in sync.
          </p>

          <div className="mt-[28px] w-full rounded-[28px] bg-white px-5 pb-6 pt-7 shadow-[0_18px_50px_rgba(121,151,194,0.10)]">
            <h2 className="text-center text-[22px] font-semibold tracking-[-0.04em] text-[#1C2D45]">Log in or sign up</h2>

            <div className="mt-6 space-y-3.5">
              <button
                onClick={() => beginProviderLogin("google")}
                className="flex h-[48px] w-full items-center justify-center gap-4 rounded-full border-[1.5px] border-[#DFE9F8] bg-white px-5 text-[14px] font-semibold text-[#1F324D]"
              >
                <span className="text-[18px] font-bold text-[#4285F4]">G</span>
                <span>Continue with Google</span>
              </button>

              <button
                onClick={() => beginProviderLogin("apple")}
                className="flex h-[48px] w-full items-center justify-center gap-4 rounded-full border-[1.5px] border-[#DFE9F8] bg-white px-5 text-[14px] font-semibold text-[#1F324D]"
              >
                <span className="text-[19px] font-semibold text-[#1C2D45]"></span>
                <span>Continue with Apple</span>
              </button>
            </div>

            <div className="mt-8 flex items-start gap-2">
              <button
                onClick={() => setAgreedToTerms((prev) => !prev)}
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                  agreedToTerms ? "border-[#357CFF] bg-[#357CFF]" : "border-[#B9C8DA] bg-white"
                }`}
                aria-label="Agree to terms"
              >
                {agreedToTerms ? <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} /> : null}
              </button>
              <p className="text-left text-[10px] leading-5 text-[#9AAECC]">
                By continuing, you agree to our{" "}
                <span className="font-semibold text-[#4E87FF]">Terms of Service</span>
                <br />
                and <span className="font-semibold text-[#4E87FF]">Privacy Policy</span>.
              </p>
            </div>
          </div>
        </div>
      </div>

      {authProvider && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: "rgba(0,0,0,0.35)" }}
          onClick={() => setAuthProvider(null)}
        >
          <div
            className="w-full max-w-[320px] overflow-hidden rounded-[28px] bg-white shadow-[0_22px_60px_rgba(0,0,0,0.18)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 pb-6 pt-7">
              <div className="mb-5 flex items-center gap-3">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-full ${
                    authProvider === "google" ? "bg-[#EEF4FF]" : "bg-[#F4F5F7]"
                  }`}
                >
                  <span
                    className={`text-[20px] font-semibold ${
                      authProvider === "google" ? "text-[#4285F4]" : "text-[#1C2D45]"
                    }`}
                  >
                    {authProvider === "google" ? "G" : ""}
                  </span>
                </div>
                <div>
                  <p className="text-[17px] font-semibold text-[#1F324D]">
                    {authProvider === "google" ? "Google 授权登录" : "Apple 授权登录"}
                  </p>
                  <p className="text-[12px] text-[#8CA0B8]">
                    {authProvider === "google"
                      ? "将跳转到 Google 完成账号授权登录。"
                      : "将跳转到 Apple 完成账号授权登录。"}
                  </p>
                </div>
              </div>

              <div className="rounded-[22px] border border-[#DCE7F6] bg-[#F8FBFF] px-4 py-4">
                <p className="text-[13px] leading-6 text-[#6E8CAD]">
                  {authProvider === "google"
                    ? "使用 Google 账号安全授权，无需手动输入账号和密码。"
                    : "使用 Apple ID 安全授权，无需手动输入账号和密码。"}
                </p>
              </div>

              <button
                onClick={() => {
                  setAuthProvider(null)
                  onContinue()
                }}
                className="mt-5 w-full rounded-full bg-[#357CFF] py-3 text-[15px] font-semibold text-white"
              >
                继续授权
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingProvider && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: "rgba(0,0,0,0.35)" }}
          onClick={() => setPendingProvider(null)}
        >
          <div
            className="w-full max-w-[320px] overflow-hidden rounded-[24px] bg-white shadow-[0_22px_60px_rgba(0,0,0,0.18)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 pb-5 pt-6 text-center">
              <p className="text-[17px] font-semibold text-[#1F324D]">同意服务协议</p>
              <p className="mt-2 text-[13px] leading-5 text-[#8CA0B8]">
                登录前请先同意 Terms of Service 和 Privacy Policy。
              </p>
            </div>
            <div className="flex border-t border-gray-200">
              <button
                onClick={() => setPendingProvider(null)}
                className="flex-1 border-r border-gray-200 py-3 text-[15px] font-medium text-blue-500"
              >
                取消
              </button>
              <button
                onClick={() => {
                  const provider = pendingProvider
                  setAgreedToTerms(true)
                  setPendingProvider(null)
                  if (provider) {
                    setAuthProvider(provider)
                  }
                }}
                className="flex-1 py-3 text-[15px] font-semibold text-blue-500"
              >
                同意并继续
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FirstConnectView({
  onBack,
  onConnected,
  connectDevicesRef,
}: {
  onBack: () => void
  onConnected: () => void
  connectDevicesRef: RefObject<HTMLDivElement | null>
}) {
  const [isScanningLan, setIsScanningLan] = useState(true)
  const [lanDevices, setLanDevices] = useState<LanDesktopDevice[]>([])
  const [selectedDevice, setSelectedDevice] = useState<LanDesktopDevice | null>(null)
  const [showMethodModal, setShowMethodModal] = useState(false)
  const [showCodeModal, setShowCodeModal] = useState(false)
  const [showManualPairModal, setShowManualPairModal] = useState(false)
  const [showCameraPermissionModal, setShowCameraPermissionModal] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [cameraError, setCameraError] = useState("")
  const [connectionCode, setConnectionCode] = useState("")
  const [manualIp, setManualIp] = useState("")
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  useEffect(() => {
    return () => stopCamera()
  }, [])

  useEffect(() => {
    setIsScanningLan(true)
    const timer = window.setTimeout(() => {
      setLanDevices(MOCK_LAN_DEVICES)
      setIsScanningLan(false)
    }, 900)

    return () => window.clearTimeout(timer)
  }, [])

  const requestCameraAndStartScanner = async () => {
    try {
      setCameraError("")
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      })
      streamRef.current = stream
      setShowScanner(true)
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          void videoRef.current.play()
        }
      })
    } catch {
      setCameraError("需要相机访问权限后才可扫码连接。")
    }
  }

  const continueManualPairing = () => {
    const ip = manualIp.trim()
    if (!ip) return

    setSelectedDevice({
      id: `manual-${ip}`,
      name: "手动配对设备",
      type: "desktop",
      ip,
      status: "available",
    })
    setManualIp("")
    setConnectionCode("")
    setShowManualPairModal(false)
    setShowCodeModal(true)
  }

  return (
    <div className="min-h-full px-6 pb-10 pt-14" style={{ backgroundColor: MOBILE_PAGE_BACKGROUND }}>
      <button
        onClick={onBack}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-white/60"
      >
        <ChevronLeft className="h-5 w-5 text-[#20344F]" />
      </button>

      <div className="mt-7">
        <h1 className="text-[25px] font-semibold tracking-[-0.04em] text-[#1D2F47]">连接你的电脑</h1>
        <p className="mt-2.5 text-[13px] leading-6 text-[#6B89A7]">
          先扫描同一局域网下的电脑设备，再选择扫码连接或输入连接码。
        </p>
      </div>

      <div ref={connectDevicesRef} className="mt-7 rounded-[24px] bg-white/78 px-4 py-4">
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-semibold text-[#20344F]">同一局域网下的电脑设备</p>
          <span className="text-[10px] text-[#7D97B5]">{isScanningLan ? "扫描中..." : `已发现 ${lanDevices.length} 台`}</span>
        </div>

        {isScanningLan ? (
          <div className="mt-4 space-y-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-[66px] animate-pulse rounded-[18px] bg-[#EDF4FB]" />
            ))}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {lanDevices.map((device) => {
              const DeviceIcon = device.type === "laptop" ? Laptop : Monitor
              return (
                <button
                  key={device.id}
                  onClick={() => {
                    setSelectedDevice(device)
                    setConnectionCode("")
                    setShowMethodModal(true)
                  }}
                  className="flex w-full items-center gap-3.5 rounded-[20px] bg-white px-4 py-4 text-left shadow-[0_10px_24px_rgba(121,151,194,0.10)]"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#E8F1FC]">
                    <DeviceIcon className="h-6 w-6 text-[#498FE0]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-[#20344F]">{device.name}</p>
                    <p className="mt-1 text-[10px] leading-5 text-[#7D97B5]">{device.ip}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-1 text-[10px] font-medium ${
                        device.status === "available" ? "bg-[#E8F7ED] text-[#21A453]" : "bg-[#FFF3E8] text-[#D7832F]"
                      }`}
                    >
                      {device.status === "available" ? "可连接" : "使用中"}
                    </span>
                    <ChevronRight className="h-4.5 w-4.5 text-[#A1B6CF]" />
                  </div>
                </button>
              )
            })}
            <button
              onClick={() => {
                setManualIp("")
                setConnectionCode("")
                setShowManualPairModal(true)
              }}
              className="flex w-full items-center gap-3.5 rounded-[20px] border border-dashed border-[#B7CAE3] bg-[#F7FBFF] px-4 py-4 text-left"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#E9F4FF]">
                <Link2 className="h-5.5 w-5.5 text-[#498FE0]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold text-[#20344F]">手动配对</p>
                <p className="mt-1 text-[10px] leading-5 text-[#7D97B5]">未显示设备时，输入电脑 IP 和连接码连接</p>
              </div>
              <ChevronRight className="h-4.5 w-4.5 text-[#A1B6CF]" />
            </button>
          </div>
        )}
      </div>

      <div className="mt-7 rounded-[24px] bg-white/78 px-4 py-4">
        <p className="text-[12px] font-semibold text-[#20344F]">电脑端还没有准备好？</p>
        <p className="mt-2 text-[9px] leading-5 text-[#7D97B5]">
          请先在官网 Vividrop.cn 下载并打开客户端，然后返回此页面扫码或输入连接码进行连接。
        </p>
      </div>

      {cameraError ? (
        <div className="mt-4 rounded-[18px] bg-white/80 px-4 py-3 text-[11px] text-[#D14C4C] shadow-sm">
          {cameraError}
        </div>
      ) : null}

      {showMethodModal && selectedDevice ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: "rgba(0,0,0,0.35)" }}
          onClick={() => setShowMethodModal(false)}
        >
          <div
            className="w-full max-w-[300px] overflow-hidden rounded-2xl bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5">
              <p className="text-[16px] font-semibold text-center text-[#20344F]">选择连接方式</p>
              <p className="mt-2 text-center text-[13px] leading-5 text-[#7D97B5]">
                已选择 {selectedDevice.name}
              </p>
              <div className="mt-4 space-y-3">
                <button
                  onClick={() => {
                    setShowMethodModal(false)
                    setShowCameraPermissionModal(true)
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl border border-gray-100 bg-slate-50 px-4 py-4 text-left"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
                    <QrCode className="h-5 w-5 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-foreground">扫码连接</p>
                    <p className="text-[11px] text-muted-foreground">扫描 {selectedDevice.name} 上显示的二维码</p>
                  </div>
                </button>
                <button
                  onClick={() => {
                    setShowMethodModal(false)
                    setShowCodeModal(true)
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl border border-gray-100 bg-slate-50 px-4 py-4 text-left"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50">
                    <Link2 className="h-5 w-5 text-violet-500" />
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-foreground">输入连接码</p>
                    <p className="text-[11px] text-muted-foreground">输入 {selectedDevice.name} 显示的连接码</p>
                  </div>
                </button>
              </div>
            </div>
            <div className="border-t border-gray-200">
              <button
                onClick={() => setShowMethodModal(false)}
                className="w-full py-3 text-[15px] font-medium text-blue-500"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showManualPairModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: "rgba(0,0,0,0.28)" }}
          onClick={() => setShowManualPairModal(false)}
        >
          <div
            className="w-full max-w-[300px] overflow-hidden rounded-2xl bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5">
              <p className="text-center text-[16px] font-semibold text-[#20344F]">手动配对</p>
              <p className="mt-2 text-center text-[13px] leading-5 text-[#7D97B5]">
                设备未显示时，可输入电脑端显示的 IP 地址继续连接。
              </p>
              <input
                type="text"
                value={manualIp}
                onChange={(e) => setManualIp(e.target.value)}
                placeholder="192.168.31.21"
                inputMode="decimal"
                className="mt-4 w-full rounded-xl border border-[#DCE7F6] bg-[#F7FAFE] px-4 py-3 text-[15px] outline-none"
                autoFocus
              />
              <p className="mt-3 text-[11px] leading-5 text-[#7D97B5]">
                在电脑端 Vivi Drop 的全局设置中查看 IP 和 6 位连接码。
              </p>
            </div>
            <div className="flex border-t border-gray-200">
              <button
                onClick={() => setShowManualPairModal(false)}
                className="flex-1 border-r border-gray-200 py-3 text-[15px] font-medium text-blue-500"
              >
                取消
              </button>
              <button
                onClick={continueManualPairing}
                disabled={!manualIp.trim()}
                className="flex-1 py-3 text-[15px] font-semibold text-blue-500 disabled:text-gray-300"
              >
                下一步
              </button>
            </div>
          </div>
        </div>
      )}

      {showCameraPermissionModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: "rgba(0,0,0,0.35)" }}
          onClick={() => setShowCameraPermissionModal(false)}
        >
          <div
            className="w-full max-w-[300px] overflow-hidden rounded-2xl bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 text-center">
              <p className="text-[16px] font-semibold text-[#20344F]">允许相机访问</p>
              <p className="mt-2 text-[13px] leading-5 text-[#7D97B5]">
                扫码连接需要获取相机使用权限，是否允许打开相机？
              </p>
            </div>
            <div className="flex border-t border-gray-200">
              <button
                onClick={() => setShowCameraPermissionModal(false)}
                className="flex-1 border-r border-gray-200 py-3 text-[15px] font-medium text-blue-500"
              >
                不允许
              </button>
              <button
                onClick={async () => {
                  setShowCameraPermissionModal(false)
                  await requestCameraAndStartScanner()
                }}
                className="flex-1 py-3 text-[15px] font-semibold text-blue-500"
              >
                允许
              </button>
            </div>
          </div>
        </div>
      )}

      {showCodeModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: "rgba(0,0,0,0.28)" }}
          onClick={() => setShowCodeModal(false)}
        >
          <div
            className="w-full max-w-[300px] overflow-hidden rounded-2xl bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5">
              <p className="text-center text-[16px] font-semibold text-[#20344F]">输入连接码</p>
              <p className="mt-2 text-center text-[13px] leading-5 text-[#7D97B5]">
                输入 {selectedDevice?.name ?? "电脑端"} 显示的连接码以完成连接。
              </p>
              <input
                type="text"
                value={connectionCode}
                onChange={(e) => setConnectionCode(e.target.value.toUpperCase())}
                placeholder="输入连接码"
                className="mt-4 w-full rounded-xl border border-[#DCE7F6] bg-[#F7FAFE] px-4 py-3 text-[15px] outline-none"
              />
            </div>
            <div className="flex border-t border-gray-200">
              <button
                onClick={() => setShowCodeModal(false)}
                className="flex-1 border-r border-gray-200 py-3 text-[15px] font-medium text-blue-500"
              >
                取消
              </button>
              <button
                onClick={() => {
                  setShowCodeModal(false)
                  onConnected()
                }}
                className="flex-1 py-3 text-[15px] font-semibold text-blue-500"
              >
                连接
              </button>
            </div>
          </div>
        </div>
      )}

      {showScanner && (
        <div
          className="fixed inset-0 z-50 flex flex-col"
          style={{ background: "rgba(0,0,0,0.78)" }}
        >
          <div className="flex items-center justify-between px-6 pb-4 pt-14 text-white">
            <button
              onClick={() => {
                stopCamera()
                setShowScanner(false)
              }}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <p className="text-[16px] font-semibold">扫码连接</p>
            <button
              onClick={onConnected}
              className="rounded-full bg-white/10 px-4 py-2 text-[12px] font-medium"
            >
              已扫描
            </button>
          </div>

          <div className="flex flex-1 items-center justify-center px-8">
            <div className="relative w-full max-w-[320px]">
              <div className="aspect-square overflow-hidden rounded-[28px] border border-white/15 bg-black shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
                <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
              </div>
              <div className="pointer-events-none absolute inset-0 rounded-[28px] border-2 border-white/80">
                <div className="absolute left-6 right-6 top-1/2 h-[2px] -translate-y-1/2 bg-[#4FA6EA]" />
                <div className="absolute left-4 top-4 h-8 w-8 border-l-4 border-t-4 border-white" />
                <div className="absolute right-4 top-4 h-8 w-8 border-r-4 border-t-4 border-white" />
                <div className="absolute bottom-4 left-4 h-8 w-8 border-b-4 border-l-4 border-white" />
                <div className="absolute bottom-4 right-4 h-8 w-8 border-b-4 border-r-4 border-white" />
              </div>
            </div>
          </div>

          <div className="px-8 pb-10 text-center text-[13px] leading-6 text-white/80">
            请将电脑端显示的二维码放入相框内
          </div>
        </div>
      )}
    </div>
  )
}

function HistoryView({ onBack }: { onBack: () => void }) {
  const sessionDurations: Record<string, string> = {
    s1: "34m 14s",
    s2: "9m 18s",
    s3: "1h 12m",
    s4: "48m 05s",
    s5: "16m 27s",
    s6: "57m 40s",
  }

  const formatDayLabel = (date: string, index: number) => {
    if (index === 0) return "今天"
    if (index === 1) return "昨天"
    const [year, month, day] = date.split("-")
    return `${year}/${month}/${day}`
  }

  return (
    <div className="min-h-full px-5 pb-10 pt-14" style={{ backgroundColor: MOBILE_PAGE_BACKGROUND }}>
      <div className="mb-6 flex items-center gap-4">
        <button
          onClick={onBack}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/70 shadow-sm"
        >
          <ChevronLeft className="h-6 w-6 text-[#233F64]" />
        </button>
        <h1 className="text-[14px] font-semibold tracking-[-0.03em] text-[#203D63]">历史记录</h1>
      </div>

      <div className="space-y-4">
        {mockHistoryDays.map((day, dayIndex) => (
          <section key={day.date}>
            <div className="mb-2.5 flex items-center gap-1.5">
              <h2 className="text-[10px] font-semibold text-[#4D6C90]">{formatDayLabel(day.date, dayIndex)}</h2>
              {dayIndex === 0 ? (
                <div className="flex items-center gap-1">
                  <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#D6EAFB]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#4E9CE0]" />
                  </span>
                  <span className="text-[9px] font-medium text-[#A0BAD4]">实时同步中</span>
                </div>
              ) : null}
            </div>

            {day.sessions.length === 0 ? (
              <div className="rounded-[13px] bg-white/75 px-3 py-3 text-[8px] text-[#9CB1C8] shadow-sm">
                当天暂无传输记录
              </div>
            ) : (
              <div className="space-y-2.5">
                {day.sessions.map((session) => (
                  <article key={session.id} className="rounded-[15px] bg-white px-3 py-3 shadow-sm">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-[38px] w-[38px] items-center justify-center rounded-[12px] bg-[#5AA2DD]">
                        <Monitor className="h-4.5 w-4.5 text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[8px] font-semibold tracking-[-0.03em] text-[#203D63]">{session.deviceName}</p>
                        <p className="mt-0.5 text-[7.5px] text-[#A0B7CE]">{session.deviceIp}</p>
                      </div>
                    </div>

                    <div className="my-3 h-px bg-[#E3EDF7]" />

                    <div className="flex items-end justify-between gap-2">
                      <div>
                        <p className="text-[7.5px] font-medium text-[#B0C2D5]">已同步媒体文件</p>
                        <p className="mt-1 text-[9.5px] font-semibold text-[#203D63]">
                          <span className="text-[#4A99DE]">{session.fileCount} 个</span>
                          <span className="mx-1 text-[#C1D1E0]">·</span>
                          <span>{session.totalSize}</span>
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[7.5px] font-medium text-[#B0C2D5]">耗时</p>
                        <p className="mt-1 text-[9.5px] font-semibold text-[#4A99DE]">
                          {sessionDurations[session.id] ?? "22m 10s"}
                        </p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}

function RecentDownloadsView({ onBack }: { onBack: () => void }) {
  const renderPreview = (preview: "photo" | "video" | "file") => {
    if (preview === "photo") {
      return <div className="h-full w-full bg-[linear-gradient(135deg,#D9EEFF_0%,#8EC8FF_100%)]" />
    }
    if (preview === "video") {
      return (
        <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,#D9E4FF_0%,#889DFF_100%)]">
          <Play className="h-4 w-4 text-white fill-white" />
        </div>
      )
    }
    return (
      <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,#F1F5FB_0%,#D6E1F2_100%)]">
        <File className="h-4 w-4 text-[#5A7DA3]" />
      </div>
    )
  }

  return (
    <div className="min-h-full px-5 pb-10 pt-14" style={{ backgroundColor: MOBILE_PAGE_BACKGROUND }}>
      <div className="mb-6 flex items-center gap-4">
        <button
          onClick={onBack}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/70 shadow-sm"
        >
          <ChevronLeft className="h-6 w-6 text-[#233F64]" />
        </button>
        <h1 className="text-[18px] font-semibold tracking-[-0.03em] text-[#203D63]">最近下载</h1>
      </div>

      <div className="space-y-3">
        {RECENT_DOWNLOADS.map((item) => (
          <article key={item.id} className="flex items-center gap-3 rounded-[18px] bg-white px-4 py-4 shadow-sm">
            <div className="h-[58px] w-[58px] shrink-0 overflow-hidden rounded-[14px] bg-[#EDF4FB]">
              {renderPreview(item.preview)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-[#203D63]">{item.name}</p>
              <p className="mt-1 text-[11px] text-[#7D97B5]">{item.type} · {item.size}</p>
              <p className="mt-1 text-[10px] text-[#9EB2C8]">{item.time}</p>
            </div>
            <button className="flex h-8 w-8 items-center justify-center rounded-full bg-[#EEF5FD]">
              <Download className="h-4 w-4 text-[#4C92E2]" />
            </button>
          </article>
        ))}
      </div>
    </div>
  )
}

function RemoteResourcesView({
  onOpenPhoneSync,
  onOpenRemoteAccess,
  remoteAccessCardRef,
}: {
  onOpenPhoneSync: () => void
  onOpenRemoteAccess: () => void
  remoteAccessCardRef?: RefObject<HTMLButtonElement | null>
}) {
  return (
    <div className="min-h-full px-5 pb-10 pt-14" style={{ backgroundColor: MOBILE_PAGE_BACKGROUND }}>
      <div className="mb-6 flex items-center">
        <h1 className="text-[24px] font-semibold tracking-[-0.03em] text-[#203D63]">远程资源</h1>
      </div>

      <div className="space-y-4">
        <button
          onClick={onOpenPhoneSync}
          className="w-full rounded-[22px] bg-white px-4 py-5 text-left shadow-[0_10px_30px_rgba(120,155,195,0.12)]"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-[50px] w-[50px] items-center justify-center rounded-[16px] bg-[#EAF2FF]">
              <Smartphone className="h-6 w-6 text-[#4C92E2]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[17px] font-semibold text-[#203D63]">手机同步空间</p>
              <p className="mt-1 text-[12px] leading-5 text-[#7D97B5]">查看历史所有从手机端同步到电脑端的文件</p>
            </div>
            <ChevronRight className="h-5 w-5 text-[#A1B6CF]" />
          </div>
        </button>

        <button
          ref={remoteAccessCardRef}
          onClick={onOpenRemoteAccess}
          className="w-full rounded-[22px] bg-white px-4 py-5 text-left shadow-[0_10px_30px_rgba(120,155,195,0.12)]"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-[50px] w-[50px] items-center justify-center rounded-[16px] bg-[#EDF5FD]">
              <Monitor className="h-6 w-6 text-[#4A9AD8]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[17px] font-semibold text-[#203D63]">远程访问电脑</p>
              <p className="mt-1 text-[12px] leading-5 text-[#7D97B5]">远程浏览电脑中的所有文件和文件夹</p>
            </div>
            <ChevronRight className="h-5 w-5 text-[#A1B6CF]" />
          </div>
        </button>
      </div>
    </div>
  )
}

function PhoneSyncSpaceView({ onBack }: { onBack: () => void }) {
  type SyncedFile = {
    id: string
    name: string
    type: "照片" | "视频" | "文件"
    size: string
    syncedAt: string
    source: string
    existsOnPhone: boolean
  }

  const [showSortSheet, setShowSortSheet] = useState(false)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [sortBy, setSortBy] = useState<"name" | "time" | "size">("time")
  const [showShareSheet, setShowShareSheet] = useState(false)

  const syncedFiles = [
    { id: "sync-file-1", name: "IMG_8421.JPG", type: "照片", size: "8.6 MB", syncedAt: "2026-03-19 22:51", source: "剪辑工作站-A", existsOnPhone: true },
    { id: "sync-file-2", name: "IMG_8420.JPG", type: "照片", size: "7.9 MB", syncedAt: "2026-03-19 22:49", source: "剪辑工作站-A", existsOnPhone: true },
    { id: "sync-file-3", name: "VID_3018.MP4", type: "视频", size: "1.6 GB", syncedAt: "2026-03-19 22:47", source: "剪辑工作站-A", existsOnPhone: false },
    { id: "sync-file-4", name: "ScreenRecording_0319.mov", type: "视频", size: "2.8 GB", syncedAt: "2026-03-19 21:12", source: "MacBook Pro", existsOnPhone: false },
    { id: "sync-file-5", name: "Contract-Final.pdf", type: "文件", size: "6.2 MB", syncedAt: "2026-03-19 18:35", source: "MacBook Pro", existsOnPhone: true },
    { id: "sync-file-6", name: "IMG_8393.PNG", type: "照片", size: "4.1 MB", syncedAt: "2026-03-18 22:17", source: "剪辑工作站-A", existsOnPhone: true },
    { id: "sync-file-7", name: "ProjectAssets.zip", type: "文件", size: "3.4 GB", syncedAt: "2026-03-18 21:40", source: "剪辑工作站-A", existsOnPhone: false },
    { id: "sync-file-8", name: "VID_2981.MP4", type: "视频", size: "986 MB", syncedAt: "2026-03-17 21:05", source: "剪辑工作站-A", existsOnPhone: true },
  ] as SyncedFile[]

  const sortOptions = [
    { id: "time" as const, label: "时间" },
    { id: "name" as const, label: "名称" },
    { id: "size" as const, label: "文件大小" },
  ]

  const parseSize = (size: string) => {
    const match = size.match(/([\d.]+)\s*(KB|MB|GB)/i)
    if (!match) return 0
    const value = Number(match[1])
    const unit = match[2].toUpperCase()
    if (unit === "GB") return value * 1024 * 1024
    if (unit === "MB") return value * 1024
    return value
  }

  const sortedFiles = [...syncedFiles].sort((a, b) => {
    if (sortBy === "name") return a.name.localeCompare(b.name, "zh-CN")
    if (sortBy === "size") return parseSize(b.size) - parseSize(a.size)
    return b.syncedAt.localeCompare(a.syncedAt)
  })

  const toggleFileSelection = (fileId: string) => {
    setSelectedFiles((prev) => (prev.includes(fileId) ? prev.filter((id) => id !== fileId) : [...prev, fileId]))
  }

  const resetSelection = () => {
    setSelectionMode(false)
    setSelectedFiles([])
  }

  return (
    <div className="relative min-h-full px-5 pb-10 pt-14" style={{ backgroundColor: MOBILE_PAGE_BACKGROUND }}>
      <div className="mb-6 flex items-center justify-between">
        <div className="min-w-0 flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/70 shadow-sm"
          >
            <ChevronLeft className="h-6 w-6 text-[#233F64]" />
          </button>
          <h1 className="truncate text-[18px] font-semibold tracking-[-0.03em] text-[#203D63]">手机同步空间</h1>
        </div>
        <div className="ml-3 flex shrink-0 items-center gap-2 text-[#1F1F1F]">
          <button
            onClick={() => (selectionMode ? resetSelection() : setSelectionMode(true))}
            className="shrink-0 rounded-full px-2.5 py-1.5 text-[11px] font-medium text-[#1F1F1F] transition-colors active:bg-[#F1EFEE]"
          >
            {selectionMode ? "完成" : "选择"}
          </button>
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => setShowSortSheet(true)}
          className="flex items-center gap-1 text-[#1F1F1F]"
        >
          <span className="text-[13px] font-semibold tracking-[-0.02em]">
            {sortOptions.find((option) => option.id === sortBy)?.label}
          </span>
          <span className="text-[13px] font-semibold">↓</span>
        </button>
        {selectionMode ? (
          <div className="flex items-center gap-2">
            <button
              disabled={selectedFiles.length === 0}
              className={`rounded-full px-3 py-1 text-[11px] font-medium ${
                selectedFiles.length > 0 ? "bg-[#0B78F2] text-white" : "bg-[#E5E7EB] text-[#9CA3AF]"
              }`}
            >
              下载
            </button>
            <button
              onClick={() => {
                if (selectedFiles.length > 0) setShowShareSheet(true)
              }}
              disabled={selectedFiles.length === 0}
              className={`rounded-full px-3 py-1 text-[11px] font-medium ${
                selectedFiles.length > 0 ? "bg-[#EEF5FF] text-[#0B78F2]" : "bg-[#E5E7EB] text-[#9CA3AF]"
              }`}
            >
              分享
            </button>
          </div>
        ) : null}
      </div>

      <div className="mx-[-20px] h-px bg-[#E0DEDD]" />
      <div className="divide-y divide-[#E0DEDD]">
        {sortedFiles.map((item) => {
          const isSelected = selectedFiles.includes(item.id)
          return (
          <article key={item.id} className="flex items-center gap-2.5 px-0 py-3">
              <div className="flex h-[44px] w-[44px] shrink-0 items-center justify-center overflow-hidden rounded-[11px] border border-[#D9D9D9] bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
                {item.type === "照片" ? (
                  <FileImage className="h-5 w-5 text-[#4C92E2]" />
                ) : item.type === "视频" ? (
                  <FileVideo className="h-5 w-5 text-[#4C92E2]" />
                ) : (
                  <File className="h-5 w-5 text-[#4C92E2]" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium tracking-[-0.03em] text-[#212121]">{item.name}</p>
                <p className="mt-0.5 text-[11px] leading-[1.35] tracking-[-0.02em] text-[#71665F]">{item.type} · {item.size}</p>
                <p className="mt-0.5 text-[10px] text-[#9AB0C6]">{item.syncedAt}</p>
              </div>
              {selectionMode ? (
                <button
                  onClick={() => toggleFileSelection(item.id)}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                    isSelected ? "border-[#0B78F2] bg-[#0B78F2]" : "border-[#C7C7CC] bg-white"
                  }`}
                >
                  {isSelected ? <Check className="h-3 w-3 text-white" strokeWidth={2.6} /> : null}
                </button>
              ) : (
                <div className="shrink-0 text-right">
                  <p className="text-[10px] font-medium text-[#7D97B5]">{item.source}</p>
                  {!item.existsOnPhone ? (
                    <p className="mt-1 text-[10px] text-[#9AB0C6]">仅电脑端存在</p>
                  ) : null}
                </div>
              )}
          </article>
          )
        })}
      </div>

      {showSortSheet && (
        <>
          <button
            className="absolute inset-0 bg-black/18"
            onClick={() => setShowSortSheet(false)}
            aria-label="Close sort sheet"
          />
          <div className="absolute left-1/2 top-1/2 w-[220px] -translate-x-1/2 -translate-y-1/2 rounded-[22px] bg-white px-4 pb-4 pt-4 shadow-[0_16px_40px_rgba(0,0,0,0.16)]">
            <div className="space-y-1">
              {sortOptions.map((option) => {
                const isActive = sortBy === option.id
                return (
                  <button
                    key={option.id}
                    onClick={() => {
                      setSortBy(option.id)
                      setShowSortSheet(false)
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors active:bg-slate-50"
                  >
                    <span className="flex-1 text-[15px] font-medium tracking-[-0.02em] text-[#1F1F1F]">{option.label}</span>
                    {isActive && <Check className="h-6 w-6 shrink-0 text-[#0B78F2]" strokeWidth={2.4} />}
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}

      {showShareSheet && (
        <>
          <button
            className="absolute inset-0 bg-black/18"
            onClick={() => setShowShareSheet(false)}
            aria-label="Close share sheet"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-[28px] bg-white px-8 pb-10 pt-8 shadow-[0_-12px_40px_rgba(0,0,0,0.12)]">
            <p className="mb-5 text-center text-[18px] font-semibold text-[#1F1F1F]">分享所选文件</p>
            <div className="grid grid-cols-4 gap-4 text-center">
              {["微信", "QQ", "企业微信", "更多"].map((item) => (
                <button key={item} className="flex flex-col items-center gap-2">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#EEF5FF] text-[11px] font-semibold text-[#0B78F2]">
                    {item.slice(0, 2)}
                  </div>
                  <span className="text-[11px] text-[#5E5651]">{item}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// Home View
function HomeView({ 
  connected, 
  tunnelEnabled,
  tunnelUrl,
  autoUpload,
  autoUploadRange,
  isTransferring,
  setIsTransferring,
  lastSync,
  onNavigateAutoUpload,
  onDisableAutoUpload,
  onNavigateHelp,
  onNavigateRecentDownloads,
  onQuickConnect,
  autoUploadButtonRef,
  uploadStatusRef,
}: { 
  connected: boolean
  tunnelEnabled: boolean
  tunnelUrl: string
  autoUpload: boolean
  autoUploadRange: "all" | "now" | "custom"
  isTransferring: boolean
  setIsTransferring: (v: boolean) => void
  lastSync: { count: number; size: string; time: string | null }
  onNavigateAutoUpload: () => void
  onDisableAutoUpload: () => void
  onNavigateHelp: () => void
  onNavigateRecentDownloads: () => void
  onQuickConnect: () => void
  autoUploadButtonRef: RefObject<HTMLButtonElement | null>
  uploadStatusRef: RefObject<HTMLDivElement | null>
}) {
  const [showDisableConfirm, setShowDisableConfirm] = useState(false)
  const [showQuickConnectConfirm, setShowQuickConnectConfirm] = useState(false)
  const currentTransferSpeed = "12.6 MB/s"
  const currentTransferUploaded = 96
  const currentTransferPending = 32
  const currentTransferSize = "2.4 GB / 3.6 GB"
  const currentTransferRemaining = "2 分钟"
  const currentTransferTotal = currentTransferUploaded + currentTransferPending
  const currentTransferPercent = currentTransferTotal > 0 ? (currentTransferUploaded / currentTransferTotal) * 100 : 0
  const syncedStatusText = !autoUpload
    ? "自动同步未开启"
    : isTransferring
    ? `已上传${currentTransferUploaded}/${currentTransferTotal}`
    : `已上传${lastSync.count}/${lastSync.count}`
  const sessionDurations: Record<string, string> = {
    s1: "34m 14s",
    s2: "9m 18s",
    s3: "1h 12m",
    s4: "48m 05s",
    s5: "16m 27s",
    s6: "57m 40s",
  }
  const parseSizeToGb = (size: string) => {
    const match = size.match(/([\d.]+)\s*(KB|MB|GB)/i)
    if (!match) return 0
    const value = Number(match[1])
    const unit = match[2].toUpperCase()
    if (unit === "GB") return value
    if (unit === "MB") return value / 1024
    return value / (1024 * 1024)
  }
  const formatSyncDayLabel = (date: string, index: number) => {
    if (index === 0) return "今天"
    if (index === 1) return "昨天"
    const [, month, day] = date.split("-")
    return `${Number(month)}月${Number(day)}日`
  }
  const syncRecords = mockHistoryDays.flatMap((day) =>
    day.sessions.map((session) => ({
      id: `${day.date}-${session.id}`,
      date: day.date,
      deviceName: session.deviceName,
      fileCount: session.fileCount,
      totalSize: session.totalSize,
      duration: sessionDurations[session.id] ?? "22m 10s",
      status: day.date === mockHistoryDays[0]?.date && session.id === mockHistoryDays[0]?.sessions[0]?.id ? "同步中" : "已完成",
    }))
  )
  const syncRecordDays = mockHistoryDays
    .map((day, dayIndex) => {
      const records = day.sessions.map((session) => ({
        id: `${day.date}-${session.id}`,
        deviceName: session.deviceName,
        fileCount: session.fileCount,
        totalSize: session.totalSize,
        duration: sessionDurations[session.id] ?? "22m 10s",
        status: dayIndex === 0 && session.id === day.sessions[0]?.id ? "同步中" : "已完成",
      }))
      const totalFiles = records.reduce((sum, record) => sum + record.fileCount, 0)
      const totalSizeGb = records.reduce((sum, record) => sum + parseSizeToGb(record.totalSize), 0)

      return {
        date: day.date,
        label: formatSyncDayLabel(day.date, dayIndex),
        records,
        totalFiles,
        totalSize: `${totalSizeGb.toFixed(1)} GB`,
      }
    })
    .filter((day) => day.records.length > 0)
  const totalSyncedSize = syncRecords.reduce((sum, record) => sum + parseSizeToGb(record.totalSize), 0)

  const renderDownloadPreview = (preview: "photo" | "video" | "file") => {
    if (preview === "photo") {
      return <div className="h-full w-full bg-[linear-gradient(135deg,#D9EEFF_0%,#8EC8FF_100%)]" />
    }
    if (preview === "video") {
      return (
        <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,#D9E4FF_0%,#889DFF_100%)]">
          <Play className="h-3.5 w-3.5 text-white fill-white" />
        </div>
      )
    }
    return (
      <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,#F1F5FB_0%,#D6E1F2_100%)]">
        <File className="h-3.5 w-3.5 text-[#5A7DA3]" />
      </div>
    )
  }

  return (
    <div className="px-5 pt-14 pb-6" style={{ backgroundColor: MOBILE_PAGE_BACKGROUND }}>
      <div className="mb-6 flex items-center">
        <h1 className="text-[26px] font-semibold tracking-[-0.03em] text-[#183B63]">首页</h1>
      </div>

      {connected ? (
        <div className="mx-auto w-full max-w-none space-y-4">
          <section className="overflow-hidden rounded-[22px] bg-white shadow-[0_10px_30px_rgba(120,155,195,0.12)]">
            <div className="bg-gradient-to-r from-[#F8FCFF] to-[#EAF4FF] px-4 py-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-[42px] w-[42px] items-center justify-center rounded-[14px] bg-[#EDF5FD]">
                    <Monitor className="h-5 w-5 text-[#4A9AD8]" strokeWidth={1.9} />
                  </div>
                  <div>
                    <p className="text-[16px] font-semibold text-[#223F66]">自动同步</p>
                    <p className="mt-1 text-[11px] text-[#7D97B5]">{autoUpload ? "已开启" : "未开启"}</p>
                  </div>
                </div>
                <button
                  ref={autoUploadButtonRef}
                  onClick={() => {
                    if (autoUpload) {
                      setShowDisableConfirm(true)
                      return
                    }
                    onNavigateAutoUpload()
                  }}
                  className="rounded-full bg-[#357CFF] px-4 py-2 text-[11px] font-semibold text-white"
                >
                  {autoUpload ? "关闭" : "开启"}
                </button>
              </div>

              <div ref={uploadStatusRef} className="rounded-[18px] bg-white/75 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-[#203D63]">当前手机状态</p>
                  <p className="mt-1 text-[11px] leading-5 text-[#6E8CAD]">{syncedStatusText}</p>

                  {autoUpload && isTransferring ? (
                    <div className="mt-3 rounded-[14px] bg-[#F7FAFE] px-3 py-3">
                      <div className="mb-2 flex items-center justify-between text-[9px] font-medium text-[#5A7DA3]">
                        <span>本次传输进度</span>
                        <span>{Math.round(currentTransferPercent)}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-[#DCE9F5]">
                        <div
                          className="h-2 rounded-full bg-[#66A9E8]"
                          style={{ width: `${currentTransferPercent}%` }}
                        />
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                        <div>
                          <p className="text-[9px] text-[#9AB0C6]">传输速度</p>
                          <p className="mt-1 text-[12px] font-semibold text-[#203D63]">{currentTransferSpeed}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[9px] text-[#9AB0C6]">传输进度</p>
                          <p className="mt-1 text-[12px] font-semibold text-[#203D63]">
                            {currentTransferUploaded} / {currentTransferTotal}
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] text-[#9AB0C6]">文件大小</p>
                          <p className="mt-1 text-[12px] font-semibold text-[#203D63]">{currentTransferSize}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[9px] text-[#9AB0C6]">剩余时间</p>
                          <p className="mt-1 text-[12px] font-semibold text-[#203D63]">{currentTransferRemaining}</p>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <p className="mt-2 text-[10px] text-[#9AB0C6]">最近同步时间：{lastSync.time ?? "暂无"}</p>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-[22px] bg-white px-4 py-4 shadow-[0_10px_30px_rgba(120,155,195,0.12)]">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ArrowDownCircle className="h-5 w-5 text-[#203D63]" />
                <h3 className="text-[16px] font-semibold text-[#203D63]">最近下载</h3>
              </div>
              <button
                onClick={onNavigateRecentDownloads}
                className="text-[13px] font-medium text-[#357CFF]"
              >
                查看全部
              </button>
            </div>

            <div className="grid grid-cols-4 gap-2.5">
              {RECENT_DOWNLOADS.slice(0, 4).map((item) => (
                <div key={item.id}>
                  <div className="aspect-square overflow-hidden rounded-[14px] bg-[#EDF4FB] shadow-sm">
                    {renderDownloadPreview(item.preview)}
                  </div>
                  <p className="mt-1 truncate text-[10px] font-medium text-[#203D63]">{item.type}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[22px] bg-white px-4 py-4 shadow-[0_10px_30px_rgba(120,155,195,0.12)]">
            <div className="mb-4 flex items-center gap-2">
              <History className="h-5 w-5 text-[#203D63]" />
              <div>
                <h3 className="text-[16px] font-semibold text-[#203D63]">同步记录</h3>
                <p className="mt-1 text-[11px] text-[#7D97B5]">累计已同步 {totalSyncedSize.toFixed(1)} GB 文件</p>
              </div>
            </div>

            <div className="space-y-4">
              {syncRecordDays.slice(0, 3).map((day) => (
                <div key={day.date}>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[12px] font-semibold text-[#4D6C90]">{day.label}</p>
                    <p className="text-[10px] font-medium text-[#9AB0C6]">
                      {day.totalFiles} 个 · {day.totalSize}
                    </p>
                  </div>
                  <div className="space-y-2.5">
                    {day.records.map((record) => (
                      <article key={record.id} className="rounded-[18px] bg-[#F7FAFE] px-4 py-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-semibold text-[#203D63]">{record.deviceName}</p>
                            <p className="mt-1 text-[10px] text-[#9AB0C6]">当天同步记录</p>
                          </div>
                          <span
                            className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${
                              record.status === "已完成" ? "bg-[#E8F7ED] text-[#21A453]" : "bg-[#EAF2FF] text-[#357CFF]"
                            }`}
                          >
                            {record.status}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <p className="text-[9px] text-[#9AB0C6]">上传文件</p>
                            <p className="mt-1 text-[12px] font-semibold text-[#203D63]">{record.fileCount} 个</p>
                          </div>
                          <div>
                            <p className="text-[9px] text-[#9AB0C6]">总大小</p>
                            <p className="mt-1 text-[12px] font-semibold text-[#203D63]">{record.totalSize}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[9px] text-[#9AB0C6]">耗时</p>
                            <p className="mt-1 text-[12px] font-semibold text-[#203D63]">{record.duration}</p>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <div className="mx-auto w-[70%] min-w-[290px] px-1 py-1">
          <div className="flex items-center gap-4">
            <div className="flex h-[72px] w-[72px] items-center justify-center rounded-[24px] bg-[#E8EFF7]">
              <QrCode className="h-8 w-8 text-[#7F9BB9]" strokeWidth={1.9} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[22px] font-semibold tracking-[-0.03em] text-[#1C365A]">连接电脑</p>
              <p className="mt-2 text-[15px] leading-7 text-[#7F9BB9]">扫描电脑上的二维码后，即可开始自动同步。</p>
            </div>
          </div>
          <button
            onClick={onQuickConnect}
            className="mt-6 w-full rounded-[22px] border border-[#B7D4F0] bg-[#E9F3FD] py-4 text-[18px] font-semibold tracking-[-0.03em] text-[#29517B]"
          >
            去连接
          </button>
        </div>
      )}

      {showDisableConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: "rgba(0,0,0,0.28)" }}
          onClick={() => setShowDisableConfirm(false)}
        >
          <div
            className="w-full max-w-[280px] overflow-hidden rounded-2xl bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 text-center">
              <p className="text-[15px] font-semibold text-foreground">关闭自动上传</p>
              <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
                确定要关闭自动上传吗？关闭后将不再自动同步新的照片和视频。
              </p>
            </div>
            <div className="flex border-t border-gray-200">
              <button
                onClick={() => setShowDisableConfirm(false)}
                className="flex-1 border-r border-gray-200 py-3 text-[15px] font-medium text-blue-500"
              >
                取消
              </button>
              <button
                onClick={() => {
                  setShowDisableConfirm(false)
                  onDisableAutoUpload()
                }}
                className="flex-1 py-3 text-[15px] font-semibold text-red-500"
              >
                确认关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {showQuickConnectConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: "rgba(0,0,0,0.28)" }}
          onClick={() => setShowQuickConnectConfirm(false)}
        >
          <div
            className="w-full max-w-[280px] overflow-hidden rounded-2xl bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 text-center">
              <p className="text-[15px] font-semibold text-foreground">连接新设备</p>
              <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
                是否要断开当前设备连接新设备
              </p>
            </div>
            <div className="flex border-t border-gray-200">
              <button
                onClick={() => setShowQuickConnectConfirm(false)}
                className="flex-1 border-r border-gray-200 py-3 text-[15px] font-medium text-blue-500"
              >
                取消
              </button>
              <button
                onClick={() => {
                  setShowQuickConnectConfirm(false)
                  onQuickConnect()
                }}
                className="flex-1 py-3 text-[15px] font-semibold text-blue-500"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Files View - 文件浏览视图
function FilesView({ 
  onBack 
}: { 
  onBack: () => void 
}) {
  type BrowserFile = {
    id: string
    kind: "file"
    name: string
    size: string
    modified: string
    preview: "dark" | "settings" | "blue"
  }

  type BrowserFolder = {
    id: string
    kind: "folder"
    name: string
    countLabel: string
  }

  type BrowserEntry = BrowserFile | BrowserFolder

  const [currentFolder, setCurrentFolder] = useState<string | null>(null)
  const [showSortSheet, setShowSortSheet] = useState(false)
  const [layoutMode, setLayoutMode] = useState<"list" | "grid">("list")
  const [sortBy, setSortBy] = useState<"name" | "time" | "size">("name")
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [showShareSheet, setShowShareSheet] = useState(false)

  const rootEntries: BrowserEntry[] = [
    { id: "codex", kind: "folder", name: "Codex", countLabel: "文件夹" },
    { id: "mac-manual", kind: "file", name: "Mac 客户端安装手册-2506.docx", size: "1.9 MB", modified: "上次修改时间 1天前", preview: "settings" },
    { id: "reply-template", kind: "file", name: "REPLY_TEMPLATE_API.md", size: "5 KB", modified: "上次修改时间 2天前", preview: "settings" },
    { id: "abc", kind: "file", name: "abc.txt", size: "13 B", modified: "上次修改时间 3天前", preview: "blue" },
    { id: "imsdk", kind: "file", name: "imsdk.har", size: "15.0 MB", modified: "上次修改时间 1天前", preview: "settings" },
    { id: "vividrop-official", kind: "folder", name: "vividrop-official", countLabel: "文件夹" },
    { id: "promo-video", kind: "folder", name: "vividrop 宣传视频", countLabel: "文件夹" },
    { id: "ui-design", kind: "folder", name: "海外版 UI 设计", countLabel: "文件夹" },
  ]

  const filesByFolder: Record<string, BrowserFile[]> = {
    codex: [
      { id: "codex-readme", kind: "file", name: "README.md", size: "12 KB", modified: "上次修改时间 1天前", preview: "settings" },
      { id: "codex-plan", kind: "file", name: "project-plan.pdf", size: "684 KB", modified: "上次修改时间 2天前", preview: "blue" },
      { id: "codex-shot", kind: "file", name: "screen-recording.mov", size: "1.8 GB", modified: "上次修改时间 1天前", preview: "dark" },
    ],
    "vividrop-official": [
      { id: "official-1", kind: "file", name: "brand-guide.pdf", size: "6.4 MB", modified: "上次修改时间 3天前", preview: "blue" },
      { id: "official-2", kind: "file", name: "release-note.docx", size: "1.2 MB", modified: "上次修改时间 1天前", preview: "settings" },
    ],
    "promo-video": [
      { id: "promo-1", kind: "file", name: "launch-trailer.mp4", size: "856 MB", modified: "上次修改时间 2天前", preview: "dark" },
      { id: "promo-2", kind: "file", name: "behind-scenes.mov", size: "1.1 GB", modified: "上次修改时间 4天前", preview: "settings" },
    ],
    "ui-design": [
      { id: "ui-1", kind: "file", name: "home-screen.fig", size: "28 MB", modified: "上次修改时间 2天前", preview: "blue" },
      { id: "ui-2", kind: "file", name: "history-screen.png", size: "197 KB", modified: "上次修改时间 1天前", preview: "settings" },
      { id: "ui-3", kind: "file", name: "settings-screen.png", size: "136 KB", modified: "上次修改时间 1天前", preview: "blue" },
    ],
  }

  const files = currentFolder ? filesByFolder[currentFolder] ?? [] : []

  const parseSize = (size: string) => {
    const match = size.match(/([\d.]+)\s*(KB|MB|GB)/i)
    if (!match) return 0
    const value = Number(match[1])
    const unit = match[2].toUpperCase()
    if (unit === "GB") return value * 1024 * 1024
    if (unit === "MB") return value * 1024
    return value
  }

  const parseModified = (modified: string) => {
    const match = modified.match(/(\d+)/)
    return match ? Number(match[1]) : 0
  }

  const sortedFiles = useMemo(() => {
    return [...files].sort((a, b) => {
      if (sortBy === "size") return parseSize(b.size) - parseSize(a.size)
      if (sortBy === "time") return parseModified(a.modified) - parseModified(b.modified)
      return a.name.localeCompare(b.name, "zh-CN")
    })
  }, [files, sortBy])

  const sortedRootEntries = useMemo(() => {
    return [...rootEntries].sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name, "zh-CN")

      if (sortBy === "size") {
        const aValue = a.kind === "file" ? parseSize(a.size) : Number.POSITIVE_INFINITY
        const bValue = b.kind === "file" ? parseSize(b.size) : Number.POSITIVE_INFINITY
        return bValue - aValue
      }

      if (a.kind === "folder" && b.kind === "folder") return a.name.localeCompare(b.name, "zh-CN")
      if (a.kind === "folder") return -1
      if (b.kind === "folder") return 1
      return parseModified(a.modified) - parseModified(b.modified)
    })
  }, [rootEntries, sortBy])

  const sortOptions = [
    { id: "name" as const, label: "名称" },
    { id: "time" as const, label: "时间" },
    { id: "size" as const, label: "文件大小" },
  ]

  const renderPreview = (variant: "dark" | "settings" | "blue") => {
    if (variant === "dark") {
      return (
        <div className="h-full w-full rounded-[14px] bg-[#151515] p-2 text-[4px] text-white">
          <div className="mb-1 h-1.5 w-10 rounded bg-white/10" />
          <div className="mb-1 h-1.5 w-12 rounded bg-white/10" />
          <div className="space-y-1">
            <div className="h-2 rounded bg-white/8" />
            <div className="h-2 rounded bg-white/8" />
            <div className="h-2 rounded bg-white/8" />
          </div>
        </div>
      )
    }

    if (variant === "settings") {
      return (
        <div className="h-full w-full rounded-[14px] bg-[#f6f7fb] p-2">
          <div className="mb-2 flex items-center gap-1">
            <div className="h-4 w-4 rounded-full bg-[#d8e9ff]" />
            <div className="h-1.5 w-9 rounded bg-[#b7c7d9]" />
          </div>
          <div className="space-y-1.5">
            <div className="rounded bg-white p-1.5 shadow-sm">
              <div className="h-1.5 w-10 rounded bg-[#d5ddea]" />
            </div>
            <div className="rounded bg-white p-1.5 shadow-sm">
              <div className="h-1.5 w-12 rounded bg-[#d5ddea]" />
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className="flex h-full w-full items-end justify-center rounded-[14px] bg-[#d5eefc] p-2">
        <div className="w-full rounded-[10px] bg-[#e7f7ff] p-2">
          <div className="mx-auto mb-1 h-5 w-5 rounded-full bg-white/70" />
          <div className="mx-auto mb-1 h-1.5 w-12 rounded bg-[#9fc8df]" />
          <div className="mx-auto h-3 w-10 rounded-full bg-[#3b98d9]" />
        </div>
      </div>
    )
  }

  const toggleFileSelection = (fileId: string) => {
    setSelectedFiles((prev) => (prev.includes(fileId) ? prev.filter((id) => id !== fileId) : [...prev, fileId]))
  }

  const resetSelection = () => {
    setSelectionMode(false)
    setSelectedFiles([])
  }

  return (
    <div className="relative flex h-full flex-col" style={{ backgroundColor: MOBILE_PAGE_BACKGROUND }}>
      <div className="flex-1 overflow-auto px-[18px] pb-10 pt-14">
        {currentFolder ? (
          <div className="mb-6 flex items-center justify-between">
            <div className="min-w-0 flex items-center gap-3">
              <button
                onClick={() => {
                  setCurrentFolder(null)
                  resetSelection()
                }}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm transition-transform active:scale-95"
                aria-label="Back"
              >
                <ChevronLeft className="h-5 w-5 text-[#1F1F1F]" />
              </button>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-[18px] font-semibold tracking-[-0.02em] text-[#1F1F1F]">{currentFolder ?? "远程访问电脑"}</h1>
              </div>
            </div>
            <div className="ml-3 flex shrink-0 items-center gap-2 text-[#1F1F1F]">
              <button
                onClick={() => (selectionMode ? resetSelection() : setSelectionMode(true))}
                className="shrink-0 rounded-full px-2.5 py-1.5 text-[11px] font-medium text-[#1F1F1F] transition-colors active:bg-[#F1EFEE]"
                aria-label="Select"
              >
                {selectionMode ? "完成" : "选择"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-5 flex items-center gap-4">
              <button
                onClick={onBack}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm transition-transform active:scale-95"
                aria-label="Back"
              >
                <ChevronLeft className="h-5 w-5 text-[#1F1F1F]" />
              </button>
              <h1 className="text-[20px] font-semibold tracking-[-0.03em] text-[#20344F]">远程访问电脑</h1>
            </div>

            <div className="mb-4 flex items-center justify-between">
              <button
                onClick={() => setShowSortSheet(true)}
                className="flex items-center gap-1 text-[#1F1F1F]"
              >
                <span className="text-[13px] font-semibold tracking-[-0.02em]">
                  {sortOptions.find((option) => option.id === sortBy)?.label}
                </span>
                <span className="text-[13px] font-semibold">↓</span>
              </button>
              <div className="flex items-center gap-3">
                {selectionMode ? (
                  <>
                    <button
                      disabled={selectedFiles.length === 0}
                      className={`rounded-full px-3 py-1 text-[11px] font-medium ${
                        selectedFiles.length > 0 ? "bg-[#0B78F2] text-white" : "bg-[#E5E7EB] text-[#9CA3AF]"
                      }`}
                    >
                      下载
                    </button>
                    <button
                      onClick={() => {
                        if (selectedFiles.length > 0) setShowShareSheet(true)
                      }}
                      disabled={selectedFiles.length === 0}
                      className={`rounded-full px-3 py-1 text-[11px] font-medium ${
                        selectedFiles.length > 0 ? "bg-[#EEF5FF] text-[#0B78F2]" : "bg-[#E5E7EB] text-[#9CA3AF]"
                      }`}
                    >
                      分享
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setSelectionMode(true)}
                    className="shrink-0 rounded-full px-2.5 py-1.5 text-[11px] font-medium text-[#1F1F1F] transition-colors active:bg-[#F1EFEE]"
                    aria-label="Select"
                  >
                    选择
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {sortedRootEntries.map((entry) => {
                const isFolder = entry.kind === "folder"
                const isSelected = selectedFiles.includes(entry.id)
                return (
                  <article
                    key={entry.id}
                    className="flex items-center gap-3 rounded-[17px] bg-white px-3 py-3 shadow-sm"
                  >
                    <div
                      className={`flex h-[45px] w-[45px] shrink-0 items-center justify-center rounded-[12px] ${
                        isFolder ? "bg-[#F1F6FC]" : "bg-[#EFF4FB]"
                      }`}
                    >
                      {isFolder ? (
                        <FolderOpen className="h-5 w-5 text-[#F39B07]" />
                      ) : (
                        <File className="h-5 w-5 text-[#8659F5]" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-semibold tracking-[-0.03em] text-[#20344F]">{entry.name}</p>
                      <p className="mt-1 text-[9px] text-[#9AB0C6]">{isFolder ? entry.countLabel : entry.size}</p>
                    </div>
                    {selectionMode && !isFolder ? (
                      <button
                        onClick={() => toggleFileSelection(entry.id)}
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                          isSelected ? "border-[#0B78F2] bg-[#0B78F2]" : "border-[#C7C7CC] bg-white"
                        }`}
                      >
                        {isSelected ? <Check className="h-3 w-3 text-white" strokeWidth={2.6} /> : null}
                      </button>
                    ) : isFolder ? (
                      <button
                        onClick={() => {
                          setCurrentFolder(entry.id)
                          setLayoutMode("list")
                          resetSelection()
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-transparent"
                      >
                        <ChevronRight className="h-4 w-4 text-[#9AB0C6]" />
                      </button>
                    ) : (
                      <button className="flex h-7 w-7 items-center justify-center rounded-full bg-[#EFF7FF]">
                        <Download className="h-4 w-4 text-[#4FA6EA]" />
                      </button>
                    )}
                  </article>
                )
              })}
            </div>
          </>
        )}

        {currentFolder ? (
          <>
            <div className="mb-4 flex items-center justify-between">
              <button
                onClick={() => setShowSortSheet(true)}
                className="flex items-center gap-1 text-[#1F1F1F]"
              >
                <span className="text-[13px] font-semibold tracking-[-0.02em]">
                  {sortOptions.find((option) => option.id === sortBy)?.label}
                </span>
                <span className="text-[13px] font-semibold">↓</span>
              </button>
              <div className="flex items-center gap-3">
                {selectionMode ? (
                  <>
                    <button
                      disabled={selectedFiles.length === 0}
                      className={`rounded-full px-3 py-1 text-[11px] font-medium ${
                        selectedFiles.length > 0 ? "bg-[#0B78F2] text-white" : "bg-[#E5E7EB] text-[#9CA3AF]"
                      }`}
                    >
                      下载
                    </button>
                    <button
                      onClick={() => {
                        if (selectedFiles.length > 0) setShowShareSheet(true)
                      }}
                      disabled={selectedFiles.length === 0}
                      className={`rounded-full px-3 py-1 text-[11px] font-medium ${
                        selectedFiles.length > 0 ? "bg-[#EEF5FF] text-[#0B78F2]" : "bg-[#E5E7EB] text-[#9CA3AF]"
                      }`}
                    >
                      分享
                    </button>
                  </>
                ) : (
                  <span className="text-[10px] text-[#8B817A]">{layoutMode === "grid" ? "网格视图" : "列表视图"}</span>
                )}
              </div>
            </div>

            {layoutMode === "grid" ? (
              <div className="grid grid-cols-3 gap-2">
                {sortedFiles.map((file) => {
                  const isSelected = selectedFiles.includes(file.id)
                  return (
                    <article key={file.id} className="rounded-[12px] bg-white p-1.5 shadow-sm">
                      <div className="relative mb-1 aspect-square overflow-hidden rounded-[9px] border border-[#D9D9D9] bg-white">
                        {renderPreview(file.preview)}
                        {selectionMode ? (
                          <button
                            onClick={() => toggleFileSelection(file.id)}
                            className={`absolute right-1 top-1 flex h-4.5 w-4.5 items-center justify-center rounded-[5px] border ${
                              isSelected ? "border-[#0B78F2] bg-[#0B78F2]" : "border-[#C7C7CC] bg-white"
                            }`}
                          >
                            {isSelected ? <Check className="h-2.5 w-2.5 text-white" strokeWidth={2.6} /> : null}
                          </button>
                        ) : null}
                      </div>
                      <p className="truncate text-[9.5px] font-medium leading-[1.25] text-[#212121]">{file.name}</p>
                      <p className="mt-0.5 text-[8px] text-[#71665F]">{file.size}</p>
                    </article>
                  )
                })}
              </div>
            ) : (
              <>
                <div className="mx-[-18px] h-px bg-[#E0DEDD]" />
                <div className="divide-y divide-[#E0DEDD]">
                  {sortedFiles.map((file) => {
                    const isSelected = selectedFiles.includes(file.id)
                    return (
                      <article key={file.id} className="flex items-center gap-2.5 px-[18px] py-2.5">
                        <div className="h-[44px] w-[44px] shrink-0 overflow-hidden rounded-[11px] border border-[#D9D9D9] bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
                          {renderPreview(file.preview)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-medium tracking-[-0.03em] text-[#212121]">{file.name}</p>
                          <p className="mt-0.5 text-[11px] leading-[1.35] tracking-[-0.02em] text-[#71665F]">{file.size}</p>
                        </div>
                        {selectionMode ? (
                          <button
                            onClick={() => toggleFileSelection(file.id)}
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                              isSelected ? "border-[#0B78F2] bg-[#0B78F2]" : "border-[#C7C7CC] bg-white"
                            }`}
                          >
                            {isSelected ? <Check className="h-3 w-3 text-white" strokeWidth={2.6} /> : null}
                          </button>
                        ) : null}
                      </article>
                    )
                  })}
                </div>
              </>
            )}

            <div className="pt-6 text-center text-[14px] tracking-[-0.02em] text-[#71665F]">{files.length} 个文件</div>
          </>
        ) : null}
      </div>

      {showSortSheet && (
        <>
          <button
            className="absolute inset-0 bg-black/18"
            onClick={() => setShowSortSheet(false)}
            aria-label="Close sort sheet"
          />
          <div className="absolute left-1/2 top-1/2 w-[220px] -translate-x-1/2 -translate-y-1/2 rounded-[22px] bg-white px-4 pb-4 pt-4 shadow-[0_16px_40px_rgba(0,0,0,0.16)]">
            <div className="space-y-1">
              {sortOptions.map((option) => {
                const isActive = sortBy === option.id
                return (
                  <button
                    key={option.id}
                    onClick={() => {
                      setSortBy(option.id)
                      setShowSortSheet(false)
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors active:bg-slate-50"
                  >
                    <span className="flex-1 text-[15px] font-medium tracking-[-0.02em] text-[#1F1F1F]">{option.label}</span>
                    {isActive && <Check className="h-6 w-6 shrink-0 text-[#0B78F2]" strokeWidth={2.4} />}
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}

      {showShareSheet && (
        <>
          <button
            className="absolute inset-0 bg-black/18"
            onClick={() => setShowShareSheet(false)}
            aria-label="Close share sheet"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-[28px] bg-white px-8 pb-10 pt-8 shadow-[0_-12px_40px_rgba(0,0,0,0.12)]">
            <p className="mb-5 text-center text-[18px] font-semibold text-[#1F1F1F]">分享所选文件</p>
            <div className="grid grid-cols-4 gap-4 text-center">
              {["微信", "QQ", "企业微信", "更多"].map((item) => (
                <button key={item} className="flex flex-col items-center gap-2">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#EEF5FF] text-[11px] font-semibold text-[#0B78F2]">
                    {item.slice(0, 2)}
                  </div>
                  <span className="text-[11px] text-[#5E5651]">{item}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

    </div>
  )
}

// Settings View
function SettingsView({ 
  deviceName,
  onDeviceNameChange,
  onNavigateGiftCard,
  onNavigateMembership,
  onNavigateLanguage,
  onNavigateHelp,
  onBack 
}: { 
  deviceName: string
  onDeviceNameChange: (name: string) => void
  onNavigateGiftCard: () => void
  onNavigateMembership: () => void
  onNavigateLanguage: () => void
  onNavigateHelp: () => void
  onBack: () => void 
}) {
  const [showEditDevice, setShowEditDevice] = useState(false)
  const [editingName, setEditingName] = useState(deviceName)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false)
  const [showSwitchDeviceConfirm, setShowSwitchDeviceConfirm] = useState(false)
  const [showLanDeviceModal, setShowLanDeviceModal] = useState(false)
  const [showConnectMethodModal, setShowConnectMethodModal] = useState(false)
  const [showConnectCodeModal, setShowConnectCodeModal] = useState(false)
  const [showManualPairModal, setShowManualPairModal] = useState(false)
  const [showConnectScanModal, setShowConnectScanModal] = useState(false)
  const [pendingConnectDevice, setPendingConnectDevice] = useState<LanDesktopDevice | null>(null)
  const [connectionCode, setConnectionCode] = useState("")
  const [manualIp, setManualIp] = useState("")
  const [showRestorePurchaseConfirm, setShowRestorePurchaseConfirm] = useState(false)
  const [language, setLanguage] = useState<"zh-Hans" | "zh-Hant" | "en" | "ja" | "ko" | "fr" | "es" | "ru">("zh-Hans")
  const [showDiagnosticModal, setShowDiagnosticModal] = useState(false)
  const [diagnosticText, setDiagnosticText] = useState("")
  const [showCameraPermissionModal, setShowCameraPermissionModal] = useState(false)
  const [showLanScanning, setShowLanScanning] = useState(false)

  // Mock data
  const userAccount = "+1 206 **** 1234"
  const membershipStatus = { level: "Pro Annual", daysLeft: 28, expiresAt: "2026-07-08" }
  const connectedDevices = [
    { id: "1", name: "MacBook Pro", type: "laptop" as const, isCurrent: true, isOnline: true },
    { id: "2", name: "Windows Workstation", type: "desktop" as const, isCurrent: false, isOnline: true, lastConnected: "2 days ago" },
    { id: "3", name: "Office PC", type: "desktop" as const, isCurrent: false, isOnline: false },
  ]
  const appVersion = "2.1.0"
  const latestVersion = "2.2.0"
  const isLatestVersion = false

  const languageOptions = [
    { id: "zh-Hans" as const, label: "简体中文" },
    { id: "zh-Hant" as const, label: "繁体中文" },
    { id: "en" as const, label: "English" },
    { id: "ja" as const, label: "日本語" },
    { id: "ko" as const, label: "한국어" },
    { id: "fr" as const, label: "Français" },
    { id: "es" as const, label: "Español" },
    { id: "ru" as const, label: "Русский" },
  ]

  const currentLanguageLabel = languageOptions.find((item) => item.id === language)?.label ?? "简体中文"

  const continueManualPairing = () => {
    const ip = manualIp.trim()
    if (!ip) return

    setPendingConnectDevice({
      id: `manual-${ip}`,
      name: "手动配对设备",
      type: "desktop",
      ip,
      status: "available",
    })
    setManualIp("")
    setConnectionCode("")
    setShowManualPairModal(false)
    setShowConnectCodeModal(true)
  }

  return (
    <div className="px-5 pt-14 pb-6" style={{ backgroundColor: MOBILE_PAGE_BACKGROUND, minHeight: "100%" }}>
      <h1 className="text-xl font-semibold text-foreground mb-6">设置</h1>

      {/* MY ACCOUNT */}
      <section className="mb-5">
        <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2.5 px-1">我的账户</h2>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {/* Account */}
          <div className="flex items-center gap-3 p-3.5 border-b border-gray-50">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-pink-50">
              <User className="h-[18px] w-[18px] text-pink-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-foreground">{userAccount}</p>
            </div>
          </div>
          
          {/* Membership */}
          <button
            onClick={onNavigateMembership}
            className="flex w-full items-center gap-3 border-b border-gray-50 p-3.5 text-left transition-colors hover:bg-gray-50/50"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-50">
              <Crown className="h-[18px] w-[18px] text-purple-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-foreground">会员状态</p>
              <p className="text-[11px] text-muted-foreground">{membershipStatus.level} · 剩余 {membershipStatus.daysLeft} 天</p>
            </div>
            <span className="text-[10px] font-medium bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">
              Pro
            </span>
            <ChevronRight className="h-4 w-4 text-gray-300" />
          </button>

          <button
            onClick={() => setShowRestorePurchaseConfirm(true)}
            className="flex w-full items-center gap-3 border-b border-gray-50 p-3.5 text-left transition-colors hover:bg-gray-50/50"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50">
              <RefreshCw className="h-[18px] w-[18px] text-blue-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-foreground">恢复已购买订阅</p>
              <p className="text-[11px] text-muted-foreground">从应用商店检查历史购买记录</p>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-300" />
          </button>

          <div className="flex items-center gap-3 p-3.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50">
              <Smartphone className="h-[18px] w-[18px] text-blue-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-foreground">设备名称</p>
              <p className="text-[11px] text-muted-foreground">{deviceName}</p>
            </div>
            <button 
              onClick={() => { setEditingName(deviceName); setShowEditDevice(true); }}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <Pencil className="h-4 w-4 text-gray-400" />
            </button>
          </div>
        </div>
      </section>

      {/* CONNECTED DEVICES */}
      <section className="mb-5">
        <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2.5 px-1">电脑设备</h2>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 p-3.5 border-b border-gray-50">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-50">
              <Laptop className="h-[18px] w-[18px] text-purple-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-foreground">{connectedDevices[0].name}</p>
              <p className="text-[11px] text-muted-foreground">当前设备</p>
            </div>
            <span className="text-[10px] font-medium bg-green-100 text-green-600 px-2 py-0.5 rounded-full">
              当前
            </span>
          </div>

          <button
            onClick={() => setShowSwitchDeviceConfirm(true)}
            className="flex w-full items-center gap-3 p-3.5 text-left hover:bg-gray-50/50 transition-colors"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50">
              <Monitor className="h-[18px] w-[18px] text-blue-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-foreground">切换设备</p>
              <p className="text-[11px] text-muted-foreground">将断开当前设备并重新连接其他电脑</p>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-300" />
          </button>
        </div>
      </section>

      {/* GENERAL */}
      <section className="mb-5">
        <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2.5 px-1">通用</h2>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {/* Language */}
          <button 
            onClick={onNavigateLanguage}
            className="flex items-center gap-3 p-3.5 w-full text-left hover:bg-gray-50/50 transition-colors border-b border-gray-50"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50">
              <Languages className="h-[18px] w-[18px] text-blue-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-foreground">语言</p>
              <p className="text-[11px] text-muted-foreground">{currentLanguageLabel}</p>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-300" />
          </button>
          
          <button
            onClick={onNavigateHelp}
            className="flex items-center gap-3 p-3.5 w-full text-left hover:bg-gray-50/50 transition-colors border-b border-gray-50"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50">
              <HelpCircle className="h-[18px] w-[18px] text-blue-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-foreground">常见问题</p>
              <p className="text-[11px] text-muted-foreground">操作说明与常见问题</p>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-300" />
          </button>

          {/* Version */}
          <div className="flex items-center gap-3 p-3.5 border-b border-gray-50">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-50">
              <MessageSquare className="h-[18px] w-[18px] text-purple-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-foreground">版本</p>
              <p className="text-[11px] text-muted-foreground">版本 {appVersion}</p>
            </div>
            {isLatestVersion ? (
              <span className="text-[11px] text-green-500">当前已是最新版本</span>
            ) : (
              <button className="text-[11px] font-medium bg-blue-500 text-white px-3 py-1 rounded-full">
                更新
              </button>
            )}
          </div>

          <button
            onClick={() => setShowDiagnosticModal(true)}
            className="flex items-center gap-3 p-3.5 w-full text-left hover:bg-gray-50/50 transition-colors border-b border-gray-50"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50">
              <ArrowUpToLine className="h-[18px] w-[18px] text-blue-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-foreground">上传诊断包</p>
              <p className="text-[11px] text-muted-foreground">上传日志和设备状态以便排查问题</p>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-300" />
          </button>
          
          {/* Log Out */}
          <button 
            onClick={() => setShowLogoutConfirm(true)}
            className="flex items-center gap-3 p-3.5 w-full text-left hover:bg-gray-50/50 transition-colors"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-50">
              <LogOut className="h-[18px] w-[18px] text-red-500" />
            </div>
            <p className="text-[13px] font-medium text-red-500">退出登录</p>
          </button>

          <button
            onClick={() => setShowDeleteAccountConfirm(true)}
            className="flex items-center gap-3 p-3.5 w-full text-left hover:bg-gray-50/50 transition-colors border-t border-gray-50"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-50">
              <Trash2 className="h-[18px] w-[18px] text-red-500" />
            </div>
            <p className="text-[13px] font-medium text-red-500">注销账号</p>
          </button>
        </div>
      </section>

      {/* Edit Device Name Modal */}
      {showEditDevice && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setShowEditDevice(false)}
        >
          <div 
            className="w-full max-w-[300px] rounded-2xl overflow-hidden"
            style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(20px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5">
              <p className="text-[15px] font-semibold text-center mb-4">编辑设备名称</p>
              <input
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none"
                style={{ background: "rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.08)" }}
                autoFocus
              />
            </div>
            <div className="flex border-t border-gray-200">
              <button 
                onClick={() => setShowEditDevice(false)}
                className="flex-1 py-3 text-[15px] text-blue-500 font-medium border-r border-gray-200"
              >
                取消
              </button>
              <button 
                onClick={() => { onDeviceNameChange(editingName); setShowEditDevice(false); }}
                className="flex-1 py-3 text-[15px] text-blue-500 font-semibold"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logout Confirm Modal */}
      {showLogoutConfirm && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setShowLogoutConfirm(false)}
        >
          <div 
            className="w-full max-w-[270px] rounded-2xl overflow-hidden"
            style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(20px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 text-center">
              <p className="text-[15px] font-semibold mb-2">退出登录</p>
              <p className="text-[13px] text-muted-foreground">确定要退出当前账号吗？</p>
            </div>
            <div className="flex border-t border-gray-200">
              <button 
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 py-3 text-[15px] text-blue-500 font-medium border-r border-gray-200"
              >
                取消
              </button>
              <button 
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 py-3 text-[15px] text-red-500 font-semibold"
              >
                退出登录
              </button>
            </div>
          </div>
        </div>
      )}

      {showRestorePurchaseConfirm && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setShowRestorePurchaseConfirm(false)}
        >
          <div 
            className="w-full max-w-[280px] rounded-2xl overflow-hidden bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 text-center">
              <p className="text-[15px] font-semibold text-foreground">恢复已购买订阅</p>
              <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
                正在从应用商店检查当前账号的历史购买记录。
              </p>
            </div>
            <div className="border-t border-gray-200">
              <button
                onClick={() => setShowRestorePurchaseConfirm(false)}
                className="w-full py-3 text-[15px] font-semibold text-blue-500"
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteAccountConfirm && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setShowDeleteAccountConfirm(false)}
        >
          <div 
            className="w-full max-w-[270px] rounded-2xl overflow-hidden"
            style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(20px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 text-center">
              <p className="text-[15px] font-semibold mb-2">注销账号</p>
              <p className="text-[13px] text-muted-foreground">确定要注销当前账号吗？此操作不可撤销。</p>
            </div>
            <div className="flex border-t border-gray-200">
              <button 
                onClick={() => setShowDeleteAccountConfirm(false)}
                className="flex-1 py-3 text-[15px] text-blue-500 font-medium border-r border-gray-200"
              >
                取消
              </button>
              <button 
                onClick={() => setShowDeleteAccountConfirm(false)}
                className="flex-1 py-3 text-[15px] text-red-500 font-semibold"
              >
                注销
              </button>
            </div>
          </div>
        </div>
      )}

      {showSwitchDeviceConfirm && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setShowSwitchDeviceConfirm(false)}
        >
          <div 
            className="w-full max-w-[280px] rounded-2xl overflow-hidden bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 text-center">
              <p className="text-[15px] font-semibold text-foreground">切换设备</p>
              <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
                是否确认断开当前设备，并连接其他电脑设备？
              </p>
            </div>
            <div className="flex border-t border-gray-200">
              <button
                onClick={() => setShowSwitchDeviceConfirm(false)}
                className="flex-1 border-r border-gray-200 py-3 text-[15px] font-medium text-blue-500"
              >
                取消
              </button>
              <button
                onClick={() => {
                  setShowSwitchDeviceConfirm(false)
                  setPendingConnectDevice(null)
                  setConnectionCode("")
                  setShowLanScanning(true)
                  setShowLanDeviceModal(true)
                  window.setTimeout(() => {
                    setShowLanScanning(false)
                  }, 900)
                }}
                className="flex-1 py-3 text-[15px] font-semibold text-blue-500"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {showConnectCodeModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setShowConnectCodeModal(false)}
        >
          <div
            className="w-full max-w-[300px] rounded-2xl overflow-hidden bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5">
              <p className="text-[15px] font-semibold text-center mb-2">连接设备</p>
              <p className="text-[13px] text-center text-muted-foreground mb-4">输入 {pendingConnectDevice?.name ?? "所选设备"} 的连接码</p>
              <input
                type="text"
                value={connectionCode}
                onChange={(e) => setConnectionCode(e.target.value)}
                placeholder="输入连接码"
                className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none"
                style={{ background: "rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.08)" }}
              />
            </div>
            <div className="flex border-t border-gray-200">
              <button
                onClick={() => setShowConnectCodeModal(false)}
                className="flex-1 py-3 text-[15px] text-blue-500 font-medium border-r border-gray-200"
              >
                取消
              </button>
              <button
                onClick={() => setShowConnectCodeModal(false)}
                className="flex-1 py-3 text-[15px] text-blue-500 font-semibold"
              >
                连接
              </button>
            </div>
          </div>
        </div>
      )}

      {showConnectMethodModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setShowConnectMethodModal(false)}
        >
          <div
            className="w-full max-w-[300px] rounded-2xl overflow-hidden bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5">
              <p className="text-[15px] font-semibold text-center mb-2">连接设备</p>
              <p className="text-[13px] text-center text-muted-foreground mb-4">
                将自动断开当前连接设备
              </p>
              <div className="space-y-3">
                <button
                  onClick={() => {
                    setShowConnectMethodModal(false)
                    setShowCameraPermissionModal(true)
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl border border-gray-100 bg-slate-50 px-4 py-4 text-left"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
                    <QrCode className="h-5 w-5 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-foreground">扫码连接</p>
                    <p className="text-[11px] text-muted-foreground">扫描 {pendingConnectDevice?.name ?? "电脑端"} 二维码进行配对</p>
                  </div>
                </button>
                <button
                  onClick={() => {
                    setShowConnectMethodModal(false)
                    setShowConnectCodeModal(true)
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl border border-gray-100 bg-slate-50 px-4 py-4 text-left"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50">
                    <Link2 className="h-5 w-5 text-violet-500" />
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-foreground">输入连接码</p>
                    <p className="text-[11px] text-muted-foreground">输入 {pendingConnectDevice?.name ?? "电脑端"} 显示的连接码</p>
                  </div>
                </button>
              </div>
            </div>
            <div className="border-t border-gray-200">
              <button
                onClick={() => setShowConnectMethodModal(false)}
                className="w-full py-3 text-[15px] font-medium text-blue-500"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {showLanDeviceModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: "rgba(0,0,0,0.28)" }}
          onClick={() => setShowLanDeviceModal(false)}
        >
          <div
            className="w-full max-w-[286px] rounded-[22px] bg-white px-4 pb-4 pt-4 shadow-[0_20px_48px_rgba(0,0,0,0.16)]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-center text-[15px] font-semibold text-foreground">选择局域网设备</p>
            <p className="mt-1.5 text-center text-[11px] text-muted-foreground">请先选择同一局域网下的电脑设备</p>

            {showLanScanning ? (
              <div className="mt-3.5 space-y-2.5">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="h-[56px] animate-pulse rounded-[16px] bg-[#EDF4FB]" />
                ))}
              </div>
            ) : (
              <div className="mt-3.5 space-y-2.5">
                {MOCK_LAN_DEVICES.map((device) => {
                  const DeviceIcon = device.type === "laptop" ? Laptop : Monitor
                  return (
                    <button
                      key={device.id}
                      onClick={() => {
                        setPendingConnectDevice(device)
                        setShowLanDeviceModal(false)
                        setShowConnectMethodModal(true)
                      }}
                      className="flex w-full items-center gap-2.5 rounded-[18px] border border-gray-100 bg-slate-50 px-3 py-3 text-left"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-blue-50">
                        <DeviceIcon className="h-4.5 w-4.5 text-blue-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium text-foreground">{device.name}</p>
                        <p className="text-[10px] text-muted-foreground">{device.ip}</p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${
                          device.status === "available" ? "bg-green-100 text-green-600" : "bg-orange-100 text-orange-500"
                        }`}
                      >
                        {device.status === "available" ? "可连接" : "使用中"}
                      </span>
                    </button>
                  )
                })}
                <button
                  onClick={() => {
                    setManualIp("")
                    setConnectionCode("")
                    setShowLanDeviceModal(false)
                    setShowManualPairModal(true)
                  }}
                  className="flex w-full items-center gap-2.5 rounded-[18px] border border-dashed border-[#B7CAE3] bg-[#F7FBFF] px-3 py-3 text-left"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-blue-50">
                    <Link2 className="h-4.5 w-4.5 text-blue-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium text-foreground">手动配对</p>
                    <p className="text-[10px] text-muted-foreground">输入电脑 IP 和连接码连接</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-300" />
                </button>
                <button
                  onClick={() => {
                    setPendingConnectDevice(null)
                    setShowLanDeviceModal(false)
                    setShowCameraPermissionModal(true)
                  }}
                  className="flex w-full items-center gap-2.5 rounded-[18px] border border-gray-100 bg-slate-50 px-3 py-3 text-left"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-blue-50">
                    <QrCode className="h-4.5 w-4.5 text-blue-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium text-foreground">扫码连接</p>
                    <p className="text-[10px] text-muted-foreground">扫描电脑端二维码连接</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-300" />
                </button>
              </div>
            )}

            <button
              onClick={() => setShowLanDeviceModal(false)}
              className="mt-4 w-full py-2 text-[14px] font-medium text-blue-500"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {showManualPairModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setShowManualPairModal(false)}
        >
          <div
            className="w-full max-w-[300px] overflow-hidden rounded-2xl bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5">
              <p className="text-center text-[15px] font-semibold text-foreground">手动配对</p>
              <p className="mt-2 text-center text-[13px] leading-5 text-muted-foreground">
                未显示设备时，输入电脑端 IP 地址后继续输入连接码。
              </p>
              <input
                type="text"
                value={manualIp}
                onChange={(e) => setManualIp(e.target.value)}
                placeholder="192.168.31.21"
                inputMode="decimal"
                className="mt-4 w-full rounded-xl px-3 py-2.5 text-[14px] outline-none"
                style={{ background: "rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.08)" }}
                autoFocus
              />
              <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                可在电脑端 Vivi Drop 的全局设置中查看 IP 和 6 位连接码。
              </p>
            </div>
            <div className="flex border-t border-gray-200">
              <button
                onClick={() => setShowManualPairModal(false)}
                className="flex-1 border-r border-gray-200 py-3 text-[15px] font-medium text-blue-500"
              >
                取消
              </button>
              <button
                onClick={continueManualPairing}
                disabled={!manualIp.trim()}
                className="flex-1 py-3 text-[15px] font-semibold text-blue-500 disabled:text-gray-300"
              >
                下一步
              </button>
            </div>
          </div>
        </div>
      )}

      {showCameraPermissionModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: "rgba(0,0,0,0.35)" }}
          onClick={() => setShowCameraPermissionModal(false)}
        >
          <div
            className="w-full max-w-[300px] overflow-hidden rounded-2xl bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 text-center">
              <p className="text-[16px] font-semibold text-[#20344F]">允许相机访问</p>
              <p className="mt-2 text-[13px] leading-5 text-[#7D97B5]">
                扫码连接需要获取相机使用权限，是否允许打开相机？
              </p>
            </div>
            <div className="flex border-t border-gray-200">
              <button
                onClick={() => setShowCameraPermissionModal(false)}
                className="flex-1 border-r border-gray-200 py-3 text-[15px] font-medium text-blue-500"
              >
                不允许
              </button>
              <button
                onClick={() => {
                  setShowCameraPermissionModal(false)
                  setShowConnectScanModal(true)
                }}
                className="flex-1 py-3 text-[15px] font-semibold text-blue-500"
              >
                允许
              </button>
            </div>
          </div>
        </div>
      )}

      {showConnectScanModal && (
        <div
          className="fixed inset-0 z-50 flex flex-col"
          style={{ background: "rgba(0,0,0,0.78)" }}
        >
          <div className="flex items-center justify-between px-6 pb-4 pt-14 text-white">
            <button
              onClick={() => setShowConnectScanModal(false)}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <p className="text-[16px] font-semibold">扫码连接</p>
            <button
              onClick={() => setShowConnectScanModal(false)}
              className="rounded-full bg-white/10 px-4 py-2 text-[12px] font-medium"
            >
              已扫描
            </button>
          </div>

          <div className="flex flex-1 items-center justify-center px-8">
            <div className="relative w-full max-w-[320px]">
              <div className="aspect-square overflow-hidden rounded-[28px] border border-white/15 bg-black shadow-[0_20px_60px_rgba(0,0,0,0.35)]" />
              <div className="pointer-events-none absolute inset-0 rounded-[28px] border-2 border-white/80">
                <div className="absolute left-6 right-6 top-1/2 h-[2px] -translate-y-1/2 bg-[#4FA6EA]" />
                <div className="absolute left-4 top-4 h-8 w-8 border-l-4 border-t-4 border-white" />
                <div className="absolute right-4 top-4 h-8 w-8 border-r-4 border-t-4 border-white" />
                <div className="absolute bottom-4 left-4 h-8 w-8 border-b-4 border-l-4 border-white" />
                <div className="absolute bottom-4 right-4 h-8 w-8 border-b-4 border-r-4 border-white" />
              </div>
            </div>
          </div>

          <div className="px-8 pb-10 text-center text-[13px] leading-6 text-white/80">
            请将 {pendingConnectDevice?.name ?? "电脑端"} 的二维码放入相框内
          </div>
        </div>
      )}

      {/* Diagnostic Modal */}
      {showDiagnosticModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-5"
          style={{ background: "rgba(0,0,0,0.25)" }}
          onClick={() => setShowDiagnosticModal(false)}
        >
          <div
            className="w-full max-w-[300px] rounded-[20px] overflow-hidden"
            style={{
              background: "rgba(242,242,247,0.85)",
              backdropFilter: "blur(40px)",
              WebkitBackdropFilter: "blur(40px)",
              boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-4">
              <p className="text-[17px] font-semibold mb-2" style={{ color: "#1c1c1e" }}>上传诊断包</p>
              <p className="text-[13px] leading-[1.45] mb-4" style={{ color: "rgba(60,60,67,0.6)" }}>
                请描述您遇到的问题，例如上传卡住或共享目录文件不可见。系统会打包当前运行状态并上传至 Vivi Drop 支持团队。
              </p>
              <textarea
                value={diagnosticText}
                onChange={(e) => setDiagnosticText(e.target.value)}
                placeholder="请描述您遇到的问题..."
                rows={2}
                className="w-full px-3 py-2.5 rounded-xl text-[15px] outline-none resize-none"
                style={{
                  background: "rgba(142,142,147,0.16)",
                  color: "#1c1c1e",
                  caretColor: "#007AFF",
                }}
                autoFocus
              />
            </div>
            <div className="flex gap-2 px-4 pb-4">
              <button
                onClick={() => {
                  setShowDiagnosticModal(false)
                  setDiagnosticText("")
                }}
                className="flex-1 py-3 rounded-full text-[16px] font-medium transition-opacity active:opacity-60"
                style={{ background: "rgba(142,142,147,0.24)", color: "#1c1c1e" }}
              >
                取消
              </button>
              <button
                onClick={() => {
                  setShowDiagnosticModal(false)
                  setDiagnosticText("")
                }}
                className="flex-1 py-3 rounded-full text-[16px] font-medium transition-opacity active:opacity-60"
                style={{ background: "#0B78F2", color: "#FFFFFF" }}
              >
                提交
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Auto Upload Settings View
function AutoUploadSettingsView({
  autoUpload,
  autoUploadRange,
  onConfirmAutoUpload,
  onSelectRange,
  onBack,
  uploadSourcesRef,
  uploadRangeRef,
  confirmUploadRef,
}: {
  autoUpload: boolean
  autoUploadRange: "all" | "now" | "custom"
  onConfirmAutoUpload: () => void
  onSelectRange: (range: "all" | "now" | "custom") => void
  onBack: () => void
  uploadSourcesRef: RefObject<HTMLDivElement | null>
  uploadRangeRef: RefObject<HTMLDivElement | null>
  confirmUploadRef: RefObject<HTMLButtonElement | null>
}) {
  type SelectedUploadFile = {
    name: string
    size: number
    path: string
    lastModified: number
  }

  const [autoUploadSources, setAutoUploadSources] = useState({ album: true })
  const [selectedUploadFiles, setSelectedUploadFiles] = useState<SelectedUploadFile[]>([])
  const [showCustomPicker, setShowCustomPicker] = useState(false)
  const [customTimestamp, setCustomTimestamp] = useState<string>(() => new Date().toISOString().slice(0,16))
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileSourceSelected = selectedUploadFiles.length > 0
  const canConfirmAutoUpload = autoUploadSources.album || fileSourceSelected

  const handleSourceToggle = (source: "album") => {
    setAutoUploadSources((prev) => ({
      ...prev,
      [source]: !prev[source],
    }))
  }

  const handleFilePickerChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []).map((file) => {
      const path = file.webkitRelativePath || file.name
      return {
        name: file.name,
        size: file.size,
        path,
        lastModified: file.lastModified,
      }
    })

    if (files.length > 0) {
      setSelectedUploadFiles((current) => {
        const merged = [...current]
        const existingKeys = new Set(current.map((file) => `${file.path}-${file.size}-${file.lastModified}`))

        files.forEach((file) => {
          const key = `${file.path}-${file.size}-${file.lastModified}`
          if (!existingKeys.has(key)) {
            existingKeys.add(key)
            merged.push(file)
          }
        })

        return merged
      })
    }
    event.currentTarget.value = ""
  }

  const formatUploadFileSize = (size: number) => {
    if (size >= 1024 * 1024 * 1024) return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
    if (size >= 1024) return `${Math.round(size / 1024)} KB`
    return `${size} B`
  }

  const handleRangeSelect = (range: "all" | "now" | "custom") => {
    onSelectRange(range)
    setShowCustomPicker(range === "custom")
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: MOBILE_PAGE_BACKGROUND }}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-5 pt-14 pb-4 border-b"
        style={{ borderColor: "rgba(56, 92, 128, 0.12)" }}
      >
        <button 
          onClick={onBack}
          className="flex items-center justify-center h-9 w-9 rounded-lg hover:bg-muted transition-colors"
        >
          <ChevronLeft className="h-5 w-5 text-foreground" />
        </button>
        <h1 className="text-lg font-semibold text-foreground">自动上传</h1>
      </div>

      <div className="flex-1 overflow-auto px-5 py-5">
        {/* top summary removed to simplify UI */}

        {/* Source Selection */}
        <div ref={uploadSourcesRef} className="mb-5">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">选择同步来源</h2>
          <div className="bg-card rounded-xl border border-border overflow-hidden divide-y divide-border">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFilePickerChange}
            />
            <button
              onClick={() => handleSourceToggle("album")}
              className={`w-full flex items-center gap-2 p-2 text-left transition-colors ${autoUploadSources.album ? "bg-[#EAF2FF]" : "hover:bg-muted/50"}`}
              >
                <div className={`flex h-6 w-6 items-center justify-center rounded-xl ${autoUploadSources.album ? "bg-[#1D4ED8]" : "bg-muted"}`}>
                  <Image className={`h-3 w-3 ${autoUploadSources.album ? "text-white" : "text-muted-foreground"}`} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">1. 从相册同步</p>
                <p className="text-xs text-muted-foreground">照片或视频</p>
              </div>
              {autoUploadSources.album ? (
                <div className="flex h-5 w-5 items-center justify-center rounded-full border border-[#1D4ED8] bg-[#1D4ED8]">
                  <Check className="h-3.5 w-3.5 text-white" />
                </div>
              ) : null}
            </button>
            <div
              className={`w-full p-2 transition-colors ${fileSourceSelected ? "bg-[#EAF2FF]" : "hover:bg-muted/50"}`}
            >
              <div className="flex items-center gap-2">
                <div className={`flex h-6 w-6 items-center justify-center rounded-xl ${fileSourceSelected ? "bg-[#1D4ED8]" : "bg-muted"}`}>
                  <File className={`h-3 w-3 ${fileSourceSelected ? "text-white" : "text-muted-foreground"}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">2. 从文件同步</p>
                  <p className="text-xs text-muted-foreground">
                    {fileSourceSelected ? `已选择 ${selectedUploadFiles.length} 个文件` : "从系统文件中选择需要上传的文件"}
                  </p>
                </div>
                {fileSourceSelected ? (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full border border-[#1D4ED8] bg-[#1D4ED8]">
                    <Check className="h-3.5 w-3.5 text-white" />
                  </div>
                ) : null}
              </div>
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full rounded-full bg-[#1D4ED8] px-3 py-1.5 text-xs font-semibold text-white"
                >
                  添加文件
                </button>
              </div>
            </div>
            {fileSourceSelected ? (
              <div className="bg-white px-3 py-2.5">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-[11px] font-medium text-[#203D63]">已添加 {selectedUploadFiles.length} 个文件</p>
                  <button
                    type="button"
                    onClick={() => setSelectedUploadFiles([])}
                    className="text-[11px] font-medium text-muted-foreground"
                  >
                    清空
                  </button>
                </div>
                <div className="space-y-1.5">
                  {selectedUploadFiles.slice(0, 2).map((file) => (
                    <div key={`${file.path}-${file.size}-${file.lastModified}`} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <File className="h-3.5 w-3.5 shrink-0 text-[#1D4ED8]" />
                      <span className="min-w-0 flex-1 truncate">{file.path}</span>
                      <span className="shrink-0">{formatUploadFileSize(file.size)}</span>
                    </div>
                  ))}
                </div>
                {selectedUploadFiles.length > 2 ? (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">另有 {selectedUploadFiles.length - 2} 个文件</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {/* Time Range Selection (compact) */}
        <div ref={uploadRangeRef} className="mb-5">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">上传范围</h2>
          <div className="bg-card rounded-xl border border-border overflow-hidden divide-y divide-border">
            <button
              onClick={() => handleRangeSelect("all")}
              className="w-full flex items-center gap-2 p-2 text-left hover:bg-muted/50 transition-colors"
            >
              <div className={`flex h-6 w-6 items-center justify-center rounded-xl ${autoUploadRange === "all" ? "bg-[#1D4ED8]" : "bg-muted"}`}>
                <Folder className={`h-3 w-3 ${autoUploadRange === "all" ? "text-white" : "text-muted-foreground"}`} />
              </div>
              <div className="flex-1">
                <p className="text-xs font-medium text-foreground">全部</p>
                <p className="text-[11px] text-muted-foreground">上传现有所有照片和视频</p>
              </div>
              {autoUploadRange === "all" ? (
                <div className="flex h-5 w-5 items-center justify-center rounded-full border border-[#1D4ED8] bg-[#1D4ED8]">
                  <Check className="h-3.5 w-3.5 text-white" />
                </div>
              ) : null}
            </button>

            <button
              onClick={() => handleRangeSelect("now")}
              className="w-full flex items-center gap-2 p-2 text-left hover:bg-muted/50 transition-colors"
            >
              <div className={`flex h-6 w-6 items-center justify-center rounded-xl ${autoUploadRange === "now" ? "bg-[#1D4ED8]" : "bg-muted"}`}>
                <Clock className={`h-3 w-3 ${autoUploadRange === "now" ? "text-white" : "text-muted-foreground"}`} />
              </div>
              <div className="flex-1">
                <p className="text-xs font-medium text-foreground">从现在开始</p>
                <p className="text-[11px] text-muted-foreground">仅同步从现在开始的新照片和视频</p>
              </div>
              {autoUploadRange === "now" ? (
                <div className="flex h-5 w-5 items-center justify-center rounded-full border border-[#1D4ED8] bg-[#1D4ED8]">
                  <Check className="h-3.5 w-3.5 text-white" />
                </div>
              ) : null}
            </button>

            <div>
              <button
                onClick={() => handleRangeSelect("custom")}
                className="w-full flex items-center gap-2 p-2 text-left hover:bg-muted/50 transition-colors"
              >
                <div className={`flex h-6 w-6 items-center justify-center rounded-xl ${autoUploadRange === "custom" ? "bg-[#1D4ED8]" : "bg-muted"}`}>
                  <Calendar className={`h-3 w-3 ${autoUploadRange === "custom" ? "text-white" : "text-muted-foreground"}`} />
                </div>
                <div className="flex-1">
                  <p className="text-xs font-medium text-foreground">自定义范围</p>
                  <p className="text-[11px] text-muted-foreground">选择特定日期范围</p>
                </div>
                {autoUploadRange === "custom" ? (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full border border-[#1D4ED8] bg-[#1D4ED8]">
                    <Check className="h-3.5 w-3.5 text-white" />
                  </div>
                ) : (
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                )}
              </button>
              {autoUploadRange === "custom" && showCustomPicker && (
                <div className="mt-3 px-3">
                  <input
                    type="datetime-local"
                    value={customTimestamp}
                    onChange={(e) => setCustomTimestamp(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-border bg-white text-sm"
                  />
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => setShowCustomPicker(false)}
                      className="flex-1 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50"
                    >
                      取消
                    </button>
                    <button
                      onClick={() => setShowCustomPicker(false)}
                      className="flex-1 rounded-full bg-[#1D4ED8] px-4 py-2 text-sm font-medium text-white hover:bg-[#1E40AF]"
                    >
                      保存
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Info */}
        <div className="mb-5 rounded-xl border border-[#BFD3F8] bg-[#EAF2FF] p-4">
          <p className="text-xs leading-relaxed text-[#2A4F96]">
            {autoUploadSources.album && fileSourceSelected
              ? autoUploadRange === "all"
                ? `所有照片、视频和已选择的 ${selectedUploadFiles.length} 个文件将上传到您的电脑。`
                : autoUploadRange === "now"
                ? `从现在开始，新的照片、视频和已选择的 ${selectedUploadFiles.length} 个文件将同步。`
                : `所选范围内的照片、视频和已选择的 ${selectedUploadFiles.length} 个文件将上传到您的电脑。`
              : autoUploadSources.album
              ? autoUploadRange === "all"
                ? "相册中的所有照片和视频将上传到您的电脑。"
                : autoUploadRange === "now"
                ? "从现在开始，新的相册照片和视频将同步。"
                : "所选范围内的相册照片和视频将上传到您的电脑。"
              : fileSourceSelected
              ? autoUploadRange === "all"
                ? `已选择的 ${selectedUploadFiles.length} 个文件将上传到您的电脑。`
                : autoUploadRange === "now"
                ? `从现在开始，已选择的 ${selectedUploadFiles.length} 个文件将同步。`
                : `所选范围内已选择的 ${selectedUploadFiles.length} 个文件将上传到您的电脑。`
              : "请至少选择一个同步来源。"
            }
          </p>
        </div>

        <button
          ref={confirmUploadRef}
          onClick={onConfirmAutoUpload}
          disabled={!canConfirmAutoUpload}
          className={`w-full rounded-2xl px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors ${
            canConfirmAutoUpload ? "bg-[#1D4ED8] hover:bg-[#1E40AF]" : "bg-[#A8B6CC]"
          }`}
        >
          确认
        </button>
      </div>
    </div>
  )
}

function MembershipView({
  onBack,
  onNavigateGiftCard,
}: {
  onBack: () => void
  onNavigateGiftCard: () => void
}) {
  const membershipStatus = { level: "Pro Annual", daysLeft: 28, expiresAt: "2026-07-08" }

  return (
    <div className="flex h-full flex-col" style={{ backgroundColor: MOBILE_PAGE_BACKGROUND }}>
      <div
        className="flex items-center gap-3 border-b px-5 pb-4 pt-14"
        style={{ borderColor: "rgba(56, 92, 128, 0.12)" }}
      >
        <button
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-muted"
        >
          <ChevronLeft className="h-5 w-5 text-foreground" />
        </button>
        <h1 className="text-lg font-semibold text-foreground">会员状态</h1>
      </div>

      <div className="flex-1 overflow-auto px-5 py-5">
        <div className="rounded-[24px] bg-white p-5 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50">
              <Crown className="h-6 w-6 text-violet-500" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[16px] font-semibold text-foreground">{membershipStatus.level}</p>
                  <p className="mt-1 whitespace-nowrap text-[11px] text-muted-foreground">到期时间：{membershipStatus.expiresAt}</p>
                </div>
                <span className="rounded-full bg-blue-100 px-3 py-1 text-center text-[11px] font-semibold leading-4 text-blue-600">
                  剩余
                  <br />
                  {membershipStatus.daysLeft}天
                </span>
              </div>
            </div>
          </div>
          <p className="mt-4 w-full text-left text-[12px] leading-6 text-muted-foreground">
            当前已开通会员，可继续续费延长有效期，也可以通过礼品卡兑换额外时长。
          </p>
        </div>

        <div className="mt-5 rounded-[24px] bg-white p-4 shadow-sm">
          <p className="text-[13px] font-semibold text-foreground">会员权益</p>
          <div className="mt-3 space-y-3 text-[12px] text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>高速传输</span>
              <span className="font-medium text-foreground">已开启</span>
            </div>
            <div className="flex items-center justify-between">
              <span>自动上传</span>
              <span className="font-medium text-foreground">无限制</span>
            </div>
            <div className="flex items-center justify-between">
              <span>跨网络访问</span>
              <span className="font-medium text-foreground">支持</span>
            </div>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          <button className="w-full rounded-2xl bg-blue-500 py-3 text-[15px] font-semibold text-white">
            继续续费
          </button>
          <button
            onClick={onNavigateGiftCard}
            className="w-full rounded-2xl border border-gray-200 bg-white py-3 text-[15px] font-medium text-foreground"
          >
            礼品卡兑换
          </button>
        </div>
      </div>
    </div>
  )
}

function LanguageView({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<"system" | "manual">("system")
  const [language, setLanguage] = useState<"zh-Hans" | "zh-Hant" | "en" | "ja" | "ko" | "fr" | "es" | "ru">("en")

  const languageOptions = [
    { id: "zh-Hans" as const, label: "简体中文" },
    { id: "zh-Hant" as const, label: "繁体中文" },
    { id: "en" as const, label: "English" },
    { id: "ja" as const, label: "日本語" },
    { id: "ko" as const, label: "한국어" },
    { id: "fr" as const, label: "Français" },
    { id: "es" as const, label: "Español" },
    { id: "ru" as const, label: "Русский" },
  ]

  return (
    <div className="flex h-full flex-col" style={{ backgroundColor: MOBILE_PAGE_BACKGROUND }}>
      <div
        className="flex items-center gap-3 border-b px-5 pb-4 pt-14"
        style={{ borderColor: "rgba(56, 92, 128, 0.12)" }}
      >
        <button
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-muted"
        >
          <ChevronLeft className="h-5 w-5 text-foreground" />
        </button>
        <h1 className="text-lg font-semibold text-foreground">语言</h1>
      </div>

      <div className="flex-1 overflow-auto px-5 py-5">
        <div className="rounded-[24px] bg-white shadow-sm">
          <button
            onClick={() => setMode("system")}
            className="flex w-full items-center justify-between border-b border-gray-100 px-4 py-4 text-left"
          >
            <p className="text-[14px] font-medium text-foreground">跟随系统语言</p>
            <div className={`h-5 w-5 rounded-full border ${mode === "system" ? "border-[#0B78F2] bg-[#0B78F2]" : "border-gray-300 bg-white"}`}>
              {mode === "system" ? <Check className="h-4 w-4 text-white" /> : null}
            </div>
          </button>

          <button
            onClick={() => setMode("manual")}
            className="flex w-full items-center justify-between px-4 py-4 text-left"
          >
            <p className="text-[14px] font-medium text-foreground">手动选择语言</p>
            <div className={`h-5 w-5 rounded-full border ${mode === "manual" ? "border-[#0B78F2] bg-[#0B78F2]" : "border-gray-300 bg-white"}`}>
              {mode === "manual" ? <Check className="h-4 w-4 text-white" /> : null}
            </div>
          </button>
        </div>

        {mode === "manual" ? (
          <div className="mt-5 rounded-[24px] bg-white shadow-sm">
            {languageOptions.map((item, index) => {
              const active = language === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => setLanguage(item.id)}
                  className={`flex w-full items-center justify-between px-4 py-4 text-left ${
                    index < languageOptions.length - 1 ? "border-b border-gray-100" : ""
                  }`}
                >
                  <span className="text-[14px] text-foreground">{item.label}</span>
                  {active ? <Check className="h-5 w-5 text-blue-500" /> : null}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}

// Gift Card View
function GiftCardView({ onBack }: { onBack: () => void }) {
  const [giftCode, setGiftCode] = useState("")
  const [isRedeeming, setIsRedeeming] = useState(false)
  const [redeemResult, setRedeemResult] = useState<"success" | "error" | null>(null)

  const handleRedeem = () => {
    if (!giftCode.trim()) return
    setIsRedeeming(true)
    // Simulate API call
    setTimeout(() => {
      setIsRedeeming(false)
      setRedeemResult(giftCode.toLowerCase() === "vividrop" ? "success" : "error")
    }, 1500)
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: MOBILE_PAGE_BACKGROUND }}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-5 pt-14 pb-4 border-b"
        style={{ borderColor: "rgba(56, 92, 128, 0.12)", backgroundColor: MOBILE_PAGE_BACKGROUND }}
      >
        <button 
          onClick={onBack}
          className="flex items-center justify-center h-9 w-9 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <ChevronLeft className="h-5 w-5 text-foreground" />
        </button>
        <h1 className="text-lg font-semibold text-foreground">兑换礼品卡</h1>
      </div>

      <div className="flex-1 overflow-auto px-5 py-6">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 mx-auto mb-4">
            <Gift className="h-8 w-8 text-amber-500" />
          </div>
          <p className="text-center text-[15px] font-medium text-foreground mb-1">输入礼品码</p>
          <p className="text-center text-[13px] text-muted-foreground mb-5">
            输入有效礼品码以解锁 7 天免费试用
          </p>
          
          <input
            type="text"
            value={giftCode}
            onChange={(e) => { setGiftCode(e.target.value.toUpperCase()); setRedeemResult(null); }}
            placeholder="XXXX-XXXX-XXXX"
            className="w-full px-4 py-3 rounded-xl text-[15px] text-center font-mono tracking-wider outline-none mb-4"
            style={{ background: "rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.08)" }}
          />
          
          {redeemResult === "success" && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-4">
              <p className="text-[13px] text-green-700 text-center">兑换成功！已激活 7 天试用。</p>
            </div>
          )}
          
          {redeemResult === "error" && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
              <p className="text-[13px] text-red-700 text-center">礼品码无效，请重试。</p>
            </div>
          )}
          
          <button
            onClick={handleRedeem}
            disabled={!giftCode.trim() || isRedeeming}
            className="w-full py-3 rounded-xl text-[15px] font-medium transition-colors disabled:opacity-50"
            style={{ 
              background: giftCode.trim() ? "#007AFF" : "rgba(0,0,0,0.06)", 
              color: giftCode.trim() ? "white" : "#8e8e93" 
            }}
          >
            {isRedeeming ? "兑换中..." : "兑换"}
          </button>
        </div>
      </div>
    </div>
  )
}

// Help Center View
function HelpCenterView({ onBack }: { onBack: () => void }) {
  const faqs = [
    {
      id: "1",
      question: "Vivi Drop 支持哪些操作系统？",
      answer: "PC 端支持 Windows 10/11 和 macOS 10.15 及以上版本。移动端支持 iOS 14+ 和 Android 8.0+。"
    },
    {
      id: "2",
      question: "为什么需要在同一局域网内使用？",
      answer: "Vivi Drop 基于局域网直连技术实现高速传输，数据不经过任何云服务器，既保证了传输速度，又确保了数据安全。您只需将手机和电脑连接到同一个 WiFi 网络即可。"
    },
    {
      id: "3",
      question: "传输文件大小有限制吗？",
      answer: "理论上没有文件大小限制，但建议根据您的存储空间合理安排。PC 端会在剩余空间低于 500MB 时自动暂停接收，确保系统正常运行。"
    },
    {
      id: "4",
      question: "如何确保传输过程中的数据安全？",
      answer: "所有数据传输仅在您的局域网内进行，不会上传到任何云端服务器。配对需要 6 位连接码验证，防止未授权设备连接。"
    },
    {
      id: "5",
      question: "可以同时连接多台设备吗？",
      answer: "PC 端可以管理多个已配对的移动设备，每个设备的传输文件会按设备归档管理，方便追溯和查找。"
    },
    {
      id: "6",
      question: "传输中断后可以续传吗？",
      answer: "支持自动断点续传。网络恢复或重新连接后，Vivi Drop 会自动接续传输未完成的照片和视频，进度不丢失。"
    },
  ]

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: MOBILE_PAGE_BACKGROUND }}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-5 pt-14 pb-4 border-b"
        style={{ borderColor: "rgba(56, 92, 128, 0.12)", backgroundColor: MOBILE_PAGE_BACKGROUND }}
      >
        <button 
          onClick={onBack}
          className="flex items-center justify-center h-9 w-9 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <ChevronLeft className="h-5 w-5 text-foreground" />
        </button>
        <h1 className="text-lg font-semibold text-foreground">帮助</h1>
      </div>

      <div className="flex-1 overflow-auto px-5 py-5">
        <div className="space-y-4">
          {faqs.map((faq) => (
            <div key={faq.id} className="rounded-[24px] bg-white px-5 py-5 shadow-sm">
              <p className="text-[13px] font-semibold text-foreground">{faq.question}</p>
              <p className="mt-4 text-[11px] leading-6 text-muted-foreground">{faq.answer}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
