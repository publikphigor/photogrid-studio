import { useCallback, useEffect, useRef, useState } from 'react';
import { Github, MonitorSmartphone, X } from 'lucide-react';
import type { CellImageRef } from '@/types';
import { defaultState, reducer } from '@/state/reducer';
import { useHistoryReducer } from '@/state/history';
import { TopBar } from '@/components/TopBar';
import { LeftPanel } from '@/components/LeftPanel';
import { StageCanvas } from '@/components/StageCanvas';
import { Inspector } from '@/components/Inspector';
import { Toast } from '@/components/Toast';
import { UploadProgress, type UploadBatchState } from '@/components/UploadProgress';
import { ExportProgress, type ExportBatchState } from '@/components/ExportProgress';
import { exportImage, ingestFile, mapPool, uploadImage } from '@/api/client';
import { capture } from '@/api/analytics';
import { ensureWritable, getStoredFolder, writeBlobToFolder } from '@/api/folder';
import { formatBytes } from '@/state/presets';

type Theme = 'dark' | 'light';
type Viewport = 'mobile' | 'tablet' | 'desktop';

export type UploadBatch = (files: File[]) => Promise<CellImageRef[]>;

const UPLOAD_CONCURRENCY = 4;

// Mobile gates out; tablet (768-1599) floats panels as drawers; desktop is three-column.
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
  const [exportProgress, setExportProgress] = useState<ExportBatchState | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadBatchState | null>(null);
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

  const uploading = uploadProgress !== null;
  const exporting = exportProgress !== null;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pg_theme', theme);
  }, [theme]);

  useEffect(() => {
    if (viewport === 'desktop') {
      setLeftOpen(false);
      setRightOpen(false);
    }
  }, [viewport]);

  const perFileBytesRef = useRef<number[]>([]);
  const uploadBatch = useCallback<UploadBatch>(async (files) => {
    if (!files.length) return [];
    const totalBytes = files.reduce((s, f) => s + f.size, 0);
    perFileBytesRef.current = new Array(files.length).fill(0);
    setUploadProgress({
      done: 0,
      total: files.length,
      bytes: 0,
      totalBytes,
      activeNames: files.map((f) => f.name),
    });
    try {
      const results = await mapPool(files, UPLOAD_CONCURRENCY, async (f, i) => {
        try {
          const ref = await ingestFile(f, ({ loaded }) => {
            perFileBytesRef.current[i] = loaded;
            const live = perFileBytesRef.current.reduce((s, v) => s + v, 0);
            setUploadProgress((p) => (p ? { ...p, bytes: live } : p));
          });
          setUploadProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
          return ref;
        } catch (e) {
          console.error('upload failed', f.name, e);
          perFileBytesRef.current[i] = f.size;
          setUploadProgress((p) =>
            p
              ? { ...p, done: p.done + 1, bytes: perFileBytesRef.current.reduce((s, v) => s + v, 0) }
              : p,
          );
          return null;
        }
      });
      return results.filter((r): r is CellImageRef => r !== null);
    } finally {
      setUploadProgress(null);
    }
  }, []);

  const handleExport = useCallback(async () => {
    setExportProgress({ phase: 'render', bytes: 0, total: 0, elapsedMs: 0 });
    const cellsWithImages = state.cells.filter((c) => c.image).length;
    capture('export started', {
      output_format: state.output.format,
      output_scale: state.output.scale,
      cell_count: state.cells.length,
      cells_with_images: cellsWithImages,
    });
    try {
      const res = await exportImage(
        state,
        async (missing) => {
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
        },
        (p) => setExportProgress(p),
      );
      const savedAs = await saveBlob(res.blob, res.filename, flashToast);
      setExportInfo({
        lastSize: res.size,
        rendererName: res.rendererName,
        elapsedMs: res.elapsedMs,
      });
      const renameNote =
        savedAs && savedAs !== res.filename ? ` · saved as ${savedAs}` : '';
      const elapsed = res.elapsedMs ? ` · ${(res.elapsedMs / 1000).toFixed(1)}s` : '';
      flashToast(`Saved · ${formatBytes(res.size)}${elapsed}${renameNote}`);
      capture('export succeeded', {
        output_format: state.output.format,
        output_scale: state.output.scale,
        cell_count: state.cells.length,
        cells_with_images: cellsWithImages,
        output_bytes: res.size,
        renderer: res.rendererName,
        elapsed_ms: res.elapsedMs,
      });
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : String(e);
      flashToast(`Export failed: ${msg}`);
      capture('export failed', {
        output_format: state.output.format,
        cell_count: state.cells.length,
        error: msg,
      });
    } finally {
      setExportProgress(null);
    }

    function flashToast(msg: string) {
      setToast(msg);
      setTimeout(() => setToast(null), 3000);
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
      const imgs = await uploadBatch(files);
      if (imgs.length) dispatch({ type: 'FILL_FROM_FILES', images: imgs });
    };
    input.click();
  }, [dispatch, uploadBatch]);

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
            uploadBatch={uploadBatch}
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
              uploadBatch={uploadBatch}
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
            uploadBatch={uploadBatch}
          />
          <Inspector
            state={state}
            dispatch={dispatch}
            exportInfo={exportInfo}
            uploading={uploading}
            uploadBatch={uploadBatch}
          />
        </div>
      )}
      <UploadProgress progress={uploadProgress} />
      <ExportProgress progress={exportProgress} />
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
  // min-w-0 + word-break defeat the default flex `min-width: auto` overflow.
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

async function saveBlob(
  blob: Blob,
  filename: string,
  notify: (msg: string) => void,
): Promise<string | undefined> {
  // Save picker needs fresh user activation; after long renders it just hangs.
  const folder = await getStoredFolder();
  if (folder) {
    try {
      const granted = await ensureWritable(folder);
      if (granted) return await writeBlobToFolder(folder, filename, blob);
      notify('Folder permission lapsed; downloading instead');
    } catch (e) {
      console.warn('folder write failed, downloading instead', e);
      notify('Folder write failed; downloading instead');
    }
  }
  downloadBlobViaLink(blob, filename);
}

function downloadBlobViaLink(blob: Blob, filename: string): void {
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
