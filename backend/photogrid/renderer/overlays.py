"""Watermark + free-floating text overlays for the Pillow renderer.

Both kinds of overlay are rasterised onto a transparent RGBA tile sized to
the layer's content, then alpha-composited onto the base canvas at the
right z-band. Coordinates from the frontend arrive as fractions of the
container; this module converts them to output pixels.
"""

from __future__ import annotations

import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

from ..cache.disk import find_cached
from ..logging_setup import log
from ..models import TextLayer, Watermark


def _hex_to_rgba(hex_str: str, alpha: float = 1.0) -> tuple[int, int, int, int]:
    s = hex_str.lstrip("#")
    if len(s) == 3:
        s = "".join(ch * 2 for ch in s)
    a = max(0, min(255, int(round(alpha * 255))))
    if len(s) == 6:
        return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), a)
    if len(s) == 8:
        # Override alpha with caller's value when both are supplied.
        return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), a)
    return (255, 255, 255, a)


# Each entry: (family-name regex, regular path, bold path). Order matters —
# the first regex match wins. The family regex is matched against the lower-
# cased CSS font-family stack the frontend sent us, so we have to handle
# multi-name stacks like `'"Comic Sans MS", "Chalkboard SE", cursive'`.
#
# All paths target the Debian package layout shipped by `fonts-liberation`,
# `fonts-liberation2`, `fonts-dejavu-core`, and `fonts-noto-core` — the
# packages installed in the runtime image. macOS host paths are kept as
# fallbacks so dev environments that run the renderer outside Docker still
# pick up something reasonable.
_FONT_HINTS: list[tuple[re.Pattern[str], list[str], list[str]]] = [
    (
        re.compile(r"impact", re.IGNORECASE),
        # Impact has no Debian-native equivalent; Liberation Sans Bold is the
        # closest "thick condensed sans" we can rely on.
        [
            "/System/Library/Fonts/Supplemental/Impact.ttf",
            "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ],
        [
            "/System/Library/Fonts/Supplemental/Impact.ttf",
            "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ],
    ),
    (
        re.compile(r"georgia|times|serif", re.IGNORECASE),
        [
            "/System/Library/Fonts/Supplemental/Georgia.ttf",
            "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
            "/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
        ],
        [
            "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
            "/usr/share/fonts/truetype/liberation2/LiberationSerif-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
        ],
    ),
    (
        re.compile(r"courier|monospace|mono", re.IGNORECASE),
        [
            "/System/Library/Fonts/Supplemental/Courier New.ttf",
            "/usr/share/fonts/truetype/liberation2/LiberationMono-Regular.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        ],
        [
            "/System/Library/Fonts/Supplemental/Courier New Bold.ttf",
            "/usr/share/fonts/truetype/liberation2/LiberationMono-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
        ],
    ),
    (
        re.compile(r"comic|chalkboard|cursive", re.IGNORECASE),
        [
            "/System/Library/Fonts/Supplemental/Comic Sans MS.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ],
        [
            "/System/Library/Fonts/Supplemental/Comic Sans MS Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ],
    ),
    # Helvetica / Arial / generic sans goes through Liberation Sans, which is
    # metrically compatible with Arial.
    (
        re.compile(r"helvetica|arial|trebuchet|sans", re.IGNORECASE),
        [
            "/System/Library/Fonts/Helvetica.ttc",
            "/System/Library/Fonts/HelveticaNeue.ttc",
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ],
        [
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ],
    ),
]

_DEFAULT_FONTS_REGULAR = [
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]
_DEFAULT_FONTS_BOLD = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def _load_font(family: str, size_px: int, weight: int = 400) -> ImageFont.ImageFont:
    """Best-effort load of a TrueType font that matches the CSS family stack
    and weight. Falls back to Pillow's default bitmap font when nothing is
    installed (rare — the runtime image bundles Liberation + DejaVu)."""
    bold = weight >= 600
    candidates: list[str] = []
    for pat, regular_hits, bold_hits in _FONT_HINTS:
        if pat.search(family):
            candidates.extend(bold_hits if bold else regular_hits)
            break
    candidates.extend(_DEFAULT_FONTS_BOLD if bold else _DEFAULT_FONTS_REGULAR)
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size=max(1, size_px))
            except Exception as e:
                log.debug("font.load.failed", path=path, error=str(e))
                continue
    return ImageFont.load_default()


def _rotate_tile(tile: Image.Image, angle_deg: float) -> Image.Image:
    if abs(angle_deg) < 1e-3:
        return tile
    return tile.rotate(-angle_deg, resample=Image.Resampling.BICUBIC, expand=True)


def _paste_centered(
    base: Image.Image,
    tile: Image.Image,
    cx: float,
    cy: float,
    *,
    anchor_x: str = "center",
) -> None:
    """Paste `tile` onto `base` so the anchor point sits at (cx, cy)."""
    tw, th = tile.size
    if anchor_x == "left":
        ox = cx
    elif anchor_x == "right":
        ox = cx - tw
    else:
        ox = cx - tw / 2
    oy = cy - th / 2
    base.alpha_composite(tile, (int(round(ox)), int(round(oy))))


def render_text_tile(
    text: str,
    font_family: str,
    size_px: int,
    color_hex: str,
    weight: int,
    opacity: float,
    align: str,
    angle_deg: float,
) -> Image.Image:
    """Rasterise a single string into an RGBA tile sized to the text's bbox,
    then optionally rotated. Returns a blank 1×1 tile for empty input. The
    `weight` is consumed by `_load_font` to pick a Bold face when available;
    weights below 600 use the regular face."""
    if not text:
        return Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    font = _load_font(font_family, size_px, weight)
    lines = text.split("\n")
    line_widths: list[int] = []
    line_heights: list[int] = []
    ascent_extra = 0
    for line in lines:
        bbox = font.getbbox(line) if line else (0, 0, 0, 0)
        w = max(1, bbox[2] - bbox[0])
        h = max(1, bbox[3] - bbox[1])
        line_widths.append(w)
        line_heights.append(h)
        ascent_extra = max(ascent_extra, -bbox[1])
    total_h = sum(line_heights) + max(0, len(lines) - 1) * int(round(size_px * 0.2))
    total_w = max(line_widths) if line_widths else 1
    pad = max(2, size_px // 16)
    tile = Image.new("RGBA", (total_w + pad * 2, total_h + pad * 2), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tile)
    color_rgba = _hex_to_rgba(color_hex, opacity)
    y = pad + ascent_extra
    for line, w, h in zip(lines, line_widths, line_heights, strict=False):
        if align == "left":
            x = pad
        elif align == "right":
            x = pad + (total_w - w)
        else:
            x = pad + (total_w - w) // 2
        draw.text((x, y), line, font=font, fill=color_rgba)
        y += h + int(round(size_px * 0.2))
    return _rotate_tile(tile, angle_deg)


def composite_watermark(base: Image.Image, watermark: Watermark | None, scale: int) -> None:
    """Composite a watermark onto `base`. No-op when disabled or empty.
    `scale` is the design-pixel → output-pixel ratio. `watermark.sizePx` is in
    design pixels (multiplied here)."""
    if watermark is None or not watermark.enabled:
        return
    W, H = base.size
    cx = watermark.x * W
    cy = watermark.y * H
    if watermark.kind == "text":
        if not watermark.text:
            return
        size_px = max(1, int(round(watermark.sizePx * scale)))
        tile = render_text_tile(
            text=watermark.text,
            font_family=watermark.font,
            size_px=size_px,
            color_hex=watermark.color,
            weight=watermark.weight,
            opacity=watermark.opacity,
            align="center",
            angle_deg=watermark.angle,
        )
        _paste_centered(base, tile, cx, cy)
        return
    if watermark.image is None:
        return
    cached = find_cached(watermark.image.hash)
    if cached is None:
        log.warning("watermark.image.missing", hash=watermark.image.hash)
        return
    try:
        with Image.open(cached) as raw:
            raw.load()
            raw = ImageOps.exif_transpose(raw)
            img = raw.convert("RGBA")
    except Exception as e:
        log.warning("watermark.image.failed", error=str(e))
        return
    target_w = max(1, int(round(watermark.sizePx * scale)))
    iw, ih = img.size
    target_h = max(1, int(round(target_w * ih / iw)))
    if (target_w, target_h) != (iw, ih):
        img = img.resize((target_w, target_h), Image.Resampling.LANCZOS)
    if watermark.opacity < 1.0:
        a = img.split()[-1]
        a = a.point(lambda v: int(v * max(0.0, min(1.0, watermark.opacity))))
        img.putalpha(a)
    img = _rotate_tile(img, watermark.angle)
    _paste_centered(base, img, cx, cy)


def composite_text_layer(
    base: Image.Image,
    layer: TextLayer,
    scale: int,
) -> None:
    """Composite a single TextLayer onto `base` (already at output resolution)."""
    if not layer.text:
        return
    W, H = base.size
    cx = layer.x * W
    cy = layer.y * H
    size_px = max(1, int(round(layer.size * scale)))
    tile = render_text_tile(
        text=layer.text,
        font_family=layer.font,
        size_px=size_px,
        color_hex=layer.color,
        weight=layer.weight,
        opacity=layer.opacity,
        align=layer.align,
        angle_deg=layer.rotation,
    )
    _paste_centered(base, tile, cx, cy, anchor_x=layer.align)


__all__ = ["composite_watermark", "composite_text_layer", "render_text_tile"]
