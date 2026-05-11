from __future__ import annotations

import asyncio
import io
import mimetypes
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, ImageOps

from ..analytics import capture
from ..cache import DiskCache, find_cached
from ..config import settings
from ..logging_setup import log
from ..models import UploadResponse

router = APIRouter()
_ALLOWED_MIMES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/tiff",
    "image/heic",
    "image/heif",
    "image/avif",
}

Image.MAX_IMAGE_PIXELS = settings.max_pixels


def _detect_mime(head: bytes) -> str | None:
    try:
        import magic

        return magic.from_buffer(head, mime=True)
    except Exception:
        return None


def _probe_dimensions(path: Path) -> tuple[int, int]:
    with Image.open(path) as img:
        img = ImageOps.exif_transpose(img)
        return img.size


@router.post("/images", response_model=UploadResponse, status_code=200)
async def upload_image(file: UploadFile, request: Request) -> UploadResponse:
    distinct_id = request.headers.get("X-PostHog-Distinct-Id", "photogrid-anon")

    if file.size and file.size > settings.max_upload_bytes:
        capture("image upload failed", distinct_id=distinct_id, properties={"failure_reason": "file_too_large"})
        raise HTTPException(status_code=413, detail="file too large")

    head = await file.read(4096)
    mime = _detect_mime(head) or file.content_type or ""
    if mime not in _ALLOWED_MIMES:
        capture("image upload failed", distinct_id=distinct_id, properties={"failure_reason": "unsupported_mime", "mime_type": mime})
        raise HTTPException(status_code=415, detail=f"unsupported mime: {mime!r}")

    class _Stream:
        def __init__(self, head: bytes, rest) -> None:  # type: ignore[no-untyped-def]
            self._buf = io.BytesIO(head)
            self._rest = rest

        def read(self, n: int) -> bytes:
            data = self._buf.read(n)
            if data:
                return data
            return self._rest.read(n)

    cache = DiskCache()
    # Offload sync disk write so a slow WAN upload doesn't head-of-line block the gunicorn worker.
    try:
        stored = await asyncio.to_thread(
            cache.store_stream, _Stream(head, file.file), mime, settings.max_upload_bytes
        )
    except ValueError as e:
        capture("image upload failed", distinct_id=distinct_id, properties={"failure_reason": "file_too_large"})
        raise HTTPException(status_code=413, detail=str(e)) from e
    except Exception as e:
        log.exception("upload.failed", error=str(e))
        capture("image upload failed", distinct_id=distinct_id, properties={"failure_reason": "server_error"})
        raise HTTPException(status_code=500, detail="upload failed") from e

    # EXIF transpose required so reported (w,h) match createImageBitmap and the renderer (iPhone JPEGs orient 3/6/8).
    try:
        w, h = await asyncio.to_thread(_probe_dimensions, stored.path)
    except Exception as e:
        try:
            stored.path.unlink(missing_ok=True)
        except Exception:
            pass
        capture("image upload failed", distinct_id=distinct_id, properties={"failure_reason": "not_decodable", "mime_type": mime})
        raise HTTPException(status_code=415, detail="image not decodable") from e

    log.info("upload.ok", hash=stored.hash, size=stored.size, mime=mime, w=w, h=h)
    capture(
        "image uploaded",
        distinct_id=distinct_id,
        properties={"mime_type": mime, "file_size_bytes": stored.size, "width": w, "height": h},
    )
    return UploadResponse(hash=stored.hash, mime=mime, w=w, h=h, size=stored.size)


@router.head("/images/{hash}")
def head_image(hash: str) -> Response:
    if find_cached(hash) is None:
        raise HTTPException(status_code=404, detail="not cached")
    return Response(status_code=204)


@router.get("/images/{hash}")
def get_image(hash: str) -> FileResponse:
    path = find_cached(hash)
    if path is None:
        raise HTTPException(status_code=404, detail="not cached")
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    # Hash-addressed: cacheable forever.
    return FileResponse(
        path,
        media_type=mime,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
