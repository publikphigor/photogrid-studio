import type { PhotoGridState } from '@/types';

const KEY = 'pg_templates_v1';

export interface SavedTemplate {
  id: string;
  name: string;
  createdAt: number;
  /** Snapshot of state minus per-instance things (selection, zoom). */
  state: PhotoGridState;
}

export interface SaveOptions {
  /** Keep cell images (and the container's bgImage) in the saved snapshot.
   *  When false (the default) every cell reloads empty — useful for keeping a
   *  layout reusable across photo sets without bloating localStorage. */
  includeImages?: boolean;
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

/** Strip transient fields and large preview blobs that shouldn't go into localStorage.
 *  When `includeImages` is false (the default) cell images are also removed so the
 *  template is purely a layout/style snapshot that can host any new photo set. */
function clean(state: PhotoGridState, includeImages: boolean): PhotoGridState {
  // Watermark image follows the same image-or-not policy as cells/bg.
  const watermark = state.container.watermark
    ? {
        ...state.container.watermark,
        image: includeImages
          ? state.container.watermark.image
            ? { ...state.container.watermark.image, previewUrl: undefined }
            : null
          : null,
      }
    : undefined;
  return {
    ...state,
    selectedCellIds: [],
    selectedTextLayerId: null,
    canvas: { zoom: 1 },
    container: {
      ...state.container,
      bgImage: includeImages
        ? state.container.bgImage
          ? { ...state.container.bgImage, previewUrl: undefined }
          : null
        : null,
      watermark,
    },
    cells: state.cells.map((c) => {
      if (!c.image) return c;
      if (!includeImages) {
        return { ...c, image: null, offsetX: 0, offsetY: 0, scale: 1, rotation: 0 };
      }
      // Keep the hash + dimensions so a reload can re-resolve from backend cache,
      // but drop the local previewUrl (object URL — won't survive reload anyway).
      return { ...c, image: { ...c.image, previewUrl: undefined } };
    }),
  };
}

export const Templates = {
  list: read,
  save(name: string, state: PhotoGridState, opts: SaveOptions = {}): SavedTemplate {
    const all = read();
    const tpl: SavedTemplate = {
      id: `tpl_${Date.now().toString(36)}`,
      name: name.trim() || 'Untitled',
      createdAt: Date.now(),
      state: clean(state, opts.includeImages === true),
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
