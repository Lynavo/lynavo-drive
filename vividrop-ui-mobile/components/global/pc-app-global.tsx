"use client"

import { useState } from "react"
import { 
  LayoutGrid, 
  Settings, 
  FolderOpen, 
  HelpCircle,
  Globe,
  Wifi,
  ChevronRight,
  ChevronDown,
  Users,
  Download,
  Folder
} from "lucide-react"
import { DashboardGlobal } from "./dashboard-global"
import { SharedListGlobal } from "./shared-list-global"
import { SettingsPageGlobal } from "./settings-page-global"
import type { Device } from "@/lib/mock-data"

type PCView = "dashboard" | "teamSpace" | "inbox" | "myFiles" | "settings" | "help"

export function PCAppGlobal() {
  const [view, setView] = useState<PCView>("dashboard")
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null)
  const [tunnelEnabled, setTunnelEnabled] = useState(true)
  const [directoriesExpanded, setDirectoriesExpanded] = useState(true)

  const handleSelectDevice = (device: Device) => {
    setSelectedDevice(device)
  }

  const isDirectoryView = view === "teamSpace" || view === "inbox" || view === "myFiles"

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="flex w-60 flex-col border-r border-border bg-card">
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-border">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <Wifi className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <span className="text-base font-semibold text-foreground">Vividrop</span>
            <span className="ml-1.5 text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Global</span>
          </div>
        </div>

        {/* Tunnel Status Banner */}
        <div className="mx-3 mt-4 mb-2">
          <button 
            onClick={() => setTunnelEnabled(!tunnelEnabled)}
            className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all ${
              tunnelEnabled 
                ? "bg-violet-50 border border-violet-200" 
                : "bg-muted border border-border"
            }`}
          >
            <div className={`flex h-8 w-8 items-center justify-center rounded-md ${
              tunnelEnabled ? "bg-violet-500" : "bg-muted-foreground/30"
            }`}>
              <Globe className={`h-4 w-4 ${tunnelEnabled ? "text-white" : "text-muted-foreground"}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-medium ${tunnelEnabled ? "text-violet-700" : "text-muted-foreground"}`}>
                Public Tunnel
              </p>
              <p className={`text-[10px] ${tunnelEnabled ? "text-violet-600" : "text-muted-foreground"}`}>
                {tunnelEnabled ? "Anyone can download" : "LAN only"}
              </p>
            </div>
            <div className={`h-2 w-2 rounded-full ${tunnelEnabled ? "bg-violet-500" : "bg-muted-foreground/30"}`} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-0.5 px-3 py-2 flex-1">
          {/* Devices */}
          <button
            onClick={() => setView("dashboard")}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
              view === "dashboard"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <LayoutGrid className="h-4 w-4" />
            Devices
            {view === "dashboard" && <ChevronRight className="h-3.5 w-3.5 ml-auto" />}
          </button>

          {/* Directories - Expandable */}
          <div>
            <button
              onClick={() => setDirectoriesExpanded(!directoriesExpanded)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all w-full ${
                isDirectoryView
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <FolderOpen className="h-4 w-4" />
              Directories
              <ChevronDown className={`h-3.5 w-3.5 ml-auto transition-transform ${directoriesExpanded ? "" : "-rotate-90"}`} />
            </button>
            
            {directoriesExpanded && (
              <div className="ml-4 mt-1 space-y-0.5">
                {/* Team Space */}
                <button
                  onClick={() => setView("teamSpace")}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all w-full ${
                    view === "teamSpace"
                      ? "bg-blue-50 text-blue-700"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <div className={`flex h-6 w-6 items-center justify-center rounded-md ${view === "teamSpace" ? "bg-blue-100" : "bg-blue-50"}`}>
                    <Users className="h-3.5 w-3.5 text-blue-600" />
                  </div>
                  <div className="flex-1 text-left">
                    <span className="block text-xs font-medium">Team Space</span>
                    <span className="block text-[10px] text-muted-foreground">LAN devices</span>
                  </div>
                </button>

                {/* Inbox */}
                <button
                  onClick={() => setView("inbox")}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all w-full ${
                    view === "inbox"
                      ? "bg-amber-50 text-amber-700"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <div className={`flex h-6 w-6 items-center justify-center rounded-md ${view === "inbox" ? "bg-amber-100" : "bg-amber-50"}`}>
                    <Download className="h-3.5 w-3.5 text-amber-600" />
                  </div>
                  <div className="flex-1 text-left">
                    <span className="block text-xs font-medium">Inbox</span>
                    <span className="block text-[10px] text-muted-foreground">Received files</span>
                  </div>
                </button>

                {/* My Files */}
                <button
                  onClick={() => setView("myFiles")}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all w-full ${
                    view === "myFiles"
                      ? "bg-orange-50 text-orange-700"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <div className={`flex h-6 w-6 items-center justify-center rounded-md ${view === "myFiles" ? "bg-orange-100" : "bg-orange-50"}`}>
                    <Folder className="h-3.5 w-3.5 text-orange-600" />
                  </div>
                  <div className="flex-1 text-left">
                    <span className="block text-xs font-medium">My Files</span>
                    <span className="block text-[10px] text-muted-foreground">Same account</span>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Settings */}
          <button
            onClick={() => setView("settings")}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
              view === "settings"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Settings className="h-4 w-4" />
            Settings
            {view === "settings" && <ChevronRight className="h-3.5 w-3.5 ml-auto" />}
          </button>
        </nav>

        {/* Bottom */}
        <div className="px-3 py-4 border-t border-border">
          <button
            onClick={() => setView("help")}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
              view === "help"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <HelpCircle className="h-4 w-4" />
            Help Center
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden bg-muted/30">
        {view === "dashboard" && (
          <DashboardGlobal 
            onSelectDevice={handleSelectDevice} 
            tunnelEnabled={tunnelEnabled}
            onToggleTunnel={() => setTunnelEnabled(!tunnelEnabled)}
          />
        )}
        {view === "teamSpace" && (
          <SharedListGlobal tunnelEnabled={tunnelEnabled} directoryType="teamSpace" />
        )}
        {view === "inbox" && (
          <SharedListGlobal tunnelEnabled={tunnelEnabled} directoryType="inbox" />
        )}
        {view === "myFiles" && (
          <SharedListGlobal tunnelEnabled={tunnelEnabled} directoryType="myFiles" />
        )}
        {view === "settings" && (
          <SettingsPageGlobal 
            tunnelEnabled={tunnelEnabled}
            onToggleTunnel={() => setTunnelEnabled(!tunnelEnabled)}
          />
        )}
        {view === "help" && (
          <HelpContent />
        )}
      </main>
    </div>
  )
}

function HelpContent() {
  const sections = [
    {
      title: "Getting Started",
      items: [
        { q: "How do I connect my mobile device?", a: "Open the mobile app, tap Scan, and scan the QR code shown on your PC dashboard." },
        { q: "What is the Shared folder?", a: "Files you place in the Shared folder become available for download on connected mobile devices." },
      ]
    },
    {
      title: "Public Tunnel (New Feature)",
      items: [
        { q: "What is Public Tunnel?", a: "Public Tunnel creates a secure internet-accessible link to your shared files, allowing downloads from anywhere - not just your local network." },
        { q: "Is it secure?", a: "Yes. Each tunnel session generates a unique encrypted URL. You control who receives the link, and you can disable it anytime." },
        { q: "Do I need to configure my router?", a: "No. Public Tunnel handles NAT traversal automatically. No port forwarding required." },
      ]
    },
    {
      title: "Troubleshooting",
      items: [
        { q: "Mobile device can't find PC", a: "Ensure both devices are on the same WiFi network, or enable Public Tunnel for remote access." },
        { q: "Transfer is slow", a: "For local transfers, check your WiFi signal. For tunnel transfers, speed depends on your internet upload bandwidth." },
      ]
    }
  ]

  return (
    <div className="h-full overflow-auto custom-scrollbar">
      <div className="max-w-3xl mx-auto px-8 py-8">
        <h1 className="text-2xl font-semibold text-foreground mb-1">Help Center</h1>
        <p className="text-sm text-muted-foreground mb-8">Everything you need to know about Vividrop</p>

        <div className="space-y-8">
          {sections.map((section) => (
            <div key={section.title}>
              <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                {section.title === "Public Tunnel (New Feature)" && (
                  <span className="text-[10px] font-medium bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">NEW</span>
                )}
                {section.title}
              </h2>
              <div className="space-y-3">
                {section.items.map((item, i) => (
                  <div key={i} className="bg-card rounded-lg border border-border p-4">
                    <p className="text-sm font-medium text-foreground mb-1.5">{item.q}</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">{item.a}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
