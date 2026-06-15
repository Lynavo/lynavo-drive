"use client"

import { useState } from "react"
import { LoginPage } from "./login-page"
import { ScanPage } from "./scan-page"
import { ConnectionPage } from "./connection-page"
import { TransferPage } from "./transfer-page"
import { HistoryPage } from "./history-page"
import { SettingsPage } from "./settings-page"
import { AlbumPage } from "./album-page"
import { PublicFilesPage } from "./public-files-page"
import { SmbConnectPage } from "./smb-connect-page"
import { SubscriptionPage } from "./subscription-page"
import { QrScanPage } from "./qr-scan-page"
import { HelpPage } from "./help-page"
import { ConnectionTutorialPage } from "./connection-tutorial-page"
import { OnboardingOverlay } from "./onboarding-overlay"

export type GlobalTransferState = "idle" | "auto_syncing" | "transitioning" | "manual_uploading" | "manual_completed" | "auto_completed"

export interface QueueItem {
  id: string
  name: string
  size: string
  source: "manual" | "auto"
  status: "transferring" | "queued"
  progress?: number
}

type MobileView =
  | "onboarding"
  | "login"
  | "scan"
  | "qr-scan"
  | "connection"
  | "transfer"
  | "history"
  | "settings"
  | "album"
  | "public-files"
  | "smb-connect"
  | "subscription"
  | "help"
  | "connection-tutorial"

// Simulated set of already-transferred file IDs
const TRANSFERRED_IDS = new Set(["a1", "a2", "a3"])

export function MobileApp() {
  const [view, setView] = useState<MobileView>("login")
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [afterLoginView, setAfterLoginView] = useState<MobileView>("transfer")
  const [showGuideAfterLogin, setShowGuideAfterLogin] = useState(false)
  const [selectedDevice, setSelectedDevice] = useState<{ name: string; ip: string } | null>(null)
  // Subscription / trial status
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [trialDaysLeft, setTrialDaysLeft] = useState(0)  // 0 = expired for demo; set to 7 for trial state
  // Days until subscription expires (null = not subscribed / no expiry date)
  // Set to e.g. 3 to demo the "expiring soon" reminder banner
  const [daysUntilExpiry, setDaysUntilExpiry] = useState<number | null>(null)
  const isExpired = !isSubscribed && trialDaysLeft <= 0
  // Subscription expiring soon: subscribed and within 7 days of expiry
  const isExpiringSoon = isSubscribed && daysUntilExpiry !== null && daysUntilExpiry <= 7
  // Keep isPro as alias so existing child props compile without change
  const isPro = isSubscribed
  // Sync completed state
  const [syncCompleted, setSyncCompleted] = useState(false)
  // Track which view to return to after subscription
  const [returnView, setReturnView] = useState<MobileView>("transfer")

  // --- Global transfer state machine ---
  const [globalTransferState, setGlobalTransferState] = useState<GlobalTransferState>("auto_completed")
  const [manualQueue, setManualQueue] = useState<QueueItem[]>([])
  const [suspendedAutoQueue, setSuspendedAutoQueue] = useState<QueueItem[]>([])
  // Auto-upload enabled state — lifted here so both AlbumPage and TransferPage can share it
  const [autoUploadEnabled, setAutoUploadEnabled] = useState(false)

  const handleStartAutoSync = () => {
    setAutoUploadEnabled(true)
    setGlobalTransferState("auto_syncing")
  }

  const handleStopAutoSync = () => {
    setAutoUploadEnabled(false)
    setGlobalTransferState("idle")
  }

  // Called when auto sync has finished uploading all pending files
  const handleAutoSyncCompleted = () => {
    setGlobalTransferState("auto_completed")
  }

  // Called from AlbumPage after conflict resolution
  // If auto is running, AlbumPage shows interrupt confirm first — this is only called after user confirms
  const handleStartManualTransfer = (items: { id: string; name: string; size: string }[]) => {
    const newItems: QueueItem[] = items.map((item) => ({
      id: item.id,
      name: item.name,
      size: item.size,
      source: "manual",
      status: "queued",
    }))
    setManualQueue(newItems)
    // If auto was syncing, interrupt it immediately and switch to manual
    if (globalTransferState === "auto_syncing") {
      setGlobalTransferState("transitioning")
      setView("transfer")
      setTimeout(() => {
        setGlobalTransferState("manual_uploading")
      }, 1200)
    } else {
      // Idle or already manual — just start
      setGlobalTransferState("manual_uploading")
      setView("transfer")
    }
  }

  // Manual transfer finished → show completed state, then resume auto after dismiss
  const handleCancelManual = () => {
    setGlobalTransferState("manual_completed")
    // Keep manualQueue intact so stats can be derived in TransferPage
  }

  // Stop auto sync
  const handleCancelAutoSync = () => {
    setGlobalTransferState("idle")
  }

  if (view === "login") {
    return (
      <LoginPage
        onLoginSuccess={() => {
          setIsLoggedIn(true)
          setView("onboarding")
        }}
      />
    )
  }

  if (view === "onboarding") {
    return (
      <OnboardingOverlay
        onDismiss={() => setView("transfer")}
        onNavigateScan={() => setView("scan")}
        onNavigateHelp={() => setView("transfer")}
      />
    )
  }

  if (view === "scan") {
    return (
      <ScanPage
        onSelectDevice={(device) => {
          setSelectedDevice({ name: device.name, ip: device.ip })
          setView("connection")
        }}
        onNavigateQrScan={() => setView("qr-scan")}
        onNavigateHelp={() => setView("connection-tutorial")}
      />
    )
  }

  if (view === "qr-scan") {
    return (
      <QrScanPage
        onBack={() => setView("scan")}
        onScanSuccess={(device) => {
          setSelectedDevice(device)
          setView("connection")
        }}
        onNavigateHelp={() => setView("connection-tutorial")}
      />
    )
  }

  if (view === "subscription") {
    return (
      <SubscriptionPage
        onBack={() => setView(isLoggedIn ? returnView : "login")}
        onSubscribe={() => {
          setIsSubscribed(true)
          setView(returnView)
        }}
        onLogout={() => {
          setIsLoggedIn(false)
          setView("login")
        }}
        isExpired={isExpired}
        trialDaysLeft={trialDaysLeft}
      />
    )
  }

  if (view === "connection") {
    return (
      <ConnectionPage
        onConnect={() => setView("transfer")}
        onBack={() => setView("scan")}
        deviceName={selectedDevice?.name}
        deviceIp={selectedDevice?.ip}
        onNavigateHelp={() => setView("connection-tutorial")}
      />
    )
  }

  if (view === "history") {
    return <HistoryPage onBack={() => setView("transfer")} />
  }

  if (view === "album") {
    return (
      <AlbumPage
        onBack={() => setView("transfer")}
        onStartTransfer={handleStartManualTransfer}
        transferredIds={TRANSFERRED_IDS}
        isPro={isPro}
        onUpgradePro={() => {
          setReturnView("album")
          setView("subscription")
        }}
        globalTransferState={globalTransferState}
        autoUploadEnabled={autoUploadEnabled}
        onStartAutoSync={handleStartAutoSync}
        onStopAutoSync={handleStopAutoSync}
      />
    )
  }

  if (view === "public-files") {
    return (
      <PublicFilesPage
        onBack={() => setView("transfer")}
        isPro={isPro}
        onUpgradePro={() => {
          setReturnView("public-files")
          setView("subscription")
        }}
      />
    )
  }

  if (view === "smb-connect") {
    return (
      <SmbConnectPage
        onBack={() => setView("settings")}
        onConnected={() => setView("transfer")}
        isPro={isPro}
        onUpgradePro={() => {
          setReturnView("smb-connect")
          setView("subscription")
        }}
      />
    )
  }

  if (view === "help") {
    return <HelpPage onBack={() => setView("settings")} />
  }

  if (view === "connection-tutorial") {
    return (
      <ConnectionTutorialPage
        onBack={() => setView("scan")}
        onNavigateQrScan={() => setView("qr-scan")}
        onNavigateScan={() => setView("scan")}
      />
    )
  }

  if (view === "settings") {
    return (
      <SettingsPage
        deviceName={selectedDevice ? `${selectedDevice.name} \u00b7 ${selectedDevice.ip}` : "\u672a\u8fde\u63a5"}
        onBack={() => setView("transfer")}
        onDisconnect={() => {
          setSelectedDevice(null)
          setView("scan")
        }}
        connectedPc={selectedDevice || undefined}
        isSubscribed={isSubscribed}
        isExpired={isExpired}
        trialDaysLeft={trialDaysLeft}
        subscriptionExpiry={isSubscribed ? "2027-04-15" : undefined}
        daysUntilExpiry={daysUntilExpiry}
        onNavigateSubscription={() => {
          setReturnView("settings")
          setView("subscription")
        }}
        onNavigateHelp={() => setView("help")}
        onNavigateScan={() => setView("qr-scan")}
        onLogout={() => {
          setIsLoggedIn(false)
          setView("login")
        }}
        phoneNumber="138****1234"
      />
    )
  }

  return (
    <TransferPage
      onNavigateHistory={() => setView("history")}
      onNavigateSettings={() => setView("settings")}
      onNavigateAlbum={() => setView("album")}
      onNavigatePublicFiles={() => setView("public-files")}
      onNavigateSubscription={() => {
        setReturnView("transfer")
        setView("subscription")
      }}
      trialDaysLeft={trialDaysLeft}
      isPro={isPro}
      isExpired={isExpired}
      isExpiringSoon={isExpiringSoon}
      daysUntilExpiry={daysUntilExpiry}
      syncCompleted={syncCompleted}
      onNavigateHelp={() => setView("help")}
      onNavigateScan={() => setView("qr-scan")}
      autoShowGuide={true}
      globalTransferState={globalTransferState}
      manualQueue={manualQueue}
      onCancelManual={handleCancelManual}
      manualCompletedStats={{
        fileCount: manualQueue.length,
        totalCount: manualQueue.length,
        totalSize: "6.2 GB",
      }}
      autoCompletedStats={{
        fileCount: 38,
        totalSize: "12.4 GB",
        lastSyncTime: "今天 14:32",
      }}
      onCancelAutoSync={handleCancelAutoSync}
      autoUploadEnabled={autoUploadEnabled}
      onStartAutoSync={handleStartAutoSync}
      onStopAutoSync={handleStopAutoSync}
    />
  )
}
