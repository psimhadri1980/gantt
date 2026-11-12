/**
 * State-management examples (J3). The Gantt is a controlled component: the host owns the roadmap document,
 * passes it as `data`, and stores each new version the Gantt reports through `onDataChanged`. Every pattern
 * below is that same loop; only where the document lives differs. Each one is exercised by state.test.tsx.
 */
import { forwardRef, useReducer, useState, useSyncExternalStore } from 'react';
import { Gantt, type GanttHandle } from '@gantt/react';
import type { RoadmapDocument } from '@gantt/contract';

/** 1. Local component state: the simplest host. Good when only this screen uses the roadmap. */
export const LocalStateExample = forwardRef<GanttHandle, { initial: RoadmapDocument }>(function LocalStateExample({ initial }, ref) {
  const [doc, setDoc] = useState(initial);
  return <Gantt ref={ref} data={doc} onDataChanged={(next) => setDoc(next)} height={400} />;
});

/**
 * 2. A reducer: the Gantt's change becomes one action among the screen's others (selection, filters, …).
 * The same reducer works unchanged as a Redux Toolkit slice reducer: dispatch `{ type: 'gantt/changed', doc }`.
 */
export type RoadmapAction = { type: 'gantt/changed'; doc: RoadmapDocument } | { type: 'roadmap/renamed'; name: string };
export function roadmapReducer(state: RoadmapDocument, action: RoadmapAction): RoadmapDocument {
  switch (action.type) {
    case 'gantt/changed': return action.doc;
    case 'roadmap/renamed': return { ...state, roadmap: { ...state.roadmap, name: action.name } };
  }
}
export const ReducerExample = forwardRef<GanttHandle, { initial: RoadmapDocument }>(function ReducerExample({ initial }, ref) {
  const [doc, dispatch] = useReducer(roadmapReducer, initial);
  return <Gantt ref={ref} data={doc} onDataChanged={(next) => dispatch({ type: 'gantt/changed', doc: next })} height={400} />;
});

/**
 * 3. An external store shared by several components, read with React's useSyncExternalStore. This is the
 * shape Zustand and Redux stores have (getState, subscribe, set/dispatch), so either can replace `createStore`.
 */
export interface Store<T> { getState(): T; setState(next: T): void; subscribe(listener: () => void): () => void }
export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    setState: (next) => { if (next === state) return; state = next; for (const l of [...listeners]) l(); },
    subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
  };
}
export const StoreExample = forwardRef<GanttHandle, { store: Store<RoadmapDocument> }>(function StoreExample({ store }, ref) {
  const doc = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return <Gantt ref={ref} data={doc} onDataChanged={(next) => store.setState(next)} height={400} />;
});
