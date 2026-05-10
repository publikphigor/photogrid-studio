import {
  AlignCenterHorizontal,
  Download,
  Moon,
  PanelLeft,
  PanelRight,
  RotateCcw,
  Sun,
  Undo2,
  Redo2,
  Upload,
} from 'lucide-react';
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
  /** Tablet width — hides labels, swaps the side-panel layout for drawer toggles. */
  compact?: boolean;
  leftOpen?: boolean;
  rightOpen?: boolean;
  onToggleLeft?: () => void;
  onToggleRight?: () => void;
}

export function TopBar({
  state, dispatch, history, theme, setTheme, onUploadAll, onExport, exporting, uploading,
  compact = false, leftOpen = false, rightOpen = false, onToggleLeft, onToggleRight,
}: Props) {
  const busy = exporting || uploading;
  const dims = dimensionsFor(state.container.aspect, state.output.baseSize);
  const outW = Math.round(dims.w * state.output.scale);
  const outH = Math.round(dims.h * state.output.scale);
  const est = estimateFileSize(outW, outH, state.output.format, state.output.quality);

  return (
    <div
      className="flex items-center gap-2 px-3 z-10"
      style={{ background: 'var(--panel)', borderBottom: '1px solid var(--line)', height: 48 }}
    >
      {compact && (
        <button
          className={`btn ghost ${leftOpen ? 'active' : ''}`}
          style={{ width: 32, padding: 0, justifyContent: 'center' }}
          onClick={onToggleLeft}
          title="Layouts & layers"
          aria-pressed={leftOpen}
        >
          <PanelLeft size={15} />
        </button>
      )}

      <div
        className="flex items-center gap-2 pr-2 h-full"
        style={{ borderRight: compact ? 'none' : '1px solid var(--line)' }}
      >
        <Brand />
        {!compact && (
          <div className="font-semibold tracking-tight whitespace-nowrap">
            PhotoGrid <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>studio</span>
          </div>
        )}
      </div>

      <button
        className="btn ghost"
        style={{ width: 30, padding: 0, justifyContent: 'center' }}
        onClick={() => dispatch({ type: 'UNDO' })}
        disabled={!history.canUndo}
        title="Undo (⌘Z)"
      >
        <Undo2 size={14} />
      </button>
      <button
        className="btn ghost"
        style={{ width: 30, padding: 0, justifyContent: 'center' }}
        onClick={() => dispatch({ type: 'REDO' })}
        disabled={!history.canRedo}
        title="Redo (⌘⇧Z)"
      >
        <Redo2 size={14} />
      </button>
      <span className="block w-px h-[22px] flex-none" style={{ background: 'var(--line)' }} />
      <button
        className="btn ghost"
        style={compact ? { width: 30, padding: 0, justifyContent: 'center' } : undefined}
        onClick={() => dispatch({ type: 'RESET' })}
        title="Start over"
      >
        <RotateCcw size={14} /> {!compact && <span>Reset</span>}
      </button>
      <button
        className="btn ghost"
        style={compact ? { width: 30, padding: 0, justifyContent: 'center' } : undefined}
        onClick={() => dispatch({ type: 'ALIGN_GRID' })}
        title="Align Grid: snap cells to a clean column/row layout and absorb whitespace"
      >
        <AlignCenterHorizontal size={14} /> {!compact && <span className="whitespace-nowrap">Align Grid</span>}
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

      {!compact && (
        <>
          <span
            className="whitespace-nowrap"
            style={{ color: 'var(--text-3)', fontFamily: 'var(--mono)', fontSize: 11.5 }}
          >
            <b style={{ color: 'var(--text-2)', fontWeight: 500 }}>{outW}</b> ×{' '}
            <b style={{ color: 'var(--text-2)', fontWeight: 500 }}>{outH}</b> ·{' '}
            {state.output.format.toUpperCase()} · ~
            <b style={{ color: 'var(--text-2)', fontWeight: 500 }}>{formatBytes(est)}</b>
          </span>
          <span className="block w-px h-[22px] flex-none" style={{ background: 'var(--line)' }} />
        </>
      )}
      <button
        className="btn"
        style={compact ? { width: 32, padding: 0, justifyContent: 'center' } : undefined}
        onClick={onUploadAll}
        disabled={busy}
        title={uploading ? 'Uploading…' : 'Upload images'}
      >
        <Upload size={14} /> {!compact && (uploading ? 'Uploading…' : 'Upload')}
      </button>
      <button
        className="btn primary"
        style={compact ? { padding: '0 10px' } : undefined}
        onClick={onExport}
        disabled={busy}
        title="Export (⌘E)"
      >
        <Download size={14} />{' '}
        {compact ? (exporting ? '…' : 'Export') : (exporting ? 'Exporting…' : 'Export')}
        {!compact && <span className="kbd">⌘E</span>}
      </button>

      {compact && (
        <button
          className={`btn ghost ${rightOpen ? 'active' : ''}`}
          style={{ width: 32, padding: 0, justifyContent: 'center' }}
          onClick={onToggleRight}
          title="Inspector"
          aria-pressed={rightOpen}
        >
          <PanelRight size={15} />
        </button>
      )}
    </div>
  );
}

/** Brand mark — solid accent block with a small grid glyph. No gradient. */
function Brand() {
  return (
    <span
      aria-hidden
      className="relative flex-none"
      style={{ width: 22, height: 22, borderRadius: 5, background: 'var(--accent)' }}
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
    </span>
  );
}
