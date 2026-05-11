<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into PhotoGrid Studio's FastAPI backend. Here's a summary of every change made:

**New file — `backend/photogrid/analytics.py`**
A dedicated analytics module that holds the `Posthog` client instance and exposes three helpers: `init_posthog()` (called at startup), `shutdown_posthog()` (called on graceful shutdown, flushes the event queue), and `capture()` (a safe no-op wrapper used by all API routes). Keeping the client here avoids circular imports since `main.py` imports the API routers and the routers need access to the client.

**Edited — `backend/photogrid/config.py`**
Added two new `pydantic-settings` fields: `posthog_api_key: str | None` and `posthog_host: str`. Values are loaded from `backend/.env` (never hardcoded).

**Edited — `backend/photogrid/main.py`**
The lifespan context manager now calls `init_posthog(settings.posthog_api_key, settings.posthog_host)` on startup and `shutdown_posthog()` on shutdown. PostHog is silently skipped when `POSTHOG_API_KEY` is absent (safe for local dev without the key).

**Edited — `backend/photogrid/api/images.py`**
The `upload_image` endpoint now accepts the optional `X-PostHog-Distinct-Id` request header for frontend correlation. It captures `image upload failed` on every error path (file too large, unsupported MIME, cache store failure, image not decodable) and `image uploaded` on success, with metadata properties (`mime_type`, `file_size_bytes`, `width`, `height`).

**Edited — `backend/photogrid/api/export.py`**
The `export` endpoint now accepts `X-PostHog-Distinct-Id` and captures:
- `export preflight failed` when the 409 missing-hash response fires, with `missing_hash_count`, `output_format`, and `cell_count`.
- `export failed` on unexpected server errors, with `output_format` and `cell_count`.
- `export completed` on success, with `output_format`, `cell_count`, `cells_with_images`, `output_scale`, `renderer`, `elapsed_ms`, and `output_bytes`.

**Updated — `backend/pyproject.toml`**
Added `posthog>=3.0` to the project dependencies.

**Environment — `backend/.env`**
`POSTHOG_API_KEY` and `POSTHOG_HOST` written via the wizard-tools MCP (never committed to git).

---

## Events

| Event | Description | File |
|---|---|---|
| `image uploaded` | Fires on every successful image upload. Properties: `mime_type`, `file_size_bytes`, `width`, `height`. | `backend/photogrid/api/images.py` |
| `image upload failed` | Fires when an upload is rejected or fails. Properties: `failure_reason` (`file_too_large` \| `unsupported_mime` \| `server_error` \| `not_decodable`), `mime_type` (where applicable). | `backend/photogrid/api/images.py` |
| `export completed` | Fires when a photogrid is rendered and returned to the browser. Properties: `output_format`, `cell_count`, `cells_with_images`, `output_scale`, `renderer`, `elapsed_ms`, `output_bytes`. | `backend/photogrid/api/export.py` |
| `export failed` | Fires when an unexpected server error aborts rendering. Properties: `output_format`, `cell_count`. | `backend/photogrid/api/export.py` |
| `export preflight failed` | Fires when the 409 cache-miss response is returned (triggers the frontend re-upload retry). Properties: `missing_hash_count`, `output_format`, `cell_count`. | `backend/photogrid/api/export.py` |

---

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- [Analytics basics dashboard](/project/153530/dashboard/672133)
- [Images uploaded over time](/project/153530/insights/PL7pkPr2)
- [Exports completed over time](/project/153530/insights/9nf8RNOJ)
- [Upload → Export conversion funnel](/project/153530/insights/cldaBcwL)
- [Upload failure reasons](/project/153530/insights/GplW9rEU)
- [Export render time P95 (ms)](/project/153530/insights/j99NlGIE)

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-fastapi/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
