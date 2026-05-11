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

// Drag-streaks within COALESCE_WINDOW_MS collapse into one undo step.
const COALESCING: ReadonlySet<Action['type']> = new Set([
  'EDGE_RESIZE',
  'RESIZE_TRACKS',
]);
const COALESCE_WINDOW_MS = 600;

export function useHistoryReducer(
  reducer: R,
  initial: PhotoGridState,
): [PhotoGridState, (action: Action) => void, HistoryFlags] {
  const [state, dispatch] = useReducer(reducer, initial);
  const stack = useRef<{ past: PhotoGridState[]; future: PhotoGridState[] }>({ past: [], future: [] });
  const last = useRef(state);
  const coalesce = useRef<{ type: Action['type'] | null; at: number }>({ type: null, at: 0 });

  useEffect(() => {
    last.current = state;
  }, [state]);

  const wrapped = useCallback((action: Action) => {
    if (action.type === 'UNDO') {
      const s = stack.current;
      if (!s.past.length) return;
      const prev = s.past.pop()!;
      s.future.push(last.current);
      coalesce.current = { type: null, at: 0 };
      dispatch({ type: 'REPLACE', state: prev });
      return;
    }
    if (action.type === 'REDO') {
      const s = stack.current;
      if (!s.future.length) return;
      const next = s.future.pop()!;
      s.past.push(last.current);
      coalesce.current = { type: null, at: 0 };
      dispatch({ type: 'REPLACE', state: next });
      return;
    }
    if (EPHEMERAL.has(action.type)) {
      dispatch(action);
      return;
    }
    const now = Date.now();
    const c = coalesce.current;
    const shouldCoalesce =
      COALESCING.has(action.type) &&
      c.type === action.type &&
      now - c.at < COALESCE_WINDOW_MS;
    if (!shouldCoalesce) {
      stack.current.past.push(last.current);
      if (stack.current.past.length > 60) stack.current.past.shift();
      stack.current.future = [];
    }
    coalesce.current = {
      type: COALESCING.has(action.type) ? action.type : null,
      at: now,
    };
    dispatch(action);
  }, []);

  return [state, wrapped, { canUndo: stack.current.past.length > 0, canRedo: stack.current.future.length > 0 }];
}
