import { AlignCenterHorizontal, Download, Moon, RotateCcw, Sun, Undo2, Redo2, Upload } from 'lucide-react';
import type { Action, PhotoGridState } from '@/types';
import { dimensionsFor, estimateFileSize, formatBytes } from '@/state/presets';

interface Props {
  state: PhotoGridState;
  dispatch: (a: Action) => void;
  history: { canUndo: boolean; canRedo: boolean };
  theme: 'dark' | 'light';
  setTheme: (t: 'dark' | 'light') => void;
  onUploadAll: () => void;
  onExport: () => void;
  exporting: boolean;
  uploading: boolean;
}

export function TopBar({
  state, dispatch, history, theme, setTheme, onUploadAll, onExport, exporting, uploading,
}: Props) {
  const busy = exporting || uploading;
  const dims = dimensionsFor(state.container.aspect, state.output.baseSize);
  const outW = Math.round(dims.w * state.output.scale);
  const outH = Math.round(dims.h * state.output.scale);
  const est = estimateFileSize(outW, outH, state.output.format, state.output.quality);

  return (
    <div
      className="flex items-center gap-3.5 px-3.5 z-10"
      style={{ background: 'var(--panel)', borderBottom: '1px solid var(--line)', height: 48 }}
    >
      <div className="flex items-center gap-2.5 pr-3 h-full" style={{ borderRight: '1px solid var(--line)' }}>
        <div
          className="relative"
          style={{
            width: 22,
            height: 22,
            borderRadius: 5,
            background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
          }}
        >
          <span
            className="absolute"
            style={{
              inset: 4,
              borderRadius: 2,
              background: '#fff',
              backgroundImage:
                'linear-gradient(rgba(0,0,0,0.45) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.45) 1px, transparent 1px)',
              backgroundSize: '5px 5px',
            }}
          />
        </div>
        <div className="font-semibold tracking-tight">
          PhotoGrid <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>studio</span>
        </div>
      </div>

      <button
        className="btn ghost"
        onClick={() => dispatch({ type: 'UNDO' })}
        disabled={!history.canUndo}
        title="Undo (⌘Z)"
      >
        <Undo2 size={14} />
      </button>
      <button
        className="btn ghost"
        onClick={() => dispatch({ type: 'REDO' })}
        disabled={!history.canRedo}
        title="Redo (⌘⇧Z)"
      >
        <Redo2 size={14} />
      </button>
      <span className="block w-px h-[22px]" style={{ background: 'var(--line)' }} />
      <button className="btn ghost" onClick={() => dispatch({ type: 'RESET' })} title="Start over">
        <RotateCcw size={14} /> Reset
      </button>
      <button
        className="btn ghost"
        onClick={() => dispatch({ type: 'ALIGN_GRID' })}
        title="Align Grid: snap cells to a clean column/row layout and absorb whitespace"
      >
        <AlignCenterHorizontal size={14} /> Align Grid
      </button>
      <button
        className="btn ghost"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
        style={{ width: 30, padding: 0, justifyContent: 'center' }}
      >
        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
      </button>

      <div className="flex-1" />

      <span style={{ color: 'var(--text-3)', fontFamily: 'var(--mono)', fontSize: 11.5 }}>
        <b style={{ color: 'var(--text-2)', fontWeight: 500 }}>{outW}</b> ×{' '}
        <b style={{ color: 'var(--text-2)', fontWeight: 500 }}>{outH}</b> ·{' '}
        {state.output.format.toUpperCase()} · ~
        <b style={{ color: 'var(--text-2)', fontWeight: 500 }}>{formatBytes(est)}</b>
      </span>
      <span className="block w-px h-[22px]" style={{ background: 'var(--line)' }} />
      <button
        className="btn"
        onClick={onUploadAll}
        disabled={busy}
        title={uploading ? 'Uploading…' : 'Upload images'}
      >
        <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload'}
      </button>
      <button className="btn primary" onClick={onExport} disabled={busy} title="Export (⌘E)">
        <Download size={14} /> {exporting ? 'Exporting…' : 'Export'} <span className="kbd">⌘E</span>
      </button>
    </div>
  );
}
