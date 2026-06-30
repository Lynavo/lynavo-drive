import type { DashboardSummaryDTO } from '@lynavo-drive/contracts';

export const mockDashboardSummary: DashboardSummaryDTO = {
  todayUploadCount: 42,
  todayOccupiedBytes: 25 * 1024 ** 3, // ~25 GB
  remainingBytes: 1.2 * 1024 ** 4, // ~1.2 TB
  isDiskLow: false,
  lastSuccessfulSyncAt: '2026-03-24T15:19:26Z',
  lastSuccessfulDeviceName: 'Alice 的 iPhone',
};
