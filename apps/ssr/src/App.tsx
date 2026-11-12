import { Gantt } from '@gantt/react';
import { fullAccess } from '@gantt/access';
import type { RoadmapDocument } from '@gantt/contract';
import sample from '../../../packages/mock/src/samples/small.json' with { type: 'json' };

/** The same roadmap on the server and in the browser; anything that differs between the two would break hydration. */
const data = { ...(sample as unknown as RoadmapDocument), access: fullAccess() as RoadmapDocument['access'] };

/**
 * The page's one component. `ssr` makes the Gantt place the roadmap synchronously during render, so the HTML
 * produced on the server already contains the rows and bars, and the browser's first render matches it exactly.
 * Today is fixed so the "today" marker is the same on both sides.
 */
export function App() {
  return <Gantt data={data} ssr height={480} today="2026-11-13" />;
}
