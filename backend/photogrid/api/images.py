from __future__ import annotations

import io
import mimetypes

from fastapi import APIRouter, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, ImageOps

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

# Pillow MAX_IMAGE_PIXELS guard — explicit ceiling instead of None.
Image.MAX_IMAGE_PIXELS = settings.max_pixels


def _detect_mime(head: bytes) -> str | None:
    try:
        import magic

        return magic.from_buffer(head, mime=True)
    except Exception:
        return None


@router.post("/images", response_model=UploadResponse, status_code=200)
async def upload_image(file: UploadFile) -> UploadResponse:
    if file.size and file.size > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="file too large")

    head = await file.read(4096)
    mime = _detect_mime(head) or file.content_type or ""
    if mime not in _ALLOWED_MIMES:
        raise HTTPException(status_code=415, detail=f"unsupported mime: {mime!r}")

    # Reassemble: head + remaining stream
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
    try:
        stored = cache.store_stream(_Stream(head, file.file), mime, settings.max_upload_bytes)
    except ValueError as e:
        raise HTTPException(status_code=413, detail=str(e)) from e
    except Exception as e:
        log.exception("upload.failed", error=str(e))
        raise HTTPException(status_code=500, detail="upload failed") from e

    # Probe dimensions (Pillow handles HEIC via pillow-heif registered in renderer).
    # Apply EXIF transpose so reported (w, h) match the orientation the browser's
    # createImageBitmap will use for the preview AND what the renderer composites
    # at export time. Without this, iPhone JPEGs that should be portrait would
    # report landscape dimensions and the frontend's IMG box would mis-size.
    try:
        with Image.open(stored.path) as img:
            img = ImageOps.exif_transpose(img)
            w, h = img.size
    except Exception as e:
        # Don't poison the cache with broken files.
        try:
            stored.path.unlink(missing_ok=True)
        except Exception:
            pass
        raise HTTPException(status_code=415, detail="image not decodable") from e

    log.info("upload.ok", hash=stored.hash, size=stored.size, mime=mime, w=w, h=h)
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
    # Cacheable forever — content is hash-addressed.
    return FileResponse(
        path,
        media_type=mime,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
