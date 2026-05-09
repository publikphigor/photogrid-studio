import { useState } from 'react';
import { Columns, Layers, Rows, Trash2, Upload } from 'lucide-react';
import type { Action, Cell, FitMode, PhotoGridState, ShapeId } from '@/types';
import { Slider } from '@/components/controls/Slider';
import { Seg } from '@/components/controls/Seg';
import { ColorField } from '@/components/controls/ColorField';
import { SHAPES } from '@/state/shapes';
import { ingestFile } from '@/api/client';
import { cellPixelSize, coverFitScale } from '@/state/reducer';
import { dimensionsFor } from '@/state/presets';

interface Props {
  state: PhotoGridState;
  dispatch: (a: Action) => void;
}

const FILTERS = [
  { value: 'none', label: 'None' },
  { value: 'grayscale(100%)', label: 'Grayscale' },
  { value: 'sepia(80%)', label: 'Sepia' },
  { value: 'contrast(1.15) saturate(1.2)', label: 'Vivid' },
  { value: 'brightness(1.1) contrast(0.95) saturate(0.85)', label: 'Soft' },
  { value: 'contrast(1.3) saturate(0.7)', label: 'Faded' },
  { value: 'hue-rotate(180deg)', label: 'Cool' },
  { value: 'contrast(1.1) brightness(0.9) sepia(0.2)', label: 'Vintage' },
];

export function CellTab({ state, dispatch }: Props) {
  const cell = state.cells.find((c) => c.id === state.selectedCellIds[0]);
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
  const set = (patch: Partial<Cell>) => dispatch({ type: 'UPDATE_CELL', id: cell.id, patch });
  const onSplit = (axis: 'row' | 'col', count: number) => {
    dispatch({ type: 'SPLIT_CELL', id: cell.id, axis, count });
  };

  const onPick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const img = await ingestFile(file);
        const dims = dimensionsFor(state.container.aspect, state.output.baseSize);
        const innerW =
          dims.w - state.container.padding * 2 - state.container.gap * (state.grid.cols - 1);
        const innerH =
          dims.h - state.container.padding * 2 - state.container.gap * (state.grid.rows - 1);
        const sz = cellPixelSize(cell, state.grid, innerW, innerH, state.container.gap);
        const scale = cell.fit === 'native' ? coverFitScale(sz.w, sz.h, img.w, img.h) : 1;
        set({ image: img, offsetX: 0, offsetY: 0, scale });
      } catch (e) {
        console.error('upload failed', e);
      }
    };
    input.click();
  };

  return (
    <>
      {state.selectedCellIds.length >= 2 && (
        <div className="section">
          <h4 className="section-title">{state.selectedCellIds.length} cells selected</h4>
          <button
            className="btn w-full"
            onClick={() => dispatch({ type: 'MERGE_CELLS', ids: state.selectedCellIds })}
            title="Merge selected cells into one (first cell's image wins) — ⌘M"
          >
            <Layers size={14} /> Merge into one
          </button>
          <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--text-3)' }}>
            Inspector below shows the primary cell — the one whose image survives the merge.
          </p>
        </div>
      )}
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
        <button className="btn w-full" onClick={onPick}>
          <Upload size={14} /> {cell.image ? 'Replace' : 'Upload'}
        </button>
      </div>

      {cell.image && (
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
            <h4 className="section-title">Filter</h4>
            <select
              className="num-input"
              style={{ height: 28, width: '100%', textAlign: 'left', padding: '0 8px' }}
              value={cell.filter}
              onChange={(e) => set({ filter: e.target.value })}
            >
              {FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      <div className="section">
        <h4 className="section-title">Position</h4>
        <div className="grid grid-cols-2 gap-2">
          <label className="row col" style={{ margin: 0 }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Column span</span>
            <input
              className="num-input"
              type="number"
              min={1}
              max={state.grid.cols}
              value={cell.colSpan}
              onChange={(e) =>
                dispatch({ type: 'RESIZE_CELL', id: cell.id, colSpan: +e.target.value, rowSpan: cell.rowSpan })
              }
            />
          </label>
          <label className="row col" style={{ margin: 0 }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Row span</span>
            <input
              className="num-input"
              type="number"
              min={1}
              max={state.grid.rows}
              value={cell.rowSpan}
              onChange={(e) =>
                dispatch({ type: 'RESIZE_CELL', id: cell.id, colSpan: cell.colSpan, rowSpan: +e.target.value })
              }
            />
          </label>
          <label className="row col" style={{ margin: 0 }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Column</span>
            <input
              className="num-input"
              type="number"
              min={1}
              max={state.grid.cols}
              value={cell.colStart}
              onChange={(e) =>
                dispatch({ type: 'MOVE_CELL', id: cell.id, col: +e.target.value, row: cell.rowStart })
              }
            />
          </label>
          <label className="row col" style={{ margin: 0 }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Row</span>
            <input
              className="num-input"
              type="number"
              min={1}
              max={state.grid.rows}
              value={cell.rowStart}
              onChange={(e) =>
                dispatch({ type: 'MOVE_CELL', id: cell.id, col: cell.colStart, row: +e.target.value })
              }
            />
          </label>
        </div>
      </div>

      <div className="section">
        <h4 className="section-title">Split</h4>
        <SplitControls onSplit={onSplit} />
        <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-4)', lineHeight: 1.55 }}>
          Splits this cell into N rows or columns. Other cells in the same band keep
          their visual size. The image (if any) is copied into every new sub-cell.
        </p>
      </div>

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
            <Slider value={cell.cellRadius} min={0} max={50} onChange={(v) => set({ cellRadius: v })} suffix="%" />
          </div>
        )}
        {cell.shape !== 'rounded' && (
          <div className="row" style={{ display: 'none' }}><label /><span /></div>
        )}
        <div className="row">
          <label>Border</label>
          <Slider value={cell.cellBorder} min={0} max={20} onChange={(v) => set({ cellBorder: v })} suffix="px" />
        </div>
        {cell.cellBorder > 0 && (
          <div className="row">
            <label>Color</label>
            <ColorField value={cell.cellBorderColor} onChange={(v) => set({ cellBorderColor: v })} />
          </div>
        )}
      </div>

      <div className="section">
        <button
          className="btn w-full"
          style={{ color: 'var(--danger)', borderColor: 'transparent' }}
          onClick={() => dispatch({ type: 'REMOVE_CELL', id: cell.id })}
        >
          <Trash2 size={14} /> Remove cell
        </button>
      </div>
    </>
  );
}

function SplitControls({ onSplit }: { onSplit: (axis: 'row' | 'col', count: number) => void }) {
  // Free-typing text input with numeric keyboard hint. Range 2–8 because a
  // higher split makes each sub-cell unusably thin; one-digit keystrokes still
  // cover every realistic case.
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

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
