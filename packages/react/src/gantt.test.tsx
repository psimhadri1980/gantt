// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Gantt } from './index.ts';
import type { RoadmapDocument } from '@gantt/contract';
import { fullAccess } from '@gantt/access';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollTo ??= function () {} as typeof Element.prototype.scrollTo;
globalThis.ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} } as unknown as typeof ResizeObserver;

const base: RoadmapDocument = {
  contract: 'gantt-roadmap/1', roadmap: { id: 'r', name: 'R', version: 1, timeZone: 'UTC', start: '2026-11-02' },
  tasks: [{ id: 'a', name: 'Alpha', type: 'task', parent: null, start: '2026-11-02', duration: 3 }], links: [],
  access: fullAccess('tester') as RoadmapDocument['access'],
};
const mounted: (() => void)[] = [];
afterEach(async () => { for (const u of mounted.splice(0)) await act(async () => u()); });
async function render(el: React.ReactElement) {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push(() => { root.unmount(); host.remove(); });
  await act(async () => { root.render(el); });
  for (let i = 0; i < 10; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  return host;
}

describe('Gantt states (F13)', () => {
  it('shows the error state with a retry when the roadmap cannot be prepared', async () => {
    const broken = { ...base, roadmap: { ...base.roadmap, defaultCalendar: 'c' }, calendars: [{ id: 'c', name: 'C', workingDays: [] }] };
    const host = await render(<Gantt data={broken} />);
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('The roadmap could not be shown');
    expect(alert?.textContent).toContain('no working days');
    expect(alert?.querySelector('button')?.textContent).toBe('Try again');
  });
  it('shows the save indicator and translated text', async () => {
    const host = await render(<Gantt data={base} saveState={{ status: 'error', reason: 'offline' }} messages={{ notSaved: (r) => `Nicht gespeichert: ${r}`, today: 'Heute' }} />);
    expect(host.querySelector('.gx-save')?.textContent).toBe('Nicht gespeichert: offline');
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Heute')).toBe(true);
  });
  it('refuses data operations in read-only mode with a reason', async () => {
    const ref = { current: null as null | import('./index.ts').GanttHandle };
    await render(<Gantt ref={(h) => { ref.current = h; }} data={base} readOnly />);
    const r = await ref.current!.run({ type: 'task.update', id: 'a', fields: { name: 'X' } });
    expect(r).toMatchObject({ ok: false, reason: 'The chart is read-only' });
    expect((await ref.current!.run({ type: 'zoom.set', zoom: 'day' })).ok).toBe(true);
  });
});

describe('configuration (G1, G2)', () => {
  it('offers the host zoom levels and row height', async () => {
    const host = await render(<Gantt data={base} rowHeight={48}
      zoomLevels={[{ id: 'sprint', label: 'Sprints', pxPerDay: 6, major: 'quarter', minor: 'week' }, { id: 'day', label: 'Days', pxPerDay: 40, major: 'month', minor: 'day' }]} />);
    const radios = [...host.querySelectorAll('[role="radio"]')].map((b) => b.textContent);
    expect(radios).toEqual(['Sprints', 'Days']);
    expect((host.querySelector('.gx-grid-body [role="row"]') as HTMLElement).style.height).toBe('48px');
  });
});
