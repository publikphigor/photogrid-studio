import type { CellImageRef, PhotoGridState } from '@/types';
import { distinctId } from './analytics';
import { sha256Hex } from './hash';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

function posthogHeaders(): Record<string, string> {
  return { 'X-PostHog-Distinct-Id': distinctId() };
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

export interface UploadResult {
  hash: string;
  mime: string;
  w: number;
  h: number;
  size: number;
}

export interface UploadProgress {
  loaded: number;
  total: number;
}

// XHR because fetch can't observe request-body upload progress.
export function uploadImage(
  file: File,
  onProgress?: (p: UploadProgress) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/images`);
    xhr.setRequestHeader('X-PostHog-Distinct-Id', distinctId());
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress({ loaded: e.loaded, total: e.total });
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (onProgress) onProgress({ loaded: file.size, total: file.size });
        resolve(xhr.response as UploadResult);
      } else {
        reject(new ApiError(xhr.status, `/images → ${xhr.status}`, xhr.response));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'network error'));
    xhr.onabort = () => reject(new ApiError(0, 'aborted'));
    const fd = new FormData();
    fd.append('file', file, file.name);
    xhr.send(fd);
  });
}

export async function imageExists(hash: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/images/${hash}`, { method: 'HEAD', headers: posthogHeaders() });
  return res.status === 204;
}

export async function imageBlobUrl(hash: string): Promise<string | null> {
  const res = await fetch(`${API_BASE}/images/${hash}`, { method: 'GET', headers: posthogHeaders() });
  if (!res.ok) return null;
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// w/h are ORIGINAL pixel dims after EXIF orientation so preview matches export pixel-for-pixel.
export async function ingestFile(
  file: File,
  onProgress?: (p: UploadProgress) => void,
): Promise<CellImageRef> {
  const upload = await uploadImage(file, onProgress);
  return {
    hash: upload.hash,
    name: file.name,
    w: upload.w,
    h: upload.h,
    mime: upload.mime,
    previewUrl: URL.createObjectURL(file),
  };
}

export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const slots = Math.max(1, Math.min(concurrency, items.length));
  const workers = Array.from({ length: slots }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export type ExportPhase = 'render' | 'download';
export interface ExportProgressEvent {
  phase: ExportPhase;
  bytes: number;
  total: number;
  elapsedMs: number;
}

interface ExportResult {
  blob: Blob;
  filename: string;
  size: number;
  rendererName?: string;
  elapsedMs?: number;
}

async function postExport(state: PhotoGridState): Promise<Response> {
  return fetch(`${API_BASE}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...posthogHeaders() },
    body: JSON.stringify({ state: stripPreviewUrls(state) }),
  });
}

// Two-phase: render ticks until response headers, then download streams via getReader().
export async function exportImage(
  state: PhotoGridState,
  reuploader: (hashes: string[]) => Promise<void>,
  onProgress?: (p: ExportProgressEvent) => void,
): Promise<ExportResult> {
  const startedAt = performance.now();
  const tickRender = () => {
    if (!onProgress) return;
    onProgress({ phase: 'render', bytes: 0, total: 0, elapsedMs: performance.now() - startedAt });
  };
  tickRender();
  let renderTicker = onProgress ? window.setInterval(tickRender, 200) : 0;
  const stopRenderTicker = () => {
    if (renderTicker) {
      clearInterval(renderTicker);
      renderTicker = 0;
    }
  };

  try {
    let res = await postExport(state);
    if (res.status === 409) {
      const body = (await res.json()) as { missing: string[] };
      if (body.missing?.length) {
        // Pause ticker during user file-picker interaction.
        stopRenderTicker();
        await reuploader(body.missing);
        if (onProgress) {
          tickRender();
          renderTicker = window.setInterval(tickRender, 200);
        }
        res = await postExport(state);
      }
    }
    if (!res.ok) {
      throw new ApiError(res.status, `export → ${res.status}`, await res.text());
    }
    stopRenderTicker();

    const totalHeader = res.headers.get('X-Photogrid-Bytes') ?? res.headers.get('Content-Length');
    const total = Number(totalHeader ?? 0) || 0;

    let blob: Blob;
    if (onProgress && res.body) {
      const reader = res.body.getReader();
      const chunks: BlobPart[] = [];
      let bytes = 0;
      onProgress({ phase: 'download', bytes: 0, total, elapsedMs: performance.now() - startedAt });
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          bytes += value.byteLength;
          onProgress({ phase: 'download', bytes, total, elapsedMs: performance.now() - startedAt });
        }
      }
      const mime = res.headers.get('Content-Type') ?? 'application/octet-stream';
      blob = new Blob(chunks, { type: mime });
    } else {
      blob = await res.blob();
    }

    // Frontend owns the filename; ignore Content-Disposition.
    const base = (state.output.filename || 'photogrid').replace(/[/\\:*?"<>|]/g, '').trim() || 'photogrid';
    const filename = `${base}.${state.output.format}`;
    return {
      blob,
      filename,
      size: Number(res.headers.get('X-Photogrid-Bytes') ?? blob.size),
      rendererName: res.headers.get('X-Photogrid-Renderer') ?? undefined,
      elapsedMs: Number(res.headers.get('X-Photogrid-Elapsed-Ms') ?? 0) || undefined,
    };
  } finally {
    stopRenderTicker();
  }
}

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
