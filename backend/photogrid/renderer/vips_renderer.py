"""Optional pyvips renderer; currently a placeholder that delegates to Pillow."""

from __future__ import annotations

import pyvips  # noqa: F401

from ..config import settings
from ..models import PhotoGridState
from .pillow_renderer import PillowRenderer


class VipsRenderer:
    name = "vips"

    def __init__(self) -> None:
        self._delegate = PillowRenderer()

    def supports(self, state: PhotoGridState, source_pixels_max: int) -> bool:
        return source_pixels_max >= settings.vips_threshold_mp * 1_000_000

    async def render(self, state: PhotoGridState) -> tuple[bytes, str]:
        return await self._delegate.render(state)


__all__ = ["VipsRenderer"]
