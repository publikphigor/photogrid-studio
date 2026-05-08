"""Optional pyvips renderer.

Today this is a placeholder — when ``pyvips`` is installed and a source image
exceeds ``VIPS_THRESHOLD_MP``, ``supports()`` returns True so it can be selected
in the future. The actual implementation currently delegates straight to Pillow;
treat it as a hook for when memory pressure on huge inputs becomes a real
issue. Add the libvips composition step here at that point.
"""

from __future__ import annotations

import pyvips  # noqa: F401  (import probes presence — see renderer/__init__.py)

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
