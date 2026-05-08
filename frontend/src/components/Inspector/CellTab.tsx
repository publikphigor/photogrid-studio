import { Trash2, Upload } from 'lucide-react';
import type { Action, Cell, FitMode, PhotoGridState, ShapeId } from '@/types';
import { Slider } from '@/components/controls/Slider';
import { Seg } from '@/components/controls/Seg';
import { ColorField } from '@/components/controls/ColorField';
import { SHAPES } from '@/state/shapes';
import { ingestFile } from '@/api/client';

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
  const cell = state.cells.find((c) => c.id === state.selectedCellId);
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

  const onPick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const img = await ingestFile(file);
        set({ image: img, offsetX: 0, offsetY: 0, scale: 1 });
      } catch (e) {
        console.error('upload failed', e);
      }
    };
    input.click();
  };

  return (
    <>
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
                { value: 'cover' as FitMode, label: 'Cover' },
                { value: 'contain' as FitMode, label: 'Contain' },
                { value: 'fill' as FitMode, label: 'Fill' },
              ]}
              value={cell.fit}
              onChange={(v) => set({ fit: v })}
            />
            <div className="row" style={{ marginTop: 10 }}>
              <label>Zoom</label>
              <Slider value={cell.scale} min={0.5} max={3} step={0.05} onChange={(v) => set({ scale: v })} />
            </div>
            <div className="row">
              <label>Offset X</label>
              <Slider value={cell.offsetX} min={-200} max={200} onChange={(v) => set({ offsetX: v })} suffix="px" />
            </div>
            <div className="row">
              <label>Offset Y</label>
              <Slider value={cell.offsetY} min={-200} max={200} onChange={(v) => set({ offsetY: v })} suffix="px" />
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
