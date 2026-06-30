export interface AndroidOemKeepaliveGuideInput {
  manufacturer?: string | null;
  brand?: string | null;
  language?: string | null;
}

export interface AndroidOemKeepaliveGuide {
  vendorLabel: string;
  steps: readonly string[];
}

type AndroidOemGuideKey =
  | 'xiaomi'
  | 'oppo'
  | 'vivo'
  | 'huawei'
  | 'samsung'
  | 'generic';

function normalizeVendorToken(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function resolveGuideKey(
  input: AndroidOemKeepaliveGuideInput,
): AndroidOemGuideKey {
  const token = `${normalizeVendorToken(input.manufacturer)} ${normalizeVendorToken(input.brand)}`;
  if (/(xiaomi|redmi|poco)/.test(token)) return 'xiaomi';
  if (/(oppo|oneplus|realme)/.test(token)) return 'oppo';
  if (/(vivo|iqoo|i qoo)/.test(token)) return 'vivo';
  if (/(huawei|honor)/.test(token)) return 'huawei';
  if (/samsung/.test(token)) return 'samsung';
  return 'generic';
}

function isEnglish(language: string | null | undefined): boolean {
  return (language ?? '').toLowerCase().startsWith('en');
}

function isSimplifiedChinese(language: string | null | undefined): boolean {
  const tag = (language ?? '').toLowerCase();
  return tag.startsWith('zh-hans') || tag.startsWith('zh-cn');
}

export function resolveAndroidOemKeepaliveGuide(
  input: AndroidOemKeepaliveGuideInput,
): AndroidOemKeepaliveGuide {
  const key = resolveGuideKey(input);
  const english = isEnglish(input.language);
  const simplified = isSimplifiedChinese(input.language);

  if (english) {
    switch (key) {
      case 'xiaomi':
        return {
          vendorLabel: 'Xiaomi / Redmi / POCO',
          steps: [
            'Open Security or Settings, enable Auto start for Lynavo Drive.',
            'Set Battery saver for Lynavo Drive to No restrictions.',
            'Keep the foreground sync notification visible while uploading.',
          ],
        };
      case 'oppo':
        return {
          vendorLabel: 'OPPO / OnePlus / realme',
          steps: [
            'Allow Auto launch or Startup for Lynavo Drive.',
            'Set App battery management to Allow background activity.',
            'Keep the foreground sync notification visible while uploading.',
          ],
        };
      case 'vivo':
        return {
          vendorLabel: 'vivo / iQOO',
          steps: [
            'Enable Autostart for Lynavo Drive in permission or battery settings.',
            'Set background power consumption to allow continued running.',
            'Keep the foreground sync notification visible while uploading.',
          ],
        };
      case 'huawei':
        return {
          vendorLabel: 'Huawei / Honor',
          steps: [
            'Open App launch, disable automatic management for Lynavo Drive.',
            'Allow Auto-launch, Secondary launch, and Run in background.',
            'Keep the foreground sync notification visible while uploading.',
          ],
        };
      case 'samsung':
        return {
          vendorLabel: 'Samsung',
          steps: [
            'Remove Lynavo Drive from Sleeping apps or Deep sleeping apps.',
            'Allow unrestricted Battery usage for Lynavo Drive.',
            'Keep the foreground sync notification visible while uploading.',
          ],
        };
      case 'generic':
        return {
          vendorLabel: 'This Android device',
          steps: [
            'Allow Auto start or Startup for Lynavo Drive if your system provides it.',
            'Set Battery usage for Lynavo Drive to unrestricted or allow background activity.',
            'Keep the foreground sync notification visible while uploading.',
          ],
        };
    }
  }

  if (simplified) {
    switch (key) {
      case 'xiaomi':
        return {
          vendorLabel: 'Xiaomi / Redmi / POCO',
          steps: [
            '在安全中心或系统设置中，允许 Lynavo Drive 自启动。',
            '将 Lynavo Drive 的省电策略设为无限制。',
            '上传时保持前台同步通知可见。',
          ],
        };
      case 'oppo':
        return {
          vendorLabel: 'OPPO / OnePlus / realme',
          steps: [
            '允许 Lynavo Drive 自启动或后台启动。',
            '在应用耗电管理中允许后台活动。',
            '上传时保持前台同步通知可见。',
          ],
        };
      case 'vivo':
        return {
          vendorLabel: 'vivo / iQOO',
          steps: [
            '在权限或电池设置中开启 Lynavo Drive 自启动。',
            '允许后台高耗电或后台继续运行。',
            '上传时保持前台同步通知可见。',
          ],
        };
      case 'huawei':
        return {
          vendorLabel: 'Huawei / Honor',
          steps: [
            '进入应用启动管理，关闭 Lynavo Drive 的自动管理。',
            '允许自启动、关联启动与后台活动。',
            '上传时保持前台同步通知可见。',
          ],
        };
      case 'samsung':
        return {
          vendorLabel: 'Samsung',
          steps: [
            '不要将 Lynavo Drive 放入休眠或深度休眠应用。',
            '将 Lynavo Drive 的电池使用设为不受限制。',
            '上传时保持前台同步通知可见。',
          ],
        };
      case 'generic':
        return {
          vendorLabel: '此 Android 设备',
          steps: [
            '如果系统提供自启动或启动管理，请允许 Lynavo Drive 自启动。',
            '将 Lynavo Drive 的电池使用设为不受限制，或允许后台活动。',
            '上传时保持前台同步通知可见。',
          ],
        };
    }
  }

  switch (key) {
    case 'xiaomi':
      return {
        vendorLabel: 'Xiaomi / Redmi / POCO',
        steps: [
          '在安全中心或系統設定中，允許 Lynavo Drive 自啟動。',
          '將 Lynavo Drive 的省電策略設為無限制。',
          '上傳時保持前台同步通知可見。',
        ],
      };
    case 'oppo':
      return {
        vendorLabel: 'OPPO / OnePlus / realme',
        steps: [
          '允許 Lynavo Drive 自啟動或背景啟動。',
          '在應用耗電管理中允許背景活動。',
          '上傳時保持前台同步通知可見。',
        ],
      };
    case 'vivo':
      return {
        vendorLabel: 'vivo / iQOO',
        steps: [
          '在權限或電池設定中開啟 Lynavo Drive 自啟動。',
          '允許背景高耗電或背景繼續執行。',
          '上傳時保持前台同步通知可見。',
        ],
      };
    case 'huawei':
      return {
        vendorLabel: 'Huawei / Honor',
        steps: [
          '進入應用啟動管理，關閉 Lynavo Drive 的自動管理。',
          '允許自啟動、關聯啟動與背景活動。',
          '上傳時保持前台同步通知可見。',
        ],
      };
    case 'samsung':
      return {
        vendorLabel: 'Samsung',
        steps: [
          '不要將 Lynavo Drive 放入休眠或深度休眠應用。',
          '將 Lynavo Drive 的電池使用設為不受限制。',
          '上傳時保持前台同步通知可見。',
        ],
      };
    case 'generic':
      return {
        vendorLabel: '此 Android 裝置',
        steps: [
          '如果系統提供自啟動或啟動管理，請允許 Lynavo Drive 自啟動。',
          '將 Lynavo Drive 的電池使用設為不受限制，或允許背景活動。',
          '上傳時保持前台同步通知可見。',
        ],
      };
  }
}
