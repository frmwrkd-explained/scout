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
import { Empty } from './ui';

const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });

// The view strip: one pill per saved view, count on each. Selected is a raised neutral chip with a
// --border-3 edge — never an accent fill (§6: one solid accent fill per screen, and it is the
// primary action, not a tab).
// ViewTabs and QueryBar used to live here as private copies, byte-equivalent to the ones in
// CollectionView.jsx. That was a second implementation of one strip (Law 10) — it existed only
// because this file drew its own chrome before the dispatcher was written. The dispatcher now draws
// it for all four view types, so a change to the query bar lands on the board, the list and the
// gallery at the same time instead of on the table alone.

export default function TableView({ collection, view, views, rows, counts, selected, onSelect, onOpen, onFollow, onPickView }) {
  const fieldsShown = (view.fields && view.fields.length ? view.fields : (collection.fields || []).slice(0, 6).map(f => f.key));
  const defs = fieldsShown.map(k => (collection.fields || []).find(f => f.key === k) || { key: k, type: 'text' });
  // The primary field is the title column and always leads, whatever the view says.
  const primary = (collection.fields || []).find(f => f.primary);

  return (
    <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden')}>
      <div style={sx('flex:1;min-height:0;overflow:auto')}>
        <table style={sx('width:100%;border-collapse:collapse')}>
          <thead>
            <tr>
              {defs.map(f => (
                <th key={f.key} style={{ ...mono('text-align:left;padding:0 14px 8px;font-size:9px;font-weight:700;letter-spacing:.16em;position:sticky;top:0;background:var(--ink)'), color: 'var(--fg-muted)', borderBottom: '1px solid var(--line)' }}>
                  {(f.label || f.key).replace(/_/g, ' ').toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const on = selected === r.path;
              return (
                <tr key={r.path}
                  onClick={() => onSelect(r)}
                  onDoubleClick={() => onOpen(r)}
                  style={{
                    ...sx('cursor:pointer;transition:background 130ms ease'),
                    background: on ? 'var(--raise)' : 'transparent',
                    borderBottom: '1px solid var(--line)',
                  }}>
                  {defs.map(f => (
                    <td key={f.key} style={sx('padding:9px 14px;vertical-align:middle')}>
                      {f.key === primary?.key
                        ? <span style={{ ...sx('font-size:12.5px;font-weight:600'), color: on ? 'var(--fg)' : 'var(--fg-soft)' }}>{r.title}</span>
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
