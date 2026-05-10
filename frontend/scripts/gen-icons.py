#!/usr/bin/env python3
"""Generates apple-touch-icon.png (180x180) from the brand mark.

    python3 frontend/scripts/gen-icons.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "apple-touch-icon.png"

S = 180
ACCENT = (242, 174, 100)


def main() -> None:
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Rounded background.
    d.rounded_rectangle([0, 0, S, S], radius=40, fill=ACCENT)
    # Inner white panel.
    pad = 34
    d.rounded_rectangle([pad, pad, S - pad, S - pad], radius=14, fill=(255, 255, 255, 240))
    # Grid lines.
    third = (S - 2 * pad) / 3
    for i in (1, 2):
        x = pad + third * i
        d.line([x, pad + 6, x, S - pad - 6], fill=(0, 0, 0, 110), width=4)
        y = pad + third * i
        d.line([pad + 6, y, S - pad - 6, y], fill=(0, 0, 0, 110), width=4)
    img.convert("RGB").save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
