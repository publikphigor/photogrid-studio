"""Pillow-based renderer. Faithful port of ``exporter.jsx``."""

from __future__ import annotations

import asyncio
import io
from pathlib import Path

from PIL import Image, ImageOps

from ..cache.disk import find_cached
from ..config import settings
from ..logging_setup import log
from ..models import Cell, PhotoGridState
from .cells import compose_cell
from .filters import apply_css_filter
from .layout import cell_box, dimensions_for, grid_tracks
from .overlays import composite_text_layer, composite_watermark
from .shapes import make_cell_mask, make_container_mask, stroke_cell, stroke_container

try:
    from pillow_heif import register_heif_opener  # type: ignore[import-untyped]

    register_heif_opener()
except Exception:
    pass


_FORMAT_MIME = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "webp": "image/webp",
    "svg": "image/svg+xml",
}


class PillowRenderer:
    name = "pillow"

    def supports(self, state: PhotoGridState, source_pixels_max: int) -> bool:
        return True

    async def render(self, state: PhotoGridState) -> tuple[bytes, str]:
        return await asyncio.to_thread(_render_sync, state)


def _open_source(cell: Cell) -> Image.Image | None:
    if cell.image is None:
        return None
    cached = find_cached(cell.image.hash)
    if cached is None:
        raise FileNotFoundError(cell.image.hash)
    img = Image.open(cached)
    img.load()
    # EXIF transpose required so rendered pixels match the browser's createImageBitmap preview.
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")
    return img


def _render_sync(state: PhotoGridState) -> tuple[bytes, str]:
    cont = state.container
    grid = state.grid
    out = state.output
    dims = dimensions_for(cont.aspect, out.baseSize)
    scale = out.scale
    W = max(1, dims.w * scale)
    H = max(1, dims.h * scale)

    if W * H > settings.max_pixels:
        raise ValueError(
            f"output {W}x{H}={W * H} exceeds MAX_PIXELS_MP={settings.max_pixels_mp}",
        )

    log.info("render.start", w=W, h=H, format=out.format, scale=scale, cells=len(state.cells))

    text_layers = state.textLayers or []
    # ``base`` collects everything that the container shape clips; unclipped bands are composited afterwards.
    base = Image.new("RGBA", (W, H), (0, 0, 0, 0))

    if not cont.bgTransparent:
        bg_layer = Image.new("RGBA", (W, H), _hex_to_rgba(cont.bg))
        base.alpha_composite(bg_layer)
    if cont.bgImage is not None:
        bg_path = find_cached(cont.bgImage.hash)
        if bg_path is not None:
            try:
                with Image.open(bg_path) as bgi:
                    bgi.load()
                    bgi = ImageOps.exif_transpose(bgi)
                    bg_rgba = bgi.convert("RGBA")
                bg_tile = _fit_image(bg_rgba, W, H, cont.bgImageFit)
                if cont.bgBlur and cont.bgBlur > 0:
                    from PIL import ImageFilter

                    bg_tile = bg_tile.filter(
                        ImageFilter.GaussianBlur(radius=cont.bgBlur * scale)
                    )
                base.alpha_composite(bg_tile)
            except Exception as e:
                log.warning("bgimage.failed", error=str(e))

    if cont.bgOverlayOpacity and cont.bgOverlayOpacity > 0:
        overlay = Image.new(
            "RGBA",
            (W, H),
            _hex_to_rgba(cont.bgOverlayColor, cont.bgOverlayOpacity),
        )
        base.alpha_composite(overlay)

    for layer in text_layers:
        if layer.z == "behind-cells":
            composite_text_layer(base, layer, scale)

    tracks = grid_tracks(
        W, H,
        padding=cont.padding * scale,
        gap=cont.gap * scale,
        cols=grid.cols,
        rows=grid.rows,
        col_sizes=grid.colSizes,
        row_sizes=grid.rowSizes,
    )

    for cell in state.cells:
        box = cell_box(
            col_start=cell.colStart,
            row_start=cell.rowStart,
            col_span=cell.colSpan,
            row_span=cell.rowSpan,
            padding=cont.padding * scale,
            gap=cont.gap * scale,
            col_widths=tracks.col_widths,
            row_heights=tracks.row_heights,
            dx=cell.dx * scale,
            dy=cell.dy * scale,
            dw=cell.dw * scale,
            dh=cell.dh * scale,
        )
        cw_i = max(1, int(round(box[2])))
        ch_i = max(1, int(round(box[3])))
        cell_radius_out = cell.cellRadius * scale
        if cell.shape and cell.shape != "rect":
            cell_mask = make_container_mask(cell.shape, cw_i, ch_i, cell_radius_out)
        else:
            cell_mask = make_cell_mask(cw_i, ch_i, cell_radius_out)

        src = _open_source(cell)
        if src is None:
            tile = _empty_cell_tile(cw_i, ch_i, cell_mask)
        else:
            src = apply_css_filter(src, cell.filter)
            tile = compose_cell(src, box, cell, cell_mask, pixel_scale=scale)

        base.alpha_composite(tile, (int(round(box[0])), int(round(box[1]))))

        if cell.cellBorder > 0:
            stroke_cell(
                base,
                box,
                shape=cell.shape or "rect",
                radius_px=cell_radius_out,
                width=cell.cellBorder * scale,
                color=cell.cellBorderColor,
            )

    for layer in text_layers:
        if layer.z == "in-front-of-cells":
            composite_text_layer(base, layer, scale)
    composite_watermark(base, cont.watermark, scale)

    container_radius_out = cont.cornerRadius * scale
    container_mask = make_container_mask(cont.shape, W, H, container_radius_out)
    base = _apply_alpha(base, container_mask)

    if cont.borderWidth > 0:
        stroke_container(
            base, cont.shape, W, H,
            corner_px=container_radius_out,
            width=cont.borderWidth * scale,
            color=cont.borderColor,
        )

    # Bands that extend past the container silhouette.
    has_unclipped = any(
        layer.z in ("behind-container", "in-front-of-container") for layer in text_layers
    )
    if has_unclipped:
        outside_back = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        for layer in text_layers:
            if layer.z == "behind-container":
                composite_text_layer(outside_back, layer, scale)
        outside_back.alpha_composite(base)
        base = outside_back
        for layer in text_layers:
            if layer.z == "in-front-of-container":
                composite_text_layer(base, layer, scale)

    return _encode(base, out.format, out.quality)


def _fit_image(img: Image.Image, w: int, h: int, fit: str) -> Image.Image:
    """Resize ``img`` to ``(w, h)`` using object-fit semantics; returns RGBA at ``(w, h)``."""
    iw, ih = img.size
    if fit == "fill":
        return img.resize((w, h), Image.Resampling.LANCZOS)
    if fit == "contain":
        s = min(w / iw, h / ih)
    else:
        s = max(w / iw, h / ih)
    dw = max(1, int(round(iw * s)))
    dh = max(1, int(round(ih * s)))
    scaled = img.resize((dw, dh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.alpha_composite(scaled, ((w - dw) // 2, (h - dh) // 2))
    return canvas


def _empty_cell_tile(w: int, h: int, mask: Image.Image) -> Image.Image:
    from PIL import ImageDraw

    tile = Image.new("RGBA", (w, h), (26, 26, 28, 255))
    draw = ImageDraw.Draw(tile)
    stripe = (29, 29, 32, 255)
    step = 16
    for s in range(-h, w, step):
        draw.polygon(
            [(s, 0), (s + 8, 0), (s + 8 + h, h), (s + h, h)],
            fill=stripe,
        )
    r, g, b, a = tile.split()
    import numpy as np

    arr = (np.asarray(a, dtype=np.uint16) * np.asarray(mask, dtype=np.uint16) // 255).astype("uint8")
    return Image.merge("RGBA", (r, g, b, Image.fromarray(arr, mode="L")))


def _apply_alpha(base: Image.Image, mask: Image.Image) -> Image.Image:
    import numpy as np

    if base.mode != "RGBA":
        base = base.convert("RGBA")
    r, g, b, a = base.split()
    arr_a = np.asarray(a, dtype=np.uint16)
    arr_m = np.asarray(mask, dtype=np.uint16)
    combined = (arr_a * arr_m // 255).astype("uint8")
    return Image.merge("RGBA", (r, g, b, Image.fromarray(combined, mode="L")))


def _hex_to_rgba(hex_str: str, alpha: float | None = None) -> tuple[int, int, int, int]:
    """Parse ``#RGB``/``#RRGGBB``/``#RRGGBBAA``; supplied ``alpha`` (0..1) overrides any hex alpha."""
    s = hex_str.lstrip("#")
    if len(s) == 3:
        s = "".join(ch * 2 for ch in s)
    if len(s) == 6:
        r, g, b, a = int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), 255
    elif len(s) == 8:
        r, g, b, a = (
            int(s[0:2], 16),
            int(s[2:4], 16),
            int(s[4:6], 16),
            int(s[6:8], 16),
        )
    else:
        r, g, b, a = 255, 255, 255, 255
    if alpha is not None:
        a = max(0, min(255, int(round(alpha * 255))))
    return r, g, b, a


def _encode(img: Image.Image, fmt: str, quality: float) -> tuple[bytes, str]:
    buf = io.BytesIO()
    if fmt == "png":
        img.save(buf, format="PNG", optimize=True)
    elif fmt == "jpg":
        # JPEG has no alpha; flatten on white.
        if img.mode == "RGBA":
            background = Image.new("RGB", img.size, (255, 255, 255))
            background.paste(img, mask=img.split()[-1])
            img = background
        img.save(buf, format="JPEG", quality=int(round(quality * 100)), optimize=True, progressive=True)
    elif fmt == "webp":
        img.save(buf, format="WEBP", quality=int(round(quality * 100)), method=6)
    elif fmt == "svg":
        # SVG wrapper around the rendered PNG; not true vector geometry.
        import base64
        png_buf = io.BytesIO()
        img.save(png_buf, format="PNG", optimize=True)
        b64 = base64.b64encode(png_buf.getvalue()).decode("ascii")
        w, h = img.size
        svg = (
            f'<?xml version="1.0" encoding="UTF-8"?>\n'
            f'<svg xmlns="http://www.w3.org/2000/svg" '
            f'xmlns:xlink="http://www.w3.org/1999/xlink" '
            f'width="{w}" height="{h}" viewBox="0 0 {w} {h}">\n'
            f'  <image width="{w}" height="{h}" '
            f'xlink:href="data:image/png;base64,{b64}"/>\n'
            f"</svg>\n"
        )
        return svg.encode("utf-8"), _FORMAT_MIME[fmt]
    else:
        raise ValueError(f"unsupported format: {fmt}")
    return buf.getvalue(), _FORMAT_MIME[fmt]


__all__ = ["PillowRenderer"]


_ = Path
