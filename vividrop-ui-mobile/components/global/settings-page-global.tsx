"use client"

import { useState } from "react"
import { 
  Globe, 
  Wifi, 
  FolderOpen, 
  Shield, 
  Bell,
  ChevronRight,
  Copy,
  Check,
  RefreshCw,
  Info
} from "lucide-react"
import { Switch } from "@/components/ui/switch"

interface SettingsPageGlobalProps {
  tunnelEnabled: boolean
  onToggleTunnel: () => void
}

export function SettingsPageGlobal({ tunnelEnabled, onToggleTunnel }: SettingsPageGlobalProps) {
  const [copied, setCopied] = useState(false)
  const [notifications, setNotifications] = useState(true)
  const [autoStart, setAutoStart] = useState(true)
  const tunnelUrl = "https://vividrop.io/s/a8x2k9"

  const handleCopy = () => {
    navigator.clipboard.writeText(tunnelUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="h-full overflow-auto custom-scrollbar">
      <div className="max-w-2xl mx-auto px-8 py-6">
        <h1 className="text-2xl font-semibold text-foreground mb-1">Settings</h1>
        <p className="text-sm text-muted-foreground mb-8">Configure your Vividrop preferences</p>

        {/* Public Tunnel Section */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Globe className="h-4 w-4 text-violet-600" />
            Public Tunnel
            <span className="text-[10px] font-medium bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">NEW</span>
          </h2>
          
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            {/* Enable Toggle */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${tunnelEnabled ? "bg-violet-500" : "bg-muted"}`}>
                  <Globe className={`h-5 w-5 ${tunnelEnabled ? "text-white" : "text-muted-foreground"}`} />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Enable Public Tunnel</p>
                  <p className="text-xs text-muted-foreground">Allow downloads from anywhere via secure link</p>
                </div>
              </div>
              <Switch checked={tunnelEnabled} onCheckedChange={onToggleTunnel} />
            </div>

            {/* Tunnel URL */}
            {tunnelEnabled && (
              <div className="p-4 bg-violet-50/50">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-medium text-violet-800">Your Public Link</p>
                  <button 
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 text-xs font-medium text-violet-700 hover:text-violet-800"
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm font-mono text-violet-900 bg-white px-3 py-2.5 rounded-lg border border-violet-200">
                    {tunnelUrl}
                  </code>
                  <button className="p-2.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors">
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>
                <p className="text-xs text-violet-700 mt-2 flex items-start gap-1.5">
                  <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  Anyone with this link can view and download files from your Shared folder. The link remains active while the tunnel is enabled.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Network Section */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Wifi className="h-4 w-4 text-primary" />
            Network
          </h2>
          
          <div className="bg-card rounded-xl border border-border divide-y divide-border">
            <div className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm font-medium text-foreground">Local Network IP</p>
                <p className="text-xs text-muted-foreground">Your device address on this network</p>
              </div>
              <code className="text-sm font-mono text-foreground bg-muted px-3 py-1.5 rounded-lg">192.168.1.105</code>
            </div>
            <div className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm font-medium text-foreground">Port</p>
                <p className="text-xs text-muted-foreground">Service port for local connections</p>
              </div>
              <code className="text-sm font-mono text-foreground bg-muted px-3 py-1.5 rounded-lg">8080</code>
            </div>
          </div>
        </section>

        {/* Storage Section */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-primary" />
            Storage
          </h2>
          
          <div className="bg-card rounded-xl border border-border divide-y divide-border">
            <button className="flex items-center justify-between p-4 w-full text-left hover:bg-muted/50 transition-colors">
              <div>
                <p className="text-sm font-medium text-foreground">Received Files Location</p>
                <p className="text-xs text-muted-foreground font-mono">~/Documents/Vividrop/received</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
            <button className="flex items-center justify-between p-4 w-full text-left hover:bg-muted/50 transition-colors">
              <div>
                <p className="text-sm font-medium text-foreground">Shared Files Location</p>
                <p className="text-xs text-muted-foreground font-mono">~/Documents/Vividrop/shared</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </section>

        {/* Preferences Section */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            Preferences
          </h2>
          
          <div className="bg-card rounded-xl border border-border divide-y divide-border">
            <div className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm font-medium text-foreground">Notifications</p>
                <p className="text-xs text-muted-foreground">Show alerts for new transfers</p>
              </div>
              <Switch checked={notifications} onCheckedChange={setNotifications} />
            </div>
            <div className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm font-medium text-foreground">Start on Login</p>
                <p className="text-xs text-muted-foreground">Launch Vividrop when computer starts</p>
              </div>
              <Switch checked={autoStart} onCheckedChange={setAutoStart} />
            </div>
          </div>
        </section>

        {/* Security Section */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Security
          </h2>
          
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 shrink-0">
                <Shield className="h-5 w-5 text-violet-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground mb-1">End-to-End Encryption</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  All file transfers are encrypted using TLS 1.3. Public tunnel connections use additional encryption layers to ensure your files remain private even when shared over the internet.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Version */}
        <div className="text-center text-xs text-muted-foreground pt-4 border-t border-border">
          Vividrop Global v2.1.0
        </div>
      </div>
    </div>
  )
}
