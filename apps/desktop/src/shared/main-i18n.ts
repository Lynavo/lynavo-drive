import { isSupportedLocale, type SupportedLocale } from './locale';

const MAIN_STRINGS = {
  en: {
    diagnostics: {
      filenamePrefix: 'Vivi Drop-diagnostics',
      title: 'Export diagnostics bundle',
      readme: [
        'Vivi Drop diagnostics bundle',
        '',
        'Contents:',
        '- diagnostics.json: version, runtime state, dashboard, settings, sharing status, and network environment (Wi-Fi SSID, network interfaces)',
        '- files/desktop-main.log: desktop main process log (including sidecar stdout/stderr)',
        '- files/sidecar.log(.N): sidecar process logs (including mDNS, connection, disconnection, and IP switch events)',
        '- files/sidecar.db: sidecar database snapshot, if present',
        '',
        'Suggested troubleshooting order:',
        '1. Check environment.wifi in diagnostics.json to confirm the Wi-Fi network at the time',
        '2. Then check sidecar.log for "local IP changed" / "tcp client disconnected" events',
        '3. For UI or state issues, check desktop-main.log last',
        '',
        'Send the full ZIP file to the development team for investigation.',
        '',
      ],
    },
    updates: {
      title: 'Vivi Drop update available',
      message: 'Version v{{version}} is available',
      minimumRequired: 'This version must be updated before continuing.',
      releaseNotes: 'Update content',
      openDownload: 'Open download page',
      later: 'Later',
      ok: 'OK',
    },
  },
  'zh-Hans': {
    diagnostics: {
      filenamePrefix: 'Vivi Drop-诊断包',
      title: '导出诊断包',
      readme: [
        'Vivi Drop 诊断包',
        '',
        '包含内容：',
        '- diagnostics.json：版本、运行时状态、dashboard、设置、共享状态、网络环境（WiFi SSID、网卡列表）',
        '- files/desktop-main.log：桌面端主进程日志（含 sidecar stdout/stderr）',
        '- files/sidecar.log(.N)：sidecar 进程日志（含 mDNS、连线、断线、IP 切换事件）',
        '- files/sidecar.db：sidecar 数据库快照（如存在）',
        '',
        '排障顺序建议：',
        '1. 先看 diagnostics.json 的 environment.wifi 确认当时连的是哪个 WiFi',
        '2. 再看 sidecar.log 中 "local IP changed" / "tcp client disconnected" 事件',
        '3. 若涉及 UI / 状态问题，最后看 desktop-main.log',
        '',
        '请将整个 ZIP 提供给开发团队进行排查。',
        '',
      ],
    },
    updates: {
      title: 'Vivi Drop 有可用更新',
      message: '有新版本 v{{version}} 可用',
      minimumRequired: '此版本需要更新后继续使用。',
      releaseNotes: '更新内容',
      openDownload: '打开下载页',
      later: '稍后',
      ok: '确定',
    },
  },
  'zh-Hant': {
    diagnostics: {
      filenamePrefix: 'Vivi Drop-診斷包',
      title: '匯出診斷包',
      readme: [
        'Vivi Drop 診斷包',
        '',
        '包含內容：',
        '- diagnostics.json：版本、執行狀態、dashboard、設定、共享狀態、網路環境（Wi-Fi SSID、網路介面列表）',
        '- files/desktop-main.log：桌面端主行程日誌（含 sidecar stdout/stderr）',
        '- files/sidecar.log(.N)：sidecar 行程日誌（含 mDNS、連線、斷線、IP 切換事件）',
        '- files/sidecar.db：sidecar 資料庫快照（如存在）',
        '',
        '建議排查順序：',
        '1. 先看 diagnostics.json 的 environment.wifi，確認當時連線的 Wi-Fi',
        '2. 再看 sidecar.log 中的 "local IP changed" / "tcp client disconnected" 事件',
        '3. 若涉及 UI / 狀態問題，最後看 desktop-main.log',
        '',
        '請將整個 ZIP 提供給開發團隊排查。',
        '',
      ],
    },
    updates: {
      title: 'Vivi Drop 有可用更新',
      message: '有新版本 v{{version}} 可用',
      minimumRequired: '此版本需要更新後繼續使用。',
      releaseNotes: '更新內容',
      openDownload: '開啟下載頁',
      later: '稍後',
      ok: '確定',
    },
  },
} as const;

export function getMainStrings(
  locale: string | null | undefined,
): (typeof MAIN_STRINGS)[SupportedLocale] {
  return MAIN_STRINGS[isSupportedLocale(locale) ? locale : 'en'];
}
