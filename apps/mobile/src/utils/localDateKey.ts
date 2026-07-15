export function formatLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatLocalYesterdayDateKey(date: Date = new Date()): string {
  const yesterday = new Date(date);
  yesterday.setDate(yesterday.getDate() - 1);
  return formatLocalDateKey(yesterday);
}
