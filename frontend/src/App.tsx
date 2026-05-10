import { useCallback, useEffect, useState } from 'react';
import { Github, MonitorSmartphone, X } from 'lucide-react';
import type { CellImageRef } from '@/types';
import { defaultState, reducer } from '@/state/reducer';
import { useHistoryReducer } from '@/state/history';
import { TopBar } from '@/components/TopBar';
import { LeftPanel } from '@/components/LeftPanel';
import { StageCanvas } from '@/components/StageCanvas';
import { Inspector } from '@/components/Inspector';
import { Toast } from '@/components/Toast';
import { exportImage, ingestFile, uploadImage } from '@/api/client';
import { ensureWritable, getStoredFolder, writeBlobToFolder } from '@/api/folder';
import { formatBytes } from '@/state/presets';

type Theme = 'dark' | 'light';
type Viewport = 'mobile' | 'tablet' | 'desktop';

/** Editor is desktop-first by necessity (modifier-key drags, edge-resize, wheel
 *  zoom). Below 768px we gate to a "use a desktop" screen; 768–1599px floats
 *  the two side panels over the canvas as drawers; ≥1600px is the original
 *  three-column layout. The drawer range is wide because the three columns
 *  (248 + canvas + 320) need real room before the canvas itself becomes
 *  large enough to work in — under ~1600px the canvas is the bottleneck. */
function measureViewport(): Viewport {
  if (typeof window === 'undefined') return 'desktop';
  const w = window.innerWidth;
  if (w < 768) return 'mobile';
  if (w < 1600) return 'tablet';
  return 'desktop';
}

function useViewport(): Viewport {
  const [v, setV] = useState(measureViewport);
  useEffect(() => {
    const onResize = () => setV(measureViewport());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return v;
}

export function App() {
  const viewport = useViewport();
  const [state, dispatch, history] = useHistoryReducer(reducer, defaultState());
  const [toast, setToast] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [exportInfo, setExportInfo] = useState<{
    lastSize?: number;
    rendererName?: string;
    elapsedMs?: number;
  }>({});
  const [theme, setTheme] = useState<Theme>(
    () => ((localStorage.getItem('pg_theme') as Theme | null) ?? 'dark'),
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pg_theme', theme);
  }, [theme]);

  // Closing a drawer when switching back to desktop avoids surprise state when
  // the user resizes the window with one open.
  useEffect(() => {
    if (viewport === 'desktop') {
      setLeftOpen(false);
      setRightOpen(false);
    }
  }, [viewport]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const res = await exportImage(state, async (missing) => {
        const stillMissing: string[] = [];
        for (const hash of missing) {
          const cell = state.cells.find((c) => c.image?.hash === hash);
          if (!cell?.image) continue;
          const file = await pickFileMatching(cell.image.name);
          if (!file) {
            stillMissing.push(hash);
            continue;
          }
          await uploadImage(file);
        }
        if (stillMissing.length) {
          throw new Error(`Could not re-upload: ${stillMissing.join(', ')}`);
        }
      });
      const savedAs = await saveBlob(res.blob, res.filename, state.output.format, flashToast);
      setExportInfo({
        lastSize: res.size,
        rendererName: res.rendererName,
        elapsedMs: res.elapsedMs,
      });
      const renameNote =
        savedAs && savedAs !== res.filename ? ` · saved as ${savedAs}` : '';
      flashToast(`Saved · ${formatBytes(res.size)}${renameNote}`);
    } catch (e) {
      console.error(e);
      flashToast('Export failed');
    } finally {
      setExporting(false);
    }

    function flashToast(msg: string) {
      setToast(msg);
      setTimeout(() => setToast(null), 2400);
    }
  }, [state]);

  const handleUploadAll = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = async () => {
      const files = [...(input.files ?? [])];
      if (!files.length) return;
      setUploading(true);
      try {
        const imgs: CellImageRef[] = [];
        for (const f of files) {
          try {
            imgs.push(await ingestFile(f));
          } catch (e) {
            console.error('upload failed', f.name, e);
          }
        }
        if (imgs.length) dispatch({ type: 'FILL_FROM_FILES', images: imgs });
      } finally {
        setUploading(false);
      }
    };
    input.click();
  }, [dispatch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const tag = (e.target as HTMLElement)?.tagName;
      const editing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (editing) return;
      if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: 'UNDO' });
      } else if ((meta && e.key.toLowerCase() === 'y') || (meta && e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault();
        dispatch({ type: 'REDO' });
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selectedTextLayerId) {
          e.preventDefault();
          dispatch({ type: 'REMOVE_TEXT_LAYER', id: state.selectedTextLayerId });
        } else if (state.selectedCellIds.length) {
          e.preventDefault();
          for (const id of state.selectedCellIds) {
            dispatch({ type: 'REMOVE_CELL', id });
          }
        }
      } else if ((meta && e.key.toLowerCase() === 'm') && state.selectedCellIds.length >= 2) {
        e.preventDefault();
        dispatch({ type: 'MERGE_CELLS', ids: state.selectedCellIds });
      } else if (meta && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        void handleExport();
      } else if (e.key === 'Escape') {
        if (leftOpen || rightOpen) {
          e.preventDefault();
          setLeftOpen(false);
          setRightOpen(false);
        } else if (state.selectedTextLayerId) {
          e.preventDefault();
          dispatch({ type: 'SELECT_TEXT_LAYER', id: null });
        } else if (state.selectedWatermark) {
          e.preventDefault();
          dispatch({ type: 'SELECT_WATERMARK', selected: false });
        } else if (state.selectedCellIds.length) {
          e.preventDefault();
          dispatch({ type: 'SELECT', id: null });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    state.selectedCellIds,
    state.selectedTextLayerId,
    state.selectedWatermark,
    handleExport,
    dispatch,
    leftOpen,
    rightOpen,
  ]);

  if (viewport === 'mobile') {
    return <DesktopOnlyGate />;
  }

  const compact = viewport === 'tablet';

  return (
    <div className="grid h-full" style={{ gridTemplateRows: '48px 1fr' }}>
      <TopBar
        state={state}
        dispatch={dispatch}
        history={history}
        theme={theme}
        setTheme={setTheme}
        onUploadAll={handleUploadAll}
        onExport={handleExport}
        exporting={exporting}
        uploading={uploading}
        compact={compact}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onToggleLeft={() => {
          setLeftOpen((o) => !o);
          setRightOpen(false);
        }}
        onToggleRight={() => {
          setRightOpen((o) => !o);
          setLeftOpen(false);
        }}
      />
      {compact ? (
        <div className="relative flex h-[calc(100vh-48px)] min-h-0 overflow-hidden">
          <StageCanvas
            state={state}
            dispatch={dispatch}
            uploading={uploading}
            setUploading={setUploading}
          />
          <Drawer side="left" open={leftOpen} onClose={() => setLeftOpen(false)} width={260}>
            <LeftPanel state={state} dispatch={dispatch} uploading={uploading} />
          </Drawer>
          <Drawer side="right" open={rightOpen} onClose={() => setRightOpen(false)} width={320}>
            <Inspector
              state={state}
              dispatch={dispatch}
              exportInfo={exportInfo}
              uploading={uploading}
              setUploading={setUploading}
            />
          </Drawer>
          {(leftOpen || rightOpen) && (
            <button
              aria-label="Close panel"
              className="absolute inset-0 z-20 bg-black/40"
              onClick={() => {
                setLeftOpen(false);
                setRightOpen(false);
              }}
            />
          )}
        </div>
      ) : (
        <div
          className="grid h-[calc(100vh-48px)] min-h-0"
          style={{ gridTemplateColumns: '248px 1fr 320px' }}
        >
          <LeftPanel state={state} dispatch={dispatch} uploading={uploading} />
          <StageCanvas
            state={state}
            dispatch={dispatch}
            uploading={uploading}
            setUploading={setUploading}
          />
          <Inspector
            state={state}
            dispatch={dispatch}
            exportInfo={exportInfo}
            uploading={uploading}
            setUploading={setUploading}
          />
        </div>
      )}
      {toast && <Toast message={toast} />}
    </div>
  );
}

function Drawer({
  side,
  open,
  onClose,
  width,
  children,
}: {
  side: 'left' | 'right';
  open: boolean;
  onClose: () => void;
  width: number;
  children: React.ReactNode;
}) {
  const closedTranslate = side === 'left' ? `-${width}px` : `${width}px`;
  return (
    <div
      role="dialog"
      aria-hidden={!open}
      className="absolute inset-y-0 z-30 flex flex-col"
      style={{
        [side]: 0,
        width,
        background: 'var(--panel)',
        borderLeft: side === 'right' ? '1px solid var(--line)' : undefined,
        borderRight: side === 'left' ? '1px solid var(--line)' : undefined,
        transform: open ? 'translateX(0)' : `translateX(${closedTranslate})`,
        transition: 'transform 220ms ease',
        boxShadow: open
          ? side === 'left'
            ? '8px 0 24px rgba(0,0,0,0.45)'
            : '-8px 0 24px rgba(0,0,0,0.45)'
          : 'none',
      }}
    >
      <div className="flex items-center justify-between h-9 px-3 border-b border-line">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-text-3">
          {side === 'left' ? 'Layouts & layers' : 'Inspector'}
        </span>
        <button
          className="icon-btn"
          style={{ width: 24, height: 24 }}
          onClick={onClose}
          title="Close"
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

function DesktopOnlyGate() {
  // Two-level layout — outer is the viewport box, inner is the centered card.
  // min-w-0 on the inner flex item defeats the default `min-width: auto`
  // behaviour that lets an unbreakable word push a flex item past its
  // max-width cap. word-break: break-word is a defensive belt-and-braces.
  return (
    <div
      className="flex items-center justify-center overflow-hidden bg-bg text-text"
      style={{ position: 'fixed', inset: 0, padding: '24px 20px' }}
    >
      <div
        className="text-center"
        style={{ width: '100%', maxWidth: 380, minWidth: 0, wordBreak: 'break-word' }}
      >
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-[color:var(--primary-fg)]">
          <MonitorSmartphone size={22} />
        </div>
        <h1 className="text-[20px] font-semibold tracking-tight text-text">
          Open this on a bigger screen
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-text-2">
          The editor needs more room than a phone gives. Come back on a laptop
          or tablet and you'll find everything where you left it.
        </p>
        <div className="mt-7 flex flex-col gap-2.5">
          <a
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-md border border-line bg-panel text-[13.5px] text-text transition hover:border-line-strong"
          >
            Back to the landing page
          </a>
          <a
            href="https://github.com/publikphigor/photogrid-studio"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md text-[13px] text-text-3 transition hover:text-text"
          >
            <Github size={14} />
            View source on GitHub
          </a>
        </div>
      </div>
    </div>
  );
}

const FORMAT_MIMES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

async function saveBlob(
  blob: Blob,
  filename: string,
  format: string,
  notify: (msg: string) => void,
): Promise<string | undefined> {
  const folder = await getStoredFolder();
  if (folder) {
    const granted = await ensureWritable(folder);
    if (granted) {
      return await writeBlobToFolder(folder, filename, blob);
    }
    notify('Folder permission denied; falling back to save dialog');
  }

  const fsa = (window as unknown as {
    showSaveFilePicker?: (options: {
      suggestedName: string;
      types: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<FileSystemFileHandle>;
  }).showSaveFilePicker;
  const mime = FORMAT_MIMES[format] ?? 'application/octet-stream';
  if (typeof fsa === 'function') {
    try {
      const handle = await fsa({
        suggestedName: filename,
        types: [{ description: format.toUpperCase(), accept: { [mime]: [`.${format}`] } }],
      });
      const writable = await (handle as unknown as { createWritable: () => Promise<{
        write: (b: Blob) => Promise<void>;
        close: () => Promise<void>;
      }> }).createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return;
      console.warn('save picker failed, falling back to download', e);
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 200);
}

function pickFileMatching(_hint: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}
