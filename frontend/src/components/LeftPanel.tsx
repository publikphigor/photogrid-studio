import { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Shuffle, Trash2 } from 'lucide-react';
import type { Action, CellImageRef, PhotoGridState } from '@/types';
import { LAYOUT_PRESETS } from '@/state/presets';
import { Templates, type SavedTemplate } from '@/state/templates';
import { imageBlobUrl } from '@/api/client';
import { Modal } from './Modal';
import { Check } from './controls/Check';
import { PresetMini } from './PresetMini';

interface Props {
  state: PhotoGridState;
  dispatch: (a: Action) => void;
}

type ShuffleMode = 'random' | 'squares' | 'equal';

const MAX_RAND_CELLS = 200;

export function LeftPanel({ state, dispatch }: Props) {
  const [saved, setSaved] = useState<SavedTemplate[]>([]);
  const [randRaw, setRandRaw] = useState('5');
  const [mode, setMode] = useState<ShuffleMode>('random');
  const [saveOpen, setSaveOpen] = useState(false);
  const randCount = useMemo(() => {
    const n = Number.parseInt(randRaw, 10);
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.min(MAX_RAND_CELLS, n));
  }, [randRaw]);

  useEffect(() => {
    setSaved(Templates.list());
  }, []);

  const onShuffle = () => {
    dispatch({
      type: 'GENERATE_RANDOM_LAYOUT',
      cellCount: randCount,
      squaresOnly: mode === 'squares',
      equal: mode === 'equal',
    });
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

        <div className="pane-header">Shuffle</div>
        <div className="px-3 py-2 pb-3.5 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input
              className="num-input"
              type="text"
              inputMode="decimal"
              pattern="[0-9,.]*"
              value={randRaw}
              onChange={(e) => setRandRaw(e.target.value.replace(/[^0-9]/g, ''))}
              style={{ width: 56 }}
              title={`Number of cells (1-${MAX_RAND_CELLS})`}
              aria-label="Cell count"
            />
            <button
              className="btn"
              style={{ flex: 1 }}
              onClick={onShuffle}
              title={
                mode === 'equal'
                  ? `Build a uniform grid of ${randCount} equal cells (existing images stay)`
                  : mode === 'squares'
                    ? 'Generate a rect-only random layout (existing images stay)'
                    : 'Generate a random layout (existing images stay)'
              }
            >
              <Shuffle size={14} /> Shuffle
            </button>
          </div>
          <div
            role="radiogroup"
            aria-label="Shuffle mode"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 4,
              background: 'var(--panel-2)',
              border: '1px solid var(--line)',
              borderRadius: 6,
              padding: 2,
            }}
          >
            {(
              [
                { id: 'random', label: 'Random' },
                { id: 'squares', label: 'Rect' },
                { id: 'equal', label: 'Equal' },
              ] as { id: ShuffleMode; label: string }[]
            ).map((opt) => (
              <button
                key={opt.id}
                role="radio"
                aria-checked={mode === opt.id}
                onClick={() => setMode(opt.id)}
                title={
                  opt.id === 'equal'
                    ? 'Uniform NxM grid; cell count is matched to a near-square factorization.'
                    : opt.id === 'squares'
                      ? 'Rect cells only; no shape variety.'
                      : 'Mondrian-style random subdivision with mood-based shapes.'
                }
                style={{
                  height: 24,
                  borderRadius: 4,
                  fontSize: 11.5,
                  border: 0,
                  background: mode === opt.id ? 'var(--seg-active-bg)' : 'transparent',
                  color: mode === opt.id ? 'var(--text)' : 'var(--text-3)',
                  cursor: 'pointer',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {mode === 'equal' && (
            <p style={{ margin: 0, fontSize: 11, color: 'var(--text-4)', lineHeight: 1.5 }}>
              Picks a near-square NxM grid. e.g. 100 → 10×10, 12 → 4×3, 7 → 7×1.
            </p>
          )}
        </div>

        <div className="pane-header">
          My Templates
          <div style={{ flex: 1 }} />
          <button
            className="icon-btn"
            style={{ width: 22, height: 22 }}
            onClick={() => setSaveOpen(true)}
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

      <SaveTemplateModal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        defaultName={`Template ${saved.length + 1}`}
        onConfirm={(name, includeImages) => {
          Templates.save(name, state, { includeImages });
          setSaved(Templates.list());
          setSaveOpen(false);
        }}
      />
    </div>
  );
}

function SaveTemplateModal({
  open,
  onClose,
  defaultName,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  defaultName: string;
  onConfirm: (name: string, includeImages: boolean) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [includeImages, setIncludeImages] = useState(false);

  // Reset form fields each time the modal opens so a stale name from a prior
  // session doesn't leak into the next save.
  useEffect(() => {
    if (open) {
      setName(defaultName);
      setIncludeImages(false);
    }
  }, [open, defaultName]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(trimmed, includeImages);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Save template"
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={!name.trim()}>
            Save
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Name</span>
          <input
            type="text"
            value={name}
            data-autofocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="My collage layout"
          />
        </label>
        <Check checked={includeImages} onChange={setIncludeImages}>
          Save with images
        </Check>
        <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-4)', lineHeight: 1.55 }}>
          {includeImages
            ? 'Photos travel with the template — handy for proofs you want to reload exactly as-is.'
            : 'Layout only — cells reload empty so you can drop in a fresh set of photos.'}
        </p>
      </div>
    </Modal>
  );
}
