# PhotoGrid Studio — architecture & libraries

How the pieces fit together and why each library was chosen. Read alongside
`CLAUDE.md` (which is the operating manual) — this document focuses on
*mechanism*.

---

## 1. Two services, one volume

```
┌──────────────────────────────────┐         ┌────────────────────────────────────┐
│  photogrid-frontend (nginx)      │         │  photogrid-backend (uvicorn/gunicorn)│
│  :8080 → host :8090              │         │  :8000 → host :8010                │
│                                  │         │                                    │
│  • Serves the React SPA          │         │  • FastAPI app (photogrid.main)    │
│  • Reverse-proxies /api/*  ─────────────────►  • POST/HEAD/GET /api/images       │
│    to backend:8000               │         │  • POST     /api/export            │
│  • client_max_body_size 256M     │         │  • GET      /api/healthz           │
│  • SPA fallback on /             │         │  • Background TTL sweeper task     │
└──────────────────────────────────┘         └─────────────┬──────────────────────┘
                                                            │
                                                            ▼
                                              named volume `photogrid-cache`
                                              /var/cache/photogrid/{hh}/{hash}.{ext}
```

The frontend is the only public-facing entry point in production. Same-origin
means no CORS in prod; CORS is open in dev because the Vite dev server runs on
its own port.

The cache is content-addressed (SHA-256), shared between requests, and survives
container restarts because it lives on the named volume.

---

## 2. Frontend — what each library is for

| Library | Why it's here |
| --- | --- |
| **React 18** (`react`, `react-dom`) | UI tree + hooks. We hold all editor state in a single reducer instead of a global store, so React's built-in `useReducer` is enough. |
| **Vite 5** (`vite`, `@vitejs/plugin-react`) | Dev server with HMR, ESM-native bundler, hashed asset filenames in `dist/`. The Dockerfile runs `vite build` in a Node stage and ships the static output to nginx. |
| **TypeScript 5.6** | Strict mode. `tsconfig.json` enables `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`. The `@/*` path alias points at `src/`. |
| **Tailwind CSS 3** | Utility classes layered over a CSS-variables theme. The variables live in `src/styles/tokens.css` (ported verbatim from the design prototype) and `tailwind.config.ts` exposes them as theme colors. `darkMode: ['selector', '[data-theme="dark"]']` lets `App.tsx` flip the whole UI by toggling an attribute on `<html>`. |
| **PostCSS + Autoprefixer** | Pipeline Tailwind runs on. |
| **lucide-react** | All icons. The original prototype hand-rolled SVGs; lucide is one dep and tree-shakes nicely. |
| **vitest** | Unit-test scaffold (currently minimal — backend has the meaningful coverage). |

State persistence touches two browser APIs directly:

- **`localStorage`** — saved templates (`pg_templates_v1`) and theme preference (`pg_theme`). Templates strip `previewUrl` blobs because object URLs don't survive page reloads anyway; the loader rehydrates from the backend cache.
- **`IndexedDB`** — the FSA `FileSystemDirectoryHandle` for the export folder. Persisting *handles* (not paths) is the only way the FSA spec lets you remember a folder across sessions.

Browser APIs we lean on:

- **`crypto.subtle.digest('SHA-256', …)`** in `src/api/hash.ts` to fingerprint uploads on the main thread.
- **`createImageBitmap` + `OffscreenCanvas`** to generate ≤1024px JPEG previews without blocking the UI.
- **`document.elementFromPoint`** during cell drags to find the drop target via `[data-cell-id]`.
- **`document.startViewTransition`** (feature-checked) so cell-position swaps and moves animate.
- **`window.showSaveFilePicker` / `showDirectoryPicker`** for native save UX in Chromium/Edge; the Save flow falls through to `<a download>` elsewhere.

---

## 3. Backend — what each library is for

| Library | Why it's here |
| --- | --- |
| **FastAPI** (`fastapi`) | Routing, dependency injection, automatic OpenAPI. Each route module (`api/health.py`, `api/images.py`, `api/export.py`) registers an `APIRouter`; `photogrid.main` mounts them under `/api`. |
| **uvicorn / gunicorn** | Dev runs `uvicorn` directly; prod uses `gunicorn -k uvicorn.workers.UvicornWorker -w ${WEB_CONCURRENCY}`. |
| **pydantic v2 + pydantic-settings** | `models.py` mirrors the frontend types so the wire format is type-checked end to end. `config.py` reads env vars (`MAX_UPLOAD_MB`, `CACHE_TTL_HOURS`, etc.) into a `Settings` singleton. |
| **python-multipart** | Lets FastAPI parse `multipart/form-data` for the image upload route. |
| **Pillow ≥ 10.4** | The actual image library. Used for: opening source images, applying CSS-filter equivalents, building mask images via `ImageDraw`, compositing cells via `alpha_composite`, encoding output. |
| **pillow-heif** | Registers a HEIC/HEIF opener with Pillow at module import (in `pillow_renderer.py`). Off-the-shelf iPhone photos work without a separate decoder. |
| **numpy** | Pure-vector ops where Pillow doesn't have a primitive — sepia matrix multiply, hue-rotate via HSV channel rotation, alpha-mask combine in `cells.py`. |
| **python-magic** | MIME-sniffs the first 4096 bytes of every upload (libmagic via the `libmagic1` apt package). Pillow can't reject non-images cheaply on its own. |
| **structlog** | JSON logs with `add_log_level` + ISO timestamps. Every request emits `upload.ok` / `render.start` / `render.ok` / `render.failed` events with hashes, sizes, and elapsed_ms. |
| **aiofiles** | Async file I/O for any spot that needs it (mostly future-proofing; the cache writes are sync but inside `asyncio.to_thread`). |
| **pyvips** *(optional, `[vips]` extra)* | CFFI binding to libvips. Selected by `select_renderer()` only when `import pyvips` succeeds **and** any source image ≥ `VIPS_THRESHOLD_MP`. The runtime image installs the `libvips42` shared library so the wheel can dlopen it; the build stage doesn't need `libvips-dev`. |

Image-decompression safety: `Image.MAX_IMAGE_PIXELS = settings.max_pixels` in `api/images.py` raises `Image.DecompressionBombError` for anything past `MAX_PIXELS_MP × 1e6`.

---

## 4. Upload → render pipeline

End-to-end for a single export, reading code paths in order.

### 4a. User picks a file

`StageCanvas.tsx` or `App.tsx` calls `ingestFile(file: File)` (`src/api/client.ts`). That function:

1. Generates a small preview blob with `createImageBitmap` + `OffscreenCanvas.convertToBlob` (JPEG q=0.85, ≤1024px on long side).
2. POSTs the **original** to `/api/images` as multipart.
3. Returns `{ hash, name, w, h, mime, previewUrl }` where `previewUrl` is `URL.createObjectURL(blob)`.

The cell stores that ref. `previewUrl` is local-only; the backend never sees it.

### 4b. Backend caches the original

`api/images.py:upload_image`:

1. Reads first 4 KiB, runs `magic.from_buffer(head, mime=True)`. Reject if not in the allowed set (`image/jpeg|png|webp|tiff|heic|heif|avif`).
2. `DiskCache.store_stream` (`cache/disk.py`):
   - Streams the request body to a temp file in `_tmp/` while feeding bytes into `hashlib.sha256` and counting against `MAX_UPLOAD_MB`.
   - When done, moves the temp file to `{cache_dir}/{hash[:2]}/{hash}.{ext}` with `os.replace` (atomic).
   - If a file with the same hash already exists, deletes the temp and keeps the existing one (perfect dedup).
3. Probes the cached file with `Image.open` to get `(w, h)`. If decoding fails, the file is removed and the request returns 415.
4. Returns `{ hash, mime, w, h, size }`.

### 4c. User clicks Export

`App.tsx:handleExport` calls `exportImage(state, reuploader)` (`src/api/client.ts`):

1. Strips `previewUrl` from every cell's image before serialising.
2. POSTs `{ state }` to `/api/export`.
3. If the response is **409 Conflict** with `{ missing: [...] }`, the reuploader is invoked. The current implementation prompts the user to re-pick missing files; future work could re-upload silently from an IndexedDB blob store. Once uploads are done, the request retries once.
4. On 200, the response blob is handed to `saveBlob(blob, filename, format, notify)`.

`saveBlob` tries three ways in order:

1. **Persisted FSA directory** (`api/folder.ts:getStoredFolder`). If `ensureWritable` returns true, writes via `FileSystemFileHandle.createWritable`.
2. **`window.showSaveFilePicker`** so the user picks a name + location.
3. **`<a download>` anchor click** — works everywhere, falls back to the browser's default download path.

### 4d. Render side

`api/export.py:export`:

1. Walks `state.cells`. For each cell with an image, looks up the cached file with `find_cached(hash)`. If anything is missing, returns 409 with the list of missing hashes — no rendering happens.
2. While walking, captures `source_pixels_max` so `select_renderer()` can decide between Pillow and pyvips.
3. Hands off to `renderer.render(state)` inside `asyncio.to_thread` so the event loop stays responsive.
4. On success, returns the bytes with `Content-Disposition` plus `X-Photogrid-Bytes`, `X-Photogrid-Renderer`, `X-Photogrid-Elapsed-Ms` headers.

### 4e. Pillow render in detail

`renderer/pillow_renderer.py:_render_sync`:

1. **Output size.** `dimensions_for(aspect, baseSize)` (mirrors the frontend's `dimensionsFor`) produces the unscaled `(w, h)`. `output.scale ∈ {1,2,3,4}` multiplies. Pixel-budget guard rejects anything past `MAX_PIXELS_MP`.
2. **Base canvas.** Transparent RGBA at `(W, H)`.
3. **Container background.** If `bgTransparent` is false, fill with `cont.bg`. If `cont.bgImage` is set, open that hash from cache, run `_fit_image` (cover/contain/fill — same semantics as object-fit), composite over the colour fill.
4. **Layout.** `grid_tracks(W, H, padding, gap, cols, rows)` returns the per-track dimensions. `cell_box(...)` gives the absolute pixel rectangle for any cell. Padding/gap are scaled by `output.scale` so the layout matches the design at any output resolution.
5. **For each cell:**
   - Build the cell shape mask. If `cell.shape != 'rect'`, reuse `make_container_mask` (same code path as the container shape). Otherwise `make_cell_mask` honours `cellRadius`.
   - Open the source from cache (`Image.open` + `.convert('RGBA')`).
   - Apply CSS filters: `apply_css_filter` parses tokens like `contrast(1.15) saturate(1.2)` with a small regex tokenizer and chains `ImageEnhance` operations or hand-written numpy paths (sepia matrix multiply, hue-rotate via HSV channel rotation).
   - `compose_cell` resamples the image with LANCZOS to its target display size, applies `cell.scale`, rotates by `-cell.rotation` (PIL is CCW, CSS is CW), positions inside the cell box with `cell.offsetX/Y`. Cover-fit + rotation pre-scales by `|cosθ|+|sinθ|` so the rotated image still covers the cell.
   - The cell mask is multiplied with the tile's existing alpha (numpy `arr_a * arr_m // 255`) so rounded/clipped cell shapes survive composition.
   - `alpha_composite` the tile onto the base.
   - If `cellBorder > 0`, `stroke_cell` paints an inset stroke band by subtracting an eroded mask (`ImageFilter.MinFilter`) from the original mask.
6. **Container mask.** `make_container_mask` for the requested shape; multiplied into the base alpha.
7. **Container border.** Same erosion-band trick at the container level.
8. **Encode.** PNG with `optimize=True`; JPEG with quality + progressive baseline (alpha is flattened on white if present); WebP with `method=6` for best compression.

The mask functions (`renderer/shapes.py`) render at 2× scale via `ImageDraw` then downsample with LANCZOS for anti-aliased edges. Heart and blob shapes are approximated with overlapping ellipses + polygons; the others (rect, rounded, circle, oval, hexagon, diamond, arch, squircle) are exact.

---

## 5. State management

`frontend/src/state/reducer.ts` is the single source of truth.

- **`PhotoGridState`**: `{ container, grid, cells, selectedCellId, output, canvas }`. Every action returns a new immutable copy; React re-renders only the parts that referentially changed.
- **`useHistoryReducer`** (`state/history.ts`) wraps `useReducer` with a 60-step ring buffer. Selection, zoom, undo, redo are flagged ephemeral — they don't push to history. ⌘Z / ⌘⇧Z hit window-level handlers in `App.tsx`.
- **`SET_GRID`** fills uncovered slots with empty cells and drops out-of-bounds cells, keeping the Layers panel 1:1 with the visible grid.
- **`RESIZE_CELL` / `MOVE_CELL`** run `reflowAroundMover`: any cell whose box overlaps the mover gets relocated to the next free slot via `findFreeSlot` (BFS over the grid), preserving span where it fits, falling back to 1×1, growing the grid by a row only as a last resort.
- **`MOVE_CELL_TO_CELL`** swaps two cells' positions+spans wholesale (no reflow needed).
- **`SWAP_CELLS`** swaps just the *images* between two cells.
- **`FILL_FROM_FILES`** assigns multiple uploads to consecutive empty cells, expanding the grid if there aren't enough.

---

## 6. Drag system (mouse-only, no HTML5 inside cells)

`StageCanvas.tsx` owns one mousedown handler (`onCellMouseDown`) and one set of window listeners. The flow:

1. Mousedown on a cell records intent into a `dragRef` (a `useRef`, not state — no re-renders during drag): `{ kind, cellId, startX/Y, baseOffsetX/Y, imgEl, scale, rotation, invZoom, ghostSrc, … }`. `kind` is decided right there: `move` if `shiftKey`, `reposition` if the cell was already selected, otherwise `swap`.
2. Window mousemove updates `curX/Y` in the ref. Movement past `CLICK_THRESHOLD` (4 px) flips `moved` to true and schedules a `requestAnimationFrame`.
3. The frame callback either:
   - **Reposition:** mutates `imgEl.style.transform` directly. No React. Smooth at any FPS.
   - **Swap / move:** updates the `ghost` React state for the floating preview, runs `document.elementFromPoint` to find the cell under the cursor (via `[data-cell-id]`), and stores `overId`.
4. Mouseup commits via dispatch — `UPDATE_CELL { offsetX, offsetY }` for reposition, `SWAP_CELLS` or `MOVE_CELL_TO_CELL` for swap/move. The dispatch is wrapped in `document.startViewTransition` when the browser supports it so the layout shift animates.

**Resize handles** are a separate overlay (`<ResizeHandles>`) that lives inside the `.board` (after `.grid-area`), not inside any cell. It reads the selected cell's grid coords, computes its design-pixel bounding box from `padding/gap/track` math, and absolutely positions 8 handles. `onHandleDown` records into a different `resizing` state that drives a similar rAF-throttled, integer-snap-deduped dispatch loop.

OS file drops still use HTML5 drag-and-drop on the stage element itself, but every handler gates on `dataTransfer.types.includes('Files')` so internal mouse drags never trigger the file-drop overlay.

---

## 7. Build & deploy

- **Frontend Dockerfile** is multi-stage: `node:20-alpine` builds the SPA (`vite build`); `nginx:1.27-alpine` serves the static output. The `nginx.conf` adds gzip, an `/healthz` endpoint, the SPA fallback, and the `/api/*` reverse proxy to `backend:8000`.
- **Backend Dockerfile** is also multi-stage: a build stage installs from `pyproject.toml` (with `[vips]` extra) into `/install`; the runtime stage is `python:3.12-slim` with only the runtime libs (`libmagic1`, `libheif1`, `libvips42`, etc.). Runs as a non-root `app` user. `HEALTHCHECK` curls `/api/healthz`.
- **Compose** uses one named volume (`photogrid-cache`) mounted at `/var/cache/photogrid` in the backend. The frontend `depends_on: backend: condition: service_healthy` so it only comes up after the API is ready.
- **Prod overlay** (`docker-compose.prod.yml`) switches the backend to gunicorn, adds resource limits (2 GB / 2 CPU on backend, 256 MB / 0.5 CPU on frontend), and rotates JSON logs at 10 MB × 5.

---

## 8. Testing

- **`backend/tests/`** — pytest covers `dimensions_for` math, the full filter list, every shape mask, and an upload→export roundtrip via FastAPI's `TestClient`. The `isolated_cache` fixture makes each test run against its own temp `CACHE_DIR`.
- **`scripts/e2e/smoke.mjs`** — Playwright. Opens the live frontend, walks through Output/Container/Cell tabs, selects a cell, drags the SE handle, verifies the span changed, saves a template, loads it, verifies the cell count is preserved. Intended to run against `make up` (`http://localhost:8090`) either via the upstream Microsoft Playwright Docker image or with Playwright installed locally.

---

## 9. Configuration cheatsheet

Everything tunable is an env var read by `photogrid/config.py:Settings`:

| Var | Default | Effect |
| --- | --- | --- |
| `MAX_UPLOAD_MB` | 60 | Per-image upload cap. |
| `MAX_PIXELS_MP` | 200 | `Image.MAX_IMAGE_PIXELS = MAX_PIXELS_MP * 1_000_000`. |
| `CACHE_TTL_HOURS` | 24 | Sweeper deletes files older than this. |
| `CACHE_SWEEP_MINUTES` | 15 | Sweeper period. |
| `VIPS_THRESHOLD_MP` | 40 | Switch to pyvips when any source ≥ this. |
| `LOG_LEVEL` | `INFO` | Structlog filter level. |
| `ALLOWED_ORIGINS` | `*` | CORS list. Prod uses same-origin via the nginx proxy, so this is mostly for dev. |
| `WEB_CONCURRENCY` | 4 | gunicorn worker count (prod). |
| `FRONTEND_PORT` / `BACKEND_PORT` | 8090 / 8010 | Host port mappings (your `.env` overrides 8080/8000 because those were taken locally). |

The frontend's only build-time variable is `VITE_API_BASE` (default `/api`). The Dockerfile passes it through as a build arg; in dev Vite proxies `/api` to `http://localhost:8000`.

---

## 10. Where each user-facing feature is implemented

| Feature | Frontend | Backend |
| --- | --- | --- |
| Layout presets | `state/presets.ts:LAYOUT_PRESETS`, `LeftPanel` | n/a (drives state only) |
| Container shapes | `state/shapes.ts:shapeCSS` | `renderer/shapes.py:make_container_mask` |
| Per-cell shapes | `state/shapes.ts:cellShapeCSS` + `Inspector/CellTab` picker | same `make_container_mask`, gated in `pillow_renderer.py` |
| CSS filters | inline `style={{ filter }}` | `renderer/filters.py:apply_css_filter` |
| Cell drag (reposition / swap / move) | `StageCanvas.tsx:onCellMouseDown` + window listeners | n/a (just dispatches actions) |
| 8-direction resize | `StageCanvas.tsx:ResizeHandles` + `onHandleDown` + reflow | n/a |
| Container background image | `Inspector/ContainerTab` upload + `<img>` in board | `renderer/pillow_renderer.py:_fit_image` |
| Output filename + format | `Inspector/OutputTab` File section | response `Content-Disposition` is ignored; frontend owns the name |
| Save folder | `api/folder.ts` (FSA + IndexedDB) | n/a |
| Templates | `state/templates.ts` (localStorage) + `LeftPanel` | rehydrates previews via `GET /api/images/{hash}` |
| Undo / redo | `state/history.ts` + ⌘Z keybinds in `App.tsx` | n/a |
| Theme | `App.tsx` toggles `data-theme` on `<html>`; tokens in `styles/tokens.css` | n/a |
