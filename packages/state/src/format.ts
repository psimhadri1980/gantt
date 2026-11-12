/**
 * Date formatting with cached Intl formatters.
 */
/** Cached Intl formatters: creating one costs far more than using it, and the chart formats on every redraw. */
const cache = new Map<string, Intl.DateTimeFormat>();
/** A cached `Intl.DateTimeFormat`: creating one is slow, and the chart formats thousands of dates per frame. */
export function dateFormat(locale: string | undefined, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${JSON.stringify(opts)}`;
  let f = cache.get(key);
  if (!f) { f = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...opts }); cache.set(key, f); }
  return f;
}
/** Formats a day number in the locale with the given options. */
export const formatDay = (day: number, locale: string | undefined, opts: Intl.DateTimeFormatOptions) => dateFormat(locale, opts).format(new Date(day * 86_400_000));
