"use client"

import { useState, useRef, useEffect } from "react"
import { ArrowLeft, ChevronDown, LoaderCircle, Phone } from "lucide-react"

interface LoginPageProps {
  onLoginSuccess: () => void
}

type LoginStep = "phone" | "code"

export function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const [step, setStep] = useState<LoginStep>("phone")
  const [phone, setPhone] = useState("")
  const [code, setCode] = useState<string[]>(Array(6).fill(""))
  const [countdown, setCountdown] = useState(0)
  const [loading, setLoading] = useState(false)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  const isValidPhone = phone.length === 11 && /^1\d{10}$/.test(phone)
  const canSubmit = isValidPhone

  const handleSendCode = () => {
    if (!canSubmit) return
    setLoading(true)
    setTimeout(() => {
      setLoading(false)
      setStep("code")
      setCountdown(60)
    }, 800)
  }

  const handleCodeChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return
    const next = [...code]
    next[index] = value.slice(-1)
    setCode(next)
    if (value && index < 5) inputRefs.current[index + 1]?.focus()
    if (index === 5 && value && next.join("").length === 6) {
      setLoading(true)
      setTimeout(() => { setLoading(false); onLoginSuccess() }, 1000)
    }
  }

  const handleCodeKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  const handleResend = () => {
    if (countdown > 0) return
    setCode(Array(6).fill(""))
    setCountdown(60)
    inputRefs.current[0]?.focus()
  }

  const topLogo = (
    <div className="flex flex-col items-center">
      <div className="mb-6 flex h-[148px] w-[148px] items-center justify-center">
        <img
          src="/vividrop-login-logo.png"
          alt="Vivi Drop logo"
          className="h-[118px] w-[118px] object-contain"
        />
      </div>
      <h1 className="text-[34px] font-bold tracking-[-0.03em] text-[#1D314A]">Vivi Drop</h1>
      <p className="mt-4 text-center text-[18px] leading-[1.45] text-[#6383A6]">
        Connect your desktop and keep media in sync.
      </p>
    </div>
  )

  return (
    <div className="flex min-h-screen w-full flex-col bg-[#EAF5FF]">
      <header className="flex items-center gap-3 px-5 pt-14 pb-2">
        {step === "code" && (
          <button
            onClick={() => { setStep("phone"); setCode(Array(6).fill("")) }}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/65 backdrop-blur-sm transition-colors hover:bg-white/80"
          >
            <ArrowLeft className="h-4 w-4" style={{ color: "#1D314A" }} />
          </button>
        )}
      </header>

      <main className="flex flex-1 flex-col items-center px-0 pt-6 pb-0">
        <div className="w-full px-8">{topLogo}</div>

        {step === "phone" ? (
          <div
            className="mt-12 w-full rounded-t-[40px] bg-white px-6 pb-12 pt-12 shadow-[0_-8px_28px_rgba(133,163,196,0.12)]"
            style={{
              minHeight: "calc(100vh - 348px)",
            }}
          >
            <div className="mx-auto w-full max-w-[332px] rounded-[28px] bg-white px-7 pb-8 pt-9 shadow-[0_10px_34px_rgba(112,149,184,0.12)]">
              <h2 className="text-center text-[28px] font-bold tracking-[-0.03em] text-[#1D314A]">Log in or sign up</h2>

              <div className="mt-9 space-y-7">
                <button
                  type="button"
                  className="flex h-[74px] w-full items-center justify-center gap-4 rounded-full border border-[#DCE9FB] bg-white px-6 text-[18px] font-semibold text-[#1D314A]"
                >
                  <svg width="28" height="28" viewBox="0 0 48 48" aria-hidden="true">
                    <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303C33.655 32.657 29.233 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.27 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
                    <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 16.108 18.961 13 24 13c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.27 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
                    <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.144 35.091 26.671 36 24 36c-5.212 0-9.617-3.327-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
                    <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-1.03 2.793-3.017 5.076-5.495 6.57l.003-.002 6.19 5.238C35.563 39.812 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
                  </svg>
                  <span>Continue with Google</span>
                </button>

                <button
                  type="button"
                  className="flex h-[74px] w-full items-center justify-center gap-4 rounded-full border border-[#DCE9FB] bg-white px-6 text-[18px] font-semibold text-[#1D314A]"
                >
                  <svg width="26" height="32" viewBox="0 0 24 30" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M19.174 15.699c.02 2.217 1.928 2.955 1.949 2.964-.016.053-.304 1.039-1 2.06-.602.884-1.228 1.765-2.212 1.783-.966.018-1.276-.572-2.381-.572-1.105 0-1.45.554-2.365.59-.95.036-1.674-.954-2.282-1.835-1.24-1.794-2.187-5.071-.915-7.28.632-1.097 1.761-1.79 2.986-1.808.932-.018 1.812.627 2.381.627.57 0 1.638-.776 2.76-.662.469.02 1.786.189 2.63 1.424-.068.042-1.571.917-1.551 2.709ZM17.215 8.286c.505-.612.846-1.464.753-2.316-.727.029-1.608.484-2.129 1.096-.468.543-.878 1.413-.768 2.246.811.063 1.639-.414 2.144-1.026Z"
                    />
                  </svg>
                  <span>Continue with Apple</span>
                </button>
              </div>

              <div className="my-8 flex items-center gap-4">
                <div className="h-px flex-1 bg-[#E5ECF5]" />
                <span className="text-[16px] font-semibold tracking-[0.08em] text-[#8FA1BA]">OR</span>
                <div className="h-px flex-1 bg-[#E5ECF5]" />
              </div>

              <div className="rounded-full border border-[#DCE9FB] bg-[#FAFCFF] px-5 py-4">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-3 text-[#6885A7]">
                    <Phone className="h-5 w-5" strokeWidth={2} />
                    <span className="text-[18px] font-semibold">+86</span>
                    <ChevronDown className="h-4 w-4" strokeWidth={2.5} />
                  </div>
                  <div className="h-9 w-px bg-[#DDE5F1]" />
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
                    placeholder="Phone number"
                    className="min-w-0 flex-1 bg-transparent text-[18px] outline-none placeholder:text-[#94A7C1]"
                    style={{ color: "#1D314A" }}
                    autoFocus
                  />
                </div>
              </div>

              <button
                onClick={handleSendCode}
                disabled={!canSubmit || loading}
                className="mt-12 flex h-[72px] w-full items-center justify-center gap-3 rounded-full text-[20px] font-bold text-white transition-all"
                style={{
                  background: canSubmit ? "#3F7BFF" : "#AEAEAE",
                  boxShadow: canSubmit ? "0 10px 24px rgba(63,123,255,0.24)" : "none",
                }}
              >
                {loading ? (
                  <>
                    <LoaderCircle className="h-6 w-6 animate-spin" strokeWidth={2.5} />
                    <span>Loading...</span>
                  </>
                ) : (
                  "Continue"
                )}
              </button>

              <p className="mt-16 text-center text-[15px] leading-[1.6] text-[#92A5BF]">
                By continuing, you agree to our{" "}
                <span className="font-semibold text-[#4B82FF]">Terms of Service</span>
                <br />
                and <span className="font-semibold text-[#4B82FF]">Privacy Policy</span>.
              </p>
            </div>
          </div>
        ) : (
          <div
            className="mt-12 w-full rounded-t-[40px] bg-white px-6 pb-12 pt-12 shadow-[0_-8px_28px_rgba(133,163,196,0.12)]"
            style={{
              minHeight: "calc(100vh - 348px)",
            }}
          >
            <div className="mx-auto w-full max-w-[332px] rounded-[28px] bg-white px-7 pb-8 pt-9 shadow-[0_10px_34px_rgba(112,149,184,0.12)]">
              <h2 className="text-center text-[28px] font-bold tracking-[-0.03em] text-[#1D314A]">Enter verification code</h2>
              <p className="mt-4 text-center text-[16px] leading-[1.5] text-[#6383A6]">
                We sent a 6-digit code to {phone.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2")}
              </p>

              <div className="mt-10 flex items-center justify-center gap-2.5">
                {code.map((digit, index) => (
                  <input
                    key={index}
                    ref={(el) => { inputRefs.current[index] = el }}
                    type="tel"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleCodeChange(index, e.target.value)}
                    onKeyDown={(e) => handleCodeKeyDown(index, e)}
                    autoFocus={index === 0}
                    disabled={loading}
                    className="h-[56px] w-[44px] rounded-2xl border text-center text-[22px] font-bold outline-none transition-all"
                    style={{
                      background: "#FAFCFF",
                      borderColor: digit ? "#4B82FF" : "#DCE9FB",
                      color: "#1D314A",
                      boxShadow: digit ? "0 0 0 3px rgba(75,130,255,0.10)" : "none",
                      opacity: loading ? 0.65 : 1,
                    }}
                  />
                ))}
              </div>

              {loading && (
                <div className="mt-6 flex items-center justify-center gap-2 text-sm text-[#4B82FF]">
                  <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={2.5} />
                  <span>Verifying...</span>
                </div>
              )}

              <button
                onClick={handleResend}
                disabled={countdown > 0}
                className="mt-8 w-full text-center text-[15px] font-medium transition-colors"
                style={{ color: countdown > 0 ? "#9EB0C7" : "#4B82FF" }}
              >
                {countdown > 0 ? `Resend in ${countdown}s` : "Resend code"}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
