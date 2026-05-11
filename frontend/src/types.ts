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

// Per-cell visual filters; 0 means no effect so renderer can skip when all default.
export interface CellFilters {
  grayscale: number;
  sepia: number;
  contrast: number;
  brightness: number;
  saturate: number;
  hueRotate: number;
  invert: number;
  blur: number;
}

export interface CellImageRef {
  hash: string;
  name: string;
  w: number;
  h: number;
  mime: string;
  // Local-only preview URL; never persisted or sent to backend.
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
  // Legacy CSS filter string kept so pre-structured-filter templates still load.
  filter: string;
  filters?: CellFilters;
  shape: ShapeId;
  cellRadius: number;
  cellBorder: number;
  cellBorderColor: string;
  // Per-cell pixel offsets from edge handles; corner handles use grid track sizes instead.
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
  text: string;
  font: string;
  weight: number;
  image: CellImageRef | null;
  x: number;
  y: number;
  sizePx: number;
  opacity: number;
  angle: number;
  color: string;
}

export type TextLayerZ =
  | 'behind-container'
  | 'behind-cells'
  | 'in-front-of-cells'
  | 'in-front-of-container';

export interface TextLayer {
  id: string;
  text: string;
  font: string;
  size: number;
  color: string;
  x: number;
  y: number;
  rotation: number;
  opacity: number;
  weight: number;
  align: 'left' | 'center' | 'right';
  z: TextLayerZ;
}

export interface Container {
  shape: ShapeId;
  cornerRadius: number;
  aspect: string;
  bg: string;
  bgTransparent: boolean;
  bgImage: CellImageRef | null;
  bgImageFit: ContainerBgFit;
  bgBlur?: number;
  bgOverlayColor?: string;
  bgOverlayOpacity?: number;
  padding: number;
  gap: number;
  borderWidth: number;
  borderColor: string;
  watermark?: Watermark;
}

export interface GridConfig {
  cols: number;
  rows: number;
  // fr-unit weights per track; omitted means uniform 1fr.
  colSizes?: number[];
  rowSizes?: number[];
}

export interface OutputConfig {
  format: FormatId;
  quality: number;
  scale: 1 | 2 | 3 | 4;
  baseSize: number;
  filename: string;
}

export interface CanvasConfig {
  zoom: number;
}

export interface PhotoGridState {
  container: Container;
  grid: GridConfig;
  cells: Cell[];
  // selectedCellIds[0] is the primary; inspector reads it and merge keeps its image.
  selectedCellIds: string[];
  output: OutputConfig;
  canvas: CanvasConfig;
  textLayers?: TextLayer[];
  selectedTextLayerId?: string | null;
  selectedWatermark?: boolean;
}

export type Action =
  | { type: 'REPLACE'; state: PhotoGridState }
  | { type: 'SET_CONTAINER'; patch: Partial<Container> }
  | { type: 'SET_OUTPUT'; patch: Partial<OutputConfig> }
  | { type: 'SET_GRID'; patch: Partial<GridConfig> }
  | { type: 'APPLY_PRESET'; preset: LayoutPreset }
  | { type: 'ADD_CELL' }
  | { type: 'DUPLICATE_CELL'; id: string }
  | { type: 'REMOVE_CELL'; id: string }
  | { type: 'UPDATE_CELL'; id: string; patch: Partial<Cell> }
  | { type: 'UPDATE_CELLS'; ids: string[]; patch: Partial<Cell> }
  | { type: 'MOVE_CELL'; id: string; col: number; row: number }
  | { type: 'MOVE_CELL_TO_CELL'; sourceId: string; targetId: string }
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
  | { type: 'SWAP_CELLS'; aId: string; bId: string }
  | { type: 'MOVE_CELL_TO_RECT'; id: string; colStart: number; rowStart: number; colSpan: number; rowSpan: number }
  | { type: 'SELECT'; id: string | null }
  | { type: 'SELECT_TOGGLE'; id: string }
  | { type: 'SELECT_RANGE'; id: string }
  | { type: 'MOVE_CELL_DROP'; id: string; col: number; row: number }
  | { type: 'MERGE_CELLS'; ids: string[] }
  | { type: 'SYNC_CELLS_SHAPE'; ids: string[] }
  | { type: 'SPLIT_CELL'; id: string; axis: 'row' | 'col'; count: number }
  | { type: 'ALIGN_GRID' }
  | {
      type: 'GENERATE_RANDOM_LAYOUT';
      cellCount: number;
      squaresOnly?: boolean;
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
