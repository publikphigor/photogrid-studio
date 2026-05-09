"""Container & cell shape masks. Geometry mirrors ``shapes.jsx`` / ``exporter.jsx``.

All masks are single-channel ('L') alpha images sized exactly to (w, h).
"""

from __future__ import annotations

from PIL import Image, ImageChops, ImageDraw

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


def make_container_mask(shape: ShapeId, w: int, h: int, corner_px: float) -> Image.Image:
    """Build a single-channel alpha mask for ``shape`` at (w, h).

    ``corner_px`` is the corner radius in OUTPUT pixels for the 'rounded'
    branch (the only shape that consults it). Pass design_pixels * scale at
    the call site so the corner radius matches the on-screen preview.
    """
    w = max(1, int(round(w)))
    h = max(1, int(round(h)))

    if shape == "rect":
        return Image.new("L", (w, h), 255)

    aw, ah = w * _AA, h * _AA
    img, draw = _new_mask(w, h)

    if shape == "rounded":
        # Clamp so the radius never exceeds half the shorter side (otherwise
        # PIL renders nothing at all).
        max_r = min(aw, ah) // 2
        r = max(0, min(max_r, int(round(corner_px * _AA))))
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
    elif shape == "triangle":
        draw.polygon(
            [(aw * 0.5, 0), (aw, ah), (0, ah)],
            fill=255,
        )
    elif shape == "pentagon":
        draw.polygon(
            [
                (aw * 0.5, 0),
                (aw, ah * 0.38),
                (aw * 0.82, ah),
                (aw * 0.18, ah),
                (0, ah * 0.38),
            ],
            fill=255,
        )
    elif shape == "octagon":
        draw.polygon(
            [
                (aw * 0.30, 0),
                (aw * 0.70, 0),
                (aw, ah * 0.30),
                (aw, ah * 0.70),
                (aw * 0.70, ah),
                (aw * 0.30, ah),
                (0, ah * 0.70),
                (0, ah * 0.30),
            ],
            fill=255,
        )
    elif shape == "star":
        draw.polygon(
            [
                (aw * 0.50, 0),
                (aw * 0.61, ah * 0.35),
                (aw * 0.98, ah * 0.35),
                (aw * 0.68, ah * 0.57),
                (aw * 0.79, ah * 0.91),
                (aw * 0.50, ah * 0.70),
                (aw * 0.21, ah * 0.91),
                (aw * 0.32, ah * 0.57),
                (aw * 0.02, ah * 0.35),
                (aw * 0.39, ah * 0.35),
            ],
            fill=255,
        )
    elif shape == "parallelogram":
        draw.polygon(
            [
                (aw * 0.20, 0),
                (aw, 0),
                (aw * 0.80, ah),
                (0, ah),
            ],
            fill=255,
        )
    elif shape == "chevron":
        draw.polygon(
            [
                (0, 0),
                (aw * 0.75, 0),
                (aw, ah * 0.50),
                (aw * 0.75, ah),
                (0, ah),
                (aw * 0.25, ah * 0.50),
            ],
            fill=255,
        )
    else:
        draw.rectangle((0, 0, aw, ah), fill=255)

    return _finalize(img, w, h)


def make_cell_mask(w: int, h: int, radius_px: float) -> Image.Image:
    """Rounded-rect alpha mask for a cell. ``radius_px`` is in OUTPUT pixels;
    callers pass ``cell.cellRadius * scale`` so the corner curve matches the
    pixel radius the on-screen preview drew.
    """
    w = max(1, int(round(w)))
    h = max(1, int(round(h)))
    if radius_px <= 0:
        return Image.new("L", (w, h), 255)
    aw, ah = w * _AA, h * _AA
    img = Image.new("L", (aw, ah), 0)
    max_r = min(aw, ah) // 2
    r = max(0, min(max_r, int(round(radius_px * _AA))))
    ImageDraw.Draw(img).rounded_rectangle((0, 0, aw - 1, ah - 1), radius=r, fill=255)
    return _finalize(img, w, h)


def _coloured_overlay(w: int, h: int, alpha: Image.Image, color: str) -> Image.Image:
    overlay = Image.new("RGBA", (w, h), color)  # solid colour, alpha=255
    overlay.putalpha(alpha)
    return overlay


def _shape_band_mask(shape: ShapeId, w: int, h: int, radius_px: float, width: int) -> Image.Image:
    """Inset stroke band of `width` px along the inside edge of the given shape.
    Computed as ``outer_mask - inner_mask`` where ``inner_mask`` is the same
    shape rendered into the rectangle inset by ``width`` on every side. This
    produces a fully-opaque band (subject only to AA fade at the very edges)
    so the exported border matches the saturation of CSS ``box-shadow inset``
    seen in the on-screen preview — the previous MinFilter approach left the
    band faded because the kernel min ate into the AA gradient on each edge.
    """
    width = max(1, width)
    outer = make_container_mask(shape, w, h, radius_px)
    inner_w = max(1, w - 2 * width)
    inner_h = max(1, h - 2 * width)
    if inner_w <= 1 or inner_h <= 1:
        return outer  # band swallows the cell entirely
    # Inner shape is the same shape rendered into the smaller box. Trim the
    # corner radius by `width` so the inner curve sits at uniform distance from
    # the outer curve (not just a smaller copy with a re-scaled radius).
    inner_radius = max(0.0, radius_px - width)
    inner_small = make_container_mask(shape, inner_w, inner_h, inner_radius)
    inner = Image.new("L", (w, h), 0)
    inner.paste(inner_small, (width, width))
    return ImageChops.subtract(outer, inner)


def stroke_container(
    base: Image.Image,
    shape: ShapeId,
    w: int,
    h: int,
    corner_px: float,
    width: float,
    color: str,
) -> None:
    if width <= 0:
        return
    band = _shape_band_mask(shape, w, h, corner_px, int(round(width)))
    base.alpha_composite(_coloured_overlay(w, h, band, color))


def stroke_cell(
    base: Image.Image,
    box: tuple[float, float, float, float],
    shape: ShapeId,
    radius_px: float,
    width: float,
    color: str,
) -> None:
    """Draw an inset stroke that matches the cell's actual silhouette.
    ``shape`` is the cell shape ('rect', 'rounded', 'circle', …); the band
    follows that shape so a circular cell gets a circular stroke instead of
    the rounded-rect outline it used to inherit when stroke_cell ignored the
    shape. ``radius_px`` is in OUTPUT pixels (design_px * output.scale).
    """
    if width <= 0:
        return
    cx, cy, cw, ch = box
    w = max(1, int(round(cw)))
    h = max(1, int(round(ch)))
    # 'rect' with a non-zero radius is a rounded rect; that's the same code
    # path as 'rounded' for the band-mask helper.
    use_shape: ShapeId = shape if shape and shape != "rect" else "rounded"
    band = _shape_band_mask(use_shape, w, h, radius_px, int(round(width)))
    base.alpha_composite(
        _coloured_overlay(w, h, band, color),
        (int(round(cx)), int(round(cy))),
    )
