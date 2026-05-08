from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ShapeId = Literal[
    "rect", "rounded", "squircle", "circle", "oval",
    "hexagon", "diamond", "arch", "blob", "heart",
]
FitMode = Literal["cover", "contain", "fill"]
FormatId = Literal["png", "jpg", "webp"]


class CellImage(BaseModel):
    hash: str = Field(min_length=64, max_length=64)  # sha256 hex
    name: str = ""
    w: int = 0
    h: int = 0
    mime: str = ""


class Cell(BaseModel):
    id: str
    colStart: int = Field(ge=1)
    rowStart: int = Field(ge=1)
    colSpan: int = Field(ge=1)
    rowSpan: int = Field(ge=1)
    image: CellImage | None = None
    fit: FitMode = "cover"
    offsetX: float = 0
    offsetY: float = 0
    scale: float = 1.0
    rotation: float = 0
    filter: str = "none"
    shape: ShapeId = "rect"  # per-cell shape
    cellRadius: float = 0  # 0..50 (%)
    cellBorder: float = 0  # px
    cellBorderColor: str = "#ffffff"


class Container(BaseModel):
    shape: ShapeId = "rect"
    cornerRadius: float = 12  # %
    aspect: str = "1:1"
    bg: str = "#ffffff"
    bgTransparent: bool = False
    bgImage: CellImage | None = None
    bgImageFit: FitMode = "cover"
    padding: float = 16
    gap: float = 8
    borderWidth: float = 0
    borderColor: str = "#0a0a0a"


class Grid(BaseModel):
    cols: int = Field(ge=1, le=24)
    rows: int = Field(ge=1, le=24)


class Output(BaseModel):
    format: FormatId = "png"
    quality: float = Field(default=0.92, ge=0.1, le=1.0)
    scale: int = Field(default=2, ge=1, le=4)
    baseSize: int = Field(default=1200, ge=200, le=8000)


class PhotoGridState(BaseModel):
    container: Container
    grid: Grid
    cells: list[Cell]
    output: Output


class ExportRequest(BaseModel):
    state: PhotoGridState


class UploadResponse(BaseModel):
    hash: str
    mime: str
    w: int
    h: int
    size: int


class MissingHashes(BaseModel):
    missing: list[str]


class HealthResponse(BaseModel):
    ok: bool
    version: str
    cache: dict[str, float | int]
