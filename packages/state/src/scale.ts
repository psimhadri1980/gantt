import { fromDay, type DayNum } from '@gantt/engine';
import { dateFormat } from './format.ts';

/** Units a scale line can count in (G2, G5). */
export type ScaleUnit = 'year' | 'quarter' | 'month' | 'week' | 'day' | 'hour';
/**
 * A zoom level (G1, G2): width of a day and the units of its two scale lines. `format` replaces the label
 * of a unit (for example fiscal quarters or "Sprint 12"); it gets the tick's day number (fractional for hours).
 */
export interface ZoomLevel {
  id: string; label: string; pxPerDay: number; major: ScaleUnit; minor: ScaleUnit;
  format?: Partial<Record<ScaleUnit, (day: number, locale?: string) => string>>;
}

export const ZOOM_LEVELS: ZoomLevel[] = [
  { id: 'year', label: 'Years', pxPerDay: 1.2, major: 'year', minor: 'month' },
  { id: 'quarter', label: 'Quarters', pxPerDay: 3, major: 'quarter', minor: 'month' },
  { id: 'month', label: 'Months', pxPerDay: 10, major: 'month', minor: 'week' },
  { id: 'week', label: 'Weeks', pxPerDay: 22, major: 'month', minor: 'week' },
  { id: 'day', label: 'Days', pxPerDay: 44, major: 'month', minor: 'day' },
];
/** An hour level for hour-based plans (G4); add it to `zoomLevels` when needed. */
export const HOUR_ZOOM: ZoomLevel = { id: 'hour', label: 'Hours', pxPerDay: 24 * 32, major: 'day', minor: 'hour' };

/** The time scale of the chart: the day at x = 0 and the zoom, in pixels per day. */
export interface Scale { origin: DayNum; pxPerDay: number }
/** The x position (in pixels) of the start of a day. */
export const xOf = (s: Scale, d: DayNum) => (d - s.origin) * s.pxPerDay;
/** The day at an x position. */
export const dayAt = (s: Scale, x: number) => Math.floor(x / s.pxPerDay) + s.origin;

/** One label on the time scale: the day it starts, its position and width in pixels, and its text. */
export interface Tick { day: DayNum; x: number; w: number; label: string }

/** The year, month and day of a day number. */
const ymd = (d: DayNum) => { const s = fromDay(d); return { y: +s.slice(0, 4), m: +s.slice(5, 7), d: +s.slice(8, 10) }; };
/** The day number of a calendar date (month 1–12). */
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

/**
 * First day of the week for a locale (G14): 0 = Sunday, 1 = Monday … 6 = Saturday. Uses `Intl.Locale#getWeekInfo`
 * (or the older `weekInfo` property) where the runtime has it, and falls back to Monday (ISO 8601).
 */
export function localeWeekStart(locale?: string): number {
  try {
    const l = new Intl.Locale(locale ?? Intl.DateTimeFormat().resolvedOptions().locale) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const first = l.getWeekInfo?.().firstDay ?? l.weekInfo?.firstDay;
    return first === undefined ? 1 : first % 7; // Intl uses 1 = Monday … 7 = Sunday
  } catch { return 1; }
}

/**
 * Ticks of one unit covering [from, to], labelled via Intl in the given locale.
 * Week ticks begin on `weekStart` (0 = Sunday … 6 = Saturday; default Monday). The week number shown is the
 * ISO week of the Monday inside that week, so a Sunday-start week is numbered like the ISO week that follows it.
 */
export function ticks(s: Scale, unit: ScaleUnit, from: DayNum, to: DayNum, locale?: string, format?: (day: number, locale?: string) => string, weekStart = 1): Tick[] {
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
    case 'week': {
      // Day 0 (1970-01-01) was a Thursday, so (d + 4) % 7 is the weekday with Sunday = 0.
      const ws = ((weekStart % 7) + 7) % 7, toMonday = (8 - ws) % 7;
      cur = Math.floor(from) - ((((Math.floor(from) + 4 - ws) % 7) + 7) % 7); next = (d) => d + 7;
      // Week number with the week's start date: "W46 · 9 Nov". Narrow weeks show the short form "W46 9/11".
      label = (d) => {
        const w = s.pxPerDay * 7, date = new Date(d * 86_400_000), n = isoWeek(d + toMonday);
        if (w >= 90) return `W${n} · ${dayF.format(date)} ${mon.format(date)}`;
        if (w >= 50) return `W${n} ${numDM.format(date)}`;
        return w >= 28 ? `W${n}` : '';
      }; break; }
    case 'hour': cur = Math.floor(from); next = (d) => Math.round((d + 1 / 24) * 24) / 24;
      label = (d) => String(Math.round((d - Math.floor(d)) * 24)).padStart(2, '0'); break;
    default: cur = Math.floor(from); next = (d) => d + 1;
      label = (d) => s.pxPerDay >= 200
        ? fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(d * 86_400_000))
        : `${wd.format(new Date(d * 86_400_000))} ${dayF.format(new Date(d * 86_400_000))}`;
  }
  if (format) label = (d) => format(d, locale);
  while (cur <= to) {
    const n = next(cur);
    out.push({ day: cur, x: xOf(s, cur), w: (n - cur) * s.pxPerDay, label: label(cur) });
    cur = n;
  }
  return out;
}
