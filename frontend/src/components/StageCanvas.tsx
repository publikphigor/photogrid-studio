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

interface Props {
  state: PhotoGridState;
  dispatch: (a: Action) => void;
}

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface ResizeState {
  id: string;
  dir: ResizeDir;
  startX: number;
  startY: number;
  startCol: number;
  startRow: number;
  startCs: number;
  startRs: number;
  trackW: number;
  trackH: number;
  lastCol: number;
  lastRow: number;
  lastCs: number;
  lastRs: number;
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
  const { container, grid, cells, selectedCellId, canvas: canvasState } = state;
  const dims = dimensionsFor(container.aspect, state.output.baseSize);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [stageBox, setStageBox] = useState({ w: 800, h: 600 });
  const [dragOver, setDragOver] = useState(false);
  const [resizing, setResizing] = useState<ResizeState | null>(null);
  const [ghost, setGhost] = useState<GhostState | null>(null);

  // Drag bookkeeping outside React state — no re-renders during drag.
  const dragRef = useRef<ActiveDrag | null>(null);
  const rafRef = useRef<number | null>(null);
  // Mirror of cells/state for use inside window listeners (avoid stale closures).
  const cellsRef = useRef(cells);
  cellsRef.current = cells;
  const selectedRef = useRef(selectedCellId);
  selectedRef.current = selectedCellId;

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
  const uploadToCell = (id: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const img = await ingestFile(file);
        dispatch({ type: 'UPDATE_CELL', id, patch: { image: img, offsetX: 0, offsetY: 0, scale: 1 } });
      } catch (e) {
        console.error('upload failed', e);
      }
    };
    input.click();
  };

  // ---- Resize via 8 handles -----------------------------------------------
  const onHandleDown = (e: MouseEvent, cell: Cell, dir: ResizeDir) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const trackW = rect.width / grid.cols;
    const trackH = rect.height / grid.rows;
    setResizing({
      id: cell.id,
      dir,
      startX: e.clientX,
      startY: e.clientY,
      startCol: cell.colStart,
      startRow: cell.rowStart,
      startCs: cell.colSpan,
      startRs: cell.rowSpan,
      trackW,
      trackH,
      lastCol: cell.colStart,
      lastRow: cell.rowStart,
      lastCs: cell.colSpan,
      lastRs: cell.rowSpan,
    });
  };

  // Suppress redundant dispatches and rAF-throttle so reflow doesn't re-run mid-frame.
  useEffect(() => {
    if (!resizing) return;
    let raf: number | null = null;
    const latest = { x: resizing.startX, y: resizing.startY };
    const apply = () => {
      raf = null;
      const dx = latest.x - resizing.startX;
      const dy = latest.y - resizing.startY;
      const dc = Math.round(dx / resizing.trackW);
      const dr = Math.round(dy / resizing.trackH);
      let col = resizing.startCol;
      let row = resizing.startRow;
      let cs = resizing.startCs;
      let rs = resizing.startRs;
      if (resizing.dir.includes('e')) cs = Math.max(1, resizing.startCs + dc);
      if (resizing.dir.includes('w')) {
        const newCs = Math.max(1, resizing.startCs - dc);
        col = Math.max(1, resizing.startCol + (resizing.startCs - newCs));
        cs = newCs;
      }
      if (resizing.dir.includes('s')) rs = Math.max(1, resizing.startRs + dr);
      if (resizing.dir.includes('n')) {
        const newRs = Math.max(1, resizing.startRs - dr);
        row = Math.max(1, resizing.startRow + (resizing.startRs - newRs));
        rs = newRs;
      }
      // Skip if nothing changed since last dispatch.
      if (
        col === resizing.lastCol &&
        row === resizing.lastRow &&
        cs === resizing.lastCs &&
        rs === resizing.lastRs
      ) {
        return;
      }
      resizing.lastCol = col;
      resizing.lastRow = row;
      resizing.lastCs = cs;
      resizing.lastRs = rs;
      dispatch({
        type: 'RESIZE_CELL',
        id: resizing.id,
        colStart: col,
        rowStart: row,
        colSpan: cs,
        rowSpan: rs,
      });
    };
    const onMove = (e: globalThis.MouseEvent) => {
      latest.x = e.clientX;
      latest.y = e.clientY;
      if (raf == null) raf = requestAnimationFrame(apply);
    };
    const onUp = () => setResizing(null);
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

      // Selection happens immediately, regardless of click vs drag.
      if (selectedRef.current !== cell.id) {
        dispatch({ type: 'SELECT', id: cell.id });
      }

      // Empty cell: nothing to drag. Click-to-upload happens on mouseup
      // (we record intent here so a cancelled mousedown doesn't open picker).
      const wasSelectedBeforeClick = selectedRef.current === cell.id;
      const board = wrapRef.current;
      const boardRect = board?.getBoundingClientRect();
      const invZoom = boardRect && boardRect.width > 0 ? dims.w / boardRect.width : 1;

      const kind: DragKind = !cell.image
        ? 'reposition' // dummy; never used because moved=false → click path
        : e.shiftKey
          ? 'move'
          : wasSelectedBeforeClick
            ? 'reposition'
            : 'swap';

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
        curX: e.clientX,
        curY: e.clientY,
        moved: false,
        lastOffsetX: cell.offsetX,
        lastOffsetY: cell.offsetY,
        overId: null,
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
        drag.imgEl.style.transform = `translate(${nx}px, ${ny}px) scale(${drag.scale}) rotate(${drag.rotation}deg)`;
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
        // Pure click — if cell is empty, open file picker.
        if (cell && !cell.image) uploadToCell(cell.id);
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
    if (e.target === e.currentTarget) dispatch({ type: 'SELECT', id: null });
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
              <div
                className="grid-area"
                style={{
                  padding: container.padding,
                  gap: container.gap,
                  gridTemplateColumns: `repeat(${grid.cols}, 1fr)`,
                  gridTemplateRows: `repeat(${grid.rows}, 1fr)`,
                }}
              >
                {cells.map((cell) => (
                  <CellView
                    key={cell.id}
                    cell={cell}
                    selected={selectedCellId === cell.id}
                    swapOver={ghost?.overId === cell.id}
                    onMouseDown={onCellMouseDown}
                    onUpload={() => uploadToCell(cell.id)}
                    onRemove={() => dispatch({ type: 'REMOVE_CELL', id: cell.id })}
                  />
                ))}
              </div>
              <ResizeHandles
                cell={cells.find((c) => c.id === selectedCellId)}
                grid={grid}
                container={container}
                dims={dims}
                onHandleDown={onHandleDown}
              />
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
  grid: { cols: number; rows: number };
  container: { padding: number; gap: number };
  dims: { w: number; h: number };
  onHandleDown: (e: MouseEvent, cell: Cell, dir: ResizeDir) => void;
}

const ResizeHandles = memo(function ResizeHandles({
  cell,
  grid,
  container,
  dims,
  onHandleDown,
}: ResizeHandlesProps) {
  if (!cell) return null;
  const innerW = dims.w - container.padding * 2;
  const innerH = dims.h - container.padding * 2;
  const trackW = (innerW - container.gap * (grid.cols - 1)) / grid.cols;
  const trackH = (innerH - container.gap * (grid.rows - 1)) / grid.rows;
  const cx = container.padding + (cell.colStart - 1) * (trackW + container.gap);
  const cy = container.padding + (cell.rowStart - 1) * (trackH + container.gap);
  const cw = trackW * cell.colSpan + container.gap * (cell.colSpan - 1);
  const ch = trackH * cell.rowSpan + container.gap * (cell.rowSpan - 1);

  const SIZE = 12; // handle px in design space
  const HALF = SIZE / 2;
  const positions: Record<ResizeDir, CSSProperties> = {
    nw: { left: cx - HALF, top: cy - HALF, cursor: 'nwse-resize' },
    n:  { left: cx + cw / 2 - HALF, top: cy - HALF, cursor: 'ns-resize' },
    ne: { left: cx + cw - HALF, top: cy - HALF, cursor: 'nesw-resize' },
    e:  { left: cx + cw - HALF, top: cy + ch / 2 - HALF, cursor: 'ew-resize' },
    se: { left: cx + cw - HALF, top: cy + ch - HALF, cursor: 'nwse-resize' },
    s:  { left: cx + cw / 2 - HALF, top: cy + ch - HALF, cursor: 'ns-resize' },
    sw: { left: cx - HALF, top: cy + ch - HALF, cursor: 'nesw-resize' },
    w:  { left: cx - HALF, top: cy + ch / 2 - HALF, cursor: 'ew-resize' },
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
      {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as ResizeDir[]).map((d) => (
        <div
          key={d}
          data-handle-dir={d}
          onMouseDown={(e) => onHandleDown(e, cell, d)}
          style={{
            position: 'absolute',
            width: SIZE,
            height: SIZE,
            background: 'var(--accent)',
            border: '2px solid var(--handle-border)',
            borderRadius: 3,
            boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
            pointerEvents: 'auto',
            ...positions[d],
          }}
        />
      ))}
    </div>
  );
});

interface CellViewProps {
  cell: Cell;
  selected: boolean;
  swapOver: boolean;
  onMouseDown: (e: MouseEvent, cell: Cell, imgEl: HTMLImageElement | null) => void;
  onUpload: () => void;
  onRemove: () => void;
}


const CellView = memo(function CellView({
  cell,
  selected,
  swapOver,
  onMouseDown,
  onUpload,
  onRemove,
}: CellViewProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const cellShape = cellShapeCSS(cell.shape, cell.cellRadius);

  const cellStyle: CSSProperties = {
    gridColumn: `${cell.colStart} / span ${cell.colSpan}`,
    gridRow: `${cell.rowStart} / span ${cell.rowSpan}`,
    ...cellShape,
    boxShadow:
      cell.cellBorder > 0
        ? `0 0 0 ${cell.cellBorder}px ${cell.cellBorderColor} inset`
        : 'none',
    viewTransitionName: `cell-${cell.id}`,
  };
  const imgStyle: CSSProperties | undefined = cell.image
    ? {
        objectFit: cell.fit,
        transform: `translate(${cell.offsetX}px, ${cell.offsetY}px) scale(${cell.scale}) rotate(${cell.rotation}deg)`,
        filter: cell.filter !== 'none' ? cell.filter : 'none',
      }
    : undefined;

  return (
    <div
      data-cell-id={cell.id}
      className={`cell${selected ? ' selected' : ''}${!cell.image ? ' empty' : ''}${swapOver ? ' drag-over' : ''}`}
      style={cellStyle}
      onMouseDown={(e) => onMouseDown(e, cell, imgRef.current)}
      onDoubleClick={onUpload}
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
