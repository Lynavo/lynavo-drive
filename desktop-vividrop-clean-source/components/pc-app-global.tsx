"use client"

import { useEffect, useRef, useState, type ChangeEvent, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from "react"
import {
  ArrowLeft,
  BadgeCheck,
  Camera,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Crown,
  Download,
  Eye,
  EyeOff,
  FileAudio,
  FileText,
  FileUp,
  FileVideo,
  Folder,
  FolderPlus,
  FolderOpen,
  Globe,
  Grid3X3,
  HardDrive,
  History,
  ImageIcon,
  Languages,
  List,
  LogOut,
  Mail,
  MessageSquare,
  MoveRight,
  Pencil,
  Power,
  HelpCircle,
  QrCode,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Smartphone,
  Star,
  Tablet,
  UserCircle,
  Wifi,
  type LucideIcon,
} from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { HelpDialog } from "@/components/help-dialog"
import { connectionCode as initialConnectionCode, mockDevices, type Device } from "@/lib/mock-data"

type PCView = "home" | "devices" | "computer" | "access" | "settings"
type ViewMode = "list" | "grid"
type InboxKind = string
type Tone = "blue" | "sky" | "green" | "amber" | "rose" | "slate"
type LanguageOption = string
type UpdateState = "idle" | "checking" | "available" | "updating" | "updated"
type AuthProvider = "phone" | "google" | "apple"

interface CloudDeviceRecord {
  id: string
  name: string
  accountName: string
  model: string
  lastSync: string
  icon: LucideIcon
  tone: Tone
}

interface InboxFileRecord {
  id: string
  name: string
  kind: InboxKind
  size: string
  sourceDeviceId: string
  sourceDevice: string
  sourceAccount: string
  time: string
  status: string
  preview: string
  progress?: number
}

const appVersion = "0.1.0"
const latestVersion = "0.1.1"
const developerFeedbackEmail = "developer@vividrop.app"

const initialLocalDevice = {
  name: "mac1123",
  ip: "192.168.0.227",
  port: "8080",
}

const languageOptions: Array<{ id: LanguageOption; label: string; caption: string }> = [
  { id: "system", label: "跟随系统", caption: "自动匹配电脑语言" },
  { id: "zh-CN", label: "简体中文", caption: "简体中文界面" },
  { id: "zh-TW", label: "繁體中文", caption: "繁體中文介面" },
  { id: "en", label: "English", caption: "English UI" },
  { id: "es", label: "Español", caption: "西班牙语" },
  { id: "fr", label: "Français", caption: "法语" },
  { id: "de", label: "Deutsch", caption: "德语" },
  { id: "ja", label: "日本語", caption: "日语" },
  { id: "ko", label: "한국어", caption: "韩语" },
  { id: "ru", label: "Русский", caption: "俄语" },
  { id: "pt", label: "Português", caption: "葡萄牙语" },
  { id: "it", label: "Italiano", caption: "意大利语" },
  { id: "ar", label: "العربية", caption: "阿拉伯语" },
  { id: "hi", label: "हिन्दी", caption: "印地语" },
  { id: "bn", label: "বাংলা", caption: "孟加拉语" },
  { id: "id", label: "Bahasa Indonesia", caption: "印尼语" },
  { id: "ms", label: "Bahasa Melayu", caption: "马来语" },
  { id: "th", label: "ไทย", caption: "泰语" },
  { id: "vi", label: "Tiếng Việt", caption: "越南语" },
  { id: "tr", label: "Türkçe", caption: "土耳其语" },
  { id: "nl", label: "Nederlands", caption: "荷兰语" },
  { id: "pl", label: "Polski", caption: "波兰语" },
  { id: "uk", label: "Українська", caption: "乌克兰语" },
  { id: "sv", label: "Svenska", caption: "瑞典语" },
  { id: "no", label: "Norsk", caption: "挪威语" },
  { id: "da", label: "Dansk", caption: "丹麦语" },
  { id: "fi", label: "Suomi", caption: "芬兰语" },
  { id: "cs", label: "Čeština", caption: "捷克语" },
  { id: "el", label: "Ελληνικά", caption: "希腊语" },
  { id: "he", label: "עברית", caption: "希伯来语" },
  { id: "fa", label: "فارسی", caption: "波斯语" },
  { id: "ur", label: "اردو", caption: "乌尔都语" },
  { id: "ta", label: "தமிழ்", caption: "泰米尔语" },
  { id: "te", label: "తెలుగు", caption: "泰卢固语" },
  { id: "sw", label: "Kiswahili", caption: "斯瓦希里语" },
  { id: "am", label: "አማርኛ", caption: "阿姆哈拉语" },
  { id: "km", label: "ខ្មែរ", caption: "高棉语" },
  { id: "lo", label: "ລາວ", caption: "老挝语" },
  { id: "my", label: "မြန်မာ", caption: "缅甸语" },
  { id: "ne", label: "नेपाली", caption: "尼泊尔语" },
  { id: "si", label: "සිංහල", caption: "僧伽罗语" },
  { id: "mn", label: "Монгол", caption: "蒙古语" },
  { id: "kk", label: "Қазақша", caption: "哈萨克语" },
  { id: "uz", label: "Oʻzbekcha", caption: "乌兹别克语" },
  { id: "hu", label: "Magyar", caption: "匈牙利语" },
  { id: "ro", label: "Română", caption: "罗马尼亚语" },
  { id: "bg", label: "Български", caption: "保加利亚语" },
  { id: "sr", label: "Српски", caption: "塞尔维亚语" },
  { id: "hr", label: "Hrvatski", caption: "克罗地亚语" },
  { id: "sk", label: "Slovenčina", caption: "斯洛伐克语" },
  { id: "lt", label: "Lietuvių", caption: "立陶宛语" },
  { id: "lv", label: "Latviešu", caption: "拉脱维亚语" },
  { id: "et", label: "Eesti", caption: "���沙尼亚语" },
  { id: "is", label: "Íslenska", caption: "冰岛语" },
  { id: "ga", label: "Gaeilge", caption: "爱尔兰语" },
  { id: "cy", label: "Cymraeg", caption: "威尔士语" },
  { id: "eu", label: "Euskara", caption: "巴斯克语" },
  { id: "ca", label: "Català", caption: "加泰罗尼亚语" },
  { id: "gl", label: "Galego", caption: "加利西亚语" },
  { id: "af", label: "Afrikaans", caption: "南非荷兰语" },
  { id: "zu", label: "isiZulu", caption: "祖鲁语" },
  { id: "xh", label: "isiXhosa", caption: "科萨语" },
  { id: "yo", label: "Yorùbá", caption: "约鲁巴语" },
  { id: "ha", label: "Hausa", caption: "豪萨语" },
  { id: "ig", label: "Igbo", caption: "伊博语" },
  { id: "mi", label: "Te Reo Māori", caption: "毛利语" },
  { id: "haw", label: "ʻŌlelo Hawaiʻi", caption: "夏威夷语" },
  { id: "fil", label: "Filipino", caption: "菲律宾语" },
  { id: "jv", label: "Basa Jawa", caption: "爪哇语" },
  { id: "bo", label: "བོད་སྐད", caption: "藏语" },
  { id: "ug", label: "ئۇيغۇرچە", caption: "维吾尔语" },
  { id: "yue", label: "粵語", caption: "粤语" },
  { id: "la", label: "Latina", caption: "拉丁语" },
  { id: "eo", label: "Esperanto", caption: "世界语" },
]

const accountProfile = {
  email: "vividrop@studio.example",
}



const navItems: Array<{ id: PCView; label: string; caption: string; icon: LucideIcon }> = [
  { id: "computer", label: "共享管理", caption: "连接码与远程访问", icon: HardDrive },
  { id: "devices", label: "设备管理", caption: "连�����与传输", icon: Smartphone },
  { id: "home", label: "同步记录", caption: "局域网 P2P 接收记录", icon: FolderOpen },
  { id: "access", label: "访问记录", caption: "手机远程访问历史", icon: History },
  { id: "settings", label: "我的", caption: "账户与偏好", icon: Settings },
]

const cloudDevices: CloudDeviceRecord[] = [
  {
    id: "iphone-15-pro",
    name: "iPhone 15 Pro",
    accountName: "chen@icloud.example",
    model: "iPhone 15 Pro",
    lastSync: "2 分钟前",
    icon: Smartphone,
    tone: "blue",
  },
  {
    id: "galaxy-s24-ultra",
    name: "Galaxy S24 Ultra",
    accountName: "ops@studio.example",
    model: "Galaxy S24 Ultra",
    lastSync: "今天 10:32",
    icon: Smartphone,
    tone: "green",
  },
  {
    id: "ipad-pro",
    name: "iPad Pro",
    accountName: "chen@icloud.example",
    model: "iPad Pro",
    lastSync: "昨天 18:20",
    icon: Tablet,
    tone: "sky",
  },
  {
    id: "gopro-hero-12",
    name: "GoPro Hero 12",
    accountName: "device@gopro.local",
    model: "GoPro Hero 12",
    lastSync: "6 月 8 日",
    icon: Camera,
    tone: "amber",
  },
  {
    id: "iphone-14",
    name: "iPhone 14",
    accountName: "archive@icloud.example",
    model: "iPhone 14",
    lastSync: "6 月 6 日",
    icon: Smartphone,
    tone: "slate",
  },
]

const inboxGroups: Array<{
  id: InboxKind
  label: string
  caption: string
  count: number
  path?: string
  icon: LucideIcon
  tone: Tone
}> = [
  {
    id: "files",
    label: "文件管理",
    caption: "电脑接收目录 / 文件管理",
    count: 74,
    path: "iPhone / 文件管理",
    icon: Folder,
    tone: "blue",
  },
  {
    id: "album",
    label: "相册",
    caption: "电脑接收目录 / 相册",
    count: 164,
    path: "iPhone / 相册",
    icon: ImageIcon,
    tone: "sky",
  },
]

const inboxFiles: InboxFileRecord[] = [
  {
    id: "f1",
    name: "IMG_20260610_Office.mov",
    kind: "album" as InboxKind,
    size: "3.2 GB",
    sourceDeviceId: "iphone-15-pro",
    sourceDevice: "iPhone 15 Pro",
    sourceAccount: "chen@icloud.example",
    time: "2 分钟前",
    status: "传输中",
    preview: "相册视频 · 4K · 00:18:42",
  },
  {
    id: "f2",
    name: "IMG_8493.HEIC",
    kind: "album" as InboxKind,
    size: "12 MB",
    sourceDeviceId: "iphone-15-pro",
    sourceDevice: "iPhone 15 Pro",
    sourceAccount: "chen@icloud.example",
    time: "16 分钟前",
    status: "已完成",
    preview: "相册照片 · 3024 x 4032 · HEIC",
  },
  {
    id: "f7",
    name: "Boardroom_whiteboard.png",
    kind: "album" as InboxKind,
    size: "4.6 MB",
    sourceDeviceId: "iphone-15-pro",
    sourceDevice: "iPhone 15 Pro",
    sourceAccount: "chen@icloud.example",
    time: "21 分钟前",
    status: "已完成",
    preview: "相册图片 · 2048 x 1536 · PNG",
  },
  {
    id: "f8",
    name: "Receipt_Shanghai_0610.jpg",
    kind: "album" as InboxKind,
    size: "2.1 MB",
    sourceDeviceId: "iphone-15-pro",
    sourceDevice: "iPhone 15 Pro",
    sourceAccount: "chen@icloud.example",
    time: "29 分钟前",
    status: "已完成",
    preview: "相册照片 · 财务凭证 · JPG",
  },
  {
    id: "f9",
    name: "Office_network_map.pdf",
    kind: "files" as InboxKind,
    size: "6.8 MB",
    sourceDeviceId: "iphone-15-pro",
    sourceDevice: "iPhone 15 Pro",
    sourceAccount: "chen@icloud.example",
    time: "42 分钟前",
    status: "已完成",
    preview: "文件管理 · PDF",
  },
  {
    id: "f3",
    name: "Voice_Memo_0610.m4a",
    kind: "files" as InboxKind,
    size: "86 MB",
    sourceDeviceId: "iphone-15-pro",
    sourceDevice: "iPhone 15 Pro",
    sourceAccount: "chen@icloud.example",
    time: "34 分钟前",
    status: "已完成",
    preview: "文件管理 · 语音备忘录 · 36:12",
  },
  {
    id: "f4",
    name: "briefing_notes.pdf",
    kind: "files" as InboxKind,
    size: "4.8 MB",
    sourceDeviceId: "iphone-15-pro",
    sourceDevice: "iPhone 15 Pro",
    sourceAccount: "chen@icloud.example",
    time: "48 分钟前",
    status: "已完成",
    preview: "文件管理 · PDF · 12 页",
  },
  {
    id: "f5",
    name: "Contract_Redline.docx",
    kind: "files" as InboxKind,
    size: "1.6 MB",
    sourceDeviceId: "iphone-15-pro",
    sourceDevice: "iPhone 15 Pro",
    sourceAccount: "chen@icloud.example",
    time: "昨天",
    status: "已完成",
    preview: "文件管理 · Word 文档",
  },
  {
    id: "f6",
    name: "Client_Assets.zip",
    kind: "files" as InboxKind,
    size: "740 MB",
    sourceDeviceId: "iphone-15-pro",
    sourceDevice: "iPhone 15 Pro",
    sourceAccount: "chen@icloud.example",
    time: "昨天",
    status: "已完成",
    preview: "文件管理 · ZIP 压缩包",
  },
  {
    id: "f10",
    name: "Market_visit_notes.pdf",
    kind: "files" as InboxKind,
    size: "3.4 MB",
    sourceDeviceId: "galaxy-s24-ultra",
    sourceDevice: "Galaxy S24 Ultra",
    sourceAccount: "ops@studio.example",
    time: "今天 10:32",
    status: "已完成",
    preview: "文件管理 · PDF · 8 页",
  },
  {
    id: "f11",
    name: "Expense_receipts.zip",
    kind: "files" as InboxKind,
    size: "128 MB",
    sourceDeviceId: "galaxy-s24-ultra",
    sourceDevice: "Galaxy S24 Ultra",
    sourceAccount: "ops@studio.example",
    time: "今天 10:30",
    status: "已完成",
    preview: "文件管理 · ZIP 压缩包",
  },
  {
    id: "f12",
    name: "IMG_20260609_Client.jpg",
    kind: "album" as InboxKind,
    size: "5.2 MB",
    sourceDeviceId: "galaxy-s24-ultra",
    sourceDevice: "Galaxy S24 Ultra",
    sourceAccount: "ops@studio.example",
    time: "今天 10:28",
    status: "已完成",
    preview: "相册照片 · 客户现场 · JPG",
  },
  {
    id: "f13",
    name: "Presentation_annotations.pdf",
    kind: "files" as InboxKind,
    size: "9.1 MB",
    sourceDeviceId: "ipad-pro",
    sourceDevice: "iPad Pro",
    sourceAccount: "chen@icloud.example",
    time: "昨天 18:20",
    status: "已完成",
    preview: "文件管理 · 标注文档 · PDF",
  },
  {
    id: "f14",
    name: "Whiteboard_capture.png",
    kind: "album" as InboxKind,
    size: "7.6 MB",
    sourceDeviceId: "ipad-pro",
    sourceDevice: "iPad Pro",
    sourceAccount: "chen@icloud.example",
    time: "昨天 18:18",
    status: "已完成",
    preview: "相册图片 · 白板记录 · PNG",
  },
  {
    id: "f15",
    name: "GOPR1288.MP4",
    kind: "album" as InboxKind,
    size: "1.9 GB",
    sourceDeviceId: "gopro-hero-12",
    sourceDevice: "GoPro Hero 12",
    sourceAccount: "device@gopro.local",
    time: "6 月 8 日",
    status: "已完成",
    preview: "相册视频 · 4K · MP4",
  },
  {
    id: "f16",
    name: "Shoot_log_0608.txt",
    kind: "files" as InboxKind,
    size: "48 KB",
    sourceDeviceId: "gopro-hero-12",
    sourceDevice: "GoPro Hero 12",
    sourceAccount: "device@gopro.local",
    time: "6 月 8 日",
    status: "已完成",
    preview: "文件管理 · 拍摄日志",
  },
  {
    id: "f17",
    name: "Archive_contact_list.xlsx",
    kind: "files" as InboxKind,
    size: "920 KB",
    sourceDeviceId: "iphone-14",
    sourceDevice: "iPhone 14",
    sourceAccount: "archive@icloud.example",
    time: "6 月 6 日",
    status: "已完成",
    preview: "文件管理 · Excel 表格",
  },
  {
    id: "f18",
    name: "IMG_20240606_Travel.HEIC",
    kind: "album" as InboxKind,
    size: "11 MB",
    sourceDeviceId: "iphone-14",
    sourceDevice: "iPhone 14",
    sourceAccount: "archive@icloud.example",
    time: "6 月 6 日",
    status: "已完成",
    preview: "相册照片 · HEIC",
  },
]

type CloudDevice = CloudDeviceRecord
type InboxGroup = (typeof inboxGroups)[number]
type InboxFile = InboxFileRecord

const computerReceiveRoot = "D:\\ViviDrop\\Receive"
const defaultDiskRemainingSpace = "66.6 GB"

function toSafePathSegment(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "_")
}

function getComputerDevicePath(device: Pick<CloudDevice, "name">) {
  return `${computerReceiveRoot}\\${toSafePathSegment(device.name)}`
}

function getReceiveDevicePath(receiveRootPath: string, device: Pick<CloudDevice, "name">) {
  return `${receiveRootPath || computerReceiveRoot}\\${toSafePathSegment(device.name)}`
}

function normalizeReceiveDirectoryPath(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (/^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("\\\\")) return trimmed
  return `${computerReceiveRoot}\\${toSafePathSegment(trimmed)}`
}

function getFileSizeInMb(size: string) {
  const match = size.match(/^([\d.]+)\s*(KB|MB|GB)$/i)
  if (!match) return 0

  const value = Number(match[1])
  const unit = match[2].toUpperCase()
  if (unit === "GB") return value * 1024
  if (unit === "KB") return value / 1024
  return value
}

function formatFileSize(totalMb: number) {
  if (totalMb >= 1024) {
    return `${(totalMb / 1024).toFixed(1)} GB`
  }
  if (totalMb < 1) {
    return `${Math.max(1, Math.round(totalMb * 1024))} KB`
  }
  return `${Math.round(totalMb * 10) / 10} MB`
}

function compactFileSizeLabel(size: string) {
  return size.replace(/\s+/g, "")
}

function getMockDiskRemainingSpace(path: string) {
  const checksum = path.split("").reduce((total, char) => total + char.charCodeAt(0), 0)
  const remainingGb = 48 + (checksum % 72) + (checksum % 10) / 10
  return `${remainingGb.toFixed(1)} GB`
}

function normalizeConnectionCode(value: string) {
  return value.replace(/\D/g, "").slice(0, 6)
}

function useDirectoryPicker({
  onAction,
  onPathChange,
  onDiskRemainingSpaceChange,
  normalizePath,
  successMessage,
}: {
  onAction: (message: string) => void
  onPathChange: (path: string) => void
  onDiskRemainingSpaceChange?: (space: string) => void
  normalizePath: (value: string) => string
  successMessage: string
}) {
  const directoryInputRef = useRef<HTMLInputElement>(null)

  const updateDirectory = (name: string, diskRemainingSpace?: string) => {
    const nextPath = normalizePath(name)
    onPathChange(nextPath)
    onDiskRemainingSpaceChange?.(diskRemainingSpace ?? getMockDiskRemainingSpace(nextPath))
    onAction(successMessage)
  }

  const handleChooseDirectory = async () => {
    const desktopBridge = window as Window & {
      vividrop?: {
        chooseDirectory?: () => Promise<string | { name?: string; path?: string; diskRemainingSpace?: string; freeSpace?: string; availableSpace?: string } | null>
        selectDirectory?: () => Promise<string | { name?: string; path?: string; diskRemainingSpace?: string; freeSpace?: string; availableSpace?: string } | null>
      }
      electronAPI?: {
        chooseDirectory?: () => Promise<string | { name?: string; path?: string; diskRemainingSpace?: string; freeSpace?: string; availableSpace?: string } | null>
        selectDirectory?: () => Promise<string | { name?: string; path?: string; diskRemainingSpace?: string; freeSpace?: string; availableSpace?: string } | null>
      }
    }
    const nativeDirectoryPicker =
      desktopBridge.vividrop?.chooseDirectory ??
      desktopBridge.vividrop?.selectDirectory ??
      desktopBridge.electronAPI?.chooseDirectory ??
      desktopBridge.electronAPI?.selectDirectory

    if (nativeDirectoryPicker) {
      const directory = await nativeDirectoryPicker()
      const pickedPath = typeof directory === "string" ? directory : directory?.path ?? directory?.name
      const pickedDiskRemainingSpace =
        typeof directory === "string" ? undefined : directory?.diskRemainingSpace ?? directory?.freeSpace ?? directory?.availableSpace
      if (pickedPath) updateDirectory(pickedPath, pickedDiskRemainingSpace)
      return
    }

    const directoryPicker = (window as Window & {
      showDirectoryPicker?: () => Promise<{ name?: string }>
    }).showDirectoryPicker

    if (directoryPicker) {
      try {
        const directory = await directoryPicker.call(window)
        if (directory?.name) updateDirectory(directory.name)
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return
      }
    }

    directoryInputRef.current?.click()
  }

  const handleDirectoryInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    if (!file) return

    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath
    const folderName = relativePath?.split("/").filter(Boolean)[0] ?? file.name
    updateDirectory(folderName)
    event.currentTarget.value = ""
  }

  return { directoryInputRef, handleChooseDirectory, handleDirectoryInputChange }
}

function useReceiveDirectoryPicker({
  onAction,
  onReceiveDirectoryPathChange,
  onReceiveDiskRemainingSpaceChange,
}: {
  onAction: (message: string) => void
  onReceiveDirectoryPathChange: (path: string) => void
  onReceiveDiskRemainingSpaceChange?: (space: string) => void
}) {
  return useDirectoryPicker({
    onAction,
    onPathChange: onReceiveDirectoryPathChange,
    onDiskRemainingSpaceChange: onReceiveDiskRemainingSpaceChange,
    normalizePath: normalizeReceiveDirectoryPath,
    successMessage: "接收目录已更新",
  })
}

export function PCAppGlobal() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [view, setView] = useState<PCView>("home")
  const [currentAccountEmail, setCurrentAccountEmail] = useState(accountProfile.email)
  const [devices, setDevices] = useState<Device[]>(mockDevices)
  const [cloudDeviceList] = useState<CloudDevice[]>(cloudDevices)
  const [inboxFileList] = useState<InboxFile[]>(inboxFiles)
  const [actionMessage, setActionMessage] = useState("")
  const actionMessageTimerRef = useRef<number | null>(null)
  const [receiveDirectoryPath, setReceiveDirectoryPath] = useState(computerReceiveRoot)
  const [receiveDiskRemainingSpace, setReceiveDiskRemainingSpace] = useState(defaultDiskRemainingSpace)
  const [localDevice, setLocalDevice] = useState(initialLocalDevice)
  const [localDeviceNameDraft, setLocalDeviceNameDraft] = useState(initialLocalDevice.name)
  const [deviceNameDialogOpen, setDeviceNameDialogOpen] = useState(false)
  const [uiLanguage, setUiLanguage] = useState<LanguageOption>("system")
  const [preventSleep, setPreventSleep] = useState(true)
  const [currentConnectionCode, setCurrentConnectionCode] = useState(initialConnectionCode)
  const [connectionCodeDraft, setConnectionCodeDraft] = useState(initialConnectionCode)
  const [connectionCodeConfigured, setConnectionCodeConfigured] = useState(false)
  const [connectionCodeVisible, setConnectionCodeVisible] = useState(false)
  const [connectionQrVisible, setConnectionQrVisible] = useState(false)
  const [connectionCodeDialogOpen, setConnectionCodeDialogOpen] = useState(false)
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)

  const notifyAction = (message: string) => {
    setActionMessage(message)
    if (actionMessageTimerRef.current) window.clearTimeout(actionMessageTimerRef.current)
    actionMessageTimerRef.current = window.setTimeout(() => setActionMessage(""), 1800)
  }

  const openComputerPath = (path: string) => {
    const desktopBridge = (window as Window & {
      vividrop?: { openPath?: (targetPath: string) => void }
      electronAPI?: { openPath?: (targetPath: string) => void }
    })
    const openPath = desktopBridge.vividrop?.openPath ?? desktopBridge.electronAPI?.openPath

    openPath?.(path)
    notifyAction(`已打开电脑路径：${path}`)
  }

  const handleAuthSuccess = (provider: AuthProvider, identity: string) => {
    const normalizedIdentity = identity.trim()
    if (provider === "phone" && !normalizedIdentity) {
      notifyAction("请输入手机号")
      return
    }

    setIsAuthenticated(true)
    setCurrentAccountEmail(provider === "phone" ? normalizedIdentity : accountProfile.email)
    setView("computer")
    notifyAction(provider === "phone" ? `${normalizedIdentity} 已登入` : provider === "google" ? "Google 已登入" : "Apple 已登入")
  }

  const handleLogout = () => {
    setLogoutConfirmOpen(false)
    setIsAuthenticated(false)
    setConnectionCodeConfigured(false)
    setConnectionCodeVisible(false)
    setConnectionQrVisible(false)
    setConnectionCodeDialogOpen(false)
    setView("computer")
    notifyAction("已退出登录")
  }

  const openConnectionCodeDialog = () => {
    setConnectionCodeDraft(currentConnectionCode)
    setConnectionCodeDialogOpen(true)
  }

  const toggleConnectionCodeVisibility = () => {
    if (connectionCodeVisible) {
      setConnectionCodeVisible(false)
      notifyAction("连接码已隐藏")
      return
    }
    setConnectionCodeVisible(true)
    notifyAction("连接码已显示")
  }

  const toggleConnectionQr = () => {
    if (connectionQrVisible) {
      setConnectionQrVisible(false)
      notifyAction("连接二维码已收起")
      return
    }
    setConnectionQrVisible(true)
    notifyAction("连接二维码已显示")
  }

  const handleConnectionCodeSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextCode = normalizeConnectionCode(connectionCodeDraft)
    if (nextCode.length !== 6) {
      notifyAction("请输入 6 位数字连接码")
      return
    }

    setCurrentConnectionCode(nextCode)
    setConnectionCodeDraft(nextCode)
    setConnectionCodeConfigured(true)
    setConnectionCodeVisible(false)
    setConnectionCodeDialogOpen(false)
    setView("computer")
    notifyAction("连接码已保存")
  }

  const openDeviceNameDialog = () => {
    setLocalDeviceNameDraft(localDevice.name)
    setDeviceNameDialogOpen(true)
  }

  const handleDeviceNameSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextName = localDeviceNameDraft.trim()
    if (!nextName) return

    setLocalDevice((current) => ({ ...current, name: nextName }))
    setDeviceNameDialogOpen(false)
    notifyAction("设备名已更新")
  }

  if (!isAuthenticated) {
    return <AuthPage onAuthSuccess={handleAuthSuccess} />
  }

  if (!connectionCodeConfigured) {
    return (
      <ConnectionCodeSetupPage
        codeDraft={connectionCodeDraft}
        localDeviceName={localDevice.name}
        onCodeDraftChange={(value) => setConnectionCodeDraft(normalizeConnectionCode(value))}
        onLogout={handleLogout}
        onSubmit={handleConnectionCodeSubmit}
      />
    )
  }

  return (
    <div
      className="flex h-screen overflow-hidden text-[#17191c]"
      style={{
        backgroundColor: "#f7fbff",
        backgroundImage:
          "linear-gradient(135deg, rgba(255,252,247,0.98) 0%, rgba(247,252,255,0.92) 38%, rgba(239,248,255,0.92) 68%, rgba(255,248,220,0.72) 100%), repeating-linear-gradient(0deg, rgba(23,25,28,0.024) 0 1px, transparent 1px 3px)",
        backgroundBlendMode: "normal, overlay",
      }}
    >
      <aside className="m-3 mr-0 flex w-[238px] shrink-0 flex-col rounded-lg border border-white/70 bg-white/52 shadow-[0_24px_70px_rgba(70,96,138,0.14)] backdrop-blur-2xl">
        <div className="px-5 py-5">
          <div className="flex items-center gap-3">
            <img src="/images/logo-cutout.png" alt="" className="h-7 w-auto object-contain" />
            <p className="text-[15px] font-semibold leading-none text-[#17191c]">ViviDrop</p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-5">
          <div className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon
              const active = view === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => setView(item.id)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition ${
                    active
                      ? "bg-[#eeeaff]/70 text-[#4d4961] ring-1 ring-[#d8d2ff]/60 shadow-[0_12px_28px_rgba(126,116,190,0.12)]"
                      : "text-[#5f6671] hover:bg-white/55 hover:text-[#17191c]"
                  }`}
                >
                  <Icon className={`h-4 w-4 ${active ? "text-[#746aa8]" : "text-[#858b96]"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-tight">{item.label}</p>
                    <p className="sr-only">{item.caption}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </nav>

        <div className="p-3">
          <button
            onClick={() => setLogoutConfirmOpen(true)}
            className="group relative flex w-full items-center justify-between rounded-lg border border-[#b8dfff] bg-[#e4f5ff] px-3 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.78),0_14px_34px_rgba(38,128,190,0.12)] transition hover:border-[#94ccfa] hover:bg-[#d8efff]"
            aria-label="退出登录"
            title="点击退出登录"
          >
            <div className="flex min-w-0 items-center gap-2.5 pr-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f3fbff] text-[#1b78c2] ring-1 ring-white/80">
                <UserCircle className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="flex items-start gap-1 text-[13px] font-semibold leading-tight text-[#1d5f93]">
                  <span className="truncate">{localDevice.name}</span>
                  <span
                    className="-mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/82 text-[#1b78c2] shadow-[0_4px_10px_rgba(38,128,190,0.14)] ring-1 ring-white/90"
                    aria-label="商务会员"
                    title="商务会员"
                  >
                    <Crown className="h-2.5 w-2.5" />
                  </span>
                </p>
                <p className="mt-0.5 truncate text-[12px] leading-tight text-[#327db3]">{currentAccountEmail}</p>
              </div>
            </div>
            <LogOut className="h-4 w-4 shrink-0 text-[#327db3] transition group-hover:text-[#185f9a]" />
          </button>
        </div>
      </aside>

      <main className="m-3 min-w-0 flex-1 overflow-hidden rounded-lg border border-white/60 bg-white/35 shadow-[0_30px_90px_rgba(70,96,138,0.12)] backdrop-blur-2xl">
        {view === "home" && (
          <PageFrame title="同步记录">
            <InboxWorkspace
              allFiles={inboxFileList}
              cloudDevices={cloudDeviceList}
              receiveDirectoryPath={receiveDirectoryPath}
              receiveDiskRemainingSpace={receiveDiskRemainingSpace}
              onOpenComputerPath={openComputerPath}
            />
          </PageFrame>
        )}
        {view === "devices" && (
          <DevicesPage
            devices={devices}
            onAction={notifyAction}
            onDevicesChange={setDevices}
            onViewSyncRecords={() => setView("home")}
          />
        )}
        {view === "computer" && (
          <MyComputerPage
            code={currentConnectionCode}
            codeVisible={connectionCodeVisible}
            localDevice={localDevice}
            qrVisible={connectionQrVisible}
            receiveDirectoryPath={receiveDirectoryPath}
            receiveDiskRemainingSpace={receiveDiskRemainingSpace}
            onAction={notifyAction}
            onOpenConnectionCodeSettings={openConnectionCodeDialog}
            onReceiveDirectoryPathChange={setReceiveDirectoryPath}
            onReceiveDiskRemainingSpaceChange={setReceiveDiskRemainingSpace}
            onToggleConnectionCodeVisible={toggleConnectionCodeVisibility}
            onToggleConnectionQr={toggleConnectionQr}
          />
        )}
        {view === "access" && <AccessRecordsPage />}
        {view === "settings" && (
          <SettingsPage
            accountEmail={currentAccountEmail}
            localDevice={localDevice}
            preventSleep={preventSleep}
            uiLanguage={uiLanguage}
            onAction={notifyAction}
            onPreventSleepChange={setPreventSleep}
            onUiLanguageChange={setUiLanguage}
          />
        )}
      </main>
      <TopRightActions onAction={notifyAction} />
      <ConnectionCodeDialog
        codeDraft={connectionCodeDraft}
        open={connectionCodeDialogOpen}
        onOpenChange={(open) => {
          setConnectionCodeDialogOpen(open)
          if (open) setConnectionCodeDraft(currentConnectionCode)
        }}
        onCodeDraftChange={(value) => setConnectionCodeDraft(normalizeConnectionCode(value))}
        onSubmit={handleConnectionCodeSubmit}
      />
      <DeviceNameDialog
        name={localDeviceNameDraft}
        open={deviceNameDialogOpen}
        onNameChange={setLocalDeviceNameDraft}
        onOpenChange={setDeviceNameDialogOpen}
        onSubmit={handleDeviceNameSubmit}
      />
      <ConfirmDialog
        open={logoutConfirmOpen}
        title="退出登录"
        description={`确定要退出当前账号 ${currentAccountEmail} 吗？退出后需重新登录才能使用同步功能。`}
        confirmLabel="确认退出"
        onConfirm={handleLogout}
        onOpenChange={setLogoutConfirmOpen}
      />
    </div>
  )
}

function TopRightActions({ onAction }: { onAction: (message: string) => void }) {
  const [openPanel, setOpenPanel] = useState<"help" | "download" | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  const togglePanel = (panel: "help" | "download") => {
    setOpenPanel((current) => (current === panel ? null : panel))
  }

  useEffect(() => {
    const openDownload = () => setOpenPanel("download")
    window.addEventListener("vividrop:open-download", openDownload)
    return () => window.removeEventListener("vividrop:open-download", openDownload)
  }, [])

  const pillClass =
    "inline-flex h-8 items-center gap-1.5 rounded-full border border-white/70 bg-white/64 px-3 text-xs font-semibold text-[#4f5b68] shadow-[0_10px_26px_rgba(70,96,138,0.12)] backdrop-blur-xl transition hover:bg-white/88 hover:text-[#17191c]"

  return (
    <div className="fixed right-7 top-6 z-50">
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpenPanel(null)
            setHelpOpen(true)
          }}
          className={pillClass}
        >
          <HelpCircle className="h-3.5 w-3.5 shrink-0" />
          帮助
        </button>
        <button
          type="button"
          onClick={() => togglePanel("download")}
          aria-expanded={openPanel === "download"}
          className={pillClass}
        >
          <Smartphone className="h-3.5 w-3.5 shrink-0" />
          下载移动端
        </button>
      </div>

      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />

      {openPanel === "download" && (
        <div className="absolute right-0 top-10 w-[300px] rounded-lg border border-white/70 bg-[#f7fbff]/96 p-4 shadow-[0_30px_80px_rgba(70,96,138,0.22)] backdrop-blur-2xl">
          <p className="text-sm font-semibold text-[#17191c]">扫码下载移动端</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="flex flex-col items-center gap-2 rounded-md border border-white/80 bg-white/60 p-2.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#17191c]">
                iOS
              </div>
              <div className="flex h-[88px] w-[88px] items-center justify-center rounded-md border border-white/80 bg-white p-1.5">
                <QRCodeSVG
                  value="https://vividrop.example/download/ios"
                  size={74}
                  bgColor="#ffffff"
                  fgColor="#17191c"
                  title="iOS 下载二维码"
                />
              </div>
              <button
                type="button"
                onClick={() => onAction("已打开 App Store 下载页")}
                className="inline-flex min-h-7 w-full items-center justify-center rounded-md bg-white/70 px-2 text-[11px] font-semibold text-[#59616d] transition hover:bg-white/90 hover:text-[#17191c]"
              >
                App Store
              </button>
            </div>
            <div className="flex flex-col items-center gap-2 rounded-md border border-white/80 bg-white/60 p-2.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#17191c]">
                Android
              </div>
              <div className="flex h-[88px] w-[88px] items-center justify-center rounded-md border border-white/80 bg-white p-1.5">
                <QRCodeSVG
                  value="https://vividrop.example/download/android"
                  size={74}
                  bgColor="#ffffff"
                  fgColor="#17191c"
                  title="Android 下载二维码"
                />
              </div>
              <button
                type="button"
                onClick={() => onAction("已打开 Android 下载页")}
                className="inline-flex min-h-7 w-full items-center justify-center rounded-md bg-white/70 px-2 text-[11px] font-semibold text-[#59616d] transition hover:bg-white/90 hover:text-[#17191c]"
              >
                Android
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PageFrame({
  title,
  description,
  children,
}: {
  eyebrow?: string
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="h-full overflow-auto custom-scrollbar">
      <div className="mx-auto max-w-[1460px] px-8 py-6">
        <header className="mb-5 flex min-h-12 items-center justify-between gap-5 border-b border-white/60 pb-5">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold leading-tight text-[#17191c]">{title}</h1>
            {description && <p className="mt-2 max-w-[620px] truncate text-xs leading-5 text-[#7b8490]">{description}</p>}
          </div>
        </header>
        {children}
      </div>
    </div>
  )
}

function AuthPage({ onAuthSuccess }: { onAuthSuccess: (provider: AuthProvider, identity: string) => void }) {
  const [agreedToPrivacy, setAgreedToPrivacy] = useState(false)
  const [showAgreementHint, setShowAgreementHint] = useState(false)

  const handleProviderClick = (provider: AuthProvider, identity: string) => {
    if (!agreedToPrivacy) {
      setShowAgreementHint(true)
      return
    }
    onAuthSuccess(provider, identity)
  }

  return (
    <div
      className="relative flex h-screen items-center justify-center overflow-hidden px-6 text-[#17191c]"
      style={{
        backgroundColor: "#f7fbff",
        backgroundImage:
          "linear-gradient(135deg, rgba(255,252,247,0.98) 0%, rgba(247,252,255,0.92) 38%, rgba(239,248,255,0.92) 68%, rgba(255,248,220,0.72) 100%), repeating-linear-gradient(0deg, rgba(23,25,28,0.024) 0 1px, transparent 1px 3px)",
        backgroundBlendMode: "normal, overlay",
      }}
    >
      <div className="absolute left-10 top-10 flex items-center gap-3">
        <img src="/images/logo-cutout.png" alt="" className="h-9 w-auto object-contain" />
        <p className="text-[18px] font-semibold leading-none text-[#17191c]">ViviDrop</p>
      </div>

      <div className="w-full max-w-[440px]">
        <section className="rounded-lg border border-white/70 bg-white/54 p-5 shadow-[0_30px_90px_rgba(70,96,138,0.16)] backdrop-blur-2xl">
          <div className="mb-5 text-center">
            <h2 className="text-xl font-semibold text-[#17191c]">登录</h2>
          </div>

          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              onClick={() => handleProviderClick("google", accountProfile.email)}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-white/70 bg-white/58 text-sm font-semibold text-[#17191c] shadow-[0_10px_30px_rgba(90,120,170,0.08)] transition hover:bg-white/82"
            >
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.16-3.16A11 11 0 0 0 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38Z"
                />
              </svg>
              使用 Google 继续
            </button>
            <button
              type="button"
              onClick={() => handleProviderClick("apple", accountProfile.email)}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-white/70 bg-white/58 text-sm font-semibold text-[#17191c] shadow-[0_10px_30px_rgba(90,120,170,0.08)] transition hover:bg-white/82"
            >
              <svg className="h-4 w-4 shrink-0 text-[#17191c]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M17.05 20.28c-.98.95-2.05.86-3.08.41-1.09-.47-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.41C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08ZM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25Z" />
              </svg>
              使用 Apple 继续
            </button>
          </div>

          <label className="mt-5 flex cursor-pointer items-start gap-2 text-xs leading-5 text-[#7b8490]">
            <button
              type="button"
              role="checkbox"
              aria-checked={agreedToPrivacy}
              onClick={() => {
                setAgreedToPrivacy((prev) => !prev)
                setShowAgreementHint(false)
              }}
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition ${
                agreedToPrivacy
                  ? "border-[#17191c] bg-[#17191c] text-white"
                  : "border-[#cfd6df] bg-white/70 text-transparent"
              }`}
            >
              <Check className="h-3 w-3" strokeWidth={3} />
            </button>
            <span>
              我已阅读并同意
              <a
                href="#"
                onClick={(event) => event.stopPropagation()}
                className="font-semibold text-[#17191c] underline-offset-2 hover:underline"
              >
                《隐私政策》
              </a>
              和
              <a
                href="#"
                onClick={(event) => event.stopPropagation()}
                className="font-semibold text-[#17191c] underline-offset-2 hover:underline"
              >
                《用户协议》
              </a>
            </span>
          </label>

          {showAgreementHint ? (
            <p className="mt-2 text-center text-xs font-medium text-[#d92d20]">请先勾选同意隐私政策后再登录</p>
          ) : null}

          <p className="mt-4 text-center text-xs text-[#7b8490]">未注册的账号将自动注册</p>
        </section>
      </div>
    </div>
  )
}

function ConnectionCodeForm({
  codeDraft,
  submitLabel,
  cancelLabel,
  onCancel,
  onCodeDraftChange,
  onSubmit,
}: {
  codeDraft: string
  submitLabel: string
  cancelLabel?: string
  onCancel?: () => void
  onCodeDraftChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-[#7b8490]">连接码</span>
        <input
          autoFocus
          required
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          value={codeDraft}
          onChange={(event) => onCodeDraftChange(event.currentTarget.value)}
          placeholder="输入 6 位数字"
          className="h-12 w-full rounded-lg border border-white/70 bg-white/70 px-3 text-center font-mono text-2xl font-semibold tracking-[0.18em] text-[#17191c] outline-none shadow-[0_10px_30px_rgba(90,120,170,0.08)] transition placeholder:text-base placeholder:tracking-normal placeholder:text-[#a4acb7] focus:border-[#66c6ff] focus:ring-2 focus:ring-[#66c6ff]/18"
        />
      </label>
      {onCancel ? (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 rounded-md border border-white/70 bg-white/52 px-4 text-sm font-semibold text-[#59616d] transition hover:bg-white/78"
          >
            {cancelLabel ?? "取消"}
          </button>
          <button
            type="submit"
            disabled={codeDraft.length !== 6}
            className="flex h-10 items-center justify-center rounded-md bg-[#17191c] px-4 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(23,25,28,0.18)] transition hover:bg-[#2b2f36] disabled:cursor-not-allowed disabled:bg-[#cfd6df]"
          >
            {submitLabel}
          </button>
        </div>
      ) : (
        <button
          type="submit"
          disabled={codeDraft.length !== 6}
          className="flex h-11 w-full items-center justify-center rounded-md bg-[#17191c] text-sm font-semibold text-white shadow-[0_16px_30px_rgba(23,25,28,0.18)] transition hover:bg-[#2b2f36] disabled:cursor-not-allowed disabled:bg-[#cfd6df]"
        >
          {submitLabel}
        </button>
      )}
    </form>
  )
}

function ConnectionCodeSetupPage({
  codeDraft,
  localDeviceName,
  onCodeDraftChange,
  onLogout,
  onSubmit,
}: {
  codeDraft: string
  localDeviceName: string
  onCodeDraftChange: (value: string) => void
  onLogout: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <div
      className="flex h-screen items-center justify-center overflow-hidden px-6 text-[#17191c]"
      style={{
        backgroundColor: "#f7fbff",
        backgroundImage:
          "linear-gradient(135deg, rgba(255,252,247,0.98) 0%, rgba(247,252,255,0.92) 38%, rgba(239,248,255,0.92) 68%, rgba(255,248,220,0.72) 100%), repeating-linear-gradient(0deg, rgba(23,25,28,0.024) 0 1px, transparent 1px 3px)",
        backgroundBlendMode: "normal, overlay",
      }}
    >
      <section className="max-h-[92vh] w-full max-w-[560px] overflow-y-auto rounded-lg border border-white/70 bg-white/56 p-5 shadow-[0_30px_90px_rgba(70,96,138,0.16)] backdrop-blur-2xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#17191c] text-white shadow-[0_12px_24px_rgba(23,25,28,0.16)]">
              <QrCode className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-[#17191c]">设置连接码</h1>
              <p className="mt-1 truncate text-xs text-[#7b8490]">{localDeviceName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="rounded-md border border-white/70 bg-white/48 px-3 py-2 text-xs font-semibold text-[#59616d] transition hover:bg-white/78"
          >
            退出
          </button>
        </div>
        <ConnectionCodeForm
          codeDraft={codeDraft}
          submitLabel="保存并进入ViviDrop"
          onCodeDraftChange={onCodeDraftChange}
          onSubmit={onSubmit}
        />
        <MobileAppGuide />
      </section>
    </div>
  )
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onOpenChange,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/70 bg-[#f7fbff]/96 p-0 text-[#17191c] shadow-[0_30px_90px_rgba(23,25,28,0.18)] sm:max-w-[420px]">
        <div className="space-y-5 p-5">
          <DialogHeader className="text-left">
            <DialogTitle className="text-base font-semibold text-[#17191c]">{title}</DialogTitle>
            <DialogDescription className="mt-1 text-xs leading-5 text-[#7b8490]">{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-between">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-10 rounded-md border border-white/70 bg-white/52 px-4 text-sm font-semibold text-[#59616d] transition hover:bg-white/78"
            >
              取消
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="h-10 rounded-md bg-[#d92d20] px-4 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(217,45,32,0.22)] transition hover:bg-[#b42318]"
            >
              {confirmLabel}
            </button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ConnectionCodeDialog({
  codeDraft,
  open,
  onCodeDraftChange,
  onOpenChange,
  onSubmit,
}: {
  codeDraft: string
  open: boolean
  onCodeDraftChange: (value: string) => void
  onOpenChange: (open: boolean) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/70 bg-[#f7fbff]/96 p-0 text-[#17191c] shadow-[0_30px_90px_rgba(23,25,28,0.18)] sm:max-w-[420px]">
        <div className="space-y-5 p-5">
          <DialogHeader className="text-left">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#17191c] text-white shadow-[0_12px_24px_rgba(23,25,28,0.16)]">
                <QrCode className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-semibold text-[#17191c]">设置连接码</DialogTitle>
                <DialogDescription className="mt-1 text-xs text-[#7b8490]">
                  手机输入该连接码后连接此电脑
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <ConnectionCodeForm
            codeDraft={codeDraft}
            submitLabel="保存连接码"
            cancelLabel="取消"
            onCancel={() => onOpenChange(false)}
            onCodeDraftChange={onCodeDraftChange}
            onSubmit={onSubmit}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DeviceNameDialog({
  name,
  open,
  onNameChange,
  onOpenChange,
  onSubmit,
}: {
  name: string
  open: boolean
  onNameChange: (value: string) => void
  onOpenChange: (open: boolean) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/70 bg-[#f7fbff]/96 p-0 text-[#17191c] shadow-[0_30px_90px_rgba(23,25,28,0.18)] sm:max-w-[420px]">
        <form onSubmit={onSubmit} className="space-y-5 p-5">
          <DialogHeader className="text-left">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#17191c] text-white shadow-[0_12px_24px_rgba(23,25,28,0.16)]">
                <Pencil className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-semibold text-[#17191c]">编辑设备名</DialogTitle>
                <DialogDescription className="mt-1 text-xs text-[#7b8490]">
                  该名称会显示在连接码与二维码配对信息中
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-[#7b8490]">设备名</span>
            <input
              autoFocus
              required
              value={name}
              onChange={(event) => onNameChange(event.currentTarget.value)}
              placeholder="输入设备名"
              className="h-11 w-full rounded-lg border border-white/70 bg-white/62 px-3 text-sm text-[#17191c] outline-none shadow-[0_10px_30px_rgba(90,120,170,0.08)] transition placeholder:text-[#a4acb7] focus:border-[#66c6ff] focus:ring-2 focus:ring-[#66c6ff]/18"
            />
          </label>

          <DialogFooter className="gap-2 sm:justify-between">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-10 rounded-md border border-white/70 bg-white/52 px-4 text-sm font-semibold text-[#59616d] transition hover:bg-white/78"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="h-10 rounded-md bg-[#17191c] px-4 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(23,25,28,0.18)] transition hover:bg-[#2b2f36] disabled:cursor-not-allowed disabled:bg-[#cfd6df]"
            >
              保存
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ConnectionCodeCard({
  code,
  codeVisible,
  compact = false,
  localDeviceName,
  onOpenSettings,
  onToggleCodeVisible,
  onToggleQr,
  qrVisible,
}: {
  code: string
  codeVisible: boolean
  compact?: boolean
  localDeviceName: string
  onOpenSettings: () => void
  onToggleCodeVisible: () => void
  onToggleQr: () => void
  qrVisible: boolean
}) {
  const maskedCode = code.replace(/\d/g, "*")
  const qrSize = compact ? 100 : 132

  return (
    <div className={`${compact ? "mt-3 px-3 py-3" : "p-5"} rounded-lg border border-white/70 bg-white/56 shadow-[0_10px_30px_rgba(90,120,170,0.08)]`}>
      <div className={compact ? "flex items-center justify-between gap-3" : "relative"}>
        <div
          onDoubleClick={codeVisible ? onOpenSettings : undefined}
          className={`min-w-0 select-none ${codeVisible ? "cursor-pointer" : "cursor-default"} ${compact ? "flex-1" : "flex flex-col items-center px-12 text-center"}`}
          title={codeVisible ? "双击编辑连接码" : "显示连接码后可双击编辑"}
        >
          {compact && <p className="text-[10px] font-medium text-[#767b86]">连接码</p>}
          <p className={`${compact ? "mt-1 text-[17px]" : "text-3xl"} whitespace-nowrap font-mono font-semibold tracking-[0.06em] text-[#17191c] [font-variant-numeric:tabular-nums]`}>
            {codeVisible ? code : maskedCode}
          </p>
          {!compact && (
            <p className="mt-1.5 text-xs text-[#9aa2ad]">{codeVisible ? "双击修改连接码" : "显示连接码后可双击修改"}</p>
          )}
        </div>
        <div
          className={
            compact
              ? "flex shrink-0 items-center gap-1"
              : "absolute right-0 top-1/2 flex -translate-y-1/2 items-center gap-1"
          }
        >
          <button
            type="button"
            onClick={onToggleCodeVisible}
            className={`${compact ? "p-2" : "h-10 w-10"} flex items-center justify-center rounded-md text-[#626a76] transition hover:bg-[#e9f7ff] hover:text-[#1677d2]`}
            aria-label={codeVisible ? "隐藏连接码" : "显示连接码"}
            title={codeVisible ? "隐藏连接码" : "显示连接码"}
          >
            {codeVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={onToggleQr}
            className={`${compact ? "p-2" : "h-10 w-10"} flex items-center justify-center rounded-md text-[#626a76] transition hover:bg-[#e9f7ff] hover:text-[#1677d2]`}
            aria-label={qrVisible ? "收起连接二维码" : "显示连接二维码"}
            title={qrVisible ? "收起连接二维码" : "显示连接二维码"}
          >
            <ChevronDown className={`h-4 w-4 transition ${qrVisible ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>
      {qrVisible && (
        <div className={`${compact ? "mt-3 p-3" : "mt-5 p-4"} rounded-lg border border-white/70 bg-white/68 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.68)]`}>
          <div
            className={`${compact ? "h-[116px] w-[116px]" : "h-[152px] w-[152px]"} mx-auto flex items-center justify-center rounded-lg bg-white p-2 shadow-[0_12px_28px_rgba(70,96,138,0.12)]`}
          >
            <QRCodeSVG
              value={`vividrop://connect?device=${encodeURIComponent(localDeviceName)}&code=${code.replace(/\s/g, "")}`}
              size={qrSize}
              bgColor="#ffffff"
              fgColor="#17191c"
              level="M"
              marginSize={1}
              title="ViviDrop 连接二维码"
            />
          </div>
          <p className="mt-2 text-[11px] font-medium text-[#7b8490]">手机扫码配对该电脑</p>
        </div>
      )}
    </div>
  )
}

function MobileAppGuide() {
  const steps = [
    {
      icon: Download,
      title: "扫码下载手机端",
      description: "用手机扫描右侧二维码，下载并安装 ViviDrop 手机端",
    },
    {
      icon: Smartphone,
      title: "输入连接码配对",
      description: "在手机端输入此连接码即可连接此电脑，同一局域网下自动同步手机相册和文件到此电脑",
    },
    {
      icon: RefreshCw,
      title: "远程访问电脑文件",
      description: "连接码连接成功后，手机可远程访问这台电脑的文件",
    },
  ]

  return (
    <div className="mt-4 rounded-lg border border-white/70 bg-white/56 p-5 shadow-[0_10px_30px_rgba(90,120,170,0.08)]">
      <h3 className="text-sm font-semibold text-[#17191c]">使用与下载手机端</h3>
      <div className="mt-4 flex flex-col gap-5">
        <ol className="flex min-w-0 flex-1 flex-col gap-4">
          {steps.map((step, index) => (
            <li key={step.title} className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#e9f7ff] text-[#1677d2]">
                <step.icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-[#17191c]">
                  {index + 1}. {step.title}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-[#7b8490]">{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex shrink-0 flex-row justify-center gap-8 pt-1">
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#17191c]">
              iOS
            </div>
            <div className="flex h-[112px] w-[112px] items-center justify-center rounded-lg bg-white p-2 shadow-[0_12px_28px_rgba(70,96,138,0.12)]">
              <QRCodeSVG
                value="https://vividrop.app/download/ios"
                size={92}
                bgColor="#ffffff"
                fgColor="#17191c"
                level="M"
                marginSize={1}
                title="iOS 下载二维码"
              />
            </div>
            <p className="text-[11px] font-medium text-[#7b8490]">App Store</p>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#17191c]">
              Android
            </div>
            <div className="flex h-[112px] w-[112px] items-center justify-center rounded-lg bg-white p-2 shadow-[0_12px_28px_rgba(70,96,138,0.12)]">
              <QRCodeSVG
                value="https://vividrop.app/download/android"
                size={92}
                bgColor="#ffffff"
                fgColor="#17191c"
                level="M"
                marginSize={1}
                title="Android 下载二维码"
              />
            </div>
            <p className="text-[11px] font-medium text-[#7b8490]">Android</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function InboxWorkspace({
  allFiles,
  cloudDevices,
  receiveDirectoryPath,
  receiveDiskRemainingSpace,
  onOpenComputerPath,
}: {
  allFiles: InboxFile[]
  cloudDevices: CloudDevice[]
  receiveDirectoryPath: string
  receiveDiskRemainingSpace: string
  onOpenComputerPath: (path: string) => void
}) {
  const getCloudDeviceFileCount = (deviceId: string) =>
    allFiles.filter((file) => file.sourceDeviceId === deviceId).length
  const getCloudDeviceFileBreakdown = (deviceId: string) => {
    const files = allFiles.filter((file) => file.sourceDeviceId === deviceId)
    return {
      albums: files.filter((file) => file.kind === "album").length,
      folders: files.filter((file) => file.kind !== "album").length,
    }
  }
  const getCloudDeviceTotalSize = (deviceId: string) =>
    formatFileSize(
      allFiles
        .filter((file) => file.sourceDeviceId === deviceId)
        .reduce((total, file) => total + getFileSizeInMb(file.size), 0),
    )

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <ComputerInfoTile icon={FileText} label="总接收文件数" value="5" tone="blue" />
        <ComputerInfoTile icon={HardDrive} label="占用总空间" value="9.2 MB" tone="green" />
        <ComputerInfoTile icon={HardDrive} label="磁盘剩余空间" value={receiveDiskRemainingSpace} tone="cyan" />
      </div>
      <div className="flex justify-end">
        <span className="px-1 text-xs font-semibold text-[#7b8490]">{cloudDevices.length} 台设备</span>
      </div>
      <div className="grid grid-cols-1 gap-3 border-y border-white/60 py-3">
        {cloudDevices.map((device) => (
          <CloudDeviceButton
            key={device.id}
            accountName={device.accountName}
            breakdown={getCloudDeviceFileBreakdown(device.id)}
            count={getCloudDeviceFileCount(device.id)}
            icon={Smartphone}
            label={device.name}
            model={device.model}
            path={getReceiveDevicePath(receiveDirectoryPath, device)}
            totalSize={getCloudDeviceTotalSize(device.id)}
            tone={device.tone}
            onOpenPath={onOpenComputerPath}
          />
        ))}
      </div>
    </section>
  )
}

function ComputerInfoTile({
  icon: Icon,
  label,
  value,
  tone,
  active,
  onClick,
}: {
  icon: LucideIcon
  label: string
  value: string
  tone: "blue" | "green" | "cyan"
  active?: boolean
  onClick?: () => void
}) {
  const toneClasses = {
    blue: "bg-[#f0f8ff]/72 text-[#2788dc] shadow-[0_14px_36px_rgba(75,158,226,0.11)]",
    green: "bg-[#f1fbf3]/76 text-[#2c9c5a] shadow-[0_14px_36px_rgba(64,176,101,0.11)]",
    cyan: "bg-[#eefbff]/74 text-[#14a4d8] shadow-[0_14px_36px_rgba(49,176,215,0.11)]",
  }[tone]

  const iconClasses = {
    blue: "bg-[#48a7f4] text-white shadow-[0_12px_26px_rgba(72,167,244,0.28)]",
    green: "bg-[#46c878] text-white shadow-[0_12px_26px_rgba(70,200,120,0.25)]",
    cyan: "bg-[#22b5e4] text-white shadow-[0_12px_26px_rgba(34,181,228,0.24)]",
  }[tone]

  const ringClasses = {
    blue: "ring-2 ring-[#48a7f4]/55",
    green: "ring-2 ring-[#46c878]/55",
    cyan: "ring-2 ring-[#22b5e4]/55",
  }[tone]

  const content = (
    <>
      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${iconClasses}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 text-left">
        <p className="truncate text-xs font-semibold text-[#697786]">{label}</p>
        <p className="mt-1 text-2xl font-semibold leading-none text-[#17191c]">{value}</p>
      </div>
    </>
  )

  const baseClasses = `flex min-h-[84px] items-center gap-4 rounded-lg border border-white/70 px-5 py-4 backdrop-blur-xl ${toneClasses}`

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={`${baseClasses} transition hover:brightness-[1.03] ${active ? ringClasses : ""}`}
      >
        {content}
      </button>
    )
  }

  return <div className={baseClasses}>{content}</div>
}

function DevicesPage({
  devices,
  onAction,
  onDevicesChange,
  onViewSyncRecords,
}: {
  devices: Device[]
  onAction: (message: string) => void
  onDevicesChange: (devices: Device[] | ((current: Device[]) => Device[])) => void
  onViewSyncRecords: () => void
}) {
  const [statusFilter, setStatusFilter] = useState<"all" | "connected" | "blocked">("all")
  const [completedDevice, setCompletedDevice] = useState<{ name: string; fileName: string } | null>(null)

  useEffect(() => {
    const hasTransferring = devices.some(
      (device) => device.status === "transferring" && typeof device.currentFile?.progress === "number",
    )
    if (!hasTransferring) return

    const timer = window.setInterval(() => {
      const justCompleted: { name: string; fileName: string }[] = []

      const nextDevices = devices.map((device) => {
        if (
          device.status !== "transferring" ||
          !device.currentFile ||
          typeof device.currentFile.progress !== "number"
        ) {
          return device
        }

        const nextProgress = Math.min(100, device.currentFile.progress + 6)

        if (nextProgress >= 100) {
          const finishedFile = device.currentFile
          justCompleted.push({
            name: getDeviceAccountName(device),
            fileName: finishedFile.name,
          })
          return {
            ...device,
            status: "connected" as const,
            currentFile: undefined,
            queue: device.queue.map((file) =>
              file.id === finishedFile.id ? { ...file, status: "done" as const, progress: 100 } : file,
            ),
          }
        }

        return {
          ...device,
          currentFile: { ...device.currentFile, progress: nextProgress },
          queue: device.queue.map((file) =>
            file.id === device.currentFile?.id ? { ...file, progress: nextProgress } : file,
          ),
        }
      })

      onDevicesChange(nextDevices)
      if (justCompleted.length > 0) {
        setCompletedDevice(justCompleted[justCompleted.length - 1])
      }
    }, 900)

    return () => window.clearInterval(timer)
  }, [devices, onDevicesChange])
  const [blockTarget, setBlockTarget] = useState<Device | null>(null)

  const stopDeviceTransfer = (device: Device): Device => ({
    ...device,
    currentFile: undefined,
    queue: device.queue.filter((file) => file.status !== "transferring" && file.status !== "waiting"),
  })

  const confirmBlockDevice = () => {
    if (!blockTarget) return
    const accountName = getDeviceAccountName(blockTarget)
    onDevicesChange((current) =>
      current.map((item) =>
        item.id === blockTarget.id
          ? { ...stopDeviceTransfer(item), status: "disconnected", blocked: true }
          : item,
      ),
    )
    onAction(`${accountName} 已禁用，连接与传输已停止`)
    setBlockTarget(null)
  }

  const handleDeviceAction = (device: Device, actionLabel: string) => {
    const accountName = getDeviceAccountName(device)

    if (actionLabel === "禁用") {
      setBlockTarget(device)
      return
    }

    if (actionLabel === "取消禁用") {
      onDevicesChange((current) =>
        current.map((item) =>
          item.id === device.id ? { ...stopDeviceTransfer(item), blocked: false, authFailures: 0 } : item,
        ),
      )
      onAction(`${accountName} 已取消禁用，设备需重新连接`)
    }
  }

  const isConnectedDevice = (device: Device) => device.status !== "disconnected" && !isDeviceBlocked(device)
  const connectedCount = devices.filter(isConnectedDevice).length
  const blockedCount = devices.filter(isDeviceBlocked).length
  const visibleDevices =
    statusFilter === "connected"
      ? devices.filter(isConnectedDevice)
      : statusFilter === "blocked"
        ? devices.filter(isDeviceBlocked)
        : devices

  return (
    <PageFrame title="设备管理">
      <div className="mb-4 grid grid-cols-3 gap-4">
        <ComputerInfoTile
          icon={Smartphone}
          label="总设备"
          value={String(devices.length)}
          tone="blue"
          active={statusFilter === "all"}
          onClick={() => setStatusFilter("all")}
        />
        <ComputerInfoTile
          icon={ShieldAlert}
          label="已禁用"
          value={String(blockedCount)}
          tone="green"
          active={statusFilter === "blocked"}
          onClick={() => setStatusFilter((current) => (current === "blocked" ? "all" : "blocked"))}
        />
        <ComputerInfoTile
          icon={Wifi}
          label="已连接"
          value={String(connectedCount)}
          tone="cyan"
          active={statusFilter === "connected"}
          onClick={() => setStatusFilter((current) => (current === "connected" ? "all" : "connected"))}
        />
      </div>
      <DeviceManagementPanel devices={visibleDevices} onDeviceAction={handleDeviceAction} />
      <ConfirmDialog
        open={blockTarget !== null}
        title="禁用设备"
        description={
          blockTarget
            ? `禁用后 ${getDeviceAccountName(blockTarget)} 将断开连接并停止所有传输，确定要禁用该设备吗？`
            : ""
        }
        confirmLabel="确认禁用"
        onConfirm={confirmBlockDevice}
        onOpenChange={(open) => {
          if (!open) setBlockTarget(null)
        }}
      />
      <Dialog
        open={completedDevice !== null}
        onOpenChange={(open) => {
          if (!open) setCompletedDevice(null)
        }}
      >
        <DialogContent className="border-white/70 bg-[#f7fbff]/96 p-0 text-[#17191c] shadow-[0_30px_90px_rgba(23,25,28,0.18)] sm:max-w-[420px]">
          <div className="space-y-5 p-5">
            <DialogHeader className="text-left">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e6f7ec] text-[#1f9d55]">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <DialogTitle className="text-base font-semibold text-[#17191c]">传输完成</DialogTitle>
                  <DialogDescription className="mt-1 text-xs leading-5 text-[#7b8490]">
                    {completedDevice
                      ? `${completedDevice.name} 的「${completedDevice.fileName}」已接收完成`
                      : ""}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:justify-between">
              <button
                type="button"
                onClick={() => setCompletedDevice(null)}
                className="h-10 rounded-md border border-white/70 bg-white/52 px-4 text-sm font-semibold text-[#59616d] transition hover:bg-white/78"
              >
                稍后查看
              </button>
              <button
                type="button"
                onClick={() => {
                  setCompletedDevice(null)
                  onViewSyncRecords()
                }}
                className="h-10 rounded-md bg-[#17191c] px-4 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(23,25,28,0.18)] transition hover:bg-[#2b2f36]"
              >
                查看同步记录
              </button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </PageFrame>
  )
}

function DeviceManagementPanel({
  devices,
  onDeviceAction,
}: {
  devices: Device[]
  onDeviceAction: (device: Device, actionLabel: string) => void
}) {
  return (
    <section className="space-y-3 border-y border-white/60 py-3">
      {devices.length > 0 ? (
        devices.map((device) => (
          <DeviceAccordionRow
            key={device.id}
            device={device}
            onAction={onDeviceAction}
          />
        ))
      ) : (
        <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-white/70 bg-white/24 px-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#eaf6ff] text-[#1677d2]">
            <Smartphone className="h-5 w-5" />
          </div>
          <p className="mt-4 text-sm font-semibold text-[#17191c]">暂无设备</p>
          <p className="mt-1 text-xs text-[#7b8490]">连接手机后会显示在这里</p>
        </div>
      )}
    </section>
  )
}

type AccessRecord = {
  id: string
  accountName: string
  model: string
  deviceName: string
  date: string
  location: string
  ip: string
  downloadedFiles: string[]
}

const accessRecords: AccessRecord[] = [
  {
    id: "ar-1",
    accountName: "chen@icloud.example",
    model: "iPhone 15 Pro",
    deviceName: "小陈的 iPhone",
    date: "2026-06-11",
    location: "广东省深圳市 · 电信",
    ip: "192.168.1.106",
    downloadedFiles: ["产品需求文档v3.pdf", "团队合照.jpg"],
  },
  {
    id: "ar-2",
    accountName: "ops@studio.example",
    model: "小米 14",
    deviceName: "工作室小米",
    date: "2026-06-11",
    location: "广东省深圳市 · 移动",
    ip: "192.168.1.112",
    downloadedFiles: ["旅行计划.xlsx"],
  },
  {
    id: "ar-3",
    accountName: "chen@icloud.example",
    model: "iPad Air",
    deviceName: "客厅 iPad",
    date: "2026-06-10",
    location: "广东省广州市 · 联通",
    ip: "120.85.130.25",
    downloadedFiles: [],
  },
  {
    id: "ar-4",
    accountName: "archive@icloud.example",
    model: "iPhone 15 Pro",
    deviceName: "备用 iPhone",
    date: "2026-06-09",
    location: "广东省深圳市 · 电信",
    ip: "192.168.1.106",
    downloadedFiles: [
      "会议录音0608.mp3",
      "季度汇报.pptx",
      "预算表.xlsx",
      "项目排期.xlsx",
      "客户清单.pdf",
      "产品截图01.png",
      "产品截图02.png",
    ],
  },
  {
    id: "ar-5",
    accountName: "ops@studio.example",
    model: "小米 14",
    deviceName: "工作室小米",
    date: "2026-06-08",
    location: "广东省深圳市 · 移动",
    ip: "192.168.1.112",
    downloadedFiles: ["素材包0608.zip", "样机展示.psd"],
  },
  {
    id: "ar-6",
    accountName: "chen@icloud.example",
    model: "iPhone 15 Pro",
    deviceName: "小陈的 iPhone",
    date: "2026-06-07",
    location: "广东省广州市 · 联通",
    ip: "120.85.130.25",
    downloadedFiles: ["合同扫描件.pdf"],
  },
]

const RECORDS_PER_PAGE = 5

function AccessRecordsPage() {
  const [search, setSearch] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [page, setPage] = useState(1)
  
  const filteredRecords = accessRecords.filter((record) => {
    if (startDate && record.date < startDate) return false
    if (endDate && record.date > endDate) return false

    const keyword = search.trim().toLowerCase()
    if (!keyword) return true
  return [record.accountName, record.model, record.deviceName, record.location, record.ip]
  .join(" ")
  .toLowerCase()
  .includes(keyword)
  })

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / RECORDS_PER_PAGE))
  const safePage = Math.min(page, totalPages)
  const pagedRecords = filteredRecords.slice((safePage - 1) * RECORDS_PER_PAGE, safePage * RECORDS_PER_PAGE)

  useEffect(() => {
    setPage(1)
  }, [search, startDate, endDate])

  const dateInputClass =
    "h-[46px] w-[150px] shrink-0 rounded-lg border border-white/70 bg-white/54 px-3 text-sm font-medium text-[#17191c] outline-none shadow-[0_10px_30px_rgba(90,120,170,0.08)] transition [font-variant-numeric:tabular-nums] focus:border-[#66c6ff] focus:bg-white/70 focus:ring-2 focus:ring-[#66c6ff]/18"

  return (
    <PageFrame title="访问记录">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchField search={search} placeholder="搜索用户名、设备或 IP" onSearchChange={setSearch} />
        <div className="flex shrink-0 items-center gap-2">
          <input
            type="date"
            value={startDate}
            max={endDate || undefined}
            onChange={(event) => setStartDate(event.currentTarget.value)}
            aria-label="开始日期"
            className={dateInputClass}
          />
          <span className="text-sm text-[#7b8490]">-</span>
          <input
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(event) => setEndDate(event.currentTarget.value)}
            aria-label="结束日期"
            className={dateInputClass}
          />
          {(startDate || endDate) && (
            <button
              type="button"
              onClick={() => {
                setStartDate("")
                setEndDate("")
              }}
              className="h-[46px] shrink-0 rounded-lg border border-white/70 bg-white/54 px-3 text-sm font-semibold text-[#59616d] transition hover:bg-white/78 hover:text-[#17191c]"
            >
              清���
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-3">
        {pagedRecords.map((record) => (
          <AccessRecordCard key={record.id} record={record} />
        ))}
        {filteredRecords.length === 0 && (
          <div className="rounded-lg border border-white/70 bg-white/46 px-5 py-10 text-center shadow-[0_18px_54px_rgba(70,96,138,0.1)] backdrop-blur-xl">
            <p className="text-sm font-semibold text-[#17191c]">没有匹配的访问记录</p>
            <p className="mt-1 text-xs text-[#7b8490]">尝试更换关键词或日期</p>
          </div>
        )}
        {totalPages > 1 && (
          <nav className="flex items-center justify-center gap-2 pt-1" aria-label="访问记录分页">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={safePage === 1}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-white/70 bg-white/52 px-3 text-xs font-semibold text-[#4f5b68] transition hover:bg-white/80 hover:text-[#17191c] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronDown className="h-3.5 w-3.5 rotate-90" />
              上一页
            </button>
            {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => (
              <button
                key={pageNumber}
                type="button"
                onClick={() => setPage(pageNumber)}
                aria-current={safePage === pageNumber ? "page" : undefined}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-xs font-semibold transition [font-variant-numeric:tabular-nums] ${
                  safePage === pageNumber
                    ? "bg-[#1677d2] text-white shadow-[0_10px_22px_rgba(22,119,210,0.28)]"
                    : "border border-white/70 bg-white/52 text-[#4f5b68] hover:bg-white/80 hover:text-[#17191c]"
                }`}
              >
                {pageNumber}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={safePage === totalPages}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-white/70 bg-white/52 px-3 text-xs font-semibold text-[#4f5b68] transition hover:bg-white/80 hover:text-[#17191c] disabled:cursor-not-allowed disabled:opacity-40"
            >
              下一页
              <ChevronDown className="h-3.5 w-3.5 -rotate-90" />
            </button>
          </nav>
        )}
      </div>
    </PageFrame>
  )
}

function isLanIp(ip: string) {
  return /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)
}

const DEFAULT_VISIBLE_FILES = 5

function AccessRecordCard({ record }: { record: AccessRecord }) {
  const [filesOpen, setFilesOpen] = useState(false)
  const lan = isLanIp(record.ip)
  const NetworkIcon = lan ? Wifi : Globe
  const visibleFiles = filesOpen ? record.downloadedFiles : record.downloadedFiles.slice(0, DEFAULT_VISIBLE_FILES)
  const hiddenCount = record.downloadedFiles.length - DEFAULT_VISIBLE_FILES

  return (
    <article className="rounded-lg border border-white/70 bg-white/46 p-5 shadow-[0_18px_54px_rgba(70,96,138,0.1)] backdrop-blur-xl">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <ToneIcon icon={Smartphone} tone="blue" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-[#17191c]">{record.accountName}</h2>
            <p className="mt-0.5 truncate text-xs text-[#626a76]">
              {record.model} · {record.deviceName}
            </p>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-4 text-xs font-medium text-[#4f5b68]">
          <span className="w-[78px] whitespace-nowrap text-right [font-variant-numeric:tabular-nums]">{record.date}</span>
          <span className="w-[120px] truncate whitespace-nowrap text-right">{record.location}</span>
          <span className="inline-flex w-[128px] items-center justify-end gap-1.5 whitespace-nowrap font-mono [font-variant-numeric:tabular-nums]">
            <NetworkIcon className="h-3.5 w-3.5 shrink-0 text-[#7b8794]" aria-hidden="true" />
            <span className="sr-only">{lan ? "局域网" : "互联网"}</span>
            {record.ip}
          </span>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-white/70 bg-white/52">
        {record.downloadedFiles.length > 0 ? (
          <>
            <p className="flex items-center gap-1.5 px-4 py-3 text-xs font-semibold text-[#4f5b68]">
              <Download className="h-3.5 w-3.5 shrink-0 text-[#7b8794]" />
              {record.downloadedFiles.length} 个文件
            </p>
            <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 border-t border-white/70 px-4 py-3 sm:grid-cols-2">
              {visibleFiles.map((file) => (
                <li key={file} className="flex min-w-0 items-center gap-2 text-[13px] text-[#17191c]">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-[#9aa2ad]" />
                  <span className="truncate">{file}</span>
                </li>
              ))}
            </ul>
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setFilesOpen((open) => !open)}
                aria-expanded={filesOpen}
                className="flex w-full items-center justify-center gap-1 border-t border-white/70 px-4 py-2.5 text-xs font-semibold text-[#1677d2] transition hover:text-[#0d68bd]"
              >
                {filesOpen ? "收起" : "更多"}
                <ChevronDown className={`h-4 w-4 shrink-0 transition ${filesOpen ? "rotate-180" : ""}`} />
              </button>
            )}
          </>
        ) : (
          <p className="flex items-center gap-1.5 px-4 py-3 text-xs font-semibold text-[#9aa2ad]">
            <Download className="h-3.5 w-3.5 shrink-0" />
            本次未下载文件
          </p>
        )}
      </div>
    </article>
  )
}

function MyComputerPage({
  code,
  codeVisible,
  localDevice,
  onAction,
  onOpenConnectionCodeSettings,
  onReceiveDirectoryPathChange,
  onReceiveDiskRemainingSpaceChange,
  onToggleConnectionCodeVisible,
  onToggleConnectionQr,
  qrVisible,
  receiveDirectoryPath,
  receiveDiskRemainingSpace,
}: {
  code: string
  codeVisible: boolean
  localDevice: typeof initialLocalDevice
  onAction: (message: string) => void
  onOpenConnectionCodeSettings: () => void
  onReceiveDirectoryPathChange: (path: string) => void
  onReceiveDiskRemainingSpaceChange: (space: string) => void
  onToggleConnectionCodeVisible: () => void
  onToggleConnectionQr: () => void
  qrVisible: boolean
  receiveDirectoryPath: string
  receiveDiskRemainingSpace: string
}) {
  const [remoteAccessEnabled, setRemoteAccessEnabled] = useState(true)
  const { directoryInputRef, handleChooseDirectory, handleDirectoryInputChange } = useReceiveDirectoryPicker({
    onAction,
    onReceiveDirectoryPathChange,
    onReceiveDiskRemainingSpaceChange,
  })

  return (
    <PageFrame title="共享管理">
      <div className="mx-auto max-w-[980px] space-y-5">
        <section className="rounded-lg border border-white/70 bg-white/46 p-5 shadow-[0_18px_54px_rgba(70,96,138,0.1)] backdrop-blur-xl">
          <div className="mb-4 flex min-w-0 items-center gap-3">
            <ToneIcon icon={HardDrive} tone="blue" />
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-[#17191c]">连接码</h2>
            </div>
          </div>
          <ConnectionCodeCard
            code={code}
            codeVisible={codeVisible}
            localDeviceName={localDevice.name}
            qrVisible={qrVisible}
            onOpenSettings={onOpenConnectionCodeSettings}
            onToggleCodeVisible={onToggleConnectionCodeVisible}
            onToggleQr={onToggleConnectionQr}
          />
          <p className="mt-3 flex items-center gap-1.5 text-xs leading-5 text-[#7b8490]">
            <Smartphone className="h-3.5 w-3.5 shrink-0 text-[#9aa3af]" />
            <span>
              <button
                type="button"
                onClick={() => window.dispatchEvent(new Event("vividrop:open-download"))}
                className="font-semibold text-[#1677d2] underline-offset-2 transition hover:text-[#0d68bd] hover:underline"
              >
                下载 App
              </button>
              ，在同一 Wi-Fi 下扫描，选择该设备，扫码或输入连接码连接设备
            </span>
          </p>
        </section>

        <section className="rounded-lg border border-white/70 bg-white/46 p-5 shadow-[0_18px_54px_rgba(70,96,138,0.1)] backdrop-blur-xl">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <ToneIcon icon={FolderOpen} tone="green" />
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-[#17191c]">远程访问</h2>
                <p className="mt-1 text-xs text-[#7b8490]">开启后手机可远程访问此电脑的文件</p>
              </div>
            </div>
            <Switch
              checked={remoteAccessEnabled}
              onCheckedChange={(value) => {
                setRemoteAccessEnabled(value)
                onAction(value ? "已开启远程访问" : "已关闭远程访问")
              }}
              aria-label="远程访问开关"
            />
          </div>
        </section>

        <section className="rounded-lg border border-white/70 bg-white/46 p-5 shadow-[0_18px_54px_rgba(70,96,138,0.1)] backdrop-blur-xl">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <ToneIcon icon={FolderOpen} tone="cyan" />
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-[#17191c]">接收目录</h2>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#7b8490]">
                  <span className="truncate">{receiveDirectoryPath || "默认自动创建"}</span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[#e6f7f1] px-2 py-0.5 font-semibold text-[#1e7d5f]">
                    <HardDrive className="h-3.5 w-3.5 shrink-0" />
                    剩余 {receiveDiskRemainingSpace}
                  </span>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleChooseDirectory}
              className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-[#1677d2] px-3 text-xs font-semibold text-white shadow-[0_12px_22px_rgba(22,119,210,0.18)] transition hover:bg-[#0d68bd]"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              修改目录
            </button>
          </div>
          <input
            ref={directoryInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleDirectoryInputChange}
            {...{ webkitdirectory: "", directory: "" }}
          />
        </section>
      </div>
    </PageFrame>
  )
}


function SettingsPage({
  accountEmail,
  localDevice,
  onAction,
  preventSleep,
  uiLanguage,
  onPreventSleepChange,
  onUiLanguageChange,
}: {
  accountEmail: string
  localDevice: typeof initialLocalDevice
  onAction: (message: string) => void
  preventSleep: boolean
  uiLanguage: LanguageOption
  onPreventSleepChange: (value: boolean) => void
  onUiLanguageChange: (value: LanguageOption) => void
}) {
  const [accountOpen, setAccountOpen] = useState(false)
  const [installedVersion, setInstalledVersion] = useState(appVersion)
  const [updateState, setUpdateState] = useState<UpdateState>("idle")
  const [languageOpen, setLanguageOpen] = useState(false)
  const [languageSearch, setLanguageSearch] = useState("")

  const languageKeyword = languageSearch.trim().toLowerCase()
  const filteredLanguages = languageKeyword
    ? languageOptions.filter((option) =>
        `${option.label} ${option.caption} ${option.id}`.toLowerCase().includes(languageKeyword),
      )
    : languageOptions
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackText, setFeedbackText] = useState("")
  const [feedbackContact, setFeedbackContact] = useState(accountEmail)
  const [feedbackSent, setFeedbackSent] = useState(false)
  const [diagState, setDiagState] = useState<"idle" | "uploading" | "uploaded">("idle")

  const handleUploadDiagnostics = () => {
    if (diagState === "uploading") return
    setDiagState("uploading")
    onAction("正在上传诊断包")
    setTimeout(() => {
      setDiagState("uploaded")
      onAction("诊断包已上传")
    }, 2000)
  }
  const activeLanguage = languageOptions.find((option) => option.id === uiLanguage) ?? languageOptions[0]
  const feedbackReady = feedbackText.trim().length > 0
  const versionActionLabel =
    updateState === "checking"
      ? "检查中"
      : updateState === "available"
        ? "更新"
        : updateState === "updating"
          ? "更新中"
          : updateState === "updated"
            ? "已更新"
            : "检查更新"
  const updateStatus =
    updateState === "checking"
      ? "正在检查更新"
      : updateState === "available"
        ? `发现新版本 v${latestVersion}`
        : updateState === "updating"
          ? `正在更新至 v${latestVersion}`
          : updateState === "updated"
            ? `已是最新版本 v${installedVersion}`
            : "当前版本已安装"
  const handleVersionAction = () => {
    if (updateState === "available") {
      handleInstallUpdate()
      return
    }

    handleCheckForUpdates()
  }

  const handleCheckForUpdates = () => {
    setUpdateState("checking")
    onAction("正在检查更新")
    window.setTimeout(() => {
      setUpdateState(installedVersion === latestVersion ? "updated" : "available")
      onAction(installedVersion === latestVersion ? "当前已是最新版本" : `发现新版本 v${latestVersion}`)
    }, 800)
  }

  const handleInstallUpdate = () => {
    if (updateState !== "available") return

    setUpdateState("updating")
    onAction(`正在更新到 v${latestVersion}`)
    window.setTimeout(() => {
      setInstalledVersion(latestVersion)
      setUpdateState("updated")
      onAction(`已更新到 v${latestVersion}`)
    }, 1000)
  }

  const handleSendFeedback = () => {
    if (!feedbackReady) return

    const subject = encodeURIComponent(`ViviDrop 问题反馈 - v${installedVersion}`)
    const body = encodeURIComponent(
      `问题描述：\n${feedbackText.trim()}\n\n联系方式：${feedbackContact.trim() || "未填写"}\n当前版本：v${installedVersion}`,
    )
    window.open(`mailto:${developerFeedbackEmail}?subject=${subject}&body=${body}`, "_blank", "noopener,noreferrer")
    setFeedbackSent(true)
    setFeedbackText("")
    setFeedbackOpen(false)
    onAction("已打开邮件反馈入口")
  }

  return (
    <PageFrame title="我的">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.96fr)_minmax(0,1.04fr)]">
        <div className="space-y-5">
          <SettingsCard title="我的账户">
            <SettingsItem
              asButton
              icon={UserCircle}
              tone="rose"
              title="账户"
              caption={accountEmail}
              onClick={() => setAccountOpen((open) => !open)}
              action={<ChevronRight className={`h-4 w-4 text-[#9aa3af] transition ${accountOpen ? "rotate-90" : ""}`} />}
            />
            {accountOpen && (
              <div className="mx-4 mb-4 rounded-lg border border-white/70 bg-white/50 p-4">
                <p className="text-xs font-semibold text-[#858b96]">账户绑定信息</p>
                <ul className="mt-2 flex flex-col gap-2.5">
                  <li className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-[13px] text-[#17191c]">
                      <Mail className="h-3.5 w-3.5 shrink-0 text-[#9aa2ad]" />
                      邮箱
                    </span>
                    <span className="truncate text-[13px] text-[#59616d]">{accountEmail}</span>
                  </li>
                  <li className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-[13px] text-[#17191c]">
                      <Globe className="h-3.5 w-3.5 shrink-0 text-[#9aa2ad]" />
                      登录方式
                    </span>
                    <span className="text-[13px] text-[#59616d]">Google 账号</span>
                  </li>
	                  <li className="flex items-center justify-between gap-3">
	                    <span className="flex items-center gap-2 text-[13px] text-[#17191c]">
	                      <Smartphone className="h-3.5 w-3.5 shrink-0 text-[#9aa2ad]" />
	                      已绑定设备
	                    </span>
	                    <span className="text-[13px] text-[#59616d]">4 台</span>
	                  </li>
                </ul>
              </div>
            )}
            <SettingsItem
              icon={Crown}
              tone="amber"
              title="会员状态"
              caption="商务版"
              action={<span className="rounded-md bg-[#eaf6ff] px-2.5 py-1 text-xs font-semibold text-[#1677d2]">Pro</span>}
            />
          </SettingsCard>

          <SettingsCard title="本机">
            <SettingsItem
              icon={Wifi}
              tone="blue"
              title="本机 IP"
              caption={localDevice.ip}
            />
          </SettingsCard>

        </div>

        <div className="space-y-5">
          <SettingsCard title="通用">
            <SettingsItem
              asButton
              icon={Languages}
              tone="blue"
              title="界面语言"
              caption={activeLanguage.caption}
              onClick={() => setLanguageOpen((open) => !open)}
              action={
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-[#59616d]">
                  {activeLanguage.label}
                  <ChevronDown className={`h-4 w-4 transition ${languageOpen ? "rotate-180" : ""}`} />
                </span>
              }
            />
            {languageOpen && (
              <div className="mx-4 mb-4 rounded-lg border border-white/70 bg-white/48 p-1.5">
                <input
                  type="search"
                  value={languageSearch}
                  onChange={(event) => setLanguageSearch(event.currentTarget.value)}
                  placeholder="搜索语言"
                  aria-label="搜索语言"
                  className="mb-1.5 h-9 w-full rounded-md border border-white/70 bg-white/62 px-3 text-sm text-[#17191c] outline-none transition placeholder:text-[#a4acb7] focus:border-[#66c6ff] focus:ring-2 focus:ring-[#66c6ff]/18"
                />
                <div className="max-h-[264px] overflow-y-auto">
                  <div className="grid grid-cols-2 gap-1.5">
                    {filteredLanguages.map((option) => (
                      <button
                        key={option.id}
                        onClick={() => {
                          onUiLanguageChange(option.id)
                          setLanguageOpen(false)
                          setLanguageSearch("")
                          onAction(`界面语言已切换为 ${option.label}`)
                        }}
                        className={`flex min-h-9 flex-col items-start justify-center rounded-md px-2.5 py-1.5 text-left transition ${
                          uiLanguage === option.id
                            ? "bg-[#eaf6ff] ring-1 ring-[#bde5ff]"
                            : "hover:bg-white/74"
                        }`}
                      >
                        <span className={`text-sm font-semibold ${uiLanguage === option.id ? "text-[#1677d2]" : "text-[#3a424d]"}`}>
                          {option.label}
                        </span>
                        <span className="text-[11px] text-[#8d96a3]">{option.caption}</span>
                      </button>
                    ))}
                  </div>
                  {filteredLanguages.length === 0 && (
                    <p className="px-2.5 py-3 text-center text-xs text-[#8d96a3]">没有匹配的语言</p>
                  )}
                </div>
              </div>
            )}
            <SettingsItem
              icon={Power}
              tone="green"
              title="防止待机"
              caption="传输任务运行时保持电脑唤醒"
              action={
                <Switch
                  checked={preventSleep}
                  onCheckedChange={(value) => {
                    onPreventSleepChange(value)
                    onAction(value ? "已开启防止待机" : "已关闭防止待机")
                  }}
                />
              }
            />
          </SettingsCard>

          <SettingsCard title="版本">
            <SettingsItem
              icon={BadgeCheck}
              tone={updateState === "available" ? "amber" : "green"}
              title="ViviDrop Desktop"
              caption={`v${installedVersion} · ${updateStatus}`}
              action={
                <button
                  onClick={handleVersionAction}
                  disabled={updateState === "checking" || updateState === "updating" || updateState === "updated"}
                  className={`inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold transition disabled:cursor-not-allowed ${
                    updateState === "available"
                      ? "bg-[#17191c] text-white shadow-[0_12px_22px_rgba(23,25,28,0.16)] hover:bg-[#2b2f36]"
                      : "bg-white/60 text-[#59616d] hover:bg-white/82 disabled:text-[#aab2bd]"
                  }`}
                >
                  {updateState === "available" ? (
                    <Download className="h-3.5 w-3.5" />
                  ) : (
                    <RefreshCw className={`h-3.5 w-3.5 ${updateState === "checking" ? "animate-spin" : ""}`} />
                  )}
                  {versionActionLabel}
                </button>
              }
            />
          </SettingsCard>

          <SettingsCard title="支持">
            <SettingsItem
              asButton
              icon={Mail}
              tone="rose"
              title="问题反馈"
              caption={feedbackSent ? "已打开邮件发送入口" : developerFeedbackEmail}
              onClick={() => setFeedbackOpen((open) => !open)}
              action={<ChevronRight className={`h-4 w-4 text-[#9aa3af] transition ${feedbackOpen ? "rotate-90" : ""}`} />}
            />
            {feedbackOpen && (
              <div className="mx-4 mb-4 space-y-3 rounded-lg border border-white/70 bg-white/50 p-3">
                <textarea
                  value={feedbackText}
                  onChange={(event) => {
                    setFeedbackText(event.currentTarget.value)
                    setFeedbackSent(false)
                  }}
                  placeholder="请描述问题、发生步骤或希望改进的地方"
                  rows={4}
                  className="min-h-[112px] w-full resize-none rounded-lg border border-white/80 bg-white/70 px-3 py-2.5 text-sm leading-6 text-[#17191c] outline-none transition placeholder:text-[#a4acb7] focus:border-[#66c6ff] focus:ring-2 focus:ring-[#66c6ff]/18"
                />
                <div className="flex items-center gap-2 rounded-lg border border-white/80 bg-white/70 px-3 py-2.5">
                  <Mail className="h-4 w-4 shrink-0 text-[#7b8490]" />
                  <input
                    value={feedbackContact}
                    onChange={(event) => setFeedbackContact(event.currentTarget.value)}
                    placeholder="联系方式（选填）"
                    className="min-w-0 flex-1 bg-transparent text-sm text-[#17191c] outline-none placeholder:text-[#a4acb7]"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setFeedbackOpen(false)}
                    className="rounded-md border border-white/80 bg-white/58 px-3 py-2 text-sm font-semibold text-[#59616d] transition hover:bg-white/82"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSendFeedback}
                    disabled={!feedbackReady}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-[#17191c] px-3 py-2 text-sm font-semibold text-white shadow-[0_12px_22px_rgba(23,25,28,0.16)] transition hover:bg-[#2b2f36] disabled:cursor-not-allowed disabled:bg-[#cfd6df] disabled:text-white/80"
                  >
                    <Send className="h-4 w-4" />
                    发送
                  </button>
                </div>
              </div>
            )}
            <SettingsItem
              icon={FileUp}
              tone="cyan"
              title="上传诊断包"
              caption={
                diagState === "uploading"
                  ? "正在收集并上传日志"
                  : diagState === "uploaded"
                    ? "诊断包已上传，感谢配合排查"
                    : "上传运行日志，帮助排查问题"
              }
              action={
                <button
                  type="button"
                  onClick={handleUploadDiagnostics}
                  disabled={diagState === "uploading"}
                  className={`inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold transition disabled:cursor-not-allowed ${
                    diagState === "uploaded"
                      ? "bg-white/60 text-[#2d8f54]"
                      : "bg-white/60 text-[#59616d] hover:bg-white/82 disabled:text-[#aab2bd]"
                  }`}
                >
                  {diagState === "uploading" ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : diagState === "uploaded" ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <FileUp className="h-3.5 w-3.5" />
                  )}
                  {diagState === "uploading" ? "上传中" : diagState === "uploaded" ? "已上��" : "上传"}
                </button>
              }
            />
          </SettingsCard>
        </div>
      </div>
    </PageFrame>
  )
}

function SettingsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-semibold text-[#6e7784]">{title}</h2>
      <div className="overflow-hidden rounded-lg border border-white/70 bg-white/56 shadow-[0_18px_54px_rgba(70,96,138,0.1)] backdrop-blur-xl">
        {children}
      </div>
    </section>
  )
}

function SettingsItem({
  action,
  asButton = false,
  caption,
  icon,
  onClick,
  title,
  tone,
}: {
  action?: ReactNode
  asButton?: boolean
  caption: string
  icon: LucideIcon
  onClick?: () => void
  title: string
  tone: Tone
}) {
  const Icon = icon
  const content = (
    <>
      <ToneIcon icon={Icon} tone={tone} />
      <div className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-semibold text-[#17191c]">{title}</p>
        <p className="mt-1 truncate text-xs leading-5 text-[#7b8490]">{caption}</p>
      </div>
      {action && <div className="flex shrink-0 items-center">{action}</div>}
    </>
  )
  const className =
    "flex min-h-[72px] w-full items-center gap-3 border-b border-white/62 px-4 py-3 last:border-b-0 transition"

  if (asButton) {
    return (
      <button type="button" onClick={onClick} className={`${className} hover:bg-white/54`}>
        {content}
      </button>
    )
  }

  return <div className={className}>{content}</div>
}

function SettingsIconButton({ children, label, onClick }: { children: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-md border border-white/80 bg-white/58 text-[#7b8490] transition hover:bg-[#eaf6ff] hover:text-[#1677d2]"
    >
      {children}
    </button>
  )
}

function SearchField({
  search,
  placeholder = "搜索",
  onSearchChange,
}: {
  search: string
  placeholder?: string
  onSearchChange: (value: string) => void
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7b8490]" />
      <input
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/70 bg-white/54 py-3 pl-10 pr-3 text-sm outline-none shadow-[0_10px_30px_rgba(90,120,170,0.08)] transition placeholder:text-[#9aa3af] focus:border-[#66c6ff] focus:bg-white/70 focus:ring-2 focus:ring-[#66c6ff]/18"
      />
    </div>
  )
}

function Toolbar({
  search,
  viewMode,
  onSearchChange,
  onViewModeChange,
}: {
  search: string
  viewMode: ViewMode
  onSearchChange: (value: string) => void
  onViewModeChange: (mode: ViewMode) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <SearchField search={search} onSearchChange={onSearchChange} />
      <div className="flex rounded-lg border border-white/70 bg-white/46 p-1 shadow-[0_10px_30px_rgba(90,120,170,0.08)]">
        <button
          onClick={() => onViewModeChange("list")}
          className={`rounded-md p-2 transition ${viewMode === "list" ? "bg-[#eeeaff]/72 text-[#746aa8] ring-1 ring-[#d8d2ff]/60 shadow-[0_8px_18px_rgba(126,116,190,0.11)]" : "text-[#7b8490] hover:bg-white/60 hover:text-[#17191c]"}`}
          aria-label="列表视图"
        >
          <List className="h-4 w-4" />
        </button>
        <button
          onClick={() => onViewModeChange("grid")}
          className={`rounded-md p-2 transition ${viewMode === "grid" ? "bg-[#eeeaff]/72 text-[#746aa8] ring-1 ring-[#d8d2ff]/60 shadow-[0_8px_18px_rgba(126,116,190,0.11)]" : "text-[#7b8490] hover:bg-white/60 hover:text-[#17191c]"}`}
          aria-label="网格视图"
        >
          <Grid3X3 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function SelectionBar({
  count,
  extraActions = [],
  onDownload,
  onMove,
  onRename,
  onSelectAll,
  renameEnabled,
  total,
}: {
  count: number
  extraActions?: Array<{ disabled?: boolean; icon: LucideIcon; label: string; onClick: () => void }>
  onDownload: () => void
  onMove: () => void
  onRename: () => void
  onSelectAll: () => void
  renameEnabled: boolean
  total: number
}) {
  return (
    <div className="mt-4 flex items-center justify-between rounded-lg border border-white/70 bg-white/58 px-4 py-3 text-[#17191c] shadow-[0_18px_42px_rgba(70,96,138,0.1)] backdrop-blur-xl">
      <p className="text-sm font-semibold text-[#17191c]">已选择 {count}/{total} 项</p>
      <div className="flex items-center gap-2">
        <SelectionAction ariaLabel="批量全选" icon={CheckSquare} label="全选" onClick={onSelectAll} />
        <SelectionAction ariaLabel="批量下载" icon={Download} label="下载" onClick={onDownload} />
        <SelectionAction ariaLabel="批量移动" icon={MoveRight} label="移动" onClick={onMove} />
        <SelectionAction ariaLabel="批量重命名" disabled={!renameEnabled} icon={Pencil} label="重命名" onClick={onRename} />
        {extraActions.map((action) => (
          <SelectionAction
            key={action.label}
            disabled={action.disabled}
            icon={action.icon}
            label={action.label}
            onClick={action.onClick}
          />
        ))}
      </div>
    </div>
  )
}

function SelectionAction({
  ariaLabel,
  disabled = false,
  icon: Icon,
  label,
  onClick,
}: {
  ariaLabel?: string
  disabled?: boolean
  icon: LucideIcon
  label: string
  onClick: () => void
}) {
  return (
    <button
      aria-label={ariaLabel ?? label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
        disabled ? "cursor-not-allowed bg-white/32 text-[#b4bbc4]" : "bg-white/46 text-[#59616d] hover:bg-white/76 hover:text-[#17191c]"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}

function FileListItem({
  active,
  checked,
  file,
  onClick,
  onOpen,
  onToggle,
}: {
  active: boolean
  checked: boolean
  file: InboxFile
  onClick: () => void
  onOpen: () => void
  onToggle: () => void
}) {
  return (
    <button
      onClick={onClick}
      onDoubleClick={onOpen}
      className={`flex w-full items-center gap-3 px-3 py-3 text-left text-sm transition ${
        active ? "bg-[#eaf6ff]/80" : "hover:bg-white/42"
      }`}
    >
      <input
        checked={checked}
        onChange={(event) => {
          event.stopPropagation()
          onToggle()
        }}
        onClick={(event) => event.stopPropagation()}
        type="checkbox"
        className="h-4 w-4 rounded border-white/80"
        aria-label={`选择${file.name}`}
      />
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <FileKindIcon kind={file.kind} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-[#17191c]">{file.name}</p>
          <p className="mt-1 truncate text-xs text-[#7b8490]">
            {file.sourceDevice} · {file.sourceAccount} · {file.time}
          </p>
          {file.status === "传输中" && typeof file.progress === "number" && (
            <Progress value={file.progress} className="mt-2 h-1.5 bg-white/65" />
          )}
        </div>
      </div>
      <div className="ml-auto shrink-0 text-right">
        <p className="text-xs font-semibold text-[#17191c]">{file.size}</p>
        <p className="mt-1 text-[11px] text-[#7b8490]">
          {file.status === "传输中" && typeof file.progress === "number" ? `${file.progress}%` : file.status}
        </p>
      </div>
    </button>
  )
}

function FileGridItem({
  active,
  checked,
  file,
  onClick,
  onOpen,
  onToggle,
}: {
  active: boolean
  checked: boolean
  file: InboxFile
  onClick: () => void
  onOpen: () => void
  onToggle: () => void
}) {
  return (
    <button
      onClick={onClick}
      onDoubleClick={onOpen}
      className={`rounded-lg border border-white/60 bg-white/34 p-4 text-left shadow-[0_12px_36px_rgba(70,96,138,0.08)] transition hover:-translate-y-0.5 hover:bg-white/58 ${
        active ? "bg-[#eaf6ff]/80 ring-1 ring-[#66c6ff]/35" : ""
      }`}
    >
      <div className="mb-5 flex items-start justify-between">
        <FileKindIcon kind={file.kind} large />
        <input
          checked={checked}
          onChange={(event) => {
            event.stopPropagation()
            onToggle()
          }}
          onClick={(event) => event.stopPropagation()}
          type="checkbox"
          className="h-4 w-4 rounded border-white/80"
          aria-label={`选择${file.name}`}
        />
      </div>
      <p className="truncate text-sm font-semibold text-[#17191c]">{file.name}</p>
      <p className="mt-1 text-xs text-[#626a76]">{file.size}</p>
      {file.status === "传输中" && typeof file.progress === "number" && (
        <Progress value={file.progress} className="mt-3 h-1.5 bg-white/65" />
      )}
      <p className="mt-3 truncate text-xs text-[#7b8490]">{file.sourceDevice}</p>
    </button>
  )
}

function DeviceAccordionRow({
  device,
  onAction,
}: {
  device: Device
  onAction: (device: Device, actionLabel: string) => void
}) {
  const currentProgress = device.currentFile?.progress ?? 0
  const isBlocked = isDeviceBlocked(device)
  const isConnected = device.status !== "disconnected" && !isBlocked
  const isInactive = !isConnected
  const actions = getDeviceActions(device, isBlocked)
  const accountName = getDeviceAccountName(device)
  const deviceModel = getDeviceModel(device)

  return (
    <div className={`overflow-hidden rounded-lg border shadow-[0_14px_44px_rgba(70,96,138,0.08)] transition hover:-translate-y-0.5 ${
      isInactive ? "border-white/45 bg-white/20 opacity-70 hover:bg-white/30" : "border-white/60 bg-white/34 hover:bg-white/58"
    }`}>
      <div className="grid w-full grid-cols-[minmax(220px,1.35fr)_104px_minmax(220px,1fr)_minmax(220px,auto)] items-center gap-4 px-4 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] ${
            isConnected ? "bg-[#eaf6ff] text-[#1677d2]" : "bg-white/58 text-[#8d96a3]"
          }`}>
            <Smartphone className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <p className={`truncate text-sm font-semibold ${isConnected ? "text-[#17191c]" : "text-[#7b8490]"}`}>{accountName}</p>
              {isBlocked && (
                <span className="shrink-0 rounded-md bg-[#fff0eb] px-2 py-0.5 text-[11px] font-semibold text-[#b42318]">
                  已禁用
                </span>
              )}
            </div>
            <p className={`mt-0.5 text-xs ${isConnected ? "text-[#626a76]" : "text-[#9aa2ad]"}`}>{deviceModel}</p>
          </div>
        </div>
        <DeviceConnectionDot blocked={isBlocked} connected={isConnected} transferring={device.status === "transferring"} />
        <span className="min-w-0">
          {isBlocked && (device.authFailures ?? 0) >= 5 && (
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-[#b42318]">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">输错连接码超过 5 次，已自动禁用</span>
            </span>
          )}
          <span className={`mb-1 flex items-center text-[11px] ${isConnected ? "text-[#626a76]" : "text-[#9aa2ad]"}`}>
            <span className="truncate">{getCurrentTransferLabel(device)}</span>
          </span>
          {device.status === "transferring" && !isBlocked && (
            <Progress value={currentProgress} className="h-1.5 bg-white/65" />
          )}
        </span>
        <div className="flex min-w-0 items-center justify-end gap-2">
          {actions.map((action) => (
            <DeviceAction
              key={action.label}
              ariaLabel={`${accountName} ${action.label}`}
              icon={action.icon}
              label={action.label}
              tone={action.tone}
              onClick={() => onAction(device, action.label)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function getCurrentTransferLabel(device: Device) {
  if (isDeviceBlocked(device)) return ""
  if (device.currentFile) return device.currentFile.name
  return ""
}

function getDeviceActions(device: Device, isBlocked: boolean): Array<{ icon: LucideIcon; label: string; tone?: "normal" | "danger" | "primary" }> {
  if (isBlocked) {
    return [{ icon: Check, label: "取消禁用", tone: "primary" }]
  }

  return [{ icon: Wifi, label: "禁用", tone: "danger" }]
}

function getDeviceAccountName(device: Device) {
  return device.accountName ?? device.name
}

function getDeviceModel(device: Device) {
  return device.model ?? device.name
}

function isDeviceBlocked(device: Device) {
  return Boolean(device.blocked || (device.authFailures ?? 0) >= 5)
}

function DeviceConnectionDot({
  blocked,
  connected,
  transferring,
}: {
  blocked: boolean
  connected: boolean
  transferring?: boolean
}) {
  if (!blocked && transferring) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2d8f54]">
        <TransferArrows />
        正在传输
      </span>
    )
  }

  const config = blocked
    ? { label: "已禁用", text: "text-[#b42318]", dot: "bg-[#d92d20] shadow-[0_0_0_4px_rgba(217,45,32,0.12)]" }
    : connected
      ? { label: "已连接", text: "text-[#2d8f54]", dot: "bg-[#2d8f54] shadow-[0_0_0_4px_rgba(45,143,84,0.12)]" }
      : { label: "未连接", text: "text-[#8d96a3]", dot: "bg-[#b5bdc8]" }

  return (
    <span className={`inline-flex items-center gap-2 text-xs font-semibold ${config.text}`}>
      <span className={`h-2.5 w-2.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  )
}

function TransferArrows() {
  return (
    <span className="relative inline-flex h-4 w-3.5 shrink-0 items-center justify-center text-[#2d8f54]" aria-hidden="true">
      <ChevronDown className="absolute h-3.5 w-3.5 animate-transfer-arrow" />
      <ChevronDown className="absolute h-3.5 w-3.5 animate-transfer-arrow [animation-delay:300ms]" />
      <ChevronDown className="absolute h-3.5 w-3.5 animate-transfer-arrow [animation-delay:600ms]" />
    </span>
  )
}

function DeviceAction({
  ariaLabel,
  icon: Icon,
  label,
  onClick,
  tone = "normal",
}: {
  ariaLabel: string
  icon: LucideIcon
  label: string
  onClick: () => void
  tone?: "normal" | "danger" | "primary"
}) {
  const toneClass =
    tone === "danger"
      ? "bg-[#fff0eb] text-[#b42318] hover:bg-[#ffe2da]"
      : tone === "primary"
        ? "bg-[#eaf6ff] text-[#1677d2] hover:bg-[#dcefff]"
        : "bg-white/46 text-[#626a76] hover:bg-[#eaf6ff] hover:text-[#1677d2]"

  return (
    <button
      aria-label={ariaLabel}
      onClick={onClick}
      className={`inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${toneClass}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}

function SectionTitle({ icon: Icon, title, caption, dark = false }: { icon: LucideIcon; title: string; caption: string; dark?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] ${dark ? "bg-white/10 text-white" : "bg-[#eaf6ff] text-[#1677d2]"}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${dark ? "text-white" : "text-[#17191c]"}`}>{title}</p>
        <p className={`mt-0.5 truncate text-xs ${dark ? "text-white/60" : "text-[#7b8490]"}`}>{caption}</p>
      </div>
    </div>
  )
}

function CloudDeviceButton({
  accountName,
  breakdown,
  count,
  icon,
  label,
  model,
  path,
  totalSize,
  tone,
  onOpenPath,
}: {
  accountName: string
  breakdown: { albums: number; folders: number }
  count: number
  icon: LucideIcon
  label: string
  model: string
  path: string
  totalSize: string
  tone: Tone
  onOpenPath: (path: string) => void
}) {
  const Icon = icon

  return (
    <div
      className="w-full rounded-lg border border-white/60 bg-white/34 px-4 py-4 text-left shadow-[0_14px_44px_rgba(70,96,138,0.08)] transition hover:-translate-y-0.5 hover:bg-white/58"
    >
      <div className="grid grid-cols-[40px_minmax(0,1fr)_auto_76px] items-center gap-4">
        <ToneIcon icon={Icon} tone={tone} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[#17191c]">{accountName}</p>
          <p className="mt-0.5 truncate text-xs text-[#626a76]">{model}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs font-semibold text-[#4f5b68] [font-variant-numeric:tabular-nums]">
          <span className="inline-flex w-[150px] items-center gap-1.5 whitespace-nowrap">
            <ImageIcon className="h-3.5 w-3.5 shrink-0 text-[#7b8794]" />
            {"相册上传 "}
            {breakdown.albums}
            <Folder className="h-3.5 w-3.5 shrink-0 text-[#7b8794]" />
            {"文件上传 "}
            {breakdown.folders}
          </span>
          <span className="inline-flex w-[88px] items-center gap-1.5 whitespace-nowrap">
            <HardDrive className="h-3.5 w-3.5 shrink-0 text-[#7b8794]" />
            {compactFileSizeLabel(totalSize)}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onOpenPath(path)}
          className="flex h-12 w-[76px] items-center justify-center rounded-lg border border-[#cdeeff]/80 bg-[#edf8ff]/78 text-[#1677d2] shadow-[0_10px_24px_rgba(67,157,220,0.1)] transition hover:-translate-y-0.5 hover:bg-[#dff2ff] hover:text-[#0d68bd] hover:shadow-[0_16px_34px_rgba(67,157,220,0.15)]"
          aria-label={`打开${label}文件夹`}
          title="打开文件夹"
        >
          <FolderOpen className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}

function FolderButton({
  active,
  badge,
  caption,
  checked,
  count,
  icon,
  label,
  path,
  tone,
  onClick,
  onOpenPath,
  onToggle,
}: {
  active: boolean
  badge?: string
  caption: string
  checked: boolean
  count: number
  icon: LucideIcon
  label: string
  path: string
  tone: Tone
  onClick: () => void
  onOpenPath: (path: string) => void
  onToggle: () => void
}) {
  const Icon = icon
  const clickTimerRef = useRef<number | null>(null)
  const scheduleClick = () => {
    if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current)
    clickTimerRef.current = window.setTimeout(() => {
      onClick()
      clickTimerRef.current = null
    }, 180)
  }
  const openPathNow = () => {
    if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current)
    clickTimerRef.current = null
    onOpenPath(path)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`进入${label}文件夹`}
      onClick={scheduleClick}
      onDoubleClick={(event) => {
        event.preventDefault()
        openPathNow()
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onClick()
      }}
      className={`grid w-full grid-cols-[28px_40px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-white/60 bg-white/34 px-4 py-4 text-left shadow-[0_14px_44px_rgba(70,96,138,0.08)] transition hover:-translate-y-0.5 hover:bg-white/58 ${
        active ? "bg-[#eaf6ff]/80 ring-1 ring-[#66c6ff]/35" : ""
      }`}
    >
      <input
        checked={checked}
        onChange={(event) => {
          event.stopPropagation()
          onToggle()
        }}
        onClick={(event) => event.stopPropagation()}
        type="checkbox"
        className="h-4 w-4 rounded border-white/80"
        aria-label={`选择${label}`}
      />
      <ToneIcon icon={Icon} tone={tone} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[#17191c]">{label}</p>
        <p className="mt-0.5 truncate text-xs text-[#626a76]">{caption}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {badge && <span className="rounded-md bg-white/60 px-2 py-1 text-[11px] font-semibold text-[#1677d2]">{badge}</span>}
        <span className="text-xs font-semibold text-[#7b8490]">{count}</span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            openPathNow()
          }}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-white/70 bg-white/52 text-[#626a76] transition hover:bg-[#eaf6ff] hover:text-[#1677d2]"
          aria-label={`打开${label}文件夹`}
          title="打开文件夹"
        >
          <FolderOpen className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function ToneIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: Tone }) {
  const cls = {
    blue: "bg-[#eaf6ff] text-[#1677d2]",
    sky: "bg-[#e8fbff] text-[#0d8bbf]",
    green: "bg-[#e9f8ee] text-[#2d8f54]",
    amber: "bg-[#fff5dc] text-[#9a6700]",
    rose: "bg-[#fff0f4] text-[#af4560]",
    slate: "bg-white/54 text-[#626a76]",
  }[tone]
  return (
    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] ${cls}`}>
      <Icon className="h-5 w-5" />
    </div>
  )
}

function FileKindIcon({ kind, large = false }: { kind: InboxKind; large?: boolean }) {
  const group = inboxGroups.find((item) => item.id === kind) ?? inboxGroups[0]
  const Icon = group.icon
  return (
    <div className={`${large ? "h-12 w-12" : "h-9 w-9"} flex shrink-0 items-center justify-center rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] ${toneClass(group.tone)}`}>
      <Icon className={large ? "h-6 w-6" : "h-4 w-4"} />
    </div>
  )
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/60 pb-3">
      <span className="shrink-0 whitespace-nowrap text-[#7b8490]">{label}</span>
      <span className="truncate font-semibold text-[#17191c]">{value}</span>
    </div>
  )
}

function toneClass(tone: Tone) {
  return {
    blue: "bg-[#eaf6ff] text-[#1677d2]",
    sky: "bg-[#e8fbff] text-[#0d8bbf]",
    green: "bg-[#e9f8ee] text-[#2d8f54]",
    amber: "bg-[#fff5dc] text-[#9a6700]",
    rose: "bg-[#fff0f4] text-[#af4560]",
    slate: "bg-white/54 text-[#626a76]",
  }[tone]
}
