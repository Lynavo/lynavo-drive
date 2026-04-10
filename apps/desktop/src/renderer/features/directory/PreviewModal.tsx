import { useCallback, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useDirectoryStore } from '@renderer/stores/directory-store';

export function PreviewModal() {
  const previewFile = useDirectoryStore((s) => s.previewFile);
  const previewIndex = useDirectoryStore((s) => s.previewIndex);
  const previewList = useDirectoryStore((s) => s.previewList);
  const closePreview = useDirectoryStore((s) => s.closePreview);
  const prevPreview = useDirectoryStore((s) => s.prevPreview);
  const nextPreview = useDirectoryStore((s) => s.nextPreview);

  const hasList = previewList.length > 1;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          closePreview();
          break;
        case 'ArrowLeft':
          prevPreview();
          break;
        case 'ArrowRight':
          nextPreview();
          break;
      }
    },
    [closePreview, prevPreview, nextPreview],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!previewFile) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={closePreview}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Left arrow */}
      {hasList && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            prevPreview();
          }}
          className="absolute left-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}

      {/* Right arrow */}
      {hasList && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            nextPreview();
          }}
          className="absolute right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}

      {/* Content */}
      <div
        className="relative flex max-h-[90vh] max-w-[85vw] flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button + counter */}
        <div className="absolute -top-10 flex w-full items-center justify-between px-1">
          {hasList ? (
            <span className="text-xs tabular-nums text-white/60">
              {previewIndex + 1} / {previewList.length}
            </span>
          ) : (
            <span />
          )}
          <button
            onClick={closePreview}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white transition-colors hover:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* File name */}
        <p className="mb-3 max-w-lg truncate text-sm font-medium text-white/90">
          {previewFile.name}
        </p>

        {/* Media */}
        {previewFile.mediaType === 'image' ? (
          <img
            key={previewFile.url}
            src={previewFile.url}
            alt={previewFile.name}
            className="max-h-[80vh] max-w-[85vw] rounded-lg object-contain shadow-2xl"
            draggable={false}
          />
        ) : (
          <video
            key={previewFile.url}
            src={previewFile.url}
            controls
            autoPlay
            className="max-h-[80vh] max-w-[85vw] rounded-lg shadow-2xl"
          >
            <track kind="captions" />
          </video>
        )}
      </div>
    </div>
  );
}
