"use client"

import { useState, useEffect } from "react"
import { ArrowLeft, Check, X, Loader2, CheckCircle2, Crown } from "lucide-react"

interface SubscriptionPageProps {
  onBack: () => void
  onSubscribe: () => void
  onLogout?: () => void
  trialDaysLeft?: number
  isExpired?: boolean
}

type PaymentStep = "select" | "processing" | "success"

const PLANS = [
  {
    id: "monthly",
    label: "月度订阅",
    price: "¥9.9",
    perMonth: "¥9.9/月",
    totalPrice: null,
    badge: null,
    savingLabel: null,
  },
  {
    id: "ten_months",
    label: "12个月套餐",
    price: "¥99",
    perMonth: "¥8.25/月",
    totalPrice: "¥118.8",
    badge: "8.3折",
    savingLabel: "8.3折优惠",
  },
]

const PRO_FEATURES = [
  "自动上传相册新增素材",
  "自定义自动上传起始时间，支持精确到时分秒",
  "访问并下载当前连接电脑的共享目录内容",
  "预览共享目录中的图片与视频",
  "多设备连接与切换使用",
  "无限量上传素材",
]

export function SubscriptionPage({ onBack, onSubscribe, onLogout, trialDaysLeft, isExpired }: SubscriptionPageProps) {
  const [selectedPlan, setSelectedPlan] = useState("ten_months")
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [paymentStep, setPaymentStep] = useState<PaymentStep>("select")
  const [selectedPayment, setSelectedPayment] = useState<"wechat" | "alipay" | null>(null)

  const hasTrial = trialDaysLeft !== undefined && trialDaysLeft > 0
  const selectedPlanData = PLANS.find((p) => p.id === selectedPlan)!

  const handleSelectPayment = (method: "wechat" | "alipay") => {
    setSelectedPayment(method)
    setPaymentStep("processing")
    setTimeout(() => {
      setPaymentStep("success")
    }, 2000)
  }

  const handlePaymentComplete = () => {
    setShowPaymentModal(false)
    setPaymentStep("select")
    setSelectedPayment(null)
    onSubscribe()
  }

  useEffect(() => {
    if (!showPaymentModal) {
      setPaymentStep("select")
      setSelectedPayment(null)
    }
  }, [showPaymentModal])

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden"
      style={{ background: "#dceefa" }}
    >
      {/* Header */}
      <header className="shrink-0 px-4 pt-12 pb-3">
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="p-2 -ml-2" style={{ color: "#1a3a5c" }}>
            <ArrowLeft className="h-6 w-6" strokeWidth={2.5} />
          </button>
          <span className="text-base font-bold" style={{ color: "#1a3a5c" }}>{"会员订阅"}</span>
          <div className="w-10" />
        </div>
      </header>

      <main className="flex flex-1 flex-col overflow-y-auto px-5 pb-8 gap-5">

        {/* ── Hero title ── */}
        <div className="pt-2">
          <h1 className="text-[26px] font-bold leading-tight mb-1.5" style={{ color: "#1c1c1e" }}>
            {"解锁完整版"}
          </h1>
          <p className="text-[14px] leading-relaxed" style={{ color: "#6e6e73" }}>
            {"7 天免费体验，到期后订阅继续使用全部功能。"}
          </p>
          {hasTrial && (
            <span
              className="mt-2.5 inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] font-semibold"
              style={{ background: "rgba(52,199,89,0.12)", color: "#16a34a" }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#16a34a" }} />
              {`试用中，还剩 ${trialDaysLeft} 天`}
            </span>
          )}
          {isExpired && (
            <span
              className="mt-2.5 inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] font-semibold"
              style={{ background: "rgba(239,68,68,0.10)", color: "#ef4444" }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#ef4444" }} />
              {"试用已结束"}
            </span>
          )}
        </div>

        {/* ── Features card ── */}
        <div
          className="rounded-2xl px-4 py-4"
          style={{ background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
        >
          <p className="text-[12px] font-semibold uppercase tracking-wide mb-3" style={{ color: "#aeaeb2" }}>
            {"订阅后可使用"}
          </p>
          <div className="flex flex-col gap-3">
            {PRO_FEATURES.map((text) => (
              <div key={text} className="flex items-start gap-3">
                <div
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full mt-0.5"
                  style={{ background: "rgba(52,199,89,0.14)" }}
                >
                  <Check className="h-3 w-3" strokeWidth={3} style={{ color: "#16a34a" }} />
                </div>
                <span className="text-[14px] leading-snug" style={{ color: "#3a3a3c" }}>{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Plan cards ── */}
        <div className="flex gap-3">
          {PLANS.map((plan) => {
            const isSelected = selectedPlan === plan.id
            const isTenMonth = plan.id === "ten_months"
            return (
              <button
                key={plan.id}
                onClick={() => setSelectedPlan(plan.id)}
                className="relative flex flex-1 flex-col items-center rounded-2xl pt-5 pb-4 px-3 transition-all active:scale-[0.97] overflow-hidden"
                style={
                  isSelected
                    ? { background: "#fff", boxShadow: "0 0 0 2.5px #1c1c1e" }
                    : { background: "rgba(230,240,250,0.45)" }
                }
              >
                {/* Big price */}
                <span
                  className="text-[30px] font-bold leading-none mb-1"
                  style={{ color: isSelected ? "#1c1c1e" : "#aeaeb2" }}
                >
                  {plan.price}
                </span>

                {/* Per-period label */}
                <span
                  className="text-[13px]"
                  style={{ color: isSelected ? "#6e6e73" : "#c7c7cc" }}
                >
                  {isTenMonth ? "/12个月" : "/月"}
                </span>

                {/* Original price + savings pill for 12-month */}
                {isTenMonth && (
                  <div className="flex items-center gap-1.5 mt-2">
                    <span
                      className="text-[12px] line-through"
                      style={{ color: "#aeaeb2" }}
                    >
                      {"¥118.8"}
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white"
                      style={{ background: "#ef4444" }}
                    >
                      {"立省 ¥19.8"}
                    </span>
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {/* ── CTA ── */}
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={() => setShowPaymentModal(true)}
            className="w-full rounded-2xl py-4 text-[16px] font-bold text-white transition-all active:scale-[0.99]"
            style={{ background: "#1c1c1e" }}
          >
            {"立即订阅"}
          </button>
          <div className="flex items-center justify-center gap-4">
            <button
              className="text-[13px] underline underline-offset-2 transition-opacity active:opacity-50"
              style={{ color: "#8a9ab0" }}
            >
              {"恢复已购买订阅"}
            </button>
            {onLogout && (
              <>
                <span style={{ color: "#d1d1d6", fontSize: "13px" }}>{"·"}</span>
                <button
                  onClick={() => setShowLogoutConfirm(true)}
                  className="text-[13px] transition-opacity active:opacity-50"
                  style={{ color: "#8a9ab0" }}
                >
                  {"退出登录"}
                </button>
              </>
            )}
          </div>
          <p className="text-[11px] text-center leading-relaxed" style={{ color: "#aeaeb2" }}>
            {"订阅即表示您同意自动续费条款，可随时取消"}
          </p>
        </div>

      </main>

      {/* Logout Confirm Dialog */}
      {showLogoutConfirm && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center px-8"
          style={{ background: "rgba(0,0,0,0.35)" }}
          onClick={() => setShowLogoutConfirm(false)}
        >
          <div
            className="w-full rounded-2xl overflow-hidden"
            style={{ background: "rgba(242,242,247,0.98)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Title + body */}
            <div className="px-5 pt-5 pb-4 text-center">
              <p className="text-[17px] font-semibold mb-1.5" style={{ color: "#1c1c1e" }}>{"退出登录"}</p>
              <p className="text-[13px] leading-relaxed" style={{ color: "#6c6c70" }}>
                {"确认退出当前账号？退出后需重新登录才能使用。"}
              </p>
            </div>
            {/* Divider */}
            <div style={{ height: "0.5px", background: "rgba(60,60,67,0.18)" }} />
            {/* Buttons */}
            <div className="flex">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 py-3.5 text-[17px] font-medium transition-opacity active:opacity-50"
                style={{ color: "#007aff" }}
              >
                {"取消"}
              </button>
              <div style={{ width: "0.5px", background: "rgba(60,60,67,0.18)" }} />
              <button
                onClick={() => {
                  setShowLogoutConfirm(false)
                  onLogout?.()
                }}
                className="flex-1 py-3.5 text-[17px] font-medium transition-opacity active:opacity-50"
                style={{ color: "#ef4444" }}
              >
                {"退出"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPaymentModal && (
        <div className="absolute inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.45)" }}>
          <div
            className="w-full rounded-t-3xl p-6 pb-10 animate-in slide-in-from-bottom duration-300"
            style={{ background: "#fff" }}
          >
            {paymentStep === "select" && (
              <>
                <div className="flex items-center justify-between mb-5">
                  <h3 className="text-lg font-bold" style={{ color: "#1a2a3a" }}>{"选择支付方式"}</h3>
                  <button onClick={() => setShowPaymentModal(false)} className="p-1">
                    <X className="h-5 w-5" style={{ color: "#8a9ab0" }} />
                  </button>
                </div>

                {/* Order summary */}
                <div className="mb-5 rounded-2xl p-4" style={{ background: "#f4f8fc", border: "1px solid #e0ecf5" }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm" style={{ color: "#5a7a96" }}>{"套餐"}</span>
                    <span className="text-sm font-semibold" style={{ color: "#1a2a3a" }}>
                      {selectedPlanData.label}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm" style={{ color: "#5a7a96" }}>{"应付金额"}</span>
                    <span className="text-xl font-bold" style={{ color: "#1a3a5c" }}>
                      {selectedPlan === "ten_months" ? "¥99" : "¥9.9"}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <button
                    onClick={() => handleSelectPayment("wechat")}
                    className="flex items-center gap-4 rounded-2xl px-4 py-4 transition-all active:scale-[0.99]"
                    style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "#22c55e" }}>
                      <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="currentColor">
                        <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.045c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89l-.003-.002zm-2.418 2.453c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.97.983.976.976 0 0 1-.968-.983c0-.542.433-.982.969-.982z"/>
                      </svg>
                    </div>
                    <span className="flex-1 text-left font-semibold" style={{ color: "#1a2a3a" }}>{"微信支付"}</span>
                    <div className="h-5 w-5 rounded-full" style={{ border: "2px solid #c0d8e8" }} />
                  </button>

                  <button
                    onClick={() => handleSelectPayment("alipay")}
                    className="flex items-center gap-4 rounded-2xl px-4 py-4 transition-all active:scale-[0.99]"
                    style={{ background: "#eff6ff", border: "1px solid #bfdbfe" }}
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "#3b82f6" }}>
                      <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="currentColor">
                        <path d="M20.422 16.872c-2.067-.736-4.015-1.878-5.163-2.69.513-1.163.88-2.466 1.007-3.822H12.95V8.914h3.978V7.93h-3.978V5.5H11.6c-.136 0-.247.111-.247.247V7.93H7.37v.984h3.983v1.446H7.984v.984h6.013a11.37 11.37 0 0 1-.65 2.466c-1.353-.776-3.063-1.446-4.95-1.446-2.33 0-4.143 1.153-4.143 3.073 0 1.92 1.8 3.214 4.344 3.214 2.026 0 3.788-.908 4.925-2.33.933.561 3.282 1.856 5.305 2.693 1.15.476 2.018.713 3.063.713.99 0 1.884-.232 2.696-.697-.07.055-.143.105-.22.155C22.356 21.268 19.442 24 12 24 5.373 24 0 18.627 0 12S5.373 0 12 0s12 5.373 12 12c0 2.073-.526 4.024-1.451 5.73a6.266 6.266 0 0 0-2.127-.858zM8.396 17.98c-1.764 0-2.81-.762-2.81-1.825 0-1.063 1.084-1.765 2.688-1.765 1.512 0 2.915.571 4.016 1.373-.897 1.363-2.288 2.217-3.894 2.217z"/>
                      </svg>
                    </div>
                    <span className="flex-1 text-left font-semibold" style={{ color: "#1a2a3a" }}>{"支付宝"}</span>
                    <div className="h-5 w-5 rounded-full" style={{ border: "2px solid #c0d8e8" }} />
                  </button>
                </div>

                <p className="mt-4 text-center text-[11px]" style={{ color: "#90a0b0" }}>
                  {"点击支付即表示同意《服务条款》和《隐私政策》"}
                </p>
              </>
            )}

            {paymentStep === "processing" && (
              <div className="flex flex-col items-center py-10">
                <Loader2 className="h-12 w-12 animate-spin mb-4" style={{ color: "#1a3a5c" }} />
                <p className="text-base font-semibold" style={{ color: "#1a2a3a" }}>{"正在处理支付..."}</p>
                <p className="mt-1 text-sm" style={{ color: "#8a9ab0" }}>
                  {"请在 "}{selectedPayment === "wechat" ? "微信" : "支付宝"}{" 中完成支付"}
                </p>
              </div>
            )}

            {paymentStep === "success" && (
              <div className="flex flex-col items-center py-8">
                <div
                  className="mb-4 flex h-16 w-16 items-center justify-center rounded-full"
                  style={{ background: "#1a3a5c", boxShadow: "0 6px 20px rgba(26,58,92,0.3)" }}
                >
                  <CheckCircle2 className="h-8 w-8 text-white" />
                </div>
                <p className="text-lg font-bold mb-1" style={{ color: "#1a2a3a" }}>{"支付成功"}</p>
                <p className="text-sm mb-6" style={{ color: "#8a9ab0" }}>{"订阅成功，继续使用 Vivi Drop 吧！"}</p>

                <div className="w-full rounded-2xl p-4 mb-6" style={{ background: "#f0f8ff", border: "1px solid rgba(59,130,210,0.20)" }}>
                  <div className="flex items-center gap-3">
                    <Crown className="h-5 w-5" style={{ color: "#f59e0b" }} />
                    <div>
                      <p className="text-sm font-semibold" style={{ color: "#1a2a3a" }}>
                        {selectedPlanData.label}
                      </p>
                      <p className="text-xs" style={{ color: "#6b7a8d" }}>
                        {"有效期至 "}
                        {selectedPlan === "ten_months"
                          ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toLocaleDateString("zh-CN")
                          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString("zh-CN")
                        }
                      </p>
                    </div>
                  </div>
                </div>

                <button
                  onClick={handlePaymentComplete}
                  className="w-full rounded-2xl py-4 text-base font-bold text-white transition-all"
                  style={{ background: "#1a3a5c", boxShadow: "0 4px 20px rgba(26,58,92,0.25)" }}
                >
                  {"开始使用"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
