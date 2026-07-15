import common_en from './locales/en/common.json';
import dashboard_en from './locales/en/dashboard.json';
import devices_en from './locales/en/devices.json';
import deviceDetail_en from './locales/en/deviceDetail.json';
import directory_en from './locales/en/directory.json';
import errors_en from './locales/en/errors.json';
import help_en from './locales/en/help.json';
import layout_en from './locales/en/layout.json';
import settings_en from './locales/en/settings.json';
import common_zh_Hans from './locales/zh-Hans/common.json';
import dashboard_zh_Hans from './locales/zh-Hans/dashboard.json';
import devices_zh_Hans from './locales/zh-Hans/devices.json';
import deviceDetail_zh_Hans from './locales/zh-Hans/deviceDetail.json';
import directory_zh_Hans from './locales/zh-Hans/directory.json';
import errors_zh_Hans from './locales/zh-Hans/errors.json';
import help_zh_Hans from './locales/zh-Hans/help.json';
import layout_zh_Hans from './locales/zh-Hans/layout.json';
import settings_zh_Hans from './locales/zh-Hans/settings.json';
import common_zh_Hant from './locales/zh-Hant/common.json';
import dashboard_zh_Hant from './locales/zh-Hant/dashboard.json';
import devices_zh_Hant from './locales/zh-Hant/devices.json';
import deviceDetail_zh_Hant from './locales/zh-Hant/deviceDetail.json';
import directory_zh_Hant from './locales/zh-Hant/directory.json';
import errors_zh_Hant from './locales/zh-Hant/errors.json';
import help_zh_Hant from './locales/zh-Hant/help.json';
import layout_zh_Hant from './locales/zh-Hant/layout.json';
import settings_zh_Hant from './locales/zh-Hant/settings.json';

export const LOCALE_SECTIONS = [
  'common',
  'dashboard',
  'devices',
  'deviceDetail',
  'directory',
  'errors',
  'help',
  'layout',
  'settings',
] as const;

export const translationSchema = {
  common: common_zh_Hant,
  dashboard: dashboard_zh_Hant,
  devices: devices_zh_Hant,
  deviceDetail: deviceDetail_zh_Hant,
  directory: directory_zh_Hant,
  errors: errors_zh_Hant,
  help: help_zh_Hant,
  layout: layout_zh_Hant,
  settings: settings_zh_Hant,
} as const;

export const resources = {
  en: {
    translation: {
      common: common_en,
      dashboard: dashboard_en,
      devices: devices_en,
      deviceDetail: deviceDetail_en,
      directory: directory_en,
      errors: errors_en,
      help: help_en,
      layout: layout_en,
      settings: settings_en,
    },
  },
  'zh-Hans': {
    translation: {
      common: common_zh_Hans,
      dashboard: dashboard_zh_Hans,
      devices: devices_zh_Hans,
      deviceDetail: deviceDetail_zh_Hans,
      directory: directory_zh_Hans,
      errors: errors_zh_Hans,
      help: help_zh_Hans,
      layout: layout_zh_Hans,
      settings: settings_zh_Hans,
    },
  },
  'zh-Hant': {
    translation: {
      common: common_zh_Hant,
      dashboard: dashboard_zh_Hant,
      devices: devices_zh_Hant,
      deviceDetail: deviceDetail_zh_Hant,
      directory: directory_zh_Hant,
      errors: errors_zh_Hant,
      help: help_zh_Hant,
      layout: layout_zh_Hant,
      settings: settings_zh_Hant,
    },
  },
} as const;
