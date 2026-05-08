import type { CSSProperties } from 'react';
import type { ShapeId } from '@/types';

export interface ShapeDef {
  name: string;
  /** SVG path/element used in the shape picker thumbnails. */
  iconPath: string;
}

export const SHAPES: Record<ShapeId, ShapeDef> = {
  rect:     { name: 'Rectangle', iconPath: 'M3 5h18v14H3z' },
  rounded:  { name: 'Rounded',   iconPath: 'M6 5h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z' },
  squircle: { name: 'Squircle',  iconPath: 'M9 3h6a6 6 0 0 1 6 6v6a6 6 0 0 1-6 6H9a6 6 0 0 1-6-6V9a6 6 0 0 1 6-6z' },
  circle:   { name: 'Circle',    iconPath: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z' },
  oval:     { name: 'Oval',      iconPath: 'M12 6c5 0 9 2.7 9 6s-4 6-9 6-9-2.7-9-6 4-6 9-6z' },
  hexagon:  { name: 'Hexagon',   iconPath: 'M12 3l9 4.5v9L12 21l-9-4.5v-9z' },
  diamond:  { name: 'Diamond',   iconPath: 'M12 3l9 9-9 9-9-9z' },
  arch:     { name: 'Arch',      iconPath: 'M3 21V12a9 9 0 0 1 18 0v9z' },
  blob:     { name: 'Blob',      iconPath: 'M7 4c9-2 15 3 14 9-1 6-7 9-13 7-5-2-7-9-4-13z' },
  heart:    { name: 'Heart',     iconPath: 'M12 21C5 17 2 12 4 8c2-4 7-3 8 1 1-4 6-5 8-1 2 4-1 9-8 13z' },
};

/**
 * CSS for a per-cell shape. We can't always rely on `clip-path` on grid items
 * (it interacts oddly with the cell's overflow:hidden + box-shadow border), so
 * shapes that are pure border-radius use that and the rest fall back to
 * mask-image for crisp edges.
 */
export function cellShapeCSS(shape: ShapeId, radiusPct: number): CSSProperties {
  // For 'rounded' the radius slider drives it; for other shapes radius is ignored.
  return shapeCSS(shape, 0, 0, radiusPct);
}

export function shapeCSS(shape: ShapeId, _w: number, _h: number, radiusPct: number): CSSProperties {
  const out: CSSProperties = { clipPath: 'none', borderRadius: 0 };
  switch (shape) {
    case 'rect':
      out.borderRadius = 0; break;
    case 'rounded':
      out.borderRadius = `${radiusPct}%`; break;
    case 'squircle':
      out.borderRadius = '32% / 32%'; break;
    case 'circle':
    case 'oval':
      out.borderRadius = '50%'; break;
    case 'hexagon':
      out.clipPath = 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)';
      break;
    case 'diamond':
      out.clipPath = 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)';
      break;
    case 'arch': {
      const r = `min(50%, 50%)`;
      out.borderRadius = `${r} ${r} 0 0`;
      break;
    }
    case 'blob':
      out.borderRadius = '62% 38% 70% 30% / 32% 60% 40% 68%';
      break;
    case 'heart': {
      const svg =
        "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'><path d='M50,92 C18,74 4,46 18,24 C30,6 50,12 50,32 C50,12 70,6 82,24 C96,46 82,74 50,92 Z' fill='black'/></svg>\")";
      out.WebkitMaskImage = svg;
      out.maskImage = svg;
      out.WebkitMaskSize = '100% 100%';
      out.maskSize = '100% 100%';
      out.WebkitMaskRepeat = 'no-repeat';
      out.maskRepeat = 'no-repeat';
      break;
    }
  }
  return out;
}
