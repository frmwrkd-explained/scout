// The one dispatcher. A collection renders through exactly one component per view type
// (docs/05_UI_SPEC.md §3), chosen by `view.type` — never by a branch inside a screen.
//
// Adding a fifth view type is ONE LINE in the table below plus its component. If you ever find
// yourself writing `if (view.type === …)` anywhere else in the app, that is the bug this file
// exists to prevent.
//
// The backend already decides the DEFAULT type from the collection's shape (backend/views.mjs
// `inferViewType`: status → board, primary media → gallery, dates → list, else table). Nothing here
// re-derives it — this file renders what the view says, and the view says what the shape chose.
//
// All four renderers take the SAME props, so the shell never has to know which one is up:
//   { collection, view, views, rows, counts, selected, onSelect, onOpen, onFollow, onPickView }
// `onOpen(row)` opens a record; `onFollow(collection, id)` follows a relation chip. They were
// ONE prop called `onOpen` with two signatures, which made every relation chip in the app dead.
//   + onMove — the board's drag handler. It is passed to every renderer and ignored by three.

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import TableView from './TableView';
import BoardView from './BoardView';
import ListView from './ListView';
import GalleryView from './GalleryView';

const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });

// ── the view strip ─────────────────────────────────────────────────────────────────────────────
// One pill per saved view, count on each. Selected is a raised neutral chip with a --border-3 edge
// — never an accent fill (docs/05_UI_SPEC.md §6: the one solid accent per screen is the primary
// action, and a tab is not an action).
//
// ViewTabs and QueryBar are exported because they are the ONE view strip. TableView used to carry
// byte-equivalent private copies — it drew its own chrome before this dispatcher existed — so a
// change to the query bar reached the table and not the board, the list or the gallery. Reconciled:
// every renderer now takes `chrome: true` and this file draws it once.
export function ViewTabs({ views, activeId, counts, onPick }) {
  return (
    <div style={sx('flex:none;display:flex;align-items:center;gap:6px;padding:10px 20px 0;flex-wrap:wrap')}>
      {(views || []).map(v => {
        const on = v.id === activeId;
        return (
          <button key={v.id} onClick={() => onPick(v.id)}
            style={{
              ...sx('display:flex;align-items:center;gap:8px;height:26px;padding:0 11px;border-radius:6px;font-size:11.5px;cursor:pointer;transition:background 130ms ease,color 130ms ease'),
              background: on ? 'var(--raise)' : 'transparent',
              border: '1px solid ' + (on ? 'var(--border-3)' : 'transparent'),
              color: on ? 'var(--fg)' : 'var(--fg-muted)',
              fontWeight: on ? 600 : 500,
            }}>
            <span>{v.label || v.id}</span>
            {counts && counts[v.id] != null ? (
              <span style={{ ...mono('font-size:10px;font-weight:600;font-variant-numeric:tabular-nums'), color: on ? 'var(--fg-soft)' : 'var(--fg-faint)' }}>
                {counts[v.id]}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// The query bar states, in the app's own words, exactly what the view is doing. It is not
// decoration: a collection IS a saved query, and a person who cannot see the query cannot tell why
// a record is missing from the board, the list or the grid either.
export function QueryBar({ collection, view, total, path }) {
  const bits = [];
  if (collection.query?.tag) bits.push(['tag', [].concat(collection.query.tag).join(', ')]);
  if (collection.query?.path) bits.push(['path', collection.query.path]);
  for (const f of view.filter || []) bits.push([f.field, String(f.value ?? f.op)]);
  for (const s of view.sort || []) bits.push(['sort', s.field + (s.dir === 'desc' ? ' ↓' : ' ↑')]);
  return (
    <div style={sx('flex:none;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 20px 12px')}>
      <div style={sx('display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0')}>
        <span style={{ ...mono('font-size:9px;font-weight:700;letter-spacing:.16em'), color: 'var(--fg-faint)' }}>QUERY</span>
        {bits.map(([k, v], i) => (
          <span key={i} style={{ ...mono('font-size:10.5px;padding:2px 8px;border-radius:6px'), background: 'var(--sunk)', border: '1px solid var(--border)', color: 'var(--fg-muted)' }}>
            <span style={{ color: 'var(--fg-faint)' }}>{k}:</span> {v}
          </span>
        ))}
      </div>
      <span style={{ ...mono('font-size:10px;font-weight:500;letter-spacing:.06em;white-space:nowrap;font-variant-numeric:tabular-nums'), color: 'var(--fg-faint)' }}>
        {total} ROWS / {path}
      </span>
    </div>
  );
}

// ── the table ──────────────────────────────────────────────────────────────────────────────────
// `chrome` says who draws the view strip and the query bar. All four take it now; the flag stays
// because a future renderer (a calendar, a map) may legitimately want the whole pane. It is a
// property of the renderer, not a
// decision about the view — which is why it lives here as data and not as an `if` below.
export const RENDERERS = {
  table: { render: TableView, chrome: true },
  board: { render: BoardView, chrome: true },
  list: { render: ListView, chrome: true },
  gallery: { render: GalleryView, chrome: true },
};

export default function CollectionView(props) {
  const { collection, view, views, rows, counts, onPickView } = props;
  if (!collection || !view) return null;

  // An unknown type is a view file from a newer Scout, or a typo an agent wrote. It renders as a
  // table rather than as nothing: a person must always be able to see their records and fix the
  // view (Law 8 — nothing is hidden from the human who wants to look).
  const entry = RENDERERS[view.type] || RENDERERS.table;
  const Body = entry.render;

  if (!entry.chrome) return <Body {...props} />;

  return (
    <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden')}>
      <ViewTabs views={views} activeId={view.id} counts={counts} onPick={onPickView} />
      <QueryBar collection={collection} view={view} total={(rows || []).length} path={collection.query?.path || '—'} />
      <Body {...props} />
    </div>
  );
}
