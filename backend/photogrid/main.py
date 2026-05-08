from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .api import export, health, images
from .cache.disk import sweep_cache
from .config import settings
from .logging_setup import configure_logging, log


async def _sweeper() -> None:
    interval = max(1.0, settings.cache_sweep_minutes) * 60.0
    while True:
        try:
            await asyncio.to_thread(sweep_cache)
        except Exception as e:
            log.exception("cache.sweep.failed", error=str(e))
        await asyncio.sleep(interval)


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    log.info("startup", version=__version__, cache_dir=str(settings.cache_dir))
    settings.cache_dir.mkdir(parents=True, exist_ok=True)
    task = asyncio.create_task(_sweeper(), name="cache-sweeper")
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(BaseException):
            await task
        log.info("shutdown")


app = FastAPI(title="PhotoGrid Studio API", version=__version__, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_methods=["GET", "POST", "HEAD", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-Photogrid-Bytes", "X-Photogrid-Renderer", "X-Photogrid-Elapsed-Ms"],
)

app.include_router(health.router, prefix="/api")
app.include_router(images.router, prefix="/api")
app.include_router(export.router, prefix="/api")
