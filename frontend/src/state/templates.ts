import type { PhotoGridState } from '@/types';

const KEY = 'pg_templates_v1';

export interface SavedTemplate {
  id: string;
  name: string;
  createdAt: number;
  /** Snapshot of state minus per-instance things (selection, zoom). */
  state: PhotoGridState;
}

function read(): SavedTemplate[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedTemplate[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(list: SavedTemplate[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch (e) {
    console.error('template persist failed', e);
  }
}

/** Strip transient fields and large preview blobs that shouldn't go into localStorage. */
function clean(state: PhotoGridState): PhotoGridState {
  return {
    ...state,
    selectedCellIds: [],
    canvas: { zoom: 1 },
    cells: state.cells.map((c) =>
      c.image
        ? {
            ...c,
            // Keep the hash + dimensions so a reload can re-resolve from backend cache,
            // but drop the local previewUrl (object URL — won't survive reload anyway).
            image: { ...c.image, previewUrl: undefined },
          }
        : c,
    ),
  };
}

export const Templates = {
  list: read,
  save(name: string, state: PhotoGridState): SavedTemplate {
    const all = read();
    const tpl: SavedTemplate = {
      id: `tpl_${Date.now().toString(36)}`,
      name: name.trim() || 'Untitled',
      createdAt: Date.now(),
      state: clean(state),
    };
    all.unshift(tpl);
    write(all.slice(0, 50)); // hard cap
    return tpl;
  },
  rename(id: string, name: string): void {
    write(read().map((t) => (t.id === id ? { ...t, name } : t)));
  },
  remove(id: string): void {
    write(read().filter((t) => t.id !== id));
  },
};
