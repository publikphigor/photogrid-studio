"""Container & cell shape masks. Geometry mirrors ``shapes.jsx`` / ``exporter.jsx``.

All masks are single-channel ('L') alpha images sized exactly to (w, h).
"""

from __future__ import annotations

from PIL import Image, ImageChops, ImageDraw, ImageFilter

from ..models import ShapeId

# Anti-alias factor: render mask at AAx and downsample with LANCZOS.
_AA = 2


def _new_mask(w: int, h: int) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("L", (w * _AA, h * _AA), 0)
    return img, ImageDraw.Draw(img)


def _finalize(img: Image.Image, w: int, h: int) -> Image.Image:
    if _AA == 1:
        return img
    return img.resize((w, h), Image.Resampling.LANCZOS)


def make_container_mask(shape: ShapeId, w: int, h: int, corner_pct: float) -> Image.Image:
    w = max(1, int(round(w)))
    h = max(1, int(round(h)))

    if shape == "rect":
        return Image.new("L", (w, h), 255)

    aw, ah = w * _AA, h * _AA
    img, draw = _new_mask(w, h)

    if shape == "rounded":
        r = max(0, int(min(aw, ah) * (corner_pct / 100.0)))
        draw.rounded_rectangle((0, 0, aw - 1, ah - 1), radius=r, fill=255)
    elif shape == "squircle":
        r = int(min(aw, ah) * 0.32)
        draw.rounded_rectangle((0, 0, aw - 1, ah - 1), radius=r, fill=255)
    elif shape in ("circle", "oval"):
        draw.ellipse((0, 0, aw - 1, ah - 1), fill=255)
    elif shape == "hexagon":
        draw.polygon(
            [
                (aw * 0.25, 0),
                (aw * 0.75, 0),
                (aw, ah * 0.5),
                (aw * 0.75, ah),
                (aw * 0.25, ah),
                (0, ah * 0.5),
            ],
            fill=255,
        )
    elif shape == "diamond":
        draw.polygon(
            [(aw * 0.5, 0), (aw, ah * 0.5), (aw * 0.5, ah), (0, ah * 0.5)],
            fill=255,
        )
    elif shape == "arch":
        # Round only the top corners.
        r = max(0, int(min(aw, ah) / 2))
        out = Image.new("L", (aw, ah), 0)
        ImageDraw.Draw(out).rounded_rectangle(
            (0, 0, aw - 1, ah - 1),
            radius=r,
            fill=255,
            corners=(True, True, False, False),
        )
        # Force the bottom half opaque to match a half-arch (top circular, bottom flat).
        ImageDraw.Draw(out).rectangle((0, r, aw, ah), fill=255)
        img = out
    elif shape == "blob":
        # Organic shape approximated by overlapping ellipses + a central pad.
        draw.rectangle((aw * 0.12, ah * 0.12, aw * 0.88, ah * 0.88), fill=255)
        draw.ellipse((0, ah * 0.10, aw * 0.62, ah * 0.95), fill=255)
        draw.ellipse((aw * 0.40, 0, aw, ah * 0.85), fill=255)
        draw.ellipse((aw * 0.05, ah * 0.30, aw * 0.95, ah), fill=255)
    elif shape == "heart":
        sx, sy = aw / 100.0, ah / 100.0
        cl = (int(25 * sx), int(32 * sy))
        cr = (int(75 * sx), int(32 * sy))
        radius = int(28 * min(sx, sy))
        draw.ellipse(
            (cl[0] - radius, cl[1] - radius, cl[0] + radius, cl[1] + radius),
            fill=255,
        )
        draw.ellipse(
            (cr[0] - radius, cr[1] - radius, cr[0] + radius, cr[1] + radius),
            fill=255,
        )
        draw.polygon(
            [
                (int(2 * sx), int(42 * sy)),
                (int(98 * sx), int(42 * sy)),
                (int(50 * sx), int(95 * sy)),
            ],
            fill=255,
        )
    else:
        draw.rectangle((0, 0, aw, ah), fill=255)

    return _finalize(img, w, h)


def make_cell_mask(w: int, h: int, radius_pct: float) -> Image.Image:
    w = max(1, int(round(w)))
    h = max(1, int(round(h)))
    if radius_pct <= 0:
        return Image.new("L", (w, h), 255)
    aw, ah = w * _AA, h * _AA
    img = Image.new("L", (aw, ah), 0)
    r = int(min(aw, ah) * (radius_pct / 100.0))
    ImageDraw.Draw(img).rounded_rectangle((0, 0, aw - 1, ah - 1), radius=r, fill=255)
    return _finalize(img, w, h)


def _stroke_band(mask: Image.Image, width: int) -> Image.Image:
    """Return a 1-channel band along the inside edge of `mask`, `width` px wide."""
    width = max(1, width)
    eroded = mask.filter(ImageFilter.MinFilter(2 * width + 1))
    return ImageChops.subtract(mask, eroded)


def _coloured_overlay(w: int, h: int, alpha: Image.Image, color: str) -> Image.Image:
    overlay = Image.new("RGBA", (w, h), color)  # solid colour, alpha=255
    overlay.putalpha(alpha)
    return overlay


def stroke_container(
    base: Image.Image,
    shape: ShapeId,
    w: int,
    h: int,
    corner_pct: float,
    width: float,
    color: str,
) -> None:
    if width <= 0:
        return
    inner = make_container_mask(shape, w, h, corner_pct)
    band = _stroke_band(inner, int(round(width)))
    base.alpha_composite(_coloured_overlay(w, h, band, color))


def stroke_cell(
    base: Image.Image,
    box: tuple[float, float, float, float],
    radius_pct: float,
    width: float,
    color: str,
) -> None:
    if width <= 0:
        return
    cx, cy, cw, ch = box
    w = max(1, int(round(cw)))
    h = max(1, int(round(ch)))
    mask = make_cell_mask(w, h, radius_pct)
    band = _stroke_band(mask, int(round(width)))
    base.alpha_composite(
        _coloured_overlay(w, h, band, color),
        (int(round(cx)), int(round(cy))),
    )
