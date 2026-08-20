// The board — "kanban with more information" (docs/02_DATA_MODEL.md §3, docs/05_UI_SPEC.md §3).
//
// Columns ARE the status field's options, ordered by each option's `group` (todo → active → done).
// That ordering is the whole reason `status` is not `select`: the group is what makes "what's open"
// and "what's done" answerable without a second field.
//
// Cards carry `view.card.fields`, and — when the collection has a relation — a RELATION-DERIVED
// ACTIVITY LINE (`3 groups · LAST TOUCH 2D AGO`). That line is the difference between a board and a
// list of names: it says whether a lane is moving without opening anything.
//
// Dragging a card between columns calls `onMove(row, toStatus)` and NOTHING ELSE. This component
// never writes: the gate (docs/01_CANON.md, backend/records.mjs) is the only thing allowed to refuse
// a promotion, and it can only do that if the write goes through the integrator's route. A board
// that optimistically re-bucketed a card would be showing a promotion the gate may already have
// refused — so a card moves when the rows come back changed, not when the mouse comes up.

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { Cell, StatusChip } from './cells';
import { Empty, Eyebrow } from './ui';
import { Freshness } from './Freshness';

const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });

// docs/02_DATA_MODEL.md §2: `group: todo | active | done`. Anything a schema invents sorts after the
// three known bands rather than vanishing — a column nobody planned is still a column.
const GROUP_RANK = { todo: 0, active: 1, done: 2 };

// Which status field draws the columns: the one the view groups by, else the gate field, else the
// first status field. The gate is the meaningful default — it is the field the promotion gate
// guards, so it is the one a person is actually moving cards along.
export function boardField(collection, view) {
  const fields = collection?.fields || [];
  const grouped = view?.group && fields.find(f => f.key === view.group && f.type === 'status');
  return grouped || fields.find(f => f.type === 'status' && f.gate) || fields.find(f => f.type === 'status') || null;
}

function optionsOf(field) {
  return (field?.options || [])
    .map(o => (typeof o === 'string' ? { value: o } : o || {}))
    .filter(o => o.value != null)
    .map(o => ({ value: String(o.value), colour: o.colour || null, group: o.group || null }));
}

// → { field, bands: [{ group, columns: [{ value, colour, items, unset }] }] }
// Exported because the bucketing is the testable part; the JSX below is only its rendering.
export function boardBands(collection, view, rows) {
  const field = boardField(collection, view);
  const all = rows || [];
  if (!field) return { field: null, bands: [{ group: null, columns: [{ value: null, unset: true, items: all }] }] };

  const opts = optionsOf(field);
  const buckets = new Map(opts.map(o => [o.value, []]));
  const loose = [];
  for (const r of all) {
    const v = String(r.fields?.[field.key] ?? '');
    if (buckets.has(v)) buckets.get(v).push(r);
    else loose.push(r);
  }

  const columns = opts.map(o => ({ ...o, items: buckets.get(o.value) }));
  const keys = [];
  for (const c of columns) { const g = c.group || 'other'; if (!keys.includes(g)) keys.push(g); }
  // V8's sort is stable, so options inside one band keep the order the schema declared them in.
  keys.sort((a, b) => (GROUP_RANK[a] ?? 90) - (GROUP_RANK[b] ?? 90));

  const bands = keys.map(g => ({ group: g, columns: columns.filter(c => (c.group || 'other') === g) }));
  // A record whose status is not one of the declared options is NOT hidden (Law 8). It gets its own
  // trailing column, so a schema gap becomes visible instead of silently eating records.
  if (loose.length) bands.push({ group: null, columns: [{ value: null, unset: true, items: loose }] });
  return { field, bands };
}

// ── the activity line ──────────────────────────────────────────────────────────────────────────
// Derived from what the row already carries: how many things it relates to, and when it was last
// touched. Counts come from relation fields and from `rollup` fields that count THROUGH a relation
// (`fn: count`) — which is where "2 messages" comes from once a message collection exists.
function plural(word, n) {
  const w = String(word).replace(/_/g, ' ');
  return n === 1 || /s$/i.test(w) ? w : w + 's';
}

export function activityOf(collection, row) {
  const fields = collection?.fields || [];
  // No relation on the collection means no activity line — a board over a relationless collection
  // is a plain kanban, and inventing a line for it would be decoration.
  if (!fields.some(d => d.type === 'relation')) return null;
  const f = row?.fields || {};
  const counts = [];
  for (const def of fields) {
    if (def.type === 'relation') {
      const n = [].concat(f[def.key] ?? []).filter(v => v !== '' && v != null).length;
      if (n) counts.push(n + ' ' + plural(def.label || def.target || def.key, n));
    } else if (def.type === 'rollup' && def.fn === 'count') {
      const n = Number(f[def.key]);
      if (Number.isFinite(n) && n > 0) counts.push(n + ' ' + plural(def.label || def.key, n));
    }
  }
  // The automatic fields (docs/02_DATA_MODEL.md §2) are the honest "last touch": `verified_at` is
  // the strongest claim, then the last write, then creation.
  return { counts, touch: f.verified_at || f.updated || f.created || null };
}

function ActivityLine({ activity }) {
  if (!activity) return null;
  const { counts, touch } = activity;
  if (!counts.length && !touch) return null;
  return (
    <div style={sx('display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding-top:1px')}>
      {counts.map(c => (
        <span key={c} style={{ ...mono('font-size:9.5px;font-weight:600;letter-spacing:.06em;font-variant-numeric:tabular-nums;text-transform:uppercase'), color: 'var(--fg-faint)' }}>
          {c}
        </span>
      ))}
      {touch ? (
        <span style={sx('display:inline-flex;align-items:center;gap:6px')}>
          <span style={{ ...mono('font-size:9px;font-weight:700;letter-spacing:.12em'), color: 'var(--fg-faint)' }}>LAST TOUCH</span>
          <Freshness value={touch} width={20} />
        </span>
      ) : null}
    </div>
  );
}

// ── the card ───────────────────────────────────────────────────────────────────────────────────
// Selected is the neutral raised chip treatment (docs/05_UI_SPEC.md §6) — a --raise bed with a
// --border-3 edge, exactly the ui.jsx Chip vocabulary. Never an accent fill: the accent is the one
// primary action on a screen, and a selected card is state, not an action.
function BoardCard({ collection, row, defs, selected, dragging, draggable, onSelect, onOpen, onFollow, onDragStart, onDragEnd }) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onSelect(row)}
      onDoubleClick={() => onOpen(row)}
      style={{
        ...sx('display:flex;flex-direction:column;gap:6px;padding:9px 10px;border-radius:8px;cursor:pointer;transition:background 130ms ease,border-color 130ms ease'),
        background: selected ? 'var(--raise)' : 'var(--surface-2)',
        border: '1px solid ' + (selected ? 'var(--border-3)' : 'var(--border)'),
        opacity: dragging ? 0.45 : 1,
      }}>
      <span style={{ ...sx('font-size:12.5px;font-weight:600;line-height:1.35'), color: selected ? 'var(--fg)' : 'var(--fg-soft)' }}>
        {row.title}
      </span>
      {defs.length ? (
        <div style={sx('display:flex;align-items:center;gap:10px;flex-wrap:wrap')}>
          {defs.map(f => <Cell key={f.key} field={f} value={row.fields[f.key]} onFollow={onFollow} />)}
        </div>
      ) : null}
      <ActivityLine activity={activityOf(collection, row)} />
    </div>
  );
}

// ── the board ──────────────────────────────────────────────────────────────────────────────────
export default function BoardView({ collection, view, views, rows, counts, selected, onSelect, onOpen, onFollow, onPickView, onMove }) {
  const [drag, setDrag] = React.useState(null);   // { path, from } — the card in flight
  const [over, setOver] = React.useState(null);   // the status value under the cursor

  const { field, bands } = boardBands(collection, view, rows);
  const primary = (collection.fields || []).find(f => f.primary);

  // Card fields: what the view says, else the view's columns minus the two things the card already
  // shows by other means (the title, and the status the column itself IS).
  const cardKeys = (view.card && view.card.fields && view.card.fields.length)
    ? view.card.fields
    : (view.fields || []).filter(k => k !== primary?.key && k !== field?.key).slice(0, 3);
  const defs = cardKeys
    .filter(k => k !== primary?.key)
    .map(k => (collection.fields || []).find(f => f.key === k) || { key: k, type: 'text' });

  const canMove = !!onMove && !!field;

  const dropOn = (col, e) => {
    e.preventDefault();
    setOver(null);
    const row = drag && rows.find(r => r.path === drag.path);
    setDrag(null);
    if (!row || !canMove || col.unset) return;
    if (String(row.fields?.[field.key] ?? '') === col.value) return;   // a no-op drop is not a move
    onMove(row, col.value);
  };

  if (!rows.length) {
    return (
      <div style={sx('flex:1;min-height:0;display:flex;align-items:flex-start;justify-content:center;padding:40px 20px')}>
        <Empty
          size="page"
          style={sx('max-width:420px')}
          title="Nothing on this board"
          body="Every column is empty because the collection's query and this view's filters together return no records. Nothing is hidden — widen either one."
        />
      </div>
    );
  }

  return (
    <div style={sx('flex:1;min-height:0;overflow-x:auto;overflow-y:hidden;display:flex;align-items:stretch;gap:20px;padding:2px 20px 18px')}>
      {bands.map((band, bi) => (
        <div key={(band.group || 'unsorted') + '-' + bi} style={sx('flex:none;min-height:0;display:flex;flex-direction:column;gap:7px')}>
          <div style={sx('flex:none;display:flex;align-items:center;gap:9px;padding:0 2px')}>
            <Eyebrow>{band.group || 'unsorted'}</Eyebrow>
            <span style={sx('flex:1;height:1px;background:var(--line)')} />
          </div>

          <div style={sx('flex:1;min-height:0;display:flex;align-items:stretch;gap:10px')}>
            {band.columns.map(col => {
              const isOver = canMove && !col.unset && over === col.value;
              return (
                <div key={col.value || 'unset'}
                  onDragOver={e => {
                    if (!canMove || col.unset) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (over !== col.value) setOver(col.value);
                  }}
                  onDragLeave={() => setOver(o => (o === col.value ? null : o))}
                  onDrop={e => dropOn(col, e)}
                  style={{
                    ...sx('width:258px;flex:none;min-height:0;display:flex;flex-direction:column;border-radius:10px;transition:border-color 130ms ease,background 130ms ease'),
                    background: isOver ? 'var(--surface-2)' : 'var(--surface)',
                    // --marked is the "in flight / singled out" channel (styles.css), which is
                    // exactly what a column under a dragged card is. It never means "click this".
                    border: '1px solid ' + (isOver ? 'var(--marked)' : 'var(--line)'),
                  }}>
                  <div style={sx('flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 10px;border-bottom:1px solid var(--line)')}>
                    {col.unset
                      ? <span style={{ ...mono('font-size:9px;font-weight:800;letter-spacing:.14em'), color: 'var(--fg-faint)' }}>NO STATUS</span>
                      : <StatusChip value={col.value} field={field} />}
                    <span style={{ ...mono('font-size:10px;font-weight:600;font-variant-numeric:tabular-nums'), color: 'var(--fg-faint)' }}>
                      {col.items.length}
                    </span>
                  </div>

                  <div style={sx('flex:1;min-height:0;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:7px')}>
                    {col.items.map(r => (
                      <BoardCard
                        key={r.path}
                        collection={collection}
                        row={r}
                        defs={defs}
                        selected={selected === r.path}
                        dragging={drag?.path === r.path}
                        draggable={canMove && !col.unset}
                        onSelect={onSelect}
                        onOpen={onOpen}
                        onFollow={onFollow}
                        onDragStart={e => {
                          // A plain-text payload so a drop outside the app is inert rather than
                          // mysterious, and so the path is legible in any drag inspector.
                          e.dataTransfer.effectAllowed = 'move';
                          try { e.dataTransfer.setData('text/plain', r.path); } catch { /* older engines */ }
                          setDrag({ path: r.path, from: col.value });
                        }}
                        onDragEnd={() => { setDrag(null); setOver(null); }}
                      />
                    ))}
                    {!col.items.length ? (
                      <div style={{ ...mono('font-size:9px;font-weight:700;letter-spacing:.14em;padding:10px 2px;text-align:center'), color: 'var(--border-3)' }}>
                        EMPTY
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
