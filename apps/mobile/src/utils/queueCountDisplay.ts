export function formatQueueCountDisplay(count: number): string {
  const normalizedCount =
    Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;

  if (normalizedCount > 99) {
    return '99+';
  }

  return String(normalizedCount);
}
