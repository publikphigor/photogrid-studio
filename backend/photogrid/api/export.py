from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException, Response
from PIL import Image

from ..cache.disk import find_cached
from ..logging_setup import log
from ..models import ExportRequest, MissingHashes
from ..renderer import select_renderer

router = APIRouter()


@router.post("/export", response_class=Response)
async def export(req: ExportRequest) -> Response:
    state = req.state

    # Pre-flight: every referenced hash must be cached.
    missing: list[str] = []
    source_pixels_max = 0
    for cell in state.cells:
        if cell.image is None:
            continue
        path = find_cached(cell.image.hash)
        if path is None:
            missing.append(cell.image.hash)
            continue
        try:
            with Image.open(path) as img:
                source_pixels_max = max(source_pixels_max, img.size[0] * img.size[1])
        except Exception:
            # Corrupt cache entry — drop and treat as missing.
            try:
                path.unlink(missing_ok=True)
            except Exception:
                pass
            missing.append(cell.image.hash)

    if missing:
        return Response(
            content=MissingHashes(missing=sorted(set(missing))).model_dump_json(),
            media_type="application/json",
            status_code=409,
        )

    renderer = select_renderer(state, source_pixels_max)
    started = time.perf_counter()
    try:
        data, mime = await renderer.render(state)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except FileNotFoundError as e:
        # Race: a cache entry vanished between pre-flight and render.
        return Response(
            content=MissingHashes(missing=[str(e)]).model_dump_json(),
            media_type="application/json",
            status_code=409,
        )
    except Exception as e:
        log.exception("render.failed", error=str(e))
        raise HTTPException(status_code=500, detail="render failed") from e

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    log.info(
        "render.ok",
        renderer=renderer.name,
        bytes=len(data),
        format=state.output.format,
        elapsed_ms=elapsed_ms,
    )

    ext = state.output.format
    filename = f"photogrid-{int(time.time())}.{ext}"
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
