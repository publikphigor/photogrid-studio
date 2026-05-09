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

    # Pre-flight: every referenced hash must be cached. Cells, the container
    # bg image, and the watermark image (if any) are all checked here so the
    # 409 response surfaces every gap at once.
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

    for ref in image_refs:
        path = find_cached(ref.hash)
        if path is None:
            missing.append(ref.hash)
            continue
        try:
            with Image.open(path) as img:
                source_pixels_max = max(source_pixels_max, img.size[0] * img.size[1])
        except Exception:
            try:
                path.unlink(missing_ok=True)
            except Exception:
                pass
            missing.append(ref.hash)

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
