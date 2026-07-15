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
      filenamePrefix: 'Lynavo Drive-\u8bca\u65ad\u5305',
      title: '\u5bfc\u51fa\u8bca\u65ad\u5305',
      readme: [
        'Lynavo Drive \u8bca\u65ad\u5305',
        '',
        '\u5305\u542b\u5185\u5bb9\uff1a',
        '- diagnostics.json\uff1a\u95ee\u9898\u63cf\u8ff0\u3001\u7248\u672c\u3001\u8fd0\u884c\u65f6\u72b6\u6001\u3001dashboard\u3001\u8bbe\u7f6e\u3001\u5171\u4eab\u72b6\u6001\u3001\u8def\u5f84\u4e0e\u7f51\u7edc\u73af\u5883\uff08WiFi SSID\u3001\u7f51\u5361\u5217\u8868\uff09',
        '- files/*.log\uff1a\u684c\u9762\u7aef\u8fdb\u7a0b\u65e5\u5fd7\u3001renderer \u65e5\u5fd7\u4e0e\u53ef\u7528\u7684\u8f6e\u8f6c\u65e5\u5fd7',
        '- files/macos-power.log\uff1amacOS \u6700\u8fd1 sleep / wake \u8bb0\u5f55\uff08\u5982\u53ef\u7528\uff09',
        '- files/sidecar.log(.N)\uff1asidecar \u8fdb\u7a0b\u65e5\u5fd7\uff08\u542b mDNS\u3001\u8fde\u7ebf\u3001\u65ad\u7ebf\u3001IP \u5207\u6362\u4e8b\u4ef6\uff09',
        '- files/sidecar.db\uff1asidecar \u6570\u636e\u5e93\u5feb\u7167\uff08\u5982\u5b58\u5728\uff09',
        '',
        '\u6392\u969c\u987a\u5e8f\u5efa\u8bae\uff1a',
        '1. \u5148\u770b diagnostics.json \u7684 environment.wifi \u786e\u8ba4\u5f53\u65f6\u8fde\u7684\u662f\u54ea\u4e2a WiFi',
        '2. \u518d\u770b sidecar.log \u4e2d "local IP changed" / "tcp client disconnected" \u4e8b\u4ef6',
        '3. \u82e5\u6d89\u53ca UI / \u72b6\u6001\u95ee\u9898\uff0c\u6700\u540e\u770b\u684c\u9762\u7aef\u548c renderer \u65e5\u5fd7',
        '',
        '\u8bf7\u5c06\u6574\u4e2a ZIP \u63d0\u4f9b\u7ed9\u5f00\u53d1\u56e2\u961f\u8fdb\u884c\u6392\u67e5\u3002',
        '',
      ],
    },
  },
  'zh-Hant': {
    diagnostics: {
      filenamePrefix: 'Lynavo Drive-\u8a3a\u65b7\u5305',
      title: '\u532f\u51fa\u8a3a\u65b7\u5305',
      readme: [
        'Lynavo Drive \u8a3a\u65b7\u5305',
        '',
        '\u5305\u542b\u5167\u5bb9\uff1a',
        '- diagnostics.json\uff1a\u554f\u984c\u63cf\u8ff0\u3001\u7248\u672c\u3001\u57f7\u884c\u72c0\u614b\u3001dashboard\u3001\u8a2d\u5b9a\u3001\u5171\u4eab\u72c0\u614b\u3001\u8def\u5f91\u8207\u7db2\u8def\u74b0\u5883\uff08Wi-Fi SSID\u3001\u7db2\u8def\u4ecb\u9762\u5217\u8868\uff09',
        '- files/*.log\uff1a\u684c\u9762\u7aef\u884c\u7a0b\u65e5\u8a8c\u3001renderer \u65e5\u8a8c\u8207\u53ef\u7528\u7684\u8f2a\u8f49\u65e5\u8a8c',
        '- files/macos-power.log\uff1amacOS \u6700\u8fd1 sleep / wake \u8a18\u9304\uff08\u5982\u53ef\u7528\uff09',
        '- files/sidecar.log(.N)\uff1asidecar \u884c\u7a0b\u65e5\u8a8c\uff08\u542b mDNS\u3001\u9023\u7dda\u3001\u65b7\u7dda\u3001IP \u5207\u63db\u4e8b\u4ef6\uff09',
        '- files/sidecar.db\uff1asidecar \u8cc7\u6599\u5eab\u5feb\u7167\uff08\u5982\u5b58\u5728\uff09',
        '',
        '\u5efa\u8b70\u6392\u67e5\u9806\u5e8f\uff1a',
        '1. \u5148\u770b diagnostics.json \u7684 environment.wifi\uff0c\u78ba\u8a8d\u7576\u6642\u9023\u7dda\u7684 Wi-Fi',
        '2. \u518d\u770b sidecar.log \u4e2d\u7684 "local IP changed" / "tcp client disconnected" \u4e8b\u4ef6',
        '3. \u82e5\u6d89\u53ca UI / \u72c0\u614b\u554f\u984c\uff0c\u6700\u5f8c\u770b\u684c\u9762\u7aef\u548c renderer \u65e5\u8a8c',
        '',
        '\u8acb\u5c07\u6574\u500b ZIP \u63d0\u4f9b\u7d66\u958b\u767c\u5718\u968a\u6392\u67e5\u3002',
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
