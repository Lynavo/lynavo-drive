"use client"

import { useState, useEffect } from "react"
import dynamic from "next/dynamic"
import { Monitor, Smartphone, Globe } from "lucide-react"

const PCAppGlobal = dynamic(
  () => import("@/components/global/pc-app-global").then((mod) => ({ default: mod.PCAppGlobal })),
  { ssr: false, loading: () => <LoadingSpinner /> }
)

const MobileAppGlobal = dynamic(
  () => import("@/components/global/mobile-app-global").then((mod) => ({ default: mod.MobileAppGlobal })),
  { ssr: false, loading: () => <LoadingSpinner /> }
)

function LoadingSpinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  )
}

function PhoneMockup({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex items-center justify-center">
      {/* Side buttons */}
      <div className="absolute left-0 top-[120px] z-20 flex flex-col gap-3">
        <div className="h-8 w-[3px] rounded-full bg-neutral-300 translate-x-[1px]" />
        <div className="h-14 w-[3px] rounded-full bg-neutral-300 translate-x-[1px]" />
        <div className="h-14 w-[3px] rounded-full bg-neutral-300 translate-x-[1px]" />
      </div>
      <div className="absolute right-0 top-[160px] z-20">
        <div className="h-20 w-[3px] rounded-full bg-neutral-300 -translate-x-[1px]" />
      </div>

      {/* Phone shell */}
      <div
        className="relative overflow-visible"
        style={{
          width: 375,
          height: 812,
          borderRadius: 54,
          background: "linear-gradient(145deg, #f5f5f5 0%, #e5e5e5 40%, #d4d4d4 100%)",
          boxShadow: "0 40px 80px rgba(0,0,0,0.15), 0 16px 40px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.8)",
          padding: "10px",
        }}
      >
        {/* Inner bezel */}
        <div
          className="relative h-full w-full overflow-hidden"
          style={{
            borderRadius: 46,
            background: "#fafafa",
            boxShadow: "inset 0 2px 8px rgba(0,0,0,0.06)",
          }}
        >
          {/* Status bar */}
          <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-7 pt-3 pb-1 pointer-events-none">
            <span className="text-[13px] font-semibold text-foreground">9:41</span>
            <div className="flex items-center gap-1.5">
              <svg width="17" height="12" viewBox="0 0 17 12" fill="none">
                <rect x="0" y="6" width="3" height="6" rx="0.5" fill="currentColor" className="text-foreground" />
                <rect x="4.5" y="4" width="3" height="8" rx="0.5" fill="currentColor" className="text-foreground" />
                <rect x="9" y="2" width="3" height="10" rx="0.5" fill="currentColor" className="text-foreground" />
                <rect x="13.5" y="0" width="3" height="12" rx="0.5" fill="currentColor" className="text-foreground opacity-30" />
              </svg>
              <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
                <path d="M8 10.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" fill="currentColor" className="text-foreground" />
                <path d="M5.2 8.2a4 4 0 0 1 5.6 0" stroke="currentColor" className="text-foreground" strokeWidth="1.2" strokeLinecap="round" fill="none" />
                <path d="M2.8 6a7 7 0 0 1 10.4 0" stroke="currentColor" className="text-foreground opacity-50" strokeWidth="1.2" strokeLinecap="round" fill="none" />
              </svg>
              <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
                <rect x="0.5" y="0.5" width="21" height="11" rx="3.5" stroke="currentColor" className="text-foreground opacity-35" />
                <rect x="2" y="2" width="16" height="8" rx="2" fill="currentColor" className="text-foreground" />
                <path d="M23 4v4a2 2 0 0 0 0-4z" fill="currentColor" className="text-foreground opacity-40" />
              </svg>
            </div>
          </div>

          {/* Dynamic island */}
          <div
            className="absolute top-3 left-1/2 z-40 -translate-x-1/2"
            style={{
              width: 126,
              height: 37,
              borderRadius: 20,
              background: "#0a0a0a",
              boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
            }}
          />

          {/* Content */}
          <div className="h-full w-full overflow-y-auto overflow-x-hidden" style={{ borderRadius: 46 }}>
            {children}
          </div>

          {/* Home indicator */}
          <div className="absolute bottom-2 left-1/2 z-30 -translate-x-1/2 pointer-events-none">
            <div className="rounded-full" style={{ width: 134, height: 5, background: "rgba(0,0,0,0.15)" }} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Home() {
  const [mode, setMode] = useState<"mobile" | "pc">("mobile")
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return <LoadingSpinner />

  return (
    <div className="relative h-screen overflow-hidden bg-muted/30" suppressHydrationWarning>
      {/* Mode switcher */}
      <div className="fixed top-4 right-4 z-50 flex items-center gap-1 rounded-full border border-border bg-card p-1 shadow-lg">
        <button
          onClick={() => setMode("pc")}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
            mode === "pc"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Monitor className="h-3.5 w-3.5" />
          Desktop
        </button>
        <button
          onClick={() => setMode("mobile")}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
            mode === "mobile"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Smartphone className="h-3.5 w-3.5" />
          Mobile
        </button>
      </div>

      {/* Version badge */}
      <div className="fixed top-4 left-4 z-50 flex items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-100 border border-violet-200">
          <Globe className="h-3.5 w-3.5 text-violet-600" />
          <span className="text-xs font-medium text-violet-700">Global Edition</span>
        </div>
      </div>

      {mode === "pc" ? (
        <PCAppGlobal />
      ) : (
        <div className="flex h-screen items-center justify-center bg-gradient-to-br from-neutral-100 to-neutral-200">
          <div className="overflow-auto" style={{ maxHeight: "100vh", paddingTop: 24, paddingBottom: 24 }}>
            <PhoneMockup>
              <MobileAppGlobal />
            </PhoneMockup>
          </div>
        </div>
      )}
    </div>
  )
}
