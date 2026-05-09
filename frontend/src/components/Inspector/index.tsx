import { useEffect, useState } from 'react';
import type { Action, PhotoGridState } from '@/types';
import { ContainerTab } from './ContainerTab';
import { CellTab } from './CellTab';
import { CanvasTab } from './CanvasTab';
import { OutputTab } from './OutputTab';

type TabId = 'container' | 'cell' | 'canvas' | 'output';

interface Props {
  state: PhotoGridState;
  dispatch: (a: Action) => void;
  exportInfo: { lastSize?: number; rendererName?: string; elapsedMs?: number };
}

export function Inspector({ state, dispatch, exportInfo }: Props) {
  const [tab, setTab] = useState<TabId>('container');
  const primaryId = state.selectedCellIds[0] ?? null;
  const selected = state.cells.find((c) => c.id === primaryId);

  useEffect(() => {
    if (selected && tab === 'container') setTab('cell');
    if (!selected && tab === 'cell') setTab('container');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryId]);

  // Picking a text layer pivots the inspector to the Canvas tab so the user
  // doesn't have to chase the controls down.
  useEffect(() => {
    if (state.selectedTextLayerId) setTab('canvas');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedTextLayerId]);

  // Picking the watermark pivots to the Container tab — the watermark UI
  // lives in that section.
  useEffect(() => {
    if (state.selectedWatermark) setTab('container');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedWatermark]);

  return (
    <div className="pane right border-l border-line">
      <div className="tabs">
        <button className={`tab${tab === 'container' ? ' active' : ''}`} onClick={() => setTab('container')}>
          Container
        </button>
        <button className={`tab${tab === 'cell' ? ' active' : ''}`} onClick={() => setTab('cell')}>
          Cell
        </button>
        <button className={`tab${tab === 'canvas' ? ' active' : ''}`} onClick={() => setTab('canvas')}>
          Canvas
        </button>
        <button className={`tab${tab === 'output' ? ' active' : ''}`} onClick={() => setTab('output')}>
          Output
        </button>
      </div>
      <div className="pane-body">
        {tab === 'container' && <ContainerTab state={state} dispatch={dispatch} />}
        {tab === 'cell' && <CellTab state={state} dispatch={dispatch} />}
        {tab === 'canvas' && <CanvasTab state={state} dispatch={dispatch} />}
        {tab === 'output' && <OutputTab state={state} dispatch={dispatch} exportInfo={exportInfo} />}
      </div>
    </div>
  );
}
