import { fromDay, type DayNum } from '@gantt/engine';
import { dateFormat } from './format.ts';

export interface ZoomLevel { id: string; label: string; pxPerDay: number; major: 'year' | 'quarter' | 'month'; minor: 'month' | 'week' | 'day' }

export const ZOOM_LEVELS: ZoomLevel[] = [
  { id: 'year', label: 'Years', pxPerDay: 1.2, major: 'year', minor: 'month' },
  { id: 'quarter', label: 'Quarters', pxPerDay: 3, major: 'quarter', minor: 'month' },
  { id: 'month', label: 'Months', pxPerDay: 10, major: 'month', minor: 'week' },
  { id: 'week', label: 'Weeks', pxPerDay: 22, major: 'month', minor: 'week' },
  { id: 'day', label: 'Days', pxPerDay: 44, major: 'month', minor: 'day' },
];

export interface Scale { origin: DayNum; pxPerDay: number }
export const xOf = (s: Scale, d: DayNum) => (d - s.origin) * s.pxPerDay;
export const dayAt = (s: Scale, x: number) => Math.floor(x / s.pxPerDay) + s.origin;

export interface Tick { day: DayNum; x: number; w: number; label: string }

const ymd = (d: DayNum) => { const s = fromDay(d); return { y: +s.slice(0, 4), m: +s.slice(5, 7), d: +s.slice(8, 10) }; };
const dayOf = (y: number, m: number, d = 1) => Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);

/**
 * ISO 8601 week number of a day: weeks start on Monday, and week 1 is the week containing the year's first Thursday.
 */
export function isoWeek(d: DayNum): number {
  const thursday = d - (((d + 3) % 7 + 7) % 7) + 3; // Thursday of the same Monday-based week
  const year = new Date(thursday * 86_400_000).getUTCFullYear();
  const jan1 = Math.floor(Date.UTC(year, 0, 1) / 86_400_000);
  return Math.floor((thursday - jan1) / 7) + 1;
}

/** Ticks of one unit covering [from, to], labelled via Intl in the given locale. */
export function ticks(s: Scale, unit: 'year' | 'quarter' | 'month' | 'week' | 'day', from: DayNum, to: DayNum, locale?: string): Tick[] {
  const out: Tick[] = [];
  const fmt = (o: Intl.DateTimeFormatOptions) => dateFormat(locale, o);
  const numDM = fmt({ day: 'numeric', month: 'numeric' }), mon = fmt({ month: 'short' }), monY = fmt({ month: 'short', year: 'numeric' }), dayF = fmt({ day: 'numeric' }), wd = fmt({ weekday: 'narrow' });
  const { y, m } = ymd(from);
  let cur: DayNum, next: (d: DayNum) => DayNum, label: (d: DayNum) => string;
  switch (unit) {
    case 'year': cur = dayOf(y, 1); next = (d) => dayOf(ymd(d).y + 1, 1); label = (d) => String(ymd(d).y); break;
    case 'quarter': { const q = Math.floor((m - 1) / 3); cur = dayOf(y, q * 3 + 1);
      next = (d) => { const a = ymd(d); return a.m >= 10 ? dayOf(a.y + 1, 1) : dayOf(a.y, a.m + 3); };
      label = (d) => { const a = ymd(d); return `Q${Math.floor((a.m - 1) / 3) + 1} ${a.y}`; }; break; }
    case 'month': cur = dayOf(y, m); next = (d) => { const a = ymd(d); return a.m === 12 ? dayOf(a.y + 1, 1) : dayOf(a.y, a.m + 1); };
      label = (d) => (s.pxPerDay * 30 > 150 ? monY : mon).format(new Date(d * 86_400_000)); break;
    case 'week': cur = from - ((((from + 3) % 7) + 7) % 7); next = (d) => d + 7;
      // ISO week number with the week's start date (Monday): "W46 · 9 Nov". Narrow weeks show the short form "W46 9/11".
      label = (d) => {
        const w = s.pxPerDay * 7, date = new Date(d * 86_400_000);
        if (w >= 90) return `W${isoWeek(d)} · ${dayF.format(date)} ${mon.format(date)}`;
        if (w >= 50) return `W${isoWeek(d)} ${numDM.format(date)}`;
        return w >= 28 ? `W${isoWeek(d)}` : '';
      }; break;
    default: cur = from; next = (d) => d + 1;
      label = (d) => `${wd.format(new Date(d * 86_400_000))} ${dayF.format(new Date(d * 86_400_000))}`;
  }
  while (cur <= to) {
    const n = next(cur);
    out.push({ day: cur, x: xOf(s, cur), w: (n - cur) * s.pxPerDay, label: label(cur) });
    cur = n;
  }
  return out;
}
