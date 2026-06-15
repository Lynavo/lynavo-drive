export interface TransferFile {
  id: string
  name: string
  size: string
  sizeBytes: number
  status: "transferring" | "waiting" | "completed" | "cancelled"
  progress?: number
  completedAt?: string
  createdAt?: string
  duration?: string
}

export interface Device {
  id: string
  name: string
  ip: string
  status: "transferring" | "connected" | "disconnected"
  todayFiles: number
  todaySize: string
  storageLeft: string
  storagePath: string
  currentFile?: TransferFile
  queue: TransferFile[]
}

export interface HistoryRecord {
  id: string
  date: string
  fileCount: number
  totalSize: string
  duration: string
  files: TransferFile[]
}

export const mockTransferQueue: TransferFile[] = [
  { id: "f1", name: "DJI_0421_4K_RAW.mp4", size: "3.2 GB", sizeBytes: 3435973837, status: "transferring", progress: 67 },
  { id: "f2", name: "GoPro_Scene12_Take3.mp4", size: "1.8 GB", sizeBytes: 1932735283, status: "waiting" },
  { id: "f3", name: "Sony_A7S3_Interview.mp4", size: "4.5 GB", sizeBytes: 4831838208, status: "waiting" },
  { id: "f4", name: "BTS_Footage_001.mov", size: "2.1 GB", sizeBytes: 2254857830, status: "waiting" },
  { id: "f5", name: "Drone_Sunset_Clip.mp4", size: "890 MB", sizeBytes: 933232640, status: "waiting" },
]

export interface HistorySession {
  id: string
  deviceName: string
  deviceIp: string
  fileCount: number
  totalSize: string
  lastSyncTime: string
}

export interface HistoryDay {
  date: string
  sessions: HistorySession[]
}

export const mockHistoryDays: HistoryDay[] = [
  {
    date: "2026-03-19",
    sessions: [
      { id: "s1", deviceName: "\u526a\u8f91\u5de5\u4f5c\u7ad9-A", deviceIp: "192.168.1.101", fileCount: 15, totalSize: "16.3 GB", lastSyncTime: "22:51" },
      { id: "s2", deviceName: "MacBook Pro", deviceIp: "192.168.1.108", fileCount: 3, totalSize: "2.1 GB", lastSyncTime: "10:02" },
    ],
  },
  {
    date: "2026-03-20",
    sessions: [],
  },
  {
    date: "2026-03-18",
    sessions: [
      { id: "s3", deviceName: "\u526a\u8f91\u5de5\u4f5c\u7ad9-A", deviceIp: "192.168.1.101", fileCount: 45, totalSize: "86.5 GB", lastSyncTime: "22:17" },
    ],
  },
  {
    date: "2026-03-17",
    sessions: [
      { id: "s4", deviceName: "\u526a\u8f91\u5de5\u4f5c\u7ad9-A", deviceIp: "192.168.1.101", fileCount: 29, totalSize: "51.0 GB", lastSyncTime: "21:05" },
      { id: "s5", deviceName: "\u5907\u7528\u673a-B", deviceIp: "192.168.1.115", fileCount: 8, totalSize: "12.3 GB", lastSyncTime: "14:38" },
    ],
  },
  {
    date: "2026-03-16",
    sessions: [
      { id: "s6", deviceName: "MacBook Pro", deviceIp: "192.168.1.108", fileCount: 31, totalSize: "62.5 GB", lastSyncTime: "19:50" },
    ],
  },
]

export const mockHistory: HistoryRecord[] = [
  {
    id: "h1",
    date: "2026-03-19",
    fileCount: 15,
    totalSize: "16.3 GB",
    duration: "21:57",
    files: [
      { id: "hf1", name: "DJI_0021_PRO.mp4", size: "1.5 GB", sizeBytes: 1610612736, status: "completed", completedAt: "14:29", createdAt: "2026-03-19 08:14", duration: "3m 15s" },
      { id: "hf2", name: "DJI_0022_PRO.mp4", size: "1.8 GB", sizeBytes: 1932735283, status: "completed", completedAt: "14:28", createdAt: "2026-03-19 09:02", duration: "4m 30s" },
      { id: "hf3", name: "IMG_8493.HEIC", size: "2.1 MB", sizeBytes: 2202009, status: "completed", completedAt: "14:27", createdAt: "2026-03-19 11:33", duration: "5m 45s" },
      { id: "hf4", name: "DJI_0024_PRO.mp4", size: "2.4 GB", sizeBytes: 2576980377, status: "completed", completedAt: "14:26", createdAt: "2026-03-19 10:45", duration: "6m 00s" },
      { id: "hf5", name: "A001_C012_1024.braw", size: "4.2 GB", sizeBytes: 4509715660, status: "completed", completedAt: "14:20", createdAt: "2026-03-18 17:22", duration: "10m 12s" },
      { id: "hf6", name: "IMG_8492.HEIC", size: "12 MB", sizeBytes: 12582912, status: "completed", completedAt: "14:10", createdAt: "2026-03-19 13:58", duration: "0m 45s" },
      { id: "hf7", name: "DJI_0025_PRO.mp4", size: "1.2 GB", sizeBytes: 1288490188, status: "completed", completedAt: "13:58", createdAt: "2026-03-19 07:30", duration: "2m 55s" },
      { id: "hf8", name: "Sony_A7S3_BTS.mp4", size: "3.6 GB", sizeBytes: 3865470566, status: "completed", completedAt: "13:44", createdAt: "2026-03-18 22:10", duration: "8m 30s" },
      { id: "hf9", name: "GoPro_Scene01.mp4", size: "890 MB", sizeBytes: 933232640, status: "completed", completedAt: "09:32", createdAt: "2026-03-19 06:55", duration: "1m 50s" },
      { id: "hf10", name: "IMG_7801.HEIC", size: "8.4 MB", sizeBytes: 8808038, status: "completed", completedAt: "09:30", createdAt: "2026-03-19 09:28", duration: "0m 22s" },
    ],
  },
  {
    id: "h2",
    date: "2026-03-18",
    fileCount: 45,
    totalSize: "86.5 GB",
    duration: "1:45:00",
    files: [
      { id: "hf11", name: "Scene1_Master.mp4", size: "5.8 GB", sizeBytes: 6227020800, status: "completed", completedAt: "18:44", createdAt: "2026-03-18 07:10", duration: "14m 20s" },
      { id: "hf12", name: "Scene2_Master.mp4", size: "4.9 GB", sizeBytes: 5260242534, status: "completed", completedAt: "18:29", createdAt: "2026-03-18 08:30", duration: "12m 05s" },
      { id: "hf13", name: "Interview_Main_Cam.mp4", size: "6.2 GB", sizeBytes: 6657413734, status: "completed", completedAt: "18:16", createdAt: "2026-03-17 14:00", duration: "15m 30s" },
      { id: "hf14", name: "BRoll_CityWalk.mov", size: "3.1 GB", sizeBytes: 3328706150, status: "completed", completedAt: "18:00", createdAt: "2026-03-18 11:22", duration: "7m 45s" },
      { id: "hf15", name: "Drone_Aerial_4K.mp4", size: "2.7 GB", sizeBytes: 2898534604, status: "completed", completedAt: "17:52", createdAt: "2026-03-18 06:48", duration: "6m 10s" },
    ],
  },
  {
    id: "h3",
    date: "2026-03-17",
    fileCount: 29,
    totalSize: "51.0 GB",
    duration: "1:01:31",
    files: [
      { id: "hf16", name: "Timelapse_Sunset.mp4", size: "1.9 GB", sizeBytes: 2040109465, status: "completed", completedAt: "21:04", createdAt: "2026-03-17 17:30", duration: "4m 45s" },
      { id: "hf17", name: "Product_Shoot_01.mp4", size: "2.3 GB", sizeBytes: 2469606195, status: "completed", completedAt: "20:59", createdAt: "2026-03-17 09:15", duration: "5m 40s" },
      { id: "hf18", name: "IMG_8601.HEIC", size: "14 MB", sizeBytes: 14680064, status: "completed", completedAt: "13:39", createdAt: "2026-03-17 13:38", duration: "0m 30s" },
    ],
  },
]

export const mockDevices: Device[] = [
  {
    id: "d1",
    name: "iPhone 15 Pro",
    ip: "192.168.1.201",
    status: "transferring",
    todayFiles: 12,
    todaySize: "24.5 GB",
    storageLeft: "1.2 TB",
    storagePath: "D:\\SyncFlow\\iPhone_15_Pro",
    currentFile: mockTransferQueue[0],
    queue: mockTransferQueue,
  },
  {
    id: "d2",
    name: "Galaxy S24 Ultra",
    ip: "192.168.1.205",
    status: "connected",
    todayFiles: 8,
    todaySize: "16.3 GB",
    storageLeft: "860 GB",
    storagePath: "D:\\SyncFlow\\GalaxyS24",
    queue: [],
  },
  {
    id: "d3",
    name: "iPad Pro",
    ip: "192.168.1.210",
    status: "connected",
    todayFiles: 5,
    todaySize: "10.2 GB",
    storageLeft: "2.4 TB",
    storagePath: "D:\\SyncFlow\\iPadPro",
    queue: [],
  },
  {
    id: "d4",
    name: "GoPro Hero 12",
    ip: "192.168.1.188",
    status: "disconnected",
    todayFiles: 0,
    todaySize: "0 GB",
    storageLeft: "—",
    storagePath: "D:\\SyncFlow\\GoPro12",
    queue: [],
  },
  {
    id: "d5",
    name: "iPhone 14",
    ip: "192.168.1.198",
    status: "disconnected",
    todayFiles: 3,
    todaySize: "6.8 GB",
    storageLeft: "—",
    storagePath: "D:\\SyncFlow\\iPhone14",
    queue: [],
  },
]

export const connectionCode = "839 274"
