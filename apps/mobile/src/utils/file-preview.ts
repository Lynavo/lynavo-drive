import Share, { type ShareOptions } from 'react-native-share';

type ShareOpen = (options: ShareOptions) => Promise<unknown>;
type ShareModuleShape = {
  open?: ShareOpen;
  default?: {
    open?: ShareOpen;
  };
};

function resolveShareOpen(): ShareOpen {
  const shareModule = Share as unknown as ShareModuleShape;
  const shareOpen = shareModule.open ?? shareModule.default?.open;
  if (!shareOpen) {
    throw new Error('react-native-share open is unavailable');
  }
  return shareOpen;
}

export function isImageFile(
  mediaType?: string | null,
  filename?: string | null,
) {
  const name = filename ?? '';
  return (
    mediaType === 'image' ||
    mediaType?.startsWith('image/') === true ||
    /\.(jpg|jpeg|png|gif|webp|heic|heif|bmp|tiff|tif)$/i.test(name)
  );
}

export function isVideoFile(
  mediaType?: string | null,
  filename?: string | null,
) {
  const name = filename ?? '';
  return (
    mediaType === 'video' ||
    mediaType?.startsWith('video/') === true ||
    /\.(mp4|mov|m4v|avi|mkv|webm)$/i.test(name)
  );
}

export function documentMimeType(filename?: string | null): string | undefined {
  const ext = filename?.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'md':
    case 'markdown':
      return 'text/markdown';
    case 'json':
      return 'application/json';
    case 'xml':
      return 'application/xml';
    case 'html':
    case 'htm':
      return 'text/html';
    case 'rtf':
      return 'application/rtf';
    case 'pdf':
      return 'application/pdf';
    case 'txt':
    case 'log':
      return 'text/plain';
    case 'csv':
      return 'text/csv';
    case 'doc':
      return 'application/msword';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xls':
      return 'application/vnd.ms-excel';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'ppt':
      return 'application/vnd.ms-powerpoint';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case 'zip':
      return 'application/zip';
    default:
      return undefined;
  }
}

export function canPreviewDocumentFile(
  _mediaType?: string | null,
  filename?: string | null,
): boolean {
  const ext = filename?.split('.').pop()?.toLowerCase();
  const hasExtension = Boolean(ext && ext !== filename?.toLowerCase());

  if (hasExtension) {
    return (
      documentMimeType(filename) != null ||
      ['pages', 'numbers', 'key', 'yaml', 'yml'].includes(ext ?? '')
    );
  }

  return false;
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function encodeFileUriPath(path: string): string {
  return path
    .split('/')
    .map(segment => encodeURIComponent(decodePathSegment(segment)))
    .join('/');
}

export function documentPreviewUri(localPath: string): string {
  const trimmed = localPath.trim();
  if (trimmed.startsWith('file://')) {
    return `file://${encodeFileUriPath(trimmed.slice('file://'.length))}`;
  }
  if (trimmed.startsWith('content://') || trimmed.startsWith('ph://')) {
    return trimmed;
  }
  return `file://${encodeFileUriPath(trimmed)}`;
}

export function safeShareFilename(
  filename?: string | null,
): string | undefined {
  const candidate = filename?.trim();
  if (!candidate) return undefined;
  const sanitized = candidate.replace(/[\/\\:\x00-\x1F\x7F]/g, '_').trim();
  return sanitized.length > 0 ? sanitized : undefined;
}

export async function openFileWithOtherApp(
  localPath: string,
  filename?: string | null,
): Promise<void> {
  const safeFilename = safeShareFilename(filename);
  await resolveShareOpen()({
    url: documentPreviewUri(localPath),
    type: documentMimeType(safeFilename) ?? 'application/octet-stream',
    filename: safeFilename,
    title: safeFilename,
    subject: safeFilename,
    failOnCancel: false,
    showAppsToView: true,
  });
}
