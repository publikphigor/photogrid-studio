import { useEffect, useState } from 'react';
import { Plus, Save, Shuffle, Trash2 } from 'lucide-react';
import type { Action, CellImageRef, PhotoGridState } from '@/types';
import { LAYOUT_PRESETS } from '@/state/presets';
import { Templates, type SavedTemplate } from '@/state/templates';
import { imageBlobUrl } from '@/api/client';
import { PresetMini } from './PresetMini';

interface Props {
  state: PhotoGridState;
  dispatch: (a: Action) => void;
}

export function LeftPanel({ state, dispatch }: Props) {
  const [saved, setSaved] = useState<SavedTemplate[]>([]);
  const [randRaw, setRandRaw] = useState('5');
  const [squaresOnly, setSquaresOnly] = useState(false);
  const randCount = (() => {
    const n = Number.parseInt(randRaw, 10);
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.min(200, n));
  })();

  useEffect(() => {
    setSaved(Templates.list());
  }, []);

  const onSaveTemplate = () => {
    const name = window.prompt('Template name', `Template ${saved.length + 1}`);
    if (name == null) return;
    Templates.save(name, state);
    setSaved(Templates.list());
  };

  const onApplyTemplate = async (tpl: SavedTemplate) => {
    // Apply the snapshot first so the layout shows immediately, then resolve
    // preview URLs from the backend cache and patch them in. Missing images
    // leave their cell empty rather than wedging the load.
    dispatch({ type: 'REPLACE', state: tpl.state });
    const tasks: Promise<void>[] = [];
    for (const c of tpl.state.cells) {
      if (c.image?.hash && !c.image.previewUrl) {
        tasks.push(
          imageBlobUrl(c.image.hash).then((url) => {
            if (!url) return;
            const next: CellImageRef = { ...(c.image as CellImageRef), previewUrl: url };
            dispatch({ type: 'UPDATE_CELL', id: c.id, patch: { image: next } });
          }),
        );
      }
    }
    if (tpl.state.container.bgImage?.hash && !tpl.state.container.bgImage.previewUrl) {
      tasks.push(
        imageBlobUrl(tpl.state.container.bgImage.hash).then((url) => {
          if (!url) return;
          const ref = tpl.state.container.bgImage;
          if (!ref) return;
          dispatch({
            type: 'SET_CONTAINER',
            patch: { bgImage: { ...ref, previewUrl: url } },
          });
        }),
      );
    }
    await Promise.allSettled(tasks);
  };

  const onDeleteTemplate = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    Templates.remove(id);
    setSaved(Templates.list());
  };

  return (
    <div className="pane left border-r border-line">
      <div className="pane-body">
        <div className="pane-header">Templates</div>
        <div className="grid grid-cols-2 gap-2 px-3 py-2 pb-3.5">
          {LAYOUT_PRESETS.map((p) => (
            <button
              key={p.id}
              className="preset"
              onClick={() => dispatch({ type: 'APPLY_PRESET', preset: p })}
            >
              <PresetMini preset={p} />
              <span className="label">{p.name}</span>
            </button>
          ))}
        </div>

        <div className="pane-header">Random</div>
        <div className="px-3 py-2 pb-3.5 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input
              className="num-input"
              type="text"
              inputMode="decimal"
              pattern="[0-9,.]*"
              value={randRaw}
              onChange={(e) => setRandRaw(e.target.value.replace(/[^0-9]/g, ''))}
              style={{ width: 52 }}
              title="Number of cells (1-200)"
            />
            <button
              className="btn"
              style={{ flex: 1 }}
              onClick={() =>
                dispatch({
                  type: 'GENERATE_RANDOM_LAYOUT',
                  cellCount: randCount,
                  squaresOnly,
                })
              }
              title="Generate a random layout with this many cells"
            >
              <Shuffle size={14} /> Generate layout
            </button>
          </div>
          <label
            className="flex items-center gap-2"
            style={{ fontSize: 11.5, color: 'var(--text-2)', cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={squaresOnly}
              onChange={(e) => setSquaresOnly(e.target.checked)}
            />
            Squares only (rect cells, no shape variety)
          </label>
        </div>

        <div className="pane-header">
          My Templates
          <div style={{ flex: 1 }} />
          <button
            className="icon-btn"
            style={{ width: 22, height: 22 }}
            onClick={onSaveTemplate}
            title="Save current as template"
          >
            <Save size={13} />
          </button>
        </div>
        {saved.length === 0 ? (
          <div style={{ padding: '8px 14px 14px', fontSize: 11.5, color: 'var(--text-3)' }}>
            No saved templates yet. Click the save icon to keep this layout.
          </div>
        ) : (
          <div className="px-2 pb-3 pt-1.5">
            {saved.map((t) => (
              <div
                key={t.id}
                className="layer"
                onClick={() => onApplyTemplate(t)}
                title={`Saved ${new Date(t.createdAt).toLocaleString()}`}
              >
                <div className="thumb" style={{ display: 'grid', placeItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-3)' }}>
                    {t.state.cells.length}
                  </span>
                </div>
                <div className="name">{t.name}</div>
                <div className="meta">
                  {t.state.grid.cols}×{t.state.grid.rows}
                </div>
                <button
                  className="icon-btn"
                  style={{ width: 20, height: 20 }}
                  onClick={(e) => onDeleteTemplate(e, t.id)}
                  title="Delete template"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="pane-header" style={{ marginTop: 4 }}>
          Layers
          <div style={{ flex: 1 }} />
          <button
            className="icon-btn"
            style={{ width: 22, height: 22 }}
            onClick={() => dispatch({ type: 'ADD_CELL' })}
            title="Add cell"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="px-2 pb-3 pt-1.5">
          {state.cells.map((c, i) => (
            <div
              key={c.id}
              className={`layer${state.selectedCellIds.includes(c.id) ? ' active' : ''}`}
              onClick={(e) =>
                dispatch(
                  e.metaKey || e.ctrlKey
                    ? { type: 'SELECT_TOGGLE', id: c.id }
                    : { type: 'SELECT', id: c.id },
                )
              }
            >
              <div
                className="thumb"
                style={c.image?.previewUrl ? { backgroundImage: `url(${c.image.previewUrl})` } : undefined}
              />
              <div className="name">{c.image?.name ?? `Cell ${i + 1}`}</div>
              <div className="meta">
                {c.colSpan}×{c.rowSpan}
              </div>
              <span className="dot" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
