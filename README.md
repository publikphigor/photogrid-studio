# PhotoGrid Studio

A photo-grid maker that renders exports server-side in Python so output preserves the full resolution and quality of the source images. The browser is preview-only; on export, the current state is sent to a FastAPI backend that composites with Pillow (or pyvips for very large sources) and streams a PNG/JPEG/WEBP back.

## Stack

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS, served in production by nginx
- **Backend**: FastAPI + Pillow (numpy, pillow-heif). pyvips is loaded automatically when source images exceed `VIPS_THRESHOLD_MP`.
- **Cache**: content-addressed disk cache, keyed by SHA-256, with a TTL sweeper
- **Orchestration**: Docker Compose (dev + prod overlays)

## Quick start

```sh
cp .env.example .env
make build
make up
open http://localhost:8080
```

Stop with `make down`. Reset the image cache with `make clean`.

## Make targets

| Target                  | What it does                                           |
| ----------------------- | ------------------------------------------------------ |
| `make up`               | Start the stack in the background                      |
| `make build`            | Build images (`--pull` for fresh bases)                |
| `make rebuild`          | Build then restart                                     |
| `make restart`          | Restart running containers                             |
| `make down`             | Stop the stack                                         |
| `make logs`             | Follow combined logs                                   |
| `make clean`            | `down` + drop the image cache volume                   |
| `make prod-up`          | Build + start with `docker-compose.prod.yml` overrides |
| `make test`             | Run pytest (backend) and vitest (frontend) in CI mode  |
| `make install-aliases`  | Install fish functions (`pg-up`, `pg-build`, …)        |

## Fish aliases

```sh
make install-aliases
```

Drops these into `~/.config/fish/functions/`:

- `pg-up`, `pg-down`, `pg-build`, `pg-rebuild`, `pg-restart`, `pg-logs`, `pg-prod`, `pg-clean`

They run from anywhere — each function shells `make -C <project-dir>`.

## Configuration

All knobs are environment variables; see `.env.example`. Notable ones:

| Var                   | Default | Purpose                                                  |
| --------------------- | ------- | -------------------------------------------------------- |
| `MAX_UPLOAD_MB`       | `60`    | Per-image upload limit                                   |
| `MAX_PIXELS_MP`       | `200`   | Decompression-bomb guard                                 |
| `CACHE_TTL_HOURS`     | `24`    | How long uploaded originals live in cache                |
| `CACHE_SWEEP_MINUTES` | `15`    | Sweeper interval                                         |
| `VIPS_THRESHOLD_MP`   | `40`    | Use pyvips when any source ≥ this size (if installed)    |
| `WEB_CONCURRENCY`     | `4`     | gunicorn workers in prod                                 |
| `ALLOWED_ORIGINS`     | `*`     | Dev CORS; prod uses same-origin via nginx proxy          |

## API

- `POST /api/images` — multipart `file=<binary>`. Returns `{ hash, mime, w, h, size }`. `409` invalid, `413` too large.
- `HEAD /api/images/{hash}` — `204` if cached, `404` otherwise.
- `POST /api/export` — JSON body `{ state }`. Streams the rendered image. `409 { missing: [...] }` when any referenced hash is not in cache; the frontend re-uploads and retries.
- `GET /api/healthz` — `{ ok, version, cache: { used_mb, free_mb, file_count } }`.

## Layout

```
photogrid-studio/
  frontend/      Vite + React + Tailwind, served by nginx
  backend/       FastAPI + Pillow renderer
  scripts/fish/  Shell helpers
  docker-compose.yml          dev defaults
  docker-compose.prod.yml     prod overrides (gunicorn, resource limits, log rotation)
  Makefile
  .env.example
```
