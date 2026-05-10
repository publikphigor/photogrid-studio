import { useCallback, useEffect, useState } from 'react';
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

export function App() {
  const [state, dispatch, history] = useHistoryReducer(reducer, defaultState());
  const [toast, setToast] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [uploading, setUploading] = useState(false);
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

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const res = await exportImage(state, async (missing) => {
        // Re-upload originals when the backend tells us its cache is missing them.
        // We need the underlying File objects, but the cell only stores hashes.
        // Trigger a file picker for each missing hash with the cell's name as a hint.
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
          // Remove every selected cell. Iterate in reverse so removals don't
          // change the indexes of pending ids (REMOVE_CELL works by id, not
          // index, but successive dispatches are independent reductions).
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
        if (state.selectedTextLayerId) {
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
  ]);

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
      />
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
      {toast && <Toast message={toast} />}
    </div>
  );
}

const FORMAT_MIMES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

/** Save a blob, preferring the user's persisted export folder, then OS save dialog,
 *  then a plain anchor-download fallback. `notify` shows transient hints (e.g. when
 *  folder permission is needed). */
async function saveBlob(
  blob: Blob,
  filename: string,
  format: string,
  notify: (msg: string) => void,
): Promise<string | undefined> {
  // 1. Persisted folder (FSA Directory)
  const folder = await getStoredFolder();
  if (folder) {
    const granted = await ensureWritable(folder);
    if (granted) {
      return await writeBlobToFolder(folder, filename, blob);
    }
    notify('Folder permission denied; falling back to save dialog');
  }

  // 2. Save dialog
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

  // 3. Anchor download
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

/** File picker that resolves with the chosen File or null. */
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
