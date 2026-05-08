import { useEffect, useState } from 'react';
import type { Action, PhotoGridState } from '@/types';
import { ContainerTab } from './ContainerTab';
import { CellTab } from './CellTab';
import { OutputTab } from './OutputTab';

type TabId = 'container' | 'cell' | 'output';

interface Props {
  state: PhotoGridState;
  dispatch: (a: Action) => void;
  exportInfo: { lastSize?: number; rendererName?: string; elapsedMs?: number };
}

export function Inspector({ state, dispatch, exportInfo }: Props) {
  const [tab, setTab] = useState<TabId>('container');
  const selected = state.cells.find((c) => c.id === state.selectedCellId);

  useEffect(() => {
    if (selected && tab === 'container') setTab('cell');
    if (!selected && tab === 'cell') setTab('container');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedCellId]);

  return (
    <div className="pane right border-l border-line">
      <div className="tabs">
        <button className={`tab${tab === 'container' ? ' active' : ''}`} onClick={() => setTab('container')}>
          Container
        </button>
        <button className={`tab${tab === 'cell' ? ' active' : ''}`} onClick={() => setTab('cell')}>
          Cell
        </button>
        <button className={`tab${tab === 'output' ? ' active' : ''}`} onClick={() => setTab('output')}>
          Output
        </button>
      </div>
      <div className="pane-body">
        {tab === 'container' && <ContainerTab state={state} dispatch={dispatch} />}
        {tab === 'cell' && <CellTab state={state} dispatch={dispatch} />}
        {tab === 'output' && <OutputTab state={state} dispatch={dispatch} exportInfo={exportInfo} />}
      </div>
    </div>
  );
}
