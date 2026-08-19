// DEV-122 — the ONE classifier for activity-feed entries. Both feed renderers (home rail and the
// per-project Activity tab) read it, so "what counts as a generation event" is stated once.
//
// WHY DERIVATION, AND HOW TO RETIRE IT
// Activity events carry `kind`, but that is the NAVIGATION target ('proj' | 'item'), not the sort of
// thing that happened — a generation and a style lock are both kind:'proj'. There is no type field
// today, and there are 47 appendActivity() call sites across 13 backend modules, so stamping one at
// every write is its own change.
//
// So: `activityType()` reads `e.type` FIRST and only falls back to deriving from the title. Add
// `type:` to the backend events whenever convenient and this file needs no edit — the explicit
// value simply starts winning, entry by entry. The derivation is keyed off the title text that
// backend/store.mjs appendActivity() callers already write, listed per bucket below so a new title
// has an obvious home.

export const ACTIVITY_TYPES = [
  { id: 'generation', label: 'Generations' },  // Generation done/failed, Candidate kept/selected, Batch
  { id: 'media', label: 'Media & renders' },   // Video import, Remotion render, 3D, Control map, Grid split
  { id: 'look', label: 'Looks & styles' },     // Style lock created/imported, Look extracted
  { id: 'agent', label: 'Agent & skills' },    // Chat session, House rules, Skill enhanced, Tools
  { id: 'other', label: 'Everything else' }
];
export const ACTIVITY_TYPE_IDS = ACTIVITY_TYPES.map(t => t.id);

// title → bucket. Ordered: the first pattern that matches wins, so put the specific before the broad.
const RULES = [
  [/generation|candidate|batch|re-?roll/i, 'generation'],
  [/style ?lock|look\b|palette/i, 'look'],
  [/chat|agent|skill|house rules|tool\b/i, 'agent'],
  [/video|remotion|render|3d|control map|grid|split|asset|import|export|upload/i, 'media']
];

export function activityType(e) {
  // an explicit backend type always wins — see the note above
  if (e && typeof e.type === 'string' && ACTIVITY_TYPE_IDS.includes(e.type)) return e.type;
  const t = String((e && e.t) || '');
  for (const [re, id] of RULES) if (re.test(t)) return id;
  return 'other';
}

// ── day bucketing ──
// Local midnight boundaries, not 24-hour windows: "Yesterday" has to mean the calendar day, or an
// event from 23:00 last night reads as Today at 09:00 this morning.
const DAY = 86400000;
const midnight = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };

export function dayKey(ts) { return midnight(Number(ts) || Date.now()); }

export function dayLabel(key) {
  const today = midnight(Date.now());
  if (key === today) return 'TODAY';
  if (key === today - DAY) return 'YESTERDAY';
  const d = new Date(key);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', sameYear
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
}

// Group events into [{ key, label, events }], newest day first, preserving each day's own order.
export function groupByDay(events = []) {
  const out = [];
  const byKey = new Map();
  for (const e of events) {
    const k = dayKey(e.ts);
    if (!byKey.has(k)) { const g = { key: k, label: dayLabel(k), events: [] }; byKey.set(k, g); out.push(g); }
    byKey.get(k).events.push(e);
  }
  return out.sort((a, b) => b.key - a.key);
}
