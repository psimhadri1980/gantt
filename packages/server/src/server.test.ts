import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { RoadmapService, httpBackend, BackendError } from '@gantt/service';
import type { AccessRules } from '@gantt/access';
import { loadMock } from '../../mock/src/index.ts';
import small from '../../mock/src/samples/small.json';
import roles from '../../mock/src/samples/roles.json';
import { createGanttServer, readEnv } from './index.ts';

describe('readEnv (section 4)', () => {
  it('uses the safe default for missing or unrecognised values', () => {
    for (const v of [undefined, '', 'yes', 'FALSE ', 'no']) {
      const r = readEnv({ GANTT_ENFORCE_SEPARATION_OF_DUTIES: v === 'FALSE ' ? 'nope' : v, GANTT_ENABLE_MOCK_DATA: v });
      expect(r.ok && r.env).toMatchObject({ separationOfDuties: true, mockData: false });
    }
    expect(readEnv({ GANTT_ENFORCE_SEPARATION_OF_DUTIES: 'false', GANTT_ENABLE_MOCK_DATA: 'true' })).toMatchObject({ ok: true, env: { separationOfDuties: false, mockData: true } });
  });
  it('refuses relaxed separation of duties and mock data in production', () => {
    expect(readEnv({ GANTT_ENVIRONMENT: 'production', GANTT_ENFORCE_SEPARATION_OF_DUTIES: 'false' })).toMatchObject({ ok: false });
    expect(readEnv({ GANTT_ENVIRONMENT: 'production', GANTT_ENABLE_MOCK_DATA: 'true' })).toMatchObject({ ok: true, env: { mockData: false } });
  });
});

describe('reference server over HTTP', () => {
  const doc = (() => { const r = loadMock(small); if (!r.ok) throw new Error('bad'); return r.doc; })();
  const service = new RoadmapService({ current: doc, rulesFor: (u) => (roles as Record<string, AccessRules>)[u] ?? null, separationOfDuties: true });
  const server = createGanttServer(service);
  let base = '';
  beforeAll(() => new Promise<void>((r) => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; r(); })));
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  const as = (u: string) => httpBackend(base, u);
  const refusal = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return `${(e as BackendError).code}: ${(e as Error).message}`; } };

  it('runs the lifecycle across users, and only Approve changes Current', async () => {
    const p = await as('alice').change(null, [{ entity: 'task', op: 'update', id: 't3', fields: { progress: 0.9 } }], 'Speed up review');
    expect((await as('erin').snapshot()).current!.tasks.find((t) => t.id === 't3')!.progress).toBe(0.2);
    await as('alice').act(p.id, 'submit');
    expect(await refusal(as('alice').act(p.id, 'approve'))).toBe('denied: Missing permission: proposal.approve');
    await as('bob').act(p.id, 'review');
    await as('carol').act(p.id, 'approve');
    const snap = await as('erin').snapshot();
    expect(snap.version).toBe(13);
    expect(snap.current!.tasks.find((t) => t.id === 't3')!.progress).toBe(0.9);
  });
  it('filters data per user and sends nothing without view (L6, L12)', async () => {
    expect(await refusal(as('mallory').snapshot())).toMatch(/^noAccess/);
    expect(await refusal(as('nobody-at-all').snapshot())).toMatch(/^noAccess/);
    const erin = await as('erin').snapshot();
    expect(erin.current!.tasks.some((t) => t.kind === 'crew')).toBe(false);
    const dave = await as('dave').snapshot();
    expect(dave.current!.tasks.find((t) => t.id === 't2')).not.toHaveProperty('deadline');
  });
  it('enforces field-level permissions on the API, not only in the interface', async () => {
    expect(await refusal(as('dave').change(null, [{ entity: 'task', op: 'update', id: 't7', fields: { start: '2026-11-20' } }]))).toBe('denied: Missing permission: task.modify.dates for the field “start”');
    expect(await refusal(as('dave').change(null, [{ entity: 'task', op: 'update', id: 't7', fields: { progress: 0.3 } }]))).toBe('ok');
  });
});
