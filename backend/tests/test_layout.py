from __future__ import annotations

from photogrid.renderer.layout import cell_box, dimensions_for, grid_tracks


def test_dimensions_square() -> None:
    d = dimensions_for("1:1", 1200)
    assert (d.w, d.h) == (1200, 1200)


def test_dimensions_landscape() -> None:
    d = dimensions_for("16:9", 1600)
    assert (d.w, d.h) == (1600, 900)


def test_dimensions_portrait() -> None:
    d = dimensions_for("9:16", 1600)
    assert (d.w, d.h) == (900, 1600)


def test_grid_tracks_fits_inner_box() -> None:
    t = grid_tracks(1000, 1000, padding=20, gap=10, cols=3, rows=2)
    # inner = 960x960; track_w = (960 - 20)/3 ; track_h = (960 - 10)/2
    assert round(t.track_w, 4) == round((960 - 20) / 3, 4)
    assert round(t.track_h, 4) == round((960 - 10) / 2, 4)


def test_cell_box_corner_consistency() -> None:
    t = grid_tracks(1000, 1000, padding=10, gap=5, cols=2, rows=2)
    cx, cy, cw, ch = cell_box(
        col_start=2, row_start=2, col_span=1, row_span=1,
        padding=10, gap=5, track_w=t.track_w, track_h=t.track_h,
    )
    # The bottom-right corner of cell (2,2) plus padding should equal the canvas size.
    assert cx + cw + 10 == 1000
    assert cy + ch + 10 == 1000
