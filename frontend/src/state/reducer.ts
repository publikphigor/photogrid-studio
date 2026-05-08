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
  fit: 'native',
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  rotation: 0,
  filter: 'none',
  shape: 'rect',
  cellRadius: 0,
  cellBorder: 0,
  cellBorderColor: '#ffffff',
  dx: 0,
  dy: 0,
  dw: 0,
  dh: 0,
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

/** Track-weight floor in fr-units. Below this, a track's pixel width gets so
 *  small the cell becomes unrecoverable, so we stop the drag here. */
export const MIN_TRACK_FR = 0.15;

export function trackSizes(sizes: number[] | undefined, n: number): number[] {
  if (!sizes || sizes.length !== n) return new Array(n).fill(1);
  return sizes;
}

/** Pixel width/height of a cell in design space, given its grid coords and
 *  current track weights. Returns zeros if any input is degenerate. */
export function cellPixelSize(
  cell: Pick<Cell, 'colStart' | 'rowStart' | 'colSpan' | 'rowSpan'>,
  grid: GridConfig,
  innerW: number,
  innerH: number,
  gap: number,
): { w: number; h: number } {
  const colW = trackSizes(grid.colSizes, grid.cols);
  const rowH = trackSizes(grid.rowSizes, grid.rows);
  const totalCol = colW.reduce((a, b) => a + b, 0) || 1;
  const totalRow = rowH.reduce((a, b) => a + b, 0) || 1;
  let w = 0;
  for (let i = cell.colStart - 1; i < cell.colStart - 1 + cell.colSpan && i < colW.length; i++) {
    w += (colW[i] / totalCol) * innerW;
  }
  w += gap * (cell.colSpan - 1);
  let h = 0;
  for (let i = cell.rowStart - 1; i < cell.rowStart - 1 + cell.rowSpan && i < rowH.length; i++) {
    h += (rowH[i] / totalRow) * innerH;
  }
  h += gap * (cell.rowSpan - 1);
  return { w, h };
}

/** Cell rectangle in design pixels, accounting for both the grid-computed box
 *  and any per-cell pixel offsets (`dx/dy/dw/dh`). The frontend renders cells
 *  using these coords with `position: absolute` so each cell can be shifted
 *  independently without affecting other rows or columns. */
export function computeCellRect(
  cell: Cell,
  grid: GridConfig,
  innerW: number,
  innerH: number,
  padding: number,
  gap: number,
): { x: number; y: number; w: number; h: number } {
  const colW = trackSizes(grid.colSizes, grid.cols);
  const rowH = trackSizes(grid.rowSizes, grid.rows);
  const totalCol = colW.reduce((a, b) => a + b, 0) || 1;
  const totalRow = rowH.reduce((a, b) => a + b, 0) || 1;
  let x = padding;
  for (let i = 0; i < cell.colStart - 1 && i < colW.length; i++) {
    x += (colW[i] / totalCol) * innerW + gap;
  }
  let y = padding;
  for (let i = 0; i < cell.rowStart - 1 && i < rowH.length; i++) {
    y += (rowH[i] / totalRow) * innerH + gap;
  }
  let w = 0;
  for (let i = cell.colStart - 1; i < cell.colStart - 1 + cell.colSpan && i < colW.length; i++) {
    w += (colW[i] / totalCol) * innerW;
  }
  w += gap * (cell.colSpan - 1);
  let h = 0;
  for (let i = cell.rowStart - 1; i < cell.rowStart - 1 + cell.rowSpan && i < rowH.length; i++) {
    h += (rowH[i] / totalRow) * innerH;
  }
  h += gap * (cell.rowSpan - 1);
  return {
    x: x + (cell.dx ?? 0),
    y: y + (cell.dy ?? 0),
    w: Math.max(1, w + (cell.dw ?? 0)),
    h: Math.max(1, h + (cell.dh ?? 0)),
  };
}

/** Cells whose left/right/top/bottom edge sits exactly on `mover`'s opposite
 *  edge (in grid coords) AND whose perpendicular range is fully contained in
 *  `mover`'s. Used by edge resize handles to find the cells that must shift
 *  to keep the boundary tight. */
export function edgeNeighbors(
  mover: Cell,
  cells: Cell[],
  side: 'e' | 'w' | 'n' | 's',
): Cell[] {
  return cells.filter((c) => {
    if (c.id === mover.id) return false;
    if (side === 'e') {
      if (c.colStart !== mover.colStart + mover.colSpan) return false;
      return c.rowStart >= mover.rowStart && c.rowStart + c.rowSpan <= mover.rowStart + mover.rowSpan;
    }
    if (side === 'w') {
      if (c.colStart + c.colSpan !== mover.colStart) return false;
      return c.rowStart >= mover.rowStart && c.rowStart + c.rowSpan <= mover.rowStart + mover.rowSpan;
    }
    if (side === 's') {
      if (c.rowStart !== mover.rowStart + mover.rowSpan) return false;
      return c.colStart >= mover.colStart && c.colStart + c.colSpan <= mover.colStart + mover.colSpan;
    }
    // 'n'
    if (c.rowStart + c.rowSpan !== mover.rowStart) return false;
    return c.colStart >= mover.colStart && c.colStart + c.colSpan <= mover.colStart + mover.colSpan;
  });
}

/** Cover-fit scale that makes a freshly-uploaded image just fill the cell.
 *  User can then drag/scale freely from this baseline. */
export function coverFitScale(cellW: number, cellH: number, imgW: number, imgH: number): number {
  if (!imgW || !imgH || !cellW || !cellH) return 1;
  return Math.max(cellW / imgW, cellH / imgH);
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
 *  next free slot. When `allowGrow` is false, returns null if any displaced
 *  cell can't be placed within the existing grid (caller treats this as a
 *  rejected move). Mover itself is not moved. */
function reflowAroundMover(
  cells: Cell[],
  grid: GridConfig,
  moverId: string,
  allowGrow: boolean,
): { cells: Cell[]; grid: GridConfig } | null {
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
      if (!allowGrow) return null;
      workGrid = { ...workGrid, rows: workGrid.rows + 1 };
      slot = { c: 1, r: workGrid.rows };
      span = { cs: 1, rs: 1 };
    }
    placed.push({ ...o, colStart: slot.c, rowStart: slot.r, colSpan: span.cs, rowSpan: span.rs });
  }
  return { cells: [...stable, mover, ...placed], grid: workGrid };
}

/** After a cell is removed, try to absorb the freed area so no whitespace
 *  is left. Strategy:
 *    1. If a column or row band the cell occupied is now entirely empty, drop
 *       those tracks (and shift the remaining cells / colSizes / rowSizes).
 *    2. Otherwise, if a neighbor's row band exactly matches the removed cell's
 *       row band and they're horizontally adjacent, expand the neighbor across
 *       the freed columns. Same trick for vertical adjacency.
 *  When neither applies we leave the gap (the layout is too irregular for an
 *  obvious absorption). */
function compactAfterRemoval(
  cells: Cell[],
  grid: GridConfig,
  removed: Cell,
): { cells: Cell[]; grid: GridConfig } {
  // ---- Strategy 1: drop empty tracks --------------------------------------
  const emptyCols: number[] = [];
  for (let c = removed.colStart; c < removed.colStart + removed.colSpan; c++) {
    const occupied = cells.some(
      (o) => c >= o.colStart && c < o.colStart + o.colSpan,
    );
    if (!occupied) emptyCols.push(c);
  }
  const emptyRows: number[] = [];
  for (let r = removed.rowStart; r < removed.rowStart + removed.rowSpan; r++) {
    const occupied = cells.some(
      (o) => r >= o.rowStart && r < o.rowStart + o.rowSpan,
    );
    if (!occupied) emptyRows.push(r);
  }

  let workCells = cells;
  let nextGrid: GridConfig = { ...grid };
  if (emptyCols.length > 0 && nextGrid.cols - emptyCols.length >= 1) {
    const drop = new Set(emptyCols);
    const colW = trackSizes(nextGrid.colSizes, nextGrid.cols);
    const newColSizes = colW.filter((_, idx) => !drop.has(idx + 1));
    workCells = workCells.map((cell) => {
      let colStart = cell.colStart;
      let colSpan = cell.colSpan;
      // Shift colStart left by the count of dropped tracks before it.
      for (const ec of emptyCols) {
        if (ec < colStart) colStart -= 1;
        else if (ec >= colStart && ec < colStart + colSpan) colSpan -= 1;
      }
      return { ...cell, colStart: Math.max(1, colStart), colSpan: Math.max(1, colSpan) };
    });
    nextGrid = { ...nextGrid, cols: nextGrid.cols - emptyCols.length, colSizes: newColSizes };
  }
  if (emptyRows.length > 0 && nextGrid.rows - emptyRows.length >= 1) {
    const drop = new Set(emptyRows);
    const rowH = trackSizes(nextGrid.rowSizes, nextGrid.rows);
    const newRowSizes = rowH.filter((_, idx) => !drop.has(idx + 1));
    workCells = workCells.map((cell) => {
      let rowStart = cell.rowStart;
      let rowSpan = cell.rowSpan;
      for (const er of emptyRows) {
        if (er < rowStart) rowStart -= 1;
        else if (er >= rowStart && er < rowStart + rowSpan) rowSpan -= 1;
      }
      return { ...cell, rowStart: Math.max(1, rowStart), rowSpan: Math.max(1, rowSpan) };
    });
    nextGrid = { ...nextGrid, rows: nextGrid.rows - emptyRows.length, rowSizes: newRowSizes };
  }
  if (emptyCols.length > 0 || emptyRows.length > 0) {
    return { cells: workCells, grid: nextGrid };
  }

  // ---- Strategy 2: expand a neighbor with matching band -------------------
  const sameRow = (c: Cell) =>
    c.rowStart === removed.rowStart && c.rowSpan === removed.rowSpan;
  const sameCol = (c: Cell) =>
    c.colStart === removed.colStart && c.colSpan === removed.colSpan;
  const left = cells.find((c) => sameRow(c) && c.colStart + c.colSpan === removed.colStart);
  if (left) {
    return {
      cells: cells.map((c) =>
        c.id === left.id ? { ...c, colSpan: c.colSpan + removed.colSpan } : c,
      ),
      grid,
    };
  }
  const right = cells.find((c) => sameRow(c) && c.colStart === removed.colStart + removed.colSpan);
  if (right) {
    return {
      cells: cells.map((c) =>
        c.id === right.id
          ? { ...c, colStart: removed.colStart, colSpan: c.colSpan + removed.colSpan }
          : c,
      ),
      grid,
    };
  }
  const top = cells.find((c) => sameCol(c) && c.rowStart + c.rowSpan === removed.rowStart);
  if (top) {
    return {
      cells: cells.map((c) =>
        c.id === top.id ? { ...c, rowSpan: c.rowSpan + removed.rowSpan } : c,
      ),
      grid,
    };
  }
  const bottom = cells.find((c) => sameCol(c) && c.rowStart === removed.rowStart + removed.rowSpan);
  if (bottom) {
    return {
      cells: cells.map((c) =>
        c.id === bottom.id
          ? { ...c, rowStart: removed.rowStart, rowSpan: c.rowSpan + removed.rowSpan }
          : c,
      ),
      grid,
    };
  }

  return { cells, grid };
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
      // Track weights must always match cols/rows; reset on dimension changes.
      next.colSizes = next.cols === state.grid.cols ? state.grid.colSizes : undefined;
      next.rowSizes = next.rows === state.grid.rows ? state.grid.rowSizes : undefined;
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
        fit: old[i]?.fit ?? 'native',
        shape: old[i]?.shape ?? 'rect',
        cellRadius: old[i]?.cellRadius ?? 0,
        cellBorder: old[i]?.cellBorder ?? 0,
        cellBorderColor: old[i]?.cellBorderColor ?? '#ffffff',
      }));
      return { ...state, grid: { cols: p.cols, rows: p.rows }, cells, selectedCellId: null };
    }
    case 'EDGE_RESIZE': {
      const map = new Map(action.updates.map((u) => [u.id, u]));
      const cells = state.cells.map((c) => {
        const u = map.get(c.id);
        if (!u) return c;
        return {
          ...c,
          dx: u.dx ?? c.dx ?? 0,
          dy: u.dy ?? c.dy ?? 0,
          dw: u.dw ?? c.dw ?? 0,
          dh: u.dh ?? c.dh ?? 0,
        };
      });
      return { ...state, cells };
    }
    case 'RESIZE_TRACKS': {
      const grid: GridConfig = { ...state.grid };
      const clamp = (sizes: number[]): number[] =>
        sizes.map((s) => (s < MIN_TRACK_FR ? MIN_TRACK_FR : s));
      if (action.colSizes && action.colSizes.length === grid.cols) {
        grid.colSizes = clamp(action.colSizes);
      }
      if (action.rowSizes && action.rowSizes.length === grid.rows) {
        grid.rowSizes = clamp(action.rowSizes);
      }
      return { ...state, grid };
    }
    case 'ADD_CELL': {
      const occ = buildOccupancy(state.cells, state.grid);
      let placed: { c: number; r: number } | null = null;
      for (let r = 1; r <= state.grid.rows && !placed; r++) {
        for (let c = 1; c <= state.grid.cols && !placed; c++) {
          if (!occ[(r - 1) * state.grid.cols + (c - 1)]) placed = { c, r };
        }
      }
      const grid: GridConfig = { ...state.grid };
      if (!placed) {
        // Grid grew to accommodate the new cell. Extend the matching size
        // array with the average existing weight so the new track lines up
        // proportionally with the others (instead of snapping to 1fr and
        // looking out of place when neighbors have been resized).
        if (grid.cols <= grid.rows) {
          const cw = trackSizes(grid.colSizes, grid.cols);
          const avg = cw.length ? cw.reduce((a, b) => a + b, 0) / cw.length : 1;
          grid.cols += 1;
          grid.colSizes = [...cw, avg];
          placed = { c: grid.cols, r: 1 };
        } else {
          const rh = trackSizes(grid.rowSizes, grid.rows);
          const avg = rh.length ? rh.reduce((a, b) => a + b, 0) / rh.length : 1;
          grid.rows += 1;
          grid.rowSizes = [...rh, avg];
          placed = { c: 1, r: grid.rows };
        }
      }
      const newCell = blankCell(placed.c, placed.r);
      return { ...state, grid, cells: [...state.cells, newCell], selectedCellId: newCell.id };
    }
    case 'REMOVE_CELL': {
      const removed = state.cells.find((c) => c.id === action.id);
      if (!removed) return state;
      const remaining = state.cells.filter((c) => c.id !== action.id);
      const compacted = compactAfterRemoval(remaining, state.grid, removed);
      return {
        ...state,
        cells: compacted.cells,
        grid: compacted.grid,
        selectedCellId: state.selectedCellId === action.id ? null : state.selectedCellId,
      };
    }
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
      const reflowed = reflowAroundMover(cells, state.grid, action.id, true);
      if (!reflowed) return state;
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
      // Resize never grows the grid; reject if displaced cells can't be relocated
      // within the current bounds (the user's drag stops at that boundary).
      const reflowed = reflowAroundMover(updated, state.grid, action.id, false);
      if (!reflowed) return state;
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
    case 'FILL_EMPTY_NO_GROW': {
      // Place each image into the next empty cell in row-major order.
      // Surplus images are discarded (no grid growth).
      const imgs = [...action.images];
      if (!imgs.length) return state;
      const cells = state.cells.map((c) => {
        if (c.image || imgs.length === 0) return c;
        return { ...c, image: imgs.shift()!, offsetX: 0, offsetY: 0, scale: 1 };
      });
      return { ...state, cells };
    }
    case 'RESET':
      return defaultState();
    default:
      return state;
  }
}
