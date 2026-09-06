// The collection table — the default view type, and the densest surface in the app.
//
// One component per view type, chosen by the view's `type` (docs/05_UI_SPEC.md §3). This is
// `table`. Measurements and the query-bar shape come from `design/Scout.dc.html`; the typed cells
// come from `./cells`, which is the only place a field type becomes UI.
//
// Density stays (§6). Every figure is mono with tabular numerals so digits line up down a column.

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { Cell } from './cells';
import { Empty, OpenRecord } from './ui';
import { densityOf } from './ViewBar';

const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });

// The view strip: one pill per saved view, count on each. Selected is a raised neutral chip with a
// --border-3 edge — never an accent fill (§6: one solid accent fill per screen, and it is the
// primary action, not a tab).
// ViewTabs and QueryBar used to live here as private copies, byte-equivalent to the ones in
// CollectionView.jsx. That was a second implementation of one strip (Law 10) — it existed only
// because this file drew its own chrome before the dispatcher was written. The dispatcher now draws
// it for all four view types, so a change to the query bar lands on the board, the list and the
// gallery at the same time instead of on the table alone.

export default function TableView({ collection, view, views, rows, counts, selected, onSelect, onOpen, onFollow, onPickView, onSaveView }) {
  // The row scale the view was saved with. `density` has been on the view object since M1 and
  // this is its first reader — see ViewBar.jsx.
  const d = densityOf(view);
  const fieldsShown = (view.fields && view.fields.length ? view.fields : (collection.fields || []).slice(0, 6).map(f => f.key));
  const defs = fieldsShown.map(k => (collection.fields || []).find(f => f.key === k) || { key: k, type: 'text' });
  // The primary field is the title column and always leads, whatever the view says.
  const primary = (collection.fields || []).find(f => f.primary);

  // Sorting existed only through ViewBar's Filters composer (design/EXTRACT.md §2 wants a header
  // click too, item 9). One writer: this calls the SAME `onSaveView` the composer calls, into the
  // SAME saved-view path (`.scout/views/<collection>.json`) — a session-only sort would disagree
  // with what an agent or another machine sees of "this view", and Law 1 says the file is the
  // truth. none → asc → desc → none, one field at a time (ViewComposer's own sort picker manages
  // only one field too — a second, independent multi-sort model here would be the second
  // implementation Law 10 warns about).
  const sortField = view.sort?.[0]?.field || null;
  const sortDir = view.sort?.[0]?.dir || null;
  const cycleSort = key => {
    if (!onSaveView) return;
    const sort = sortField !== key ? [{ field: key, dir: 'asc' }]
      : sortDir === 'asc' ? [{ field: key, dir: 'desc' }]
      : [];
    onSaveView({ ...view, sort });
  };

  return (
    <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden')}>
      <div style={sx('flex:1;min-height:0;overflow:auto')}>
        <table style={sx('width:100%;border-collapse:collapse')}>
          <thead>
            <tr>
              {defs.map(f => {
                const on = sortField === f.key;
                return (
                  <th key={f.key} style={{ ...sx('text-align:left;padding:0;position:sticky;top:0;background:var(--ink)'), borderBottom: '1px solid var(--line)' }}>
                    {onSaveView ? (
                      <button type="button" onClick={() => cycleSort(f.key)} className="hFg"
                        title={!on ? 'Sort by ' + (f.label || f.key) : sortDir === 'asc' ? 'Sorting ascending — click for descending' : 'Sorting descending — click to clear'}
                        style={{ ...mono('display:flex;align-items:center;gap:5px;width:100%;padding:0 14px 8px;font-size:9px;font-weight:700;letter-spacing:.16em;background:none;border:none;cursor:pointer;text-align:left'), color: on ? 'var(--fg-soft)' : 'var(--fg-muted)' }}>
                        <span>{(f.label || f.key).replace(/_/g, ' ').toUpperCase()}</span>
                        <span style={{ ...sx('font-size:8px;line-height:1'), opacity: on ? 1 : 0, color: 'var(--fg-faint)' }}>{sortDir === 'asc' ? '▲' : '▼'}</span>
                      </button>
                    ) : (
                      <span style={{ ...mono('display:block;padding:0 14px 8px;font-size:9px;font-weight:700;letter-spacing:.16em'), color: 'var(--fg-muted)' }}>
                        {(f.label || f.key).replace(/_/g, ' ').toUpperCase()}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const on = selected === r.path;
              return (
                // `rvH` arms the reveal-on-hover chrome in the title cell. The row still opens on
                // double-click — OpenRecord makes that gesture discoverable rather than replacing it.
                <tr key={r.path} className="rvH"
                  onClick={() => onSelect(r)}
                  onDoubleClick={() => onOpen(r)}
                  style={{
                    ...sx('cursor:pointer;transition:background 130ms ease'),
                    background: on ? 'var(--raise)' : 'transparent',
                    borderBottom: '1px solid var(--line)',
                  }}>
                  {defs.map(f => (
                    <td key={f.key} style={{ ...sx('vertical-align:middle'), padding: d.pad, lineHeight: d.line }}>
                      {f.key === primary?.key
                        ? (
                          <span style={{ ...sx('display:flex;align-items:center;min-width:0'), gap: d.gap }}>
                            <span style={{ ...sx('min-width:0;overflow:hidden;text-overflow:ellipsis;font-weight:600'), fontSize: d.font, color: on ? 'var(--fg)' : 'var(--fg-soft)' }}>{r.title}</span>
                            <OpenRecord onOpen={() => onOpen(r)} />
                          </span>
                        )
                        : <Cell field={f} value={r.fields[f.key]} onFollow={onFollow} />}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>

        {!rows.length ? (
          <div style={sx('padding:40px 20px;display:flex;justify-content:center')}>
            <Empty
              size="page"
              style={sx('max-width:420px')}
              title="Nothing matches this view"
              body="The collection's query and this view's filters together return no records. Nothing is hidden — widen either one."
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
