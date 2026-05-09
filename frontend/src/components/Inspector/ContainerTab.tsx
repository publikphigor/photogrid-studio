import { AlignCenterHorizontal, Image as ImageIcon, Plus, X } from 'lucide-react';
import type {
  Action,
  Container,
  ContainerBgFit,
  GridConfig,
  PhotoGridState,
  ShapeId,
} from '@/types';
import { ASPECT_RATIOS } from '@/state/presets';
import { SHAPES } from '@/state/shapes';
import { Slider } from '@/components/controls/Slider';
import { Seg } from '@/components/controls/Seg';
import { ColorField } from '@/components/controls/ColorField';
import { Check } from '@/components/controls/Check';
import { ingestFile } from '@/api/client';

interface Props {
  state: PhotoGridState;
  dispatch: (a: Action) => void;
}

export function ContainerTab({ state, dispatch }: Props) {
  const c = state.container;
  const set = (patch: Partial<Container>) => dispatch({ type: 'SET_CONTAINER', patch });
  const setGrid = (patch: Partial<GridConfig>) => dispatch({ type: 'SET_GRID', patch });

  const pickBgImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const img = await ingestFile(f);
        set({ bgImage: img });
      } catch (e) {
        console.error('bg upload failed', e);
      }
    };
    input.click();
  };

  return (
    <>
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
                background: c.shape === k ? 'var(--accent-soft)' : 'var(--panel-2)',
                border: `1px solid ${c.shape === k ? 'var(--accent)' : 'var(--line)'}`,
                color: c.shape === k ? 'var(--accent)' : 'var(--text-2)',
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
        {c.shape === 'rounded' && (
          <div className="row" style={{ marginTop: 12 }}>
            <label>Corner</label>
            <Slider value={c.cornerRadius} min={0} max={200} onChange={(v) => set({ cornerRadius: v })} suffix="px" />
          </div>
        )}
      </div>

      <div className="section">
        <h4 className="section-title">Aspect Ratio</h4>
        <select
          className="num-input"
          style={{ height: 28, width: '100%', textAlign: 'left', padding: '0 8px' }}
          value={c.aspect}
          onChange={(e) => set({ aspect: e.target.value })}
        >
          {ASPECT_RATIOS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label} ({r.id})
            </option>
          ))}
        </select>
      </div>

      <div className="section">
        <h4 className="section-title">Grid</h4>
        <div className="row">
          <label>Columns</label>
          <Slider value={state.grid.cols} min={1} max={8} onChange={(v) => setGrid({ cols: v })} />
        </div>
        <div className="row">
          <label>Rows</label>
          <Slider value={state.grid.rows} min={1} max={8} onChange={(v) => setGrid({ rows: v })} />
        </div>
        <div className="row">
          <label>Gap</label>
          <Slider value={c.gap} min={0} max={64} onChange={(v) => set({ gap: v })} suffix="px" />
        </div>
        <div className="row">
          <label>Padding</label>
          <Slider value={c.padding} min={0} max={120} onChange={(v) => set({ padding: v })} suffix="px" />
        </div>
        <button className="btn w-full mt-1" onClick={() => dispatch({ type: 'ADD_CELL' })}>
          <Plus size={14} /> Add Cell
        </button>
        <button
          className="btn w-full mt-1"
          onClick={() => dispatch({ type: 'ALIGN_GRID' })}
          title="Snap cells to a clean column/row grid; absorb leftover whitespace"
        >
          <AlignCenterHorizontal size={14} /> Align Grid
        </button>
      </div>

      <div className="section">
        <h4 className="section-title">Background</h4>
        <div className="row">
          <label>Color</label>
          <ColorField value={c.bg} onChange={(v) => set({ bg: v })} />
        </div>
        <Check checked={c.bgTransparent} onChange={(v) => set({ bgTransparent: v })}>
          Transparent background
        </Check>
        <div className="row-stack" style={{ marginTop: 6 }}>
          <label>Image</label>
          {c.bgImage ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <button
                className="field"
                onClick={pickBgImage}
                title="Click to replace"
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                {c.bgImage.previewUrl && (
                  <span
                    aria-hidden
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 3,
                      backgroundImage: `url(${c.bgImage.previewUrl})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      flexShrink: 0,
                      boxShadow: 'inset 0 0 0 1px var(--line)',
                    }}
                  />
                )}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.bgImage.name}
                </span>
              </button>
              <button
                className="btn ghost"
                style={{ height: 28, padding: '0 8px' }}
                onClick={() => set({ bgImage: null })}
                title="Remove background image"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <button className="btn" style={{ width: '100%' }} onClick={pickBgImage}>
              <ImageIcon size={14} /> Upload image…
            </button>
          )}
        </div>
        {c.bgImage && (
          <div className="row">
            <label>Fit</label>
            <Seg
              options={[
                { value: 'cover' as ContainerBgFit, label: 'Cover' },
                { value: 'contain' as ContainerBgFit, label: 'Contain' },
                { value: 'fill' as ContainerBgFit, label: 'Fill' },
              ]}
              value={c.bgImageFit}
              onChange={(v) => set({ bgImageFit: v })}
            />
          </div>
        )}
      </div>

      <div className="section">
        <h4 className="section-title">Border</h4>
        <div className="row">
          <label>Width</label>
          <Slider value={c.borderWidth} min={0} max={32} onChange={(v) => set({ borderWidth: v })} suffix="px" />
        </div>
        <div className="row">
          <label>Color</label>
          <ColorField value={c.borderColor} onChange={(v) => set({ borderColor: v })} />
        </div>
      </div>
    </>
  );
}
