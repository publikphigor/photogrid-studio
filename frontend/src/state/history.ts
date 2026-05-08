import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { Action, PhotoGridState } from '@/types';

type R = (state: PhotoGridState, action: Action) => PhotoGridState;

export interface HistoryFlags {
  canUndo: boolean;
  canRedo: boolean;
}

const EPHEMERAL: ReadonlySet<Action['type']> = new Set([
  'SELECT',
  'SET_ZOOM',
  'UNDO',
  'REDO',
]);

export function useHistoryReducer(
  reducer: R,
  initial: PhotoGridState,
): [PhotoGridState, (action: Action) => void, HistoryFlags] {
  const [state, dispatch] = useReducer(reducer, initial);
  const stack = useRef<{ past: PhotoGridState[]; future: PhotoGridState[] }>({ past: [], future: [] });
  const last = useRef(state);

  useEffect(() => {
    last.current = state;
  }, [state]);

  const wrapped = useCallback((action: Action) => {
    if (action.type === 'UNDO') {
      const s = stack.current;
      if (!s.past.length) return;
      const prev = s.past.pop()!;
      s.future.push(last.current);
      dispatch({ type: 'REPLACE', state: prev });
      return;
    }
    if (action.type === 'REDO') {
      const s = stack.current;
      if (!s.future.length) return;
      const next = s.future.pop()!;
      s.past.push(last.current);
      dispatch({ type: 'REPLACE', state: next });
      return;
    }
    if (EPHEMERAL.has(action.type)) {
      dispatch(action);
      return;
    }
    stack.current.past.push(last.current);
    if (stack.current.past.length > 60) stack.current.past.shift();
    stack.current.future = [];
    dispatch(action);
  }, []);

  return [state, wrapped, { canUndo: stack.current.past.length > 0, canRedo: stack.current.future.length > 0 }];
}
