import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Save, Shuffle, Trash2, Type } from 'lucide-react';
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
  /** True while any upload is in flight; layer-add buttons are disabled so a
   *  user can't fire a structural change mid-upload that would orphan an
   *  in-flight image. */
  uploading?: boolean;
}

type ShuffleMode = 'random' | 'squares' | 'equal';

const MAX_RAND_CELLS = 200;

export function LeftPanel({ state, dispatch, uploading = false }: Props) {
  const [saved, setSaved] = useState<SavedTemplate[]>([]);
  const [randRaw, setRandRaw] = useState(() => String(Math.max(1, state.cells.length)));
  const [mode, setMode] = useState<ShuffleMode>('random');
  const [saveOpen, setSaveOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SavedTemplate | null>(null);
  const randCount = useMemo(() => {
    const n = Number.parseInt(randRaw, 10);
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.min(MAX_RAND_CELLS, n));
  }, [randRaw]);

  useEffect(() => {
    setSaved(Templates.list());
  }, []);

  // Keep the shuffle count in lockstep with the live cell count: as cells are
  // added or removed elsewhere, the input reflects the new total so the next
  // shuffle preserves the same density by default. The user can still type a
  // custom value — it will get overwritten the next time cells.length changes.
  useEffect(() => {
    setRandRaw(String(Math.max(1, state.cells.length)));
  }, [state.cells.length]);

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
    const wmImg = tpl.state.container.watermark?.image;
    if (wmImg?.hash && !wmImg.previewUrl) {
      tasks.push(
        imageBlobUrl(wmImg.hash).then((url) => {
          if (!url) return;
          dispatch({
            type: 'SET_WATERMARK',
            patch: { image: { ...wmImg, previewUrl: url } },
          });
        }),
      );
    }
    await Promise.allSettled(tasks);
  };

  const onRequestDelete = (e: React.MouseEvent, tpl: SavedTemplate) => {
    e.stopPropagation();
    setPendingDelete(tpl);
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    Templates.remove(pendingDelete.id);
    setSaved(Templates.list());
    setPendingDelete(null);
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

        <div className="pane-header">Generate template</div>
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
              <Shuffle size={14} /> Generate
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
              <TemplateRow
                key={t.id}
                template={t}
                onApply={() => onApplyTemplate(t)}
                onDelete={(e) => onRequestDelete(e, t)}
                onRename={(name) => {
                  Templates.rename(t.id, name);
                  setSaved(Templates.list());
                }}
              />
            ))}
          </div>
        )}
        <div className="pane-header" style={{ marginTop: 4 }}>
          Layers
          <div style={{ flex: 1 }} />
          <button
            className="icon-btn"
            style={{ width: 22, height: 22 }}
            onClick={() => dispatch({ type: 'ADD_TEXT_LAYER' })}
            disabled={uploading}
            title={uploading ? 'Uploading…' : 'Add text layer'}
          >
            <Type size={13} />
          </button>
          <button
            className="icon-btn"
            style={{ width: 22, height: 22 }}
            onClick={() => dispatch({ type: 'ADD_CELL' })}
            disabled={uploading}
            title={uploading ? 'Uploading…' : 'Add cell'}
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="px-2 pb-3 pt-1.5">
          {(state.textLayers ?? []).map((t) => (
            <div
              key={t.id}
              className={`layer${state.selectedTextLayerId === t.id ? ' active' : ''}`}
              onClick={() => dispatch({ type: 'SELECT_TEXT_LAYER', id: t.id })}
              title={`Text · ${zShortLabel(t.z)}`}
            >
              <div
                className="thumb"
                style={{ display: 'grid', placeItems: 'center', background: 'var(--panel-3)' }}
              >
                <Type size={12} style={{ opacity: 0.7 }} />
              </div>
              <div className="name">{t.text || '(empty)'}</div>
              <div className="meta">{zShortLabel(t.z)}</div>
              <span className="dot" />
            </div>
          ))}
          {state.cells.map((c, i) => (
            <div
              key={c.id}
              className={`layer${state.selectedCellIds.includes(c.id) ? ' active' : ''}`}
              onClick={(e) => {
                if (e.shiftKey) {
                  dispatch({ type: 'SELECT_RANGE', id: c.id });
                } else if (e.metaKey || e.ctrlKey) {
                  dispatch({ type: 'SELECT_TOGGLE', id: c.id });
                } else {
                  dispatch({ type: 'SELECT', id: c.id });
                }
              }}
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

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete template"
        footer={
          <>
            <button className="btn ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </button>
            <button
              className="btn primary"
              style={{ background: 'var(--danger)', color: '#fff' }}
              onClick={confirmDelete}
              data-autofocus
            >
              Delete
            </button>
          </>
        }
      >
        <p style={{ margin: 0, lineHeight: 1.55 }}>
          Delete <strong>{pendingDelete?.name}</strong>? This can't be undone.
        </p>
      </Modal>
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

function zShortLabel(z: import('@/types').TextLayerZ): string {
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

interface TemplateRowProps {
  template: SavedTemplate;
  onApply: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onRename: (name: string) => void;
}

/** A single row in the My Templates list. Single-click applies the template;
 *  double-click on the name swaps the label for an inline input — Enter
 *  commits the rename, Escape (or blur) cancels. The 200 ms suppression
 *  window blocks the second click of a double-click from re-applying the
 *  template the user is just trying to rename. */
function TemplateRow({ template, onApply, onDelete, onRename }: TemplateRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(template.name);
  const suppressClickRef = useRef(0);

  const startEditing = () => {
    setDraft(template.name);
    setEditing(true);
    suppressClickRef.current = Date.now();
  };

  const commit = () => {
    const next = draft.trim();
    if (next && next !== template.name) onRename(next);
    setEditing(false);
  };

  return (
    <div
      className="layer"
      onClick={() => {
        if (editing) return;
        // Suppress the application click that lands right after a dbl-click
        // (the second mouseup of the dbl-click also fires `click`).
        if (Date.now() - suppressClickRef.current < 350) return;
        onApply();
      }}
      title={`Saved ${new Date(template.createdAt).toLocaleString()}`}
    >
      <div className="thumb" style={{ display: 'grid', placeItems: 'center' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--text-3)' }}>
          {template.state.cells.length}
        </span>
      </div>
      {editing ? (
        <input
          className="num-input"
          autoFocus
          value={draft}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setEditing(false);
            }
          }}
          style={{
            flex: 1,
            height: 24,
            textAlign: 'left',
            padding: '0 8px',
            fontFamily: 'inherit',
            fontSize: 12,
          }}
        />
      ) : (
        <div
          className="name"
          onDoubleClick={(e) => {
            e.stopPropagation();
            startEditing();
          }}
          title="Double-click to rename"
        >
          {template.name}
        </div>
      )}
      {!editing && (
        <div className="meta">
          {template.state.grid.cols}×{template.state.grid.rows}
        </div>
      )}
      {!editing && (
        <button
          className="icon-btn"
          style={{ width: 20, height: 20 }}
          onClick={onDelete}
          title="Delete template"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}
