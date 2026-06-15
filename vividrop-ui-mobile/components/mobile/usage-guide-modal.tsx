"use client"

import { useState, useEffect, useRef, RefObject } from "react"
import { MonitorSmartphone, ScanLine, Zap, Settings, HelpCircle, Image } from "lucide-react"

interface SpotlightRect {
  x: number
  y: number
  width: number
  height: number
}

interface Step {
  refIndex: number         // which target ref to spotlight
  padding: number          // padding around the highlighted element
  title: string
  desc: string
  tipPosition: "below" | "above" | "left" | "right"
  icon: React.ElementType
  color: string
}

const STEPS: Step[] = [
  {
    refIndex: 0,   // refAlbumBtn
    padding: 12,
    icon: Image,
    color: "#16a34a",
    title: "手动同步",
    desc: "点击这里发送素材至电脑。进入相册后勾选照片或视频，按需提交到传输队列。",
    tipPosition: "above",
  },
  {
    refIndex: 1,   // refMainCard
    padding: 12,
    icon: Zap,
    color: "#0ea5e9",
    title: "无感备份",
    desc: "这里实时展示自动上传进度。开启后台自动上传，新增素材将静默同步至电脑。",
    tipPosition: "below",
  },
  {
    refIndex: 2,   // refHistoryBtn
    padding: 10,
    icon: ScanLine,
    color: "#3b82f6",
    title: "传输历史",
    desc: "查看所有已完成的传输记录，包括传输时间、文件大小和目标路径。",
    tipPosition: "below",
  },
  {
    refIndex: 3,   // refSettingsBtn
    padding: 10,
    icon: Settings,
    color: "#8b5cf6",
    title: "全局设置",
    desc: "管理设备连接码及系统参数，修改接收目录、切换账号并查看订阅状态。",
    tipPosition: "below",
  },
  {
    refIndex: 4,   // refHelpBtn
    padding: 10,
    icon: HelpCircle,
    color: "#f59e0b",
    title: "帮助中心",
    desc: "遇到问题？随时点击这里查看快速上手指南，或联系我们获取支持。",
    tipPosition: "below",
  },
]

interface UsageGuideModalProps {
  onClose: () => void
  targets: RefObject<HTMLElement | null>[]
  containerRef?: RefObject<HTMLElement | null>
}

export function UsageGuideModal({ onClose, targets, containerRef }: UsageGuideModalProps) {
  const [step, setStep] = useState(-1)   // -1 = not yet initialised
  const [rects, setRects] = useState<SpotlightRect[]>([])
  const [visible, setVisible] = useState(false)
  const [containerSize, setContainerSize] = useState({ w: 375, h: 812 })

  // Measure a single rect relative to the container
  const measureRect = (refIndex: number): SpotlightRect => {
    const container = containerRef?.current ?? null
    const containerRect = container
      ? container.getBoundingClientRect()
      : { left: 0, top: 0, width: 375, height: 812 }
    const ref = targets[refIndex]
    if (!ref?.current) return { x: 0, y: 0, width: 0, height: 0 }
    const r = ref.current.getBoundingClientRect()
    return {
      x: r.left - containerRect.left,
      y: r.top - containerRect.top,
      width: r.width,
      height: r.height,
    }
  }

  // Measure all target rects on mount, then pick first visible step
  useEffect(() => {
    const container = containerRef?.current ?? null
    const containerRect = container
      ? container.getBoundingClientRect()
      : { left: 0, top: 0, width: 375, height: 812 }

    setContainerSize({ w: containerRect.width, h: containerRect.height })

    const measured: SpotlightRect[] = targets.map((ref) => {
      if (!ref.current) return { x: 0, y: 0, width: 0, height: 0 }
      const r = ref.current.getBoundingClientRect()
      return {
        x: r.left - containerRect.left,
        y: r.top - containerRect.top,
        width: r.width,
        height: r.height,
      }
    })
    setRects(measured)

    // Find first step whose target is actually in the DOM and has non-zero size
    const firstVisible = STEPS.findIndex((s) => {
      const m = measured[s.refIndex]
      return m && m.width > 0 && m.height > 0
    })
    setStep(firstVisible >= 0 ? firstVisible : 0)
    requestAnimationFrame(() => setVisible(true))
  }, [])

  // Not yet initialised — render nothing
  if (step === -1) return null

  const current = STEPS[step]

  // Always re-measure current target live (handles hidden elements)
  const liveRect = measureRect(current?.refIndex ?? 0)
  const storedRect = rects[current?.refIndex] ?? { x: 0, y: 0, width: 0, height: 0 }
  // Prefer live rect; fall back to stored if live is zero-sized
  const rect = (liveRect.width > 0 && liveRect.height > 0) ? liveRect : storedRect

  const pad = current?.padding ?? 10

  const spotX = rect.x - pad
  const spotY = rect.y - pad
  const spotW = rect.width + pad * 2
  const spotH = rect.height + pad * 2
  const spotR = 16  // border radius of spotlight

  const vw = containerSize.w
  const vh = containerSize.h

  // Tip card dimensions (estimated)
  const TIP_HEIGHT = 160
  const TIP_MARGIN = 16

  const tipTop =
    current?.tipPosition === "below"
      ? spotY + spotH + TIP_MARGIN
      : spotY - TIP_HEIGHT - TIP_MARGIN

  // Find the last step index that has a visible target
  const lastVisibleStep = STEPS.reduceRight<number | null>((found, s, i) => {
    if (found !== null) return found
    const r = measureRect(s.refIndex)
    return (r.width > 0 && r.height > 0) ? i : null
  }, null) ?? STEPS.length - 1

  const isLast = step >= lastVisibleStep

  const handleNext = () => {
    if (isLast) {
      onClose()
      return
    }
    setVisible(false)
    setTimeout(() => {
      setStep((s) => {
        let next = s + 1
        while (next < STEPS.length - 1) {
          const r = measureRect(STEPS[next].refIndex)
          if (r.width > 0 && r.height > 0) break
          next++
        }
        return next
      })
      requestAnimationFrame(() => setVisible(true))
    }, 180)
  }

  // Find the first visible step index (for isFirst check)
  const firstVisibleStep = STEPS.findIndex((s) => {
    const r = measureRect(s.refIndex)
    return r.width > 0 && r.height > 0
  })
  const isFirst = step <= firstVisibleStep

  const handlePrev = () => {
    if (isFirst) return
    setVisible(false)
    setTimeout(() => {
      setStep((s) => {
        let prev = s - 1
        while (prev > 0) {
          const r = measureRect(STEPS[prev].refIndex)
          if (r.width > 0 && r.height > 0) break
          prev--
        }
        return prev
      })
      requestAnimationFrame(() => setVisible(true))
    }, 180)
  }

  const Icon = current?.icon

  return (
    <div className="absolute inset-0 z-50 overflow-hidden" style={{ pointerEvents: "all" }}>
      {/* SVG overlay with cutout spotlight */}
      <svg
        className="absolute inset-0 w-full h-full"
        style={{
          transition: "opacity 0.25s ease",
          opacity: visible ? 1 : 0,
        }}
        viewBox={`0 0 ${vw} ${vh}`}
        preserveAspectRatio="none"
      >
        <defs>
          <mask id="spotlight-mask">
            {/* White = visible overlay */}
            <rect width={vw} height={vh} fill="white" />
            {/* Black = punched-out spotlight (reveals content below) */}
            <rect
              x={spotX}
              y={spotY}
              width={spotW}
              height={spotH}
              rx={spotR}
              ry={spotR}
              fill="black"
              style={{ transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)" }}
            />
          </mask>
        </defs>
        <rect
          width={vw}
          height={vh}
          fill="rgba(0,0,0,0.72)"
          mask="url(#spotlight-mask)"
        />
        {/* Glowing ring around spotlight */}
        <rect
          x={spotX - 2}
          y={spotY - 2}
          width={spotW + 4}
          height={spotH + 4}
          rx={spotR + 2}
          ry={spotR + 2}
          fill="none"
          stroke="rgba(255,255,255,0.35)"
          strokeWidth="1.5"
          style={{ transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)" }}
        />
      </svg>

      {/* Dashed connector line from spotlight to tip card */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ opacity: visible ? 1 : 0, transition: "opacity 0.3s ease 0.1s" }}
      >
        {current?.tipPosition === "below" ? (
          <line
            x1={spotX + spotW / 2}
            y1={spotY + spotH}
            x2={spotX + spotW / 2}
            y2={tipTop}
            stroke="rgba(255,255,255,0.4)"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
        ) : (
          <line
            x1={spotX + spotW / 2}
            y1={spotY}
            x2={spotX + spotW / 2}
            y2={tipTop + TIP_HEIGHT}
            stroke="rgba(255,255,255,0.4)"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
        )}
      </svg>

      {/* Liquid Glass tooltip card */}
      <div
        className="absolute mx-4 flex flex-col gap-3 rounded-3xl px-5 py-4"
        style={{
          left: 0,
          right: 0,
          top: tipTop,
          background: "rgba(255,255,255,0.14)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid rgba(255,255,255,0.28)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.28)",
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : current?.tipPosition === "below" ? "translateY(-8px)" : "translateY(8px)",
          transition: "opacity 0.28s ease, transform 0.28s ease",
        }}
      >
        {/* Step indicator + icon */}
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{ background: "rgba(255,255,255,0.18)" }}
          >
            {Icon && <Icon className="h-5 w-5 text-white" />}
          </div>
          <div className="flex-1">
            <p className="text-[16px] font-bold text-white leading-tight">{current?.title}</p>
            <div className="flex gap-1 mt-1">
              {STEPS.map((_, i) => (
                <span
                  key={i}
                  className="h-1.5 rounded-full transition-all duration-300"
                  style={{
                    background: i === step ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.30)",
                    width: i === step ? "20px" : "6px",
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Desc */}
        <p className="text-[13px] leading-relaxed" style={{ color: "rgba(255,255,255,0.82)" }}>
          {current?.desc}
        </p>

        {/* Buttons: skip (left) + prev/next group (right) */}
        <div className="flex items-center">
          {/* Skip */}
          <button
            onClick={onClose}
            className="text-[13px] font-medium transition-opacity active:opacity-60"
            style={{ color: "rgba(255,255,255,0.50)" }}
          >
            {"跳过引导"}
          </button>

          {/* Right button group */}
          <div className="ml-auto flex items-center gap-2">
            {/* Prev — ghost, hidden on first step */}
            {!isFirst && (
              <button
                onClick={handlePrev}
                className="rounded-2xl px-4 py-2.5 text-[13px] font-semibold transition-all active:scale-[0.96]"
                style={{
                  color: "rgba(255,255,255,0.75)",
                  border: "1px solid rgba(255,255,255,0.22)",
                  background: "rgba(255,255,255,0.08)",
                }}
              >
                {"上一步"}
              </button>
            )}

            {/* Next / finish — primary */}
            <button
              onClick={handleNext}
              className="rounded-2xl px-5 py-2.5 text-[14px] font-bold transition-all active:scale-[0.96]"
              style={{ background: "rgba(255,255,255,0.95)", color: "#1a3a5c" }}
            >
              {isLast ? "开启旅程" : `下一步 ${step + 1}/${STEPS.length}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
