// RecordHeader — the handful of properties that sit right under a record's title.
//
// A record's page used to open on a title and a paragraph, with every property a click away in a
// side panel: to see which company a person belongs to, or to change a status, you opened Details
// first. The properties that say what a thing IS now sit on the page, and they are live — click a
// value and change it.
//
// WHICH ones is the collection's decision, not each record's: a Company shows different facts than
// a Person, and every Person shows the same ones. It is the schema's `header` key — a list of
// field keys, in order — set from Edit layout (PageLayout.jsx) and stored in
// `.scout/collections/<id>.md`, where an agent can read or set it too. Until somebody chooses, the
// header is the collection's short fields (choices, tags, relations, dates, numbers…), up to six.
// Long text and pictures are never header properties: the page gives those their own blocks.
//
// The rows are `PropertyRow` from ./PropertyRows — the same row, the same editors, as the Details
// panel. This file only decides which rows.

import React from 'react';
import { PropertyRow, propertyLabel } from './PropertyRows';
import { Cell } from './cells';

const NEVER = f => f.primary || f.type === 'file' || f.type === 'json' || (f.type === 'text' && f.multiline);
// What a header shows before anyone has chosen: the fields that describe a thing at a glance.
// Choices, tags, links to other records, people, dates, yes/no — and a number only when the schema
// says how to show it (a score bar, stars, money). A bare number or a URL is usually an id or a
// source link: real, but not what a person looks for first, so it waits in Details until chosen.
const BY_DEFAULT = ['status', 'select', 'multiselect', 'relation', 'actor', 'date', 'checkbox', 'rollup'];
const leads = f => BY_DEFAULT.includes(f.type) || (f.type === 'number' && f.display && f.display !== 'plain');
const DEFAULT_MAX = 5;

// Every field that MAY sit in the header, in schema order.
export function headerCandidates(schema) {
  return ((schema && schema.fields) || []).filter(f => !NEVER(f));
}

// The fields the header shows, in order. `schema.header: []` is a deliberate "none".
export function headerFields(schema) {
  const candidates = headerCandidates(schema);
  if (schema && Array.isArray(schema.header)) {
    return schema.header.map(key => candidates.find(f => f.key === key)).filter(Boolean);
  }
  return candidates.filter(leads).slice(0, DEFAULT_MAX);
}

const hasValue = v => !(v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length));

// Open or folded is a working preference per COLLECTION on this machine (localStorage), like a
// panel's width: somebody triaging guests keeps it open, somebody reading references never does.
const openKey = id => 'scout.props.open.' + (id || '_');
function useOpen(id) {
  const read = () => { try { return window.localStorage.getItem(openKey(id)) === '1'; } catch { return false; } };
  const [open, setOpen] = React.useState(read);
  React.useEffect(() => { setOpen(read()); }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const set = next => { setOpen(next); try { window.localStorage.setItem(openKey(id), next ? '1' : '0'); } catch { /* private mode */ } };
  return [open, set];
}

// FOLDED BY DEFAULT. Under the title sits ONE line: the values themselves — the status, the
// company, the score, the tags — with no labels, because a value like "Needs review" or
// "Acme Studio" says what it is. That line is the whole summary of the record; the page then
// goes straight to the picture and the words. Click it and it opens into a card where each
// property has its label and can be changed. Nothing is hidden: the line shows how many
// properties there are, and Details still lists every one.
export default function RecordHeader({ schema, data, options = {}, onChange, onFollow, onShowAll, onPick }) {
  const [open, setOpen] = useOpen(schema && schema.id);
  if (!schema) return null;
  const shown = headerFields(schema);
  const total = ((schema && schema.fields) || []).length;
  const filled = shown.filter(f => hasValue((data || {})[f.key]));

  if (!open) {
    return (
      <section className="recordProps folded" aria-label="Properties">
        {/* A div acting as the button, because the values inside it are buttons themselves (click a
            tag to see the others that share it) and a button may not contain a button. */}
        <div role="button" tabIndex={0} className="recordPropsBar hBg" aria-expanded="false" onClick={() => setOpen(true)}
          onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(true); } }}
          title="Show and edit the properties">
          <span aria-hidden="true" className="recordPropsCaret">▸</span>
          <span className="recordPropsLine">
            {filled.length ? filled.map(f => (
              <span key={f.key} className="recordPropsValue" title={propertyLabel(f)}>
                <Cell field={f} value={data[f.key]} onFollow={onFollow} onPick={onPick} onChange={onChange ? v => onChange(f.key, v) : undefined} />
              </span>
            )) : <span className="recordPropsEmpty">No properties filled in yet</span>}
          </span>
          <span className="recordPropsCount">{total} {total === 1 ? 'property' : 'properties'}</span>
        </div>
      </section>
    );
  }

  return (
    <section className="recordProps open" aria-label="Properties">
      <div className="recordPropsHead">
        <button type="button" className="recordPropsToggle hFg" aria-expanded="true" onClick={() => setOpen(false)} title="Fold the properties">
          <span aria-hidden="true" className="recordPropsCaret">▾</span>
          <span>Properties</span>
        </button>
        {onShowAll ? (
          <button type="button" className="recordHeaderLink hFgL" onClick={onShowAll}>All {total} in Details</button>
        ) : null}
      </div>
      <div className="recordPropsRows">
        {shown.map(f => (
          <PropertyRow key={f.key} field={f} value={(data || {})[f.key]} variant="document"
            onChange={onChange ? v => onChange(f.key, v) : null} onFollow={onFollow} onPick={onPick} options={options[f.key]} />
        ))}
        {!shown.length ? <span className="recordPropsEmpty" style={{ padding: '6px 8px' }}>Choose which properties show here in Edit layout.</span> : null}
      </div>
    </section>
  );
}
