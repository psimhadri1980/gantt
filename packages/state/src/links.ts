import type { Link } from '@gantt/contract';
import type { Placement } from '@gantt/engine';
import { xOf, type Scale } from './scale.ts';

/** A bar's vertical position: top (y) and height in pixels. */
export interface BarPos { y: number; h: number }

/**
 * Orthogonal connector path for a link (A2). Bars run from the start of their first day to the end
 * of their last day; a milestone sits at the start of its day.
 */
export function linkPath(l: Link, p: Placement, pos: Map<string, BarPos>, s: Scale): string | null {
  const a = p.byId.get(l.source), b = p.byId.get(l.target);
  const pa = pos.get(l.source), pb = pos.get(l.target);
  if (!a?.scheduled || !b?.scheduled || !pa || !pb) return null;
  const edge = (t: typeof a, which: 'S' | 'F') => {
    if (t.task.type === 'milestone') return xOf(s, t.start!) + s.pxPerDay / 2;
    return which === 'S' ? xOf(s, t.start!) : xOf(s, t.end! + 1);
  };
  const fromEnd = l.type === 'FS' || l.type === 'FF';
  const toStart = l.type === 'FS' || l.type === 'SS';
  const x1 = edge(a, fromEnd ? 'F' : 'S'), x2 = edge(b, toStart ? 'S' : 'F');
  const y1 = pa.y + pa.h / 2, y2 = pb.y + pb.h / 2;
  const G = 10;
  const out1 = fromEnd ? x1 + G : x1 - G;
  const in2 = toStart ? x2 - G : x2 + G;
  const pts: [number, number][] = [[x1, y1], [out1, y1]];
  const forward = toStart ? in2 >= out1 : in2 <= out1;
  if ((fromEnd === toStart && forward) || (fromEnd !== toStart && (fromEnd ? in2 >= out1 : in2 <= out1))) {
    pts.push([out1, y2]);
  } else {
    const midY = y2 > y1 ? pb.y - 4 : pb.y + pb.h + 4;
    pts.push([out1, midY], [in2, midY], [in2, y2]);
  }
  pts.push([x2, y2]);
  return 'M' + pts.map(([x, y]) => `${Math.round(x) + 0.5},${Math.round(y) + 0.5}`).join('L');
}
