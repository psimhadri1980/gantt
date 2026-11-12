// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Gantt, memoryBackend, type GanttHandle } from './index.ts';
import { RoadmapService } from '@gantt/service';
import type { AccessRules } from '@gantt/access';
import type { RoadmapDocument } from '@gantt/contract';
import roles from '../../mock/src/samples/roles.json';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollTo ??= function () {} as typeof Element.prototype.scrollTo;
globalThis.ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} } as unknown as typeof ResizeObserver;

const doc: RoadmapDocument = {
  contract: 'gantt-roadmap/1', roadmap: { id: 'r1', name: 'R', version: 1, timeZone: 'UTC', start: '2026-11-02' },
  tasks: [
    { id: 'a', name: 'Alpha', type: 'task', parent: null, start: '2026-11-02', duration: 3, owner: 'alice' },
    { id: 'b', name: 'Beta', type: 'task', parent: null, start: '2026-11-09', duration: 2 },
  ],
  links: [],
};
const rules = roles as Record<string, AccessRules>;
const settle = async () => { for (let i = 0; i < 12; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
const roots: Root[] = [];
afterEach(async () => { for (const r of roots.splice(0)) await act(async () => r.unmount()); document.body.innerHTML = ''; });
async function mount(el: React.ReactElement) {
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host); roots.push(root);
  await act(async () => root.render(el)); await settle();
  return { host, rerender: async (e: React.ReactElement) => { await act(async () => root.render(e)); await settle(); } };
}
const service = (sod = true) => new RoadmapService({ current: doc, rulesFor: (u) => rules[u] ?? null, separationOfDuties: sod });
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith(text));

describe('access (Phase 2)', () => {
  it('renders nothing and fetches nothing without configuration or without view (L6, L8)', async () => {
    const svc = service();
    const be = memoryBackend(svc, 'alice');
    const spy = vi.spyOn(be, 'snapshot');
    const none = await mount(<Gantt backend={be} />);
    expect(none.host.textContent).toContain('You do not have access to this roadmap.');
    const noView = await mount(<Gantt backend={be} access={rules.mallory} />);
    expect(noView.host.textContent).toContain('You do not have access');
    expect(spy).not.toHaveBeenCalled();
    const data = await mount(<Gantt data={{ ...doc, access: undefined }} />);
    expect(data.host.textContent).toContain('You do not have access');
  });
  it('updates at runtime when the configuration changes, without reload (L3)', async () => {
    const m = await mount(<Gantt data={doc} access={rules.mallory} />);
    expect(m.host.textContent).toContain('You do not have access');
    await m.rerender(<Gantt data={doc} access={rules.erin} />);
    expect(m.host.querySelector('[role="treegrid"]')).not.toBeNull();
  });
  it('takes the resolver result over static rules (L11)', async () => {
    const m = await mount(<Gantt data={doc} access={rules.mallory} resolveAccess={async () => ({ rules: rules.erin!.rules })} />);
    expect(m.host.querySelector('[role="treegrid"]')).not.toBeNull();
  });
  it('refuses a forbidden change through the interface and reports it (L5, L7)', async () => {
    const denied: string[] = [];
    let handle: GanttHandle | null = null;
    await mount(<Gantt ref={(h) => { handle = h; }} data={doc} access={rules.dave} onAccessDenied={(e) => denied.push(e.reason)} />);
    const r = await handle!.run({ type: 'task.update', id: 'a', fields: { start: '2026-11-03' } });
    expect(r).toMatchObject({ ok: false, stage: 'authorization', reason: 'Missing permission: task.modify.dates for the field “start”' });
    expect(denied).toEqual(['Missing permission: task.modify.dates for the field “start”']);
    expect((await handle!.run({ type: 'task.update', id: 'a', fields: { progress: 0.5 } })).ok).toBe(true);
  });
  it('explains a field the user may not edit instead of offering an input (F14)', async () => {
    const m = await mount(<Gantt data={doc} access={rules.dave} />);
    await act(async () => { (m.host.querySelector('[role="row"][aria-rowindex="2"]') as HTMLElement).click(); });
    await settle();
    const details = m.host.querySelector('.gx-details')!;
    expect(details.querySelector('input[type="number"][max="100"]')).not.toBeNull(); // progress is editable
    expect(details.querySelector('input[type="date"]')).toBeNull(); // start is not
    expect(details.querySelector('[title="Missing permission: task.modify.dates for the field “start”"]')).not.toBeNull();
  });
});

describe('Proposals (Phase 3)', () => {
  it('an edit on Current creates a Proposal; Current changes only when approved (K0, K0c, K5)', async () => {
    const svc = service();
    let handle: GanttHandle | null = null;
    const created: string[] = [];
    const m = await mount(<Gantt ref={(h) => { handle = h; }} backend={memoryBackend(svc, 'alice')} access={rules.alice} onProposalCreated={(e) => created.push(e.proposal.id)} />);
    expect(m.host.querySelector('select')!.value).toBe('current');
    await act(async () => { await handle!.run({ type: 'task.update', id: 'a', fields: { name: 'Alpha 2' } }); });
    await settle();
    expect(created).toHaveLength(1);
    expect(m.host.querySelector('select')!.value).toBe(`p:${created[0]}`);
    expect(svc.snapshot('erin').current!.tasks[0]!.name).toBe('Alpha');
    expect(m.host.querySelector('.gx-save')!.textContent).toBe('Saved');
    // Submit from the bar; alice cannot approve (no permission); carol approves.
    await act(async () => { button(m.host, 'Submit')!.click(); }); await settle();
    expect(svc.snapshot('alice').proposals[0]!.state).toBe('Submitted');
    svc.act('carol', created[0]!, 'approve');
    expect(svc.snapshot('erin').current!.tasks[0]!.name).toBe('Alpha 2');
  });
  it('a locked Proposal refuses edits, with the reason (K21)', async () => {
    const svc = service();
    const p = svc.change('alice', null, [{ entity: 'task', op: 'update', id: 'a', fields: { progress: 0.5 } }]);
    svc.act('alice', p.id, 'submit');
    let handle: GanttHandle | null = null;
    const m = await mount(<Gantt ref={(h) => { handle = h; }} backend={memoryBackend(svc, 'alice')} access={rules.alice} />);
    await act(async () => { const sel = m.host.querySelector('select')!; sel.value = `p:${p.id}`; sel.dispatchEvent(new Event('change', { bubbles: true })); });
    await settle();
    const r = await handle!.run({ type: 'task.update', id: 'a', fields: { progress: 0.9 } });
    expect(r).toMatchObject({ ok: false, reason: 'The Proposal is locked for review; withdraw it to make changes' });
  });
  it('the submitter is refused approval with the reason when separation of duties is enforced (K2a, K2b)', async () => {
    const svc = service(true);
    const p = svc.change('frank', null, [{ entity: 'task', op: 'update', id: 'a', fields: { progress: 0.5 } }]);
    svc.act('frank', p.id, 'submit');
    const m = await mount(<Gantt backend={memoryBackend(svc, 'frank')} access={rules.frank} />);
    await act(async () => { const sel = m.host.querySelector('select')!; sel.value = `p:${p.id}`; sel.dispatchEvent(new Event('change', { bubbles: true })); });
    await settle();
    const approve = button(m.host, 'Approve')!;
    expect(approve.getAttribute('aria-disabled')).toBe('true');
    expect(approve.title).toMatch(/You submitted this Proposal/);
    const relaxed = service(false);
    const q = relaxed.change('frank', null, [{ entity: 'task', op: 'update', id: 'a', fields: { progress: 0.5 } }]);
    relaxed.act('frank', q.id, 'submit');
    expect(() => relaxed.act('frank', q.id, 'approve')).not.toThrow();
  });
  it('rolls back an edit the backend refuses and reports it (H7)', async () => {
    const svc = service();
    const be = memoryBackend(svc, 'alice');
    be.change = async () => { throw Object.assign(new Error('the server said no'), { code: 'denied' }); };
    const failed: string[] = [];
    let handle: GanttHandle | null = null;
    const m = await mount(<Gantt ref={(h) => { handle = h; }} backend={be} access={rules.alice} onOperationFailed={(e) => failed.push(e.reason)} />);
    await act(async () => { await handle!.run({ type: 'task.update', id: 'a', fields: { name: 'Nope' } }); });
    await settle();
    expect(failed).toEqual(['the server said no']);
    expect(m.host.querySelector('.gx-save')!.textContent).toBe('Not saved: the server said no');
    expect(handle!.getData().tasks[0]!.name).toBe('Alpha');
  });
});
