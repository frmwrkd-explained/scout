// RelationPicker — choosing the record a link points at.
//
// A small window under the button: a search box that is already focused, the collection's records
// BY NAME (all of them — it reads the collection, not one of its filtered views), and, when what
// was typed is not the name of anything yet, "Create … in Companies". Arrow keys and Enter work;
// Escape or a click outside closes it.
//
// It is drawn on the page body, at a fixed spot under its button, so no card or table it was
// opened from can clip it. It writes nothing but the one thing it may create — a new record,
// through the ordinary record route (dedupe, provenance and the log included). Linking is the
// caller's: `onPick(slug)`.

import React from 'react';
import ReactDOM from 'react-dom';
import { api } from './api';
import { useRecordNames, refreshRecordNames } from './recordNames';
import { rankRecords, hasExactName } from './relationNames';
import { colourOfId, labelOfId } from './collectionColour';

const WIDTH = 340, SHOWN = 60;

export default function RelationPicker({ target, at, exclude = [], onPick, onClose, onClear }) {
  const names = useRecordNames(target);
  const [text, setText] = React.useState('');
  const [cursor, setCursor] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const box = React.useRef(null);
  const listRef = React.useRef(null);

  React.useEffect(() => {
    const onDown = e => { if (box.current && !box.current.contains(e.target)) onClose(); };
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onClose);
    return () => { window.removeEventListener('mousedown', onDown, true); window.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onClose); };
  }, [onClose]);

  const label = labelOfId(target) || target;
  const hits = rankRecords(names.list, text, exclude);
  const typed = text.trim();
  const offerCreate = !!typed && !!names.list && !hasExactName(names.list, typed);
  const rows = [...hits.slice(0, SHOWN).map(x => ({ kind: 'record', ...x })), ...(offerCreate ? [{ kind: 'create' }] : [])];
  const at0 = Math.min(cursor, Math.max(0, rows.length - 1));

  const create = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = await api.upsert({ collection: target, name: typed });
      refreshRecordNames(target);
      if (r && r.id) onPick(String(r.id)); else setError('Could not create it.');
    } catch (e) { setError(e.message || String(e)); }
    finally { setBusy(false); }
  };
  const choose = row => { if (!row) return; if (row.kind === 'create') create(); else { onPick(row.slug); setText(''); setCursor(0); } };

  const onKeyDown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(Math.min(rows.length - 1, at0 + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(Math.max(0, at0 - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(rows[at0]); }
  };
  React.useEffect(() => {
    const el = listRef.current && listRef.current.querySelector('[data-on="1"]');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [at0, text]);

  // Under the button; above it when there is no room below; never off the side of the window.
  const left = Math.max(12, Math.min(at.left, window.innerWidth - WIDTH - 12));
  const below = window.innerHeight - at.bottom;
  const place = below < 320 && at.top > below ? { bottom: window.innerHeight - at.top + 6 } : { top: at.bottom + 6 };

  return ReactDOM.createPortal(
    <div ref={box} className="relPick" role="dialog" aria-label={'Link a record from ' + label} style={{ left, width: WIDTH, ...place }}>
      <input autoFocus className="relPickInput" value={text} placeholder={'Find in ' + label + '…'} aria-label={'Find in ' + label}
        onChange={e => { setText(e.target.value); setCursor(0); }} onKeyDown={onKeyDown} />
      <div ref={listRef} className="relPickList" role="listbox">
        {!names.list ? <p className="relPickNote">Loading…</p> : null}
        {rows.map((row, i) => (row.kind === 'create' ? (
          <button key="+create" type="button" role="option" aria-selected={i === at0} data-on={i === at0 ? '1' : '0'} disabled={busy}
            className={'relPickRow relPickCreate' + (i === at0 ? ' on' : '')} onMouseEnter={() => setCursor(i)} onClick={create}>
            <span className="relPickPlus" aria-hidden="true">+</span>
            <span className="relPickName">{busy ? 'Creating…' : <>Create <b>{typed}</b> in {label}</>}</span>
          </button>
        ) : (
          <button key={row.slug} type="button" role="option" aria-selected={i === at0} data-on={i === at0 ? '1' : '0'}
            className={'relPickRow' + (i === at0 ? ' on' : '')} onMouseEnter={() => setCursor(i)} onClick={() => choose(row)}>
            <span className="relDot" style={{ background: colourOfId(target) }} aria-hidden="true" />
            <span className="relPickName">{row.title}</span>
          </button>
        )))}
        {names.list && !rows.length ? <p className="relPickNote">{names.list.length ? 'Everything in ' + label + ' is already linked.' : 'Nothing in ' + label + ' yet. Type a name to create the first one.'}</p> : null}
        {hits.length > SHOWN ? <p className="relPickNote">{(hits.length - SHOWN).toLocaleString('en-US')} more — type to narrow.</p> : null}
      </div>
      {onClear ? <button type="button" className="relPickRow relPickClear" onClick={onClear}>Remove this link</button> : null}
      {error ? <p className="relPickError" role="alert">{error}</p> : null}
    </div>,
    document.body,
  );
}
