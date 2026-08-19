// Typed cell renderers — one per field type, dispatched by the type in backend/collections.mjs.
//
// The dispatch table is the ONLY place a field type becomes a piece of UI. Adding a type means
// adding a line here and a line there, never a branch inside a table or a document surface.
// `docs/02_DATA_MODEL.md` §2 is the list; `design/Scout.dc.html` is the look.
//
// Read-only for now. T04 makes these editable in place; the split is deliberate so the table can
// ship against real data before the editors exist.

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { Freshness } from './Freshness';

const mono = (extra = '') => ({ ...sx('font-size:11px;font-weight:500;font-variant-numeric:tabular-nums;' + extra), fontFamily: MONO });

// A status chip tints BORDER AND TEXT, never the fill — `docs/05_UI_SPEC.md` §6: selected is a
// neutral raised chip, an accent fill is the one primary action on the screen.
export function StatusChip({ value, field }) {
  if (value == null || value === '') return <Dash />;
  const opt = (field?.options || []).find(o => (typeof o === 'string' ? o : o.value) === value);
  const colour = (typeof opt === 'object' && opt?.colour) || 'var(--border-2)';
  return (
    <span style={{ ...sx('display:inline-flex;align-items:center;gap:6px;height:19px;padding:0 9px;border-radius:9999px;font-size:9px;font-weight:800;letter-spacing:.1em;white-space:nowrap'), border: '1px solid ' + colour, color: 'var(--fg-muted)' }}>
      <span style={{ ...sx('width:5px;height:5px;border-radius:9999px;flex:none'), background: colour }} />
      {String(value).replace(/-/g, ' ').toUpperCase()}
    </span>
  );
}

function Dash() {
  return <span style={{ ...mono(), color: 'var(--border-3)' }}>—</span>;
}

// `display` is why there is no separate score or rating type (docs/02_DATA_MODEL.md §2).
function NumberCell({ value, field }) {
  if (value == null || value === '') return <Dash />;
  const n = Number(value);
  if (field?.display === 'bar') {
    const min = field.min ?? 0, max = field.max ?? 10;
    const pct = Math.max(0, Math.min(1, (n - min) / (max - min || 1)));
    return (
      <span style={sx('display:inline-flex;align-items:center;gap:8px')}>
        <span style={{ ...mono('font-size:11.5px;font-weight:600'), color: 'var(--fg-soft)' }}>{n}</span>
        <span style={sx('display:flex;gap:1.5px;height:4px;width:56px;flex:none')}>
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} style={{ ...sx('flex:1;border-radius:1px'), background: i < Math.round(pct * 10) ? 'var(--fg-muted)' : 'var(--border)' }} />
          ))}
        </span>
      </span>
    );
  }
  if (field?.display === 'stars') return <span style={mono()}>{'★'.repeat(Math.round(n))}</span>;
  if (field?.display === 'currency') return <span style={{ ...mono(), color: 'var(--sand)' }}>{n.toLocaleString()}</span>;
  return <span style={{ ...mono('font-size:11.5px;font-weight:600'), color: 'var(--fg-soft)' }}>{n.toLocaleString()}</span>;
}

function TagList({ value }) {
  const tags = [].concat(value ?? []).filter(Boolean);
  if (!tags.length) return <Dash />;
  return (
    <span style={sx('display:inline-flex;flex-wrap:wrap;gap:4px')}>
      {tags.slice(0, 4).map(t => (
        <span key={String(t)} style={{ ...mono('font-size:10px;padding:2px 7px;border-radius:6px'), background: 'var(--raise)', border: '1px solid var(--border)', color: 'var(--fg-muted)' }}>
          {String(t)}
        </span>
      ))}
    </span>
  );
}

// A relation is a chip that opens the other document. It renders as `#collection/slug` so the
// person can see WHICH collection they are about to jump into — the design does this and it is
// the difference between a link and a guess.
function RelationCell({ value, field, onOpen }) {
  const ids = [].concat(value ?? []).filter(Boolean);
  if (!ids.length) return <Dash />;
  return (
    <span style={sx('display:inline-flex;flex-wrap:wrap;gap:4px')}>
      {ids.slice(0, 3).map(id => (
        <button
          key={String(id)}
          onClick={onOpen ? e => { e.stopPropagation(); onOpen(field?.target, String(id)); } : undefined}
          style={{ ...mono('font-size:10px;padding:2px 7px;border-radius:6px;cursor:pointer'), background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--fg-muted)' }}
        >
          {(field?.target ? '#' + field.target + '/' : '') + String(id)}
        </button>
      ))}
    </span>
  );
}

function DateCell({ value, field }) {
  if (!value) return <Dash />;
  if (field?.display === 'freshness') return <Freshness value={value} />;
  if (field?.display === 'relative') return <Freshness value={value} width={0} />;
  return <span style={{ ...mono(), color: 'var(--fg-muted)' }}>{String(value)}</span>;
}

function LinkCell({ value, kind }) {
  if (!value) return <Dash />;
  const href = kind === 'email' ? 'mailto:' + value : kind === 'phone' ? 'tel:' + value : String(value);
  return <a href={href} target="_blank" rel="noreferrer" style={{ ...mono(), color: 'var(--accent)' }}>{String(value)}</a>;
}

// ── the dispatch table ─────────────────────────────────────────────────────────────────────────
const RENDERERS = {
  status: (v, f) => <StatusChip value={v} field={f} />,
  number: (v, f) => <NumberCell value={v} field={f} />,
  date: (v, f) => <DateCell value={v} field={f} />,
  multiselect: v => <TagList value={v} />,
  select: (v, f) => <StatusChip value={v} field={f} />,
  checkbox: v => (
    <span style={{ ...mono('font-size:10px;font-weight:700;letter-spacing:.1em'), color: v ? 'var(--ok)' : 'var(--fg-faint)' }}>
      {v ? 'YES' : 'NO'}
    </span>
  ),
  url: v => <LinkCell value={v} kind="url" />,
  email: v => <LinkCell value={v} kind="email" />,
  phone: v => <LinkCell value={v} kind="phone" />,
  actor: v => (v ? <span style={{ ...mono('font-size:10.5px'), color: 'var(--marked)' }}>{String(v)}</span> : <Dash />),
  json: v => <span style={{ ...mono('font-size:10px'), color: 'var(--fg-faint)' }}>{v ? '{…}' : '—'}</span>,
};

export function Cell({ field, value, onOpen }) {
  if (field?.type === 'relation') return <RelationCell value={value} field={field} onOpen={onOpen} />;
  const render = RENDERERS[field?.type];
  if (render) return render(value, field);
  // text, rollup, formula, file and anything a schema invents fall through to a plain read. A
  // missing renderer must never blank a cell — the value is still the truth.
  if (value == null || value === '') return <Dash />;
  return <span style={sx('font-size:12px;color:var(--fg-soft)')}>{String(value)}</span>;
}

export default Cell;
