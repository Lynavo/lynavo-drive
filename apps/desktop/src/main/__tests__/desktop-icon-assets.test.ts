import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '../../../../..');
const desktopResources = join(repoRoot, 'apps/desktop/resources');

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function readPngAlphaExtrema(filePath: string): { min: number; max: number } {
  const png = readFileSync(filePath);
  expect(png.subarray(0, pngSignature.length).equals(pngSignature)).toBe(true);

  let offset = pngSignature.length;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = png.subarray(dataStart, dataEnd);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      expect(data[8]).toBe(8);
      expect([2, 6]).toContain(colorType);
      expect(data[12]).toBe(0);
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }

    offset = dataEnd + 4;
  }

  if (colorType === 2) return { min: 255, max: 255 };

  const bytesPerPixel = 4;
  const rowLength = width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const currentRow = Buffer.alloc(rowLength);
  const previousRow = Buffer.alloc(rowLength);
  let inputOffset = 0;
  let min = 255;
  let max = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;

    for (let x = 0; x < rowLength; x += 1) {
      const raw = inflated[inputOffset + x];
      const left = x >= bytesPerPixel ? currentRow[x - bytesPerPixel] : 0;
      const up = previousRow[x];
      const upLeft = x >= bytesPerPixel ? previousRow[x - bytesPerPixel] : 0;

      if (filter === 0) currentRow[x] = raw;
      else if (filter === 1) currentRow[x] = (raw + left) & 0xff;
      else if (filter === 2) currentRow[x] = (raw + up) & 0xff;
      else if (filter === 3) currentRow[x] = (raw + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) currentRow[x] = (raw + paethPredictor(left, up, upLeft)) & 0xff;
      else throw new Error(`Unsupported PNG filter ${filter} in ${filePath}`);
    }

    for (let alphaIndex = 3; alphaIndex < rowLength; alphaIndex += bytesPerPixel) {
      const alpha = currentRow[alphaIndex];
      min = Math.min(min, alpha);
      max = Math.max(max, alpha);
    }

    currentRow.copy(previousRow);
    inputOffset += rowLength;
  }

  return { min, max };
}

describe('desktop app icon assets', () => {
  it('keeps macOS app icons fully opaque so the Dock does not show a gray backing layer', () => {
    const iconFiles = [
      'icon-1024.png',
      'icon.iconset/icon_16x16.png',
      'icon.iconset/icon_16x16@2x.png',
      'icon.iconset/icon_32x32.png',
      'icon.iconset/icon_32x32@2x.png',
      'icon.iconset/icon_128x128.png',
      'icon.iconset/icon_128x128@2x.png',
      'icon.iconset/icon_256x256.png',
      'icon.iconset/icon_256x256@2x.png',
      'icon.iconset/icon_512x512.png',
      'icon.iconset/icon_512x512@2x.png',
    ];

    for (const iconFile of iconFiles) {
      expect(readPngAlphaExtrema(join(desktopResources, iconFile))).toEqual({ min: 255, max: 255 });
    }
  });
});
