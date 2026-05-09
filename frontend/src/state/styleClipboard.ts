import type { Cell, CellFilters } from '@/types';

/** Subset of `Cell` that the copy-style action captures. Image and grid
 *  position are intentionally excluded — the user copies look-and-feel, not
 *  content or layout. */
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

/** Module-scoped clipboard. Lives only for the current page session — paste
 *  is disabled across reloads on purpose, so a stale style from a prior
 *  session never sneaks into a new template. Subscribers re-render when the
 *  buffer changes (set/clear) so the context menu can show "Paste style"
 *  only when there's something to paste. */
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
