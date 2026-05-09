import { AlignCenterHorizontal, Image as ImageIcon, Plus, X } from 'lucide-react';
import type {
  Action,
  Container,
  ContainerBgFit,
  GridConfig,
  PhotoGridState,
  ShapeId,
  Watermark,
} from '@/types';
import { ASPECT_RATIOS } from '@/state/presets';
import { SHAPES } from '@/state/shapes';
import { Slider } from '@/components/controls/Slider';
import { Seg } from '@/components/controls/Seg';
import { ColorField } from '@/components/controls/ColorField';
import { Check } from '@/components/controls/Check';
import { ingestFile } from '@/api/client';
import { DEFAULT_WATERMARK } from '@/state/reducer';

/** Fonts whose CSS family name has a real-or-fallback TTF on the backend
 *  container. Keep aligned with `_FONT_HINTS` in `backend/.../overlays.py`. */
const WATERMARK_FONT_CHOICES: { value: string; label: string }[] = [
  { value: 'Helvetica, Arial, sans-serif', label: 'Helvetica' },
  { value: 'Georgia, "Times New Roman", serif', label: 'Georgia' },
  { value: '"Courier New", Courier, monospace', label: 'Courier' },
  { value: '"Comic Sans MS", "Chalkboard SE", cursive', label: 'Comic' },
  { value: 'Impact, Charcoal, sans-serif', label: 'Impact' },
  { value: '"Trebuchet MS", sans-serif', label: 'Trebuchet' },
];

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
        <div className="row">
          <label>Blur</label>
          <Slider
            value={c.bgBlur ?? 0}
            min={0}
            max={60}
            step={0.5}
            onChange={(v) => set({ bgBlur: v })}
            suffix="px"
          />
        </div>
        <div className="row">
          <label>Overlay</label>
          <ColorField
            value={c.bgOverlayColor ?? '#000000'}
            onChange={(v) => set({ bgOverlayColor: v })}
          />
        </div>
        <div className="row">
          <label>Tint</label>
          <Slider
            value={Math.round((c.bgOverlayOpacity ?? 0) * 100)}
            min={0}
            max={100}
            onChange={(v) => set({ bgOverlayOpacity: v / 100 })}
            suffix="%"
          />
        </div>
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

      <WatermarkSection state={state} dispatch={dispatch} />
    </>
  );
}

function WatermarkSection({ state, dispatch }: Props) {
  const w = state.container.watermark ?? DEFAULT_WATERMARK;
  const setW = (patch: Partial<Watermark>) => dispatch({ type: 'SET_WATERMARK', patch });

  const pickWatermarkImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const img = await ingestFile(f);
        setW({ image: img, kind: 'image' });
      } catch (e) {
        console.error('watermark upload failed', e);
      }
    };
    input.click();
  };

  return (
    <div className="section">
      <h4 className="section-title">Watermark</h4>
      <Check checked={w.enabled} onChange={(v) => setW({ enabled: v })}>
        Enable watermark
      </Check>
      {w.enabled && (
        <>
          <div className="row" style={{ marginTop: 8 }}>
            <label>Type</label>
            <Seg
              options={[
                { value: 'text', label: 'Text' },
                { value: 'image', label: 'Image' },
              ]}
              value={w.kind}
              onChange={(v) => setW({ kind: v as Watermark['kind'] })}
            />
          </div>
          {w.kind === 'text' ? (
            <>
              <div className="row-stack">
                <label>Text</label>
                <input
                  className="field"
                  type="text"
                  value={w.text}
                  onChange={(e) => setW({ text: e.target.value })}
                  placeholder="© Photogrid"
                  style={{ height: 28 }}
                />
              </div>
              <div className="row-stack">
                <label>Font</label>
                <select
                  className="num-input"
                  style={{ height: 28, width: '100%', textAlign: 'left', padding: '0 8px' }}
                  value={w.font}
                  onChange={(e) => setW({ font: e.target.value })}
                >
                  {WATERMARK_FONT_CHOICES.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row">
                <label>Weight</label>
                <Slider
                  value={w.weight}
                  min={100}
                  max={900}
                  step={100}
                  onChange={(v) => setW({ weight: v })}
                />
              </div>
              <div className="row">
                <label>Color</label>
                <ColorField value={w.color} onChange={(v) => setW({ color: v })} />
              </div>
            </>
          ) : (
            <div className="row-stack">
              <label>Image</label>
              {w.image ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <button
                    className="field"
                    onClick={pickWatermarkImage}
                    title="Click to replace"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    {w.image.previewUrl && (
                      <span
                        aria-hidden
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 3,
                          backgroundImage: `url(${w.image.previewUrl})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                          flexShrink: 0,
                          boxShadow: 'inset 0 0 0 1px var(--line)',
                        }}
                      />
                    )}
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {w.image.name}
                    </span>
                  </button>
                  <button
                    className="btn ghost"
                    style={{ height: 28, padding: '0 8px' }}
                    onClick={() => setW({ image: null })}
                    title="Remove watermark image"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button className="btn" style={{ width: '100%' }} onClick={pickWatermarkImage}>
                  <ImageIcon size={14} /> Upload watermark…
                </button>
              )}
            </div>
          )}
          <div className="row">
            <label>X</label>
            <Slider
              value={Math.round(w.x * 100)}
              min={0}
              max={100}
              onChange={(v) => setW({ x: v / 100 })}
              suffix="%"
            />
          </div>
          <div className="row">
            <label>Y</label>
            <Slider
              value={Math.round(w.y * 100)}
              min={0}
              max={100}
              onChange={(v) => setW({ y: v / 100 })}
              suffix="%"
            />
          </div>
          <div className="row">
            <label>Size</label>
            <Slider
              value={w.sizePx}
              min={6}
              max={600}
              onChange={(v) => setW({ sizePx: v })}
              suffix="px"
            />
          </div>
          <div className="row">
            <label>Opacity</label>
            <Slider
              value={Math.round(w.opacity * 100)}
              min={0}
              max={100}
              onChange={(v) => setW({ opacity: v / 100 })}
              suffix="%"
            />
          </div>
          <div className="row">
            <label>Angle</label>
            <Slider
              value={Math.round(w.angle)}
              min={-180}
              max={180}
              onChange={(v) => setW({ angle: v })}
              suffix="°"
            />
          </div>
        </>
      )}
    </div>
  );
}
