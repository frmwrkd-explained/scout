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
import ViewBar from './ViewBar';
import TableView from './TableView';
import BoardView from './BoardView';
import ListView from './ListView';
import GalleryView from './GalleryView';

const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });

// ── the view strip ─────────────────────────────────────────────────────────────────────────────
// The strip that was here — one pill per saved view and nothing else — is now `ViewBar.jsx`, which
// draws the same pills plus the three controls the backend had always accepted and the UI had
// never offered: the view's SHAPE (table · board · list · gallery — board is the Kanban one), its
// row DENSITY, and a composer for a filtered sub-view. See that file for why they were missing.
//
// QueryBar stays here: it is a read-out of what the view is doing, not a control, and it belongs
// beside the renderers it explains.

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
      <ViewBar
        collection={collection} view={view} views={views} counts={counts}
        onPickView={onPickView} onSaveView={props.onSaveView} onDeleteView={props.onDeleteView}
      />
      <QueryBar collection={collection} view={view} total={(rows || []).length} path={collection.query?.path || '—'} />
      <Body {...props} />
    </div>
  );
}
