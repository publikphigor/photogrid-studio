"""Geometry shared with the frontend. Mirror of ``frontend/src/state/presets.ts``.

Keep these constants in sync with the prototype's ``shapes.jsx``.
"""

from __future__ import annotations

from dataclasses import dataclass

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
    """Mirror of ``dimensionsFor`` from state.jsx — `base_size` is the longest side."""
    rw, rh = ASPECT_RATIOS.get(aspect, (1, 1))
    if rw >= rh:
        return Size(base_size, round(base_size * rh / rw))
    return Size(round(base_size * rw / rh), base_size)


@dataclass(slots=True, frozen=True)
class GridTracks:
    inner_w: float
    inner_h: float
    track_w: float
    track_h: float


def grid_tracks(width: float, height: float, padding: float, gap: float, cols: int, rows: int) -> GridTracks:
    inner_w = max(0.0, width - padding * 2)
    inner_h = max(0.0, height - padding * 2)
    track_w = (inner_w - gap * (cols - 1)) / cols if cols > 0 else 0.0
    track_h = (inner_h - gap * (rows - 1)) / rows if rows > 0 else 0.0
    return GridTracks(inner_w, inner_h, max(0.0, track_w), max(0.0, track_h))


def cell_box(
    *,
    col_start: int,
    row_start: int,
    col_span: int,
    row_span: int,
    padding: float,
    gap: float,
    track_w: float,
    track_h: float,
) -> tuple[float, float, float, float]:
    cx = padding + (col_start - 1) * (track_w + gap)
    cy = padding + (row_start - 1) * (track_h + gap)
    cw = track_w * col_span + gap * (col_span - 1)
    ch = track_h * row_span + gap * (row_span - 1)
    return cx, cy, cw, ch
