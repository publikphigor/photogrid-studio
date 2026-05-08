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
  | 'heart';

export type FitMode = 'cover' | 'contain' | 'fill';
export type FormatId = 'png' | 'jpg' | 'webp';

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
  filter: string;
  shape: ShapeId; // per-cell shape, defaults to 'rect'
  cellRadius: number;
  cellBorder: number;
  cellBorderColor: string;
}

export type ContainerBgFit = 'cover' | 'contain' | 'fill';

export interface Container {
  shape: ShapeId;
  cornerRadius: number;
  aspect: string;
  bg: string;
  bgTransparent: boolean;
  /** Optional background image for the container (renders behind cell gaps). */
  bgImage: CellImageRef | null;
  bgImageFit: ContainerBgFit;
  padding: number;
  gap: number;
  borderWidth: number;
  borderColor: string;
}

export interface GridConfig {
  cols: number;
  rows: number;
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
  selectedCellId: string | null;
  output: OutputConfig;
  canvas: CanvasConfig;
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
  | { type: 'SWAP_CELLS'; aId: string; bId: string } // swaps images, not positions
  | { type: 'SELECT'; id: string | null }
  | { type: 'SET_ZOOM'; zoom: number }
  | { type: 'FILL_FROM_FILES'; images: CellImageRef[] }
  | { type: 'RESET' }
  | { type: 'UNDO' }
  | { type: 'REDO' };

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
