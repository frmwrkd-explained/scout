// CollectionMenu — what a person can change about a collection, from the sidebar: its name, its
// colour, and what is nested under it.
//
// It opens from a row's ⋯ button (and from the row's right-click menu, which is the app's one
// ContextMenu and only chooses which part of this panel to open on). It is a panel with fields in
// it, not a list of commands, which is why it is not the ContextMenu itself.
//
// PORTALLED to <body> and positioned beside the row: the rail scrolls and clips, and a panel
// rendered inside it would be cut off at the rail's edge.
//
// There is no "delete collection" here. A collection is a saved query over files that stay on
// disk (docs/01_CANON.md — never delete); removing one is not something this panel offers.
//
// Props
//   anchor        DOMRect of the row it belongs to
//   collection    the schema being edited          collections   every schema (to offer nesting)
//   parent        the schema it is shown under in the rail, or null
//   focus         'name' | 'colour' | 'sub' — which part to put the cursor in
//   actor         the human actor id
//   onChanged()   something was written — the caller re-reads the collections
//   onNavigate(key, arg)   App's navigation, for "Show folder in Files"
//   onClose()

import React from 'react';
import { createPortal } from 'react-dom';
import { collectionsApi } from './collectionsApi';
import { HUES, hueOf, hueVar, collectionLabel } from './collectionColour';
import { subtablesOf, descendantsOf, folderOf } from '../shared/collectionShape.mjs';
import './collections.css';

const WIDTH = 280;

export function CollectionDot({ collection, size = 8 }) {
  return <span className="colDot" aria-hidden="true" style={{ width: size, height: size, background: hueVar(hueOf(collection)) }} />;
}

export default function CollectionMenu({ anchor, collection, collections = [], parent = null, focus = 'name', actor, onChanged, onNavigate, onClose }) {
  const [name, setName] = React.useState(collectionLabel(collection));
  const [sub, setSub] = React.useState('');
  const [adding, setAdding] = React.useState(focus === 'sub');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const nameRef = React.useRef(null);
  const subRef = React.useRef(null);

  React.useEffect(() => {
    const el = focus === 'sub' ? subRef.current : focus === 'name' ? nameRef.current : null;
    if (el) { el.focus(); if (el.select) el.select(); }
  }, [focus]);
  React.useEffect(() => { if (adding && subRef.current) subRef.current.focus(); }, [adding]);

  // Escape closes, capture-phase so the app keymap does not also act on it.
  React.useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const run = async (work, { close = false } = {}) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await work();
      if (onChanged) await onChanged();
      if (close) onClose();
    } catch (e) { setError(e.message || String(e)); }
    finally { setBusy(false); }
  };

  const rename = () => {
    const label = name.trim();
    if (!label || label === collectionLabel(collection)) return;
    run(() => collectionsApi.setMeta(collection.id, { label }, actor));
  };
  const recolour = colour => run(() => collectionsApi.setMeta(collection.id, { colour }, actor));
  const addNew = () => {
    const label = sub.trim();
    if (!label) return;
    run(async () => { await collectionsApi.addSub(collection.id, { label }, actor); setSub(''); setAdding(false); });
  };
  const link = id => run(() => collectionsApi.addSub(collection.id, { collection: id }, actor));
  const unlink = () => run(() => collectionsApi.removeSub(parent.id, collection.id, actor), { close: true });

  // What may be nested here: not itself, not something already nested here, and nothing this
  // collection sits inside (that would be a loop — the server refuses it too).
  const already = new Set(subtablesOf(collection).map(s => s.collection));
  const linkable = collections.filter(c => c.id !== collection.id && !already.has(c.id) && !descendantsOf(c.id, collections).has(collection.id));
  const chosen = HUES.includes(collection.colour) ? collection.colour : null;
  const children = subtablesOf(collection).map(s => collections.find(c => c.id === s.collection)).filter(Boolean);

  const left = Math.max(8, Math.min((anchor ? anchor.right : 220) + 8, window.innerWidth - WIDTH - 8));
  const top = Math.max(8, Math.min(anchor ? anchor.top - 8 : 80, window.innerHeight - 420));

  return createPortal(
    <>
      <div className="colMenuCatch" onMouseDown={onClose} onContextMenu={e => { e.preventDefault(); onClose(); }} />
      <div className="colMenu" role="dialog" aria-label={'Collection: ' + collectionLabel(collection)} style={{ left, top, width: WIDTH }}>
        <label className="colMenuLabel" htmlFor="colmenu-name">Name</label>
        <input id="colmenu-name" ref={nameRef} className="colMenuInput" value={name} disabled={busy}
          onChange={e => setName(e.target.value)} onBlur={rename}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }} />

        <span className="colMenuLabel">Colour</span>
        <div className="colSwatches" role="radiogroup" aria-label="Colour">
          {HUES.map(h => (
            <button key={h} type="button" role="radio" aria-checked={chosen === h} title={h.charAt(0).toUpperCase() + h.slice(1)} disabled={busy}
              className={'colSwatch' + (chosen === h ? ' on' : '')} onClick={() => recolour(h)}>
              <span style={{ background: hueVar(h) }} />
            </button>
          ))}
          <button type="button" role="radio" aria-checked={!chosen} disabled={busy} className={'colSwatchAuto' + (!chosen ? ' on' : '')}
            title="Let Scout pick a colour from the name" onClick={() => recolour(null)}>Auto</button>
        </div>

        <span className="colMenuLabel">Inside {collectionLabel(collection)}</span>
        {children.length ? (
          <div className="colMenuChildren">
            {children.map(c => (
              <span key={c.id} className="colMenuChild"><CollectionDot collection={c} />{collectionLabel(c)}</span>
            ))}
          </div>
        ) : (
          <span className="colMenuHint">Nothing nested yet. A sub-collection holds things that each belong to one {collectionLabel(collection)} record — people in a company, shots in a project.</span>
        )}
        {adding ? (
          <div className="colMenuAdd">
            <input ref={subRef} className="colMenuInput" value={sub} disabled={busy} placeholder="Name it — People, Contacts, Shots"
              aria-label="Name of the new sub-collection"
              onChange={e => setSub(e.target.value)}
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); addNew(); } }} />
            <button type="button" className="colMenuBtn" disabled={busy || !sub.trim()} onClick={addNew}>Create</button>
            {linkable.length ? (
              <>
                <span className="colMenuHint">Or nest one you already have:</span>
                <div className="colMenuLinks">
                  {linkable.map(c => (
                    <button key={c.id} type="button" className="colMenuLink hBd" disabled={busy} onClick={() => link(c.id)}>
                      <CollectionDot collection={c} />{collectionLabel(c)}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <button type="button" className="colMenuRow hBg" disabled={busy} onClick={() => setAdding(true)}>+ Add sub-collection</button>
        )}

        <div className="colMenuRule" />
        {parent ? (
          <button type="button" className="colMenuRow hBg" disabled={busy} onClick={unlink}
            title="Only un-nests it. The collection, its records and its link to each record stay.">
            Move out of {collectionLabel(parent)}
          </button>
        ) : null}
        {onNavigate ? (
          <button type="button" className="colMenuRow hBg" onClick={() => { onClose(); onNavigate('files', folderOf(collection)); }}>
            Show folder in Files
          </button>
        ) : null}
        {error ? <span className="colMenuError" role="alert">{error}</span> : null}
      </div>
    </>,
    document.body
  );
}
