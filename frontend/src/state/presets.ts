import type { AspectRatio, LayoutPreset } from '@/types';

export const ASPECT_RATIOS: AspectRatio[] = [
  { id: '1:1', label: 'Square', w: 1, h: 1 },
  { id: '4:5', label: 'Portrait', w: 4, h: 5 },
  { id: '3:4', label: '3:4', w: 3, h: 4 },
  { id: '9:16', label: 'Story', w: 9, h: 16 },
  { id: '4:3', label: 'Landscape', w: 4, h: 3 },
  { id: '16:9', label: 'Widescreen', w: 16, h: 9 },
  { id: '2:1', label: 'Banner', w: 2, h: 1 },
];

export const LAYOUT_PRESETS: LayoutPreset[] = [
  { id: 'single', name: 'Single', cols: 1, rows: 1, cells: [{ c: 1, r: 1, cs: 1, rs: 1 }] },
  {
    id: '2x1', name: '2 × 1', cols: 2, rows: 1,
    cells: [{ c: 1, r: 1 }, { c: 2, r: 1 }],
  },
  {
    id: '1x2', name: '1 × 2', cols: 1, rows: 2,
    cells: [{ c: 1, r: 1 }, { c: 1, r: 2 }],
  },
  {
    id: '2x2', name: '2 × 2', cols: 2, rows: 2,
    cells: [
      { c: 1, r: 1 }, { c: 2, r: 1 },
      { c: 1, r: 2 }, { c: 2, r: 2 },
    ],
  },
  {
    id: '3x3', name: '3 × 3', cols: 3, rows: 3,
    cells: [
      { c: 1, r: 1 }, { c: 2, r: 1 }, { c: 3, r: 1 },
      { c: 1, r: 2 }, { c: 2, r: 2 }, { c: 3, r: 2 },
      { c: 1, r: 3 }, { c: 2, r: 3 }, { c: 3, r: 3 },
    ],
  },
  {
    id: '2x3', name: '2 × 3', cols: 2, rows: 3,
    cells: [
      { c: 1, r: 1 }, { c: 2, r: 1 },
      { c: 1, r: 2 }, { c: 2, r: 2 },
      { c: 1, r: 3 }, { c: 2, r: 3 },
    ],
  },
  {
    id: 'hero-3', name: 'Hero + 3', cols: 4, rows: 3,
    cells: [
      { c: 1, r: 1, cs: 3, rs: 3 },
      { c: 4, r: 1 }, { c: 4, r: 2 }, { c: 4, r: 3 },
    ],
  },
  {
    id: 'hero-bottom', name: 'Hero + Strip', cols: 3, rows: 3,
    cells: [
      { c: 1, r: 1, cs: 3, rs: 2 },
      { c: 1, r: 3 }, { c: 2, r: 3 }, { c: 3, r: 3 },
    ],
  },
  {
    id: 'mosaic', name: 'Mosaic', cols: 4, rows: 4,
    cells: [
      { c: 1, r: 1, cs: 2, rs: 2 },
      { c: 3, r: 1, cs: 2, rs: 1 },
      { c: 3, r: 2 }, { c: 4, r: 2 },
      { c: 1, r: 3, cs: 1, rs: 2 },
      { c: 2, r: 3 }, { c: 3, r: 3, cs: 2, rs: 2 },
      { c: 2, r: 4 },
    ],
  },
  {
    id: 'strip3', name: '3 Strip', cols: 3, rows: 1,
    cells: [{ c: 1, r: 1 }, { c: 2, r: 1 }, { c: 3, r: 1 }],
  },
  {
    id: 'strip4', name: '4 Strip', cols: 4, rows: 1,
    cells: [{ c: 1, r: 1 }, { c: 2, r: 1 }, { c: 3, r: 1 }, { c: 4, r: 1 }],
  },
  {
    id: 'polaroid', name: 'Polaroid 4', cols: 2, rows: 2,
    cells: [
      { c: 1, r: 1 }, { c: 2, r: 1 },
      { c: 1, r: 2 }, { c: 2, r: 2 },
    ],
  },
];

export function dimensionsFor(aspect: string, baseSize: number): { w: number; h: number } {
  const r = ASPECT_RATIOS.find((x) => x.id === aspect) ?? { w: 1, h: 1 };
  if (r.w >= r.h) return { w: baseSize, h: Math.round((baseSize * r.h) / r.w) };
  return { w: Math.round((baseSize * r.w) / r.h), h: baseSize };
}

export function estimateFileSize(
  width: number,
  height: number,
  format: 'png' | 'jpg' | 'webp',
  quality: number,
): number {
  const px = width * height;
  if (format === 'png') return Math.round(px * 2.5);
  if (format === 'jpg') return Math.round(px * (0.08 + quality * 0.55));
  if (format === 'webp') return Math.round(px * (0.05 + quality * 0.35));
  return Math.round(px);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
