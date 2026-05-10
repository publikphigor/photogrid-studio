#!/usr/bin/env python3
"""Generates the social/OG card for the landing page (1200x630 PNG).

Run from anywhere; output lands in ../public/og.png.

    python3 frontend/scripts/gen-og.py
"""
from __future__ import annotations
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
OUT = Path(__file__).resolve().parent.parent / "public" / "og.png"

BG_TOP = (11, 11, 12)
BG_BOT = (8, 8, 10)
PANEL = (24, 24, 26)
LINE = (52, 52, 58)
TEXT = (237, 237, 238)
TEXT_2 = (168, 168, 172)
TEXT_3 = (107, 107, 112)
ACCENT = (242, 174, 100)  # oklch(0.78 0.16 55) roughly
ACCENT_2 = (217, 142, 76)


def find_font(candidates: list[str], size: int) -> ImageFont.FreeTypeFont:
    common = [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/Library/Fonts/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates + common:
        if path and os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def flat_bg() -> Image.Image:
    # Solid dark background — no gradient, no glow.
    return Image.new("RGB", (W, H), BG_TOP)


def draw_grid_mock(img: Image.Image) -> None:
    """A small 3x3 grid mock card on the right side."""
    # Card geometry.
    card_w, card_h = 460, 460
    cx = W - 90 - card_w
    cy = (H - card_h) // 2

    d = ImageDraw.Draw(img, "RGBA")
    d.rounded_rectangle(
        [cx, cy, cx + card_w, cy + card_h],
        radius=22,
        fill=(20, 20, 22, 255),
        outline=(60, 60, 66, 255),
        width=1,
    )

    # 3x3 inner grid with one merged tall cell on left, mimicking the editor.
    pad = 26
    gap = 10
    inner_w = card_w - pad * 2
    inner_h = card_h - pad * 2
    col_w = (inner_w - gap * 2) / 3
    row_h = (inner_h - gap * 2) / 3
    palette = [
        (232, 169, 106),
        (95, 137, 198),
        (157, 114, 192),
        (217, 108, 99),
        (108, 182, 151),
        (224, 178, 92),
    ]

    def rect(c0, r0, c1, r1, color):
        x0 = cx + pad + col_w * c0 + gap * c0
        y0 = cy + pad + row_h * r0 + gap * r0
        x1 = cx + pad + col_w * (c1 + 1) + gap * c1
        y1 = cy + pad + row_h * (r1 + 1) + gap * r1
        d.rounded_rectangle([x0, y0, x1, y1], radius=10, fill=color)

    # Layout: tall left, 2x2 right with one wide bottom.
    rect(0, 0, 0, 2, palette[0])  # tall left, spans 3 rows
    rect(1, 0, 1, 0, palette[1])
    rect(2, 0, 2, 0, palette[2])
    rect(1, 1, 2, 1, palette[3])  # wide middle right
    rect(1, 2, 1, 2, palette[4])
    rect(2, 2, 2, 2, palette[5])


def main() -> None:
    img = flat_bg().convert("RGBA")
    draw_grid_mock(img)

    d = ImageDraw.Draw(img)
    title_font = find_font([], 64)
    sub_font = find_font([], 24)
    tag_font = find_font([], 22)
    label_font = find_font([], 18)

    # Eyebrow / brand.
    brand_x, brand_y = 72, 116
    # Brand mark — small gradient square + text.
    bm_size = 36
    bm = Image.new("RGBA", (bm_size, bm_size), (0, 0, 0, 0))
    bmd = ImageDraw.Draw(bm)
    bmd.rounded_rectangle([0, 0, bm_size, bm_size], radius=8, fill=ACCENT)
    bmd.rounded_rectangle([6, 6, bm_size - 6, bm_size - 6], radius=3, fill=(255, 255, 255, 235))
    bmd.line([6, 14, bm_size - 6, 14], fill=(0, 0, 0, 120), width=1)
    bmd.line([6, 22, bm_size - 6, 22], fill=(0, 0, 0, 120), width=1)
    bmd.line([14, 6, 14, bm_size - 6], fill=(0, 0, 0, 120), width=1)
    bmd.line([22, 6, 22, bm_size - 6], fill=(0, 0, 0, 120), width=1)
    img.alpha_composite(bm, (brand_x, brand_y))
    d.text((brand_x + bm_size + 14, brand_y + 4), "PhotoGrid Studio", font=tag_font, fill=TEXT_2)

    # Headline — two lines, sized to clear the right-side grid mock at x≈630.
    d.text((72, brand_y + 64), "Photo grids that", font=title_font, fill=TEXT)
    d.text((72, brand_y + 64 + 78), "keep them sharp.", font=title_font, fill=ACCENT)

    # Subhead.
    d.text(
        (74, brand_y + 64 + 78 + 100),
        "Export at the original size of your photos.",
        font=sub_font,
        fill=TEXT_2,
    )
    d.text(
        (74, brand_y + 64 + 78 + 100 + 36),
        "Free. Open source.",
        font=sub_font,
        fill=TEXT_3,
    )

    # Footer label.
    d.text((72, H - 60), "photogrid.studio", font=label_font, fill=TEXT_3)
    repo_label = "github.com/publikphigor/photogrid-studio"
    rl_bbox = d.textbbox((0, 0), repo_label, font=label_font)
    d.text((W - 72 - (rl_bbox[2] - rl_bbox[0]), H - 60), repo_label, font=label_font, fill=TEXT_3)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
