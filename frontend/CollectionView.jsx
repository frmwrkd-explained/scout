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
//   + quarantined  [{ path, slug, title }]  records under this collection's query that were
//     written to `data/` without passing through records.mjs (docs/01_CANON.md Law 4 §3). Held OUT
//     of `rows`/`counts` on purpose — never counted until a human accepts them — but Law 8 says
//     nothing is hidden from a human who wants to look, so THIS file renders them (see
//     QuarantineStrip below), rather than leaving the prop threaded in and drawn by nobody.
//   + onAccept(path)  optional; present ⇒ the strip's Accept button calls it (`POST
//     /api/records/accept` — a human-only route). Absent ⇒ the record is still LISTED — visibility
//     does not depend on the write path existing — the button is simply not offered.

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import ViewBar from './ViewBar';
import TableView from './TableView';
import BoardView from './BoardView';
import ListView from './ListView';
import GalleryView from './GalleryView';
import { applyQuick, toggleQuick, quickKey, quickToFilter, fieldLabel } from './viewDisplay';

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

// ── quarantined — visible, never counted, until a human says otherwise (Law 4 §3 / Law 8) ───────
// `App` has threaded `quarantined` into this component since it landed (an audit found it "dropped
// for the cap"), and no view type ever rendered it — capability with no affordance, HANDOVER §3's
// exact pattern. A compact strip, not a row in the table: a quarantined record does not belong to
// the collection yet (it is excluded from `rows`, `counts`, every rollup and every score), so it
// must not read as though it does.
function QuarantineStrip({ items, onAccept }) {
  const [busy, setBusy] = React.useState(null);
  const [error, setError] = React.useState(null);
  if (!items || !items.length) return null;

  const accept = async path => {
    if (!onAccept || busy) return;
    setBusy(path); setError(null);
    try { await onAccept(path); }
    catch (e) { setError(e.message || String(e)); }
    finally { setBusy(null); }
  };

  return (
    <div style={{ ...sx('flex:none;display:flex;flex-direction:column;gap:8px;padding:10px 20px'), background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', borderLeft: '2px solid var(--warn)' }}>
      <div style={sx('display:flex;align-items:center;gap:10px;flex-wrap:wrap')}>
        <span style={{ ...mono('font-size:9px;font-weight:800;letter-spacing:.16em'), color: 'var(--warn)' }}>
          HELD APART <span style={mono('font-variant-numeric:tabular-nums')}>{items.length}</span>
        </span>
        <span style={{ ...sx('font-size:11px'), color: 'var(--fg-faint)' }}>
          Written into data/ without passing the pipeline — excluded from every count until accepted.
        </span>
      </div>
      <div style={sx('display:flex;flex-direction:column;gap:5px')}>
        {items.map(it => (
          <div key={it.path} style={sx('display:flex;align-items:center;gap:12px')}>
            <span style={{ ...sx('flex:1;min-width:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), color: 'var(--fg-soft)' }}>
              {it.title || it.slug}
            </span>
            <span style={{ ...mono('font-size:9.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:260px'), color: 'var(--fg-faint)' }}>
              {it.path}
            </span>
            {onAccept ? (
              <button type="button" onClick={() => accept(it.path)} disabled={busy === it.path} className="hAccent"
                style={{ ...mono('flex:none;font-size:9.5px;font-weight:700;letter-spacing:.08em;padding:3px 9px;border-radius:5px;cursor:pointer'), background: 'none', border: '1px solid var(--warn)', color: 'var(--warn)' }}>
                {busy === it.path ? 'ACCEPTING…' : 'ACCEPT'}
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {error ? (
        <span style={{ ...mono('font-size:9.5px;font-weight:600;letter-spacing:.04em'), color: 'var(--danger)' }}>{error}</span>
      ) : null}
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

// What the centre shows while a collection's rows are on their way. It names the collection being
// opened — the alternative was the PREVIOUS collection's table sitting under the new one's rail
// highlight for as long as the fetch took, which reads as the click not having worked.
export function CollectionLoading({ collection }) {
  return (
    <div className="collectionLoading" role="status" aria-live="polite">
      <span className="collectionLoadingBar" />
      <span>Opening {collection ? (collection.label || collection.id) : 'collection'}…</span>
    </div>
  );
}

// ── quick filters — the draft on top of the saved view ───────────────────────────────────────
// What is being shown, in words, with a way out of each part and a way to keep the whole.
function QuickStrip({ collection, quick, shown, of, onDrop, onClear, onKeep }) {
  if (!quick.length) return null;
  const fields = collection.fields || [];
  return (
    <div className="quickStrip">
      <span className="quickLead">Showing only</span>
      {quick.map(q => {
        const field = fields.find(f => f.key === q.field) || { key: q.field };
        return (
          <button key={quickKey(q)} type="button" className="quickChip hBd" onClick={() => onDrop(q)} title="Remove this filter">
            <span className="quickChipField">{fieldLabel(field)}</span>
            <span className="quickChipValue">{q.value}</span>
            <span aria-hidden="true" className="quickChipX">×</span>
          </button>
        );
      })}
      <span className="quickCount" style={{ fontFamily: MONO }}>{shown.toLocaleString('en-US')} of {of.toLocaleString('en-US')}</span>
      <span style={sx('flex:1')} />
      {onKeep ? <button type="button" className="quickAct hBdAccent" onClick={onKeep} title="Keep this as a view of its own, in the workspace">Save as view</button> : null}
      <button type="button" className="quickAct quickClear hFg" onClick={onClear}>Clear</button>
    </div>
  );
}

export default function CollectionView(props) {
  const { collection, view, views, rows, counts, onPickView } = props;
  if (!collection || !view) return null;

  // An unknown type is a view file from a newer Scout, or a typo an agent wrote. It renders as a
  // table rather than as nothing: a person must always be able to see their records and fix the
  // view (Law 8 — nothing is hidden from the human who wants to look).
  const entry = RENDERERS[view.type] || RENDERERS.table;
  const Body = entry.render;

  // A click on a value in a row (a category, a tag) narrows the view to the records that carry
  // it. It is a draft: dropped when the person moves to another view or collection, kept only if
  // they save it — and then it is an ordinary saved view the server filters.
  const [quick, setQuick] = React.useState([]);
  const scope = collection.id + '/' + view.id;
  // `startQuick` — { id, quick, n } — is a set somebody asked to see as a full page (from the
  // browse popup on a record, RecordPeek.jsx). It lands here as the same draft a click on a tag
  // would have made, so it can be dropped, added to, or saved as a view like any other.
  const start = props.startQuick && props.startQuick.id === collection.id ? props.startQuick : null;
  const startN = start ? start.n : 0;
  const usedStart = React.useRef(0);
  React.useEffect(() => {
    if (start && usedStart.current !== startN) { usedStart.current = startN; setQuick(start.quick); return; }
    setQuick([]);
  }, [scope, startN]);
  const shownRows = React.useMemo(() => applyQuick(rows, quick), [rows, quick]);
  const onPick = (field, value) => setQuick(q => toggleQuick(q, field, value));
  const keep = props.onSaveView ? () => {
    const label = quick.map(q => q.value).join(' · ');
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'view';
    const taken = (views || []).some(v => v.id === id);
    const { generated, ...base } = view;
    Promise.resolve(props.onSaveView({ ...base, id: taken ? id + '-' + Date.now().toString(36).slice(-4) : id, label, filter: [...(view.filter || []), ...quickToFilter(collection, quick)] })).catch(() => {});
  } : null;

  if (!entry.chrome) return <Body {...props} />;

  return (
    <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden')}>
      <ViewBar
        collection={collection} view={view} views={views} counts={quick.length ? { ...counts, [view.id]: shownRows.length } : counts} total={shownRows.length}
        onPickView={onPickView} onSaveView={props.onSaveView} onDeleteView={props.onDeleteView}
        onSchemaChanged={props.onSchemaChanged} onOpen={props.onOpen} actor={props.actor}
      />
      <QuarantineStrip items={props.quarantined} onAccept={props.onAccept} />
      <QuickStrip collection={collection} quick={quick} shown={shownRows.length} of={(rows || []).length}
        onDrop={q => setQuick(list => list.filter(x => quickKey(x) !== quickKey(q)))} onClear={() => setQuick([])} onKeep={keep} />
      <Body {...props} rows={shownRows} onPick={onPick} />
    </div>
  );
}
