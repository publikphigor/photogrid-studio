import { Plus, Trash2, ChevronUp, ChevronDown, Type } from 'lucide-react';
import type { Action, PhotoGridState, TextLayer, TextLayerZ } from '@/types';
import { Slider } from '@/components/controls/Slider';
import { Seg } from '@/components/controls/Seg';
import { ColorField } from '@/components/controls/ColorField';

interface Props {
  state: PhotoGridState;
  dispatch: (a: Action) => void;
}

const FONT_CHOICES: { value: string; label: string }[] = [
  { value: 'Helvetica, Arial, sans-serif', label: 'Helvetica' },
  { value: 'Georgia, "Times New Roman", serif', label: 'Georgia' },
  { value: '"Courier New", Courier, monospace', label: 'Courier' },
  { value: '"Comic Sans MS", "Chalkboard SE", cursive', label: 'Comic' },
  { value: 'Impact, Charcoal, sans-serif', label: 'Impact' },
  { value: '"Trebuchet MS", sans-serif', label: 'Trebuchet' },
];

const Z_LABELS: Record<TextLayerZ, string> = {
  'behind-container': 'Behind container',
  'behind-cells': 'Behind cells',
  'in-front-of-cells': 'In front of cells',
  'in-front-of-container': 'In front of container',
};

export function CanvasTab({ state, dispatch }: Props) {
  const layers = state.textLayers ?? [];
  const selected = layers.find((l) => l.id === state.selectedTextLayerId) ?? null;
  const setLayer = (patch: Partial<TextLayer>) => {
    if (!selected) return;
    dispatch({ type: 'UPDATE_TEXT_LAYER', id: selected.id, patch });
  };

  return (
    <>
      <div className="section">
        <h4 className="section-title">Text layers</h4>
        <button
          className="btn w-full"
          onClick={() => dispatch({ type: 'ADD_TEXT_LAYER' })}
        >
          <Plus size={14} /> Add text
        </button>
        {layers.length === 0 ? (
          <p
            style={{
              margin: '10px 0 0',
              fontSize: 11.5,
              color: 'var(--text-3)',
              lineHeight: 1.55,
            }}
          >
            Click <strong>Add text</strong> to drop a label onto the canvas.
            Each layer can sit behind or in front of the cells, behind or above
            the container — drag the order arrows to fine-tune.
          </p>
        ) : (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {layers.map((l, i) => (
              <div
                key={l.id}
                className={`layer${state.selectedTextLayerId === l.id ? ' active' : ''}`}
                onClick={() => dispatch({ type: 'SELECT_TEXT_LAYER', id: l.id })}
                style={{ paddingLeft: 6 }}
              >
                <Type size={14} style={{ flexShrink: 0, opacity: 0.8 }} />
                <div className="name" title={l.text || '(empty)'}>
                  {l.text || '(empty)'}
                </div>
                <div className="meta" style={{ fontSize: 9.5 }}>
                  {layerShortLabel(l.z)}
                </div>
                <button
                  className="icon-btn"
                  style={{ width: 18, height: 18 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch({ type: 'REORDER_TEXT_LAYER', id: l.id, direction: 'up' });
                  }}
                  disabled={i === 0}
                  title="Move up in paint order"
                >
                  <ChevronUp size={12} />
                </button>
                <button
                  className="icon-btn"
                  style={{ width: 18, height: 18 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch({ type: 'REORDER_TEXT_LAYER', id: l.id, direction: 'down' });
                  }}
                  disabled={i === layers.length - 1}
                  title="Move down in paint order"
                >
                  <ChevronDown size={12} />
                </button>
                <button
                  className="icon-btn"
                  style={{ width: 18, height: 18 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch({ type: 'REMOVE_TEXT_LAYER', id: l.id });
                  }}
                  title="Delete text layer"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {selected ? (
        <>
          <div className="section">
            <h4 className="section-title">Edit text</h4>
            <div className="row-stack">
              <label>Content</label>
              <textarea
                value={selected.text}
                onChange={(e) => setLayer({ text: e.target.value })}
                style={{
                  minHeight: 64,
                  resize: 'vertical',
                  padding: '8px 10px',
                  background: 'var(--panel-2)',
                  border: '1px solid var(--line)',
                  borderRadius: 6,
                  color: 'var(--text)',
                  fontSize: 12.5,
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
            </div>
            <div className="row-stack">
              <label>Font</label>
              <select
                className="num-input"
                style={{ height: 28, width: '100%', textAlign: 'left', padding: '0 8px' }}
                value={selected.font}
                onChange={(e) => setLayer({ font: e.target.value })}
              >
                {FONT_CHOICES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="row">
              <label>Color</label>
              <ColorField value={selected.color} onChange={(v) => setLayer({ color: v })} />
            </div>
            <div className="row">
              <label>Size</label>
              <Slider
                value={selected.size}
                min={6}
                max={400}
                onChange={(v) => setLayer({ size: v })}
                suffix="px"
              />
            </div>
            <div className="row">
              <label>Weight</label>
              <Slider
                value={selected.weight}
                min={100}
                max={900}
                step={100}
                onChange={(v) => setLayer({ weight: v })}
              />
            </div>
            <div className="row">
              <label>Align</label>
              <Seg
                options={[
                  { value: 'left', label: 'L' },
                  { value: 'center', label: 'C' },
                  { value: 'right', label: 'R' },
                ]}
                value={selected.align}
                onChange={(v) => setLayer({ align: v as TextLayer['align'] })}
              />
            </div>
          </div>

          <div className="section">
            <h4 className="section-title">Position</h4>
            <div className="row">
              <label>X</label>
              <Slider
                value={Math.round(selected.x * 100)}
                min={-50}
                max={150}
                onChange={(v) => setLayer({ x: v / 100 })}
                suffix="%"
              />
            </div>
            <div className="row">
              <label>Y</label>
              <Slider
                value={Math.round(selected.y * 100)}
                min={-50}
                max={150}
                onChange={(v) => setLayer({ y: v / 100 })}
                suffix="%"
              />
            </div>
            <div className="row">
              <label>Rotate</label>
              <Slider
                value={Math.round(selected.rotation)}
                min={-180}
                max={180}
                onChange={(v) => setLayer({ rotation: v })}
                suffix="°"
              />
            </div>
            <div className="row">
              <label>Opacity</label>
              <Slider
                value={Math.round(selected.opacity * 100)}
                min={0}
                max={100}
                onChange={(v) => setLayer({ opacity: v / 100 })}
                suffix="%"
              />
            </div>
          </div>

          <div className="section">
            <h4 className="section-title">Layer position</h4>
            <select
              className="num-input"
              style={{ height: 28, width: '100%', textAlign: 'left', padding: '0 8px' }}
              value={selected.z}
              onChange={(e) => setLayer({ z: e.target.value as TextLayerZ })}
            >
              {(Object.keys(Z_LABELS) as TextLayerZ[]).map((k) => (
                <option key={k} value={k}>
                  {Z_LABELS[k]}
                </option>
              ))}
            </select>
            <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-4)', lineHeight: 1.55 }}>
              <em>Behind container</em> sits below the container shape and isn't
              clipped. <em>In front of container</em> floats above everything.
              <em> Behind/in front of cells</em> live inside the container clip.
            </p>
          </div>
        </>
      ) : (
        layers.length > 0 && (
          <div className="section">
            <p style={{ margin: 0, color: 'var(--text-3)', fontSize: 12 }}>
              Pick a text layer above to edit it.
            </p>
          </div>
        )
      )}
    </>
  );
}

function layerShortLabel(z: TextLayerZ): string {
  switch (z) {
    case 'behind-container':
      return 'bg';
    case 'behind-cells':
      return 'bhd';
    case 'in-front-of-cells':
      return 'fwd';
    case 'in-front-of-container':
      return 'top';
  }
}
