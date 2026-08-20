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
// ── what the first read of this screen actually looked like ───────────────────────────────────
// Fifteen rows at 40px, every label SHOUTED in 9px mono at .16em tracking, a three-letter type
// word (`TXT STA SEL REL NUM DTE Y/N TAG WHO`) down the left gutter, and six machine fields —
// created, updated, created_by, provenance, updated_by, verified_at — sitting in the same list as
// the person's own, printing `2026-08-15T00:00:00.000Z` at full width. Reported, accurately, as
// "super hard to read, super cluttered, and not well-organized".
//
// Three changes, all of them from the references:
//   · the type gutter is an ICON (Tesseract `PropertyRow`, `TypePickerDropdown`), not a word;
//   · the rows are TIGHT — Obsidian's own `--metadata-gap: 3px` / `--metadata-input-height:
//     ~1.75em`, against the 40px this had. `app.css` in /Applications/Obsidian.app is the source;
//   · the machine fields are their OWN collapsed group, because provenance is not a property the
//     person maintains and mixing the two is what made fifteen rows out of nine.
// Labels are sentence case. Obsidian prints a property name as written; ALL CAPS is for the one
// eyebrow above a section, not for every row inside it.
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
//   variant         'document' (28px rows, icon gutter, 136px key) | 'inspector' (24px, 88px key).
//   hideEmpty       drop rows with no value. The inspector's default; the document's is false, so
//                   a declared-but-empty field is still there to fill in.
//   showAuto        include the automatic fields (created/updated/created_by/…). They render as
//                   their own collapsed SYSTEM group, never mixed into the person's own rows.
//   onAddProperty   present ⇒ renders the inline `+ Add property` row under the last one.
//   addComposer     a node to render INSTEAD of that row while it is open. It takes the row's slot
//                   rather than being mounted by the caller after this component, so the composer
//                   appears where the property will appear — above SYSTEM, not below it.

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { Cell, Editor, FieldIcon, TYPE_ABBR, isDerived } from './cells';

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

// `provenance` is written by the pipeline (records.mjs PIPELINE_FIELDS) and is not in AUTO_FIELDS
// because a schema MAY declare it. When it is undeclared it is still machine-written, so it rides
// with the machine rows rather than looking like something the person typed.
const MACHINE_EXTRA = ['provenance', 'archived', 'archived_at', 'archived_by', 'archive_reason', 'archived_from', 'history', 'rev'];
const isMachine = f => !!f.auto || (f.undeclared && MACHINE_EXTRA.includes(f.key));

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

// Obsidian's numbers, converted. `--metadata-input-height: calc(font-size * 1.75)` ≈ 28px at the
// 16px body it ships with; `--metadata-gap: 3px`; `--metadata-label-width: 9em`. The inspector is
// one step tighter again because it is a 302px rail, not a page.
const DENSITY = {
  document: {
    row: sx('display:flex;align-items:center;gap:10px;min-height:28px;padding:2px 8px;border-radius:5px'),
    key: 136, gutter: true, keyStyle: sx('font-size:12px;font-weight:500'), pad: 'padding:2px 0',
  },
  inspector: {
    row: sx('display:flex;align-items:center;gap:8px;min-height:24px;padding:1px 0;border-radius:4px'),
    key: 88, gutter: false, keyStyle: sx('font-size:11px;font-weight:500'), pad: 'padding:1px 0',
  },
};

// `found_in` → `Found in`. Sentence case, not Title Case: a property name is a label, not a
// heading, and Title Case on nine rows is nine capital letters competing with the values.
export function propertyLabel(field) {
  const raw = field.label || field.key;
  const words = String(raw).replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function PropertyRow({ field, value, onChange, onFollow, options, variant = 'document' }) {
  const d = DENSITY[variant] || DENSITY.document;
  // Derived and automatic fields never take an onChange — the affordance IS the contract.
  const writable = !!onChange && !isDerived(field) && !field.auto;
  const machine = isMachine(field);
  return (
    <div className="hBg" style={{ ...d.row, transition: 'background 130ms ease' }}>
      {d.gutter ? (
        <span title={TYPE_ABBR[field.type] ? field.type : 'text'}
          style={{ ...sx('flex:none;display:flex;align-items:center;justify-content:center;width:18px'), color: 'var(--fg-faint)' }}>
          <FieldIcon type={field.type} />
        </span>
      ) : null}
      <span title={field.key + (field.undeclared ? ' — not in the schema' : '')}
        style={{
          ...d.keyStyle, ...sx('flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'),
          width: d.key,
          color: machine ? 'var(--fg-faint)' : 'var(--fg-muted)',
        }}>
        {propertyLabel(field)}
      </span>
      <span style={sx('flex:1;min-width:0;display:flex;align-items:center;gap:6px;flex-wrap:wrap')}>
        {writable
          ? <Editor field={field} value={value} onChange={onChange} onFollow={onFollow} options={options} />
          : <Editor field={field} value={value} onFollow={onFollow} />}
      </span>
    </div>
  );
}

// The machine rows, behind one disclosure. Not hidden — Law 8 — but not competing with the nine
// rows the person actually maintains either. Closed by default and remembered nowhere on purpose:
// it is a glance, not a working state, and a sticky-open provenance list is the clutter again.
function SystemGroup({ rows, values, onFollow, variant }) {
  const [open, setOpen] = React.useState(false);
  const d = DENSITY[variant] || DENSITY.document;
  return (
    <div style={sx('display:flex;flex-direction:column;margin-top:4px')}>
      <button type="button" onClick={() => setOpen(v => !v)} className="hBg"
        style={{ ...sx('display:flex;align-items:center;gap:8px;padding:3px 8px;border-radius:5px;background:none;border:none;cursor:pointer;text-align:left;transition:background 130ms ease') }}>
        <span style={{ ...mono('flex:none;width:9px;font-size:8px'), color: 'var(--fg-faint)' }}>{open ? '▾' : '▸'}</span>
        <span style={{ ...mono('font-size:8.5px;font-weight:700;letter-spacing:.16em'), color: 'var(--fg-faint)' }}>SYSTEM</span>
        <span style={{ ...mono('font-size:9.5px;font-weight:600;font-variant-numeric:tabular-nums'), color: 'var(--fg-faint)' }}>{rows.length}</span>
        {!open ? (
          <span style={{ ...sx('font-size:11px'), color: 'var(--fg-faint)' }}>
            written by the pipeline — provenance, not properties
          </span>
        ) : null}
      </button>
      {open ? (
        <div style={sx('display:flex;flex-direction:column;' + d.pad)}>
          {rows.map(f => (
            <PropertyRow key={f.key} field={f} value={(values || {})[f.key]} onFollow={onFollow} variant={variant} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function PropertyRows({
  collection, values, onChange, onFollow, options = {},
  variant = 'document', hideEmpty = variant === 'inspector', showAuto = false, onAddProperty, addComposer,
}) {
  const rows = rowsFor(collection, values || {}, { hideEmpty, showAuto });
  const own = rows.filter(f => !isMachine(f));
  const machine = rows.filter(isMachine);

  if (!rows.length) {
    return (
      <span style={{ ...mono('font-size:9.5px;font-weight:500;letter-spacing:.08em'), color: 'var(--fg-faint)' }}>
        NO PROPERTIES SET
      </span>
    );
  }

  return (
    <div style={sx('display:flex;flex-direction:column')}>
      {own.map(f => (
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
          a proposal card; on the human's it is one row. Neither writes the schema from a row.
          It is an inline ROW and not a button that opens a modal — Tesseract's `AddPropertyRow`,
          and the reason is that a full-screen dialog to add one column reads as a bigger decision
          than adding a column is. */}
      {addComposer || (onAddProperty ? (
        <button type="button" onClick={onAddProperty} className="hBg"
          style={{ ...(DENSITY[variant] || DENSITY.document).row, background: 'none', border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left', color: 'var(--fg-faint)', transition: 'background 130ms ease' }}>
          {(DENSITY[variant] || DENSITY.document).gutter ? (
            <span style={sx('flex:none;display:flex;align-items:center;justify-content:center;width:18px;font-size:13px;line-height:1')}>+</span>
          ) : null}
          <span style={sx('font-size:12px;font-weight:500')}>Add property</span>
        </button>
      ) : null)}

      {machine.length ? (
        <SystemGroup rows={machine} values={values} onFollow={onFollow} variant={variant} />
      ) : null}
    </div>
  );
}

// Re-exported so a surface that needs one lone read-only cell does not reach past this module for
// it and end up with a second row implementation next to this one.
export { Cell };
