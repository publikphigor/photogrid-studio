import type { Action, Cell, GridConfig, PhotoGridState } from '@/types';
import { LAYOUT_PRESETS } from './presets';

let _id = 0;
export const uid = (p = 'c'): string => `${p}_${(++_id).toString(36)}`;

const blankCell = (col: number, row: number): Cell => ({
  id: uid(),
  colStart: col,
  rowStart: row,
  colSpan: 1,
  rowSpan: 1,
  image: null,
  fit: 'cover',
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  rotation: 0,
  filter: 'none',
  shape: 'rect',
  cellRadius: 0,
  cellBorder: 0,
  cellBorderColor: '#ffffff',
});

export function defaultState(): PhotoGridState {
  const preset = LAYOUT_PRESETS.find((p) => p.id === '2x2')!;
  return {
    container: {
      shape: 'rect',
      cornerRadius: 12,
      aspect: '1:1',
      bg: '#ffffff',
      bgTransparent: false,
      bgImage: null,
      bgImageFit: 'cover',
      padding: 16,
      gap: 8,
      borderWidth: 0,
      borderColor: '#0a0a0a',
    },
    grid: { cols: preset.cols, rows: preset.rows },
    cells: preset.cells.map((c) => ({
      ...blankCell(c.c, c.r),
      colSpan: c.cs ?? 1,
      rowSpan: c.rs ?? 1,
    })),
    selectedCellId: null,
    output: { format: 'png', quality: 0.92, scale: 2, baseSize: 1200, filename: 'photogrid' },
    canvas: { zoom: 1 },
  };
}

function rectsOverlap(a: Cell, b: Cell): boolean {
  const ax2 = a.colStart + a.colSpan;
  const ay2 = a.rowStart + a.rowSpan;
  const bx2 = b.colStart + b.colSpan;
  const by2 = b.rowStart + b.rowSpan;
  return a.colStart < bx2 && b.colStart < ax2 && a.rowStart < by2 && b.rowStart < ay2;
}

function findFreeSlot(
  cells: Cell[],
  grid: GridConfig,
  w: number,
  h: number,
  exclude?: string,
): { c: number; r: number } | null {
  const tentative = (c: number, r: number): Cell =>
    ({ id: '__tmp', colStart: c, rowStart: r, colSpan: w, rowSpan: h }) as Cell;
  for (let r = 1; r + h - 1 <= grid.rows; r++) {
    for (let c = 1; c + w - 1 <= grid.cols; c++) {
      const cand = tentative(c, r);
      const conflict = cells.some((o) => o.id !== exclude && rectsOverlap(o, cand));
      if (!conflict) return { c, r };
    }
  }
  return null;
}

/** Move overlapping cells out of the mover's path by relocating them to the
 *  next free slot, expanding the grid if necessary. Mover itself is not moved. */
function reflowAroundMover(
  cells: Cell[],
  grid: GridConfig,
  moverId: string,
): { cells: Cell[]; grid: GridConfig } {
  const mover = cells.find((c) => c.id === moverId);
  if (!mover) return { cells, grid };
  const overlaps = cells.filter((c) => c.id !== moverId && rectsOverlap(c, mover));
  if (!overlaps.length) return { cells, grid };
  let workGrid = grid;
  const stable = cells.filter(
    (c) => c.id !== moverId && !overlaps.some((o) => o.id === c.id),
  );
  const placed: Cell[] = [];
  for (const o of overlaps) {
    let slot = findFreeSlot([mover, ...stable, ...placed], workGrid, o.colSpan, o.rowSpan);
    let span = { cs: o.colSpan, rs: o.rowSpan };
    if (!slot && (o.colSpan > 1 || o.rowSpan > 1)) {
      slot = findFreeSlot([mover, ...stable, ...placed], workGrid, 1, 1);
      if (slot) span = { cs: 1, rs: 1 };
    }
    if (!slot) {
      workGrid = { ...workGrid, rows: workGrid.rows + 1 };
      slot = { c: 1, r: workGrid.rows };
      span = { cs: 1, rs: 1 };
    }
    placed.push({ ...o, colStart: slot.c, rowStart: slot.r, colSpan: span.cs, rowSpan: span.rs });
  }
  return { cells: [...stable, mover, ...placed], grid: workGrid };
}

function buildOccupancy(cells: Cell[], grid: GridConfig): boolean[] {
  const arr = new Array<boolean>(grid.cols * grid.rows).fill(false);
  for (const c of cells) {
    for (let r = c.rowStart; r < c.rowStart + c.rowSpan; r++) {
      for (let cc = c.colStart; cc < c.colStart + c.colSpan; cc++) {
        if (r >= 1 && r <= grid.rows && cc >= 1 && cc <= grid.cols) {
          arr[(r - 1) * grid.cols + (cc - 1)] = true;
        }
      }
    }
  }
  return arr;
}

export function reducer(state: PhotoGridState, action: Action): PhotoGridState {
  switch (action.type) {
    case 'REPLACE':
      return action.state;
    case 'SET_CONTAINER':
      return { ...state, container: { ...state.container, ...action.patch } };
    case 'SET_OUTPUT':
      return { ...state, output: { ...state.output, ...action.patch } };
    case 'SET_GRID': {
      const next: GridConfig = { ...state.grid, ...action.patch };
      // Drop cells that fall outside the new bounds.
      let cells = state.cells.filter(
        (c) =>
          c.colStart + c.colSpan - 1 <= next.cols && c.rowStart + c.rowSpan - 1 <= next.rows,
      );
      // Fill any uncovered grid slots with empty cells so the Layers panel
      // reflects the visible grid 1:1.
      const occ = buildOccupancy(cells, next);
      for (let r = 1; r <= next.rows; r++) {
        for (let c = 1; c <= next.cols; c++) {
          if (!occ[(r - 1) * next.cols + (c - 1)]) {
            cells = [...cells, blankCell(c, r)];
          }
        }
      }
      const selected = state.selectedCellId &&
        cells.some((c) => c.id === state.selectedCellId)
          ? state.selectedCellId
          : null;
      return { ...state, grid: next, cells, selectedCellId: selected };
    }
    case 'APPLY_PRESET': {
      const p = action.preset;
      const old = state.cells;
      const cells: Cell[] = p.cells.map((c, i) => ({
        ...blankCell(c.c, c.r),
        id: old[i]?.id ?? uid(),
        colSpan: c.cs ?? 1,
        rowSpan: c.rs ?? 1,
        image: old[i]?.image ?? null,
        fit: old[i]?.fit ?? 'cover',
        shape: old[i]?.shape ?? 'rect',
        cellRadius: old[i]?.cellRadius ?? 0,
        cellBorder: old[i]?.cellBorder ?? 0,
        cellBorderColor: old[i]?.cellBorderColor ?? '#ffffff',
      }));
      return { ...state, grid: { cols: p.cols, rows: p.rows }, cells, selectedCellId: null };
    }
    case 'ADD_CELL': {
      const occ = buildOccupancy(state.cells, state.grid);
      let placed: { c: number; r: number } | null = null;
      for (let r = 1; r <= state.grid.rows && !placed; r++) {
        for (let c = 1; c <= state.grid.cols && !placed; c++) {
          if (!occ[(r - 1) * state.grid.cols + (c - 1)]) placed = { c, r };
        }
      }
      const grid = { ...state.grid };
      if (!placed) {
        if (grid.cols <= grid.rows) {
          grid.cols += 1;
          placed = { c: grid.cols, r: 1 };
        } else {
          grid.rows += 1;
          placed = { c: 1, r: grid.rows };
        }
      }
      const newCell = blankCell(placed.c, placed.r);
      return { ...state, grid, cells: [...state.cells, newCell], selectedCellId: newCell.id };
    }
    case 'REMOVE_CELL':
      return {
        ...state,
        cells: state.cells.filter((c) => c.id !== action.id),
        selectedCellId: state.selectedCellId === action.id ? null : state.selectedCellId,
      };
    case 'UPDATE_CELL':
      return {
        ...state,
        cells: state.cells.map((c) => (c.id === action.id ? { ...c, ...action.patch } : c)),
      };
    case 'MOVE_CELL': {
      const cells = state.cells.map((c) => {
        if (c.id !== action.id) return c;
        const colStart = Math.max(1, Math.min(action.col, state.grid.cols - c.colSpan + 1));
        const rowStart = Math.max(1, Math.min(action.row, state.grid.rows - c.rowSpan + 1));
        return { ...c, colStart, rowStart };
      });
      const reflowed = reflowAroundMover(cells, state.grid, action.id);
      return { ...state, grid: reflowed.grid, cells: reflowed.cells };
    }
    case 'RESIZE_CELL': {
      const target = state.cells.find((c) => c.id === action.id);
      if (!target) return state;
      const colStart = Math.max(1, Math.min(action.colStart ?? target.colStart, state.grid.cols));
      const rowStart = Math.max(1, Math.min(action.rowStart ?? target.rowStart, state.grid.rows));
      const colSpan = Math.max(1, Math.min(action.colSpan, state.grid.cols - colStart + 1));
      const rowSpan = Math.max(1, Math.min(action.rowSpan, state.grid.rows - rowStart + 1));
      if (
        colSpan === target.colSpan &&
        rowSpan === target.rowSpan &&
        colStart === target.colStart &&
        rowStart === target.rowStart
      ) {
        return state;
      }
      const updated = state.cells.map((c) =>
        c.id === action.id ? { ...c, colStart, rowStart, colSpan, rowSpan } : c,
      );
      const reflowed = reflowAroundMover(updated, state.grid, action.id);
      return { ...state, grid: reflowed.grid, cells: reflowed.cells };
    }
    case 'MOVE_CELL_TO_CELL': {
      const a = state.cells.find((c) => c.id === action.sourceId);
      const b = state.cells.find((c) => c.id === action.targetId);
      if (!a || !b || a.id === b.id) return state;
      // Swap grid positions + spans, keeping each cell's image and styling.
      return {
        ...state,
        cells: state.cells.map((c) => {
          if (c.id === a.id) {
            return { ...c, colStart: b.colStart, rowStart: b.rowStart, colSpan: b.colSpan, rowSpan: b.rowSpan };
          }
          if (c.id === b.id) {
            return { ...c, colStart: a.colStart, rowStart: a.rowStart, colSpan: a.colSpan, rowSpan: a.rowSpan };
          }
          return c;
        }),
      };
    }
    case 'SWAP_CELLS': {
      const a = state.cells.find((c) => c.id === action.aId);
      const b = state.cells.find((c) => c.id === action.bId);
      if (!a || !b) return state;
      return {
        ...state,
        cells: state.cells.map((c) => {
          if (c.id === a.id) return { ...c, image: b.image, fit: b.fit, offsetX: 0, offsetY: 0, scale: 1, rotation: 0 };
          if (c.id === b.id) return { ...c, image: a.image, fit: a.fit, offsetX: 0, offsetY: 0, scale: 1, rotation: 0 };
          return c;
        }),
      };
    }
    case 'SELECT':
      return { ...state, selectedCellId: action.id };
    case 'SET_ZOOM':
      return { ...state, canvas: { ...state.canvas, zoom: action.zoom } };
    case 'FILL_FROM_FILES': {
      const imgs = [...action.images];
      const cells = state.cells.map((c) => {
        if (c.image || imgs.length === 0) return c;
        return { ...c, image: imgs.shift()! };
      });
      let { cols, rows } = state.grid;
      while (imgs.length > 0) {
        const occ = buildOccupancy(cells, { cols, rows });
        let placed: { c: number; r: number } | null = null;
        for (let r = 1; r <= rows && !placed; r++) {
          for (let c = 1; c <= cols && !placed; c++) {
            if (!occ[(r - 1) * cols + (c - 1)]) placed = { c, r };
          }
        }
        if (!placed) {
          if (cols <= rows) cols += 1;
          else rows += 1;
          continue;
        }
        cells.push({ ...blankCell(placed.c, placed.r), image: imgs.shift()! });
      }
      return { ...state, grid: { cols, rows }, cells };
    }
    case 'RESET':
      return defaultState();
    default:
      return state;
  }
}
