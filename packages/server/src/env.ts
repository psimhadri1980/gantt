/** Environment configuration (plan section 4). The safe direction wins for every variable. */
export interface ServerEnv { mockData: boolean; separationOfDuties: boolean; environment: string; port: number }

export function readEnv(env: Record<string, string | undefined>): { ok: true; env: ServerEnv; warnings: string[] } | { ok: false; error: string } {
  const environment = (env.GANTT_ENVIRONMENT ?? env.NODE_ENV ?? '').trim().toLowerCase();
  const production = environment === 'production' || environment === 'prod';
  // Only an explicit "true" enables mock data; only an explicit "false" relaxes separation of duties.
  const mockRequested = env.GANTT_ENABLE_MOCK_DATA?.trim().toLowerCase() === 'true';
  const sodRelaxed = env.GANTT_ENFORCE_SEPARATION_OF_DUTIES?.trim().toLowerCase() === 'false';
  if (production && sodRelaxed) return { ok: false, error: 'Refusing to start: GANTT_ENFORCE_SEPARATION_OF_DUTIES=false is not allowed in production' };
  const warnings: string[] = [];
  if (production && mockRequested) warnings.push('GANTT_ENABLE_MOCK_DATA=true is ignored in production');
  if (sodRelaxed) warnings.push('Separation of duties is NOT enforced: the submitter of a Proposal can approve it');
  const port = Number(env.PORT ?? 8787);
  return { ok: true, env: { mockData: mockRequested && !production, separationOfDuties: !sodRelaxed, environment: environment || 'unknown', port: Number.isFinite(port) ? port : 8787 }, warnings };
}
