export type DeviceStatus = "connected" | "transferring" | "disconnected"

export interface DeviceQueueFile {
  id: string
  name: string
  size: string
  status: "transferring" | "waiting" | "done" | "failed"
  progress?: number
}

export interface Device {
  id: string
  name: string
  accountName?: string
  model?: string
  status: DeviceStatus
  blocked?: boolean
  authFailures?: number
  currentFile?: DeviceQueueFile
  queue: DeviceQueueFile[]
}

export const connectionCode = "238416"

export const mockDevices: Device[] = [
  {
    id: "iphone-15-pro",
    name: "iPhone 15 Pro",
    accountName: "chen@icloud.example",
    model: "iPhone 15 Pro",
    status: "transferring",
    blocked: false,
    authFailures: 0,
    currentFile: {
      id: "q1",
      name: "IMG_20260610_Office.mov",
      size: "3.2 GB",
      status: "transferring",
      progress: 64,
    },
    queue: [
      { id: "q1", name: "IMG_20260610_Office.mov", size: "3.2 GB", status: "transferring", progress: 64 },
      { id: "q2", name: "Voice_Memo_0611.m4a", size: "12 MB", status: "waiting" },
    ],
  },
  {
    id: "galaxy-s24-ultra",
    name: "Galaxy S24 Ultra",
    accountName: "ops@studio.example",
    model: "Galaxy S24 Ultra",
    status: "connected",
    blocked: false,
    authFailures: 0,
    queue: [],
  },
  {
    id: "ipad-pro",
    name: "iPad Pro",
    accountName: "chen@icloud.example",
    model: "iPad Pro",
    status: "disconnected",
    blocked: false,
    authFailures: 0,
    queue: [],
  },
  {
    id: "iphone-14",
    name: "iPhone 14",
    accountName: "archive@icloud.example",
    model: "iPhone 14",
    status: "disconnected",
    blocked: true,
    authFailures: 5,
    queue: [],
  },
]
