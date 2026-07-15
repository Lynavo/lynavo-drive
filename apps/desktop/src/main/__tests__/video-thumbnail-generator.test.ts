import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SIDECAR_EVENT_TYPES } from '@lynavo-drive/contracts';

const electronMockState = vi.hoisted(() => {
  const thumbnail = {
    getSize: vi.fn(() => ({ width: 256, height: 144 })),
    isEmpty: vi.fn(() => false),
    toJPEG: vi.fn(() => Buffer.from('jpeg-bytes')),
  };
  return {
    userDataPath: '',
    thumbnail,
    createThumbnailFromPath: vi.fn(async () => thumbnail),
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return electronMockState.userDataPath;
      return tmpdir();
    }),
  },
  nativeImage: {
    createThumbnailFromPath: electronMockState.createThumbnailFromPath,
  },
}));

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('video-thumbnail-generator', () => {
  beforeEach(() => {
    rmSync(electronMockState.userDataPath, { recursive: true, force: true });
    electronMockState.userDataPath = mkdtempSync(join(tmpdir(), 'lynavo-drive-video-thumb-'));
    vi.resetModules();
    vi.clearAllMocks();
    electronMockState.thumbnail.getSize.mockReturnValue({ width: 256, height: 144 });
    electronMockState.thumbnail.isEmpty.mockReturnValue(false);
    electronMockState.thumbnail.toJPEG.mockReturnValue(Buffer.from('jpeg-bytes'));
  });

  it('ignores non-video-thumbnail events', async () => {
    const { createVideoThumbnailEventHandler } = await import('../video-thumbnail-generator');
    const handler = createVideoThumbnailEventHandler();

    await handler({ type: 'transfer.active.changed', payload: { isActive: true } });

    expect(electronMockState.createThumbnailFromPath).not.toHaveBeenCalled();
  });

  it('generates a jpeg into the sidecar thumbnail cache', async () => {
    const { createVideoThumbnailEventHandler } = await import('../video-thumbnail-generator');
    const root = electronMockState.userDataPath;
    const sourcePath = join(root, 'clip.mov');
    const cachePath = join(root, 'thumbnail-cache', 'aa', 'cache.jpg');
    writeFileSync(sourcePath, 'video');

    const handler = createVideoThumbnailEventHandler();
    await handler({
      type: SIDECAR_EVENT_TYPES.VIDEO_THUMBNAIL_REQUEST,
      payload: {
        requestId: 'req-1',
        sourcePath,
        cachePath,
        sourceVersion: '5-123-v1',
        maxEdge: 256,
        quality: 80,
      },
    });

    expect(electronMockState.createThumbnailFromPath).toHaveBeenCalledWith(sourcePath, {
      width: 256,
      height: 256,
    });
    expect(readFileSync(cachePath).toString()).toBe('jpeg-bytes');
    expect(electronMockState.thumbnail.toJPEG).toHaveBeenCalledWith(80);
  });

  it('generates a jpeg thumbnail for HEIC sources', async () => {
    const { createVideoThumbnailEventHandler } = await import('../video-thumbnail-generator');
    const root = electronMockState.userDataPath;
    const sourcePath = join(root, 'photo.heic');
    const cachePath = join(root, 'thumbnail-cache', 'aa', 'heic.jpg');
    writeFileSync(sourcePath, 'heic-image');

    const handler = createVideoThumbnailEventHandler();
    await handler({
      type: SIDECAR_EVENT_TYPES.VIDEO_THUMBNAIL_REQUEST,
      payload: {
        requestId: 'req-heic',
        sourcePath,
        cachePath,
        sourceVersion: '10-123-v1',
        maxEdge: 256,
        quality: 80,
      },
    });

    expect(electronMockState.createThumbnailFromPath).toHaveBeenCalledWith(sourcePath, {
      width: 256,
      height: 256,
    });
    expect(readFileSync(cachePath).toString()).toBe('jpeg-bytes');
  });

  it('clamps requested thumbnail size and jpeg quality', async () => {
    const { createVideoThumbnailEventHandler } = await import('../video-thumbnail-generator');
    const root = electronMockState.userDataPath;
    const sourcePath = join(root, 'clip.webm');
    const cachePath = join(root, 'thumbnail-cache', 'aa', 'cache.jpg');
    writeFileSync(sourcePath, 'video');

    const handler = createVideoThumbnailEventHandler();
    await handler({
      type: SIDECAR_EVENT_TYPES.VIDEO_THUMBNAIL_REQUEST,
      payload: {
        requestId: 'req-clamp',
        sourcePath,
        cachePath,
        sourceVersion: '5-123-v1',
        maxEdge: 2048.75,
        quality: -5,
      },
    });

    expect(electronMockState.createThumbnailFromPath).toHaveBeenCalledWith(sourcePath, {
      width: 1024,
      height: 1024,
    });
    expect(electronMockState.thumbnail.toJPEG).toHaveBeenCalledWith(1);
  });

  it('rejects unsupported or missing source paths', async () => {
    const { createVideoThumbnailEventHandler } = await import('../video-thumbnail-generator');
    const root = electronMockState.userDataPath;
    const cachePath = join(root, 'thumbnail-cache', 'aa', 'cache.jpg');
    const unsupportedSourcePath = join(root, 'clip.avi');
    writeFileSync(unsupportedSourcePath, 'video');

    const handler = createVideoThumbnailEventHandler();
    await handler({
      type: SIDECAR_EVENT_TYPES.VIDEO_THUMBNAIL_REQUEST,
      payload: {
        requestId: 'req-source',
        sourcePath: unsupportedSourcePath,
        cachePath,
        sourceVersion: '5-123-v1',
        maxEdge: 256,
        quality: 80,
      },
    });

    expect(electronMockState.createThumbnailFromPath).not.toHaveBeenCalled();
    expect(existsSync(cachePath)).toBe(false);
  });

  it('rejects invalid source paths before thumbnail generation', async () => {
    const { createVideoThumbnailEventHandler } = await import('../video-thumbnail-generator');
    const root = electronMockState.userDataPath;
    const cachePath = join(root, 'thumbnail-cache', 'aa', 'cache.jpg');
    const directorySourcePath = join(root, 'directory.mov');
    mkdirSync(directorySourcePath);

    const handler = createVideoThumbnailEventHandler();
    for (const sourcePath of ['relative.mov', join(root, 'missing.mov'), directorySourcePath]) {
      await handler({
        type: SIDECAR_EVENT_TYPES.VIDEO_THUMBNAIL_REQUEST,
        payload: {
          requestId: `req-source-${sourcePath}`,
          sourcePath,
          cachePath,
          sourceVersion: '5-123-v1',
          maxEdge: 256,
          quality: 80,
        },
      });
    }

    expect(electronMockState.createThumbnailFromPath).not.toHaveBeenCalled();
    expect(existsSync(cachePath)).toBe(false);
  });

  it('rejects cache paths outside the thumbnail cache root', async () => {
    const { createVideoThumbnailEventHandler } = await import('../video-thumbnail-generator');
    const root = electronMockState.userDataPath;
    const sourcePath = join(root, 'clip.mov');
    const outsidePath = resolve(root, '..', 'outside.jpg');
    writeFileSync(sourcePath, 'video');

    const handler = createVideoThumbnailEventHandler();
    await handler({
      type: SIDECAR_EVENT_TYPES.VIDEO_THUMBNAIL_REQUEST,
      payload: {
        requestId: 'req-2',
        sourcePath,
        cachePath: outsidePath,
        sourceVersion: '5-123-v1',
        maxEdge: 256,
        quality: 80,
      },
    });

    expect(electronMockState.createThumbnailFromPath).not.toHaveBeenCalled();
    expect(existsSync(outsidePath)).toBe(false);
  });

  it('rejects invalid cache paths before thumbnail generation', async () => {
    const { createVideoThumbnailEventHandler } = await import('../video-thumbnail-generator');
    const root = electronMockState.userDataPath;
    const sourcePath = join(root, 'clip.mov');
    writeFileSync(sourcePath, 'video');

    const handler = createVideoThumbnailEventHandler();
    for (const cachePath of [
      'thumbnail-cache/cache.jpg',
      join(root, 'thumbnail-cache', 'aa', 'cache.png'),
    ]) {
      await handler({
        type: SIDECAR_EVENT_TYPES.VIDEO_THUMBNAIL_REQUEST,
        payload: {
          requestId: `req-cache-${cachePath}`,
          sourcePath,
          cachePath,
          sourceVersion: '5-123-v1',
          maxEdge: 256,
          quality: 80,
        },
      });
    }

    expect(electronMockState.createThumbnailFromPath).not.toHaveBeenCalled();
  });

  it('rejects cache parent symlinks that escape the thumbnail cache root', async () => {
    const { createVideoThumbnailEventHandler } = await import('../video-thumbnail-generator');
    const root = electronMockState.userDataPath;
    const sourcePath = join(root, 'clip.mov');
    const cacheRoot = join(root, 'thumbnail-cache');
    const outsideDir = mkdtempSync(join(tmpdir(), 'lynavo-drive-video-thumb-outside-'));
    const cacheDir = join(cacheRoot, 'aa');
    const cachePath = join(cacheDir, 'cache.jpg');
    writeFileSync(sourcePath, 'video');
    mkdirSync(cacheRoot, { recursive: true });
    symlinkSync(outsideDir, cacheDir, 'dir');

    const handler = createVideoThumbnailEventHandler();
    await handler({
      type: SIDECAR_EVENT_TYPES.VIDEO_THUMBNAIL_REQUEST,
      payload: {
        requestId: 'req-symlink-parent',
        sourcePath,
        cachePath,
        sourceVersion: '5-123-v1',
        maxEdge: 256,
        quality: 80,
      },
    });

    expect(electronMockState.createThumbnailFromPath).not.toHaveBeenCalled();
    expect(existsSync(join(outsideDir, 'cache.jpg'))).toBe(false);
    rmSync(outsideDir, { recursive: true, force: true });
  });

  it('rejects thumbnail cache root symlinks before creating child directories', async () => {
    const { createVideoThumbnailEventHandler } = await import('../video-thumbnail-generator');
    const root = electronMockState.userDataPath;
    const sourcePath = join(root, 'clip.mov');
    const cacheRoot = join(root, 'thumbnail-cache');
    const outsideDir = mkdtempSync(join(tmpdir(), 'lynavo-drive-video-thumb-outside-'));
    const cachePath = join(cacheRoot, 'aa', 'cache.jpg');
    writeFileSync(sourcePath, 'video');
    symlinkSync(outsideDir, cacheRoot, 'dir');

    const handler = createVideoThumbnailEventHandler();
    await expect(
      handler({
        type: SIDECAR_EVENT_TYPES.VIDEO_THUMBNAIL_REQUEST,
        payload: {
          requestId: 'req-symlink-root',
          sourcePath,
          cachePath,
          sourceVersion: '5-123-v1',
          maxEdge: 256,
          quality: 80,
        },
      }),
    ).resolves.toBeUndefined();

    expect(electronMockState.createThumbnailFromPath).not.toHaveBeenCalled();
    expect(existsSync(join(outsideDir, 'aa'))).toBe(false);
    expect(existsSync(join(outsideDir, 'aa', 'cache.jpg'))).toBe(false);
    rmSync(outsideDir, { recursive: true, force: true });
  });

  it('rejects cache paths that already exist as directories', async () => {
    const { createVideoThumbnailEventHandler } = await import('../video-thumbnail-generator');
    const root = electronMockState.userDataPath;
    const sourcePath = join(root, 'clip.m4v');
    const cachePath = join(root, 'thumbnail-cache', 'aa', 'cache.jpg');
    writeFileSync(sourcePath, 'video');
    mkdirSync(cachePath, { recursive: true });

    const handler = createVideoThumbnailEventHandler();
    await handler({
      type: SIDECAR_EVENT_TYPES.VIDEO_THUMBNAIL_REQUEST,
      payload: {
        requestId: 'req-cache-dir',
        sourcePath,
        cachePath,
        sourceVersion: '5-123-v1',
        maxEdge: 256,
        quality: 80,
      },
    });

    expect(electronMockState.createThumbnailFromPath).not.toHaveBeenCalled();
    expect(existsSync(cachePath)).toBe(true);
  });

  it('removes temp files when thumbnail generation fails', async () => {
    const { createVideoThumbnailEventHandler } = await import('../video-thumbnail-generator');
    const root = electronMockState.userDataPath;
    const sourcePath = join(root, 'broken.mov');
    const cacheDir = join(root, 'thumbnail-cache', 'bb');
    const cachePath = join(cacheDir, 'cache.jpg');
    writeFileSync(sourcePath, 'video');
    electronMockState.createThumbnailFromPath.mockRejectedValueOnce(new Error('decode failed'));

    const handler = createVideoThumbnailEventHandler();
    await handler({
      type: SIDECAR_EVENT_TYPES.VIDEO_THUMBNAIL_REQUEST,
      payload: {
        requestId: 'req-3',
        sourcePath,
        cachePath,
        sourceVersion: '5-123-v1',
        maxEdge: 256,
        quality: 80,
      },
    });

    expect(existsSync(cachePath)).toBe(false);
    const cacheDirEntries = existsSync(cacheDir)
      ? readdirSync(cacheDir).filter((entry) => entry.startsWith('.video-thumbnail-'))
      : [];
    expect(cacheDirEntries).toEqual([]);
  });

  it('does not leave cache files when thumbnail image is empty', async () => {
    const { createVideoThumbnailEventHandler } = await import('../video-thumbnail-generator');
    const root = electronMockState.userDataPath;
    const sourcePath = join(root, 'empty.mov');
    const cacheDir = join(root, 'thumbnail-cache', 'cc');
    const cachePath = join(cacheDir, 'cache.jpg');
    writeFileSync(sourcePath, 'video');
    electronMockState.thumbnail.isEmpty.mockReturnValue(true);

    const handler = createVideoThumbnailEventHandler();
    await handler({
      type: SIDECAR_EVENT_TYPES.VIDEO_THUMBNAIL_REQUEST,
      payload: {
        requestId: 'req-empty',
        sourcePath,
        cachePath,
        sourceVersion: '5-123-v1',
        maxEdge: 256,
        quality: 80,
      },
    });

    expect(existsSync(cachePath)).toBe(false);
    const cacheDirEntries = existsSync(cacheDir)
      ? readdirSync(cacheDir).map((entry) => basename(entry))
      : [];
    expect(cacheDirEntries).toEqual([]);
  });

  it('resolves when cleanup fails after an atomic write failure', async () => {
    const { createVideoThumbnailEventHandler } = await import('../video-thumbnail-generator');
    const root = electronMockState.userDataPath;
    const sourcePath = join(root, 'rename-fails.mov');
    const cachePath = join(root, 'thumbnail-cache', 'dd', 'cache.jpg');
    writeFileSync(sourcePath, 'video');
    const renameSyncMock = vi.fn(() => {
      throw new Error('rename failed');
    });
    const rmSyncMock = vi.fn(() => {
      throw new Error('cleanup failed');
    });

    const handler = createVideoThumbnailEventHandler(join(root, 'thumbnail-cache'), {
      existsSync,
      lstatSync,
      mkdirSync,
      realpathSync,
      renameSync: renameSyncMock,
      rmSync: rmSyncMock,
      statSync,
      writeFileSync,
    });
    await expect(
      handler({
        type: SIDECAR_EVENT_TYPES.VIDEO_THUMBNAIL_REQUEST,
        payload: {
          requestId: 'req-cleanup-fails',
          sourcePath,
          cachePath,
          sourceVersion: '5-123-v1',
          maxEdge: 256,
          quality: 80,
        },
      }),
    ).resolves.toBeUndefined();

    expect(renameSyncMock).toHaveBeenCalled();
    expect(rmSyncMock).toHaveBeenCalled();
    expect(existsSync(cachePath)).toBe(false);
  });
});
