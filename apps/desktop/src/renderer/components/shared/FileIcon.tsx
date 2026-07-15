import { FileVideo, Image, FileAudio, File } from 'lucide-react';
import { cn } from '@renderer/lib/utils';

const videoExts = new Set(['mp4', 'mov', 'braw', 'mxf', 'r3d', 'avi']);
const imageExts = new Set(['jpg', 'jpeg', 'heic', 'png', 'raw', 'dng', 'arw']);
const audioExts = new Set(['wav', 'mp3', 'aac', 'aif']);

interface FileIconConfig {
  icon: typeof FileVideo;
  color: string;
  bg: string;
}

function getFileIconConfig(filename: string): FileIconConfig {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

  if (videoExts.has(ext)) return { icon: FileVideo, color: '#3b82f6', bg: 'rgba(59,130,246,0.09)' };
  if (imageExts.has(ext)) return { icon: Image, color: '#0ea5c9', bg: 'rgba(14,165,201,0.09)' };
  if (audioExts.has(ext)) return { icon: FileAudio, color: '#a855f7', bg: 'rgba(168,85,247,0.09)' };

  return { icon: File, color: '#6b7a8d', bg: 'rgba(107,122,141,0.09)' };
}

interface FileIconProps {
  name: string;
  className?: string;
}

export function FileIcon({ name, className }: FileIconProps) {
  const { icon: Icon, color, bg } = getFileIconConfig(name);

  return (
    <div
      className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', className)}
      style={{ background: bg }}
    >
      <Icon className="h-4 w-4" style={{ color }} />
    </div>
  );
}

export { getFileIconConfig };
