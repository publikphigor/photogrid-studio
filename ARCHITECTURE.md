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

## 4. Layout model

The grid is an **integer-track model with two layers of overrides**, all of which the renderer collapses into a single rectangle per cell.

### 4a. Track sizing (`grid.colSizes` / `grid.rowSizes`)

`GridConfig` carries `cols` and `rows` plus optional `colSizes: number[]` and `rowSizes: number[]` arrays of fr-unit weights (one per track). Missing or wrong-length arrays are treated as uniform `1fr`. Corner-handle drags adjust these arrays so an entire column/row band redistributes pixel width — every cell in that band changes size proportionally. `MIN_TRACK_FR` (0.15) is the floor below which a track can't shrink.

### 4b. Per-cell pixel offsets (`cell.dx/dy/dw/dh`)

Each `Cell` has four optional pixel offsets that layer on top of the grid-track box. `EDGE_RESIZE` updates `dx/dw` (or `dy/dh`) on the dragged cell and its immediate neighbour(s) so only that pair shifts; other cells in the same column/row band are untouched. `dw/dh` can also represent "growing into adjacent whitespace" when there's no neighbour flush against the edge. `MIN_CELL_PX` (24) is the floor below which a cell can't shrink.

### 4c. Final cell rect

`computeCellRect(cell, grid, innerW, innerH, padding, gap)` is the single function that turns `(colStart, rowStart, colSpan, rowSpan, dx, dy, dw, dh)` into `(x, y, w, h)` in design pixels. **The frontend renders cells with `position: absolute` using these coords** — the grid CSS `display: grid` is intentionally NOT used for cells, because absolute positioning is the only way to let one row's column boundary differ from another row's after edge resizes. The same math runs in the backend (`renderer/layout.py:cell_box`) so preview and export match exactly.

### 4d. Align Grid

`ALIGN_GRID` zeros every cell's `dx/dy/dw/dh` so each cell snaps back to its grid-track box. Track weights are preserved (corner-resize redistributions survive). After snapping, `findMaxEmptyRect` + `compactAfterRemoval` are called repeatedly to absorb any leftover whitespace by extending an adjacent cell's pixel offsets or dropping empty tracks.

---

## 5. Upload → render pipeline

End-to-end for a single export, reading code paths in order.

### 5a. User picks a file

`StageCanvas.tsx` or `App.tsx` calls `ingestFile(file: File)` (`src/api/client.ts`). That function:

1. Generates a small preview blob with `createImageBitmap` + `OffscreenCanvas.convertToBlob` (JPEG q=0.85, ≤1024px on long side).
2. POSTs the **original** to `/api/images` as multipart.
3. Returns `{ hash, name, w, h, mime, previewUrl }` where `previewUrl` is `URL.createObjectURL(blob)` and **`w`/`h` are the ORIGINAL image dimensions** from the backend probe — not the preview's. This is load-bearing: `native` fit renders the IMG box at `w × h`, so the preview's crop matches what the backend will emit at export time.

The cell stores that ref. `previewUrl` is local-only; the backend never sees it.

### 5b. Backend caches the original

`api/images.py:upload_image`:

1. Reads first 4 KiB, runs `magic.from_buffer(head, mime=True)`. Reject if not in the allowed set (`image/jpeg|png|webp|tiff|heic|heif|avif`).
2. `DiskCache.store_stream` (`cache/disk.py`):
   - Streams the request body to a temp file in `_tmp/` while feeding bytes into `hashlib.sha256` and counting against `MAX_UPLOAD_MB`.
   - When done, moves the temp file to `{cache_dir}/{hash[:2]}/{hash}.{ext}` with `os.replace` (atomic).
   - If a file with the same hash already exists, deletes the temp and keeps the existing one (perfect dedup).
3. Probes the cached file with `Image.open` to get `(w, h)`. If decoding fails, the file is removed and the request returns 415.
4. Returns `{ hash, mime, w, h, size }`.

### 5c. User clicks Export

`App.tsx:handleExport` calls `exportImage(state, reuploader)` (`src/api/client.ts`):

1. Strips `previewUrl` from every cell's image before serialising.
2. POSTs `{ state }` to `/api/export`.
3. If the response is **409 Conflict** with `{ missing: [...] }`, the reuploader is invoked. The current implementation prompts the user to re-pick missing files; future work could re-upload silently from an IndexedDB blob store. Once uploads are done, the request retries once.
4. On 200, the response blob is handed to `saveBlob(blob, filename, format, notify)`.

`saveBlob` tries three ways in order:

1. **Persisted FSA directory** (`api/folder.ts:getStoredFolder`). If `ensureWritable` returns true, writes via `FileSystemFileHandle.createWritable`. The folder writer dedupes against existing names by appending `_1`, `_2`, … so re-exporting with the same auto-generated filename never silently overwrites a previous render. The post-save toast surfaces the actual on-disk name when it differs.
2. **`window.showSaveFilePicker`** so the user picks a name + location.
3. **`<a download>` anchor click** — works everywhere, falls back to the browser's default download path.

The default `output.filename` is generated each session (and on every template apply / `REPLACE`) via `generateFilename()` → `PG_<base36-secs>` so a fresh canvas gets a fresh name without the user typing one. `App.tsx` also tracks `uploading` / `exporting` flags and disables both `Upload` and `Export` buttons whenever either is in flight.

### 5d. Render side

`api/export.py:export`:

1. Walks `state.cells`. For each cell with an image, looks up the cached file with `find_cached(hash)`. If anything is missing, returns 409 with the list of missing hashes — no rendering happens.
2. While walking, captures `source_pixels_max` so `select_renderer()` can decide between Pillow and pyvips.
3. Hands off to `renderer.render(state)` inside `asyncio.to_thread` so the event loop stays responsive.
4. On success, returns the bytes with `Content-Disposition` plus `X-Photogrid-Bytes`, `X-Photogrid-Renderer`, `X-Photogrid-Elapsed-Ms` headers.

### 5e. Pillow render in detail

`renderer/pillow_renderer.py:_render_sync` paints in a strict z-band order so the export matches the canvas exactly. The key invariant is that **clipped bands** (anything that should respect the container silhouette) accumulate into one buffer, then the container alpha mask is applied; **unclipped bands** (free-floating text the user dropped behind or in front of the container) wrap the clipped buffer.

1. **Output size.** `dimensions_for(aspect, baseSize)` (mirrors the frontend's `dimensionsFor`) produces the unscaled `(w, h)`. `output.scale ∈ {1,2,3,4}` multiplies. Pixel-budget guard rejects anything past `MAX_PIXELS_MP`.
2. **Base canvas.** Transparent RGBA at `(W, H)`.
3. **Container background (clipped band).**
   - If `bgTransparent` is false, fill with `cont.bg`.
   - If `cont.bgImage` is set, `_fit_image` it onto the canvas, then optionally `ImageFilter.GaussianBlur(radius = bgBlur * scale)`.
   - If `cont.bgOverlayOpacity > 0`, alpha-composite a flat-colour overlay (`bgOverlayColor` × opacity) on top of the bg layers but BELOW everything that follows. This is the "darken / brighten so cells pop" knob.
4. **Behind-cells text layers.** Every `state.textLayers` entry whose `z == 'behind-cells'` is rasterised by `renderer/overlays.py:composite_text_layer` and pasted onto the buffer here — between bg and cells, still inside the upcoming container clip.
5. **Layout.** `grid_tracks(W, H, padding, gap, cols, rows, col_sizes, row_sizes)` returns a `GridTracks` whose `col_widths` and `row_heights` are **per-track pixel widths** (length `cols`/`rows`) — non-uniform when the user has corner-resized or run Align. `cell_box(...)` walks the cumulative track widths plus the cell's `dx/dy/dw/dh` (multiplied by `output.scale`) to produce the cell's absolute pixel rectangle.
6. **For each cell:**
   - Build the cell shape mask. If `cell.shape != 'rect'`, reuse `make_container_mask`. Otherwise `make_cell_mask` honours `cellRadius`.
   - Open the source from cache and `apply_css_filter` (the structured `cell.filters` is serialised to its CSS string in the reducer; backend keeps consuming the legacy string).
   - `compose_cell(src, box, cell, mask, pixel_scale)` resamples, scales, rotates, positions, and clips. Cover-fit + rotation pre-scales by `|cosθ|+|sinθ|`.
   - `alpha_composite` the tile.
   - If `cellBorder > 0`, `stroke_cell` paints an inset stroke band.
7. **In-front-of-cells text layers** + **watermark.** Same overlay path as step 4 for layers with `z == 'in-front-of-cells'`. Then `composite_watermark(base, cont.watermark, scale)` rasterises the watermark (text or image) at `sizePx * scale` design pixels using `_load_font(family, size, weight)` to map CSS family stacks to Liberation/DejaVu TTFs in the runtime image.
8. **Container shape mask.** `make_container_mask` for `cont.shape`; multiplied into the buffer's alpha. This clips everything from steps 3–7 to the container silhouette.
9. **Container border.** `stroke_container` paints the inset border band along the (now-clipped) shape outline.
10. **Unclipped text bands.** If any `textLayers` entry has `z == 'behind-container'` or `'in-front-of-container'`, build a fresh `(W, H)` canvas, paint the behind-container layers, alpha-composite the clipped buffer on top, then paint the in-front-of-container layers. These bands extend past the silhouette by design.
11. **Encode.** PNG with `optimize=True`; JPEG with quality + progressive baseline; WebP with `method=6`. **SVG** is a thin wrapper: encode to PNG first, then emit `<svg viewBox="0 0 W H"><image href="data:image/png;base64,…"/></svg>`.

`renderer/overlays.py` owns both `composite_text_layer` and `composite_watermark`. The font resolver maps CSS family stacks to known runtime paths (Liberation Sans for Helvetica/Arial, Liberation Serif for Georgia/Times, Liberation Mono for Courier, DejaVu fallbacks). Weight ≥ 600 picks the matching `-Bold` face — no fake-bold offset.

The mask functions (`renderer/shapes.py`) render at 2× scale via `ImageDraw` then downsample with LANCZOS. Polygon shapes (rect, rounded, circle, oval, hexagon, diamond, arch, squircle, triangle, pentagon, octagon, star, parallelogram, chevron) are exact. **Heart** samples the same four cubic-bezier segments the frontend SVG path defines (`M50,92 C18,74 4,46 18,24 …`) at 64 steps each, so canvas and export match pixel-for-pixel. Blob is an overlapping-ellipses approximation.

---

## 6. State management

`frontend/src/state/reducer.ts` is the single source of truth.

- **`PhotoGridState`**: `{ container, grid, cells, selectedCellIds, output, canvas, textLayers?, selectedTextLayerId?, selectedWatermark? }`. Every action returns a new immutable copy; React re-renders only the parts that referentially changed.
- **`useHistoryReducer`** (`state/history.ts`) wraps `useReducer` with a 60-step ring buffer. Selection, zoom, undo, redo are flagged ephemeral — they don't push to history. ⌘Z / ⌘⇧Z hit window-level handlers in `App.tsx`.

### Selection model

There are three independent selection focuses, each with its own action set so the inspector can pivot to the right tab:

- **Cells.** `selectedCellIds: string[]` — first id is the **primary** (inspector source-of-truth, merge survivor).
  - `SELECT { id }` replaces (plain click on a non-selected cell, or single click on the layers panel).
  - `SELECT_TOGGLE { id }` adds/removes a single cell (⌘/ctrl-click in the canvas or layers panel — native multi-select semantics).
  - `SELECT_RANGE { id }` selects every cell in row-major order between the primary anchor and the clicked cell (shift-click in the canvas or layers panel).
- **Text layers.** `selectedTextLayerId: string | null` — drives the Canvas tab; clicking a text layer on canvas or in the Layers panel sets it.
  - `SELECT_TEXT_LAYER { id }`.
- **Watermark.** `selectedWatermark: boolean` — clicking the watermark on canvas sets it; the inspector pivots to the Container tab.
  - `SELECT_WATERMARK { selected }`. Setting `true` also clears cell + text-layer selection.

Click outside any cell / overlay clears every focus (`onStageMouseDown` checks `closest('[data-cell-id]')`, `[data-handle-dir]`, `[data-watermark]`). `Escape` walks the focuses in priority order: text layer → watermark → cells.

Multi-selected cells get the `.cell.multi-selected` modifier (outline thickens to 4 px, non-primary cells dashed). Single selection stays 3 px solid.

### Cell ops

- **`UPDATE_CELL { id, patch }`** — single-cell style patch.
- **`UPDATE_CELLS { ids, patch }`** — fan a patch across multiple cells in a single undo step. Used by batch editing in `Inspector/CellTab` and by paste-style across the multi-selection.
- **`ADD_CELL`** — calls `findMaxEmptyRect`, places a cell sized to the largest empty rectangle (capped at ~half the grid via `capPlacementRect`). Only grows the grid when there's no empty rect.
- **`DUPLICATE_CELL { id }`** — clones a cell's image + style into the largest available whitespace using the same placement rules as `ADD_CELL`. Position-y fields (`offsetX/Y`, `dx/dy/dw/dh`) reset on the clone so it's a clean tile. Falls back to growing the grid only when fully occupied.
- **`REMOVE_CELL`** — runs `compactAfterRemoval`: drop empty tracks → expand same-band neighbour → extend adjacent cell's pixel offsets.
- **`MERGE_CELLS { ids }`** — replaces the primary cell with the bounding rect of all selected cells. Pixel offsets zeroed.
- **`SYNC_CELLS_SHAPE { ids }`** — copies the primary's `shape` + `cellRadius` onto every other selected cell.
- **`SPLIT_CELL { id, axis, count }`** — N sub-cells along an axis. REPLACES the target's S band tracks with N tracks of equal weight (each = `bandTotal / N`). Each sub-cell occupies one of the N new tracks, so halves are always equal AND together cover the same pixel rect the target had before the split. Cells fully outside the band don't move. Cells crossing the band have their grid-coord endpoints snapped to the nearest new track boundary by cumulative-weight proportion; for uniform band weights this is identity. The split never introduces overlap.
- **`SWAP_CELLS { aId, bId }`** — swaps just the *images* between two cells. Used by **shift+drag** in the canvas.
- **`MOVE_CELL`** / **`RESIZE_CELL`** — dispatched from the inspector's number inputs. Run `reflowAroundMover`; `RESIZE_CELL` rejects if displacement would require growing the grid.
- **`MOVE_CELL_DROP { id, col, row }`** — committed by **plain drag** in the canvas. Clamps `(col, row)` into the existing grid, zeroes the dragged cell's pixel offsets, and runs `reflowAroundMover` so cells already at the destination get pushed to free slots (grid grows only when no slot exists). The drop target is computed every frame during the drag (`elementFromPoint` over a cell, otherwise `pointToGridSlot`); a dashed preview rect renders inside `.board` so the user sees exactly where the cell will land.
- **`MOVE_CELL_TO_RECT`** / **`MOVE_CELL_TO_CELL`** — still in the reducer; reachable programmatically (the inspector inputs and template apply paths can use them).
- **`FILL_FROM_FILES`** — assigns multiple uploads to consecutive empty cells, expanding the grid if needed.
- **`FILL_EMPTY_NO_GROW`** — multi-image cell-click upload: surplus images fill empty cells; grid never grows.

### Overlays + container

- **`SET_CONTAINER { patch }`** — covers shape, aspect, padding, gap, border, bg colour/image/fit, **`bgBlur`**, **`bgOverlayColor`**, **`bgOverlayOpacity`**.
- **`SET_WATERMARK { patch }`** — text/image, `font`, `weight`, `color`, `x`/`y` (fractions), `sizePx` (design pixels), `opacity`, `angle`, `enabled`.
- **`ADD_TEXT_LAYER { layer? }`**, **`UPDATE_TEXT_LAYER { id, patch }`**, **`REMOVE_TEXT_LAYER { id }`**, **`REORDER_TEXT_LAYER { id, direction }`**. Each text layer carries `x/y` (fractions), `size` (design px), `font`, `weight`, `color`, `align`, `rotation`, `opacity`, and a `z` band: `behind-container | behind-cells | in-front-of-cells | in-front-of-container`. Paint order = array order within each band.

### Style clipboard

`state/styleClipboard.ts` is a tiny module-scoped buffer (not in `PhotoGridState`, intentionally session-only). The right-click context menu's **Copy style** captures `fit`, `scale`, `rotation`, `filter`, `filters`, `shape`, `cellRadius`, `cellBorder`, `cellBorderColor`. **Paste style** dispatches `UPDATE_CELL` (single cell) or `UPDATE_CELLS` (fans across the multi-selection). The buffer never includes the cell's image, position, or span — paste only swaps the look. Subscribers re-render the menu so "Paste style" appears reactively when something is on the clipboard.

### Resize

Two separate code paths under one set of 8 handles, picked by `dir.length === 2`:

- **`RESIZE_TRACKS { colSizes?, rowSizes? }`** — corner handles (NE/NW/SE/SW). `onHandleDown` figures out which two adjacent tracks the corner sits between; on each frame the cursor delta is converted to an fr-shift. The growing track gains, the next-adjacent track gives back the same fr (clamped at `MIN_TRACK_FR`). All cells in those bands resize proportionally.
- **`EDGE_RESIZE { updates }`** — edge handles (E/W/N/S). `onHandleDown` looks at the **pixel-space** rects of every other cell and identifies "immediate neighbours" (cells whose visual edge is `container.gap` away from the mover's edge AND whose perpendicular range is contained in the mover's). Two regimes:
  - With neighbours present → mover grows by Δ, each neighbour shifts and shrinks by Δ (cell-pair mode).
  - With no neighbours → mover grows alone into whitespace until it reaches the next cell or the canvas inner padding.
  Both paths dispatch a single `EDGE_RESIZE` action per frame containing `{ id, dx?, dy?, dw?, dh? }` patches for every affected cell.

### Layout normalisation

- **`SET_GRID`** — fills uncovered slots with empty cells and drops out-of-bounds cells, keeping the Layers panel 1:1 with the visible grid. Resets `colSizes`/`rowSizes` for any axis whose track count changed.
- **`ALIGN_GRID`** — see § 4d.

### Random layout generator

- **`GENERATE_RANDOM_LAYOUT { cellCount, squaresOnly? }`** — produces a fresh layout with `cellCount` cells (1–200). The geometry comes from `generateRandomLayout`: start with a 1×1 normalised rect, repeatedly split the largest rect along its longer axis at a 30–70 % ratio until N rects exist, then derive `cols`/`rows`/`colSizes`/`rowSizes` from the distinct x/y edges. Every track is occupied by at least one cell, so there's no whitespace.
- The generator is also a **mood picker**. `pickMood(squaresOnly)` returns one of nine hand-tuned bundles (Bento, Mosaic, Matted, Polaroid, Garden, Geometric, Mixed media, Minimal, Soft) describing the container shape pool, aspect pool, cell shape pool, and gap / padding / corner-radius ranges. Per-cell shape and per-canvas gap/padding are then jittered within the mood's ranges so re-clicking the button produces visibly different results.
- The `squaresOnly` flag short-circuits to a single rect-only mood (square aspect, rect cells, mid gap/padding) for users who want a uniform tile board.

---

## 7. Drag system (mouse-only, no HTML5 inside cells)

`StageCanvas.tsx` owns one mousedown handler (`onCellMouseDown`) and one set of window listeners. The flow:

1. **Mousedown on a cell** — records intent into a `dragRef` (a `useRef`, not state — no re-renders during drag): `{ kind, cellId, startX/Y, baseOffsetX/Y, imgEl, scale, rotation, invZoom, ghostSrc, nativeFit, wasPrimary, wasSelected, shift, meta, alt, dropCol?, dropRow? }`. Right- and middle-clicks (`e.button !== 0`) bail out before the ref is set, so the right-click menu can't accidentally trigger a click-as-drag.
2. **Drag kind** is decided at mousedown by modifier keys + cell state:
   - `shift` + populated cell → `swap` (drop on another cell to swap images).
   - `alt` (with or without an image) → `move` (relocate the cell to a new grid slot).
   - plain drag + populated cell → `reposition` (drag the image inside the cell).
   - plain drag + empty cell → `move` (no image to reposition).
3. **Selection rules on mousedown:**
   - plain click on an unselected cell → `SELECT` (replace) immediately so the resize handles + drag target light up.
   - shift / meta / primary-cell clicks are **resolved on mouseup** so a drag with that modifier never leaves a dangling selection toggle.
4. **Window mousemove** updates `curX/Y` in the ref. Movement past `CLICK_THRESHOLD = 4 px` flips `moved` to true and schedules a `requestAnimationFrame`.
5. The **frame callback** branches on `kind`:
   - **reposition:** mutates `imgEl.style.transform` directly (no React). Native fit prepends `translate(-50%, -50%)` so offsets are measured from the cell centre.
   - **swap:** updates the `ghost` React state, runs `document.elementFromPoint` to find the cell under the cursor, stores `overId` so the target highlights.
   - **move:** same `elementFromPoint` lookup, plus a fallback through `pointToGridSlot` for whitespace drops. The resolved `(col, row)` is clamped into the existing grid and stored on `dragRef.current.dropCol / dropRow`. The frame callback also computes a design-space `dropRect` (via `computeCellRect` on a synthetic ghost cell at `(col, row)`) so the dashed preview renders inside `.board`.
6. **Mouseup commits** via dispatch:
   - If `!moved && drag.shift` → `SELECT_RANGE` (range from anchor → clicked).
   - If `!moved && drag.meta` → `SELECT_TOGGLE` (multi-select toggle).
   - If `!moved && plain && !wasPrimary` → `SELECT` (just focus the cell). The file picker still only opens on dbl-click.
   - If `moved && kind === 'reposition'` → `UPDATE_CELL { offsetX, offsetY }`.
   - If `moved && kind === 'swap' && drag.overId` → `SWAP_CELLS` (images only). Wrapped in `document.startViewTransition` when supported.
   - If `moved && kind === 'move' && (dropCol, dropRow) ≠ original` → `MOVE_CELL_DROP { id, col, row }`. Cells already at the destination are pushed by `reflowAroundMover` (grid grows only when no slot exists). Wrapped in `document.startViewTransition` so the displaced cells animate.
7. **Double-click** on a cell calls `uploadToCell(id)`. The handler is guarded by a `pickerOpenRef`: once a file picker opens, further calls are dropped until the picker resolves (via the `cancel` event on Chromium/Safari, or a 200 ms-delayed `window` focus fallback on Firefox). A rapid triple-click can therefore only ever produce a single OS dialog.
8. **Wheel on a populated cell** zooms the image inside (`cell.scale *= e^(-deltaY * 0.0015)`, clamped to `[0.05, 5]`).

### Overlay drag (watermark + text layers)

Both watermarks and text layers live inside `.board` (or as siblings for the unclipped text z-bands) and use a shared `useDispatchedFractionDrag(dims, commit)` helper. On mousedown the helper measures the host element (`.board` or `.board-frame`) and wires `mousemove`/`mouseup` to translate the cursor into 0..1 fractions of the design canvas, dispatching the matching action on every frame:

- Watermark drag → `SET_WATERMARK { x, y }`.
- Text-layer drag → `UPDATE_TEXT_LAYER { id, patch: { x, y } }`.

Clicking either overlay also selects it: text layer → `SELECT_TEXT_LAYER` (Inspector pivots to the Canvas tab); watermark → `SELECT_WATERMARK` (Inspector pivots to the Container tab). Both pick up a dashed outline while selected and clear on stage-backdrop click or `Escape`.

### Resize handles

A separate overlay (`<ResizeHandles>`) lives inside `.board` (after `.grid-area`), not inside any cell. It reads the **primary** selected cell's grid coords + offsets via `computeCellRect` and absolutely positions 8 handles. Hit targets are 22 design-pixels wide with a 14-pixel visible pip; both are counter-scaled by zoom so they stay clickable on zoomed-out canvases.

`onHandleDown` distinguishes by `dir.length`:
- **Length 2** (NE/NW/SE/SW) → track mode, sets up `RESIZE_TRACKS` deltas.
- **Length 1** (E/W/N/S) → edge mode, sets up `EDGE_RESIZE` deltas.

Both modes also snapshot the alignment lines — every other cell's left/right/top/bottom edges plus the canvas inner padding edges — into `alignXs` / `alignYs`. On each drag frame the resizer checks whether the moving edge is within `ALIGN_EPS` (4 px) of any of those positions and renders a thin dashed `1px` line at that x or y. The guides clear on mouseup.

OS file drops still use HTML5 drag-and-drop on the stage element itself, but every handler gates on `dataTransfer.types.includes('Files')` so internal mouse drags never trigger the file-drop overlay.

### Right-click context menu

`StageCanvas.tsx:onStageContextMenu` opens a custom `<ContextMenu>` (`components/ContextMenu.tsx`) at the cursor when the user right-clicks a cell. The menu is portalled into `document.body`, measured after mount, and nudged inward if it would overflow the viewport. Right-click on the stage backdrop (no cell under cursor) falls through to the browser's native menu.

Items are decided by `buildContextMenu(...)` from the current selection and the in-memory `StyleClipboard`:
- **Single-cell selection** — Upload / Replace, Copy style, Paste style (only when something is on the clipboard), Split into 2 rows, Split into 2 columns, Delete cell.
- **Multi-cell selection** — Merge cells (⌘M), Sync shape, Copy style (from primary), Paste style to N cells, Delete N cells.

Right-clicking a cell that isn't already in the multi-selection replaces the selection with that cell first, so the menu's actions target a sensible thing.

### Cell border rendering

`cell.cellBorder` paints as a dedicated absolute overlay div (inset:0, `pointerEvents: none`, `z-index: 2`) carrying the inset box-shadow + the cell's clip-path. A naive `box-shadow: inset` on the cell itself would be hidden by the cell's `<img>` because CSS paints inset shadows before children. The overlay sits *above* the image, inherits the shape mask, and so renders correctly for every shape — rect, rounded, and polygon clip-paths alike.

---

## 8. Click & focus rules at a glance

| Source | Target state | Modifier | Outcome |
| --- | --- | --- | --- |
| Click cell | Any (empty or populated) | none | Focus the cell. **No file picker on single click.** |
| Click cell | Already primary-selected | none | No-op (cell stays focused). |
| Click cell | Any | Shift | Range-select from primary anchor to this cell. |
| Click cell | Any | ⌘ / Ctrl | Toggle this cell in the multi-selection. |
| Double-click cell | Any | none | Open the file picker. Guarded — rapid extra clicks are dropped while the picker is open. |
| Drag cell | Populated | none | Reposition image inside cell (`offsetX/Y`). |
| Drag cell | Empty | none | Move the cell to a new grid slot (no image to reposition). |
| Drag cell | Any | Alt | Move the cell to a new grid slot; cells at the destination reflow out of the way. Drop preview rect renders in `.board`. |
| Drag cell | Populated | Shift | Drop on another cell → `SWAP_CELLS` (images only). |
| Drag E/W/N/S handle | Primary cell | none | Edge resize (cell pair). |
| Drag corner handle | Primary cell | none | Track redistribute (entire band). |
| Wheel over cell | Populated | none | Zoom image (`cell.scale`). |
| Drag watermark / text overlay | n/a | none | Move overlay; `x`/`y` updated live. |
| Click watermark / text overlay | n/a | none | Select it; Inspector pivots (Container / Canvas tab). |
| Click stage backdrop | n/a | none | Clear cell + text-layer + watermark selection. |
| Right-click cell | Any | n/a | Context menu — Upload, Copy/Paste style, Split rows/cols, Delete; multi-select shows Merge / Sync shape / Copy / Paste to N / Delete-all. |
| Right-click cell | Any | n/a | Does **not** open the file picker (mousedown bails on `e.button !== 0`). |
| Right-click stage | Whitespace | n/a | Native browser menu (no in-app override). |
| `Escape` (no input focused) | n/a | n/a | Clears focus in priority order: text layer → watermark → cells. |
| `Delete` / `Backspace` | Text layer selected | n/a | Remove the text layer. |
| `Delete` / `Backspace` | Cells selected | n/a | Remove every selected cell. |
| ⌘M | 2+ cells selected | n/a | Merge into the bounding rect (primary's image survives). |
| ⌘E | n/a | n/a | Export. |
| ⌘Z / ⌘⇧Z | n/a | n/a | Undo / redo. |
| Click Upload / Export | n/a | n/a | Disabled while either upload or export is in flight. |
| Templates list — single-click | n/a | n/a | Apply the template. |
| Templates list — double-click name | n/a | n/a | Inline rename (Enter saves via `Templates.rename`, Esc cancels). |

---

## 9. Build & deploy

- **Frontend Dockerfile** is multi-stage: `node:20-alpine` builds the SPA (`vite build`); `nginx:1.27-alpine` serves the static output. The `nginx.conf` adds gzip, an `/healthz` endpoint, the SPA fallback, and the `/api/*` reverse proxy to `backend:8000`.
- **Backend Dockerfile** is also multi-stage: a build stage installs from `pyproject.toml` (with `[vips]` extra) into `/install`; the runtime stage is `python:3.12-slim` with only the runtime libs (`libmagic1`, `libheif1`, `libvips42`, etc.). Runs as a non-root `app` user. `HEALTHCHECK` curls `/api/healthz`.
- **Compose** uses one named volume (`photogrid-cache`) mounted at `/var/cache/photogrid` in the backend. The frontend `depends_on: backend: condition: service_healthy` so it only comes up after the API is ready.
- **Prod overlay** (`docker-compose.prod.yml`) switches the backend to gunicorn, adds resource limits (2 GB / 2 CPU on backend, 256 MB / 0.5 CPU on frontend), and rotates JSON logs at 10 MB × 5.

---

## 10. Testing

- **`backend/tests/`** — pytest covers `dimensions_for` math, the full filter list, every shape mask, `grid_tracks` (uniform and non-uniform), and an upload→export roundtrip via FastAPI's `TestClient`. The `isolated_cache` fixture makes each test run against its own temp `CACHE_DIR`. 27 tests at last count.
- **`scripts/e2e/smoke.mjs`** — Playwright. Opens the live frontend, walks through Output/Container/Cell tabs, selects a cell, drags the SE corner handle (asserts all cells redistribute and the container size doesn't change), drags the E edge handle (asserts only the row pair changes), saves a template, loads it, verifies the cell count is preserved. Intended to run against `make up` (`http://localhost:8090`) either via the upstream Microsoft Playwright Docker image or with Playwright installed locally.

---

## 11. Configuration cheatsheet

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

## 12. Where each user-facing feature is implemented

| Feature | Frontend | Backend |
| --- | --- | --- |
| Layout presets | `state/presets.ts:LAYOUT_PRESETS`, `LeftPanel` | n/a (drives state only) |
| Container shapes | `state/shapes.ts:shapeCSS` | `renderer/shapes.py:make_container_mask` |
| Per-cell shapes | `state/shapes.ts:cellShapeCSS` + `Inspector/CellTab` picker | same `make_container_mask`, gated in `pillow_renderer.py` |
| Image fit modes (native / cover / contain / fill) | `Inspector/CellTab` Seg + inline `<img>` style | `renderer/cells.py:fit_dims` + `compose_cell` |
| CSS filters (legacy string) | inline `style={{ filter }}` | `renderer/filters.py:apply_css_filter` |
| Per-cell filter sliders (structured `cell.filters`) | `state/reducer.ts:filtersToCss` / `cssToFilters` + filter rows in `Inspector/CellTab.tsx` | reducer serialises back to the legacy CSS string consumed by `filters.py` |
| Batch cell editing (multi-select) | `state/reducer.ts:UPDATE_CELLS` + `Inspector/CellTab.tsx` (hides Position / Split / image upload when multi) | n/a |
| Copy / paste cell style | `state/styleClipboard.ts` + context-menu items in `StageCanvas.tsx:buildContextMenu` | n/a |
| Cell selection (single + range + toggle) | `state/reducer.ts:SELECT` / `SELECT_RANGE` / `SELECT_TOGGLE`, `StageCanvas.tsx:onCellMouseDown` (shift = range, ⌘/ctrl = toggle); same modifiers in `LeftPanel.tsx` layer rows | n/a |
| Click outside → deselect | `StageCanvas.tsx:onStageMouseDown`, `Escape` keybind in `App.tsx` (text → watermark → cells) | n/a |
| Click rule (single click only focuses; double-click opens picker, debounced) | `dragRef.{wasPrimary, shift}` checked in mouseup; `pickerOpenRef` guard in `uploadToCell` | n/a |
| Right-click never opens picker | `onCellMouseDown` bails on `e.button !== 0` | n/a |
| Cell drag (plain = reposition image, alt = move cell, shift = swap images) | `StageCanvas.tsx:onCellMouseDown` + window listeners; `UPDATE_CELL` / `MOVE_CELL_DROP` / `SWAP_CELLS` dispatched on mouseup based on `dragRef.kind`. Drop preview rendered inside `.board` for `move` drags. | n/a |
| Wheel zoom inside a cell | `CellView.onWheel` → `UPDATE_CELL { scale }` | scale baked in by `compose_cell` |
| Edge resize (cell pair) | `StageCanvas.tsx:onHandleDown` edge branch + `EDGE_RESIZE` | `cell_box(...dx, dy, dw, dh)` |
| Corner resize (track redistribute) | `StageCanvas.tsx:onHandleDown` corner branch + `RESIZE_TRACKS` | `grid_tracks(...col_sizes, row_sizes)` |
| Edge resize into whitespace | `onHandleDown` no-immediates branch using `gapDistance` | same `cell_box` math |
| Resize alignment guides | snapshot `alignXs`/`alignYs` in `onHandleDown`, dashed-line overlay rendered by `StageCanvas` | n/a |
| Add Cell / Duplicate Cell into largest empty rect (capped) | `state/reducer.ts:findMaxEmptyRect` + `capPlacementRect` + `ADD_CELL` / `DUPLICATE_CELL`; right-click "Duplicate cell" wires through `StageCanvas:buildContextMenu` | n/a |
| Remove Cell auto-absorbs whitespace | `state/reducer.ts:compactAfterRemoval` (3 strategies) | n/a |
| Merge selected cells | `state/reducer.ts:MERGE_CELLS`, button in `Inspector/CellTab` when 2+ selected, `⌘M` | n/a |
| Sync shape across selection | `state/reducer.ts:SYNC_CELLS_SHAPE`, multi-select context menu | n/a |
| Split cell into N rows / cols (equal halves; target rect preserved; no overlap) | `state/reducer.ts:SPLIT_CELL` replaces the band's S tracks with N equal-weight tracks (each = bandTotal/N); sub-cells span exactly one new track each; cells crossing the band have endpoints snapped to the nearest new track boundary by cumulative-weight proportion. `Inspector/CellTab:SplitControls`, single-cell context menu. | n/a |
| Random layout generator | `state/reducer.ts:generateRandomLayout` + `MOODS` table; `LeftPanel` "Random" section with cell-count input + "Squares only" toggle | n/a |
| Right-click context menu | `components/ContextMenu.tsx` (portalled, viewport-aware); `StageCanvas:onStageContextMenu` + `buildContextMenu` decides items | n/a |
| Cell border render | dedicated overlay div in `StageCanvas:CellView` (`borderOverlayStyle`) so the inset stroke paints above the image | inset stroke band in `renderer/shapes.py:stroke_cell` |
| Align Grid | `state/reducer.ts:alignGrid`, button in `TopBar` | n/a |
| Multi-image upload from a cell | `StageCanvas.tsx:uploadToCell` (multi-file) → `FILL_EMPTY_NO_GROW` | `/api/images` per file |
| Cover-fit initial scale on upload | `coverFitScale` in `state/reducer.ts`, called from upload paths | n/a |
| Container background image | `Inspector/ContainerTab` upload + `<img>` in board; click the populated row to re-pick | `renderer/pillow_renderer.py:_fit_image` |
| Container bg blur + flat-colour overlay | `Container.bgBlur` (CSS `filter: blur`) + overlay `<div>` between bg and cells | `pillow_renderer.py` runs `ImageFilter.GaussianBlur(radius * scale)` on the bg image and alpha-composites a `bgOverlayColor × bgOverlayOpacity` layer before the cell loop |
| Container border (canvas matches export) | top-most shape-clipped overlay `<div>` inside `.board` (no longer an inset boxShadow on `.board` itself, which was hidden by children) | `renderer/shapes.py:stroke_container` (unchanged) |
| Watermark | `state/reducer.ts:SET_WATERMARK` / `SELECT_WATERMARK`, `Inspector/ContainerTab` Watermark section, `StageCanvas:WatermarkOverlay` (mouse-draggable, click-to-select) | `renderer/overlays.py:composite_watermark` (rasterises text via `_load_font(family, size, weight)` or scales the cached image at `sizePx * scale`) |
| Text overlays (4 z-bands) | `state/reducer.ts:ADD/UPDATE/REMOVE/REORDER_TEXT_LAYER`, `Inspector/CanvasTab.tsx` (NEW) for per-layer editing, `StageCanvas:TextLayersBand` (clipped) + `UnclippedTextBand` (siblings of `.board` for behind-/in-front-of-container), shared `useDispatchedFractionDrag` | `renderer/overlays.py:composite_text_layer` + paint order in `pillow_renderer.py` (behind-cells before cells, in-front-of-cells before container clip, behind-container/in-front-of-container outside the clip) |
| Layers panel includes text layers | `LeftPanel.tsx` Layers section iterates `state.textLayers` first then cells; "+" buttons add a text layer or a cell | n/a |
| Heart silhouette parity | `state/shapes.ts` SVG path | `renderer/shapes.py` samples the same four cubic beziers at 64 steps each |
| Output filename + format (PNG / JPG / WebP / SVG) | `Inspector/OutputTab` File section; default name auto-generated by `state/reducer.ts:generateFilename` → `PG_YYYYMMDD_HHMMSS`, regenerated on `RESET` / `REPLACE` / `APPLY_PRESET` | response `Content-Disposition` is ignored; frontend owns the name. SVG path is a base64-PNG `<image>` wrapper (`pillow_renderer.py:_encode`) |
| Save folder + filename dedup | `api/folder.ts` (FSA + IndexedDB); `writeBlobToFolder` walks `_1`, `_2`, … and returns the actual saved name | n/a |
| Disable Upload / Export while busy | `App.tsx:uploading` + `exporting` flags → `TopBar` `busy` prop. The `uploading` flag is also threaded into `StageCanvas`, `LeftPanel`, and `Inspector` (CellTab + ContainerTab) so per-cell, bg, and watermark file pickers are gated, and `StageCanvas` paints a blocking spinner overlay while uploads are in flight. | n/a |
| Image fit (export EXIF orientation) | n/a | `api/images.py:upload` and `renderer/pillow_renderer.py:_open_source` / bg image / `renderer/overlays.py:composite_watermark` all run `ImageOps.exif_transpose` so the orientation of cover/contain/fill matches the browser's `createImageBitmap` preview. |
| Templates | `state/templates.ts` (localStorage) + `LeftPanel` (delete confirmation via `<Modal>`, `<TemplateRow>` with double-click rename → `Templates.rename`) | rehydrates cell + bg-image + watermark-image previews via `GET /api/images/{hash}` |
| Shuffle defaults to live cell count | `LeftPanel.tsx` useEffect syncs `randRaw` to `state.cells.length` on every change | n/a |
| Undo / redo | `state/history.ts` + ⌘Z keybinds in `App.tsx` | n/a |
| Theme | `App.tsx` toggles `data-theme` on `<html>`; tokens in `styles/tokens.css` | n/a |
