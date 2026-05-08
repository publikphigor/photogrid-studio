"""Content-addressed disk cache for uploaded source images.

Layout: ``{root}/{hash[:2]}/{hash}.{ext}``. Atomic writes via tmp + rename.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import IO

from ..config import settings
from ..logging_setup import log

EXT_BY_MIME = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/tiff": "tif",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/avif": "avif",
}


def cache_path_for(hash_hex: str, ext: str, root: Path | None = None) -> Path:
    root = root or settings.cache_dir
    return root / hash_hex[:2] / f"{hash_hex}.{ext}"


def find_cached(hash_hex: str, root: Path | None = None) -> Path | None:
    root = root or settings.cache_dir
    bucket = root / hash_hex[:2]
    if not bucket.is_dir():
        return None
    for entry in bucket.iterdir():
        if entry.stem == hash_hex:
            return entry
    return None


@dataclass(slots=True)
class StoredFile:
    hash: str
    path: Path
    size: int
    mime: str


class DiskCache:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or settings.cache_dir
        self.root.mkdir(parents=True, exist_ok=True)

    def exists(self, hash_hex: str) -> Path | None:
        return find_cached(hash_hex, self.root)

    def store_stream(self, src: IO[bytes], mime: str, max_bytes: int) -> StoredFile:
        ext = EXT_BY_MIME.get(mime, "bin")
        # Stream to a tmp file while hashing + counting bytes.
        tmp_dir = self.root / "_tmp"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        tmp = tmp_dir / f"upload-{os.getpid()}-{time.time_ns()}.tmp"
        h = hashlib.sha256()
        size = 0
        try:
            with tmp.open("wb") as out:
                while True:
                    chunk = src.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > max_bytes:
                        raise ValueError(f"upload exceeds {max_bytes} bytes")
                    h.update(chunk)
                    out.write(chunk)
            digest = h.hexdigest()
            target = cache_path_for(digest, ext, self.root)
            target.parent.mkdir(parents=True, exist_ok=True)
            existing = self.exists(digest)
            if existing is None:
                os.replace(tmp, target)
            else:
                tmp.unlink(missing_ok=True)
                target = existing
                size = target.stat().st_size
            return StoredFile(hash=digest, path=target, size=size, mime=mime)
        except Exception:
            tmp.unlink(missing_ok=True)
            raise


def cache_stats(root: Path | None = None) -> dict[str, float | int]:
    root = root or settings.cache_dir
    file_count = 0
    used = 0
    if root.is_dir():
        for p in root.rglob("*"):
            if p.is_file() and p.parent.name != "_tmp":
                file_count += 1
                used += p.stat().st_size
    free = shutil.disk_usage(root).free if root.exists() else 0
    return {
        "used_mb": round(used / (1024 * 1024), 2),
        "free_mb": round(free / (1024 * 1024), 2),
        "file_count": file_count,
    }


def sweep_cache(root: Path | None = None, ttl_hours: float | None = None) -> int:
    """Delete files whose mtime is older than `ttl_hours`. Returns # removed."""
    root = root or settings.cache_dir
    ttl = (ttl_hours if ttl_hours is not None else settings.cache_ttl_hours) * 3600.0
    if ttl <= 0 or not root.is_dir():
        return 0
    cutoff = time.time() - ttl
    removed = 0
    for p in root.rglob("*"):
        try:
            if p.is_file() and p.stat().st_mtime < cutoff:
                p.unlink()
                removed += 1
        except FileNotFoundError:
            continue
    if removed:
        log.info("cache.sweep", removed=removed)
    return removed
