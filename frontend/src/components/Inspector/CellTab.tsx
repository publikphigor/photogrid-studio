import { useState } from 'react';
import { Columns, Layers, Rows, Trash2, Upload } from 'lucide-react';
import type {
  Action,
  Cell,
  CellFilters,
  FitMode,
  PhotoGridState,
  ShapeId,
} from '@/types';
import { Slider } from '@/components/controls/Slider';
import { Seg } from '@/components/controls/Seg';
import { ColorField } from '@/components/controls/ColorField';
import { SHAPES } from '@/state/shapes';
import type { UploadBatch } from '@/App';
import {
  DEFAULT_FILTERS,
  cellPixelSize,
  computeCellRect,
  coverFitScale,
  filtersToCss,
  getCellFilters,
} from '@/state/reducer';
import { dimensionsFor } from '@/state/presets';

interface Props {
  state: PhotoGridState;
  dispatch: (a: Action) => void;
  uploading?: boolean;
  uploadBatch?: UploadBatch;
}

export function CellTab({ state, dispatch, uploading = false, uploadBatch }: Props) {
  const selectedIds = state.selectedCellIds;
  const cell = state.cells.find((c) => c.id === selectedIds[0]);
  const multi = selectedIds.length >= 2;
  if (!cell) {
    return (
      <div
        className="section"
        style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)' }}
      >
        <p style={{ margin: 0 }}>Select a cell to edit its properties.</p>
        <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--text-4)' }}>
          Click a cell on the canvas, or pick one from Layers.
        </p>
      </div>
    );
  }
  const set = (patch: Partial<Cell>) => {
    if (multi) {
      dispatch({ type: 'UPDATE_CELLS', ids: selectedIds, patch });
    } else {
      dispatch({ type: 'UPDATE_CELL', id: cell.id, patch });
    }
  };
  const onSplit = (axis: 'row' | 'col', count: number) => {
    dispatch({ type: 'SPLIT_CELL', id: cell.id, axis, count });
  };

  const onPick = () => {
    if (uploading || !uploadBatch) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const [img] = await uploadBatch([file]);
      if (!img) return;
      const dims = dimensionsFor(state.container.aspect, state.output.baseSize);
      const innerW =
        dims.w - state.container.padding * 2 - state.container.gap * (state.grid.cols - 1);
      const innerH =
        dims.h - state.container.padding * 2 - state.container.gap * (state.grid.rows - 1);
      const sz = cellPixelSize(cell, state.grid, innerW, innerH, state.container.gap);
      const scale = cell.fit === 'native' ? coverFitScale(sz.w, sz.h, img.w, img.h) : 1;
      dispatch({
        type: 'UPDATE_CELL',
        id: cell.id,
        patch: { image: img, offsetX: 0, offsetY: 0, scale },
      });
    };
    input.click();
  };

  const currentFilters = getCellFilters(cell);
  const setFilter = (patch: Partial<CellFilters>) => {
    const next = { ...currentFilters, ...patch };
    set({ filters: next, filter: filtersToCss(next) });
  };
  const resetFilters = () => {
    set({ filters: { ...DEFAULT_FILTERS }, filter: 'none' });
  };

  return (
    <>
      {multi && (
        <div className="section">
          <h4 className="section-title">{selectedIds.length} cells selected</h4>
          <p style={{ margin: '0 0 8px', fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.5 }}>
            Style edits below apply to every selected cell. Position, Split, and
            image upload are hidden — they only make sense for a single cell.
          </p>
          <div className="flex gap-2">
            <button
              className="btn"
              style={{ flex: 1 }}
              onClick={() => dispatch({ type: 'MERGE_CELLS', ids: selectedIds })}
              title="Merge selected cells into one (first cell's image wins) — ⌘M"
            >
              <Layers size={14} /> Merge
            </button>
            <button
              className="btn"
              style={{ flex: 1, color: 'var(--danger)' }}
              onClick={() => {
                for (const id of selectedIds) dispatch({ type: 'REMOVE_CELL', id });
              }}
            >
              <Trash2 size={14} /> Delete all
            </button>
          </div>
        </div>
      )}

      {!multi && (
        <div className="section">
          <h4 className="section-title">Image</h4>
          {cell.image ? (
            <div className="flex gap-2 mb-2.5">
              <div
                style={{
                  width: 60,
                  height: 60,
                  flexShrink: 0,
                  borderRadius: 6,
                  backgroundImage: cell.image.previewUrl ? `url(${cell.image.previewUrl})` : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  boxShadow: 'inset 0 0 0 1px var(--line)',
                }}
              />
              <div className="flex-1 min-w-0">
                <div
                  style={{
                    fontSize: 12,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {cell.image.name}
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-3)' }}>
                  {cell.image.w} × {cell.image.h}
                </div>
              </div>
            </div>
          ) : (
            <p style={{ margin: '0 0 10px', color: 'var(--text-3)', fontSize: 12 }}>
              No image yet — drop one on the cell or upload below.
            </p>
          )}
          <button className="btn w-full" onClick={onPick} disabled={uploading}>
            <Upload size={14} /> {uploading ? 'Uploading…' : cell.image ? 'Replace' : 'Upload'}
          </button>
        </div>
      )}

      {(cell.image || multi) && (
        <>
          <div className="section">
            <h4 className="section-title">Fit</h4>
            <Seg
              options={[
                { value: 'native' as FitMode, label: 'Native' },
                { value: 'cover' as FitMode, label: 'Cover' },
                { value: 'contain' as FitMode, label: 'Contain' },
                { value: 'fill' as FitMode, label: 'Fill' },
              ]}
              value={cell.fit}
              onChange={(v) => set({ fit: v })}
            />
            <div className="row" style={{ marginTop: 10 }}>
              <label>Zoom</label>
              <Slider value={cell.scale} min={0.05} max={5} step={0.01} onChange={(v) => set({ scale: v })} />
            </div>
            <div className="row">
              <label>Offset X</label>
              <Slider
                value={cell.offsetX}
                min={-Math.max(800, cell.image?.w ?? 0)}
                max={Math.max(800, cell.image?.w ?? 0)}
                onChange={(v) => set({ offsetX: v })}
                suffix="px"
              />
            </div>
            <div className="row">
              <label>Offset Y</label>
              <Slider
                value={cell.offsetY}
                min={-Math.max(800, cell.image?.h ?? 0)}
                max={Math.max(800, cell.image?.h ?? 0)}
                onChange={(v) => set({ offsetY: v })}
                suffix="px"
              />
            </div>
            <div className="row">
              <label>Rotate</label>
              <Slider value={cell.rotation} min={-180} max={180} onChange={(v) => set({ rotation: v })} suffix="°" />
            </div>
          </div>

          <div className="section">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 10,
              }}
            >
              <h4 className="section-title" style={{ margin: 0 }}>Filter</h4>
              <button
                className="btn ghost"
                style={{ height: 22, padding: '0 8px', fontSize: 11 }}
                onClick={resetFilters}
                title="Reset all filters"
              >
                Reset
              </button>
            </div>
            <div className="row">
              <label>Grayscale</label>
              <Slider
                value={Math.round(currentFilters.grayscale * 100)}
                min={0}
                max={100}
                onChange={(v) => setFilter({ grayscale: v / 100 })}
                suffix="%"
              />
            </div>
            <div className="row">
              <label>Sepia</label>
              <Slider
                value={Math.round(currentFilters.sepia * 100)}
                min={0}
                max={100}
                onChange={(v) => setFilter({ sepia: v / 100 })}
                suffix="%"
              />
            </div>
            <div className="row">
              <label>Contrast</label>
              <Slider
                value={Math.round(currentFilters.contrast * 100)}
                min={0}
                max={200}
                onChange={(v) => setFilter({ contrast: v / 100 })}
                suffix="%"
              />
            </div>
            <div className="row">
              <label>Brightness</label>
              <Slider
                value={Math.round(currentFilters.brightness * 100)}
                min={0}
                max={200}
                onChange={(v) => setFilter({ brightness: v / 100 })}
                suffix="%"
              />
            </div>
            <div className="row">
              <label>Saturate</label>
              <Slider
                value={Math.round(currentFilters.saturate * 100)}
                min={0}
                max={200}
                onChange={(v) => setFilter({ saturate: v / 100 })}
                suffix="%"
              />
            </div>
            <div className="row">
              <label>Hue</label>
              <Slider
                value={Math.round(currentFilters.hueRotate)}
                min={-180}
                max={180}
                onChange={(v) => setFilter({ hueRotate: v })}
                suffix="°"
              />
            </div>
            <div className="row">
              <label>Invert</label>
              <Slider
                value={Math.round(currentFilters.invert * 100)}
                min={0}
                max={100}
                onChange={(v) => setFilter({ invert: v / 100 })}
                suffix="%"
              />
            </div>
            <div className="row">
              <label>Blur</label>
              <Slider
                value={currentFilters.blur}
                min={0}
                max={20}
                step={0.1}
                onChange={(v) => setFilter({ blur: v })}
                suffix="px"
              />
            </div>
          </div>
        </>
      )}

      {!multi && (
        <div className="section">
          <h4 className="section-title">Position</h4>
          <CellSize cell={cell} state={state} />
          <div className="grid grid-cols-2 gap-x-2 gap-y-2">
            <PositionField
              label="Span W"
              title="Column span"
              min={1}
              max={state.grid.cols}
              value={cell.colSpan}
              onCommit={(v) =>
                dispatch({ type: 'RESIZE_CELL', id: cell.id, colSpan: v, rowSpan: cell.rowSpan })
              }
            />
            <PositionField
              label="Span H"
              title="Row span"
              min={1}
              max={state.grid.rows}
              value={cell.rowSpan}
              onCommit={(v) =>
                dispatch({ type: 'RESIZE_CELL', id: cell.id, colSpan: cell.colSpan, rowSpan: v })
              }
            />
            <PositionField
              label="Col"
              title="Column start"
              min={1}
              max={state.grid.cols}
              value={cell.colStart}
              onCommit={(v) =>
                dispatch({ type: 'MOVE_CELL', id: cell.id, col: v, row: cell.rowStart })
              }
            />
            <PositionField
              label="Row"
              title="Row start"
              min={1}
              max={state.grid.rows}
              value={cell.rowStart}
              onCommit={(v) =>
                dispatch({ type: 'MOVE_CELL', id: cell.id, col: cell.colStart, row: v })
              }
            />
          </div>
        </div>
      )}

      {!multi && (
        <div className="section">
          <h4 className="section-title">Split</h4>
          <SplitControls onSplit={onSplit} />
          <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-4)', lineHeight: 1.55 }}>
            Splits this cell into N rows or columns. Other cells in the same band keep
            their visual size. The image (if any) is copied into every new sub-cell.
          </p>
        </div>
      )}

      <div className="section">
        <h4 className="section-title">Shape</h4>
        <div className="grid grid-cols-5 gap-1">
          {(Object.entries(SHAPES) as [ShapeId, (typeof SHAPES)[ShapeId]][]).map(([k, v]) => (
            <button
              key={k}
              title={v.name}
              onClick={() => set({ shape: k })}
              style={{
                aspectRatio: '1 / 1',
                borderRadius: 6,
                background: cell.shape === k ? 'var(--accent-soft)' : 'var(--panel-2)',
                border: `1px solid ${cell.shape === k ? 'var(--accent)' : 'var(--line)'}`,
                color: cell.shape === k ? 'var(--accent)' : 'var(--text-2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d={v.iconPath} />
              </svg>
            </button>
          ))}
        </div>
      </div>

      <div className="section">
        <h4 className="section-title">Cell Style</h4>
        {cell.shape === 'rounded' && (
          <div className="row">
            <label>Radius</label>
            <Slider value={cell.cellRadius} min={0} max={200} onChange={(v) => set({ cellRadius: v })} suffix="px" />
          </div>
        )}
        <div className="row">
          <label>Border</label>
          <Slider value={cell.cellBorder} min={0} max={32} onChange={(v) => set({ cellBorder: v })} suffix="px" />
        </div>
        {cell.cellBorder > 0 && (
          <div className="row">
            <label>Color</label>
            <ColorField value={cell.cellBorderColor} onChange={(v) => set({ cellBorderColor: v })} />
          </div>
        )}
      </div>

      {!multi && (
        <div className="section">
          <button
            className="btn w-full"
            style={{ color: 'var(--danger)', borderColor: 'transparent' }}
            onClick={() => dispatch({ type: 'REMOVE_CELL', id: cell.id })}
          >
            <Trash2 size={14} /> Remove cell
          </button>
        </div>
      )}
    </>
  );
}

function SplitControls({ onSplit }: { onSplit: (axis: 'row' | 'col', count: number) => void }) {
  const [raw, setRaw] = useState('2');
  const n = clampInt(raw, 2, 8, 2);
  return (
    <div className="row" style={{ marginBottom: 0 }}>
      <label>Count</label>
      <div className="flex items-center gap-2">
        <input
          className="num-input"
          type="text"
          inputMode="decimal"
          pattern="[0-9,.]*"
          value={raw}
          onChange={(e) => setRaw(e.target.value.replace(/[^0-9]/g, ''))}
          style={{ width: 56 }}
        />
        <button
          className="btn"
          style={{ height: 28, flex: 1 }}
          onClick={() => onSplit('row', n)}
          title={`Split into ${n} rows`}
        >
          <Rows size={14} /> Rows
        </button>
        <button
          className="btn"
          style={{ height: 28, flex: 1 }}
          onClick={() => onSplit('col', n)}
          title={`Split into ${n} columns`}
        >
          <Columns size={14} /> Cols
        </button>
      </div>
    </div>
  );
}

function CellSize({ cell, state }: { cell: Cell; state: PhotoGridState }) {
  const dims = dimensionsFor(state.container.aspect, state.output.baseSize);
  const innerW =
    dims.w - state.container.padding * 2 - state.container.gap * (state.grid.cols - 1);
  const innerH =
    dims.h - state.container.padding * 2 - state.container.gap * (state.grid.rows - 1);
  const rect = computeCellRect(
    cell,
    state.grid,
    innerW,
    innerH,
    state.container.padding,
    state.container.gap,
  );
  return (
    <div
      style={{
        marginBottom: 10,
        fontFamily: 'var(--mono)',
        fontSize: 11,
        color: 'var(--text-3)',
      }}
    >
      {Math.round(rect.w)} × {Math.round(rect.h)} px
    </div>
  );
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function PositionField({
  label,
  title,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  title: string;
  value: number;
  min: number;
  max: number;
  onCommit: (v: number) => void;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  const display = raw ?? String(value);
  return (
    <label className="row col" style={{ margin: 0, gap: 4 }} title={title}>
      <span style={{ fontSize: 10.5, color: 'var(--text-3)', letterSpacing: '0.04em' }}>
        {label}
      </span>
      <input
        className="num-input"
        type="text"
        inputMode="numeric"
        value={display}
        onFocus={(e) => {
          setRaw(String(value));
          e.currentTarget.select();
        }}
        onChange={(e) => setRaw(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={() => {
          if (raw == null) return;
          if (raw.trim().length > 0) {
            const n = Math.max(min, Math.min(max, Number.parseInt(raw, 10)));
            if (Number.isFinite(n)) onCommit(n);
          }
          setRaw(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setRaw(null);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </label>
  );
}
