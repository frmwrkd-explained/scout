// Decay — ONE staleness rule for the whole app. docs/03_MEMORY.md §4, docs/01_CANON.md Law 3.
//
// `staleness(obj) -> 0..1` is the only staleness rule that may exist in this codebase. Every
// surface (the freshness bar, the territory sort, the cache's STALE markers, the Librarian's
// re-verify list) reads it from here or from an API response that read it from here.
//
// **Never inline a second staleness rule anywhere.** Two rules means the row that renders fresh
// in the table is the row the cache dropped for being stale, and nobody can explain either — which
// is exactly the "memory rot you cannot see" Law 3 exists to prevent.
//
// The input `obj` is FRONTMATTER, not a wrapper: { type, verified_at, updated, created,
// sweep_interval_days, deadline }. That keeps the rule callable from anywhere that has read a
// file, with no import of the datastore.

const DAY = 864e5;

// docs/03_MEMORY.md §4. A goal is deliberately absent: its window is its own deadline (below).
export const TYPE_WINDOW = { territory: 7, playbook: 30, learning: 90, record: 30 };

// Anything not named above — a proposal, a task, an assistant, an unknown agent-built type —
// decays on the record window. A month is the shortest window that never surprises someone.
export const DEFAULT_WINDOW = 30;

// Date -> epoch ms, or null. Accepts what actually lands in frontmatter: an ISO date string
// (`2026-08-17`), a full timestamp, a Date, or an epoch number.
function ts(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : t;
}

// How long this object stays trustworthy, in days.
// `sweep_interval_days` always wins — it is the human's own statement about this one object, and
// the whole point of putting it on the file is that it beats the type default.
export function windowDays(obj) {
  const o = obj || {};
  const explicit = Number(o.sweep_interval_days);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  // A goal's window is its own deadline (docs/03_MEMORY.md §4) — the span it was given, not a
  // fixed number of days. Halfway to the deadline is halfway stale.
  if (String(o.type || '') === 'goal') {
    const end = ts(o.deadline);
    const start = ts(o.created) ?? ts(o.updated);
    if (end != null && start != null && end > start) return (end - start) / DAY;
  }
  return TYPE_WINDOW[String(o.type || '')] ?? DEFAULT_WINDOW;
}

// Age in days since the object was last known good.
// Order per docs/08 §2: verified_at || updated || created. `verified_at` is the only one that
// means "someone checked this"; the other two are the honest fallbacks.
// No date at all -> Infinity. An object that has never said when it was true is not fresh, and
// silently treating it as brand new is how dead ground stays in the cache forever.
export function ageDays(obj, now = Date.now()) {
  const o = obj || {};
  // A goal ages from when it was set, not from when someone last re-verified it: re-reading a
  // goal does not move its deadline.
  const from = String(o.type || '') === 'goal'
    ? (ts(o.created) ?? ts(o.updated) ?? ts(o.verified_at))
    : (ts(o.verified_at) ?? ts(o.updated) ?? ts(o.created));
  if (from == null) return Infinity;
  return Math.max(0, (now - from) / DAY);
}

// 0 = just verified · 1 = at or past its window. Clamped, always a finite number.
export function staleness(obj, now = Date.now()) {
  const age = ageDays(obj, now);
  const win = windowDays(obj);
  if (!Number.isFinite(win) || win <= 0) return 1;
  if (!Number.isFinite(age)) return 1;
  const s = age / win;
  return s <= 0 ? 0 : s >= 1 ? 1 : s;
}

// The line the cache and the Librarian draw. `staleness` saturates at 1, so this is exactly
// "at or past its window".
export function isStale(obj, now = Date.now()) {
  return staleness(obj, now) >= 1;
}

// Human age, for the one-line renderings ("swept 2d ago"). Same source dates as ageDays, so a row
// can never say "swept today" while its bar reads empty.
export function agoLabel(obj, now = Date.now()) {
  const d = ageDays(obj, now);
  if (!Number.isFinite(d)) return 'never';
  const days = Math.floor(d);
  if (days <= 0) return 'today';
  if (days === 1) return '1d ago';
  return days + 'd ago';
}

// Same, for a bare date value rather than a whole object.
export function agoFrom(value, now = Date.now()) {
  const t = ts(value);
  if (t == null) return 'never';
  return agoLabel({ verified_at: value, type: '_bare' }, now);
}

// Whole days from now until a date (negative once it has passed). Goals need this for
// "11 days left"; nothing else should re-derive it.
export function daysUntil(value, now = Date.now()) {
  const t = ts(value);
  if (t == null) return null;
  return Math.ceil((t - now) / DAY);
}

// A frontmatter date, rendered as the plain `YYYY-MM-DD` a human wrote.
// gray-matter/js-yaml parses an UNQUOTED yaml date into a real `Date`, so interpolating a
// frontmatter date straight into a string produces
// "Thu Jul 30 2026 02:00:00 GMT+0200 (Central European Summer Time)" — in the agent's context
// file, of all places. Every date the cache prints goes through here.
export function dayOf(value) {
  const t = ts(value);
  if (t == null) return '';
  return new Date(t).toISOString().slice(0, 10);
}

export { ts as parseDate };
