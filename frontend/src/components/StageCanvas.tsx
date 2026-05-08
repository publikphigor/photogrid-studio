import {
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Image as ImageIcon, RotateCcw, Trash2, Upload, ZoomIn, ZoomOut } from 'lucide-react';
import type { Action, Cell, CellImageRef, PhotoGridState } from '@/types';
import { dimensionsFor } from '@/state/presets';
import { cellShapeCSS, shapeCSS } from '@/state/shapes';
import { ingestFile } from '@/api/client';
import {
  MIN_TRACK_FR,
  cellPixelSize,
  computeCellRect,
  coverFitScale,
  pointToGridSlot,
  trackSizes,
} from '@/state/reducer';

interface Props {
  state: PhotoGridState;
  dispatch: (a: Action) => void;
}

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Two distinct resize modes:
 *  - 'track' (corners): drags global colSizes/rowSizes — affects every cell
 *    in the column/row band. This is the wide redistribute.
 *  - 'edge' (E/W/N/S): drags ONLY the dragged cell's edge boundary; adjusts
 *    per-cell pixel offsets so other cells in the same column/row stay put. */
type ResizeMode = 'track' | 'edge';

interface ResizeState {
  mode: ResizeMode;
  id: string;
  dir: ResizeDir;
  startX: number;
  startY: number;
  /** Pixel-per-design-pixel conversion (screen-px / design-px). */
  scaleX: number;
  scaleY: number;

  // ---- track mode (corners) ----
  colGrow: number | null;
  colShrink: number | null;
  rowGrow: number | null;
  rowShrink: number | null;
  pxPerFrX: number;
  pxPerFrY: number;
  baseColSizes: number[];
  baseRowSizes: number[];
  signX: -1 | 0 | 1;
  signY: -1 | 0 | 1;
  lastColSizes: number[];
  lastRowSizes: number[];

  // ---- edge mode (E/W/N/S) ----
  /** Axis: 'x' for E/W, 'y' for N/S. */
  axis: 'x' | 'y' | null;
  /** Mover's starting offsets (design pixels). */
  moverBaseDx: number;
  moverBaseDy: number;
  moverBaseDw: number;
  moverBaseDh: number;
  /** Neighbor cells (along the edge) and their starting offsets. */
  neighbors: { id: string; baseDx: number; baseDy: number; baseDw: number; baseDh: number }[];
  /** Allowed delta range in design pixels (clamps so cells don't go below
   *  MIN_CELL px on either side). */
  deltaMin: number;
  deltaMax: number;
  /** Last dispatched delta to dedupe. */
  lastDelta: number;
  /** Edge position (design px) of the dragged side at drag start. */
  moverEdgeStart: number;
  /** Other cells' edges + canvas inner edges, used to render alignment guides. */
  alignXs: number[];
  alignYs: number[];
}

type DragKind = 'reposition' | 'swap' | 'move';

interface ActiveDrag {
  kind: DragKind;
  cellId: string;
  startX: number;
  startY: number;
  baseOffsetX: number;
  baseOffsetY: number;
  imgEl: HTMLImageElement | null;
  scale: number;
  rotation: number;
  invZoom: number;
  ghostSrc: string;
  /** True when the cell uses the 'native' fit (centered via translate(-50%,-50%)). */
  nativeFit: boolean;
  // Latest cursor position (only read inside rAF callback).
  curX: number;
  curY: number;
  /** Has the user moved past the click threshold? */
  moved: boolean;
  /** Last computed offset for reposition (so mouseup can dispatch the final value). */
  lastOffsetX: number;
  lastOffsetY: number;
  /** Cell id under the cursor, for swap/move target highlight. */
  overId: string | null;
  /** Was this cell the PRIMARY selection at mousedown? Plain click on a
   *  primary-selected populated cell triggers the file picker on mouseup. */
  wasPrimary: boolean;
  /** Was the click held with cmd/ctrl? Suppress click-as-picker behavior
   *  because the modifier expressed multi-select intent. */
  cmdOrCtrl: boolean;
}

interface GhostState {
  x: number;
  y: number;
  src: string;
  mode: 'image' | 'cell';
  overId: string | null;
}

const CLICK_THRESHOLD = 4; // px before a mousedown becomes a drag

export function StageCanvas({ state, dispatch }: Props) {
  const { container, grid, cells, selectedCellIds, canvas: canvasState } = state;
  const primarySelectedId = selectedCellIds[0] ?? null;
  const dims = dimensionsFor(container.aspect, state.output.baseSize);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [stageBox, setStageBox] = useState({ w: 800, h: 600 });
  const [dragOver, setDragOver] = useState(false);
  const [resizing, setResizing] = useState<ResizeState | null>(null);
  const [ghost, setGhost] = useState<GhostState | null>(null);
  // Alignment guides shown during a resize drag. Each value is a design-pixel
  // coordinate where the mover edge currently lines up with another cell or
  // a canvas edge — rendered as a thin dashed line.
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });

  // Drag bookkeeping outside React state — no re-renders during drag.
  const dragRef = useRef<ActiveDrag | null>(null);
  const rafRef = useRef<number | null>(null);
  // Mirror of cells/state for use inside window listeners (avoid stale closures).
  const cellsRef = useRef(cells);
  cellsRef.current = cells;
  const selectedRef = useRef(selectedCellIds);
  selectedRef.current = selectedCellIds;

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setStageBox({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const PADDING = 72;
  const fitScale = Math.min(
    (stageBox.w - PADDING) / dims.w,
    (stageBox.h - PADDING) / dims.h,
    1,
  );
  const zoom = Math.max(0.05, fitScale * canvasState.zoom);
  const dispW = dims.w * zoom;
  const dispH = dims.h * zoom;

  const shapeStyle = shapeCSS(container.shape, dims.w, dims.h, container.cornerRadius);

  // ---- File drop (OS → stage) ---------------------------------------------
  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const valid = [...files].filter((f) => f.type.startsWith('image/'));
      if (!valid.length) return;
      const imgs: CellImageRef[] = [];
      for (const f of valid) {
        try {
          imgs.push(await ingestFile(f));
        } catch (e) {
          console.error('upload failed', f.name, e);
        }
      }
      if (imgs.length) dispatch({ type: 'FILL_FROM_FILES', images: imgs });
    },
    [dispatch],
  );

  const isFileDrag = (e: DragEvent) => {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    for (let i = 0; i < types.length; i++) {
      if (types[i] === 'Files') return true;
    }
    return false;
  };
  const onStageDrop = (e: DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) void handleFiles(e.dataTransfer.files);
  };
  const onStageDragOver = (e: DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    if (!dragOver) setDragOver(true);
  };
  const onStageDragLeave = (e: DragEvent) => {
    if (!isFileDrag(e)) return;
    if (e.currentTarget === e.target) setDragOver(false);
  };

  // ---- File picker per cell -----------------------------------------------
  // Multi-select: first image lands in the clicked cell; surplus fills empty
  // cells in row-major order; remaining images are discarded (no grid growth).
  const uploadToCell = (id: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = async () => {
      const files = [...(input.files ?? [])];
      if (!files.length) return;
      const imgs: CellImageRef[] = [];
      for (const f of files) {
        try {
          imgs.push(await ingestFile(f));
        } catch (e) {
          console.error('upload failed', f.name, e);
        }
      }
      if (!imgs.length) return;
      const cell = cells.find((c) => c.id === id);
      const innerW = dims.w - container.padding * 2 - container.gap * (grid.cols - 1);
      const innerH = dims.h - container.padding * 2 - container.gap * (grid.rows - 1);
      const cellSize = cell
        ? cellPixelSize(cell, grid, innerW, innerH, container.gap)
        : { w: dims.w, h: dims.h };
      const useNative = (cell?.fit ?? 'native') === 'native';
      const initScale = useNative
        ? coverFitScale(cellSize.w, cellSize.h, imgs[0].w, imgs[0].h)
        : 1;
      dispatch({
        type: 'UPDATE_CELL',
        id,
        patch: { image: imgs[0], offsetX: 0, offsetY: 0, scale: initScale },
      });
      if (imgs.length > 1) {
        dispatch({ type: 'FILL_EMPTY_NO_GROW', images: imgs.slice(1) });
      }
    };
    input.click();
  };

  // ---- Resize via 8 handles ------------------------------------------------
  // Corner handles (NE/NW/SE/SW): drag track sizes globally — every cell in
  // the affected column/row band redistributes pixel width.
  // Edge handles (E/W/N/S): drag only the moving cell's boundary with its
  // immediate neighbors along that edge. Cells in the same column/row but
  // outside that neighbor set keep their original boundary.
  const MIN_CELL_PX = 24; // design-pixel floor for any cell side
  const onHandleDown = (e: MouseEvent, cell: Cell, dir: ResizeDir) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const scaleX = rect.width / dims.w; // screen-px per design-px
    const scaleY = rect.height / dims.h;
    const isCorner = dir.length === 2; // ne/nw/se/sw
    const baseColSizes = trackSizes(grid.colSizes, grid.cols);
    const baseRowSizes = trackSizes(grid.rowSizes, grid.rows);
    // Snapshot alignment lines from every OTHER cell's edges + canvas inner
    // edges. Used to render dashed guides while the user drags.
    const alignInnerW = dims.w - container.padding * 2 - container.gap * (grid.cols - 1);
    const alignInnerH = dims.h - container.padding * 2 - container.gap * (grid.rows - 1);
    const alignXs: number[] = [container.padding, dims.w - container.padding];
    const alignYs: number[] = [container.padding, dims.h - container.padding];
    for (const c of cells) {
      if (c.id === cell.id) continue;
      const r = computeCellRect(c, grid, alignInnerW, alignInnerH, container.padding, container.gap);
      alignXs.push(r.x, r.x + r.w);
      alignYs.push(r.y, r.y + r.h);
    }

    if (isCorner) {
      // Track redistribution (current corner behavior).
      const totalColFr = baseColSizes.reduce((a, b) => a + b, 0);
      const totalRowFr = baseRowSizes.reduce((a, b) => a + b, 0);
      const innerPxW = rect.width - container.padding * 2 * scaleX - container.gap * (grid.cols - 1) * scaleX;
      const innerPxH = rect.height - container.padding * 2 * scaleY - container.gap * (grid.rows - 1) * scaleY;
      const pxPerFrX = totalColFr > 0 ? innerPxW / totalColFr : 0;
      const pxPerFrY = totalRowFr > 0 ? innerPxH / totalRowFr : 0;

      let colGrow: number | null = null;
      let colShrink: number | null = null;
      let signX: -1 | 0 | 1 = 0;
      if (dir.includes('e')) {
        const right = cell.colStart - 1 + cell.colSpan - 1;
        if (right + 1 < grid.cols) {
          colGrow = right; colShrink = right + 1; signX = 1;
        }
      } else if (dir.includes('w')) {
        const left = cell.colStart - 1;
        if (left - 1 >= 0) {
          colGrow = left; colShrink = left - 1; signX = -1;
        }
      }
      let rowGrow: number | null = null;
      let rowShrink: number | null = null;
      let signY: -1 | 0 | 1 = 0;
      if (dir.includes('s')) {
        const bot = cell.rowStart - 1 + cell.rowSpan - 1;
        if (bot + 1 < grid.rows) {
          rowGrow = bot; rowShrink = bot + 1; signY = 1;
        }
      } else if (dir.includes('n')) {
        const top = cell.rowStart - 1;
        if (top - 1 >= 0) {
          rowGrow = top; rowShrink = top - 1; signY = -1;
        }
      }
      if (colGrow == null && rowGrow == null) return;
      setResizing({
        mode: 'track',
        id: cell.id, dir, startX: e.clientX, startY: e.clientY,
        scaleX, scaleY,
        colGrow, colShrink, rowGrow, rowShrink,
        pxPerFrX, pxPerFrY,
        baseColSizes, baseRowSizes,
        signX, signY,
        lastColSizes: baseColSizes, lastRowSizes: baseRowSizes,
        axis: null,
        moverBaseDx: 0, moverBaseDy: 0, moverBaseDw: 0, moverBaseDh: 0,
        neighbors: [], deltaMin: 0, deltaMax: 0, lastDelta: 0,
        moverEdgeStart: 0,
        alignXs, alignYs,
      });
      return;
    }

    // Edge handle. Two regimes:
    //   1. There's a cell flush against the dragged edge → push that cell back
    //      as the mover grows (current "cell pair" behavior).
    //   2. There's whitespace (no cell touching that edge) → grow the mover
    //      alone into the empty space, until it hits the next cell or the
    //      canvas inner edge.
    // We pick the regime per drag based on what's adjacent.
    const side = dir as 'e' | 'w' | 'n' | 's';
    const axis: 'x' | 'y' = side === 'e' || side === 'w' ? 'x' : 'y';

    const innerW = dims.w - container.padding * 2 - container.gap * (grid.cols - 1);
    const innerH = dims.h - container.padding * 2 - container.gap * (grid.rows - 1);
    const moverRect = computeCellRect(cell, grid, innerW, innerH, container.padding, container.gap);
    const innerLeft = container.padding;
    const innerTop = container.padding;
    const innerRight = dims.w - container.padding;
    const innerBottom = dims.h - container.padding;

    // Pixel-space rects of every other cell, used to find immediate neighbors
    // and the next obstacle in the dragged direction.
    const otherRects = cells
      .filter((c) => c.id !== cell.id)
      .map((c) => ({
        cell: c,
        r: computeCellRect(c, grid, innerW, innerH, container.padding, container.gap),
      }));

    // Cells in the same grid layout are separated by `container.gap` pixels.
    // A cell is an "immediate" neighbor when its left/right/top/bottom edge
    // sits exactly `gap` away from the mover's edge (within EPS), AND the
    // perpendicular ranges overlap.
    const EPS = 1.5;
    const gap = container.gap;
    const overlapY = (r: { y: number; h: number }) =>
      r.y < moverRect.y + moverRect.h && r.y + r.h > moverRect.y;
    const overlapX = (r: { x: number; w: number }) =>
      r.x < moverRect.x + moverRect.w && r.x + r.w > moverRect.x;

    const immediates = otherRects.filter(({ r }) => {
      if (side === 'e') return overlapY(r) && Math.abs(r.x - (moverRect.x + moverRect.w + gap)) < EPS;
      if (side === 'w') return overlapY(r) && Math.abs(r.x + r.w + gap - moverRect.x) < EPS;
      if (side === 's') return overlapX(r) && Math.abs(r.y - (moverRect.y + moverRect.h + gap)) < EPS;
      return overlapX(r) && Math.abs(r.y + r.h + gap - moverRect.y) < EPS;
    });

    // Distance the mover's edge can travel into whitespace before hitting
    // either the next cell or the canvas inner padding. Excludes the cells
    // already counted as immediates.
    let gapDistance: number;
    if (side === 'e') {
      gapDistance = innerRight - (moverRect.x + moverRect.w);
      for (const { r } of otherRects) {
        if (!overlapY(r)) continue;
        if (r.x <= moverRect.x + moverRect.w + gap + EPS) continue;
        gapDistance = Math.min(gapDistance, r.x - moverRect.x - moverRect.w - gap);
      }
    } else if (side === 'w') {
      gapDistance = moverRect.x - innerLeft;
      for (const { r } of otherRects) {
        if (!overlapY(r)) continue;
        if (r.x + r.w + gap >= moverRect.x - EPS) continue;
        gapDistance = Math.min(gapDistance, moverRect.x - (r.x + r.w) - gap);
      }
    } else if (side === 's') {
      gapDistance = innerBottom - (moverRect.y + moverRect.h);
      for (const { r } of otherRects) {
        if (!overlapX(r)) continue;
        if (r.y <= moverRect.y + moverRect.h + gap + EPS) continue;
        gapDistance = Math.min(gapDistance, r.y - moverRect.y - moverRect.h - gap);
      }
    } else {
      gapDistance = moverRect.y - innerTop;
      for (const { r } of otherRects) {
        if (!overlapX(r)) continue;
        if (r.y + r.h + gap >= moverRect.y - EPS) continue;
        gapDistance = Math.min(gapDistance, moverRect.y - (r.y + r.h) - gap);
      }
    }
    gapDistance = Math.max(0, gapDistance);

    // How far the mover can shrink before hitting MIN_CELL_PX.
    const moverShrink = axis === 'x'
      ? Math.max(0, moverRect.w - MIN_CELL_PX)
      : Math.max(0, moverRect.h - MIN_CELL_PX);

    // Δ is the boundary's pixel shift along +x or +y. For E/S: positive Δ
    // grows the mover; for W/N: negative Δ grows it. We normalize to a single
    // signed range so applyEdge stays simple.
    let deltaMin: number;
    let deltaMax: number;
    if (immediates.length > 0) {
      // Cell-pair mode: each immediate neighbor can give up at most
      // (its size - MIN_CELL_PX). Cap mover growth by that, mover shrink by
      // its own give.
      const neighborGive = Math.min(
        ...immediates.map(({ r }) =>
          Math.max(0, axis === 'x' ? r.w - MIN_CELL_PX : r.h - MIN_CELL_PX),
        ),
      );
      if (side === 'e' || side === 's') {
        deltaMin = -moverShrink;
        deltaMax = neighborGive;
      } else {
        deltaMin = -neighborGive;
        deltaMax = moverShrink;
      }
    } else {
      // Whitespace mode: mover grows alone. Direction depends on side.
      if (side === 'e' || side === 's') {
        deltaMin = -moverShrink;
        deltaMax = gapDistance;
      } else {
        deltaMin = -gapDistance;
        deltaMax = moverShrink;
      }
    }

    if (deltaMin === 0 && deltaMax === 0) return; // truly nothing to do

    setResizing({
      mode: 'edge',
      id: cell.id, dir, startX: e.clientX, startY: e.clientY,
      scaleX, scaleY,
      colGrow: null, colShrink: null, rowGrow: null, rowShrink: null,
      pxPerFrX: 0, pxPerFrY: 0,
      baseColSizes, baseRowSizes,
      signX: 0, signY: 0,
      lastColSizes: baseColSizes, lastRowSizes: baseRowSizes,
      axis,
      moverBaseDx: cell.dx ?? 0,
      moverBaseDy: cell.dy ?? 0,
      moverBaseDw: cell.dw ?? 0,
      moverBaseDh: cell.dh ?? 0,
      neighbors: immediates.map(({ cell: n }) => ({
        id: n.id,
        baseDx: n.dx ?? 0,
        baseDy: n.dy ?? 0,
        baseDw: n.dw ?? 0,
        baseDh: n.dh ?? 0,
      })),
      deltaMin, deltaMax, lastDelta: 0,
      moverEdgeStart: side === 'e'
        ? moverRect.x + moverRect.w
        : side === 'w'
          ? moverRect.x
          : side === 's'
            ? moverRect.y + moverRect.h
            : moverRect.y,
      alignXs, alignYs,
    });
  };

  // rAF-throttle so we don't dispatch multiple times per frame mid-drag.
  useEffect(() => {
    if (!resizing) return;
    let raf: number | null = null;
    const latest = { x: resizing.startX, y: resizing.startY };
    // Pixel tolerance for "edges align". Generous enough for the user to feel
    // it from a normal drag speed, tight enough not to spam guides everywhere.
    const ALIGN_EPS = 4;
    const findAlignedX = (x: number) =>
      resizing.alignXs.filter((v) => Math.abs(v - x) <= ALIGN_EPS);
    const findAlignedY = (y: number) =>
      resizing.alignYs.filter((v) => Math.abs(v - y) <= ALIGN_EPS);
    const arraysEqual = (a: number[], b: number[]) =>
      a.length === b.length && a.every((v, i) => v === b[i]);
    const applyTrack = () => {
      const dxPx = (latest.x - resizing.startX) * resizing.signX;
      const dyPx = (latest.y - resizing.startY) * resizing.signY;
      let nextCol: number[] | undefined;
      let nextRow: number[] | undefined;
      if (resizing.colGrow != null && resizing.colShrink != null && resizing.pxPerFrX > 0) {
        const dFr = dxPx / resizing.pxPerFrX;
        const sizes = [...resizing.baseColSizes];
        const maxDFr = sizes[resizing.colShrink] - MIN_TRACK_FR;
        const minDFr = -(sizes[resizing.colGrow] - MIN_TRACK_FR);
        const d = Math.max(minDFr, Math.min(maxDFr, dFr));
        sizes[resizing.colGrow] += d;
        sizes[resizing.colShrink] -= d;
        nextCol = sizes;
      }
      if (resizing.rowGrow != null && resizing.rowShrink != null && resizing.pxPerFrY > 0) {
        const dFr = dyPx / resizing.pxPerFrY;
        const sizes = [...resizing.baseRowSizes];
        const maxDFr = sizes[resizing.rowShrink] - MIN_TRACK_FR;
        const minDFr = -(sizes[resizing.rowGrow] - MIN_TRACK_FR);
        const d = Math.max(minDFr, Math.min(maxDFr, dFr));
        sizes[resizing.rowGrow] += d;
        sizes[resizing.rowShrink] -= d;
        nextRow = sizes;
      }
      const sameCol =
        nextCol == null ||
        (nextCol.length === resizing.lastColSizes.length &&
          nextCol.every((v, i) => Math.abs(v - resizing.lastColSizes[i]) < 1e-4));
      const sameRow =
        nextRow == null ||
        (nextRow.length === resizing.lastRowSizes.length &&
          nextRow.every((v, i) => Math.abs(v - resizing.lastRowSizes[i]) < 1e-4));
      if (sameCol && sameRow) return;
      if (nextCol) resizing.lastColSizes = nextCol;
      if (nextRow) resizing.lastRowSizes = nextRow;
      dispatch({ type: 'RESIZE_TRACKS', colSizes: nextCol, rowSizes: nextRow });
    };
    const applyEdge = () => {
      // Cursor delta in design pixels along the axis; sign matches the
      // boundary's drag direction (positive = boundary moves +x or +y).
      const dx = resizing.scaleX > 0 ? (latest.x - resizing.startX) / resizing.scaleX : 0;
      const dy = resizing.scaleY > 0 ? (latest.y - resizing.startY) / resizing.scaleY : 0;
      const rawDelta = resizing.axis === 'x' ? dx : dy;
      const delta = Math.max(resizing.deltaMin, Math.min(resizing.deltaMax, rawDelta));
      // Guides: light up alignment lines whenever the dragged edge is within
      // ALIGN_EPS px of one. Computed in design space.
      const edgeNow = resizing.moverEdgeStart + delta;
      if (resizing.axis === 'x') {
        const xs = findAlignedX(edgeNow);
        setGuides((g) =>
          arraysEqual(g.x, xs) && g.y.length === 0 ? g : { x: xs, y: [] },
        );
      } else {
        const ys = findAlignedY(edgeNow);
        setGuides((g) =>
          arraysEqual(g.y, ys) && g.x.length === 0 ? g : { x: [], y: ys },
        );
      }
      if (Math.abs(delta - resizing.lastDelta) < 0.5) return; // sub-px change, skip
      resizing.lastDelta = delta;

      const updates: { id: string; dx?: number; dy?: number; dw?: number; dh?: number }[] = [];
      const side = resizing.dir as 'e' | 'w' | 'n' | 's';
      if (side === 'e') {
        // Boundary on +x side of mover. Mover grows by Δ; each neighbor
        // shifts +Δ on x and shrinks by Δ on width.
        updates.push({ id: resizing.id, dw: resizing.moverBaseDw + delta });
        for (const n of resizing.neighbors) {
          updates.push({ id: n.id, dx: n.baseDx + delta, dw: n.baseDw - delta });
        }
      } else if (side === 'w') {
        // Boundary on -x side of mover. Negative Δ (cursor left) grows
        // mover; positive Δ shrinks it. Mover.dx tracks Δ; mover.dw mirrors.
        updates.push({
          id: resizing.id,
          dx: resizing.moverBaseDx + delta,
          dw: resizing.moverBaseDw - delta,
        });
        for (const n of resizing.neighbors) {
          updates.push({ id: n.id, dw: n.baseDw + delta });
        }
      } else if (side === 's') {
        updates.push({ id: resizing.id, dh: resizing.moverBaseDh + delta });
        for (const n of resizing.neighbors) {
          updates.push({ id: n.id, dy: n.baseDy + delta, dh: n.baseDh - delta });
        }
      } else {
        // 'n'
        updates.push({
          id: resizing.id,
          dy: resizing.moverBaseDy + delta,
          dh: resizing.moverBaseDh - delta,
        });
        for (const n of resizing.neighbors) {
          updates.push({ id: n.id, dh: n.baseDh + delta });
        }
      }
      dispatch({ type: 'EDGE_RESIZE', updates });
    };
    const apply = () => {
      raf = null;
      if (resizing.mode === 'track') applyTrack();
      else applyEdge();
    };
    const onMove = (e: globalThis.MouseEvent) => {
      latest.x = e.clientX;
      latest.y = e.clientY;
      if (raf == null) raf = requestAnimationFrame(apply);
    };
    const onUp = () => {
      setResizing(null);
      setGuides({ x: [], y: [] });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [resizing, dispatch]);

  // ---- Unified cell mouse drag (no HTML5 drag) ----------------------------
  const onCellMouseDown = useCallback(
    (e: MouseEvent, cell: Cell, imgEl: HTMLImageElement | null) => {
      e.stopPropagation();
      const tgt = e.target as HTMLElement;
      if (tgt.closest('.cell-handle') || tgt.closest('.cell-controls button')) return;

      // Selection rules:
      //  - cmd/ctrl+click toggles this cell into the multi-selection.
      //  - plain click on a cell that isn't selected makes it the sole
      //    selection (no picker yet).
      //  - plain click on an already-primary-selected populated cell will be
      //    treated as a "reopen" intent → opens the file picker on mouseup.
      const wasSelected = selectedRef.current.includes(cell.id);
      const wasPrimary = selectedRef.current[0] === cell.id;
      const cmdOrCtrl = e.metaKey || e.ctrlKey;
      if (cmdOrCtrl) {
        dispatch({ type: 'SELECT_TOGGLE', id: cell.id });
      } else if (!wasSelected) {
        dispatch({ type: 'SELECT', id: cell.id });
      }

      const board = wrapRef.current;
      const boardRect = board?.getBoundingClientRect();
      const invZoom = boardRect && boardRect.width > 0 ? dims.w / boardRect.width : 1;

      // Drag rules:
      //  - shift+drag → swap cell positions (move kind).
      //  - drag inside a populated cell → reposition image.
      //  - drag inside an empty cell → no-op (click path runs on mouseup).
      const kind: DragKind = !cell.image
        ? 'reposition'
        : e.shiftKey
          ? 'move'
          : 'reposition';

      dragRef.current = {
        kind,
        cellId: cell.id,
        startX: e.clientX,
        startY: e.clientY,
        baseOffsetX: cell.offsetX,
        baseOffsetY: cell.offsetY,
        imgEl,
        scale: cell.scale,
        rotation: cell.rotation,
        invZoom,
        ghostSrc: cell.image?.previewUrl ?? '',
        nativeFit: cell.fit === 'native',
        curX: e.clientX,
        curY: e.clientY,
        moved: false,
        lastOffsetX: cell.offsetX,
        lastOffsetY: cell.offsetY,
        overId: null,
        wasPrimary,
        cmdOrCtrl,
      };
    },
    [dispatch, dims.w],
  );

  // Window listeners (always mounted; cheap when drag is idle).
  useEffect(() => {
    const applyFrame = () => {
      rafRef.current = null;
      const drag = dragRef.current;
      if (!drag) return;
      const dx = drag.curX - drag.startX;
      const dy = drag.curY - drag.startY;
      if (drag.kind === 'reposition' && drag.imgEl) {
        const nx = drag.baseOffsetX + dx * drag.invZoom;
        const ny = drag.baseOffsetY + dy * drag.invZoom;
        drag.lastOffsetX = nx;
        drag.lastOffsetY = ny;
        const center = drag.nativeFit ? 'translate(-50%, -50%) ' : '';
        drag.imgEl.style.transform = `${center}translate(${nx}px, ${ny}px) scale(${drag.scale}) rotate(${drag.rotation}deg)`;
        return;
      }
      // swap / move: track ghost + target cell
      const el = document.elementFromPoint(drag.curX, drag.curY);
      const target = el?.closest('[data-cell-id]') as HTMLElement | null;
      const overId = target?.getAttribute('data-cell-id') ?? null;
      drag.overId = overId && overId !== drag.cellId ? overId : null;
      setGhost({
        x: drag.curX,
        y: drag.curY,
        src: drag.ghostSrc,
        mode: drag.kind === 'move' ? 'cell' : 'image',
        overId: drag.overId,
      });
    };

    const schedule = () => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(applyFrame);
    };

    const onMove = (e: globalThis.MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      drag.curX = e.clientX;
      drag.curY = e.clientY;
      if (!drag.moved) {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (Math.abs(dx) < CLICK_THRESHOLD && Math.abs(dy) < CLICK_THRESHOLD) return;
        drag.moved = true;
      }
      schedule();
    };

    const onUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      const cell = cellsRef.current.find((c) => c.id === drag.cellId);
      if (!drag.moved) {
        // Pure click — interpret per the spec:
        //  - empty cell → open the file picker.
        //  - populated cell that was already PRIMARY → open the picker
        //    (re-clicking a focused image opens "replace").
        //  - populated cell that wasn't primary → just selected, no picker.
        //  - cmd/ctrl modifier suppresses picker (it was a multi-select).
        if (cell && !drag.cmdOrCtrl) {
          if (!cell.image) uploadToCell(cell.id);
          else if (drag.wasPrimary) uploadToCell(cell.id);
        }
      } else if (drag.kind === 'reposition') {
        if (
          cell &&
          (Math.abs(drag.lastOffsetX - cell.offsetX) > 0.5 ||
            Math.abs(drag.lastOffsetY - cell.offsetY) > 0.5)
        ) {
          dispatch({
            type: 'UPDATE_CELL',
            id: drag.cellId,
            patch: { offsetX: drag.lastOffsetX, offsetY: drag.lastOffsetY },
          });
        }
      } else if (drag.overId) {
        const action: Action =
          drag.kind === 'move'
            ? { type: 'MOVE_CELL_TO_CELL', sourceId: drag.cellId, targetId: drag.overId }
            : { type: 'SWAP_CELLS', aId: drag.cellId, bId: drag.overId };
        const startVT = (
          document as unknown as {
            startViewTransition?: (cb: () => void) => unknown;
          }
        ).startViewTransition;
        if (typeof startVT === 'function') startVT.call(document, () => dispatch(action));
        else dispatch(action);
      } else if (drag.kind === 'move') {
        // Shift+drag dropped on whitespace. Find the grid cell under the
        // cursor and, if it's empty, snap the source to the largest empty
        // rectangle anchored at that cell.
        const board = wrapRef.current;
        const rect = board?.getBoundingClientRect();
        if (rect) {
          const px = (drag.curX - rect.left) / (rect.width / dims.w);
          const py = (drag.curY - rect.top) / (rect.height / dims.h);
          const slot = pointToGridSlot(
            px, py,
            container.padding, container.gap, dims.w, dims.h,
            grid, cellsRef.current,
          );
          if (slot) {
            dispatch({
              type: 'MOVE_CELL_TO_RECT',
              id: drag.cellId,
              colStart: slot.c,
              rowStart: slot.r,
              colSpan: slot.cs,
              rowSpan: slot.rs,
            });
          }
        }
      }
      dragRef.current = null;
      setGhost(null);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // dispatch is stable; uploadToCell is inline and not memoized but capturing via closure is fine
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  const onStageMouseDown = (e: MouseEvent) => {
    // Click anywhere in the stage that isn't a cell or a resize handle clears
    // the selection. The dark area around the canvas counts; the stage-foot
    // toolbar is outside this element so its buttons aren't affected.
    const t = e.target as HTMLElement;
    if (t.closest('[data-cell-id]') || t.closest('[data-handle-dir]')) return;
    dispatch({ type: 'SELECT', id: null });
  };

  const bg = container.bgTransparent ? 'transparent' : container.bg;

  return (
    <div
      className="stage"
      onDrop={onStageDrop}
      onDragOver={onStageDragOver}
      onDragLeave={onStageDragLeave}
      onMouseDown={onStageMouseDown}
    >
      <div className="stage-canvas-area" ref={stageRef}>
        {dragOver && <div className="drop-overlay">drop images anywhere to fill grid</div>}

        <div className="board-wrap">
          <div className="board-frame" style={{ width: dispW, height: dispH }}>
            <div
              className="board"
              ref={wrapRef}
              style={{
                width: dims.w,
                height: dims.h,
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
                background: bg,
                ...shapeStyle,
                boxShadow:
                  container.borderWidth > 0
                    ? `0 0 0 ${container.borderWidth}px ${container.borderColor} inset`
                    : 'none',
              }}
            >
              {container.bgImage?.previewUrl && (
                <img
                  src={container.bgImage.previewUrl}
                  alt=""
                  draggable={false}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: container.bgImageFit === 'fill' ? 'fill' : container.bgImageFit,
                    pointerEvents: 'none',
                  }}
                />
              )}
              <div className="grid-area">
                {(() => {
                  const innerW = dims.w - container.padding * 2 - container.gap * (grid.cols - 1);
                  const innerH = dims.h - container.padding * 2 - container.gap * (grid.rows - 1);
                  return cells.map((cell) => {
                    const r = computeCellRect(
                      cell,
                      grid,
                      innerW,
                      innerH,
                      container.padding,
                      container.gap,
                    );
                    return (
                      <CellView
                        key={cell.id}
                        cell={cell}
                        rect={r}
                        selected={selectedCellIds.includes(cell.id)}
                        primary={primarySelectedId === cell.id}
                        swapOver={ghost?.overId === cell.id}
                        onMouseDown={onCellMouseDown}
                        onUpload={() => uploadToCell(cell.id)}
                        onRemove={() => dispatch({ type: 'REMOVE_CELL', id: cell.id })}
                        onScale={(c, factor) => {
                          const next = Math.min(5, Math.max(0.05, c.scale * factor));
                          if (Math.abs(next - c.scale) < 1e-4) return;
                          dispatch({ type: 'UPDATE_CELL', id: c.id, patch: { scale: next } });
                        }}
                      />
                    );
                  });
                })()}
              </div>
              <ResizeHandles
                cell={cells.find((c) => c.id === primarySelectedId)}
                grid={grid}
                container={container}
                dims={dims}
                zoom={zoom}
                onHandleDown={onHandleDown}
              />
              {/* Alignment guides during a resize drag — thin dashed lines
                  in design space; the parent .board scales them along with
                  the rest of the canvas. */}
              {(guides.x.length > 0 || guides.y.length > 0) && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    pointerEvents: 'none',
                    zIndex: 25,
                  }}
                >
                  {guides.x.map((x, i) => (
                    <div
                      key={`gx-${i}`}
                      style={{
                        position: 'absolute',
                        left: x - 0.5,
                        top: 0,
                        width: 1,
                        height: '100%',
                        borderLeft: `1px dashed var(--accent)`,
                      }}
                    />
                  ))}
                  {guides.y.map((y, i) => (
                    <div
                      key={`gy-${i}`}
                      style={{
                        position: 'absolute',
                        top: y - 0.5,
                        left: 0,
                        height: 1,
                        width: '100%',
                        borderTop: `1px dashed var(--accent)`,
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {ghost?.src && (
        <div
          className="drag-ghost"
          style={{
            left: ghost.x,
            top: ghost.y,
            backgroundImage: `url(${ghost.src})`,
            outline: ghost.mode === 'cell' ? '2px dashed var(--accent)' : '2px solid var(--accent)',
          }}
        />
      )}

      <div className="stage-foot">
        <div className="flex items-center gap-1">
          <button
            className="icon-btn"
            style={{ width: 24, height: 22 }}
            onClick={() =>
              dispatch({ type: 'SET_ZOOM', zoom: Math.max(0.25, +(canvasState.zoom - 0.1).toFixed(2)) })
            }
            title="Zoom out"
          >
            <ZoomOut size={14} />
          </button>
          <span className="pill" style={{ minWidth: 56, textAlign: 'center' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            className="icon-btn"
            style={{ width: 24, height: 22 }}
            onClick={() =>
              dispatch({ type: 'SET_ZOOM', zoom: Math.min(3, +(canvasState.zoom + 0.1).toFixed(2)) })
            }
            title="Zoom in"
          >
            <ZoomIn size={14} />
          </button>
          <button
            className="icon-btn"
            style={{ width: 24, height: 22, marginLeft: 4 }}
            onClick={() => dispatch({ type: 'SET_ZOOM', zoom: 1 })}
            title="Fit to screen"
          >
            <RotateCcw size={14} />
          </button>
        </div>
        <span className="sep" />
        <span>
          {dims.w} × {dims.h}
        </span>
        <span className="sep" />
        <span>
          {cells.length} {cells.length === 1 ? 'cell' : 'cells'}
        </span>
        <span className="sep" />
        <span>
          {grid.cols} × {grid.rows} grid
        </span>
        <span className="ml-auto" />
        <span style={{ color: 'var(--text-4)' }}>
          Click empty · Drag inside selected to position · Shift-drag to swap cells
        </span>
      </div>
    </div>
  );
}

// ---- Resize handle overlay (sits on top of grid, NOT inside cell) ---------
interface ResizeHandlesProps {
  cell: Cell | undefined;
  grid: GridConfigShape;
  container: { padding: number; gap: number };
  dims: { w: number; h: number };
  zoom: number;
  onHandleDown: (e: MouseEvent, cell: Cell, dir: ResizeDir) => void;
}

interface GridConfigShape {
  cols: number;
  rows: number;
  colSizes?: number[];
  rowSizes?: number[];
}

const ResizeHandles = memo(function ResizeHandles({
  cell,
  grid,
  container,
  dims,
  zoom,
  onHandleDown,
}: ResizeHandlesProps) {
  if (!cell) return null;
  const innerW = dims.w - container.padding * 2 - container.gap * (grid.cols - 1);
  const innerH = dims.h - container.padding * 2 - container.gap * (grid.rows - 1);
  const r = computeCellRect(cell, grid as GridConfigShape, innerW, innerH, container.padding, container.gap);
  const cx = r.x;
  const cy = r.y;
  const cw = r.w;
  const ch = r.h;

  // Counter-scale so handles render at a constant ~14px on screen even when
  // the board is zoomed out (otherwise they shrink to a few pixels and feel
  // unclickable).
  const z = zoom > 0 ? zoom : 1;
  const visual = 14 / z;     // visible pip
  const hit = Math.max(visual, 22 / z); // larger invisible hit target
  const positions: Record<ResizeDir, { x: number; y: number; cursor: string }> = {
    nw: { x: cx, y: cy, cursor: 'nwse-resize' },
    n:  { x: cx + cw / 2, y: cy, cursor: 'ns-resize' },
    ne: { x: cx + cw, y: cy, cursor: 'nesw-resize' },
    e:  { x: cx + cw, y: cy + ch / 2, cursor: 'ew-resize' },
    se: { x: cx + cw, y: cy + ch, cursor: 'nwse-resize' },
    s:  { x: cx + cw / 2, y: cy + ch, cursor: 'ns-resize' },
    sw: { x: cx, y: cy + ch, cursor: 'nesw-resize' },
    w:  { x: cx, y: cy + ch / 2, cursor: 'ew-resize' },
  };
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 20,
      }}
    >
      {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as ResizeDir[]).map((d) => {
        const p = positions[d];
        return (
          <div
            key={d}
            data-handle-dir={d}
            onMouseDown={(e) => onHandleDown(e, cell, d)}
            style={{
              position: 'absolute',
              width: hit,
              height: hit,
              left: p.x - hit / 2,
              top: p.y - hit / 2,
              cursor: p.cursor,
              pointerEvents: 'auto',
              display: 'grid',
              placeItems: 'center',
              background: 'transparent',
            }}
          >
            <div
              style={{
                width: visual,
                height: visual,
                background: 'var(--accent)',
                border: `${2 / z}px solid var(--handle-border)`,
                borderRadius: 3 / z,
                boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                pointerEvents: 'none',
              }}
            />
          </div>
        );
      })}
    </div>
  );
});

interface CellViewProps {
  cell: Cell;
  rect: { x: number; y: number; w: number; h: number };
  selected: boolean;
  primary: boolean;
  swapOver: boolean;
  onMouseDown: (e: MouseEvent, cell: Cell, imgEl: HTMLImageElement | null) => void;
  onUpload: () => void;
  onRemove: () => void;
  onScale: (cell: Cell, factor: number) => void;
}


const CellView = memo(function CellView({
  cell,
  rect,
  selected,
  primary,
  swapOver,
  onMouseDown,
  onUpload,
  onRemove,
  onScale,
}: CellViewProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const cellShape = cellShapeCSS(cell.shape, cell.cellRadius);

  const cellStyle: CSSProperties = {
    position: 'absolute',
    left: rect.x,
    top: rect.y,
    width: rect.w,
    height: rect.h,
    ...cellShape,
    boxShadow:
      cell.cellBorder > 0
        ? `0 0 0 ${cell.cellBorder}px ${cell.cellBorderColor} inset`
        : 'none',
    viewTransitionName: `cell-${cell.id}`,
  };
  // 'native' = render image at its intrinsic pixel size in design space, so
  // the preview crops match what the backend will emit during export. The IMG
  // box is set to image.w × image.h (the original dimensions); the previewUrl
  // is upscaled to fill it (slightly blurry in preview, sharp on export).
  // Other fits use the original CSS object-fit pipeline.
  const imgStyle: CSSProperties | undefined = cell.image
    ? cell.fit === 'native'
      ? {
          width: cell.image.w,
          height: cell.image.h,
          maxWidth: 'none',
          maxHeight: 'none',
          top: '50%',
          left: '50%',
          transform: `translate(-50%, -50%) translate(${cell.offsetX}px, ${cell.offsetY}px) scale(${cell.scale}) rotate(${cell.rotation}deg)`,
          filter: cell.filter !== 'none' ? cell.filter : 'none',
        }
      : {
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: cell.fit,
          transform: `translate(${cell.offsetX}px, ${cell.offsetY}px) scale(${cell.scale}) rotate(${cell.rotation}deg)`,
          filter: cell.filter !== 'none' ? cell.filter : 'none',
        }
    : undefined;

  return (
    <div
      data-cell-id={cell.id}
      className={`cell${selected ? ' selected' : ''}${primary ? ' primary' : ''}${!cell.image ? ' empty' : ''}${swapOver ? ' drag-over' : ''}`}
      style={cellStyle}
      onMouseDown={(e) => onMouseDown(e, cell, imgRef.current)}
      onDoubleClick={onUpload}
      onWheel={(e) => {
        if (!cell.image) return;
        // Wheel zooms the image inside the cell. Multiplicative step keeps
        // both directions feeling symmetric across very large/small scales.
        e.preventDefault();
        e.stopPropagation();
        const factor = Math.exp(-e.deltaY * 0.0015);
        onScale(cell, factor);
      }}
    >
      {cell.image?.previewUrl ? (
        <img
          ref={imgRef}
          className="cell-img"
          src={cell.image.previewUrl}
          alt=""
          style={imgStyle}
          draggable={false}
        />
      ) : cell.image ? (
        <div className="empty-content">
          <span>loading…</span>
        </div>
      ) : (
        <div className="empty-content">
          <ImageIcon size={14} />
          <span>click to upload</span>
        </div>
      )}
      <div className="cell-controls">
        <button
          title={cell.image ? 'Replace' : 'Upload'}
          onClick={(e) => {
            e.stopPropagation();
            onUpload();
          }}
        >
          <Upload size={14} />
        </button>
        <button
          title="Remove cell"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
});
