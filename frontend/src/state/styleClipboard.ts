import type { Cell, CellFilters } from '@/types';

// Look-and-feel only; image and grid position deliberately excluded.
export interface CellStyle {
  fit: Cell['fit'];
  scale: number;
  rotation: number;
  filter: string;
  filters?: CellFilters;
  shape: Cell['shape'];
  cellRadius: number;
  cellBorder: number;
  cellBorderColor: string;
}

// Session-only; never persisted so a stale style can't leak into a new template.
let buffer: CellStyle | null = null;
const subscribers = new Set<() => void>();

export const StyleClipboard = {
  copy(cell: Cell): void {
    buffer = {
      fit: cell.fit,
      scale: cell.scale,
      rotation: cell.rotation,
      filter: cell.filter,
      filters: cell.filters,
      shape: cell.shape,
      cellRadius: cell.cellRadius,
      cellBorder: cell.cellBorder,
      cellBorderColor: cell.cellBorderColor,
    };
    for (const sub of subscribers) sub();
  },
  peek(): CellStyle | null {
    return buffer;
  },
  clear(): void {
    buffer = null;
    for (const sub of subscribers) sub();
  },
  subscribe(fn: () => void): () => void {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  },
};
