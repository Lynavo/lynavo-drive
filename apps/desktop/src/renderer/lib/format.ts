import i18n from '@renderer/i18n';

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

export function formatDuration(ms: number): string {
  const totalSec = ms / 1000;
  if (totalSec >= 3600) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }
  if (totalSec >= 60) {
    const m = Math.floor(totalSec / 60);
    const s = Math.floor(totalSec % 60);
    return `${m}m ${String(s).padStart(2, '0')}s`;
  }
  if (totalSec >= 1) return `${totalSec.toFixed(1)}s`;
  return `${ms}ms`;
}

export function formatDate(iso: string): string {
  const [month, day] = iso.slice(5).split('-').map(Number);
  if (!month || !day) return iso;
  return i18n.t('common.date.monthDay', { month, day });
}

export function formatSmartDate(iso?: string): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '\u2014';
  const now = new Date();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor((todayStart.getTime() - targetStart.getTime()) / 86400000);

  if (diffDays === 0) return i18n.t('common.date.todayWithTime', { time });
  if (diffDays === 1) return i18n.t('common.date.yesterdayWithTime', { time });
  if (diffDays > 1 && diffDays < 7) {
    const weekdays = i18n.t('common.date.weekdays', { returnObjects: true });
    const weekday = Array.isArray(weekdays) ? weekdays[d.getDay()] : '';
    return i18n.t('common.date.weekdayWithTime', { weekday, time });
  }
  const month = d.getMonth() + 1;
  const day = d.getDate();
  if (d.getFullYear() !== now.getFullYear()) {
    return i18n.t('common.date.yearMonthDayWithTime', {
      year: d.getFullYear(),
      month,
      day,
      time,
    });
  }
  return i18n.t('common.date.monthDayWithTime', { month, day, time });
}

export function formatDateTime(iso?: string): string {
  if (!iso) return i18n.t('common.fallback.noRecord');
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return i18n.t('common.fallback.noRecord');

  const now = new Date();
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

  if (date.toDateString() === now.toDateString()) {
    return i18n.t('common.date.todayWithTime', { time });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return i18n.t('common.date.monthDayWithTime', {
      month: date.getMonth() + 1,
      day: date.getDate(),
      time,
    });
  }
  return i18n.t('common.date.yearMonthDayWithTime', {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    time,
  });
}
