/** Persist a FileSystemDirectoryHandle in IndexedDB so the user only has to
 *  pick the export folder once per device. Permissions are re-requested on
 *  each launch (Chromium policy).
 */

const DB = 'photogrid-studio';
const STORE = 'kv';
const KEY = 'export_dir';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function get<T>(key: string): Promise<T | null> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function put<T>(key: string, value: T): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function del(key: string): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export interface DirHandleLike {
  name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
  queryPermission?(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(opts: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

const fsa = (window as unknown as {
  showDirectoryPicker?: (opts?: { mode?: 'readwrite' }) => Promise<DirHandleLike>;
}).showDirectoryPicker;

export const supportsFolderPicker = typeof fsa === 'function';

export class FolderPickerError extends Error {
  constructor(public reason: 'aborted' | 'blocked' | 'denied' | 'unsupported', message: string) {
    super(message);
  }
}

export async function pickFolder(): Promise<DirHandleLike | null> {
  if (!fsa) throw new FolderPickerError('unsupported', 'This browser cannot pick a folder.');
  try {
    const handle = await fsa({ mode: 'readwrite' });
    await put(KEY, handle);
    return handle;
  } catch (e) {
    const name = (e as { name?: string })?.name;
    const msg = (e as { message?: string })?.message ?? '';
    if (name === 'AbortError') return null;
    // Chrome blocks "sensitive" folders (e.g. ~, ~/Library, system drives).
    // Downloads is allowed in recent Chrome but some setups still flag it.
    if (
      name === 'SecurityError' ||
      msg.toLowerCase().includes('contains system') ||
      msg.toLowerCase().includes('not allowed')
    ) {
      throw new FolderPickerError(
        'blocked',
        'The browser blocks that folder. Pick a different one (e.g. ~/Pictures or a project subfolder), or close the picker to use the save dialog instead.',
      );
    }
    throw new FolderPickerError('denied', msg || 'Folder pick failed.');
  }
}

export async function getStoredFolder(): Promise<DirHandleLike | null> {
  return (await get<DirHandleLike>(KEY)) ?? null;
}

export async function clearFolder(): Promise<void> {
  await del(KEY);
}

export async function ensureWritable(handle: DirHandleLike): Promise<boolean> {
  const opts = { mode: 'readwrite' as const };
  if (handle.queryPermission) {
    const cur = await handle.queryPermission(opts);
    if (cur === 'granted') return true;
  }
  if (handle.requestPermission) {
    try {
      const next = await handle.requestPermission(opts);
      return next === 'granted';
    } catch {
      // SecurityError when activation has expired (after a long await). Treat as denied.
      return false;
    }
  }
  return false;
}

export async function writeBlobToFolder(
  handle: DirHandleLike,
  filename: string,
  blob: Blob,
): Promise<string> {
  const finalName = await uniqueFilename(handle, filename);
  const fileHandle = await handle.getFileHandle(finalName, { create: true });
  const writable = await (fileHandle as unknown as {
    createWritable: () => Promise<{
      write: (b: Blob) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }).createWritable();
  await writable.write(blob);
  await writable.close();
  return finalName;
}

/** If `filename` already exists in `handle`, return `name_1.ext`, `name_2.ext`, etc.
 *  Walks the existing names by attempting `getFileHandle` without `create`. */
async function uniqueFilename(handle: DirHandleLike, filename: string): Promise<string> {
  if (!(await fileExists(handle, filename))) return filename;
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  for (let i = 1; i < 1000; i += 1) {
    const candidate = `${stem}_${i}${ext}`;
    if (!(await fileExists(handle, candidate))) return candidate;
  }
  return `${stem}_${Date.now()}${ext}`;
}

async function fileExists(handle: DirHandleLike, name: string): Promise<boolean> {
  try {
    await handle.getFileHandle(name, { create: false });
    return true;
  } catch {
    return false;
  }
}
