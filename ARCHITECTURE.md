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

`renderer/pillow_renderer.py:_render_sync`:

1. **Output size.** `dimensions_for(aspect, baseSize)` (mirrors the frontend's `dimensionsFor`) produces the unscaled `(w, h)`. `output.scale ∈ {1,2,3,4}` multiplies. Pixel-budget guard rejects anything past `MAX_PIXELS_MP`.
2. **Base canvas.** Transparent RGBA at `(W, H)`.
3. **Container background.** If `bgTransparent` is false, fill with `cont.bg`. If `cont.bgImage` is set, open that hash from cache, run `_fit_image` (cover/contain/fill — same semantics as object-fit), composite over the colour fill.
4. **Layout.** `grid_tracks(W, H, padding, gap, cols, rows, col_sizes, row_sizes)` returns a `GridTracks` whose `col_widths` and `row_heights` are **per-track pixel widths** (length `cols`/`rows`) — non-uniform when the user has corner-resized or run Align. `cell_box(...)` walks the cumulative track widths plus the cell's `dx/dy/dw/dh` (multiplied by `output.scale` to match the scaled-pixel canvas) to produce the cell's absolute pixel rectangle.
5. **For each cell:**
   - Build the cell shape mask. If `cell.shape != 'rect'`, reuse `make_container_mask` (same code path as the container shape). Otherwise `make_cell_mask` honours `cellRadius`.
   - Open the source from cache (`Image.open` + `.convert('RGBA')`).
   - Apply CSS filters: `apply_css_filter` parses tokens like `contrast(1.15) saturate(1.2)` with a small regex tokenizer and chains `ImageEnhance` operations or hand-written numpy paths (sepia matrix multiply, hue-rotate via HSV channel rotation).
   - `compose_cell(src, box, cell, mask, pixel_scale)` resamples the image to its target display size, applies `cell.scale`, rotates by `-cell.rotation` (PIL is CCW, CSS is CW), positions inside the cell box with `cell.offsetX/Y` (multiplied by `pixel_scale` so the design-pixel offsets land on the correct output pixels). For `fit == 'native'` the image renders at its intrinsic dimensions (`iw × ih × pixel_scale`); for cover/contain/fill the existing object-fit math runs. Cover-fit + rotation pre-scales by `|cosθ|+|sinθ|` so the rotated image still covers the cell.
   - The cell mask is multiplied with the tile's existing alpha (numpy `arr_a * arr_m // 255`) so rounded/clipped cell shapes survive composition.
   - `alpha_composite` the tile onto the base.
   - If `cellBorder > 0`, `stroke_cell` paints an inset stroke band by subtracting an eroded mask (`ImageFilter.MinFilter`) from the original mask.
6. **Container mask.** `make_container_mask` for the requested shape; multiplied into the base alpha.
7. **Container border.** Same erosion-band trick at the container level.
8. **Encode.** PNG with `optimize=True`; JPEG with quality + progressive baseline (alpha is flattened on white if present); WebP with `method=6` for best compression. **SVG** is a thin wrapper: encode to PNG first, then emit `<svg viewBox="0 0 W H"><image href="data:image/png;base64,…"/></svg>`. It's not vector geometry — the wrapper's value is producing an `.svg` file the user can drop into vector tools / web pages without losing pixel fidelity.

The mask functions (`renderer/shapes.py`) render at 2× scale via `ImageDraw` then downsample with LANCZOS for anti-aliased edges. Polygon shapes (rect, rounded, circle, oval, hexagon, diamond, arch, squircle, **triangle, pentagon, octagon, star, parallelogram, chevron**) are exact. Heart and blob are approximated with overlapping ellipses + polygons.

---

## 6. State management

`frontend/src/state/reducer.ts` is the single source of truth.

- **`PhotoGridState`**: `{ container, grid, cells, selectedCellIds, output, canvas }`. Every action returns a new immutable copy; React re-renders only the parts that referentially changed.
- **`useHistoryReducer`** (`state/history.ts`) wraps `useReducer` with a 60-step ring buffer. Selection, zoom, undo, redo are flagged ephemeral — they don't push to history. ⌘Z / ⌘⇧Z hit window-level handlers in `App.tsx`.

### Selection model

`selectedCellIds` is an array. The first id is the **primary** — what the inspector reads, and what the merge action keeps as the surviving cell. Empty array = nothing selected.

- `SELECT { id }` replaces the selection (single id or none).
- `SELECT_TOGGLE { id }` adds/removes (cmd/ctrl+click in the canvas or layers panel).
- Click outside any cell clears the selection (`onStageMouseDown` checks `closest('[data-cell-id]')` / `closest('[data-handle-dir]')`).
- `Escape` deselects via the keybind in `App.tsx`.

Multi-selected cells get the `.cell.multi-selected` modifier so the outline thickens (4 px) and non-primary cells get a softer dashed variant (`.cell.multi-selected.selected:not(.primary)`). The `--focus` token is theme-inverted (white on dark, black on light) so the selection always pops against any cell background. Single selection stays at 3 px solid.

### Cell ops

- **`ADD_CELL`** — calls `findMaxEmptyRect`, places a cell sized to the largest empty rectangle. Only grows the grid (extending `colSizes`/`rowSizes` with the average existing weight) when there's no empty rect.
- **`REMOVE_CELL`** — runs `compactAfterRemoval`, which tries three strategies in order to absorb the freed area:
  1. Drop fully-empty column or row tracks (and shift remaining cells / size arrays).
  2. Expand a same-band neighbour's span across the freed grid cells.
  3. Extend an adjacent cell's pixel offsets to visually cover the freed pixel rect — but only when that extension wouldn't overlap any other cell.
- **`MERGE_CELLS { ids }`** — replaces the primary cell with the bounding rect of all selected cells, drops the rest. Pixel offsets on the surviving cell are zeroed.
- **`SYNC_CELLS_SHAPE { ids }`** — copies the primary cell's `shape` + `cellRadius` onto every other selected cell. Keeps images and positions; just unifies silhouettes.
- **`SPLIT_CELL { id, axis, count }`** — replaces a cell with N stacked sub-cells along the given axis (`row` or `col`). Inserts `N-1` new tracks within the target's band; cells that intersect the band gain matching span so their visual size is preserved. Track weights for the inserted rows/cols are derived from the original band's weight so other cells outside the band don't move. The image (if any) is copied into every sub-cell.
- **`MOVE_CELL_TO_RECT { id, colStart, rowStart, colSpan, rowSpan }`** — used by shift-drag onto whitespace. Snaps the cell to that empty rect at destination size, clearing pixel offsets.
- **`MOVE_CELL_TO_CELL { sourceId, targetId }`** — shift-drag onto another cell. Swaps positions+spans wholesale.
- **`SWAP_CELLS { aId, bId }`** — swaps just the *images* between two cells (no shift modifier).
- **`MOVE_CELL`** / **`RESIZE_CELL`** — dispatched from the inspector's number inputs. Run `reflowAroundMover` to relocate any displaced cells; `RESIZE_CELL` rejects if displacement would require growing the grid.
- **`FILL_FROM_FILES`** — assigns multiple uploads to consecutive empty cells, expanding the grid if there aren't enough.
- **`FILL_EMPTY_NO_GROW`** — multi-image cell-click upload: surplus images go into empty cells, but the grid is never grown; extras are discarded.

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

1. **Mousedown on a cell** — records intent into a `dragRef` (a `useRef`, not state — no re-renders during drag): `{ kind, cellId, startX/Y, baseOffsetX/Y, imgEl, scale, rotation, invZoom, ghostSrc, nativeFit, wasPrimary, cmdOrCtrl, … }`. `kind` is `move` if `shiftKey`, otherwise `reposition` (used for both populated cells and the empty-cell click path).
2. **Selection rules apply on mousedown** so they take effect even if the user only clicks (no drag past `CLICK_THRESHOLD = 4` px):
   - cmd/ctrl+click → `SELECT_TOGGLE` (multi-select).
   - plain click on an unselected cell → `SELECT` (replace).
   - plain click on an already-primary-selected cell → no dispatch yet; the mouseup path decides.
3. **Window mousemove** updates `curX/Y` in the ref. Movement past `CLICK_THRESHOLD` flips `moved` to true and schedules a `requestAnimationFrame`.
4. The **frame callback** does one of two things:
   - **Reposition:** mutates `imgEl.style.transform` directly (no React). Native fit prepends `translate(-50%, -50%)` so offsets are measured from the cell centre.
   - **Swap / move:** updates the `ghost` React state, runs `document.elementFromPoint` to find the cell under the cursor (via `[data-cell-id]`), and stores `overId`.
5. **Mouseup commits** via dispatch:
   - If `!moved` and the cell is empty → open the file picker.
   - If `!moved` and the cell is populated AND was already primary-selected → open the file picker (re-clicking a focused image opens "replace").
   - If `!moved` and the cell is populated AND wasn't primary → just selected; nothing to do.
   - cmd/ctrl modifier suppresses the picker entirely (the click was a multi-select intent).
   - If `moved && kind === 'reposition'` → `UPDATE_CELL { offsetX, offsetY }`.
   - If `moved && drag.overId` → `MOVE_CELL_TO_CELL` (shift) or `SWAP_CELLS` (no shift). Wrapped in `document.startViewTransition` when the browser supports it.
   - If `moved && kind === 'move' && !overId` → `pointToGridSlot(curX, curY, …)` finds the largest empty rectangle at that point; if any, dispatch `MOVE_CELL_TO_RECT` to snap the dragged cell to it.
6. **Wheel on a populated cell** zooms the image inside (`cell.scale *= e^(-deltaY * 0.0015)`, clamped to `[0.05, 5]`).

### Resize handles

A separate overlay (`<ResizeHandles>`) lives inside `.board` (after `.grid-area`), not inside any cell. It reads the **primary** selected cell's grid coords + offsets via `computeCellRect` and absolutely positions 8 handles. Hit targets are 22 design-pixels wide with a 14-pixel visible pip; both are counter-scaled by zoom so they stay clickable on zoomed-out canvases.

`onHandleDown` distinguishes by `dir.length`:
- **Length 2** (NE/NW/SE/SW) → track mode, sets up `RESIZE_TRACKS` deltas.
- **Length 1** (E/W/N/S) → edge mode, sets up `EDGE_RESIZE` deltas.

Both modes also snapshot the alignment lines — every other cell's left/right/top/bottom edges plus the canvas inner padding edges — into `alignXs` / `alignYs`. On each drag frame the resizer checks whether the moving edge is within `ALIGN_EPS` (4 px) of any of those positions and renders a thin dashed `1px` line at that x or y. The guides clear on mouseup.

OS file drops still use HTML5 drag-and-drop on the stage element itself, but every handler gates on `dataTransfer.types.includes('Files')` so internal mouse drags never trigger the file-drop overlay.

### Right-click context menu

`StageCanvas.tsx:onStageContextMenu` opens a custom `<ContextMenu>` (`components/ContextMenu.tsx`) at the cursor when the user right-clicks a cell. The menu is portalled into `document.body`, measured after mount, and nudged inward if it would overflow the viewport (so it always lands on-screen). Right-click on the stage backdrop (no cell under cursor) falls through to the browser's native menu.

Items are decided by `buildContextMenu(...)` from the current selection:
- **Single-cell selection** — Upload / Replace, Split into 2 rows, Split into 2 columns, Delete cell.
- **Multi-cell selection** — Merge cells (⌘M), Sync shape (apply primary's shape to all selected), Delete N cells.

Right-clicking a cell that isn't already in the multi-selection replaces the selection with that cell first, so the menu's actions target a sensible thing.

### Cell border rendering

`cell.cellBorder` paints as a dedicated absolute overlay div (inset:0, `pointerEvents: none`, `z-index: 2`) carrying the inset box-shadow + the cell's clip-path. A naive `box-shadow: inset` on the cell itself would be hidden by the cell's `<img>` because CSS paints inset shadows before children. The overlay sits *above* the image, inherits the shape mask, and so renders correctly for every shape — rect, rounded, and polygon clip-paths alike.

---

## 8. Click & focus rules at a glance

| Source | Cell state | Modifier | Outcome |
| --- | --- | --- | --- |
| Click cell | Empty | none | Open file picker |
| Click cell | Populated, not primary-selected | none | Become the sole selection; no picker |
| Click cell | Populated, primary-selected | none | Open file picker (replace) |
| Click cell | Any | ⌘ / Ctrl | Toggle this cell in the multi-selection |
| Click stage backdrop / handles overlay container | n/a | none | Clear selection |
| `Escape` (no input focused) | n/a | none | Clear selection |
| Drag inside cell | Populated | none | Reposition image (offsetX/Y) |
| Drag inside cell | Populated | Shift | Move cell to drop target (cell → swap, whitespace → snap to empty rect) |
| Drag E/W/N/S handle | Primary cell | none | Edge resize (cell pair) |
| Drag corner handle | Primary cell | none | Track redistribute (entire band) |
| Wheel over cell | Populated | none | Zoom image (`cell.scale`) |
| `Delete` / `Backspace` | Cells selected | none | Remove every selected cell |
| ⌘M | 2+ cells selected | n/a | Merge into the bounding rect (primary's image survives) |
| ⌘E | n/a | n/a | Export |
| ⌘Z / ⌘⇧Z | n/a | n/a | Undo / redo |
| Right-click cell | Any | n/a | Open context menu (Upload, Split rows/cols, Delete; multi-select shows Merge / Sync shape / Delete-all) |
| Right-click stage | Whitespace | n/a | Native browser menu (no in-app override) |
| Click Upload / Export | n/a | n/a | Disabled while either upload or export is in flight |

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
| CSS filters | inline `style={{ filter }}` | `renderer/filters.py:apply_css_filter` |
| Cell selection (single + multi) | `state/reducer.ts:SELECT` / `SELECT_TOGGLE`, `StageCanvas.tsx:onCellMouseDown` | n/a |
| Click outside → deselect | `StageCanvas.tsx:onStageMouseDown`, `Escape` keybind in `App.tsx` | n/a |
| Click rules (empty → picker, populated unfocused → focus, populated focused → picker) | `dragRef.{wasPrimary,cmdOrCtrl}` checked in mouseup | n/a |
| Cell drag (reposition / swap / shift-move / shift-to-whitespace) | `StageCanvas.tsx:onCellMouseDown` + window listeners + `pointToGridSlot` | n/a |
| Wheel zoom inside a cell | `CellView.onWheel` → `UPDATE_CELL { scale }` | scale baked in by `compose_cell` |
| Edge resize (cell pair) | `StageCanvas.tsx:onHandleDown` edge branch + `EDGE_RESIZE` | `cell_box(...dx, dy, dw, dh)` |
| Corner resize (track redistribute) | `StageCanvas.tsx:onHandleDown` corner branch + `RESIZE_TRACKS` | `grid_tracks(...col_sizes, row_sizes)` |
| Edge resize into whitespace | `onHandleDown` no-immediates branch using `gapDistance` | same `cell_box` math |
| Resize alignment guides | snapshot `alignXs`/`alignYs` in `onHandleDown`, dashed-line overlay rendered by `StageCanvas` | n/a |
| Add Cell finds largest empty rect | `state/reducer.ts:findMaxEmptyRect` + `ADD_CELL` | n/a |
| Remove Cell auto-absorbs whitespace | `state/reducer.ts:compactAfterRemoval` (3 strategies) | n/a |
| Merge selected cells | `state/reducer.ts:MERGE_CELLS`, button in `Inspector/CellTab` when 2+ selected, `⌘M` | n/a |
| Sync shape across selection | `state/reducer.ts:SYNC_CELLS_SHAPE`, multi-select context menu | n/a |
| Split cell into N rows / cols | `state/reducer.ts:SPLIT_CELL`, `Inspector/CellTab:SplitControls`, single-cell context menu | n/a |
| Random layout generator | `state/reducer.ts:generateRandomLayout` + `MOODS` table; `LeftPanel` "Random" section with cell-count input + "Squares only" toggle | n/a |
| Right-click context menu | `components/ContextMenu.tsx` (portalled, viewport-aware); `StageCanvas:onStageContextMenu` + `buildContextMenu` decides items | n/a |
| Cell border render | dedicated overlay div in `StageCanvas:CellView` (`borderOverlayStyle`) so the inset stroke paints above the image | inset stroke band in `renderer/shapes.py:stroke_cell` |
| Align Grid | `state/reducer.ts:alignGrid`, button in `TopBar` | n/a |
| Multi-image upload from a cell | `StageCanvas.tsx:uploadToCell` (multi-file) → `FILL_EMPTY_NO_GROW` | `/api/images` per file |
| Cover-fit initial scale on upload | `coverFitScale` in `state/reducer.ts`, called from upload paths | n/a |
| Container background image | `Inspector/ContainerTab` upload + `<img>` in board; click the populated row to re-pick | `renderer/pillow_renderer.py:_fit_image` |
| Output filename + format (PNG / JPG / WebP / SVG) | `Inspector/OutputTab` File section; default name auto-generated by `state/reducer.ts:generateFilename`, regenerated on `REPLACE` | response `Content-Disposition` is ignored; frontend owns the name. SVG path is a base64-PNG `<image>` wrapper (`pillow_renderer.py:_encode`) |
| Save folder + filename dedup | `api/folder.ts` (FSA + IndexedDB); `writeBlobToFolder` walks `_1`, `_2`, … and returns the actual saved name | n/a |
| Disable Upload / Export while busy | `App.tsx:uploading` + `exporting` flags → `TopBar` `busy` prop | n/a |
| Templates | `state/templates.ts` (localStorage) + `LeftPanel` | rehydrates previews via `GET /api/images/{hash}` |
| Undo / redo | `state/history.ts` + ⌘Z keybinds in `App.tsx` | n/a |
| Theme | `App.tsx` toggles `data-theme` on `<html>`; tokens in `styles/tokens.css` | n/a |
