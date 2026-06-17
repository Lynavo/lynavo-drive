export function isImageFile(mediaType?: string | null, filename?: string | null) {
  const name = filename ?? '';
  return (
    mediaType === 'image' ||
    mediaType?.startsWith('image/') === true ||
    /\.(jpg|jpeg|png|gif|webp|heic|heif|bmp|tiff|tif)$/i.test(name)
  );
}

export function isVideoFile(mediaType?: string | null, filename?: string | null) {
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
