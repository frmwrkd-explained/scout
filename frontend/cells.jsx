// Typed cell renderers — one per field type, dispatched by the type in backend/collections.mjs.
//
// The dispatch table is the ONLY place a field type becomes a piece of UI. Adding a type means
// adding a line here and a line there, never a branch inside a table or a document surface.
// `docs/02_DATA_MODEL.md` §2 is the list; `design/Scout.dc.html` is the look.
//
// TWO tables live here, deliberately: RENDERERS (read) and EDITORS (write, T04, second half of the
// file). A surface picks one by whether it passes `onChange`, which is why the inspector's
// PROPERTIES and the document surface can be the SAME component (PropertyRows.jsx) rather than a
// read one and a write one that drift.

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { Freshness } from './Freshness';
import { useContextMenu } from './ContextMenu';
import { Chip, Input } from './ui';

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
function RelationCell({ value, field, onFollow }) {
  const ids = [].concat(value ?? []).filter(Boolean);
  if (!ids.length) return <Dash />;
  return (
    <span style={sx('display:inline-flex;flex-wrap:wrap;gap:4px')}>
      {ids.slice(0, 3).map(id => (
        <button
          key={String(id)}
          onClick={onFollow ? e => { e.stopPropagation(); onFollow(field?.target, String(id)); } : undefined}
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
  // Same trim as the editor, and for the same reason: a table cell printing a full ISO instant
  // is twenty-four characters where ten carry the meaning. See dateFieldText.
  return <span style={{ ...mono(), color: 'var(--fg-muted)' }}>{dateFieldText(value, !!field?.time)}</span>;
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

export function Cell({ field, value, onFollow }) {
  if (field?.type === 'relation') return <RelationCell value={value} field={field} onFollow={onFollow} />;
  const render = RENDERERS[field?.type];
  if (render) return render(value, field);
  // text, rollup, formula, file and anything a schema invents fall through to a plain read. A
  // missing renderer must never blank a cell — the value is still the truth.
  if (value == null || value === '') return <Dash />;
  return <span style={sx('font-size:12px;color:var(--fg-soft)')}>{String(value)}</span>;
}

export default Cell;

// ══ EDITORS ═══════════════════════════════════════════════════════════════════════════════════
// T04. One editor per field type, dispatched from EDITORS below exactly the way `Cell` dispatches
// the read-only renderers above. Same rule, same reason: adding a field type is a line HERE and a
// line THERE, never a branch inside PropertyRows, the table or the document surface.
//
// Every editor takes one shape:
//   { field, value, onChange, onFollow, options }
//   onChange(next)  the new VALUE for this field — never a patch and never a key. The row owns the
//                   key and the surface owns the write, so an editor cannot save the wrong field.
//   options         [{ value, label }] for the pickers a schema cannot supply on its own —
//                   relation targets and actors. Ignored by every other type.
//
// `rollup` and `formula` are DERIVED (docs/02_DATA_MODEL.md §2): computed on read, never authored.
// They dispatch to `Computed`, which renders read-only and SAYS SO. An editable-looking derived
// value is a lie about where the number came from, and the day someone types into one is the day
// the cache stops being disposable.

// The 30px type gutter in the design (`design/Scout.dc.html`: TXT · SEL · TAG · REL · NUM · DTE ·
// Y/N). Extended to all sixteen types. `status` gets STA, not the design's SEL: a status is NOT a
// select (docs/02_DATA_MODEL.md §2) and the gutter is the one place that difference is free to show.
export const TYPE_ABBR = {
  text: 'TXT', number: 'NUM', select: 'SEL', multiselect: 'TAG', status: 'STA', date: 'DTE',
  checkbox: 'Y/N', url: 'URL', email: '@', phone: 'TEL', relation: 'REL', rollup: 'Σ',
  formula: 'FX', file: 'FIL', actor: 'WHO', json: '{ }',
};

// ── the type icon ──────────────────────────────────────────────────────────────────────────────
// Tesseract's `PropertyRow` marks a row's type with an ICON, not a word (docs/06_REUSE.md —
// `TypePickerDropdown.svelte` carries one per type). Scout used a three-letter mono abbreviation
// in a 30px gutter — `TXT STA SEL REL NUM DTE Y/N TAG WHO` down the left of every record — which
// is nine more words to read on a surface whose whole job is to be scanned. An icon is recognised
// without being read.
//
// Inline SVG on `currentColor`, no icon font: Scout has three runtime dependencies and this is not
// worth a fourth. 16px box, 1.5 stroke — the lucide geometry Obsidian also uses, drawn by hand.
// `TYPE_ABBR` stays exported: the type PICKER names types in words, and a picker that only showed
// glyphs would make someone guess.
const P = d => <path d={d} />;
const ICONS = {
  text: <>{P('M4 7h16')}{P('M4 12h10')}{P('M4 17h13')}</>,
  number: <>{P('M6 4 4 20')}{P('M14 4l-2 16')}{P('M3 9h17')}{P('M2 15h17')}</>,
  select: <>{P('M6 9l6 6 6-6')}</>,
  multiselect: <>{P('M3 6h13')}{P('M3 12h8')}{P('M3 18h13')}{P('M19 9l2 3-2 3')}</>,
  status: <><circle cx="12" cy="12" r="8" />{P('M12 8v4l3 2')}</>,
  date: <><rect x="3" y="5" width="18" height="16" rx="2" />{P('M3 10h18')}{P('M8 3v4')}{P('M16 3v4')}</>,
  checkbox: <><rect x="3" y="3" width="18" height="18" rx="3" />{P('M8 12l3 3 5-6')}</>,
  url: <>{P('M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1')}{P('M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1')}</>,
  email: <><rect x="2" y="5" width="20" height="14" rx="2" />{P('M2 7l10 7 10-7')}</>,
  phone: <>{P('M5 3h4l2 5-3 2a13 13 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z')}</>,
  relation: <><circle cx="6" cy="6" r="3" /><circle cx="18" cy="18" r="3" />{P('M6 9v6a3 3 0 0 0 3 3h6')}</>,
  rollup: <>{P('M5 4h14L9 12l10 8H5')}</>,
  formula: <>{P('M7 20V8a4 4 0 0 1 4-4h1')}{P('M5 12h8')}{P('M14 11l6 8')}{P('M20 11l-6 8')}</>,
  file: <>{P('M14 3v5h5')}{P('M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z')}</>,
  actor: <><circle cx="12" cy="8" r="4" />{P('M4 21a8 8 0 0 1 16 0')}</>,
  json: <>{P('M9 4H7a2 2 0 0 0-2 2v4l-2 2 2 2v4a2 2 0 0 0 2 2h2')}{P('M15 4h2a2 2 0 0 1 2 2v4l2 2-2 2v4a2 2 0 0 1-2 2h-2')}</>,
};

export function FieldIcon({ type, size = 15, title, style }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden={title ? undefined : 'true'} focusable="false"
      fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      style={{ ...sx('flex:none;display:block'), ...style }}>
      {title ? <title>{title}</title> : null}
      {ICONS[type] || ICONS.text}
    </svg>
  );
}

export function isDerived(field) {
  return field?.type === 'rollup' || field?.type === 'formula';
}

// A schema option is either a bare string or { value, colour, group } — normalised once, here,
// so no editor has to know both shapes.
function optionsOf(field) {
  return (field?.options || []).map(o => (typeof o === 'string' ? { value: o } : o)).filter(o => o && o.value);
}
function colourOf(field, value) {
  const o = optionsOf(field).find(x => String(x.value) === String(value));
  return (o && o.colour) || 'var(--border-2)';
}
const asList = v => [].concat(v ?? []).filter(v2 => v2 !== '' && v2 != null);

// ── the shared text well ───────────────────────────────────────────────────────────────────────
// design/Scout.dc.html: a 26px input with a TRANSPARENT border that only appears on hover/focus, so
// a page of properties reads as text and not as a form. `hBd` (styles.css) is the hover half;
// focus is state because a React inline style cannot express `:focus`.
function TextInput({ value, onChange, placeholder = '', multiline = false, invalid = false, monospace = false, width = 420 }) {
  const [draft, setDraft] = React.useState(value == null ? '' : String(value));
  const [focus, setFocus] = React.useState(false);
  // While focused the draft is the truth — a save round-trip landing mid-keystroke must not
  // yank the caret back.
  React.useEffect(() => { if (!focus) setDraft(value == null ? '' : String(value)); }, [value, focus]);

  const commit = () => {
    setFocus(false);
    if (draft !== (value == null ? '' : String(value))) onChange(draft);
  };
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <Tag
      className="hBd"
      value={draft}
      placeholder={placeholder}
      onChange={e => setDraft(e.target.value)}
      onFocus={() => setFocus(true)}
      onBlur={commit}
      onKeyDown={e => {
        e.stopPropagation();               // `P` toggles properties on the surface above this
        if (e.key === 'Enter' && !multiline) { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); setDraft(value == null ? '' : String(value)); e.currentTarget.blur(); }
      }}
      style={{
        ...sx('padding:4px 8px;border-radius:6px;font-size:12.5px;box-sizing:border-box;width:100%'),
        maxWidth: width, height: multiline ? undefined : 26, minHeight: multiline ? 72 : undefined,
        resize: multiline ? 'vertical' : 'none', lineHeight: multiline ? 1.6 : undefined,
        fontFamily: monospace ? MONO : 'inherit',
        fontVariantNumeric: monospace ? 'tabular-nums' : undefined,
        color: 'var(--fg-soft)',
        background: focus ? 'var(--sunk)' : 'transparent',
        border: '1px solid ' + (invalid ? 'var(--danger)' : focus ? 'var(--border-3)' : 'transparent'),
        outline: 'none',
      }}
    />
  );
}

// A bare, unstyled button — the reset every chip-shaped control below starts from.
const BARE = sx('display:inline-flex;align-items:center;gap:7px;background:none;border:none;padding:0;margin:0;cursor:pointer;font:inherit;color:inherit');

// The empty-value affordance. A dash you cannot click is how a property surface becomes read-only
// by accident; this is a real target that says what it wants.
function SetChip({ label = 'SET' }) {
  return (
    <span style={{ ...mono('font-size:9px;font-weight:800;letter-spacing:.1em;height:19px;padding:0 9px;border-radius:9999px;display:inline-flex;align-items:center'), border: '1px dashed var(--border-2)', color: 'var(--fg-faint)' }}>
      {label}
    </span>
  );
}

const Caret = () => <span style={{ ...mono('font-size:8px'), color: 'var(--fg-faint)' }}>▾</span>;

// ── text ───────────────────────────────────────────────────────────────────────────────────────
function TextEditor({ field, value, onChange }) {
  return (
    <TextInput
      value={value}
      onChange={v => onChange(v === '' ? null : v)}
      multiline={!!field?.multiline}
      placeholder={field?.multiline ? 'Write…' : '—'}
      width={field?.multiline ? 620 : 420}
    />
  );
}

// ── number ─────────────────────────────────────────────────────────────────────────────────────
// `display` is why there is no separate score or rating type. The editor honours all four: bar and
// stars become CLICKABLE forms of the same read renderer, so the thing you look at is the thing
// you click. Plain and currency are the number itself.
function NumberEditor({ field, value, onChange }) {
  const min = field?.min ?? 0;
  const max = field?.max ?? 10;
  const set = raw => {
    if (raw === '' || raw == null) return onChange(null);
    const n = Number(raw);
    if (Number.isNaN(n)) return;
    const p = field?.precision;
    onChange(p != null ? Number(n.toFixed(p)) : n);
  };

  if (field?.display === 'bar') {
    const n = value == null || value === '' ? null : Number(value);
    const pct = n == null ? 0 : Math.max(0, Math.min(1, (n - min) / (max - min || 1)));
    const filled = Math.round(pct * 10);
    return (
      <span style={sx('display:inline-flex;align-items:center;gap:10px')}>
        <span style={{ ...mono('font-size:11.5px;font-weight:600;width:26px'), color: n == null ? 'var(--fg-faint)' : 'var(--fg-soft)' }}>{n == null ? '—' : n}</span>
        <span style={sx('display:flex;gap:1.5px;height:8px;width:56px;flex:none;align-items:center')}>
          {Array.from({ length: 10 }, (_, i) => (
            <button key={i} type="button" title={String(min + ((i + 1) * (max - min)) / 10)}
              onClick={() => set(min + ((i + 1) * (max - min)) / 10)}
              style={{ ...sx('flex:1;height:8px;padding:0;border:none;cursor:pointer;background:none;display:flex;align-items:center') }}>
              <span style={{ ...sx('flex:1;height:4px;border-radius:1px'), background: i < filled ? 'var(--fg-muted)' : 'var(--border)' }} />
            </button>
          ))}
        </span>
        <TextInput value={value} onChange={set} monospace width={54} placeholder="—" />
      </span>
    );
  }

  if (field?.display === 'stars') {
    const n = Math.round(Number(value) || 0);
    const of = Math.max(1, Math.round(field?.max ?? 5));
    return (
      <span style={sx('display:inline-flex;align-items:center;gap:2px')}>
        {Array.from({ length: of }, (_, i) => (
          <button key={i} type="button" title={String(i + 1)} onClick={() => set(i + 1 === n ? '' : i + 1)}
            style={{ ...BARE, ...sx('padding:1px 2px'), fontFamily: MONO, fontSize: 13, color: i < n ? 'var(--fg-soft)' : 'var(--border-3)' }}>
            {i < n ? '★' : '☆'}
          </button>
        ))}
      </span>
    );
  }

  return (
    <span style={sx('display:inline-flex;align-items:center;gap:8px')}>
      <TextInput value={value} onChange={set} monospace width={140} placeholder="—" />
      {field?.display === 'currency' && value != null && value !== ''
        ? <span style={{ ...mono('font-size:10px'), color: 'var(--sand)' }}>{Number(value).toLocaleString()}</span>
        : null}
    </span>
  );
}

// ── select · status ────────────────────────────────────────────────────────────────────────────
// One picker, two skins. `status` carries the gate and the board grouping, so its menu prints the
// group beside each option — that is the whole difference the data model insists on, made visible
// at the moment of choosing.
function ChoiceEditor({ field, value, onChange, showGroup }) {
  const menu = useContextMenu();
  const items = optionsOf(field).map(o => ({
    label: String(o.value).replace(/-/g, ' '),
    hint: showGroup && o.group ? o.group : undefined,
    onClick: () => onChange(o.value),
  }));
  if (value != null && value !== '') items.push({ sep: true }, { label: 'Clear', onClick: () => onChange(null) });
  return (
    <>
      <button type="button" onClick={menu.open(items)} style={{ ...BARE, ...sx('gap:8px;border-radius:9999px') }}
        title={field?.gate ? 'The gate field — an agent may not promote past shortlist' : 'Choose'}>
        {value == null || value === '' ? <SetChip /> : <StatusChip value={value} field={field} />}
        <Caret />
        {field?.gate ? <span style={{ ...mono('font-size:8px;font-weight:700;letter-spacing:.12em'), color: 'var(--fg-faint)' }}>GATE</span> : null}
      </button>
      {menu.render()}
    </>
  );
}
const SelectEditor = props => <ChoiceEditor {...props} showGroup={false} />;
const StatusEditor = props => <ChoiceEditor {...props} showGroup />;

// ── multiselect ────────────────────────────────────────────────────────────────────────────────
// The chips are `Chip` from the registry (ui.jsx). Clicking one drops it, exactly as the design
// draws it; `+ tag` opens the remaining options. A multiselect with NO options[] is an OPEN
// VOCABULARY — a tag field (backend/collections.mjs FIELD_TYPES, docs/02_DATA_MODEL.md §2) — so
// there is nothing for `+ tag` to offer, and the affordance is a typed one instead.
function MultiSelectEditor({ field, value, onChange }) {
  const menu = useContextMenu();
  const chosen = asList(value).map(String);
  const all = optionsOf(field);
  const open = !all.length;
  const rest = all.filter(o => !chosen.includes(String(o.value)));
  const items = rest.map(o => ({ label: String(o.value), onClick: () => onChange([...chosen, o.value]) }));
  const [draft, setDraft] = React.useState('');
  const add = () => {
    const t = draft.trim();
    setDraft('');
    if (t && !chosen.includes(t)) onChange([...chosen, t]);
  };
  return (
    <>
      <span style={sx('display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap')}>
        {chosen.map(t => (
          <Chip key={t} on label={<>{t}<span style={{ color: 'var(--fg-faint)' }}>×</span></>}
            title="Remove" onClick={() => onChange(chosen.filter(x => x !== t))}
            style={{ ...sx('border-radius:6px'), borderColor: colourOf(field, t) === 'var(--border-2)' ? 'var(--border-2)' : colourOf(field, t) }} />
        ))}
        {open ? (
          <Input value={draft} placeholder="+ tag" aria-label="Add a tag"
            onChange={e => setDraft(e.target.value)} onBlur={add}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); add(); }
              if (e.key === 'Escape') setDraft('');
            }}
            style={{ ...mono('font-size:10px;font-weight:600'), ...sx('width:96px;height:22px;padding:0 8px;border-radius:6px') }} />
        ) : items.length ? (
          <button type="button" onClick={menu.open(items)} className="hFgL"
            style={{ ...BARE, ...mono('font-size:10px;font-weight:600;height:22px;padding:0 8px;border-radius:6px'), color: 'var(--fg-faint)' }}>
            + tag
          </button>
        ) : null}
      </span>
      {menu.render()}
    </>
  );
}

// ── date ───────────────────────────────────────────────────────────────────────────────────────
// A typed ISO field, NOT `<input type="date">`. The native picker paints its own chrome from
// `color-scheme`, which this app does not declare — it would render a light widget on the dark
// surface today and the wrong one again when light mode lands (M5/T16). A mono ISO field is
// token-clean in both themes, and frontmatter dates are ISO strings anyway.
// `display: freshness` reuses Freshness — Law 3 has ONE meter and this is it.
// A frontmatter date reaches the browser as whatever JSON made of it — usually a full ISO
// instant, `2026-08-15T00:00:00.000Z`. Printing that verbatim put twenty-four characters of
// machine punctuation in a property row whose real content is ten. The editor writes
// `YYYY-MM-DD` (or `YYYY-MM-DD HH:MM`), so it should READ the same shape; the file keeps whatever
// it had until someone actually edits the row. Trimming here rather than at each call site
// because cells.jsx is where a field type becomes UI, and a second trimmer is a second truth.
export function dateFieldText(value, time = false) {
  if (value == null || value === '') return '';
  const s = String(value instanceof Date ? value.toISOString() : value);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/);
  if (!m) return s;
  return time && m[2] ? m[1] + ' ' + m[2] : m[1];
}

function DateEditor({ field, value, onChange }) {
  const time = !!field?.time;
  const shape = time ? 'YYYY-MM-DD HH:MM' : 'YYYY-MM-DD';
  const str = dateFieldText(value, time);
  const bad = !!str && Number.isNaN(Date.parse(str));
  return (
    <span style={sx('display:inline-flex;align-items:center;gap:10px;flex-wrap:wrap')}>
      <TextInput value={str} onChange={v => onChange(v === '' ? null : v)} monospace width={time ? 168 : 120} placeholder={shape} invalid={bad} />
      <button type="button" className="hFgL" onClick={() => onChange(time ? new Date().toISOString().slice(0, 16).replace('T', ' ') : new Date().toISOString().slice(0, 10))}
        style={{ ...BARE, ...mono('font-size:9px;font-weight:700;letter-spacing:.1em'), color: 'var(--fg-faint)' }}>
        TODAY
      </button>
      {bad ? <span style={{ ...mono('font-size:9px;font-weight:700;letter-spacing:.1em'), color: 'var(--danger)' }}>NOT A DATE</span>
        : field?.display === 'freshness' ? <Freshness value={value} />
        : field?.display === 'relative' ? <Freshness value={value} width={0} />
        : null}
    </span>
  );
}

// ── checkbox ───────────────────────────────────────────────────────────────────────────────────
function CheckboxEditor({ value, onChange }) {
  const on = !!value;
  return (
    <button type="button" className="hBd" onClick={() => onChange(!on)}
      style={{
        ...BARE, ...mono('font-size:10px;font-weight:600;letter-spacing:.08em;height:22px;padding:0 9px;border-radius:6px'),
        border: '1px solid var(--border-2)', color: on ? 'var(--ok)' : 'var(--fg-faint)',
      }}>
      <span style={{ ...sx('width:5px;height:5px;border-radius:9999px'), background: on ? 'var(--ok)' : 'var(--fg-faint)' }} />
      <span>{on ? 'YES' : 'NO'}</span>
    </button>
  );
}

// ── url · email · phone ────────────────────────────────────────────────────────────────────────
// Typed so they render as ACTIONS, not strings (docs/02_DATA_MODEL.md §2): the value stays editable
// and the arrow next to it opens the real thing.
function LinkEditor({ field, value, onChange }) {
  const kind = field?.type;
  const href = !value ? null : kind === 'email' ? 'mailto:' + value : kind === 'phone' ? 'tel:' + value : String(value);
  return (
    <span style={sx('display:inline-flex;align-items:center;gap:8px;min-width:0;flex:1')}>
      <TextInput value={value} onChange={v => onChange(v === '' ? null : v)} monospace
        placeholder={kind === 'url' ? 'https://…' : kind === 'email' ? 'name@example.com' : '+63…'} width={360} />
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" title={href} className="hAccent"
          style={{ ...mono('font-size:11px;text-decoration:none;flex:none'), color: 'var(--accent)' }}>↗</a>
      ) : null}
    </span>
  );
}

// ── relation ───────────────────────────────────────────────────────────────────────────────────
// The spine. A chip that OPENS the other document (onFollow), with its own × to unlink and a picker
// over `options` — which the surface supplies, because a schema knows the target collection but not
// what is in it. Without options you can still type a slug: a relation must never be unfillable
// just because a list did not load.
function RelationEditor({ field, value, onChange, onFollow, options }) {
  const menu = useContextMenu();
  const [typing, setTyping] = React.useState(false);
  const many = !!field?.many;
  const ids = asList(value).map(String);
  const commit = next => onChange(many ? next : (next[next.length - 1] ?? null));
  const pool = (options || []).filter(o => !ids.includes(String(o.value)));
  const items = pool.slice(0, 60).map(o => ({ label: o.label || String(o.value), hint: String(o.value), onClick: () => commit([...ids, o.value]) }));

  return (
    <>
      <span style={sx('display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap')}>
        {ids.map(id => (
          <span key={id} className="hBd"
            style={{ ...mono('display:inline-flex;align-items:center;gap:7px;height:24px;padding:0 9px;border-radius:6px;font-size:10.5px;font-weight:500'), background: 'var(--raise)', border: '1px solid var(--border-2)', color: 'var(--fg-soft)' }}>
            <button type="button" onClick={() => onFollow && onFollow(field?.target, id)} title={'Open #' + (field?.target || '') + '/' + id}
              style={{ ...BARE, ...sx('gap:6px'), fontFamily: MONO, fontSize: 10.5, color: 'inherit' }}>
              <span style={{ ...sx('font-size:9px'), color: 'var(--fg-faint)' }}>↗</span>
              <span>{(field?.target ? '#' + field.target + '/' : '') + id}</span>
            </button>
            <button type="button" title="Unlink" onClick={() => commit(ids.filter(x => x !== id))}
              style={{ ...BARE, fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)' }}>×</button>
          </span>
        ))}
        {(many || !ids.length) ? (
          items.length ? (
            <button type="button" onClick={menu.open(items)} className="hFgL"
              style={{ ...BARE, ...mono('font-size:10px;font-weight:600;height:22px;padding:0 8px;border-radius:6px'), color: 'var(--fg-faint)' }}>
              + link
            </button>
          ) : typing ? (
            <TextInput value="" width={200} monospace placeholder={'slug in #' + (field?.target || '?')}
              onChange={v => { setTyping(false); if (v.trim()) commit([...ids, v.trim()]); }} />
          ) : (
            <button type="button" onClick={() => setTyping(true)} className="hFgL"
              style={{ ...BARE, ...mono('font-size:10px;font-weight:600;height:22px;padding:0 8px;border-radius:6px'), color: 'var(--fg-faint)' }}>
              + link
            </button>
          )
        ) : null}
      </span>
      {menu.render()}
    </>
  );
}

// ── rollup · formula ───────────────────────────────────────────────────────────────────────────
// DERIVED. Read-only, and it says so and says WHERE FROM. `Cell` renders the value so the derived
// number looks exactly like the authored one it is standing in for — only the affordance differs.
function Computed({ field, value, onFollow }) {
  const how = field?.type === 'rollup'
    ? (field.fn || 'count') + '(' + (field.via || '?') + '.' + (field.target_field || '?') + ')'
    : String(field?.expr || '');
  return (
    <span style={sx('display:inline-flex;align-items:center;gap:9px;min-width:0')}>
      <Cell field={{ ...field, type: field?.type === 'rollup' ? 'number' : 'text' }} value={value} onFollow={onFollow} />
      <span title={how}
        style={{ ...mono('font-size:8.5px;font-weight:700;letter-spacing:.12em;padding:2px 7px;border-radius:5px;white-space:nowrap'), background: 'var(--sunk)', border: '1px solid var(--line)', color: 'var(--fg-faint)' }}>
        COMPUTED · {how}
      </span>
    </span>
  );
}

// ── file ───────────────────────────────────────────────────────────────────────────────────────
// Attachments are content-addressed under files/ (docs/02_DATA_MODEL.md §5). There is no upload
// route yet, so this edits the REFERENCES a document holds — add by name, unlink, and open through
// onFollow so the file browser (M5) is the one thing that shows a file.
function FileEditor({ field, value, onChange, onFollow }) {
  const [typing, setTyping] = React.useState(false);
  const names = asList(value).map(String);
  const many = !!field?.many;
  const commit = next => onChange(many ? next : (next[next.length - 1] ?? null));
  return (
    <span style={sx('display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap')}>
      {names.map(n => (
        <span key={n} className="hBd"
          style={{ ...mono('display:inline-flex;align-items:center;gap:7px;height:22px;padding:0 8px;border-radius:6px;font-size:10px'), background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--fg-muted)' }}>
          <button type="button" onClick={() => onFollow && onFollow(null, 'files/' + n)} title={'files/' + n}
            style={{ ...BARE, fontFamily: MONO, fontSize: 10, color: 'inherit' }}>{n}</button>
          <button type="button" title="Unlink" onClick={() => commit(names.filter(x => x !== n))}
            style={{ ...BARE, fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)' }}>×</button>
        </span>
      ))}
      {(many || !names.length) ? (typing ? (
        <TextInput value="" width={220} monospace placeholder="filename under files/"
          onChange={v => { setTyping(false); if (v.trim()) commit([...names, v.trim()]); }} />
      ) : (
        <button type="button" onClick={() => setTyping(true)} className="hFgL"
          style={{ ...BARE, ...mono('font-size:10px;font-weight:600;height:22px;padding:0 8px;border-radius:6px'), color: 'var(--fg-faint)' }}>
          + file
        </button>
      )) : null}
    </span>
  );
}

// ── actor ──────────────────────────────────────────────────────────────────────────────────────
// The orchestration type: a task assigned to `scout-fb` is how a person directs a team. `--marked`
// because an assignee is "in flight", never a call to action (docs/DESIGN.md).
function ActorEditor({ field, value, onChange, options }) {
  const menu = useContextMenu();
  const kinds = field?.kinds || ['human', 'agent'];
  const pool = (options || []).filter(o => !o.kind || kinds.includes(o.kind));
  const items = pool.map(o => ({ label: o.label || String(o.value), hint: o.kind, onClick: () => onChange(o.value) }));
  if (value) items.push({ sep: true }, { label: 'Unassign', onClick: () => onChange(null) });

  if (!items.length) return <TextInput value={value} onChange={v => onChange(v === '' ? null : v)} monospace width={200} placeholder="actor id" />;
  return (
    <>
      <button type="button" onClick={menu.open(items)} style={{ ...BARE, ...sx('gap:8px') }}>
        {value
          ? <span style={{ ...mono('font-size:10.5px;height:22px;padding:0 9px;border-radius:6px;display:inline-flex;align-items:center'), border: '1px solid var(--border-2)', color: 'var(--marked)' }}>{String(value)}</span>
          : <SetChip label="ASSIGN" />}
        <Caret />
      </button>
      {menu.render()}
    </>
  );
}

// ── json ───────────────────────────────────────────────────────────────────────────────────────
// Last resort, and it reads as one: collapsed to `{…}` until asked. Invalid JSON is shown as
// invalid and is NEVER committed — a half-typed object silently overwriting a good one is the
// failure this type invites.
function JsonEditor({ value, onChange }) {
  const [open, setOpen] = React.useState(false);
  const pretty = value == null || value === '' ? '' : (typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  const [draft, setDraft] = React.useState(pretty);
  React.useEffect(() => { if (!open) setDraft(pretty); }, [pretty, open]);
  let bad = false;
  if (draft.trim()) { try { JSON.parse(draft); } catch { bad = true; } }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="hFgL"
        style={{ ...BARE, ...mono('font-size:10px;height:22px;padding:0 8px;border-radius:6px'), border: '1px solid var(--border)', color: 'var(--fg-faint)' }}>
        {pretty ? '{…}' : '{ }'} <span style={{ letterSpacing: '.1em' }}>EDIT</span>
      </button>
    );
  }
  return (
    <span style={sx('display:flex;flex-direction:column;gap:6px;flex:1;min-width:0')}>
      <textarea
        className="hBd" value={draft} spellCheck={false}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => e.stopPropagation()}
        onBlur={() => {
          setOpen(false);
          if (bad) return;
          const next = draft.trim() ? JSON.parse(draft) : null;
          if (JSON.stringify(next) !== JSON.stringify(value ?? null)) onChange(next);
        }}
        style={{
          ...sx('width:100%;max-width:620px;min-height:110px;padding:8px;border-radius:6px;box-sizing:border-box;line-height:1.6;outline:none'),
          fontFamily: MONO, fontSize: 11, color: 'var(--fg-soft)', background: 'var(--sunk)',
          border: '1px solid ' + (bad ? 'var(--danger)' : 'var(--border-2)'),
        }}
      />
      {bad ? <span style={{ ...mono('font-size:9px;font-weight:700;letter-spacing:.1em'), color: 'var(--danger)' }}>NOT VALID JSON — NOTHING WILL BE SAVED</span> : null}
    </span>
  );
}

// ── the editor dispatch table ──────────────────────────────────────────────────────────────────
// The mirror of RENDERERS above. Sixteen types, sixteen lines.
export const EDITORS = {
  text: TextEditor,
  number: NumberEditor,
  select: SelectEditor,
  multiselect: MultiSelectEditor,
  status: StatusEditor,
  date: DateEditor,
  checkbox: CheckboxEditor,
  url: LinkEditor,
  email: LinkEditor,
  phone: LinkEditor,
  relation: RelationEditor,
  rollup: Computed,
  formula: Computed,
  file: FileEditor,
  actor: ActorEditor,
  json: JsonEditor,
};

// `onChange` absent ⇒ read-only, and it falls through to `Cell`. That is the one switch between the
// inspector's read view and the document surface's edit view, and it is why they can be the same
// component (PropertyRows.jsx).
export function Editor({ field, value, onChange, onFollow, options }) {
  if (!onChange || isDerived(field)) {
    if (isDerived(field)) return <Computed field={field} value={value} onFollow={onFollow} />;
    return <Cell field={field} value={value} onFollow={onFollow} />;
  }
  const C = EDITORS[field?.type] || TextEditor;
  return <C field={field} value={value} onChange={onChange} onFollow={onFollow} options={options} />;
}
