// Subtables — a record's sub-collections, on the record's own page.
//
// docs/02_DATA_MODEL.md §4: a subtable is a collection with a bound parameter. A company declares
// `subtables: [{ collection: 'person', bind: { company: '$self' } }]`, and its page then lists
// every person whose `company` relation points at it. Nothing is stored for this: the list is the
// inverse side of the relation, asked for with the same `?bind=` the route has always answered.
//
// One section per subtable: the child collection's name and count, its records as rows (name plus
// the first properties of the child's own default view, through `Cell` — the one place a field
// type becomes UI), and `+ New …`, which creates a child with the relation already filled in.
//
// Props
//   collection     the schema of the record being read (the parent)
//   collections    every schema — to find the child collections
//   slug           the open record's identity. A relation stores the SLUG of the record it points
//                  at (the file name without `.md`), and `documentsFor` compares against exactly that.
//   actor          the human actor id          onOpenPath(path)   open a child record
//   onOpen(collection, id)   follow a relation chip inside a row

import React from 'react';
import { api } from './api';
import { Cell } from './cells';
import { collectionsApi } from './collectionsApi';
import { CollectionDot } from './CollectionMenu';
import { collectionLabel } from './collectionColour';
import { shownFields } from './viewDisplay';
import { MONO } from './tokens';
import { subtablesOf } from '../shared/collectionShape.mjs';
import './collections.css';

function Subtable({ sub, child, slug, actor, onOpenPath, onOpen, refreshKey }) {
  const [state, setState] = React.useState({ rows: null, view: null, error: null });
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);

  const load = React.useCallback(() => {
    let live = true;
    collectionsApi.children(sub.collection, { [sub.key]: slug })
      .then(r => { if (live) setState({ rows: r.rows || [], view: r.view || null, error: null }); })
      .catch(e => { if (live) setState({ rows: [], view: null, error: e.message || String(e) }); });
    return () => { live = false; };
  }, [sub.collection, sub.key, slug]);
  // `refreshKey` moves when the open record's properties were saved: a save can make a child
  // (an automation files a to-do when a deal is won), and the list must show it without a reopen.
  // The rows on screen stay until the new ones arrive, so nothing blinks.
  React.useEffect(() => load(), [load, refreshKey]);

  const create = async () => {
    const title = name.trim();
    if (!title || busy) return;
    setBusy(true); setError(null);
    try {
      // The canonical writer, with the relation pre-filled — so the new record is this parent's
      // from its first byte, and passes through dedupe, provenance and the log like any other.
      await api.upsert({ collection: sub.collection, name: title, [sub.key]: slug, actor });
      setName(''); setAdding(false);
      load();
    } catch (e) { setError(e.message || String(e)); }
    finally { setBusy(false); }
  };

  const label = sub.label || collectionLabel(child) || sub.collection;
  // The child view's own properties, minus the relation that points back here (every row would
  // say the same thing) — three at most, so a row stays one line.
  const defs = child ? shownFields(child, state.view || {}).filter(f => f.key !== sub.key).slice(0, 3) : [];
  const rows = state.rows || [];

  return (
    <section className="subtable" aria-label={label}>
      <div className="subtableHead">
        <span className="subtableTitle">{child ? <CollectionDot collection={child} size={9} /> : null}{label}</span>
        {state.rows ? <span className="subtableCount" style={{ fontFamily: MONO }}>{rows.length}</span> : null}
        <span className="subtableRule" />
        {!adding ? <button type="button" className="subtableNew hBd" onClick={() => setAdding(true)}>+ New in {label}</button> : null}
      </div>

      {adding ? (
        <div className="subtableAdd">
          <input autoFocus value={name} disabled={busy} placeholder={'Name — it is added to ' + label + ' and linked here'} aria-label={'Name of the new record in ' + label}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter') { e.preventDefault(); create(); }
              else if (e.key === 'Escape') { e.preventDefault(); setAdding(false); setName(''); setError(null); }
            }} />
          <button type="button" className="subtableNew hBd" disabled={busy || !name.trim()} onClick={create}>Add</button>
          <button type="button" className="subtableNew hBd" disabled={busy} onClick={() => { setAdding(false); setName(''); setError(null); }}>Cancel</button>
        </div>
      ) : null}
      {error ? <span className="subtableError" role="alert">{error}</span> : null}
      {state.error ? <span className="subtableError" role="alert">{state.error}</span> : null}

      {state.rows && rows.length ? (
        <div className="subtableRows">
          {rows.map(r => (
            // The row is a wrapper and the NAME is the button: a relation chip among the properties
            // is a button of its own, and a button cannot sit inside another.
            <div key={r.path} className="subtableRow" title={r.path} onClick={() => onOpenPath && onOpenPath(r.path)}>
              <button type="button" className="subtableName" onClick={e => { e.stopPropagation(); if (onOpenPath) onOpenPath(r.path); }}>{r.title}</button>
              {defs.length ? (
                <span className="subtableProps">
                  {defs.map(f => <Cell key={f.key} field={f} value={r.fields[f.key]} onFollow={onOpen} />)}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : state.rows && !state.error ? (
        <div className="subtableEmpty">Nothing in {label} belongs here yet. Add one, or set <span style={{ fontFamily: MONO }}>{sub.key}</span> on an existing record to this one.</div>
      ) : null}
    </section>
  );
}

export default function Subtables({ collection, collections = [], slug, actor, onOpenPath, onOpen, refreshKey }) {
  const subs = subtablesOf(collection);
  if (!subs.length || !slug) return null;
  return (
    <div className="subtables">
      {subs.map(sub => (
        <Subtable key={sub.id} sub={sub} child={collections.find(c => c.id === sub.collection) || null}
          slug={slug} actor={actor} onOpenPath={onOpenPath} onOpen={onOpen} refreshKey={refreshKey} />
      ))}
    </div>
  );
}
