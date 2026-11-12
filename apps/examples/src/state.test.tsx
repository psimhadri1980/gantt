// @vitest-environment jsdom
// Each state-management example (J3) keeps the roadmap outside the Gantt: an edit made in the Gantt must reach
// the host's state, and a change made in the host's state must reach the Gantt.
import { afterEach, describe, expect, it } from 'vitest';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import type { GanttHandle } from '@gantt/react';
import type { RoadmapDocument } from '@gantt/contract';
import { fullAccess } from '@gantt/access';
import { createStore, LocalStateExample, ReducerExample, roadmapReducer, StoreExample } from './state.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollTo ??= function () {} as typeof Element.prototype.scrollTo;
globalThis.ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} } as unknown as typeof ResizeObserver;

const initial: RoadmapDocument = {
  contract: 'gantt-roadmap/1', roadmap: { id: 'r', name: 'R', version: 1, timeZone: 'UTC', start: '2026-11-02' },
  tasks: [{ id: 'a', name: 'Alpha', type: 'task', parent: null, start: '2026-11-02', duration: 3 }], links: [],
  access: fullAccess('tester') as RoadmapDocument['access'],
};
const cleanups: (() => void)[] = [];
afterEach(async () => { for (const c of cleanups.splice(0)) await act(async () => c()); });
const settle = async () => { for (let i = 0; i < 10; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
async function mount(el: React.ReactElement) {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  cleanups.push(() => { root.unmount(); host.remove(); });
  await act(async () => { root.render(el); });
  await settle();
  return host;
}
const rename = async (ref: React.RefObject<GanttHandle | null>) => {
  await act(async () => { await ref.current!.run({ type: 'task.update', id: 'a', fields: { name: 'Beta' } }); });
  await settle();
};

describe('state-management examples (J3)', () => {
  it('local state keeps the edited roadmap', async () => {
    const ref = createRef<GanttHandle>();
    const host = await mount(<LocalStateExample ref={ref} initial={initial} />);
    await rename(ref);
    expect(host.textContent).toContain('Beta');
  });

  it('a reducer receives the change as an action', async () => {
    expect(roadmapReducer(initial, { type: 'roadmap/renamed', name: 'X' }).roadmap.name).toBe('X');
    const ref = createRef<GanttHandle>();
    const host = await mount(<ReducerExample ref={ref} initial={initial} />);
    await rename(ref);
    expect(host.textContent).toContain('Beta');
  });

  it('an external store is updated by the Gantt, and the Gantt follows the store', async () => {
    const store = createStore(initial);
    const ref = createRef<GanttHandle>();
    const host = await mount(<StoreExample ref={ref} store={store} />);
    await rename(ref);
    expect(store.getState().tasks[0]!.name).toBe('Beta');
    // A change made elsewhere in the app (another component, a server push) shows in the Gantt.
    await act(async () => { store.setState({ ...store.getState(), tasks: [{ ...store.getState().tasks[0]!, name: 'Gamma' }] }); });
    await settle();
    expect(host.textContent).toContain('Gamma');
  });
});
