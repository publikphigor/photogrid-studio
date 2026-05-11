import type { CSSProperties } from 'react';
import type { ShapeId } from '@/types';

export interface ShapeDef {
  name: string;
  iconPath: string;
}

export const SHAPES: Record<ShapeId, ShapeDef> = {
  rect:          { name: 'Rectangle',     iconPath: 'M3 5h18v14H3z' },
  rounded:       { name: 'Rounded',       iconPath: 'M6 5h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z' },
  squircle:      { name: 'Squircle',      iconPath: 'M9 3h6a6 6 0 0 1 6 6v6a6 6 0 0 1-6 6H9a6 6 0 0 1-6-6V9a6 6 0 0 1 6-6z' },
  circle:        { name: 'Circle',        iconPath: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z' },
  oval:          { name: 'Oval',          iconPath: 'M12 6c5 0 9 2.7 9 6s-4 6-9 6-9-2.7-9-6 4-6 9-6z' },
  hexagon:       { name: 'Hexagon',       iconPath: 'M12 3l9 4.5v9L12 21l-9-4.5v-9z' },
  diamond:       { name: 'Diamond',       iconPath: 'M12 3l9 9-9 9-9-9z' },
  arch:          { name: 'Arch',          iconPath: 'M3 21V12a9 9 0 0 1 18 0v9z' },
  blob:          { name: 'Blob',          iconPath: 'M7 4c9-2 15 3 14 9-1 6-7 9-13 7-5-2-7-9-4-13z' },
  heart:         { name: 'Heart',         iconPath: 'M12 21C5 17 2 12 4 8c2-4 7-3 8 1 1-4 6-5 8-1 2 4-1 9-8 13z' },
  triangle:      { name: 'Triangle',      iconPath: 'M12 3l9 18H3z' },
  pentagon:      { name: 'Pentagon',      iconPath: 'M12 3l9 6.5L17.5 21h-11L3 9.5z' },
  octagon:       { name: 'Octagon',       iconPath: 'M9 3h6l6 6v6l-6 6H9l-6-6V9z' },
  star:          { name: 'Star',          iconPath: 'M12 3l2.7 5.6 6.3.9-4.5 4.4 1 6.3L12 17.3 6.4 20.2l1-6.3L3 9.5l6.3-.9z' },
  parallelogram: { name: 'Parallelogram', iconPath: 'M7 5h14l-4 14H3z' },
  chevron:       { name: 'Chevron',       iconPath: 'M3 5h13l5 7-5 7H3l5-7z' },
};

// clip-path doesn't play nicely with cell overflow + box-shadow border, so radius-based shapes use border-radius and others fall back to mask-image.
export function cellShapeCSS(shape: ShapeId, radiusPx: number): CSSProperties {
  return shapeCSS(shape, 0, 0, radiusPx);
}

export function shapeCSS(shape: ShapeId, _w: number, _h: number, radiusPx: number): CSSProperties {
  const out: CSSProperties = { clipPath: 'none', borderRadius: 0 };
  switch (shape) {
    case 'rect':
      out.borderRadius = 0; break;
    case 'rounded':
      out.borderRadius = `${Math.max(0, radiusPx)}px`; break;
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
    case 'triangle':
      out.clipPath = 'polygon(50% 0%, 100% 100%, 0% 100%)';
      break;
    case 'pentagon':
      out.clipPath = 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)';
      break;
    case 'octagon':
      out.clipPath =
        'polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)';
      break;
    case 'star':
      out.clipPath =
        'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)';
      break;
    case 'parallelogram':
      out.clipPath = 'polygon(20% 0%, 100% 0%, 80% 100%, 0% 100%)';
      break;
    case 'chevron':
      out.clipPath = 'polygon(0% 0%, 75% 0%, 100% 50%, 75% 100%, 0% 100%, 25% 50%)';
      break;
  }
  return out;
}
