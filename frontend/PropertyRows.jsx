// PropertyRows — the typed frontmatter rows. ONE implementation, two densities.
//
// This is Tesseract's `FrontmatterEditor` / `PropertyRow` / `AddPropertyRow` pattern ported into
// React (docs/06_REUSE.md), and it is the component BOTH the document surface (Document.jsx) and
// the inspector's PROPERTIES section (Inspector.jsx) render. Law 10: the read view and the edit
// view of a property row are the same rows with `onChange` withheld, never two components — the
// day they are two is the day one of them learns about a field type and the other does not.
//
// It renders no field type itself. Every cell comes from `./cells` — `Editor` when a write is
// possible, `Cell` when it is not — because that dispatch table is the only place a field type
// becomes UI.
//
// Props
//   collection      the collection schema, or null. Null is normal: memory objects (territory/,
//                   playbook/, learnings/) have no schema, and their rows are inferred from the
//                   values themselves so they are still editable and still typed.
//   values          the document's frontmatter object.
//   onChange(key,v) omit to render read-only. Present ⇒ every non-derived row is editable.
//   onFollow(collection, id)   a relation chip was clicked.
//   options         { [fieldKey]: [{ value, label, kind }] } — the lists a schema cannot supply:
//                   relation targets and actors. Missing ⇒ the editor falls back to typing an id.
//   variant         'document' (32px rows, type gutter, 104px key) | 'inspector' (26px, 74px key).
//   hideEmpty       drop rows with no value. The inspector's default; the document's is false, so
//                   a declared-but-empty field is still there to fill in.
//   showAuto        include the automatic fields (created/updated/created_by/…) as read-only rows.
//   onAddProperty   present ⇒ renders `+ Add property` under the last row.

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { Cell, Editor, TYPE_ABBR, isDerived } from './cells';

const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });

// Mirrors backend/collections.mjs AUTO_FIELDS — every document carries these and no schema
// declares them (docs/02_DATA_MODEL.md §2). They are provenance, so they render read-only even
// when everything else is editable: `updated_by` is what Law 4 reads to ignore an agent promotion,
// and a field a human can retype is not provenance.
export const AUTO_FIELDS = ['created', 'updated', 'created_by', 'updated_by', 'verified_at', 'proposed', 'quarantined'];
const AUTO_TYPE = {
  created: 'date', updated: 'date', verified_at: 'date',
  created_by: 'actor', updated_by: 'actor', proposed: 'checkbox', quarantined: 'checkbox',
};

// A value with no schema still has a shape. Deliberately coarse — this only decides which editor
// opens, and the schema always wins when there is one.
function inferType(value) {
  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return 'multiselect';
  if (value && typeof value === 'object') return 'json';
  const s = String(value ?? '');
  if (/^https?:\/\//.test(s)) return 'url';
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return 'email';
  if (/^\d{4}-\d{2}-\d{2}([T ]|$)/.test(s)) return 'date';
  return 'text';
}

// The row set: declared fields first, in schema order, then anything else the file actually
// carries. A key in the frontmatter that no schema mentions is NOT hidden — Law 8, and it is
// usually the most interesting thing on the record.
export function rowsFor(collection, values, { hideEmpty = false, showAuto = false } = {}) {
  const declared = (collection?.fields || []);
  const seen = new Set(declared.map(f => f.key));
  const extra = Object.keys(values || {})
    .filter(k => !seen.has(k) && (showAuto || !AUTO_FIELDS.includes(k)))
    .map(k => (AUTO_FIELDS.includes(k)
      ? { key: k, type: AUTO_TYPE[k] || 'text', auto: true }
      : { key: k, type: inferType(values[k]), undeclared: true }));

  const all = [...declared, ...extra];
  if (!hideEmpty) return all;
  return all.filter(f => {
    const v = values?.[f.key];
    return !(v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length));
  });
}

const DENSITY = {
  document: { row: sx('display:flex;align-items:center;gap:12px;min-height:32px;padding:4px 8px;border-radius:6px'), key: 104, gutter: true, keyStyle: sx('font-size:9px;font-weight:800;letter-spacing:.16em') },
  inspector: { row: sx('display:flex;align-items:center;gap:10px;min-height:26px;padding:3px 0'), key: 74, gutter: false, keyStyle: sx('font-size:9.5px;font-weight:500') },
};

export function PropertyRow({ field, value, onChange, onFollow, options, variant = 'document' }) {
  const d = DENSITY[variant] || DENSITY.document;
  // Derived and automatic fields never take an onChange — the affordance IS the contract.
  const writable = !!onChange && !isDerived(field) && !field.auto;
  return (
    <div className={variant === 'document' ? 'hBg' : ''} style={{ ...d.row, transition: 'background 130ms ease' }}>
      {d.gutter ? (
        <span title={field.type} style={{ ...mono('flex:none;width:30px;font-size:8.5px;font-weight:700;letter-spacing:.06em'), color: 'var(--fg-faint)' }}>
          {TYPE_ABBR[field.type] || 'TXT'}
        </span>
      ) : null}
      <span title={field.key + (field.undeclared ? ' — not in the schema' : '')}
        style={{
          ...d.keyStyle, ...sx('flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'),
          width: d.key,
          fontFamily: variant === 'inspector' ? MONO : undefined,
          // An undeclared key is real and is shown, but it does not get to look like schema.
          color: field.undeclared || field.auto ? 'var(--fg-faint)' : 'var(--fg-muted)',
        }}>
        {variant === 'document' ? (field.label || field.key).replace(/_/g, ' ').toUpperCase() : field.key}
      </span>
      <span style={sx('flex:1;min-width:0;display:flex;align-items:center;gap:6px;flex-wrap:wrap')}>
        {writable
          ? <Editor field={field} value={value} onChange={onChange} onFollow={onFollow} options={options} />
          : <Editor field={field} value={value} onFollow={onFollow} />}
      </span>
    </div>
  );
}

export default function PropertyRows({
  collection, values, onChange, onFollow, options = {},
  variant = 'document', hideEmpty = variant === 'inspector', showAuto = false, onAddProperty,
}) {
  const rows = rowsFor(collection, values || {}, { hideEmpty, showAuto });

  if (!rows.length) {
    return (
      <span style={{ ...mono('font-size:9.5px;font-weight:500;letter-spacing:.08em'), color: 'var(--fg-faint)' }}>
        NO PROPERTIES SET
      </span>
    );
  }

  return (
    <div style={sx('display:flex;flex-direction:column')}>
      {rows.map(f => (
        <PropertyRow
          key={f.key}
          field={f}
          value={(values || {})[f.key]}
          onChange={onChange ? v => onChange(f.key, v) : null}
          onFollow={onFollow}
          options={options[f.key]}
          variant={variant}
        />
      ))}

      {/* A new property is a SCHEMA change (docs/02_DATA_MODEL.md §6), so this hands off to the
          surface rather than writing a field here. On the agent's side the same change arrives as
          a proposal card; on the human's it is one click. Neither writes the schema from a row. */}
      {onAddProperty ? (
        <button type="button" onClick={onAddProperty} className="hBg"
          style={{ ...sx('display:flex;align-items:center;gap:12px;height:30px;padding:0 8px;border-radius:6px;background:none;border:none;cursor:pointer;transition:background 130ms ease') }}>
          <span style={{ ...mono('flex:none;width:30px;font-size:11px;text-align:left'), color: 'var(--fg-faint)' }}>+</span>
          <span style={{ ...sx('font-size:11.5px;font-weight:600'), color: 'var(--accent)' }}>Add property</span>
        </button>
      ) : null}
    </div>
  );
}

// Re-exported so a surface that needs one lone read-only cell does not reach past this module for
// it and end up with a second row implementation next to this one.
export { Cell };
