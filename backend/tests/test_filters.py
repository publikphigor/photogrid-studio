from __future__ import annotations

from PIL import Image

from photogrid.renderer.filters import apply_css_filter


def _solid(color: tuple[int, int, int]) -> Image.Image:
    return Image.new("RGBA", (8, 8), color + (255,))


def test_none_passthrough() -> None:
    src = _solid((128, 64, 200))
    out = apply_css_filter(src, "none")
    assert list(out.getpixel((0, 0))) == [128, 64, 200, 255]


def test_grayscale_full() -> None:
    src = _solid((255, 0, 0))
    out = apply_css_filter(src, "grayscale(100%)")
    r, g, b, _a = out.getpixel((0, 0))
    assert r == g == b


def test_brightness_doubles() -> None:
    src = _solid((50, 50, 50))
    out = apply_css_filter(src, "brightness(2.0)")
    r, _g, _b, _a = out.getpixel((0, 0))
    assert r >= 99


def test_compound_string() -> None:
    src = _solid((100, 100, 100))
    out = apply_css_filter(src, "contrast(1.15) saturate(1.2)")
    assert out.size == src.size


def test_hue_rotate_180_inverts_red_to_cyan() -> None:
    src = _solid((255, 0, 0))
    out = apply_css_filter(src, "hue-rotate(180deg)")
    r, g, b, _a = out.getpixel((0, 0))
    # 180-degree hue rotation of pure red lands on cyan-ish.
    assert r < 50
    assert g > 200
    assert b > 200
