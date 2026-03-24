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
  return iso.slice(5).replace('-', '\u6708') + '\u65e5';
}

export function formatDateTime(iso?: string): string {
  if (!iso) return '暂无记录';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '暂无记录';

  const now = new Date();
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

  if (date.toDateString() === now.toDateString()) {
    return `今天 ${time}`;
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${time}`;
}
