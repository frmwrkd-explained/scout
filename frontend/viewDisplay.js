// frontend/viewDisplay.js — how a saved view says it wants to be SHOWN. The one reader.
//
// A view is data in the vault (`.scout/views/<collection>.json`, docs/02_DATA_MODEL.md §3). Next
// to its query (filter · sort) it carries a handful of display keys, all optional:
//
//   type      'table' | 'list' | 'board' | 'gallery'   the layout
//   size      's' | 'm' | 'l' | 'xl'                    how big rows, cards and their text are
//   fields    [key, …]                                  the properties shown, in this order
//   cover     key | false                               the file field that leads a row or card
//   fit       'contain' | 'cover'                       whole picture, or fill the frame
//   summary   true | false                              show the note's first paragraph
//   wrap      true | false                              let long values take more than one line
//   group     key | null                                section the rows by a field
//   widths    { key: px }                               table column widths
//
// Every renderer (table, list, board, cards) and the controls that edit these keys read them
// through THIS module, so a default lives in one place and "what does this view show" has one
// answer — for the four layouts and for an agent reading the JSON alike. PURE: no React, no DOM.

export const SIZES = ['s', 'm', 'l', 'xl'];

// title    the record's name            (px)
// text     secondary text, summaries    (px)
// zoom     scale applied to typed property cells (chips, meters, dates) as one unit
// row      a list/table row's vertical padding
// thumb    a row's picture               card   a card's minimum width
export const SIZE = {
  s: { label: 'Small', short: 'S', title: 13, text: 12, zoom: 0.9, row: 6, thumb: 28, card: 184 },
  m: { label: 'Medium', short: 'M', title: 14, text: 13, zoom: 1, row: 10, thumb: 40, card: 248 },
  l: { label: 'Large', short: 'L', title: 16, text: 14, zoom: 1.14, row: 14, thumb: 60, card: 328 },
  xl: { label: 'Extra large', short: 'XL', title: 19, text: 16, zoom: 1.34, row: 20, thumb: 92, card: 440 },
};

// Views saved before `size` existed carry `density`. Read it rather than rewrite their files.
const FROM_DENSITY = { compact: 's', cosy: 'm', roomy: 'l' };
export const sizeKey = view => (SIZE[view?.size] ? view.size : FROM_DENSITY[view?.density] || 'm');
export const sizeOf = view => SIZE[sizeKey(view)];

const fieldsOf = collection => (collection && collection.fields) || [];
export const primaryOf = collection => fieldsOf(collection).find(f => f.primary) || null;
export const fileFieldsOf = collection => fieldsOf(collection).filter(f => f.type === 'file');

// The picture that leads a row or a card. `cover: false` is a person saying "no picture"; an
// unset cover falls back to the schema's `primary_media`, then to any file field.
export function coverOf(collection, view) {
  if (view && view.cover === false) return null;
  const files = fileFieldsOf(collection);
  if (view && view.cover) return files.find(f => f.key === view.cover) || null;
  return files.find(f => f.primary_media) || files[0] || null;
}

export const fitOf = view => (view && view.fit === 'cover' ? 'cover' : 'contain');
export const wrapOf = view => !!(view && view.wrap);

// The first paragraph is on by default where a line has room for it (the list) and off where the
// picture is the point (cards, board). An explicit true/false always wins.
export function summaryOf(view) {
  if (view && typeof view.summary === 'boolean') return view.summary;
  return (view && view.type) === 'list';
}

// What a table opens with when the view names nothing: the first six declared fields.
const DEFAULT_COUNT = 6;

// The properties a view shows, as schema field objects, in the view's order.
//   title: true   keep the primary field (a table has a title column)
//   title: false  drop it (a row or card draws the title itself) — and drop the cover too
// A key the schema does not declare still renders (Law 8): it becomes a plain text field.
export function shownFields(collection, view, { title = false } = {}) {
  const all = fieldsOf(collection);
  const primary = primaryOf(collection);
  const cover = title ? null : coverOf(collection, view);
  // The cards and the board used to carry their own list (`view.card.fields`). It is still read
  // so an old view looks the way it did; the controls write `fields` and drop it.
  const legacy = !title && view && view.card && Array.isArray(view.card.fields) && view.card.fields.length ? view.card.fields : null;
  const keys = legacy || (view && Array.isArray(view.fields) ? view.fields : all.slice(0, DEFAULT_COUNT).map(f => f.key));
  const out = [];
  if (title && primary) out.push(primary);
  for (const key of keys) {
    if (primary && key === primary.key) continue;
    if (cover && key === cover.key) continue;
    if (out.some(f => f.key === key)) continue;
    out.push(all.find(f => f.key === key) || { key, type: 'text' });
  }
  return out;
}

// Every field a person could switch on, for the Properties control: shown ones first, in order.
// In a table the picture is a column like any other. Everywhere else the picture already leads
// the row or card (the Picture control), so it is not offered a second time as a property.
export function pickableFields(collection, view) {
  const primary = primaryOf(collection);
  const lead = view && view.type === 'table' ? null : coverOf(collection, view);
  const shown = shownFields(collection, { ...view, cover: false, card: null }, { title: false }).filter(f => !lead || f.key !== lead.key);
  const rest = fieldsOf(collection).filter(f => f !== primary && f !== lead && !shown.some(s => s.key === f.key));
  return { shown, hidden: rest };
}

// ── grouping ─────────────────────────────────────────────────────────────────────────────────
// A view groups by ONE field. Choices and statuses group by value, a date groups by day.
export const GROUPABLE = ['select', 'status', 'multiselect', 'date', 'checkbox', 'actor', 'relation'];
export const groupableFields = collection => fieldsOf(collection).filter(f => GROUPABLE.includes(f.type));

export function groupFieldOf(collection, view) {
  if (!view || !view.group) return null;
  return fieldsOf(collection).find(f => f.key === view.group) || { key: view.group, type: 'text' };
}

// A date-only value ("2026-08-18", or the ISO midnight gray-matter turns it into) must NOT go
// through a local-time Date, or a workspace west of UTC files every record on the day before.
export function dayKey(value) {
  if (!value) return null;
  const s = String(value instanceof Date ? value.toISOString() : value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const localKey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

export function dayLabel(key, now = new Date()) {
  if (!key) return 'No date';
  if (key === localKey(now)) return 'Today';
  if (key === localKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return 'Yesterday';
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);   // local construction — no parse, no shift
  return DAYS[dt.getDay()] + ' ' + d + ' ' + MONTHS[m - 1] + ' ' + y;
}

const sentence = s => { const w = String(s).replace(/[-_]/g, ' ').trim(); return w.charAt(0).toUpperCase() + w.slice(1); };

// → [{ key, label, items }] or null when the view does not group. Rows keep the order the view's
// sort gave them inside a group. A record with no value is NOT dropped (Law 8): it gets its own
// trailing group. A multi-value field files a record under each of its values.
export function groupRows(rows, collection, view, now = new Date()) {
  const field = groupFieldOf(collection, view);
  if (!field) return null;
  const groups = new Map();
  const put = (key, row) => { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); };
  for (const row of rows || []) {
    const raw = row.fields ? row.fields[field.key] : undefined;
    if (field.type === 'date') { put(dayKey(raw) || '', row); continue; }
    if (field.type === 'checkbox') { put(raw ? 'yes' : 'no', row); continue; }
    const values = [].concat(raw ?? []).filter(v => v !== '' && v != null).map(String);
    if (!values.length) put('', row); else for (const v of values) put(v, row);
  }
  const declared = (field.options || []).map(o => String(typeof o === 'string' ? o : o.value));
  const keys = [...groups.keys()].sort((a, b) => {
    if (a === b) return 0;
    if (a === '') return 1;           // the empty group always trails
    if (b === '') return -1;
    if (field.type === 'date') return b.localeCompare(a);   // newest day first
    const ia = declared.indexOf(a), ib = declared.indexOf(b);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);   // schema order
    return a.localeCompare(b);
  });
  const empty = 'No ' + sentence(field.label || field.key).toLowerCase();
  return keys.map(key => ({
    key,
    // A choice is stored as `closed-won`; its heading reads `Closed won`, the way its chip does.
    label: key === '' ? empty : field.type === 'date' ? dayLabel(key, now) : field.type === 'checkbox' ? sentence(key)
      : (field.type === 'status' || field.type === 'select') ? sentence(key.replace(/[-_]+/g, ' ')) : key,
    items: groups.get(key),
  }));
}

export const fieldLabel = field => sentence(field.label || field.key);

// The display keys, for anything that needs to know whether two views differ only in how they
// look (the app does not refetch rows for these).
export const DISPLAY_KEYS = ['type', 'size', 'density', 'fields', 'card', 'cover', 'fit', 'summary', 'wrap', 'widths', 'label'];
export function sameQuery(a, b) {
  // Filter and sort are applied on the server; grouping and everything else happen in the renderer.
  const q = v => JSON.stringify([v?.id, v?.filter || [], v?.sort || []]);
  return q(a) === q(b);
}

// ── quick filters ────────────────────────────────────────────────────────────────────────────
// Clicking a value on a row ("ADS", a tag) narrows what is on screen to the records that carry
// it. That narrowing is a DRAFT on top of the saved view — nothing is written until the person
// saves it as a view of its own — so it is applied here, to rows the view already holds. It is
// deliberately the two simplest comparisons the server's own filter has (`is`, `contains`), not a
// second filter engine: a quick filter that is worth keeping becomes a real saved view, and from
// then on the server applies it.
export const quickKey = q => q.field + '\u0000' + String(q.value);
export function toggleQuick(quick, field, value) {
  const next = { field: field.key, value: String(value) };
  return (quick || []).some(q => quickKey(q) === quickKey(next))
    ? quick.filter(q => quickKey(q) !== quickKey(next))
    : [...(quick || []), next];
}
export function applyQuick(rows, quick) {
  if (!quick || !quick.length) return rows || [];
  return (rows || []).filter(row => quick.every(q => [].concat(row.fields?.[q.field] ?? []).map(String).includes(q.value)));
}
// The saved-view filter rows a set of quick filters turns into: a list field `contains` the
// value, anything else `is` it.
export function quickToFilter(collection, quick) {
  return (quick || []).map(q => {
    const field = fieldsOf(collection).find(f => f.key === q.field);
    return { field: q.field, op: field && field.type === 'multiselect' ? 'contains' : 'is', value: q.value };
  });
}
