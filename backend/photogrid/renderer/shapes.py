"""Container & cell shape masks ('L' alpha images), geometry mirrored from the frontend."""

from __future__ import annotations

from PIL import Image, ImageChops, ImageDraw

from ..models import ShapeId

# Render masks at AAx and downsample with LANCZOS for anti-aliasing.
_AA = 2


def _new_mask(w: int, h: int) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("L", (w * _AA, h * _AA), 0)
    return img, ImageDraw.Draw(img)


def _finalize(img: Image.Image, w: int, h: int) -> Image.Image:
    if _AA == 1:
        return img
    return img.resize((w, h), Image.Resampling.LANCZOS)


def make_container_mask(shape: ShapeId, w: int, h: int, corner_px: float) -> Image.Image:
    """Single-channel alpha mask for ``shape`` at ``(w, h)``; ``corner_px`` is OUTPUT pixels (only used by 'rounded')."""
    w = max(1, int(round(w)))
    h = max(1, int(round(h)))

    if shape == "rect":
        return Image.new("L", (w, h), 255)

    aw, ah = w * _AA, h * _AA
    img, draw = _new_mask(w, h)

    if shape == "rounded":
        # PIL renders nothing when radius exceeds half the shorter side.
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
        r = max(0, int(min(aw, ah) / 2))
        out = Image.new("L", (aw, ah), 0)
        ImageDraw.Draw(out).rounded_rectangle(
            (0, 0, aw - 1, ah - 1),
            radius=r,
            fill=255,
            corners=(True, True, False, False),
        )
        ImageDraw.Draw(out).rectangle((0, r, aw, ah), fill=255)
        img = out
    elif shape == "blob":
        draw.rectangle((aw * 0.12, ah * 0.12, aw * 0.88, ah * 0.88), fill=255)
        draw.ellipse((0, ah * 0.10, aw * 0.62, ah * 0.95), fill=255)
        draw.ellipse((aw * 0.40, 0, aw, ah * 0.85), fill=255)
        draw.ellipse((aw * 0.05, ah * 0.30, aw * 0.95, ah), fill=255)
    elif shape == "heart":
        # Bezier sampling mirrors the frontend `shapes.ts` heart path so silhouettes match pixel-for-pixel.
        beziers = [
            ((50, 92), (18, 74), (4, 46), (18, 24)),
            ((18, 24), (30, 6), (50, 12), (50, 32)),
            ((50, 32), (50, 12), (70, 6), (82, 24)),
            ((82, 24), (96, 46), (82, 74), (50, 92)),
        ]
        sx, sy = aw / 100.0, ah / 100.0
        pts: list[tuple[float, float]] = []
        steps = 64
        for p0, p1, p2, p3 in beziers:
            for i in range(steps):
                t = i / steps
                u = 1 - t
                bx = (
                    u * u * u * p0[0]
                    + 3 * u * u * t * p1[0]
                    + 3 * u * t * t * p2[0]
                    + t * t * t * p3[0]
                )
                by = (
                    u * u * u * p0[1]
                    + 3 * u * u * t * p1[1]
                    + 3 * u * t * t * p2[1]
                    + t * t * t * p3[1]
                )
                pts.append((bx * sx, by * sy))
        draw.polygon(pts, fill=255)
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
    """Rounded-rect alpha mask for a cell; ``radius_px`` is in OUTPUT pixels."""
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
    overlay = Image.new("RGBA", (w, h), color)
    overlay.putalpha(alpha)
    return overlay


def _shape_band_mask(shape: ShapeId, w: int, h: int, radius_px: float, width: int) -> Image.Image:
    """Inset stroke band of ``width`` px along the inside edge of ``shape`` as ``outer_mask - inner_mask``."""
    width = max(1, width)
    outer = make_container_mask(shape, w, h, radius_px)
    inner_w = max(1, w - 2 * width)
    inner_h = max(1, h - 2 * width)
    if inner_w <= 1 or inner_h <= 1:
        return outer
    # Trim radius by width so the inner curve sits at uniform distance from the outer curve.
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
    """Draw an inset stroke matching the cell silhouette; ``radius_px`` is OUTPUT pixels."""
    if width <= 0:
        return
    cx, cy, cw, ch = box
    w = max(1, int(round(cw)))
    h = max(1, int(round(ch)))
    use_shape: ShapeId = shape if shape and shape != "rect" else "rounded"
    band = _shape_band_mask(use_shape, w, h, radius_px, int(round(width)))
    base.alpha_composite(
        _coloured_overlay(w, h, band, color),
        (int(round(cx)), int(round(cy))),
    )
