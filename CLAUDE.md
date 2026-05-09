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
| `make rebuild`   | `build && restart`. **Watch out: Docker layer cache sometimes reuses old `npm run build` output.** When new TS code isn't in the bundle, run `docker compose -f docker-compose.yml build --no-cache frontend` (use `COMPOSE_FILE=` to neutralise the global override). |
| `make restart`   | Restart running services. |
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
  - drag inside any populated cell → reposition image (`offsetX/Y`).
  - shift+drag a populated cell → move/swap. Drop on a cell → swap positions
    + spans. Drop on whitespace → snap to the largest empty rect at that
    point (`pointToGridSlot` + `MOVE_CELL_TO_RECT`).
  - cmd/ctrl+click → toggle this cell into the multi-selection.
  - wheel over a populated cell → zoom the image (`cell.scale`).
- **Click semantics:** empty cell → file picker; populated *unfocused* →
  just select; populated *primary-selected* → file picker (replace);
  cmd/ctrl+click suppresses the picker (it was multi-select intent).
  Clicking the dark stage backdrop deselects; `Escape` deselects too.
- **Selection is an array.** `state.selectedCellIds: string[]`; primary is
  `[0]`. Inspector reads the primary; merge keeps the primary's image and
  removes the rest into the bounding rect. `⌘M` triggers merge when 2+ are
  selected.
- **Resize handles render outside `.cell`.** Handles are an absolute overlay
  over `.board` driven by `<ResizeHandles>`; they read the primary selected
  cell's rect via `computeCellRect`. 8 directions; corner handles use
  `RESIZE_TRACKS`, edge handles use `EDGE_RESIZE`. Both modes capture
  alignment lines (every other cell's edges + canvas inner edges) and render
  thin dashed guides while the dragged edge is within 4 px of any of them.
- **Add / remove / align cleanly.** `ADD_CELL` calls `findMaxEmptyRect` and
  fills the largest empty rectangle (only grows the grid as a last resort).
  `REMOVE_CELL` runs `compactAfterRemoval` to drop empty tracks, expand a
  matching-band neighbour, or extend an adjacent cell's pixel offsets.
  `ALIGN_GRID` zeros every cell's `dx/dy/dw/dh` and absorbs leftover
  whitespace.
- **View Transitions** wrap `MOVE_CELL_TO_CELL` and `SWAP_CELLS` so cells
  animate to their new slots when supported by the browser. Each cell sets
  `viewTransitionName: cell-${id}`.
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
                       cellPixelSize, trackSizes), default state
    history.ts         useHistoryReducer (60-step ring buffer)
    presets.ts         LAYOUT_PRESETS, ASPECT_RATIOS, dimensionsFor
    shapes.ts          SHAPES catalog + cellShapeCSS / shapeCSS
    templates.ts       localStorage CRUD
  components/
    StageCanvas.tsx    canvas, cells (absolute-positioned), drag pipeline,
                       resize overlay (track + edge modes), alignment guides
    LeftPanel.tsx      presets + layers + saved templates (cmd+click multi)
    TopBar.tsx         undo/redo, theme, Align Grid, Upload, Export
    Inspector/         Container / Cell / Output tabs
                       (Cell tab shows Merge button when 2+ selected)
  api/
    client.ts          ingestFile (stores ORIGINAL w/h), exportImage, imageBlobUrl
    folder.ts          FSA directory handle persistence
    hash.ts            WebCrypto SHA-256

backend/photogrid/
  api/
    images.py          POST/HEAD/GET upload + cache lookup
    export.py          /api/export: pre-flight 409, render dispatch
    health.py          /api/healthz
  cache/disk.py        sha256 disk cache + sweeper
  renderer/
    pillow_renderer.py main pipeline; passes pixel_scale to compose_cell and
                       per-cell dx/dy/dw/dh × scale to cell_box
    shapes.py          masks + inset stroke band
    cells.py           per-cell compose; honours fit='native', cell.offsetX/Y
                       × pixel_scale, rotation cover-fit
    filters.py         CSS filter → PIL ops
    layout.py          dimensions_for; grid_tracks now returns per-track
                       col_widths / row_heights (non-uniform); cell_box accepts
                       dx/dy/dw/dh
  models.py            pydantic mirrors of the frontend types (Cell carries
                       dx/dy/dw/dh; Grid carries colSizes/rowSizes;
                       FitMode includes 'native')
```

## Gotchas you'll hit

- **Stale Docker bundle:** if `make rebuild` doesn't pick up TS edits, run
  the no-cache rebuild line above. The hash on `/usr/share/nginx/html/assets/index-*.js` should change.
- **`document.startViewTransition` is feature-checked.** Don't assume it's there.
- **`previewUrl` is local-only.** Never send it to the backend; never persist
  it in localStorage. The backend keys everything by `hash`.
- **Per-cell shape masks bleed through cell borders** if you crank
  `cellBorder` while using a non-rect shape — the inset stroke runs along
  the shape outline, not the cell rectangle. Expected behaviour.
- **`rotation` + `fit: cover`** scales the source up by `|cosθ| + |sinθ|`
  before rotating so corners still fill the cell. Don't drop that fudge
  factor in `cells.py:compose_cell`.
