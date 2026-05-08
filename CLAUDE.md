# PhotoGrid Studio — agent guide

A photogrid maker with a React/Tailwind editor and a Python (Pillow) render
backend. The browser is preview-only; **export resolution comes from
server-side compositing of the original-resolution sources**, never from a
canvas screenshot.

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

- **No HTML5 drag inside cells.** All in-canvas dragging is mouse-based
  (`StageCanvas.tsx → onCellMouseDown` + a single window mousemove/mouseup
  listener). Three modes:
  - selected populated cell, drag inside → reposition (rAF-driven `imgEl.style.transform`, dispatch only on mouseup).
  - unselected populated cell, drag → swap **images** with target cell.
  - shift+drag any populated cell → swap **cell positions** with target.
- **Resize handles render outside `.cell`.** `.cell { overflow: hidden }`
  clips anything offset to `-5px`. Handles are an absolute overlay over
  `.grid-area` driven by `ResizeHandles` in `StageCanvas.tsx`. 8 directions,
  rAF-throttled, integer-span de-duped.
- **View Transitions** wrap `MOVE_CELL_TO_CELL` and `SWAP_CELLS` so cells
  animate to their new slots when supported by the browser. Each cell sets
  `viewTransitionName: cell-${id}`.
- **Reflow on resize/move.** `reducer.ts:reflowAroundMover` packs displaced
  cells into the next free slot (preserving span where possible, falling
  back to 1×1, growing the grid by a row as last resort).
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

- **Geometry is shared with the prototype.** `frontend/src/state/presets.ts:dimensionsFor`
  and `backend/photogrid/renderer/layout.py:dimensions_for` must agree on
  output size; same for `cell_box`. The numbers in
  `backend/photogrid/renderer/shapes.py` are calibrated to match the
  frontend's `clip-path` polygons — change one, change both.
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
  App.tsx              top-level + keybinds + saveBlob (folder/dialog/anchor)
  state/
    reducer.ts         all actions, reflow, default state
    history.ts         useHistoryReducer (60-step ring buffer)
    presets.ts         LAYOUT_PRESETS, ASPECT_RATIOS, dimensionsFor
    shapes.ts          SHAPES catalog + cellShapeCSS / shapeCSS
    templates.ts       localStorage CRUD
  components/
    StageCanvas.tsx    canvas, cells, drag pipeline, resize overlay
    LeftPanel.tsx      presets + layers + saved templates
    Inspector/         Container / Cell / Output tabs
  api/
    client.ts          ingestFile, exportImage, imageBlobUrl
    folder.ts          FSA directory handle persistence
    hash.ts            WebCrypto SHA-256

backend/photogrid/
  api/
    images.py          POST/HEAD/GET upload + cache lookup
    export.py          /api/export: pre-flight 409, render dispatch
    health.py          /api/healthz
  cache/disk.py        sha256 disk cache + sweeper
  renderer/
    pillow_renderer.py main pipeline (mirror of prototype exporter.jsx)
    shapes.py          masks + inset stroke band
    cells.py           per-cell compose with rotation cover-fit
    filters.py         CSS filter → PIL ops
    layout.py          dimensions_for, grid_tracks, cell_box
  models.py            pydantic mirrors of the frontend types
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
