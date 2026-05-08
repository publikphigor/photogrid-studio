from __future__ import annotations

from fastapi import APIRouter

from .. import __version__
from ..cache.disk import cache_stats
from ..models import HealthResponse

router = APIRouter()


@router.get("/healthz", response_model=HealthResponse)
def healthz() -> HealthResponse:
    return HealthResponse(ok=True, version=__version__, cache=cache_stats())
