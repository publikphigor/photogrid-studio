export type ShapeId =
  | 'rect'
  | 'rounded'
  | 'squircle'
  | 'circle'
  | 'oval'
  | 'hexagon'
  | 'diamond'
  | 'arch'
  | 'blob'
  | 'heart'
  | 'triangle'
  | 'pentagon'
  | 'octagon'
  | 'star'
  | 'parallelogram'
  | 'chevron';

export type FitMode = 'native' | 'cover' | 'contain' | 'fill';
export type FormatId = 'png' | 'jpg' | 'webp' | 'svg';

/** Per-cell visual filter parameters. Each value is normalized so 0 means
 *  "no effect" — the renderer can skip the filter when every value is at
 *  default. The CSS preview composes these into a `filter:` string; the
 *  backend Pillow renderer applies the equivalent ops. */
export interface CellFilters {
  /** 0..1 — desaturation amount. */
  grayscale: number;
  /** 0..1 — sepia tint amount. */
  sepia: number;
  /** 0..2 — multiplier (1 = unchanged). */
  contrast: number;
  /** 0..2 — multiplier (1 = unchanged). */
  brightness: number;
  /** 0..2 — multiplier (1 = unchanged). */
  saturate: number;
  /** -180..180 degrees. */
  hueRotate: number;
  /** 0..1 — invert amount. */
  invert: number;
  /** 0..20 px gaussian blur. */
  blur: number;
}

export interface CellImageRef {
  hash: string;
  name: string;
  w: number;
  h: number;
  mime: string;
  /** Lower-resolution preview URL (object URL or data URL) for the on-screen canvas. */
  previewUrl?: string;
}

export interface Cell {
  id: string;
  colStart: number;
  rowStart: number;
  colSpan: number;
  rowSpan: number;
  image: CellImageRef | null;
  fit: FitMode;
  offsetX: number;
  offsetY: number;
  scale: number;
  rotation: number;
  /** Legacy CSS filter string. Kept for templates saved before structured
   *  filters existed; new edits write to `filters` instead. */
  filter: string;
  /** Structured filter params. Optional for back-compat — when omitted,
   *  the renderer falls back to parsing `filter`. */
  filters?: CellFilters;
  shape: ShapeId; // per-cell shape, defaults to 'rect'
  cellRadius: number;
  cellBorder: number;
  cellBorderColor: string;
  /** Per-cell pixel offsets layered on top of the grid-computed box. Edge
   *  resize handles (E/W/N/S) modify these so only the dragged cell + its
   *  immediate neighbor along that edge change size; cells in the same column
   *  but a different row keep their original boundary. Corner handles ignore
   *  these and adjust the global track sizes instead. Optional for back-compat
   *  with templates saved before this field existed. */
  dx?: number;
  dy?: number;
  dw?: number;
  dh?: number;
}

export type ContainerBgFit = 'cover' | 'contain' | 'fill';

export type WatermarkKind = 'text' | 'image';

export interface Watermark {
  enabled: boolean;
  kind: WatermarkKind;
  /** Watermark text (used when kind = 'text'). */
  text: string;
  font: string;
  /** Font weight (used when kind = 'text'). 400 = normal, 600+ = bold. */
  weight: number;
  /** Image used when kind = 'image'; references the upload cache. */
  image: CellImageRef | null;
  /** Position as fractions of the container (0..1). 0.5 = centered. */
  x: number;
  y: number;
  /** Size in design pixels. For text watermarks this is the font size; for
   *  image watermarks it's the rendered width (height keeps aspect). */
  sizePx: number;
  /** Alpha multiplier (0..1). */
  opacity: number;
  /** Rotation in degrees. */
  angle: number;
  /** Color for text watermarks (CSS hex). */
  color: string;
}

/** Where a text overlay sits in the paint order, relative to the cell grid
 *  and the container clip. The four positions match the four user-facing
 *  options in the layers UI. */
export type TextLayerZ =
  | 'behind-container'
  | 'behind-cells'
  | 'in-front-of-cells'
  | 'in-front-of-container';

export interface TextLayer {
  id: string;
  text: string;
  font: string;
  /** Font size in design pixels. */
  size: number;
  color: string;
  /** Position fractions of the container (0..1). */
  x: number;
  y: number;
  /** Rotation in degrees. */
  rotation: number;
  /** Alpha multiplier (0..1). */
  opacity: number;
  weight: number;
  /** Anchor: 'left'|'center'|'right' relative to (x, y). */
  align: 'left' | 'center' | 'right';
  z: TextLayerZ;
}

export interface Container {
  shape: ShapeId;
  cornerRadius: number;
  aspect: string;
  bg: string;
  bgTransparent: boolean;
  /** Optional background image for the container (renders behind cell gaps). */
  bgImage: CellImageRef | null;
  bgImageFit: ContainerBgFit;
  /** Gaussian blur applied to the bg image (and bg color region) in design
   *  pixels. Useful for letting cell content pop against a soft backdrop.
   *  0 = no blur. */
  bgBlur?: number;
  /** Optional flat-color overlay layered between the bg (color + image) and
   *  the cells. Use a dark overlay with mid opacity to "darken" or a light
   *  one to "brighten" the backdrop without touching the cell pixels. */
  bgOverlayColor?: string;
  bgOverlayOpacity?: number;
  padding: number;
  gap: number;
  borderWidth: number;
  borderColor: string;
  /** Optional watermark composited over the rendered grid. Optional for
   *  back-compat — defaultState() always populates it. */
  watermark?: Watermark;
}

export interface GridConfig {
  cols: number;
  rows: number;
  /** Per-track size weights (fr-units). Length must match cols/rows when set;
   *  when omitted, every track is treated as 1fr. Edits via the resize handles
   *  redistribute weight between adjacent tracks so the container size never
   *  changes — only the surrounding cells' pixel widths/heights do. */
  colSizes?: number[];
  rowSizes?: number[];
}

export interface OutputConfig {
  format: FormatId;
  quality: number;
  scale: 1 | 2 | 3 | 4;
  baseSize: number;
  filename: string; // base name without extension
}

export interface CanvasConfig {
  zoom: number;
}

export interface PhotoGridState {
  container: Container;
  grid: GridConfig;
  cells: Cell[];
  /** Selected cells, in the order the user picked them. The first id is the
   *  "primary" — the one the inspector reads by default; merge uses its image
   *  as the surviving cell's content. Empty array = nothing selected. */
  selectedCellIds: string[];
  output: OutputConfig;
  canvas: CanvasConfig;
  /** Free-floating text overlays, paint order = array order within each
   *  z-band. Optional for back-compat with templates saved before this
   *  field existed. */
  textLayers?: TextLayer[];
  selectedTextLayerId?: string | null;
  /** True while the watermark is the active overlay focus — drives the
   *  on-canvas dashed outline and tells the inspector to land on the
   *  Container tab so the watermark controls are immediately visible. */
  selectedWatermark?: boolean;
}

export type Action =
  | { type: 'REPLACE'; state: PhotoGridState }
  | { type: 'SET_CONTAINER'; patch: Partial<Container> }
  | { type: 'SET_OUTPUT'; patch: Partial<OutputConfig> }
  | { type: 'SET_GRID'; patch: Partial<GridConfig> }
  | { type: 'APPLY_PRESET'; preset: LayoutPreset }
  | { type: 'ADD_CELL' }
  | { type: 'REMOVE_CELL'; id: string }
  | { type: 'UPDATE_CELL'; id: string; patch: Partial<Cell> }
  | { type: 'UPDATE_CELLS'; ids: string[]; patch: Partial<Cell> }
  | { type: 'MOVE_CELL'; id: string; col: number; row: number }
  | { type: 'MOVE_CELL_TO_CELL'; sourceId: string; targetId: string } // swaps positions of two cells
  | {
      type: 'RESIZE_CELL';
      id: string;
      colSpan: number;
      rowSpan: number;
      colStart?: number;
      rowStart?: number;
    }
  | { type: 'RESIZE_TRACKS'; colSizes?: number[]; rowSizes?: number[] }
  | {
      type: 'EDGE_RESIZE';
      updates: { id: string; dx?: number; dy?: number; dw?: number; dh?: number }[];
    }
  | { type: 'SWAP_CELLS'; aId: string; bId: string } // swaps images, not positions
  | { type: 'MOVE_CELL_TO_RECT'; id: string; colStart: number; rowStart: number; colSpan: number; rowSpan: number }
  | { type: 'SELECT'; id: string | null }
  | { type: 'SELECT_TOGGLE'; id: string }
  | { type: 'MERGE_CELLS'; ids: string[] }
  | { type: 'SYNC_CELLS_SHAPE'; ids: string[] }
  | { type: 'SPLIT_CELL'; id: string; axis: 'row' | 'col'; count: number }
  | { type: 'ALIGN_GRID' }
  | {
      type: 'GENERATE_RANDOM_LAYOUT';
      cellCount: number;
      squaresOnly?: boolean;
      /** Force a uniform NxM grid of equal cells. Implies squaresOnly visually
       *  (rect cells, no jitter). The picker chooses dimensions that match
       *  cellCount as closely as possible while keeping the cell aspect close
       *  to a square. */
      equal?: boolean;
      seed?: number;
    }
  | { type: 'SET_ZOOM'; zoom: number }
  | { type: 'FILL_FROM_FILES'; images: CellImageRef[] }
  | { type: 'FILL_EMPTY_NO_GROW'; images: CellImageRef[] }
  | { type: 'RESET' }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'SET_WATERMARK'; patch: Partial<Watermark> }
  | { type: 'SELECT_WATERMARK'; selected: boolean }
  | { type: 'ADD_TEXT_LAYER'; layer?: Partial<TextLayer> }
  | { type: 'UPDATE_TEXT_LAYER'; id: string; patch: Partial<TextLayer> }
  | { type: 'REMOVE_TEXT_LAYER'; id: string }
  | { type: 'SELECT_TEXT_LAYER'; id: string | null }
  | { type: 'REORDER_TEXT_LAYER'; id: string; direction: 'up' | 'down' };

export interface LayoutPreset {
  id: string;
  name: string;
  cols: number;
  rows: number;
  cells: { c: number; r: number; cs?: number; rs?: number }[];
}

export interface AspectRatio {
  id: string;
  label: string;
  w: number;
  h: number;
}
