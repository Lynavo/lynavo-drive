"use client"

import { ChevronLeft, Monitor } from "lucide-react"

interface HistoryPageProps {
  onBack: () => void
}

interface DailyTransferSummary {
  id: string
  deviceName: string
  deviceIp: string
  fileCount: number
  totalSize: string
  duration: string
  isSyncing?: boolean
}

interface HistoryDayGroup {
  id: string
  label: string
  syncingLabel?: string
  transfers: DailyTransferSummary[]
}

const HISTORY_GROUPS: HistoryDayGroup[] = [
  {
    id: "today",
    label: "今天",
    syncingLabel: "实时同步中",
    transfers: [
      {
        id: "t1",
        deviceName: "openimdeMac-mini",
        deviceIp: "192.168.0.5",
        fileCount: 2,
        totalSize: "1.1 MB",
        duration: "1s",
        isSyncing: true,
      },
    ],
  },
  {
    id: "yesterday",
    label: "昨天",
    transfers: [
      {
        id: "y1",
        deviceName: "openimdeMac-mini",
        deviceIp: "192.168.0.5",
        fileCount: 1574,
        totalSize: "26.6 GB",
        duration: "34m 48s",
      },
    ],
  },
]

function TransferSummaryCard({ transfer }: { transfer: DailyTransferSummary }) {
  return (
    <article className="rounded-[18px] bg-white/92 px-3 py-2.5 shadow-[0_6px_18px_rgba(81,145,197,0.08)]">
      <div className="flex items-center gap-2.5 pb-2.5">
        <div className="flex h-[43px] w-[43px] items-center justify-center rounded-[14px] bg-[#42A7E2] shadow-[0_6px_16px_rgba(66,167,226,0.22)]">
          <Monitor className="h-5 w-5 text-white" strokeWidth={1.9} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-bold tracking-[-0.01em] text-[#173B67]">{transfer.deviceName}</p>
          <p className="mt-0.5 text-[9px] text-[#A8BDCF]">{transfer.deviceIp}</p>
        </div>
      </div>

      <div className="h-px bg-[#EEF5FB]" />

      <div className="flex items-end justify-between pt-2.5">
        <div className="min-w-0">
          <p className="mb-1 text-[8px] font-medium text-[#B6C7D7]">同步的媒体文件</p>
          <div className="flex items-baseline gap-1">
            <span className="text-[18px] font-bold leading-none text-[#42A7E2]">{transfer.fileCount}</span>
            <span className="text-[10px] font-semibold text-[#D0DAE4]">个文件</span>
            <span className="text-[11px] text-[#D0DAE4]">·</span>
            <span className="truncate text-[15px] font-bold leading-none text-[#173B67]">{transfer.totalSize}</span>
          </div>
        </div>
        <div className="shrink-0 pl-2.5 text-right">
          <p className="mb-1 text-[8px] font-medium text-[#B6C7D7]">时长</p>
          <p className="text-[15px] font-bold leading-none text-[#42A7E2]">{transfer.duration}</p>
        </div>
      </div>
    </article>
  )
}

export function HistoryPage({ onBack }: HistoryPageProps) {
  return (
    <div className="min-h-screen bg-[#DFF0FE]">
      <div className="px-3 pb-5 pt-8">
        <div className="flex items-center gap-2.5 pb-5">
          <button
            onClick={onBack}
            className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-white/70 shadow-[0_5px_12px_rgba(120,172,210,0.12)]"
            aria-label="返回"
          >
            <ChevronLeft className="h-5 w-5 text-[#173B67]" strokeWidth={2.2} />
          </button>
          <h1 className="text-[18px] font-bold tracking-[-0.02em] text-[#173B67]">历史记录</h1>
        </div>

        <div className="space-y-5">
          {HISTORY_GROUPS.map((group) => {
            const isSyncing = group.transfers.some((transfer) => transfer.isSyncing)

            return (
              <section key={group.id}>
                <div className="mb-2.5 flex items-center gap-2">
                  <h2 className="text-[14px] font-bold tracking-[-0.02em] text-[#264A73]">{group.label}</h2>
                  {isSyncing && group.syncingLabel ? (
                    <>
                      <span className="h-2 w-2 rounded-full bg-[#3398D6] shadow-[0_0_0_2px_rgba(51,152,214,0.18)]" />
                      <span className="text-[10px] font-medium text-[#8FB2CF]">{group.syncingLabel}</span>
                    </>
                  ) : null}
                </div>

                <div className="space-y-2.5">
                  {group.transfers.map((transfer) => (
                    <TransferSummaryCard key={transfer.id} transfer={transfer} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
