// Local-day boundaries — one leaf module, because the Today loop's day/week/month buckets are
// the MACHINE'S local calendar (a day ends at local midnight, a week runs Monday–Sunday) while
// log.mjs names its files by UTC day and gray-matter parses bare YAML dates as UTC midnight.
// Three different clocks, one file that owns the local one — a second copy of "midnight" in
// today.mjs and a third in brain.mjs is exactly how the two clocks drifted apart in store.mjs's
// day()/dayMs() note (backend/store.mjs §frontmatter dates).

const pad = n => String(n).padStart(2, '0');

// The local calendar day of a moment, always `YYYY-MM-DD`.
export function localDay(t = Date.now()) {
  const d = t instanceof Date ? t : new Date(t);
  if (Number.isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// A `YYYY-MM-DD` string → epoch ms of local midnight at its start. DST-safe: Date resolves the
// actual civil midnight, not a midnight computed by adding 86400000.
export function dayStartMs(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m) return NaN;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

export function addDays(day, n) {
  return localDay(dayStartMs(day) + n * 86400000 + 43200000); // +12h kills the DST-edge ambiguity
}

// The Monday (local) of the week containing `day`. getDay(): 0 is Sunday — a Sunday's Monday
// is six days BACK, which the `(getDay() + 6) % 7` form gets right.
export function weekStartDay(day) {
  const start = dayStartMs(day);
  const d = new Date(start);
  const back = (d.getDay() + 6) % 7;
  return addDays(day, -back);
}

export function monthStartDay(day) {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(day || ''));
  return m ? m[1] + '-' + m[2] + '-01' : '';
}

// [start, end) in epoch ms for a local range kind: 'day' | 'week' | 'month' anchored on `now`'s
// local calendar. `end` is "now" for the running period — a today/week view counts through now,
// not through a boundary that has not happened yet.
export function rangeFor(kind, now = Date.now()) {
  const day = localDay(now);
  const anchor = kind === 'week' ? weekStartDay(day) : kind === 'month' ? monthStartDay(day) : day;
  return { from: dayStartMs(anchor), to: now instanceof Date ? now.getTime() : Number(now) };
}
