from __future__ import annotations

import pytest

from photogrid.renderer.shapes import make_cell_mask, make_container_mask


@pytest.mark.parametrize(
    "shape",
    ["rect", "rounded", "squircle", "circle", "oval", "hexagon", "diamond", "arch", "blob", "heart"],
)
def test_container_mask_dims(shape: str) -> None:
    mask = make_container_mask(shape, 200, 100, corner_px=20)
    assert mask.size == (200, 100)
    assert mask.mode == "L"


def test_rect_is_fully_opaque() -> None:
    mask = make_container_mask("rect", 50, 50, 0)
    pixels = list(mask.getdata())
    assert all(p == 255 for p in pixels)


def test_circle_corners_transparent() -> None:
    mask = make_container_mask("circle", 100, 100, 0)
    # Corners of a circle inscribed in a 100x100 box are outside the circle.
    assert mask.getpixel((0, 0)) < 64
    assert mask.getpixel((99, 99)) < 64
    # Centre is inside.
    assert mask.getpixel((50, 50)) == 255


def test_cell_mask_radius_zero_full() -> None:
    mask = make_cell_mask(40, 40, 0)
    assert all(p == 255 for p in mask.getdata())
