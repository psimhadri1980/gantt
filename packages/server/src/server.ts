import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { BackendError, ServiceError, type RoadmapService } from '@gantt/service';
import type { LifecycleAction } from '@gantt/proposals';

const ACTIONS = new Set<LifecycleAction>(['submit', 'withdraw', 'review', 'approve', 'return', 'reject', 'discard']);
const STATUS: Record<string, number> = { noAccess: 403, denied: 403, notFound: 404, invalid: 422, conflict: 409 };

/**
 * Reference server (Phase 2 and 3): every request is evaluated against the same rules the component uses,
 * and every response is filtered for the user (L9, L12). The user comes from the `x-gantt-user` header;
 * authentication is the host's job, so put this behind your own sign-in.
 */
export function createGanttServer(service: RoadmapService, opts: { allowOrigin?: string } = {}): Server {
  return createServer(async (req, res) => {
    cors(res, opts.allowOrigin);
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    const url = new URL(req.url ?? '/', 'http://local');
    const user = (req.headers['x-gantt-user'] as string | undefined) ?? url.searchParams.get('user') ?? '';
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    try {
      if (!user) throw new ServiceError('No user', 'noAccess');
      if (req.method === 'GET' && parts[0] === 'config') return send(res, 200, service.config);
      if (req.method === 'GET' && parts[0] === 'roadmap') return send(res, 200, service.snapshot(user));
      if (req.method === 'GET' && parts[0] === 'versions' && parts[1]) return send(res, 200, service.versionDocument(user, Number(parts[1])));
      if (req.method === 'GET' && parts[0] === 'events') return events(req, res, service, user);
      if (req.method === 'GET' && parts[0] === 'proposals' && parts[2] === 'document') return send(res, 200, service.proposalDocument(user, parts[1]!));
      if (req.method === 'GET' && parts[0] === 'proposals' && parts[2] === 'concurrency') return send(res, 200, service.concurrency(user, parts[1]!));
      if (req.method === 'POST' && parts[0] === 'versions' && parts[2] === 'restore') return send(res, 201, service.restoreVersion(user, Number(parts[1])));
      if (req.method === 'POST' && parts[0] === 'baselines') { const body = await readJson(req); return send(res, 201, service.saveBaseline(user, String(body.name ?? ''), body.version === undefined ? undefined : Number(body.version))); }
      if (req.method === 'POST' && parts[0] === 'proposals') {
        const body = await readJson(req);
        if (parts.length === 1) return send(res, 201, service.change(user, null, body.changes ?? [], body.name));
        if (parts[2] === 'changes') return send(res, 200, service.change(user, parts[1]!, body.changes ?? []));
        if (parts[2] === 'new-from') return send(res, 201, service.newFrom(user, parts[1]!));
        if (parts[2] === 'pick') return send(res, 200, service.pick(user, parts[1]!, String(body.taskId ?? ''), String(body.keep ?? '')));
        if (parts[2] === 'refresh-preview') return send(res, 200, service.refreshPreview(user, parts[1]!, body.choices ?? {}));
        if (parts[2] === 'refresh') return send(res, 200, service.refresh(user, parts[1]!, body.choices ?? {}));
        if (parts[2] === 'undo-refresh') return send(res, 200, service.undoRefresh(user, parts[1]!));
        if (ACTIONS.has(parts[2] as LifecycleAction)) return send(res, 200, service.act(user, parts[1]!, parts[2] as LifecycleAction, body.reason));
      }
      send(res, 404, { error: 'Not found', code: 'notFound' });
    } catch (e) {
      if (e instanceof ServiceError || e instanceof BackendError) return send(res, STATUS[e.code] ?? 400, { error: e.message, code: e.code });
      send(res, 500, { error: 'Internal error', code: 'invalid' });
      console.error(e);
    }
  });
}

function events(req: IncomingMessage, res: ServerResponse, service: RoadmapService, user: string) {
  service.snapshot(user); // throws without view: nothing is streamed to a user without access
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.write(': connected\n\n');
  const off = service.subscribeFor(user, (e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
  const ping = setInterval(() => { service.tick(); res.write(': ping\n\n'); }, 15_000);
  req.on('close', () => { off(); clearInterval(ping); });
}

function cors(res: ServerResponse, origin?: string) {
  if (!origin) return;
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('access-control-allow-headers', 'content-type, x-gantt-user');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
}
function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}
async function readJson(req: IncomingMessage): Promise<Record<string, any>> {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 5_000_000) throw new ServiceError('Request too large', 'invalid'); }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new ServiceError('Invalid JSON', 'invalid'); }
}
