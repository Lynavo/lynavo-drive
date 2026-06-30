import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { app, nativeImage } from 'electron';
import log from 'electron-log';
import { SIDECAR_EVENT_TYPES, type SidecarEvent } from '@lynavo-drive/contracts';

type VideoThumbnailRequestPayload = Extract<
  SidecarEvent,
  { type: typeof SIDECAR_EVENT_TYPES.VIDEO_THUMBNAIL_REQUEST }
>['payload'];

const SUPPORTED_THUMBNAIL_SOURCE_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.m4v',
  '.webm',
  '.heic',
  '.heif',
]);

type VideoThumbnailFileSystem = {
  existsSync: typeof existsSync;
  lstatSync: typeof lstatSync;
  mkdirSync: typeof mkdirSync;
  realpathSync: typeof realpathSync;
  renameSync: typeof renameSync;
  rmSync: typeof rmSync;
  statSync: typeof statSync;
  writeFileSync: typeof writeFileSync;
};

const defaultFileSystem: VideoThumbnailFileSystem = {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
};

export function sidecarThumbnailCacheRoot(): string {
  return join(app.getPath('userData'), 'thumbnail-cache');
}

export function createVideoThumbnailEventHandler(
  cacheRoot: string = sidecarThumbnailCacheRoot(),
  fileSystem: VideoThumbnailFileSystem = defaultFileSystem,
): (event: SidecarEvent) => Promise<void> {
  return async (event) => {
    if (event.type !== SIDECAR_EVENT_TYPES.VIDEO_THUMBNAIL_REQUEST) {
      return;
    }

    log.info('[video-thumbnail] event received', {
      requestId: event.payload.requestId,
      sourcePath: event.payload.sourcePath,
      cachePath: event.payload.cachePath,
      cacheRoot,
      sourceVersion: event.payload.sourceVersion,
      maxEdge: event.payload.maxEdge,
      quality: event.payload.quality,
    });
    await generateVideoThumbnail(event.payload, cacheRoot, fileSystem);
  };
}

async function generateVideoThumbnail(
  payload: VideoThumbnailRequestPayload,
  cacheRoot: string,
  fileSystem: VideoThumbnailFileSystem,
): Promise<void> {
  let tmpPath: string | null = null;

  try {
    const sourcePath = validateSourcePath(payload.sourcePath, fileSystem);
    const cachePath = validateCachePath(payload.cachePath, cacheRoot, fileSystem);
    const maxEdge = clampInteger(payload.maxEdge, 1, 1024, 256);
    const quality = clampInteger(payload.quality, 1, 100, 80);
    const cacheDir = dirname(cachePath);
    const sourceInfo = fileSystem.statSync(sourcePath);

    prepareCacheDirectory(cachePath, cacheRoot, fileSystem);
    log.info('[video-thumbnail] request validated', {
      requestId: payload.requestId,
      sourcePath,
      sourceSize: sourceInfo.size,
      sourceMtimeMs: sourceInfo.mtimeMs,
      cachePath,
      cacheRoot,
      cacheAlreadyExists: fileSystem.existsSync(cachePath),
      maxEdge,
      quality,
    });

    const image = await nativeImage.createThumbnailFromPath(sourcePath, {
      width: maxEdge,
      height: maxEdge,
    });
    const imageSize = image.getSize();
    log.info('[video-thumbnail] native thumbnail created', {
      requestId: payload.requestId,
      width: imageSize.width,
      height: imageSize.height,
      empty: image.isEmpty(),
    });
    if (image.isEmpty()) {
      throw new Error('empty thumbnail');
    }

    validateCacheDirectoryRealPath(cachePath, cacheRoot, fileSystem);
    tmpPath = join(cacheDir, `.video-thumbnail-${process.pid}-${randomUUID()}.jpg`);
    const jpegBytes = image.toJPEG(quality);
    log.info('[video-thumbnail] jpeg encoded', {
      requestId: payload.requestId,
      bytes: jpegBytes.byteLength,
      tmpPath,
    });
    fileSystem.writeFileSync(tmpPath, jpegBytes);
    fileSystem.renameSync(tmpPath, cachePath);
    tmpPath = null;

    log.info('[video-thumbnail] generated', {
      requestId: payload.requestId,
      cachePath,
      bytes: jpegBytes.byteLength,
    });
  } catch (err) {
    if (tmpPath) {
      removeTempFile(tmpPath, payload.requestId, fileSystem);
    }
    log.warn('[video-thumbnail] failed', {
      requestId: payload.requestId,
      sourcePath: payload.sourcePath,
      cachePath: payload.cachePath,
      cacheRoot,
      error: err,
    });
  }
}

function validateSourcePath(value: string, fileSystem: VideoThumbnailFileSystem): string {
  if (!isAbsolute(value)) {
    throw new Error('sourcePath must be absolute');
  }

  const sourcePath = resolve(value);
  if (!SUPPORTED_THUMBNAIL_SOURCE_EXTENSIONS.has(extname(sourcePath).toLowerCase())) {
    throw new Error('unsupported thumbnail source extension');
  }

  const info = fileSystem.statSync(sourcePath);
  if (!info.isFile()) {
    throw new Error('sourcePath must be a file');
  }

  return sourcePath;
}

function validateCachePath(
  value: string,
  cacheRoot: string,
  fileSystem: VideoThumbnailFileSystem,
): string {
  if (!isAbsolute(value)) {
    throw new Error('cachePath must be absolute');
  }

  const cachePath = resolve(value);
  const resolvedCacheRoot = resolve(cacheRoot);
  if (extname(cachePath).toLowerCase() !== '.jpg') {
    throw new Error('cachePath must be a jpg');
  }

  if (cachePath !== resolvedCacheRoot && !cachePath.startsWith(resolvedCacheRoot + sep)) {
    throw new Error('cachePath must be inside thumbnail cache root');
  }

  if (fileSystem.existsSync(cachePath)) {
    const info = fileSystem.statSync(cachePath);
    if (!info.isFile()) {
      throw new Error('cachePath exists and is not a file');
    }
  }

  return cachePath;
}

function prepareCacheDirectory(
  cachePath: string,
  cacheRoot: string,
  fileSystem: VideoThumbnailFileSystem,
): void {
  const resolvedCacheRoot = resolve(cacheRoot);
  const resolvedCacheDir = resolve(dirname(cachePath));

  if (!isPathInsideOrEqual(resolvedCacheDir, resolvedCacheRoot)) {
    throw new Error('cache directory must be inside thumbnail cache root');
  }

  ensureCacheRoot(resolvedCacheRoot, fileSystem);
  validateExistingCacheDirectoryAncestors(resolvedCacheRoot, resolvedCacheDir, fileSystem);
  fileSystem.mkdirSync(resolvedCacheDir, { recursive: true });
  validateCacheDirectoryRealPath(cachePath, resolvedCacheRoot, fileSystem);
}

function ensureCacheRoot(cacheRoot: string, fileSystem: VideoThumbnailFileSystem): void {
  if (!fileSystem.existsSync(cacheRoot)) {
    fileSystem.mkdirSync(cacheRoot, { recursive: true });
  }

  const info = fileSystem.lstatSync(cacheRoot);
  if (info.isSymbolicLink()) {
    throw new Error('thumbnail cache root must not be a symlink');
  }
  if (!info.isDirectory()) {
    throw new Error('thumbnail cache root must be a directory');
  }
}

function validateExistingCacheDirectoryAncestors(
  cacheRoot: string,
  cacheDir: string,
  fileSystem: VideoThumbnailFileSystem,
): void {
  for (const path of pathChain(cacheRoot, cacheDir)) {
    if (!fileSystem.existsSync(path)) {
      return;
    }

    const info = fileSystem.lstatSync(path);
    if (info.isSymbolicLink()) {
      throw new Error('thumbnail cache directory must not contain symlinks');
    }
    if (!info.isDirectory()) {
      throw new Error('thumbnail cache ancestor must be a directory');
    }
  }
}

function validateCacheDirectoryRealPath(
  cachePath: string,
  cacheRoot: string,
  fileSystem: VideoThumbnailFileSystem,
): void {
  const resolvedCacheRoot = resolve(cacheRoot);
  const cacheDir = dirname(cachePath);
  const resolvedCacheDir = resolve(cacheDir);

  if (!isPathInsideOrEqual(resolvedCacheDir, resolvedCacheRoot)) {
    throw new Error('cache directory must be inside thumbnail cache root');
  }

  for (const path of pathChain(resolvedCacheRoot, resolvedCacheDir)) {
    if (fileSystem.lstatSync(path).isSymbolicLink()) {
      throw new Error('thumbnail cache directory must not contain symlinks');
    }
  }

  const realCacheRoot = fileSystem.realpathSync(resolvedCacheRoot);
  const realCacheDir = fileSystem.realpathSync(resolvedCacheDir);
  if (!isPathInsideOrEqual(realCacheDir, realCacheRoot)) {
    throw new Error('cache directory real path must be inside thumbnail cache root');
  }
}

function pathChain(root: string, target: string): string[] {
  const chain = [root];
  const relativeTarget = relative(root, target);
  if (!relativeTarget) {
    return chain;
  }

  let current = root;
  for (const part of relativeTarget.split(sep)) {
    current = join(current, part);
    chain.push(current);
  }
  return chain;
}

function isPathInsideOrEqual(value: string, root: string): boolean {
  return value === root || value.startsWith(root + sep);
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function removeTempFile(
  tmpPath: string,
  requestId: string,
  fileSystem: VideoThumbnailFileSystem,
): void {
  try {
    fileSystem.rmSync(tmpPath, { force: true });
  } catch (err) {
    log.warn(
      `[video-thumbnail] failed to remove temp requestId=${requestId} tmpPath=${tmpPath}`,
      err,
    );
  }
}
