import type { Action, Cell, GridConfig, PhotoGridState, ShapeId } from '@/types';
import { ASPECT_RATIOS, LAYOUT_PRESETS, dimensionsFor } from './presets';

let _id = 0;
export const uid = (p = 'c'): string => `${p}_${(++_id).toString(36)}`;

/** Short, session-unique export filename — e.g. PG_l3k7q. The base36 timestamp
 *  changes every second, which is short enough to read at a glance and unique
 *  enough that the same session won't generate collisions in normal use.
 *  Calling sites should regenerate this on RESET / REPLACE so each new
 *  session/template starts with its own name. */
export function generateFilename(): string {
  return `PG_${Math.floor(Date.now() / 1000).toString(36)}`;
}

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
    selectedCellIds: [],
    output: { format: 'png', quality: 0.92, scale: 2, baseSize: 1200, filename: generateFilename() },
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
 *  is left. Strategy, in order:
 *    1. If a column or row band the cell occupied is now entirely empty, drop
 *       those tracks (and shift the remaining cells / colSizes / rowSizes).
 *    2. Otherwise, if a neighbor's row band exactly matches the removed cell's
 *       row band and they're horizontally adjacent, expand the neighbor across
 *       the freed columns. Same trick for vertical adjacency.
 *    3. Fall back to extending an adjacent cell's per-cell pixel offsets so it
 *       visually covers the freed pixel rect (for irregular layouts where the
 *       grid-coord strategies don't apply). */
function compactAfterRemoval(
  cells: Cell[],
  grid: GridConfig,
  removed: Cell,
  containerPadding: number,
  containerGap: number,
  designW: number,
  designH: number,
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

  // ---- Strategy 3: extend an adjacent cell via pixel offsets --------------
  // Compute the freed pixel rect (using grid coords pre-removal) and the rects
  // of all remaining cells. Pick the candidate adjacent cell that shares the
  // longest pixel-edge with the freed rect and extend its dx/dy/dw/dh to
  // visually swallow the freed area.
  const innerW = designW - containerPadding * 2 - containerGap * (grid.cols - 1);
  const innerH = designH - containerPadding * 2 - containerGap * (grid.rows - 1);
  const removedRect = computeCellRect(removed, grid, innerW, innerH, containerPadding, containerGap);
  const cellRects = cells.map((c) => ({
    cell: c,
    rect: computeCellRect(c, grid, innerW, innerH, containerPadding, containerGap),
  }));

  type Candidate = {
    cell: Cell;
    side: 'e' | 'w' | 's' | 'n';
    sharedEdge: number;
    /** The cell's pixel rect after extension. */
    extended: { x: number; y: number; w: number; h: number };
  };
  const candidates: Candidate[] = [];
  const EPS = 1.5;
  const spanH = removedRect.w + containerGap;
  const spanV = removedRect.h + containerGap;
  for (const { cell, rect } of cellRects) {
    // East-side candidate: cell sits left of removed
    if (Math.abs(rect.x + rect.w + containerGap - removedRect.x) < EPS) {
      const overlap = Math.min(rect.y + rect.h, removedRect.y + removedRect.h) - Math.max(rect.y, removedRect.y);
      if (overlap > 0) {
        candidates.push({
          cell, side: 'e', sharedEdge: overlap,
          extended: { x: rect.x, y: rect.y, w: rect.w + spanH, h: rect.h },
        });
      }
    }
    // West-side candidate: cell sits right of removed
    if (Math.abs(removedRect.x + removedRect.w + containerGap - rect.x) < EPS) {
      const overlap = Math.min(rect.y + rect.h, removedRect.y + removedRect.h) - Math.max(rect.y, removedRect.y);
      if (overlap > 0) {
        candidates.push({
          cell, side: 'w', sharedEdge: overlap,
          extended: { x: rect.x - spanH, y: rect.y, w: rect.w + spanH, h: rect.h },
        });
      }
    }
    // South-side candidate: cell sits above removed
    if (Math.abs(rect.y + rect.h + containerGap - removedRect.y) < EPS) {
      const overlap = Math.min(rect.x + rect.w, removedRect.x + removedRect.w) - Math.max(rect.x, removedRect.x);
      if (overlap > 0) {
        candidates.push({
          cell, side: 's', sharedEdge: overlap,
          extended: { x: rect.x, y: rect.y, w: rect.w, h: rect.h + spanV },
        });
      }
    }
    // North-side candidate: cell sits below removed
    if (Math.abs(removedRect.y + removedRect.h + containerGap - rect.y) < EPS) {
      const overlap = Math.min(rect.x + rect.w, removedRect.x + removedRect.w) - Math.max(rect.x, removedRect.x);
      if (overlap > 0) {
        candidates.push({
          cell, side: 'n', sharedEdge: overlap,
          extended: { x: rect.x, y: rect.y - spanV, w: rect.w, h: rect.h + spanV },
        });
      }
    }
  }

  // Reject candidates whose extension would overlap any other cell's rect
  // (other than the candidate itself). Better to leave whitespace than to
  // visually clobber a sibling cell.
  const overlapsOther = (cand: Candidate) =>
    cellRects.some(({ cell, rect }) => {
      if (cell.id === cand.cell.id) return false;
      return (
        cand.extended.x < rect.x + rect.w &&
        cand.extended.x + cand.extended.w > rect.x &&
        cand.extended.y < rect.y + rect.h &&
        cand.extended.y + cand.extended.h > rect.y
      );
    });
  const safe = candidates.filter((c) => !overlapsOther(c));
  if (safe.length === 0) {
    return { cells, grid };
  }
  safe.sort((a, b) => b.sharedEdge - a.sharedEdge);
  const best = safe[0];
  return {
    cells: cells.map((c) => {
      if (c.id !== best.cell.id) return c;
      switch (best.side) {
        case 'e':
          return { ...c, dw: (c.dw ?? 0) + spanH };
        case 'w':
          return { ...c, dx: (c.dx ?? 0) - spanH, dw: (c.dw ?? 0) + spanH };
        case 's':
          return { ...c, dh: (c.dh ?? 0) + spanV };
        case 'n':
          return { ...c, dy: (c.dy ?? 0) - spanV, dh: (c.dh ?? 0) + spanV };
      }
    }),
    grid,
  };
}

/** Translate a point in design pixel space to a grid (col, row) tuple, using
 *  current track widths and gap. Returns null if the point lies outside the
 *  inner canvas. Then expands outwards from that slot to find the largest
 *  empty rectangle that contains it (used for "drop on whitespace" UX). */
export function pointToGridSlot(
  px: number,
  py: number,
  padding: number,
  gap: number,
  designW: number,
  designH: number,
  grid: GridConfig,
  cells: Cell[],
): { c: number; r: number; cs: number; rs: number } | null {
  if (px < padding || py < padding || px > designW - padding || py > designH - padding) {
    return null;
  }
  const innerW = designW - padding * 2 - gap * (grid.cols - 1);
  const innerH = designH - padding * 2 - gap * (grid.rows - 1);
  const colW = trackSizes(grid.colSizes, grid.cols);
  const rowH = trackSizes(grid.rowSizes, grid.rows);
  const totalCol = colW.reduce((a, b) => a + b, 0) || 1;
  const totalRow = rowH.reduce((a, b) => a + b, 0) || 1;
  // Walk track boundaries left-to-right.
  let acc = padding;
  let col = 0;
  for (let i = 0; i < grid.cols; i += 1) {
    const w = (colW[i] / totalCol) * innerW;
    if (px <= acc + w) { col = i + 1; break; }
    acc += w + gap;
    col = i + 2;
  }
  if (col > grid.cols) col = grid.cols;
  acc = padding;
  let row = 0;
  for (let i = 0; i < grid.rows; i += 1) {
    const h = (rowH[i] / totalRow) * innerH;
    if (py <= acc + h) { row = i + 1; break; }
    acc += h + gap;
    row = i + 2;
  }
  if (row > grid.rows) row = grid.rows;
  // If the slot is occupied, no whitespace there.
  const occ = buildOccupancy(cells, grid);
  if (occ[(row - 1) * grid.cols + (col - 1)]) return null;
  // Expand outward from (col, row) to find the maximal empty rectangle.
  let c1 = col;
  while (c1 - 1 >= 1 && !occ[(row - 1) * grid.cols + (c1 - 2)]) c1 -= 1;
  let c2 = col;
  while (c2 + 1 <= grid.cols && !occ[(row - 1) * grid.cols + c2]) c2 += 1;
  let r1 = row;
  rowUp: while (r1 - 1 >= 1) {
    for (let cc = c1; cc <= c2; cc += 1) {
      if (occ[(r1 - 2) * grid.cols + (cc - 1)]) break rowUp;
    }
    r1 -= 1;
  }
  let r2 = row;
  rowDown: while (r2 + 1 <= grid.rows) {
    for (let cc = c1; cc <= c2; cc += 1) {
      if (occ[r2 * grid.cols + (cc - 1)]) break rowDown;
    }
    r2 += 1;
  }
  return { c: c1, r: r1, cs: c2 - c1 + 1, rs: r2 - r1 + 1 };
}

/** Find the largest rectangular empty region in the current grid (in grid
 *  coords). Returns null when no empty slot exists. Used by ADD_CELL so a new
 *  cell automatically fills the biggest whitespace instead of dropping into
 *  the first row-major empty slot. */
export function findMaxEmptyRect(
  cells: Cell[],
  grid: GridConfig,
): { c: number; r: number; cs: number; rs: number } | null {
  const occ = buildOccupancy(cells, grid);
  let best: { c: number; r: number; cs: number; rs: number } | null = null;
  let bestArea = 0;
  for (let r = 1; r <= grid.rows; r++) {
    for (let c = 1; c <= grid.cols; c++) {
      if (occ[(r - 1) * grid.cols + (c - 1)]) continue;
      // Maximum width starting at (c, r) — empty span on this row.
      let maxC = c;
      while (maxC + 1 <= grid.cols && !occ[(r - 1) * grid.cols + maxC]) maxC += 1;
      // For each candidate end-col, find how far down the rectangle stays empty.
      for (let endC = c; endC <= maxC; endC += 1) {
        let endR = r;
        rowLoop: while (endR + 1 <= grid.rows) {
          for (let cc = c; cc <= endC; cc += 1) {
            if (occ[endR * grid.cols + (cc - 1)]) break rowLoop;
          }
          endR += 1;
        }
        const cs = endC - c + 1;
        const rs = endR - r + 1;
        const area = cs * rs;
        if (area > bestArea) {
          bestArea = area;
          best = { c, r, cs, rs };
        }
      }
    }
  }
  return best;
}

/** Snap every cell to a clean integer-track grid:
 *
 *  Strategy: zero each cell's per-cell pixel offsets so their on-screen rect
 *  collapses back to the box defined by their grid coords + the current track
 *  weights. After this every cell occupies an integer number of columns/rows
 *  again, so vertical and horizontal borders align between rows.
 *
 *  Track weights (`colSizes`/`rowSizes`) are preserved — corner-drag
 *  redistributions (which are still a clean "everything in this column is
 *  this fraction wide") survive. Edge-drag tweaks, which can give different
 *  rows different boundaries, are flattened.
 *
 *  After snapping we run the whitespace absorber repeatedly so empty
 *  rectangles get swallowed by an adjacent cell. */
export function alignGrid(
  state: PhotoGridState,
  padding: number,
  gap: number,
  designW: number,
  designH: number,
): PhotoGridState {
  if (!state.cells.length) return state;
  // 1. Zero every per-cell pixel offset. Each cell's rect now equals its
  //    grid-track box; cells in the same column share a single x-boundary
  //    and likewise for rows.
  let cells: Cell[] = state.cells.map((c) => ({
    ...c, dx: 0, dy: 0, dw: 0, dh: 0,
  }));

  // 2. Resolve overlaps that may have appeared because two cells'
  //    pixel-offset rects had been carved up between them. Shrink the later
  //    cell until it doesn't overlap; if it can't shrink further, drop it.
  const placed: Cell[] = [];
  for (const c of cells) {
    let cur = c;
    let safety = 8;
    while (safety > 0 && placed.some((p) => rectsOverlap(p, cur))) {
      safety -= 1;
      if (cur.colSpan > 1) cur = { ...cur, colSpan: cur.colSpan - 1 };
      else if (cur.rowSpan > 1) cur = { ...cur, rowSpan: cur.rowSpan - 1 };
      else { cur = null as unknown as Cell; break; }
    }
    if (cur) placed.push(cur);
  }
  cells = placed;

  let nextState: PhotoGridState = { ...state, cells };

  // Whitespace absorber: for every empty rectangular region left in the grid,
  // run compactAfterRemoval against a synthetic "removed" cell sized to that
  // region so the existing strategies (drop tracks / expand neighbor / pixel
  // offset) collapse it.
  let absorberSafety = nextState.grid.cols * nextState.grid.rows + 4;
  while (absorberSafety > 0) {
    absorberSafety -= 1;
    const empty = findMaxEmptyRect(nextState.cells, nextState.grid);
    if (!empty) break;
    // Build a phantom cell representing the empty rect so compactAfterRemoval
    // can absorb it.
    const phantom: Cell = {
      ...blankCell(empty.c, empty.r),
      colSpan: empty.cs,
      rowSpan: empty.rs,
    };
    const result = compactAfterRemoval(
      nextState.cells,
      nextState.grid,
      phantom,
      padding,
      gap,
      designW,
      designH,
    );
    if (
      result.cells === nextState.cells &&
      result.grid === nextState.grid
    ) {
      // No strategy applied; stop to avoid an infinite loop.
      break;
    }
    nextState = { ...nextState, cells: result.cells, grid: result.grid };
  }
  return nextState;
}

/** A "mood" is a creative parameter bundle that the random-layout generator
 *  picks from. Each one gives the canvas a recognizable feel (matted print,
 *  bento board, geometric collage, …) so re-clicking "Generate" actually
 *  produces visibly different results instead of one-style-with-jitter.
 *
 *  - `containerShapes` / `aspects`: the outer canvas variations.
 *  - `cellShapes`: the per-cell shape pool; a uniform random pick per cell.
 *  - `gap` / `padding`: a `[min, max]` pixel range that's later jittered.
 *  - `cellRadiusRange` / `containerRadiusRange`: percentage ranges for the
 *    rounded variants. */
interface RandomMood {
  containerShapes: ShapeId[];
  aspects: string[];
  cellShapes: ShapeId[];
  gap: [number, number];
  padding: [number, number];
  cellRadiusRange: [number, number];
  containerRadiusRange: [number, number];
}

const ALL_ASPECTS = ASPECT_RATIOS.map((a) => a.id);
const RECT_FAMILY: ShapeId[] = ['rect'];
const ORGANIC_FAMILY: ShapeId[] = ['circle', 'oval', 'heart', 'blob', 'arch'];
const GEOMETRIC_FAMILY: ShapeId[] = [
  'hexagon',
  'diamond',
  'pentagon',
  'octagon',
  'triangle',
];
const ALL_SHAPES: ShapeId[] = [
  'rect',
  'rounded',
  'squircle',
  'circle',
  'oval',
  'hexagon',
  'diamond',
  'arch',
  'blob',
  'heart',
  'triangle',
  'pentagon',
  'octagon',
  'star',
  'parallelogram',
  'chevron',
];

const MOODS: RandomMood[] = [
  // "Bento": rounded rects with breathing room.
  {
    containerShapes: ['rect', 'rounded'],
    aspects: ['1:1', '4:5', '4:3'],
    cellShapes: ['rect', 'rounded', 'squircle'],
    gap: [12, 24],
    padding: [16, 32],
    cellRadiusRange: [12, 30],
    containerRadiusRange: [8, 24],
  },
  // "Mosaic": tightly packed rects.
  {
    containerShapes: ['rect'],
    aspects: ['1:1', '16:9', '4:3', '3:4'],
    cellShapes: RECT_FAMILY,
    gap: [2, 8],
    padding: [4, 16],
    cellRadiusRange: [0, 0],
    containerRadiusRange: [0, 8],
  },
  // "Matted": maximum padding, zero gap (the example screenshot).
  {
    containerShapes: ['rect'],
    aspects: ['1:1', '4:5', '3:4'],
    cellShapes: RECT_FAMILY,
    gap: [0, 0],
    padding: [64, 110],
    cellRadiusRange: [0, 0],
    containerRadiusRange: [0, 0],
  },
  // "Polaroid": squares with a generous mat and tiny gap.
  {
    containerShapes: ['rect', 'rounded'],
    aspects: ['1:1'],
    cellShapes: ['rect', 'rounded'],
    gap: [4, 10],
    padding: [40, 80],
    cellRadiusRange: [0, 8],
    containerRadiusRange: [0, 12],
  },
  // "Garden": soft organic shapes with breathing room.
  {
    containerShapes: ['rect', 'rounded', 'squircle'],
    aspects: ['1:1', '4:5', '3:4'],
    cellShapes: ORGANIC_FAMILY,
    gap: [16, 32],
    padding: [24, 56],
    cellRadiusRange: [0, 0],
    containerRadiusRange: [4, 24],
  },
  // "Geometric": angular polygons, medium gap.
  {
    containerShapes: ['rect', 'rounded', 'hexagon'],
    aspects: ['1:1', '4:3', '3:4'],
    cellShapes: GEOMETRIC_FAMILY,
    gap: [8, 20],
    padding: [16, 40],
    cellRadiusRange: [0, 0],
    containerRadiusRange: [0, 16],
  },
  // "Mixed media": every shape, looser gaps — chaotic but interesting.
  {
    containerShapes: ['rect', 'rounded', 'oval', 'arch'],
    aspects: ALL_ASPECTS,
    cellShapes: ALL_SHAPES,
    gap: [8, 28],
    padding: [16, 48],
    cellRadiusRange: [0, 24],
    containerRadiusRange: [0, 24],
  },
  // "Minimal": flat rects, no padding, hairline gap.
  {
    containerShapes: ['rect'],
    aspects: ['1:1', '16:9'],
    cellShapes: RECT_FAMILY,
    gap: [0, 4],
    padding: [0, 8],
    cellRadiusRange: [0, 0],
    containerRadiusRange: [0, 0],
  },
  // "Soft": squircles + circles, generous padding.
  {
    containerShapes: ['rounded', 'squircle'],
    aspects: ['1:1', '4:5'],
    cellShapes: ['squircle', 'rounded', 'circle'],
    gap: [12, 24],
    padding: [24, 48],
    cellRadiusRange: [16, 36],
    containerRadiusRange: [12, 24],
  },
];

/** When `squaresOnly` is true, callers ignore most of the mood and force
 *  rect cells / rect container — but we still need a gap/padding range, so we
 *  return a deterministic "Polaroid"-flavoured mood. */
function pickMood(squaresOnly: boolean): RandomMood {
  if (squaresOnly) {
    return {
      containerShapes: RECT_FAMILY,
      aspects: ['1:1'],
      cellShapes: RECT_FAMILY,
      gap: [4, 16],
      padding: [8, 32],
      cellRadiusRange: [0, 0],
      containerRadiusRange: [0, 0],
    };
  }
  return MOODS[Math.floor(Math.random() * MOODS.length)];
}

function pickFromArray<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Pick a random integer in `[lo, hi]` inclusive. */
function jitterInt(range: [number, number]): number {
  const [lo, hi] = range;
  return Math.round(lo + Math.random() * (hi - lo));
}

/** Pick a (cols, rows) factorization for `n` that minimises the deviation
 *  from a square grid for the current aspect ratio. We prefer pairs whose
 *  product equals `n`; if none exists we fall back to the first pair whose
 *  product is ≥ `n`. */
function pickEqualGrid(n: number, aspect: number): { cols: number; rows: number } {
  const N = Math.max(1, Math.floor(n));
  // Exact factor pairs first.
  const exact: Array<{ cols: number; rows: number; score: number }> = [];
  for (let cols = 1; cols <= N; cols += 1) {
    if (N % cols !== 0) continue;
    const rows = N / cols;
    // Score: how close is (cols/rows) to the target aspect?
    const ratio = cols / rows;
    const score = Math.abs(Math.log(ratio / aspect));
    exact.push({ cols, rows, score });
  }
  if (exact.length) {
    exact.sort((a, b) => a.score - b.score);
    return { cols: exact[0].cols, rows: exact[0].rows };
  }
  // Should be unreachable for N >= 1 since 1*N is always a factor.
  return { cols: N, rows: 1 };
}

/** Uniform NxM layout with all-equal cells. */
export function generateEqualLayout(
  cellCount: number,
  aspect = 1,
): {
  cols: number;
  rows: number;
  colSizes: number[];
  rowSizes: number[];
  cells: { c: number; r: number; cs: number; rs: number }[];
} {
  const { cols, rows } = pickEqualGrid(cellCount, aspect);
  const cells: { c: number; r: number; cs: number; rs: number }[] = [];
  for (let r = 1; r <= rows; r += 1) {
    for (let c = 1; c <= cols; c += 1) {
      cells.push({ c, r, cs: 1, rs: 1 });
    }
  }
  return {
    cols,
    rows,
    colSizes: new Array(cols).fill(1),
    rowSizes: new Array(rows).fill(1),
    cells,
  };
}

/** Recursive Mondrian-style subdivision. Starts with a single 1×1 rect, then
 *  repeatedly splits the largest rect (horizontally or vertically along the
 *  longer axis with a 30–70 % ratio) until N rects exist. Distinct x/y edges
 *  become the grid's column/row boundaries; each rect's grid coordinates are
 *  derived from those edges. Track sizes (`colSizes`/`rowSizes`) carry the
 *  split ratios so the rendered layout matches the geometric subdivision —
 *  every row and column is occupied by at least one cell, so there's no empty
 *  whitespace anywhere. */
export function generateRandomLayout(cellCount: number): {
  cols: number;
  rows: number;
  colSizes: number[];
  rowSizes: number[];
  cells: { c: number; r: number; cs: number; rs: number }[];
} {
  const N = Math.max(1, Math.min(24, Math.floor(cellCount) || 1));
  type R = { x: number; y: number; w: number; h: number };
  const rects: R[] = [{ x: 0, y: 0, w: 1, h: 1 }];
  while (rects.length < N) {
    rects.sort((a, b) => b.w * b.h - a.w * a.h);
    const r = rects.shift()!;
    const splitVertical = r.w >= r.h ? Math.random() < 0.85 : Math.random() < 0.15;
    const t = 0.3 + Math.random() * 0.4; // 30–70 %
    if (splitVertical) {
      rects.push({ x: r.x, y: r.y, w: r.w * t, h: r.h });
      rects.push({ x: r.x + r.w * t, y: r.y, w: r.w * (1 - t), h: r.h });
    } else {
      rects.push({ x: r.x, y: r.y, w: r.w, h: r.h * t });
      rects.push({ x: r.x, y: r.y + r.h * t, w: r.w, h: r.h * (1 - t) });
    }
  }
  const EPS = 1e-6;
  const dedupe = (arr: number[]): number[] => {
    const sorted = [...arr].sort((a, b) => a - b);
    const out: number[] = [];
    for (const v of sorted) {
      if (out.length === 0 || Math.abs(out[out.length - 1] - v) > EPS) out.push(v);
    }
    return out;
  };
  const xs = dedupe(rects.flatMap((r) => [r.x, r.x + r.w]));
  const ys = dedupe(rects.flatMap((r) => [r.y, r.y + r.h]));
  const idxOf = (arr: number[], v: number): number => {
    for (let i = 0; i < arr.length; i += 1) {
      if (Math.abs(arr[i] - v) < EPS) return i;
    }
    return -1;
  };
  const cols = xs.length - 1;
  const rows = ys.length - 1;
  const colSizes = xs.slice(1).map((v, i) => v - xs[i]);
  const rowSizes = ys.slice(1).map((v, i) => v - ys[i]);
  const cells = rects.map((r) => {
    const c0 = idxOf(xs, r.x);
    const c1 = idxOf(xs, r.x + r.w);
    const r0 = idxOf(ys, r.y);
    const r1 = idxOf(ys, r.y + r.h);
    return { c: c0 + 1, r: r0 + 1, cs: Math.max(1, c1 - c0), rs: Math.max(1, r1 - r0) };
  });
  return { cols, rows, colSizes, rowSizes, cells };
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
      // A fresh session/template should get a fresh filename so users don't
      // accidentally save over the last export. The incoming snapshot's
      // `filename` is preserved only if it was non-default.
      return {
        ...action.state,
        output: { ...action.state.output, filename: generateFilename() },
      };
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
      const selectedCellIds = state.selectedCellIds.filter((id) => cells.some((c) => c.id === id));
      return { ...state, grid: next, cells, selectedCellIds };
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
      return { ...state, grid: { cols: p.cols, rows: p.rows }, cells, selectedCellIds: [] };
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
      // Find the LARGEST empty rectangle in the grid and place the new cell
      // there at that size. If the grid is fully occupied, grow it by one
      // track in the shorter axis (mirroring the previous fallback).
      const max = findMaxEmptyRect(state.cells, state.grid);
      if (max) {
        const newCell = { ...blankCell(max.c, max.r), colSpan: max.cs, rowSpan: max.rs };
        return {
          ...state,
          cells: [...state.cells, newCell],
          selectedCellIds: [newCell.id],
        };
      }
      const grid: GridConfig = { ...state.grid };
      let placed: { c: number; r: number };
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
      const newCell = blankCell(placed.c, placed.r);
      return {
        ...state,
        grid,
        cells: [...state.cells, newCell],
        selectedCellIds: [newCell.id],
      };
    }
    case 'REMOVE_CELL': {
      const removed = state.cells.find((c) => c.id === action.id);
      if (!removed) return state;
      const remaining = state.cells.filter((c) => c.id !== action.id);
      const dims = dimensionsFor(state.container.aspect, state.output.baseSize);
      const compacted = compactAfterRemoval(
        remaining,
        state.grid,
        removed,
        state.container.padding,
        state.container.gap,
        dims.w,
        dims.h,
      );
      return {
        ...state,
        cells: compacted.cells,
        grid: compacted.grid,
        selectedCellIds: state.selectedCellIds.filter((id) => id !== action.id),
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
      return { ...state, selectedCellIds: action.id ? [action.id] : [] };
    case 'SELECT_TOGGLE': {
      const have = state.selectedCellIds.includes(action.id);
      const ids = have
        ? state.selectedCellIds.filter((x) => x !== action.id)
        : [...state.selectedCellIds, action.id];
      return { ...state, selectedCellIds: ids };
    }
    case 'MERGE_CELLS': {
      const ids = action.ids;
      if (ids.length < 2) return state;
      const targets = state.cells.filter((c) => ids.includes(c.id));
      if (targets.length < 2) return state;
      // First selected wins as the surviving cell.
      const primary = state.cells.find((c) => c.id === ids[0]);
      if (!primary) return state;
      const cMin = Math.min(...targets.map((c) => c.colStart));
      const rMin = Math.min(...targets.map((c) => c.rowStart));
      const cMax = Math.max(...targets.map((c) => c.colStart + c.colSpan - 1));
      const rMax = Math.max(...targets.map((c) => c.rowStart + c.rowSpan - 1));
      const merged: Cell = {
        ...primary,
        colStart: cMin,
        rowStart: rMin,
        colSpan: cMax - cMin + 1,
        rowSpan: rMax - rMin + 1,
        // Wipe pixel offsets so the merged rect is a clean track-aligned box.
        dx: 0, dy: 0, dw: 0, dh: 0,
      };
      const cells = state.cells
        .filter((c) => !ids.includes(c.id))
        .concat(merged);
      return { ...state, cells, selectedCellIds: [merged.id] };
    }
    case 'SYNC_CELLS_SHAPE': {
      const ids = action.ids;
      if (ids.length < 2) return state;
      const primary = state.cells.find((c) => c.id === ids[0]);
      if (!primary) return state;
      // Copy the primary's shape (and its companion radius / border) onto every
      // selected cell so the visual silhouette becomes consistent. Image and
      // position are untouched.
      const targets = new Set(ids);
      return {
        ...state,
        cells: state.cells.map((c) =>
          targets.has(c.id) && c.id !== primary.id
            ? {
                ...c,
                shape: primary.shape,
                cellRadius: primary.cellRadius,
              }
            : c,
        ),
      };
    }
    case 'SPLIT_CELL': {
      const target = state.cells.find((c) => c.id === action.id);
      if (!target) return state;
      const N = Math.max(2, Math.min(8, Math.floor(action.count)));
      if (!Number.isFinite(N) || N < 2) return state;
      const isRow = action.axis === 'row';
      const R = isRow ? target.rowStart : target.colStart;
      const S = isRow ? target.rowSpan : target.colSpan;
      const inserted = N - 1;

      // Insert (N-1) new tracks at the END of the target's band so all cells
      // above the band stay anchored, cells fully below shift, and cells that
      // cross the band stretch by the inserted count.
      const insertAfter = R + S - 1; // last track index covered by target

      const otherCells: Cell[] = [];
      for (const c of state.cells) {
        if (c.id === target.id) continue;
        if (isRow) {
          if (c.rowStart > insertAfter) {
            otherCells.push({ ...c, rowStart: c.rowStart + inserted });
          } else if (c.rowStart + c.rowSpan - 1 >= R) {
            otherCells.push({ ...c, rowSpan: c.rowSpan + inserted });
          } else {
            otherCells.push(c);
          }
        } else {
          if (c.colStart > insertAfter) {
            otherCells.push({ ...c, colStart: c.colStart + inserted });
          } else if (c.colStart + c.colSpan - 1 >= R) {
            otherCells.push({ ...c, colSpan: c.colSpan + inserted });
          } else {
            otherCells.push(c);
          }
        }
      }

      // Replace target with N sub-cells, splitting the (S + inserted) tracks
      // evenly across N children. Image (if any) is duplicated into each.
      const totalSpan = S + inserted; // = S + N - 1
      const baseSpan = Math.floor(totalSpan / N);
      const rem = totalSpan % N;
      let cursor = R;
      const subs: Cell[] = [];
      for (let i = 0; i < N; i += 1) {
        const span = baseSpan + (i < rem ? 1 : 0);
        const sub: Cell = {
          ...target,
          id: i === 0 ? target.id : uid(),
          rowStart: isRow ? cursor : target.rowStart,
          colStart: isRow ? target.colStart : cursor,
          rowSpan: isRow ? span : target.rowSpan,
          colSpan: isRow ? target.colSpan : span,
          // Pixel offsets don't make sense across new tracks; reset.
          dx: 0,
          dy: 0,
          dw: 0,
          dh: 0,
        };
        subs.push(sub);
        cursor += span;
      }

      // Update grid track sizes: replace the target's S original entries with
      // (S + inserted) entries, all sharing the band's original total weight
      // so other tracks' weights — and visual sizes — don't change.
      const nextGrid: GridConfig = { ...state.grid };
      if (isRow) {
        nextGrid.rows = state.grid.rows + inserted;
        const rowH = trackSizes(state.grid.rowSizes, state.grid.rows);
        const bandWeight = rowH.slice(R - 1, R - 1 + S).reduce((a, b) => a + b, 0) || S;
        const eachWeight = bandWeight / totalSpan;
        const replacement = new Array<number>(totalSpan).fill(eachWeight);
        nextGrid.rowSizes = [
          ...rowH.slice(0, R - 1),
          ...replacement,
          ...rowH.slice(R - 1 + S),
        ];
      } else {
        nextGrid.cols = state.grid.cols + inserted;
        const colW = trackSizes(state.grid.colSizes, state.grid.cols);
        const bandWeight = colW.slice(R - 1, R - 1 + S).reduce((a, b) => a + b, 0) || S;
        const eachWeight = bandWeight / totalSpan;
        const replacement = new Array<number>(totalSpan).fill(eachWeight);
        nextGrid.colSizes = [
          ...colW.slice(0, R - 1),
          ...replacement,
          ...colW.slice(R - 1 + S),
        ];
      }

      return {
        ...state,
        grid: nextGrid,
        cells: [...otherCells, ...subs],
        selectedCellIds: [subs[0].id],
      };
    }
    case 'MOVE_CELL_TO_RECT': {
      const target = state.cells.find((c) => c.id === action.id);
      if (!target) return state;
      const { colStart, rowStart, colSpan, rowSpan } = action;
      // Reject if the destination overlaps any other cell in grid coords.
      const proposed: Cell = { ...target, colStart, rowStart, colSpan, rowSpan, dx: 0, dy: 0, dw: 0, dh: 0 };
      const conflict = state.cells.some((c) => c.id !== target.id && rectsOverlap(c, proposed));
      if (conflict) return state;
      return {
        ...state,
        cells: state.cells.map((c) => (c.id === target.id ? proposed : c)),
      };
    }
    case 'GENERATE_RANDOM_LAYOUT': {
      // "Equal" implies a uniform NxM grid; "squaresOnly" is treated as a
      // strict-rect superset of equal (rect cells but Mondrian-style sizing).
      const isEqual = action.equal === true;
      const isFlat = isEqual || action.squaresOnly === true;
      // Ratio (w/h) used for the equal-cells aspect picker. Honour the
      // current container aspect instead of forcing 1:1 so a 16:9 container
      // gets 16:9-friendly cell counts.
      const currentAspect = (() => {
        const a = ASPECT_RATIOS.find((x) => x.id === state.container.aspect);
        if (!a || !a.h) return 1;
        return a.w / a.h;
      })();
      const layout = isEqual
        ? generateEqualLayout(action.cellCount, currentAspect)
        : generateRandomLayout(action.cellCount);
      const mood = pickMood(action.squaresOnly === true);

      // Preserve existing images: walk the new cells in row-major order and
      // hand each an image from the previous cell list (also row-major). This
      // keeps photos in place across re-shuffles even when the cell count
      // changes (extra new cells stay empty; surplus old images are dropped).
      const oldImages = state.cells
        .slice()
        .sort((a, b) => a.rowStart - b.rowStart || a.colStart - b.colStart)
        .map((c) => ({
          image: c.image,
          fit: c.fit,
          offsetX: c.offsetX,
          offsetY: c.offsetY,
          scale: c.scale,
          rotation: c.rotation,
          filter: c.filter,
        }))
        .filter((c) => c.image);

      const newCells: Cell[] = layout.cells
        .slice()
        .sort((a, b) => a.r - b.r || a.c - b.c)
        .map((c, i) => {
          const inherited = oldImages[i];
          return {
            ...blankCell(c.c, c.r),
            colSpan: c.cs,
            rowSpan: c.rs,
            shape: isFlat ? 'rect' : pickFromArray(mood.cellShapes),
            cellRadius: isFlat
              ? 0
              : mood.cellRadiusRange[0] +
                Math.random() * (mood.cellRadiusRange[1] - mood.cellRadiusRange[0]),
            ...(inherited
              ? {
                  image: inherited.image,
                  fit: inherited.fit,
                  offsetX: inherited.offsetX,
                  offsetY: inherited.offsetY,
                  scale: inherited.scale,
                  rotation: inherited.rotation,
                  filter: inherited.filter,
                }
              : {}),
          };
        });

      return {
        ...state,
        container: {
          ...state.container,
          // Equal-cells mode keeps the user's current container aspect/shape
          // — they explicitly asked for a tidy uniform grid.
          shape: isEqual
            ? state.container.shape
            : action.squaresOnly
              ? 'rect'
              : pickFromArray(mood.containerShapes),
          aspect: isEqual
            ? state.container.aspect
            : action.squaresOnly
              ? '1:1'
              : pickFromArray(mood.aspects),
          gap: isEqual ? state.container.gap : jitterInt(mood.gap),
          padding: isEqual ? state.container.padding : jitterInt(mood.padding),
          cornerRadius: isEqual
            ? state.container.cornerRadius
            : action.squaresOnly
              ? 0
              : mood.containerRadiusRange[0] +
                Math.random() *
                  (mood.containerRadiusRange[1] - mood.containerRadiusRange[0]),
        },
        grid: {
          cols: layout.cols,
          rows: layout.rows,
          colSizes: layout.colSizes,
          rowSizes: layout.rowSizes,
        },
        cells: newCells,
        selectedCellIds: [],
      };
    }
    case 'ALIGN_GRID': {
      const dims = dimensionsFor(state.container.aspect, state.output.baseSize);
      return alignGrid(state, state.container.padding, state.container.gap, dims.w, dims.h);
    }
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
