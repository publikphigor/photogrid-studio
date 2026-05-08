"""Per-cell composition: open original, fit, scale, offset, rotate, mask."""

from __future__ import annotations

import math

from PIL import Image

from ..models import Cell


def fit_dims(iw: int, ih: int, cw: float, ch: float, fit: str) -> tuple[float, float]:
    if fit == "native":
        # Render at intrinsic pixel size; user positions via offsetX/offsetY.
        return float(iw), float(ih)
    if fit == "fill":
        return cw, ch
    if fit == "contain":
        s = min(cw / iw, ch / ih) if iw and ih else 1.0
        return iw * s, ih * s
    s = max(cw / iw, ch / ih) if iw and ih else 1.0
    return iw * s, ih * s


def _rotation_cover_scale(rotation_deg: float) -> float:
    """Scale-up factor so a rotated rectangle still covers the original axis-aligned box."""
    rad = math.radians(rotation_deg)
    return abs(math.cos(rad)) + abs(math.sin(rad))


def compose_cell(
    img: Image.Image,
    box: tuple[float, float, float, float],
    cell: Cell,
    cell_mask: Image.Image,
    pixel_scale: float = 1.0,
) -> Image.Image:
    """Compose a single cell into an RGBA tile sized to the cell box.

    `pixel_scale` is the design-pixel → output-pixel ratio (Output.scale).
    `box` and the returned tile are in output pixels; `cell.offsetX/Y` and
    `cell.image.w/h` are in design pixels and are scaled accordingly.
    """
    cx, cy, cw, ch = box
    cw_i = max(1, int(round(cw)))
    ch_i = max(1, int(round(ch)))
    iw, ih = img.size

    if cell.fit == "native":
        # Render the source at intrinsic pixel size, scaled into output space.
        dw = iw * pixel_scale
        dh = ih * pixel_scale
    else:
        dw, dh = fit_dims(iw, ih, cw, ch, cell.fit)
    dw *= cell.scale
    dh *= cell.scale
    if cell.rotation and cell.fit == "cover":
        # Scale up so the rotated image still fills the (axis-aligned) cell.
        s = _rotation_cover_scale(cell.rotation)
        dw *= s
        dh *= s
    dw_i = max(1, int(round(dw)))
    dh_i = max(1, int(round(dh)))

    # Resample with LANCZOS for max quality.
    if (dw_i, dh_i) != (iw, ih):
        scaled = img.resize((dw_i, dh_i), Image.Resampling.LANCZOS)
    else:
        scaled = img.copy()

    ox = cell.offsetX * pixel_scale
    oy = cell.offsetY * pixel_scale

    # Position: centered in cell, then offset.
    dx = (cw - dw_i) / 2 + ox
    dy = (ch - dh_i) / 2 + oy

    # Rotate around the cell's centre (matching the prototype exporter.jsx).
    if cell.rotation:
        scaled = scaled.rotate(
            -cell.rotation,  # PIL rotates counter-clockwise; CSS uses clockwise
            resample=Image.Resampling.BICUBIC,
            expand=True,
        )
        # Recompute placement so the visible centre stays put.
        new_w, new_h = scaled.size
        dx = (cw - new_w) / 2 + ox
        dy = (ch - new_h) / 2 + oy
        dw_i, dh_i = new_w, new_h

    tile = Image.new("RGBA", (cw_i, ch_i), (0, 0, 0, 0))
    if scaled.mode != "RGBA":
        scaled = scaled.convert("RGBA")
    tile.alpha_composite(scaled, (int(round(dx)), int(round(dy))))

    # Apply cell mask: any pixels outside the rounded-corner mask become transparent.
    if cell_mask.size != (cw_i, ch_i):
        cell_mask = cell_mask.resize((cw_i, ch_i), Image.Resampling.LANCZOS)
    r, g, b, a = tile.split()
    import numpy as np

    arr_a = np.asarray(a, dtype=np.uint16)
    arr_m = np.asarray(cell_mask, dtype=np.uint16)
    combined = (arr_a * arr_m // 255).astype("uint8")
    return Image.merge("RGBA", (r, g, b, Image.fromarray(combined, mode="L")))
