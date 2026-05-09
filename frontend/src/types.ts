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
  | { type: 'SET_ZOOM'; zoom: number }
  | { type: 'FILL_FROM_FILES'; images: CellImageRef[] }
  | { type: 'FILL_EMPTY_NO_GROW'; images: CellImageRef[] }
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
