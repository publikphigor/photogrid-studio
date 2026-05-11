from __future__ import annotations

import asyncio
import os
import re
import time

from fastapi import APIRouter, HTTPException, Request, Response
from PIL import Image

from ..analytics import capture
from ..cache.disk import find_cached
from ..logging_setup import log
from ..models import ExportRequest, MissingHashes
from ..renderer import select_renderer

router = APIRouter()

# Bound concurrent renders so a burst doesn't pin every CPU core; override via MAX_CONCURRENT_RENDERS.
_render_sem = asyncio.Semaphore(int(os.environ.get("MAX_CONCURRENT_RENDERS", "3")))


def _probe_pixels(path) -> int | None:
    """Return pixel area of a cached image, or None when corrupt (entry is unlinked)."""
    try:
        with Image.open(path) as img:
            return img.size[0] * img.size[1]
    except Exception:
        try:
            path.unlink(missing_ok=True)
        except Exception:
            pass
        return None


@router.post("/export", response_class=Response)
async def export(req: ExportRequest, request: Request) -> Response:
    state = req.state
    distinct_id = request.headers.get("X-PostHog-Distinct-Id", "photogrid-anon")
    cell_count = len(state.cells)
    cells_with_images = sum(1 for c in state.cells if c.image is not None)

    missing: list[str] = []
    source_pixels_max = 0
    image_refs = []
    for cell in state.cells:
        if cell.image is not None:
            image_refs.append(cell.image)
    if state.container.bgImage is not None:
        image_refs.append(state.container.bgImage)
    if (
        state.container.watermark is not None
        and state.container.watermark.enabled
        and state.container.watermark.kind == "image"
        and state.container.watermark.image is not None
    ):
        image_refs.append(state.container.watermark.image)

    async def _probe(ref):
        path = find_cached(ref.hash)
        if path is None:
            return ref.hash, None
        pixels = await asyncio.to_thread(_probe_pixels, path)
        return ref.hash, pixels

    if image_refs:
        for hash_, pixels in await asyncio.gather(*[_probe(r) for r in image_refs]):
            if pixels is None:
                missing.append(hash_)
            else:
                source_pixels_max = max(source_pixels_max, pixels)

    if missing:
        capture(
            "export preflight failed",
            distinct_id=distinct_id,
            properties={
                "missing_hash_count": len(set(missing)),
                "output_format": state.output.format,
                "cell_count": cell_count,
            },
        )
        return Response(
            content=MissingHashes(missing=sorted(set(missing))).model_dump_json(),
            media_type="application/json",
            status_code=409,
        )

    renderer = select_renderer(state, source_pixels_max)
    started = time.perf_counter()
    try:
        async with _render_sem:
            data, mime = await renderer.render(state)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except FileNotFoundError as e:
        # Cache entry vanished between pre-flight and render.
        return Response(
            content=MissingHashes(missing=[str(e)]).model_dump_json(),
            media_type="application/json",
            status_code=409,
        )
    except Exception as e:
        log.exception("render.failed", error=str(e))
        capture(
            "export failed",
            distinct_id=distinct_id,
            properties={"output_format": state.output.format, "cell_count": cell_count},
        )
        raise HTTPException(status_code=500, detail="render failed") from e

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    log.info(
        "render.ok",
        renderer=renderer.name,
        bytes=len(data),
        format=state.output.format,
        elapsed_ms=elapsed_ms,
    )
    capture(
        "export completed",
        distinct_id=distinct_id,
        properties={
            "output_format": state.output.format,
            "cell_count": cell_count,
            "cells_with_images": cells_with_images,
            "output_scale": state.output.scale,
            "renderer": renderer.name,
            "elapsed_ms": elapsed_ms,
            "output_bytes": len(data),
        },
    )

    # Must mirror FE client.ts filename builder; Chrome falls back to Content-Disposition when a.download is ignored.
    base = re.sub(r'[/\\:*?"<>|]', "", state.output.filename or "photogrid").strip() or "photogrid"
    filename = f"{base}.{state.output.format}"
    return Response(
        content=data,
        media_type=mime,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Photogrid-Bytes": str(len(data)),
            "X-Photogrid-Renderer": renderer.name,
            "X-Photogrid-Elapsed-Ms": str(elapsed_ms),
        },
    )
