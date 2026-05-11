"""Geometry shared with the frontend; mirror of ``frontend/src/state/presets.ts``."""

from __future__ import annotations

from dataclasses import dataclass, field

ASPECT_RATIOS: dict[str, tuple[int, int]] = {
    "1:1": (1, 1),
    "4:5": (4, 5),
    "3:4": (3, 4),
    "9:16": (9, 16),
    "4:3": (4, 3),
    "16:9": (16, 9),
    "2:1": (2, 1),
}


@dataclass(slots=True, frozen=True)
class Size:
    w: int
    h: int


def dimensions_for(aspect: str, base_size: int) -> Size:
    """Return canvas size for ``aspect`` with ``base_size`` as the longest side."""
    rw, rh = ASPECT_RATIOS.get(aspect, (1, 1))
    if rw >= rh:
        return Size(base_size, round(base_size * rh / rw))
    return Size(round(base_size * rw / rh), base_size)


@dataclass(slots=True, frozen=True)
class GridTracks:
    inner_w: float
    inner_h: float
    col_widths: tuple[float, ...] = field(default_factory=tuple)
    row_heights: tuple[float, ...] = field(default_factory=tuple)


def grid_tracks(
    width: float,
    height: float,
    padding: float,
    gap: float,
    cols: int,
    rows: int,
    col_sizes: list[float] | None = None,
    row_sizes: list[float] | None = None,
) -> GridTracks:
    inner_w = max(0.0, width - padding * 2 - gap * (cols - 1))
    inner_h = max(0.0, height - padding * 2 - gap * (rows - 1))
    cw_weights = (
        col_sizes if col_sizes and len(col_sizes) == cols else [1.0] * max(cols, 0)
    )
    rh_weights = (
        row_sizes if row_sizes and len(row_sizes) == rows else [1.0] * max(rows, 0)
    )
    col_total = sum(cw_weights) or 1.0
    row_total = sum(rh_weights) or 1.0
    col_widths = tuple(max(0.0, w / col_total * inner_w) for w in cw_weights)
    row_heights = tuple(max(0.0, h / row_total * inner_h) for h in rh_weights)
    return GridTracks(inner_w, inner_h, col_widths, row_heights)


def cell_box(
    *,
    col_start: int,
    row_start: int,
    col_span: int,
    row_span: int,
    padding: float,
    gap: float,
    col_widths: tuple[float, ...],
    row_heights: tuple[float, ...],
    dx: float = 0,
    dy: float = 0,
    dw: float = 0,
    dh: float = 0,
) -> tuple[float, float, float, float]:
    """Compute a cell's pixel rect; ``dx/dy/dw/dh`` must already be in the same pixel space as the track widths."""
    cx = padding + sum(col_widths[: col_start - 1]) + (col_start - 1) * gap + dx
    cy = padding + sum(row_heights[: row_start - 1]) + (row_start - 1) * gap + dy
    cw = sum(col_widths[col_start - 1 : col_start - 1 + col_span]) + gap * (col_span - 1) + dw
    ch = sum(row_heights[row_start - 1 : row_start - 1 + row_span]) + gap * (row_span - 1) + dh
    return cx, cy, cw, ch
