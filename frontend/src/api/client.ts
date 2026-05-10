import type { CellImageRef, PhotoGridState } from '@/types';
import { sha256Hex } from './hash';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    throw new ApiError(res.status, `${path} → ${res.status}`, body);
  }
  return (await res.json()) as T;
}

export interface UploadResult {
  hash: string;
  mime: string;
  w: number;
  h: number;
  size: number;
}

export async function uploadImage(file: File): Promise<UploadResult> {
  const fd = new FormData();
  fd.append('file', file, file.name);
  return request<UploadResult>('/images', { method: 'POST', body: fd });
}

export async function imageExists(hash: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/images/${hash}`, { method: 'HEAD' });
  return res.status === 204;
}

/** Serves the cached image bytes; returns a blob URL the cell can use as previewUrl. */
export async function imageBlobUrl(hash: string): Promise<string | null> {
  const res = await fetch(`${API_BASE}/images/${hash}`, { method: 'GET' });
  if (!res.ok) return null;
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/** Picks a file from the user, uploads it, returns the cell image ref.
 *  `w/h` are the ORIGINAL pixel dimensions (from the backend probe; the
 *  backend has already applied EXIF orientation, so they match what the
 *  browser sees). `previewUrl` points DIRECTLY at the original file via
 *  `URL.createObjectURL` — no downscale, no re-encode — so the on-screen
 *  cell renders at the full source resolution and matches the export
 *  pixel-for-pixel. Modern browsers honour EXIF orientation on `<img>` by
 *  default (CSS `image-orientation: from-image`). */
export async function ingestFile(file: File): Promise<CellImageRef> {
  const upload = await uploadImage(file);
  return {
    hash: upload.hash,
    name: file.name,
    w: upload.w,
    h: upload.h,
    mime: upload.mime,
    previewUrl: URL.createObjectURL(file),
  };
}

interface ExportResult {
  blob: Blob;
  filename: string;
  size: number;
  rendererName?: string;
  elapsedMs?: number;
}

async function exportOnce(state: PhotoGridState): Promise<Response> {
  return fetch(`${API_BASE}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: stripPreviewUrls(state) }),
  });
}

export async function exportImage(
  state: PhotoGridState,
  reuploader: (hashes: string[]) => Promise<void>,
): Promise<ExportResult> {
  let res = await exportOnce(state);
  if (res.status === 409) {
    const body = (await res.json()) as { missing: string[] };
    if (body.missing?.length) {
      await reuploader(body.missing);
      res = await exportOnce(state);
    }
  }
  if (!res.ok) {
    throw new ApiError(res.status, `export → ${res.status}`, await res.text());
  }
  const blob = await res.blob();
  // Frontend owns the filename; ignore Content-Disposition on the response.
  const base = (state.output.filename || 'photogrid').replace(/[/\\:*?"<>|]/g, '').trim() || 'photogrid';
  const filename = `${base}.${state.output.format}`;
  return {
    blob,
    filename,
    size: Number(res.headers.get('X-Photogrid-Bytes') ?? blob.size),
    rendererName: res.headers.get('X-Photogrid-Renderer') ?? undefined,
    elapsedMs: Number(res.headers.get('X-Photogrid-Elapsed-Ms') ?? 0) || undefined,
  };
}

/** State sent to the backend never includes the local-only previewUrl. */
function stripPreviewUrls(state: PhotoGridState): PhotoGridState {
  const stripImage = <T extends { previewUrl?: string }>(img: T): T =>
    ({ ...img, previewUrl: undefined } as T);
  return {
    ...state,
    cells: state.cells.map((c) =>
      c.image ? { ...c, image: stripImage(c.image) } : c,
    ),
    container: {
      ...state.container,
      bgImage: state.container.bgImage ? stripImage(state.container.bgImage) : null,
      watermark: state.container.watermark
        ? {
            ...state.container.watermark,
            image: state.container.watermark.image
              ? stripImage(state.container.watermark.image)
              : null,
          }
        : undefined,
    },
  };
}

export { sha256Hex };
