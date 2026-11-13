// Reference server entry point.
//   GANTT_ENABLE_MOCK_DATA=true GANTT_ENFORCE_SEPARATION_OF_DUTIES=false pnpm --filter @gantt/server start
import { readFileSync } from 'node:fs';
import { RoadmapService } from '@gantt/service';
import { loadMock } from '@gantt/mock';
import type { AccessRules } from '@gantt/access';
import { readEnv } from './env.ts';
import { createGanttServer } from './server.ts';

/** Settings from environment variables; refuses to start on a missing or unsafe setting. */
const r = readEnv(process.env);
if (!r.ok) { console.error(r.error); process.exit(1); }
for (const w of r.warnings) console.warn(`warning: ${w}`);
if (!r.env.mockData) { console.error('No data source is configured. For a demo, set GANTT_ENABLE_MOCK_DATA=true (not in production).'); process.exit(1); }

const dataFile = process.env.GANTT_MOCK_FILE ?? new URL('../../mock/src/samples/small.json', import.meta.url).pathname;
/** The roadmap to serve, validated like any import. */
const loaded = loadMock(readFileSync(dataFile, 'utf8'));
if (!loaded.ok) { console.error('Mock file refused:', loaded.errors.slice(0, 5)); process.exit(1); }
const rulesFile = process.env.GANTT_RULES_FILE ?? new URL('../../mock/src/samples/roles.json', import.meta.url).pathname;
/** Access rules per user id (a stand-in for the identity provider a real deployment would use). */
const rules: Record<string, AccessRules> = JSON.parse(readFileSync(rulesFile, 'utf8'));

const service = new RoadmapService({ current: loaded.doc, rulesFor: (u) => rules[u] ?? null, separationOfDuties: r.env.separationOfDuties });
createGanttServer(service, { allowOrigin: process.env.GANTT_ALLOW_ORIGIN }).listen(r.env.port, () => {
  console.log(`Gantt reference server on http://localhost:${r.env.port} (${r.env.environment}); separation of duties ${r.env.separationOfDuties ? 'enforced' : 'NOT enforced'}`);
});
