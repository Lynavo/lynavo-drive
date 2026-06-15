"use client"

import { useState } from "react"
import {
  User,
  Crown,
  Gift,
  Smartphone,
  Pencil,
  Check,
  Monitor,
  ChevronRight,
  Globe,
  Info,
  LogOut,
  Upload,
  HelpCircle,
  RefreshCw,
  X,
} from "lucide-react"

interface ConnectedDevice {
  id: string
  name: string
  status: "current" | "online" | "offline"
  lastConnected?: string
}

interface SettingsPageProps {
  deviceName?: string
  onBack?: () => void
  onDisconnect?: () => void
  connectedPc?: { name: string; ip: string }
  isSubscribed?: boolean
  isExpired?: boolean
  trialDaysLeft?: number
  subscriptionExpiry?: string
  daysUntilExpiry?: number | null
  onNavigateSubscription?: () => void
  onNavigateHelp?: () => void
  onNavigateScan?: () => void
  onLogout?: () => void
  phoneNumber?: string
  email?: string
}

export function SettingsPage({
  onBack,
  onDisconnect,
  connectedPc,
  isSubscribed = false,
  isExpired = false,
  trialDaysLeft = 5,
  subscriptionExpiry,
  daysUntilExpiry = null,
  onNavigateSubscription,
  onNavigateHelp,
  onNavigateScan,
  onLogout,
  phoneNumber = "+1 206 **** 1234",
  email,
}: SettingsPageProps) {
  const [editingDeviceName, setEditingDeviceName] = useState(false)
  const [deviceName, setDeviceName] = useState("iPhone 15 Pro")
  const [tempDeviceName, setTempDeviceName] = useState("")
  const [showLogoutModal, setShowLogoutModal] = useState(false)
  const [showGiftCardModal, setShowGiftCardModal] = useState(false)
  const [showDiagnosticModal, setShowDiagnosticModal] = useState(false)
  const [showRestorePurchaseModal, setShowRestorePurchaseModal] = useState(false)
  const [showLanguageSheet, setShowLanguageSheet] = useState(false)
  const [giftCode, setGiftCode] = useState("")
  const [giftCodeStatus, setGiftCodeStatus] = useState<"idle" | "success" | "error">("idle")
  const [diagnosticDescription, setDiagnosticDescription] = useState("")
  const [diagnosticStatus, setDiagnosticStatus] = useState<"idle" | "uploading" | "success" | "error">("idle")
  const [language, setLanguage] = useState<"system" | "zh" | "en">("system")

  // Mock connected devices
  const [connectedDevices] = useState<ConnectedDevice[]>([
    { id: "1", name: "MacBook Pro", status: "current" },
    { id: "2", name: "Windows Workstation", status: "online", lastConnected: "2 days ago" },
    { id: "3", name: "Office PC", status: "offline" },
  ])

  const currentVersion = "2.1.0"
  const hasUpdate = false

  // Membership status - Trial badge is blue as shown in screenshot
  const getMembershipInfo = () => {
    if (isSubscribed) {
      return { 
        subtitle: daysUntilExpiry !== null ? `专业版 · 剩余 ${daysUntilExpiry} 天` : (subscriptionExpiry || "专业版"), 
        badge: "专业版", 
        badgeColor: "#8B5CF6", 
        badgeBg: "rgba(139,92,246,0.12)" 
      }
    }
    if (isExpired) {
      return { 
        subtitle: "已过期 · 立即续订", 
        badge: "已过期", 
        badgeColor: "#EF4444", 
        badgeBg: "rgba(239,68,68,0.10)" 
      }
    }
    // Trial badge is blue as shown in screenshot
    return { 
      subtitle: `试用 · 剩余 ${trialDaysLeft} 天`, 
      badge: "试用", 
      badgeColor: "#3B82F6", 
      badgeBg: "rgba(59,130,246,0.12)" 
    }
  }

  const membershipInfo = getMembershipInfo()

  const getLanguageLabel = () => {
    switch (language) {
      case "system": return "跟随系统"
      case "zh": return "中文"
      case "en": return "英文"
    }
  }

  // Handle gift code redemption
  const handleRedeemGiftCode = () => {
    if (!giftCode.trim()) return
    setTimeout(() => {
      if (giftCode.toUpperCase() === "VIVIDROP") {
        setGiftCodeStatus("success")
        setTimeout(() => {
          setShowGiftCardModal(false)
          setGiftCode("")
          setGiftCodeStatus("idle")
        }, 2000)
      } else {
        setGiftCodeStatus("error")
      }
    }, 500)
  }

  // Handle diagnostic upload
  const handleDiagnosticUpload = () => {
    setDiagnosticStatus("uploading")
    setTimeout(() => {
      setDiagnosticStatus("success")
      setTimeout(() => {
        setShowDiagnosticModal(false)
        setDiagnosticDescription("")
        setDiagnosticStatus("idle")
      }, 2000)
    }, 1500)
  }

  // Card style
  const cardStyle: React.CSSProperties = {
    background: "#ffffff",
    borderRadius: 16,
    border: "1px solid rgba(0,0,0,0.05)",
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  }

  // Icon container style
  const iconBox = (bg: string): React.CSSProperties => ({
    width: 36,
    height: 36,
    borderRadius: 10,
    background: bg,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  })

  const divider: React.CSSProperties = { borderBottom: "1px solid rgba(0,0,0,0.05)" }

  return (
    <div className="flex min-h-screen w-full flex-col" style={{ background: "#F7F9FC" }}>
      {/* Header */}
      <header className="px-5 pt-14 pb-4">
        <h1 className="text-[28px] font-bold tracking-tight" style={{ color: "#1c1c1e" }}>设置</h1>
      </header>

      <main className="flex-1 overflow-y-auto px-4 pb-32 space-y-6">

        {/* ══════════════════════════════════════════════════════════════════
            MY ACCOUNT
        ══════════════════════════════════════════════════════════════════ */}
        <section>
          <p className="text-[11px] font-semibold tracking-wider uppercase px-1 mb-2" style={{ color: "#8e8e93" }}>我的账户</p>
          <div style={cardStyle}>
            {/* Account - Pink icon */}
            <div className="flex items-center gap-3 px-4 py-3.5" style={divider}>
              <div style={iconBox("rgba(255,45,85,0.10)")}>
                <User className="h-[18px] w-[18px]" style={{ color: "#FF2D55" }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-medium" style={{ color: "#1c1c1e" }}>账户</p>
                <p className="text-[13px]" style={{ color: "#8e8e93" }}>{email || phoneNumber}</p>
              </div>
              <ChevronRight className="h-5 w-5" style={{ color: "#c7c7cc" }} />
            </div>

            {/* Membership - Purple/Violet icon */}
            <button onClick={onNavigateSubscription} className="w-full flex items-center gap-3 px-4 py-3.5 transition-colors active:bg-black/[0.02]" style={divider}>
              <div style={iconBox("rgba(139,92,246,0.10)")}>
                <Crown className="h-[18px] w-[18px]" style={{ color: "#8B5CF6" }} />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[15px] font-medium" style={{ color: "#1c1c1e" }}>会员</p>
                <p className="text-[13px]" style={{ color: "#8e8e93" }}>{membershipInfo.subtitle}</p>
              </div>
              <span
                className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                style={{ color: membershipInfo.badgeColor, background: membershipInfo.badgeBg }}
              >
                {membershipInfo.badge}
              </span>
            </button>

            {/* Restore Purchases - Blue icon */}
            <button onClick={() => setShowRestorePurchaseModal(true)} className="w-full flex items-center gap-3 px-4 py-3.5 transition-colors active:bg-black/[0.02]" style={divider}>
              <div style={iconBox("rgba(59,130,246,0.10)")}>
                <RefreshCw className="h-[18px] w-[18px]" style={{ color: "#3B82F6" }} />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[15px] font-medium" style={{ color: "#1c1c1e" }}>恢复已购买订阅</p>
                <p className="text-[13px]" style={{ color: "#8e8e93" }}>从应用商店检查历史购买记录</p>
              </div>
              <ChevronRight className="h-5 w-5" style={{ color: "#c7c7cc" }} />
            </button>

            {/* Redeem Gift Card - Yellow icon */}
            <button onClick={() => setShowGiftCardModal(true)} className="w-full flex items-center gap-3 px-4 py-3.5 transition-colors active:bg-black/[0.02]">
              <div style={iconBox("rgba(255,204,0,0.15)")}>
                <Gift className="h-[18px] w-[18px]" style={{ color: "#FFCC00" }} />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[15px] font-medium" style={{ color: "#1c1c1e" }}>兑换礼品卡</p>
                <p className="text-[13px]" style={{ color: "#8e8e93" }}>输入礼品码以解锁 7 天试用</p>
              </div>
              <ChevronRight className="h-5 w-5" style={{ color: "#c7c7cc" }} />
            </button>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            MY DEVICE
        ══════════════════════════════════════════════════════════════════ */}
        <section>
          <p className="text-[11px] font-semibold tracking-wider uppercase px-1 mb-2" style={{ color: "#8e8e93" }}>我的设备</p>
          <div style={cardStyle}>
            <div className="flex items-center gap-3 px-4 py-3.5">
              <div style={iconBox("rgba(59,130,246,0.10)")}>
                <Smartphone className="h-[18px] w-[18px]" style={{ color: "#3B82F6" }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-medium" style={{ color: "#1c1c1e" }}>设备名称</p>
                {editingDeviceName ? (
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      value={tempDeviceName}
                      onChange={(e) => setTempDeviceName(e.target.value)}
                      className="flex-1 text-[13px] bg-transparent outline-none border-b-2 py-0.5"
                      style={{ color: "#1c1c1e", borderColor: "#3B82F6" }}
                      autoFocus
                    />
                    <button
                      onClick={() => {
                        if (tempDeviceName.trim()) setDeviceName(tempDeviceName.trim())
                        setEditingDeviceName(false)
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded-full"
                      style={{ background: "rgba(59,130,246,0.12)" }}
                    >
                      <Check className="h-3.5 w-3.5" style={{ color: "#3B82F6" }} />
                    </button>
                    <button
                      onClick={() => setEditingDeviceName(false)}
                      className="flex h-6 w-6 items-center justify-center rounded-full"
                      style={{ background: "rgba(0,0,0,0.05)" }}
                    >
                      <X className="h-3.5 w-3.5" style={{ color: "#8e8e93" }} />
                    </button>
                  </div>
                ) : (
                  <p className="text-[13px]" style={{ color: "#8e8e93" }}>{deviceName}</p>
                )}
              </div>
              {!editingDeviceName && (
                <button
                  onClick={() => {
                    setTempDeviceName(deviceName)
                    setEditingDeviceName(true)
                  }}
                  className="p-2 rounded-full transition-colors active:bg-black/5"
                >
                  <Pencil className="h-4 w-4" style={{ color: "#c7c7cc" }} />
                </button>
              )}
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            CONNECTED DEVICES
        ══════════════════════════════════════════════════════════════════ */}
        <section>
          <p className="text-[11px] font-semibold tracking-wider uppercase px-1 mb-2" style={{ color: "#8e8e93" }}>已连接设备</p>
          <div style={cardStyle}>
            {connectedDevices.map((device, idx) => (
              <div
                key={device.id}
                className="flex items-center gap-3 px-4 py-3.5"
                style={idx < connectedDevices.length - 1 ? divider : {}}
              >
                <div style={iconBox(
                  device.status === "current" ? "rgba(139,92,246,0.10)" :
                  device.status === "online" ? "rgba(59,130,246,0.10)" : "rgba(0,0,0,0.05)"
                )}>
                  <Monitor
                    className="h-[18px] w-[18px]"
                    style={{
                      color: device.status === "current" ? "#8B5CF6" :
                             device.status === "online" ? "#3B82F6" : "#9ca3af"
                    }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-medium" style={{ color: device.status === "offline" ? "#9ca3af" : "#1c1c1e" }}>
                    {device.name}
                  </p>
                  <p className="text-[13px]" style={{ color: "#8e8e93" }}>
                    {device.status === "current" ? "当前设备" :
                     device.status === "offline" ? "离线" :
                     `最后连接：${device.lastConnected}`}
                  </p>
                </div>
                  {device.status === "current" ? (
                  <span
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                    style={{ color: "#22C55E", background: "rgba(34,197,94,0.12)" }}
                  >
                    当前
                  </span>
                ) : (
                  <button
                    onClick={device.status === "online" ? onNavigateScan : undefined}
                    disabled={device.status === "offline"}
                    className="text-[12px] font-medium px-3 py-1.5 rounded-lg transition-opacity"
                    style={{
                      background: device.status === "offline" ? "rgba(0,0,0,0.04)" : "rgba(59,130,246,0.10)",
                      color: device.status === "offline" ? "#c7c7cc" : "#3B82F6",
                    }}
                  >
                    连接
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            GENERAL
        ══════════════════════════════════════════════════════════════════ */}
        <section>
          <p className="text-[11px] font-semibold tracking-wider uppercase px-1 mb-2" style={{ color: "#8e8e93" }}>通用</p>
          <div style={cardStyle}>
            {/* Language - Blue icon */}
            <button onClick={() => setShowLanguageSheet(true)} className="w-full flex items-center gap-3 px-4 py-3.5 transition-colors active:bg-black/[0.02]" style={divider}>
              <div style={iconBox("rgba(59,130,246,0.10)")}>
                <Globe className="h-[18px] w-[18px]" style={{ color: "#3B82F6" }} />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[15px] font-medium" style={{ color: "#1c1c1e" }}>语言</p>
                <p className="text-[13px]" style={{ color: "#8e8e93" }}>{getLanguageLabel()}</p>
              </div>
              <ChevronRight className="h-5 w-5" style={{ color: "#c7c7cc" }} />
            </button>

            {/* Version - Purple icon */}
            <div className="flex items-center gap-3 px-4 py-3.5" style={divider}>
              <div style={iconBox("rgba(139,92,246,0.10)")}>
                <Info className="h-[18px] w-[18px]" style={{ color: "#8B5CF6" }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-medium" style={{ color: "#1c1c1e" }}>版本</p>
                <p className="text-[13px]" style={{ color: "#8e8e93" }}>版本 {currentVersion}</p>
              </div>
              {hasUpdate ? (
                <button
                  className="text-[12px] font-medium px-3 py-1.5 rounded-lg text-white"
                  style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
                >
                  更新
                </button>
              ) : (
                <span className="text-[12px] font-medium" style={{ color: "#22C55E" }}>已是最新</span>
              )}
            </div>

            {/* Log Out - Red icon and text */}
            <button onClick={() => setShowLogoutModal(true)} className="w-full flex items-center gap-3 px-4 py-3.5 transition-colors active:bg-black/[0.02]">
              <div style={iconBox("rgba(239,68,68,0.10)")}>
                <LogOut className="h-[18px] w-[18px]" style={{ color: "#EF4444" }} />
              </div>
              <p className="flex-1 text-[15px] font-medium text-left" style={{ color: "#EF4444" }}>退出登录</p>
            </button>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            SUPPORT & HELP
        ══════════════════════════════════════════════════════════════════ */}
        <section>
          <p className="text-[11px] font-semibold tracking-wider uppercase px-1 mb-2" style={{ color: "#8e8e93" }}>支持与帮助</p>
          <div style={cardStyle}>
            {/* Upload Diagnostic Package - Orange icon */}
            <button onClick={() => setShowDiagnosticModal(true)} className="w-full flex items-center gap-3 px-4 py-3.5 transition-colors active:bg-black/[0.02]" style={divider}>
              <div style={iconBox("rgba(249,115,22,0.10)")}>
                <Upload className="h-[18px] w-[18px]" style={{ color: "#F97316" }} />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[15px] font-medium" style={{ color: "#1c1c1e" }}>上传诊断包</p>
                <p className="text-[13px]" style={{ color: "#8e8e93" }}>发送日志，帮助我们快速排查问题</p>
              </div>
              <ChevronRight className="h-5 w-5" style={{ color: "#c7c7cc" }} />
            </button>

            {/* Help - Green icon */}
            <button onClick={onNavigateHelp} className="w-full flex items-center gap-3 px-4 py-3.5 transition-colors active:bg-black/[0.02]">
              <div style={iconBox("rgba(34,197,94,0.10)")}>
                <HelpCircle className="h-[18px] w-[18px]" style={{ color: "#22C55E" }} />
              </div>
              <div className="flex-1 min-w-0 text-left">
              <p className="text-[15px] font-medium" style={{ color: "#1c1c1e" }}>帮助</p>
              <p className="text-[13px]" style={{ color: "#8e8e93" }}>常见问题与快速上手指南</p>
              </div>
              <ChevronRight className="h-5 w-5" style={{ color: "#c7c7cc" }} />
            </button>
          </div>
        </section>

      </main>

      {/* ══════════════════════════════════════════════════════════════════
          MODALS & BOTTOM SHEETS
      ══════════════════════════════════════════════════════════════════ */}

      {/* Log Out Confirmation */}
      {showLogoutModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setShowLogoutModal(false)}
        >
          <div
            className="w-full max-w-[300px] rounded-2xl overflow-hidden"
            style={{ background: "#fff", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 pt-6 pb-4 text-center">
            <p className="text-[17px] font-semibold mb-2" style={{ color: "#1c1c1e" }}>退出登录？</p>
            <p className="text-[14px] leading-relaxed" style={{ color: "#8e8e93" }}>
              确认要退出当前账号吗？退出后需重新登录才能继续使用。
              </p>
            </div>
            <div className="flex gap-3 px-4 pb-4">
              <button
                onClick={() => setShowLogoutModal(false)}
                className="flex-1 py-3 rounded-xl text-[15px] font-medium transition-colors active:opacity-70"
                style={{ background: "rgba(0,0,0,0.06)", color: "#1c1c1e" }}
              >
                取消
              </button>
              <button
                onClick={() => { setShowLogoutModal(false); onLogout?.() }}
                className="flex-1 py-3.5 rounded-xl text-[15px] font-medium transition-colors active:opacity-70"
                style={{ background: "#EF4444", color: "#fff" }}
              >
                退出登录
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore Purchases Modal */}
      {showRestorePurchaseModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setShowRestorePurchaseModal(false)}
        >
          <div
            className="w-full max-w-[300px] rounded-2xl overflow-hidden"
            style={{ background: "#fff", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 pt-6 pb-4 text-center">
              <p className="text-[17px] font-semibold mb-2" style={{ color: "#1c1c1e" }}>恢复已购买订阅</p>
              <p className="text-[14px] leading-relaxed" style={{ color: "#8e8e93" }}>
                正在从应用商店检查当前账号的历史购买记录。
              </p>
            </div>
            <div className="px-4 pb-4">
              <button
                onClick={() => setShowRestorePurchaseModal(false)}
                className="w-full py-3.5 rounded-xl text-[15px] font-medium text-white transition-colors active:opacity-70"
                style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Gift Card Modal */}
      {showGiftCardModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => { setShowGiftCardModal(false); setGiftCode(""); setGiftCodeStatus("idle") }}
        >
          <div
            className="w-full max-w-[500px] rounded-t-3xl overflow-hidden pb-8"
            style={{ background: "#fff" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-9 h-1 rounded-full" style={{ background: "rgba(0,0,0,0.15)" }} />
            </div>
            <div className="px-5">
              <p className="text-[20px] font-semibold mb-2" style={{ color: "#1c1c1e" }}>兑换礼品卡</p>
              <p className="text-[14px] mb-5" style={{ color: "#8e8e93" }}>
                输入礼品码以激活 7 天免费试用。
              </p>

              {giftCodeStatus === "success" && (
                <div className="flex items-center gap-2 p-4 rounded-xl mb-4" style={{ background: "rgba(34,197,94,0.1)" }}>
                  <Check size={20} style={{ color: "#22C55E" }} />
                  <p className="text-[14px]" style={{ color: "#22C55E" }}>礼品卡兑换成功，7 天试用已激活。</p>
                </div>
              )}

              {giftCodeStatus === "error" && (
                <div className="flex items-center gap-2 p-4 rounded-xl mb-4" style={{ background: "rgba(239,68,68,0.1)" }}>
                  <X size={20} style={{ color: "#EF4444" }} />
                  <p className="text-[14px]" style={{ color: "#EF4444" }}>礼品码无效，请重试。</p>
                </div>
              )}

              <input
                type="text"
                value={giftCode}
                onChange={(e) => { setGiftCode(e.target.value); setGiftCodeStatus("idle") }}
                placeholder="请输入礼品码"
                className="w-full px-4 py-3.5 rounded-2xl mb-4 text-[15px] outline-none"
                style={{ background: "#f2f2f7", color: "#1c1c1e" }}
              />
              <div className="flex gap-3">
                <button
                  onClick={() => { setShowGiftCardModal(false); setGiftCode(""); setGiftCodeStatus("idle") }}
                  className="flex-1 py-3.5 rounded-xl text-[15px] font-medium"
                  style={{ background: "#f2f2f7", color: "#1c1c1e" }}
                >
                  取消
                </button>
                <button
                  onClick={handleRedeemGiftCode}
                  className="flex-1 py-3.5 rounded-xl text-[15px] font-medium text-white"
                  style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
                >
                  兑换
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Language Bottom Sheet */}
      {showLanguageSheet && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setShowLanguageSheet(false)}
        >
          <div
            className="w-full max-w-[500px] rounded-t-3xl overflow-hidden pb-8"
            style={{ background: "#fff" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-9 h-1 rounded-full" style={{ background: "rgba(0,0,0,0.15)" }} />
            </div>
            <p className="text-[17px] font-semibold text-center px-4 pb-4" style={{ color: "#1c1c1e" }}>语言</p>
            <div className="px-4">
              {[
                { value: "system" as const, label: "跟随系统" },
                { value: "en" as const, label: "英文" },
                { value: "zh" as const, label: "中文" },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    setLanguage(option.value)
                    setShowLanguageSheet(false)
                  }}
                  className="flex items-center justify-between w-full px-4 py-4 rounded-xl mb-1 transition-colors active:bg-black/5"
                  style={{ background: language === option.value ? "rgba(99,102,241,0.08)" : "transparent" }}
                >
                  <span className="text-[15px]" style={{ color: "#1c1c1e" }}>{option.label}</span>
                  {language === option.value && <Check size={20} style={{ color: "#6366f1" }} />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Diagnostic Upload Modal */}
      {showDiagnosticModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-5"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => { setShowDiagnosticModal(false); setDiagnosticDescription(""); setDiagnosticStatus("idle") }}
        >
          <div
            className="w-full max-w-[340px] rounded-2xl overflow-hidden p-5"
            style={{ background: "#fff", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[17px] font-semibold mb-2" style={{ color: "#1c1c1e" }}>上传诊断包</p>
            <p className="text-[13px] leading-relaxed mb-4" style={{ color: "#8e8e93" }}>
              诊断包包含应用日志、设备状态、传输记录和错误信息，帮助支持团队更快定位并解决问题。
            </p>

            {diagnosticStatus === "success" && (
              <div className="flex items-center gap-2 p-3 rounded-xl mb-4" style={{ background: "rgba(34,197,94,0.1)" }}>
                <Check size={18} style={{ color: "#22C55E" }} />
                <p className="text-[13px]" style={{ color: "#22C55E" }}>诊断包上传成功。</p>
              </div>
            )}

            {diagnosticStatus === "error" && (
              <div className="flex items-center gap-2 p-3 rounded-xl mb-4" style={{ background: "rgba(239,68,68,0.1)" }}>
                <X size={18} style={{ color: "#EF4444" }} />
                <p className="text-[13px]" style={{ color: "#EF4444" }}>上传失败，请重试。</p>
              </div>
            )}

            <textarea
              value={diagnosticDescription}
              onChange={(e) => setDiagnosticDescription(e.target.value)}
              placeholder="请描述您遇到的问题..."
              rows={3}
              className="w-full px-4 py-3 rounded-xl text-[15px] mb-4 outline-none resize-none"
              style={{ background: "#f2f2f7", color: "#1c1c1e" }}
            />

            <div className="flex gap-3">
              <button
                onClick={() => { setShowDiagnosticModal(false); setDiagnosticDescription(""); setDiagnosticStatus("idle") }}
                className="flex-1 py-3 rounded-xl text-[15px] font-medium"
                style={{ background: "#f2f2f7", color: "#1c1c1e" }}
              >
                取消
              </button>
              <button
                onClick={handleDiagnosticUpload}
                disabled={diagnosticStatus === "uploading"}
                className="flex-1 py-3 rounded-xl text-[15px] font-medium text-white disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
              >
                {diagnosticStatus === "uploading" ? "正在上传..." : "上传"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
