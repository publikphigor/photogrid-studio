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
    # Uniform tracks: inner = 1000 - 40 (padding) - 20 (gaps) = 940 / 3 cols
    assert len(t.col_widths) == 3
    assert len(t.row_heights) == 2
    expected_w = (1000 - 20 * 2 - 10 * 2) / 3
    expected_h = (1000 - 20 * 2 - 10) / 2
    assert round(t.col_widths[0], 4) == round(expected_w, 4)
    assert round(t.row_heights[0], 4) == round(expected_h, 4)


def test_cell_box_corner_consistency() -> None:
    t = grid_tracks(1000, 1000, padding=10, gap=5, cols=2, rows=2)
    cx, cy, cw, ch = cell_box(
        col_start=2, row_start=2, col_span=1, row_span=1,
        padding=10, gap=5,
        col_widths=t.col_widths, row_heights=t.row_heights,
    )
    # The bottom-right corner of cell (2,2) plus padding should equal the canvas size.
    assert cx + cw + 10 == 1000
    assert cy + ch + 10 == 1000


def test_grid_tracks_non_uniform() -> None:
    # 70/30 split should give the first track 70% of the inner width.
    t = grid_tracks(1000, 1000, padding=10, gap=0, cols=2, rows=1, col_sizes=[7, 3])
    assert round(t.col_widths[0] / sum(t.col_widths), 3) == 0.7
