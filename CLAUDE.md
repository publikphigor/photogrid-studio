# PhotoGrid Studio — agent guide

A photogrid maker with a React/Tailwind editor and a Python (Pillow) render
backend. The browser is preview-only; **export resolution comes from
server-side compositing of the original-resolution sources**, never from a
canvas screenshot.

> **See `ARCHITECTURE.md`** for the full project layout and mechanism: layout
> model (track sizes + per-cell pixel offsets), the resize / drag / select
> flow, the upload→render pipeline end-to-end, and a complete table of where
> each user-facing feature is implemented. This file is the operating manual;
> `ARCHITECTURE.md` is the explanation of how the parts fit together.
>
> **Keep `ARCHITECTURE.md` current.** When you add/rename a state field, an
> action, a renderer step, a click rule, a paint-order layer, or move a
> feature between files — update the matching section of `ARCHITECTURE.md`
> in the same change. The §12 feature table in particular is what future
> agents grep when asked "where does X live?". Stale entries there cost
> more than the keystroke to fix one when you touch the code.

## Stack

- **frontend/** — Vite + React 18 + TypeScript + Tailwind v3, served by nginx.
  Entry: `src/main.tsx` → `src/App.tsx`.
- **backend/** — FastAPI + Pillow (+ pyvips opt-in for very large sources),
  uvicorn in dev, gunicorn in prod. Entry: `photogrid/main.py`.
- **scripts/fish/** — fish-shell helpers (`pg-up`, `pg-build`, …).
- **scripts/e2e/** — Playwright smoke against the live stack.

## Commands

`make` is the one entry point. Targets are explicit so a global `COMPOSE_FILE`
env var can't shadow them.

| Target           | What |
| ---------------- | ---- |
| `make up`        | Start the stack (`-d`). Prints the frontend URL. |
| `make build`     | `--pull` build. |
| `make rebuild`   | `build && up -d`. Recreates containers so they pick up the new image. Older versions used `compose restart`, which only restarts existing containers against the OLD image — that's why Dockerfile/font/dependency changes silently didn't apply. **Watch out: Docker layer cache sometimes reuses old `npm run build` output.** When new TS code isn't in the bundle, run `docker compose -f docker-compose.yml build --no-cache frontend` (use `COMPOSE_FILE=` to neutralise the global override). |
| `make restart`   | `up -d --force-recreate`. Same recreate semantics. |
| `make down`      | Stop. |
| `make clean`     | `down -v` (drops the cache volume). |
| `make logs`      | Follow combined logs. |
| `make prod-up`   | Build + start with `docker-compose.prod.yml` overrides. |
| `make test`      | Pytest (backend) + vitest (frontend). |
| `make install-aliases` | Drops `pg-*` fish functions into `~/.config/fish/functions/`. |

Default ports are 8090 (frontend) and 8010 (backend) per `.env`. **The defaults
in `.env.example` are 8080/8000 — change them in `.env` if those ports are
taken on this box (they were on initial setup).**

## End-to-end shape

```
Browser (React)                                  Backend (FastAPI)
─────────────────                                ─────────────────
ingestFile(File)                ── POST /api/images ──▶ DiskCache
  └ sha256 + ≤1024px preview                       /var/cache/photogrid/{hash[:2]}/{hash}.{ext}
  ◀────── { hash, mime, w, h, size }

Cell stores { hash, previewUrl, name, w, h, mime }.

Export:                          ── POST /api/export ──▶ select_renderer()
  state JSON (no preview blobs)                    ├─ Pillow (always)
  ◀───── 200 image/<mime>                          └─ pyvips if importable
                                                      and source ≥ VIPS_THRESHOLD_MP
  ◀───── 409 { missing: [...] } when any            ⇒ render bytes streamed back
         hash isn't cached → frontend re-uploads
         and retries once.
```

Other endpoints: `HEAD /api/images/{hash}` (existence check) and
`GET /api/images/{hash}` (used to rehydrate previews when loading a saved
template). `GET /api/healthz` returns `{ ok, version, cache: {used_mb, free_mb, file_count} }`.

## Hosting & deploy

Production runs on a single Linux VPS with the same `docker-compose.yml` +
`docker-compose.prod.yml` stack. **Caddy** runs on the host (not in a
container) and reverse-proxies a public subdomain to the local services:

- `/api/*` → `localhost:8000` (backend)
- everything else → `localhost:8080` (frontend)

Caddy auto-manages Let's Encrypt certificates. UFW exposes only 22, 80, and
443 publicly; 8000 / 8080 are internal. The `photogrid-cache` named volume
and the host's `.env` survive every deploy.

**Continuous deployment.** `.github/workflows/deploy.yml` triggers on push to
`main`: it SSHes into the VPS (deploy key in GitHub Secrets — `DEPLOY_HOST`,
`DEPLOY_SSH_KEY`, optional `DEPLOY_USER` / `DEPLOY_PORT` / `DEPLOY_PATH`),
runs `git reset --hard origin/main`, then `make prod-up`. A `concurrency`
block serializes deploys. **`.env` must NOT be checked in** — CI relies on
the file persisting on the VPS, not on being recreated each deploy.

## Hot conventions

- **Cells are absolutely positioned, not CSS grid.** `.grid-area` is just
  `position: relative`; `StageCanvas.tsx` calls `computeCellRect(cell, grid,
  …)` and assigns `left/top/width/height` per cell. This is what lets one
  row's column boundary differ from another row's after an edge resize.
  See `ARCHITECTURE.md §4` for the layout model.
- **Two layers of size control:**
  - `grid.colSizes` / `grid.rowSizes` — per-track fr-unit weights that scale
    every cell in that band. Updated by **corner** handles via
    `RESIZE_TRACKS`.
  - `cell.dx / dy / dw / dh` — per-cell pixel offsets. Updated by **edge**
    handles via `EDGE_RESIZE` so only the dragged cell + its immediate
    neighbour(s) move.
- **No HTML5 drag inside cells.** All in-canvas dragging is mouse-based
  (`StageCanvas.tsx → onCellMouseDown` + window mousemove/mouseup listeners).
  Modes:
  - **plain drag inside a populated cell** → reposition image (`offsetX/Y`).
    The image element's transform is mutated directly during the drag (no
    React re-renders); committed via `UPDATE_CELL` on mouseup.
  - **alt+drag** → MOVE the cell (`MOVE_CELL_DROP`). The drop target is
    resolved on each frame via `document.elementFromPoint` (over an
    existing cell → drop onto its grid coords) or `pointToGridSlot`
    (whitespace → snap to its slot). A dashed drop preview rect renders
    inside `.board` for the duration of the drag. Cells already at the
    destination are pushed to free slots by `reflowAroundMover` (grid
    grows in the shorter axis only when no slot exists).
  - **plain drag inside an empty cell** → MOVE (no image to reposition).
  - **shift+drag a populated cell**, drop on another cell → `SWAP_CELLS`
    (images only; positions/spans untouched).
  - **shift+click** → range-select from the primary anchor to this cell
    (`SELECT_RANGE`). Anchor = current `selectedCellIds[0]`; row-major
    ordering builds the picked range.
  - **⌘/ctrl+click** → toggle this cell in/out of the multi-selection
    (`SELECT_TOGGLE`).
  - **wheel over a populated cell** → zoom the image (`cell.scale`).
- **Click semantics:** single click on any cell just *focuses* it. The
  file picker opens **only on double-click**, and `pickerOpenRef` in
  `uploadToCell` debounces so a triple-click can't queue multiple OS
  dialogs. `e.button !== 0` bails out of `onCellMouseDown` so right-click
  never opens the picker. Clicking the dark stage backdrop or any overlay
  outside a cell clears the active selection (`Escape` walks
  text-layer → watermark → cells).
- **Selection focuses are independent.** `state.selectedCellIds: string[]`
  (primary = `[0]`), `state.selectedTextLayerId`, `state.selectedWatermark`.
  Each has its own action set and pivots the Inspector to a matching tab
  (cell → Cell, text layer → Canvas, watermark → Container). Inspector
  reads the primary cell; merge keeps the primary's image and removes the
  rest into the bounding rect. `⌘M` triggers merge when 2+ cells are selected.
- **Multi-cell editing.** `UPDATE_CELLS { ids, patch }` fans a style
  patch across many cells in a single undo step. `Inspector/CellTab`
  uses it for every style edit when 2+ cells are selected; the right-click
  "Paste style" uses it (and `state/styleClipboard.ts`) to apply a
  captured style across the whole multi-selection.
- **Resize handles render outside `.cell`.** Handles are an absolute overlay
  over `.board` driven by `<ResizeHandles>`; they read the primary selected
  cell's rect via `computeCellRect`. 8 directions; corner handles use
  `RESIZE_TRACKS`, edge handles use `EDGE_RESIZE`. Both modes capture
  alignment lines (every other cell's edges + canvas inner edges) and render
  thin dashed guides while the dragged edge is within 4 px of any of them.
- **Add / duplicate / remove / align cleanly.** `ADD_CELL` and
  `DUPLICATE_CELL` both call `findMaxEmptyRect` and fill the largest empty
  rectangle (capped to ~half the grid via `capPlacementRect` so a sparse
  layout doesn't spawn an outsized cell). They only grow the grid when no
  whitespace exists. `REMOVE_CELL` runs `compactAfterRemoval` to drop empty
  tracks, expand a matching-band neighbour, or extend an adjacent cell's
  pixel offsets. `ALIGN_GRID` zeros every cell's `dx/dy/dw/dh` and absorbs
  leftover whitespace.
- **`SPLIT_CELL` keeps the target's rect intact and produces equal halves.**
  Splitting a cell with band span `S` into `N` sub-cells REPLACES the band's
  `S` tracks with `N` tracks of equal weight = `bandTotal / N`. Each
  sub-cell occupies exactly ONE of the new tracks → equal halves *and*
  together they cover the same pixel rect the target had before the
  split. Cells fully outside the band don't move. Cells crossing the band
  have their colStart / colEnd snapped to the nearest new track boundary
  (via cumulative-weight proportional snap); for uniform band weights
  this is identity. **No overlap is introduced** — sub-cells live in
  distinct grid coords, and other cells still don't share a grid rect
  with any sub-cell.
- **View Transitions** wrap `MOVE_CELL_DROP`, `MOVE_CELL_TO_CELL` and
  `SWAP_CELLS` so cells animate to their new slots when supported by the
  browser. Each cell sets `viewTransitionName: cell-${id}`.
- **Span-based resize via the inspector** (`MOVE_CELL` / `RESIZE_CELL` from
  the number inputs) still uses `reflowAroundMover` to relocate displaced
  cells. `RESIZE_CELL` rejects when reflow would need to grow the grid.
- **`fit: 'native'` is the default.** The IMG box is sized to `image.w ×
  image.h` (the **original** dimensions, not the preview's) so the on-screen
  crop matches what Pillow emits at export. `compose_cell` accepts
  `pixel_scale` so design-pixel offsets translate to output pixels correctly.
- **State persistence** is templates only (`localStorage` key
  `pg_templates_v1`). On save we strip `previewUrl` blobs (object URLs don't
  survive reload). On load, `LeftPanel` re-fetches each cell's image from
  `/api/images/{hash}` and patches the cell.
- **Save destination** prefers a persisted FSA directory handle (IndexedDB,
  store `kv` key `export_dir`), then `showSaveFilePicker`, then
  `<a download>`. Browsers block "sensitive" folders (Library, root,
  sometimes Downloads); `pickFolder` surfaces a `FolderPickerError` that the
  Output tab renders inline.
- **Per-cell shape.** `Cell.shape` is one of the same 10 ids as the
  container shape; backend reuses `make_container_mask` per cell when shape
  ≠ `rect`.
- **Background image (container).** `Container.bgImage` references a cached
  hash; renderer composites it inside the container mask before cells.
  `Container.bgBlur` runs `ImageFilter.GaussianBlur(radius * scale)` on the
  bg image; `Container.bgOverlayColor` + `bgOverlayOpacity` paint a flat
  tint between the bg layers and the cells (so cells pop against a
  darkened or brightened backdrop without affecting the cell pixels).
- **Overlays.** Two kinds:
  - **Watermark** (`Container.watermark`, optional). One per canvas;
    text or image, with `sizePx` in design pixels, `font` family,
    `weight`, `color`, `x`/`y` fractions, `opacity`, `angle`. Mouse-
    draggable on canvas; clicking selects it. Backend rasterises via
    `renderer/overlays.py:composite_watermark`.
  - **Text layers** (`state.textLayers`, ordered). Each has a `z` band:
    `behind-container | behind-cells | in-front-of-cells |
    in-front-of-container`. Frontend uses two overlay components in
    `StageCanvas`: `TextLayersBand` (clipped, lives inside `.board`)
    and `UnclippedTextBand` (sibling of `.board` so it can extend past
    the silhouette). Backend paint order in `pillow_renderer.py` matches
    band-by-band. `renderer/overlays.py:_load_font` maps CSS family
    stacks to the Liberation/DejaVu/Noto TTFs installed in the runtime
    image; `weight >= 600` picks the matching `-Bold` face.
- **Container border (canvas parity).** Rendered as a top-most
  shape-clipped overlay `<div>` inside `.board` — NOT as `box-shadow:
  inset` on `.board`, because children that fill the container (bg
  image, bg overlay, cells) paint over an inset shadow on the
  parent. The overlay reuses `shapeStyle` so the rectangular inset
  shadow gets clipped to the silhouette and traces the shape outline,
  matching the backend's `stroke_container`.

## Don't break these invariants

- **Frontend & backend layout math must agree.** `dimensionsFor` /
  `dimensions_for`, `computeCellRect` / `cell_box`, and `grid_tracks` (which
  now consumes `colSizes` / `rowSizes` and returns per-track pixel arrays)
  are mirrored on both sides. Per-cell pixel offsets (`dx/dy/dw/dh`) are in
  design pixels on the wire and multiplied by `output.scale` server-side
  inside `cell_box`. Same for `cell.offsetX/Y` inside `compose_cell` via
  `pixel_scale`. If you change either side, change both.
- **`fit: 'native'` uses the ORIGINAL image dimensions.** `ingestFile`
  stores `upload.w / upload.h` (not the preview blob's size) in
  `CellImageRef.w/h` so the IMG box and the backend renderer agree on
  cropping. Don't accidentally swap that back to preview dims.
- **EXIF orientation must be honoured server-side.** `api/images.py:upload`
  applies `ImageOps.exif_transpose` when probing dimensions, and the
  renderer's `_open_source` / bg image / watermark image opens all transpose
  before compositing. The browser's `createImageBitmap` orients previews
  by default, so any `Image.open` path that skips transpose will silently
  desync canvas vs export — iPhone JPEGs with orientation 3/6/8 paint
  rotated/flipped under cover/contain/fill fits on export.
- **Shape masks are calibrated.** The numbers in
  `backend/photogrid/renderer/shapes.py` match the frontend's `clip-path`
  polygons. Change one, change both.
- **Image MIME validation** runs at upload (python-magic + Pillow probe);
  decompression-bomb guard is `Image.MAX_IMAGE_PIXELS = settings.max_pixels`.
  Bumping `MAX_PIXELS_MP` past a few hundred MP eats memory fast.
- **`COMPOSE_FILE=` prefix** in the Makefile is intentional; remove only if
  you really mean to honour an external override.

## Tests

- `make test` runs backend pytest + frontend vitest in containers (vitest
  scaffold is minimal; backend has the meaningful coverage).
- `scripts/e2e/smoke.mjs` is a Playwright script that exercises the running
  stack — load page, both side panels, output tab, select cell, drag SE
  handle, save+load template. Run with Playwright on host:

  ```sh
  cd /tmp/pg-pw && node smoke.mjs http://localhost:8090
  ```

  (Or use the upstream Docker image; see comment at the top of `smoke.mjs`.)

## Where things live (cheat sheet)

```
frontend/src/
  App.tsx              top-level + keybinds (⌘Z/Y, Esc, Del, ⌘M, ⌘E) + saveBlob
  state/
    reducer.ts         all actions, layout helpers (computeCellRect,
                       findMaxEmptyRect, pointToGridSlot, alignGrid,
                       compactAfterRemoval, edgeNeighbors, coverFitScale,
                       cellPixelSize, trackSizes), filter helpers
                       (filtersToCss, cssToFilters, getCellFilters),
                       DEFAULT_WATERMARK, DEFAULT_FILTERS, generateFilename,
                       default state
    history.ts         useHistoryReducer (60-step ring buffer)
    presets.ts         LAYOUT_PRESETS, ASPECT_RATIOS, dimensionsFor
    shapes.ts          SHAPES catalog + cellShapeCSS / shapeCSS
    templates.ts       localStorage CRUD (sanitises watermark + textLayers)
    styleClipboard.ts  in-memory cell-style buffer for copy/paste-style
  components/
    StageCanvas.tsx    canvas, cells (absolute-positioned), drag pipeline,
                       resize overlay, alignment guides, TextLayersBand /
                       UnclippedTextBand, WatermarkOverlay, container
                       border overlay, useDispatchedFractionDrag
    LeftPanel.tsx      presets + shuffle (auto-syncs to cells.length) +
                       saved templates (delete confirm modal, dbl-click
                       rename via TemplateRow) + Layers (text layers + cells)
    TopBar.tsx         undo/redo, theme, Align Grid, Upload, Export
    Inspector/         Container / Cell / Canvas / Output tabs
                       Cell tab does batch editing (UPDATE_CELLS) when 2+
                       selected; Canvas tab manages text layers
  api/
    client.ts          ingestFile (stores ORIGINAL w/h), exportImage,
                       imageBlobUrl, stripPreviewUrls (cells + bgImage +
                       watermark.image)
    folder.ts          FSA directory handle persistence
    hash.ts            WebCrypto SHA-256

backend/photogrid/
  api/
    images.py          POST/HEAD/GET upload + cache lookup
    export.py          /api/export: pre-flight 409 (cells + bgImage +
                       watermark.image), render dispatch
    health.py          /api/healthz
  cache/disk.py        sha256 disk cache + sweeper
  renderer/
    pillow_renderer.py main pipeline; layers per the §5e paint order
                       (behind-container text → bg color/image/blur/overlay
                       → behind-cells text → cells → in-front-of-cells text
                       → watermark → container clip → border →
                       in-front-of-container text)
    shapes.py          masks + inset stroke band; heart samples 4 cubic
                       beziers at 64 steps each
    cells.py           per-cell compose; honours fit='native', cell.offsetX/Y
                       × pixel_scale, rotation cover-fit
    filters.py         CSS filter → PIL ops
    layout.py          dimensions_for; grid_tracks per-track col_widths /
                       row_heights (non-uniform); cell_box accepts dx/dy/dw/dh
    overlays.py        composite_text_layer + composite_watermark; CSS
                       family → Liberation/DejaVu/Noto TTF resolver,
                       weight ≥ 600 picks the matching Bold face
  models.py            pydantic mirrors of the frontend types: Cell
                       (dx/dy/dw/dh, filters), Grid (colSizes/rowSizes),
                       Container (bgBlur, bgOverlayColor/Opacity, watermark),
                       Watermark, TextLayer; PhotoGridState includes
                       textLayers
```

## Gotchas you'll hit

- **Stale Docker bundle:** if `make rebuild` doesn't pick up TS edits, run
  the no-cache rebuild line above. The hash on `/usr/share/nginx/html/assets/index-*.js` should change.
- **`document.startViewTransition` is feature-checked.** Don't assume it's there.
- **`previewUrl` is local-only.** Never send it to the backend; never persist
  it in localStorage. `stripPreviewUrls` covers cells, the container's
  bgImage, AND the watermark image — keep all three in sync if you add
  another image-hash field.
- **Per-cell shape masks bleed through cell borders** if you crank
  `cellBorder` while using a non-rect shape — the inset stroke runs along
  the shape outline, not the cell rectangle. Expected behaviour.
- **`rotation` + `fit: cover`** scales the source up by `|cosθ| + |sinθ|`
  before rotating so corners still fill the cell. Don't drop that fudge
  factor in `cells.py:compose_cell`.
- **Overlay font parity.** Browsers render text in Helvetica/Arial; the
  backend resolves CSS family stacks to Liberation Sans (Arial-metrically
  compatible) via `_FONT_HINTS` in `overlays.py`. If you add a new family
  to the watermark/text-layer font picker, add a matching `_FONT_HINTS`
  entry — otherwise exports drift in width and clip at canvas edges.
  Liberation/DejaVu/Noto are installed in the runtime image; if you need
  another face, add the matching `fonts-*` apt package to the Dockerfile.
- **Container border overlay vs. children.** `box-shadow: inset` on
  `.board` is invisible because children that fill the container paint
  over it. The border overlay must be a top-most child of `.board`
  carrying the same `shapeStyle` clip — do not move it back onto `.board`.
- **Backend models are optional-aware.** `state.textLayers` and
  `Container.watermark` default to `None` / `[]` so templates saved before
  the overlays existed still deserialise. If you add another optional
  state field, mirror that default on both sides.
