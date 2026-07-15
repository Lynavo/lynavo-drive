import type { DownloadRecord } from '../services/download-records-service';

import { isVisualQaEnabled } from './visualQa';

const now = Date.now();

export const VISUAL_QA_DOWNLOAD_RECORDS: DownloadRecord[] = [
  {
    id: 'visual-qa-download-client-handoff',
    resourceId: 'visual-qa-client-handoff',
    filename: 'Client-Handoff.mov',
    fileSize: 824633720,
    mediaType: 'video/quicktime',
    downloadedAt: new Date(now - 18 * 60 * 1000).toISOString(),
    localPath: '/visual-qa/Client-Handoff.mov',
    savedToPhotos: true,
  },
  {
    id: 'visual-qa-download-desktop-mockup',
    resourceId: 'visual-qa-desktop-mockup',
    filename: 'Desktop-Mockup.png',
    fileSize: 9437184,
    mediaType: 'image/png',
    downloadedAt: new Date(now - 42 * 60 * 1000).toISOString(),
    localPath: '/visual-qa/Desktop-Mockup.png',
    savedToPhotos: true,
  },
  {
    id: 'visual-qa-download-campaign-keyframes',
    resourceId: 'visual-qa-campaign-keyframes',
    filename: 'Campaign-Keyframes.zip',
    fileSize: 142606336,
    mediaType: 'application/zip',
    downloadedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    localPath: '/visual-qa/Campaign-Keyframes.zip',
    savedToPhotos: false,
  },
  {
    id: 'visual-qa-download-invoice-archive',
    resourceId: 'visual-qa-invoice-archive',
    filename: 'Invoice-Archive.pdf',
    fileSize: 3145728,
    mediaType: 'application/pdf',
    downloadedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString(),
    localPath: '/visual-qa/Invoice-Archive.pdf',
    savedToPhotos: false,
  },
];

export function getVisualQaDownloadRecords(): DownloadRecord[] {
  return isVisualQaEnabled() ? VISUAL_QA_DOWNLOAD_RECORDS : [];
}
