from __future__ import annotations

from typing import Protocol

from ..models import PhotoGridState
from .pillow_renderer import PillowRenderer

try:
    from .vips_renderer import VipsRenderer  # type: ignore[attr-defined]
    _vips_available = True
except Exception:
    _vips_available = False
    VipsRenderer = None  # type: ignore[assignment]


class Renderer(Protocol):
    name: str

    def supports(self, state: PhotoGridState, source_pixels_max: int) -> bool: ...
    async def render(self, state: PhotoGridState) -> tuple[bytes, str]: ...


def select_renderer(state: PhotoGridState, source_pixels_max: int) -> Renderer:
    if _vips_available and VipsRenderer is not None:
        v = VipsRenderer()
        if v.supports(state, source_pixels_max):
            return v  # type: ignore[return-value]
    return PillowRenderer()  # type: ignore[return-value]


__all__ = ["Renderer", "select_renderer", "PillowRenderer"]
