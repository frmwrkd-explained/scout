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
function ViewTabs({ views, activeId, counts, onPick }) {
  return (
    <div style={sx('flex:none;display:flex;align-items:center;gap:6px;padding:10px 20px 0;flex-wrap:wrap')}>
      {views.map(v => {
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
            {counts[v.id] != null ? (
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
// decoration: a collection IS a saved query, and a person who cannot see the query cannot tell
// why a record is missing from the list.
function QueryBar({ collection, view, total, path }) {
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

export default function TableView({ collection, view, views, rows, counts, selected, onSelect, onOpen, onPickView }) {
  const fieldsShown = (view.fields && view.fields.length ? view.fields : (collection.fields || []).slice(0, 6).map(f => f.key));
  const defs = fieldsShown.map(k => (collection.fields || []).find(f => f.key === k) || { key: k, type: 'text' });
  // The primary field is the title column and always leads, whatever the view says.
  const primary = (collection.fields || []).find(f => f.primary);

  return (
    <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden')}>
      <ViewTabs views={views} activeId={view.id} counts={counts} onPick={onPickView} />
      <QueryBar collection={collection} view={view} total={rows.length} path={collection.query?.path || '—'} />

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
                        : <Cell field={f} value={r.fields[f.key]} onOpen={onOpen} />}
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
