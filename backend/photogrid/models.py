from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ShapeId = Literal[
    "rect", "rounded", "squircle", "circle", "oval",
    "hexagon", "diamond", "arch", "blob", "heart",
    "triangle", "pentagon", "octagon", "star",
    "parallelogram", "chevron",
]
FitMode = Literal["native", "cover", "contain", "fill"]
FormatId = Literal["png", "jpg", "webp", "svg"]


class CellImage(BaseModel):
    hash: str = Field(min_length=64, max_length=64)
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
    fit: FitMode = "native"
    offsetX: float = 0
    offsetY: float = 0
    scale: float = 1.0
    rotation: float = 0
    filter: str = "none"
    shape: ShapeId = "rect"
    cellRadius: float = 0
    cellBorder: float = 0
    cellBorderColor: str = "#ffffff"
    dx: float = 0
    dy: float = 0
    dw: float = 0
    dh: float = 0


class Watermark(BaseModel):
    enabled: bool = False
    kind: Literal["text", "image"] = "text"
    text: str = ""
    font: str = "Helvetica, Arial, sans-serif"
    weight: int = 600
    image: CellImage | None = None
    x: float = 0.5
    y: float = 0.95
    sizePx: float = 64.0
    opacity: float = 0.6
    angle: float = 0
    color: str = "#ffffff"


class Container(BaseModel):
    shape: ShapeId = "rect"
    cornerRadius: float = 12
    aspect: str = "1:1"
    bg: str = "#ffffff"
    bgTransparent: bool = False
    bgImage: CellImage | None = None
    bgImageFit: FitMode = "cover"
    bgBlur: float = 0
    bgOverlayColor: str = "#000000"
    bgOverlayOpacity: float = 0
    padding: float = 16
    gap: float = 8
    borderWidth: float = 0
    borderColor: str = "#0a0a0a"
    watermark: Watermark | None = None


TextLayerZ = Literal[
    "behind-container",
    "behind-cells",
    "in-front-of-cells",
    "in-front-of-container",
]


class TextLayer(BaseModel):
    id: str
    text: str = ""
    font: str = "Helvetica, Arial, sans-serif"
    size: float = 24
    color: str = "#ffffff"
    x: float = 0.5
    y: float = 0.5
    rotation: float = 0
    opacity: float = 1.0
    weight: int = 600
    align: Literal["left", "center", "right"] = "center"
    z: TextLayerZ = "in-front-of-cells"


class Grid(BaseModel):
    cols: int = Field(ge=1, le=24)
    rows: int = Field(ge=1, le=24)
    colSizes: list[float] | None = None
    rowSizes: list[float] | None = None


class Output(BaseModel):
    format: FormatId = "png"
    quality: float = Field(default=0.92, ge=0.1, le=1.0)
    scale: int = Field(default=2, ge=1, le=4)
    baseSize: int = Field(default=1200, ge=200, le=8000)
    filename: str | None = None


class PhotoGridState(BaseModel):
    container: Container
    grid: Grid
    cells: list[Cell]
    output: Output
    textLayers: list[TextLayer] = []


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
