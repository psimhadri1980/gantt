import type { RoadmapDocument } from '@gantt/contract';
import type { LifecycleAction, RefreshChoice } from '@gantt/proposals';
import { ServiceError, type ChangeInput, type Concurrency, type ProposalSummary, type RefreshPreview, type RoadmapService, type ServiceEvent, type Snapshot } from './service.ts';

/**
 * How the Gantt talks to whatever holds the roadmap (H4). Every method may refuse with a BackendError,
 * whose message is shown to the user and whose code tells the component how to react.
 */
export interface GanttBackend {
  readonly userId: string;
  snapshot(): Promise<Snapshot>;
  proposalDocument(id: string): Promise<RoadmapDocument>;
  versionDocument(version: number): Promise<RoadmapDocument>;
  change(proposalId: string | null, changes: ChangeInput[], name?: string): Promise<ProposalSummary>;
  act(id: string, action: LifecycleAction, reason?: string): Promise<ProposalSummary>;
  newFrom(id: string): Promise<ProposalSummary>;
  /** Concurrent changes and overlaps with parallel Proposals (K7, K8). */
  concurrency(id: string): Promise<Concurrency>;
  /** Keep one user's version of a task changed concurrently (K9). */
  pick(id: string, taskId: string, keep: string): Promise<ProposalSummary>;
  /** What a refresh onto the newest Current would do (K17). */
  refreshPreview(id: string, choices: Record<string, RefreshChoice>): Promise<RefreshPreview>;
  refresh(id: string, choices: Record<string, RefreshChoice>): Promise<ProposalSummary>;
  undoRefresh(id: string): Promise<ProposalSummary>;
  /** Saves a baseline of Current (B1); needs `baseline.save`. */
  saveBaseline(name: string, version?: number): Promise<{ id: string; name: string; version: number }>;
  /** Live events (proposalStale etc.). Returns an unsubscribe function. */
  subscribe(fn: (e: ServiceEvent) => void): () => void;
}

export class BackendError extends Error {
  constructor(message: string, readonly code: ServiceError['code'] | 'network') { super(message); }
}

const wrap = async <T>(fn: () => T): Promise<T> => {
  try { return await fn(); } catch (e) {
    if (e instanceof ServiceError) throw new BackendError(e.message, e.code);
    throw e;
  }
};

/** The service in the same page: mock mode (M7). Each call is a microtask, like a network round trip. */
export function memoryBackend(service: RoadmapService, userId: string): GanttBackend {
  return {
    userId,
    snapshot: () => wrap(() => service.snapshot(userId)),
    proposalDocument: (id) => wrap(() => service.proposalDocument(userId, id)),
    versionDocument: (v) => wrap(() => service.versionDocument(userId, v)),
    change: (id, c, name) => wrap(() => service.change(userId, id, c, name)),
    act: (id, a, reason) => wrap(() => service.act(userId, id, a, reason)),
    newFrom: (id) => wrap(() => service.newFrom(userId, id)),
    concurrency: (id) => wrap(() => service.concurrency(userId, id)),
    pick: (id, taskId, keep) => wrap(() => service.pick(userId, id, taskId, keep)),
    refreshPreview: (id, choices) => wrap(() => service.refreshPreview(userId, id, choices)),
    refresh: (id, choices) => wrap(() => service.refresh(userId, id, choices)),
    undoRefresh: (id) => wrap(() => service.undoRefresh(userId, id)),
    saveBaseline: (name, version) => wrap(() => service.saveBaseline(userId, name, version)),
    subscribe: (fn) => service.subscribeFor(userId, fn),
  };
}

/** The reference server over HTTP, with server-sent events for live updates. */
export function httpBackend(baseUrl: string, userId: string, fetchImpl: typeof fetch = fetch): GanttBackend {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, { method, headers: { 'content-type': 'application/json', 'x-gantt-user': userId }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) { throw new BackendError(`The server could not be reached (${(e as Error).message})`, 'network'); }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new BackendError(json.error ?? res.statusText, json.code ?? 'invalid');
    return json as T;
  };
  return {
    userId,
    snapshot: () => call('GET', '/roadmap'),
    proposalDocument: (id) => call('GET', `/proposals/${encodeURIComponent(id)}/document`),
    versionDocument: (v) => call('GET', `/versions/${v}`),
    change: (id, changes, name) => call('POST', id ? `/proposals/${encodeURIComponent(id)}/changes` : '/proposals', { changes, name }),
    act: (id, action, reason) => call('POST', `/proposals/${encodeURIComponent(id)}/${action}`, { reason }),
    newFrom: (id) => call('POST', `/proposals/${encodeURIComponent(id)}/new-from`, {}),
    concurrency: (id) => call('GET', `/proposals/${encodeURIComponent(id)}/concurrency`),
    pick: (id, taskId, keep) => call('POST', `/proposals/${encodeURIComponent(id)}/pick`, { taskId, keep }),
    refreshPreview: (id, choices) => call('POST', `/proposals/${encodeURIComponent(id)}/refresh-preview`, { choices }),
    refresh: (id, choices) => call('POST', `/proposals/${encodeURIComponent(id)}/refresh`, { choices }),
    undoRefresh: (id) => call('POST', `/proposals/${encodeURIComponent(id)}/undo-refresh`, {}),
    saveBaseline: (name, version) => call('POST', '/baselines', { name, version }),
    subscribe: (fn) => {
      if (typeof EventSource === 'undefined') return () => {};
      const es = new EventSource(`${baseUrl}/events?user=${encodeURIComponent(userId)}`);
      es.onmessage = (m) => { try { fn(JSON.parse(m.data)); } catch { /* ignore malformed */ } };
      return () => es.close();
    },
  };
}
