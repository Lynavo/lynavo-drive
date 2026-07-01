import { isSupportedLocale, type SupportedLocale } from './locale';

const MAIN_STRINGS = {
  en: {
    diagnostics: {
      filenamePrefix: 'Lynavo Drive-diagnostics',
      title: 'Export diagnostics bundle',
      readme: [
        'Lynavo Drive diagnostics bundle',
        '',
        'Contents:',
        '- diagnostics.json: issue description, version, runtime state, dashboard, settings, sharing status, paths, and network environment (Wi-Fi SSID, network interfaces)',
        '- files/*.log: desktop process logs, renderer logs, and rotated log files when available',
        '- files/macos-power.log: recent macOS sleep/wake history from pmset, if available',
        '- files/sidecar.log(.N): sidecar process logs (including mDNS, connection, disconnection, and IP switch events)',
        '- files/sidecar.db: sidecar database snapshot, if present',
        '',
        'Suggested troubleshooting order:',
        '1. Check environment.wifi in diagnostics.json to confirm the Wi-Fi network at the time',
        '2. Then check sidecar.log for "local IP changed" / "tcp client disconnected" events',
        '3. For UI or state issues, check the desktop and renderer log files last',
        '',
        'Send the full ZIP file to the development team for investigation.',
        '',
      ],
    },
  },
  'zh-Hans': {
    diagnostics: {
      filenamePrefix: 'Lynavo Drive-诊断包',
      title: '导出诊断包',
      readme: [
        'Lynavo Drive 诊断包',
        '',
        '包含内容：',
        '- diagnostics.json：问题描述、版本、运行时状态、dashboard、设置、共享状态、路径与网络环境（WiFi SSID、网卡列表）',
        '- files/*.log：桌面端进程日志、renderer 日志与可用的轮转日志',
        '- files/macos-power.log：macOS 最近 sleep / wake 记录（如可用）',
        '- files/sidecar.log(.N)：sidecar 进程日志（含 mDNS、连线、断线、IP 切换事件）',
        '- files/sidecar.db：sidecar 数据库快照（如存在）',
        '',
        '排障顺序建议：',
        '1. 先看 diagnostics.json 的 environment.wifi 确认当时连的是哪个 WiFi',
        '2. 再看 sidecar.log 中 "local IP changed" / "tcp client disconnected" 事件',
        '3. 若涉及 UI / 状态问题，最后看桌面端和 renderer 日志',
        '',
        '请将整个 ZIP 提供给开发团队进行排查。',
        '',
      ],
    },
  },
  'zh-Hant': {
    diagnostics: {
      filenamePrefix: 'Lynavo Drive-診斷包',
      title: '匯出診斷包',
      readme: [
        'Lynavo Drive 診斷包',
        '',
        '包含內容：',
        '- diagnostics.json：問題描述、版本、執行狀態、dashboard、設定、共享狀態、路徑與網路環境（Wi-Fi SSID、網路介面列表）',
        '- files/*.log：桌面端行程日誌、renderer 日誌與可用的輪轉日誌',
        '- files/macos-power.log：macOS 最近 sleep / wake 記錄（如可用）',
        '- files/sidecar.log(.N)：sidecar 行程日誌（含 mDNS、連線、斷線、IP 切換事件）',
        '- files/sidecar.db：sidecar 資料庫快照（如存在）',
        '',
        '建議排查順序：',
        '1. 先看 diagnostics.json 的 environment.wifi，確認當時連線的 Wi-Fi',
        '2. 再看 sidecar.log 中的 "local IP changed" / "tcp client disconnected" 事件',
        '3. 若涉及 UI / 狀態問題，最後看桌面端和 renderer 日誌',
        '',
        '請將整個 ZIP 提供給開發團隊排查。',
        '',
      ],
    },
  },
} as const;

export function getMainStrings(
  locale: string | null | undefined,
): (typeof MAIN_STRINGS)[SupportedLocale] {
  return MAIN_STRINGS[isSupportedLocale(locale) ? locale : 'en'];
}
