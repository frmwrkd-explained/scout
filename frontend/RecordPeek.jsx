// RecordPeek — "show me the others like this", without leaving the record.
//
// On a record, a value is a thread to pull: this reference is tagged Food & Beverage — which
// others are? Clicking a tag or a choice opens this window over the page with every record of the
// collection that carries the same value, as cards (when the collection has pictures) or as a
// list. From there a record opens in this page or in a new tab, so somebody can fan out through
// their library and keep their place.
//
// Two more moves keep the browsing going: a tag on a card INSIDE the window re-aims the window at
// that tag (so a person can walk from Food & Beverage to Health & Beauty without closing it), and
// "Open as page" takes the whole set to the collection screen — here or in a new tab — where it
// is an ordinary quick filter that can be sorted, grouped, resized or saved as a view.
//
// It is a window over the page, not a navigation: Escape or a click outside closes it and the
// record underneath is exactly where it was. The cards and the list are the SAME components the
// collection screen uses (GalleryView, ListView) given a small temporary view — no second card.
// The filter is the one comparison the quick filters use (viewDisplay.applyQuick).

import React from 'react';
import { api } from './api';
import GalleryView from './GalleryView';
import ListView from './ListView';
import { applyQuick, fileFieldsOf, fieldLabel } from './viewDisplay';
import { colourOf, collectionLabel } from './collectionColour';
import { MONO } from './tokens';

const WHERE_KEY = 'scout.peek.where';
const readWhere = () => { try { return window.localStorage.getItem(WHERE_KEY) === 'tab' ? 'tab' : 'here'; } catch { return 'here'; } };

// The address that opens ONE record in a fresh window of the app (App.jsx reads `#open=`).
export const recordUrl = path => window.location.pathname + '#open=' + encodeURIComponent(path);
// …and the one that opens a whole set as a page (`#browse=`).
export const setUrl = (collectionId, fieldKey, value) => window.location.pathname + '#browse=' + [collectionId, fieldKey, String(value)].map(encodeURIComponent).join('/');

function Seg({ label, value, options, onPick }) {
  return (
    <div className="vbSeg" role="radiogroup" aria-label={label}>
      {options.map(([key, text]) => (
        <button key={key} type="button" role="radio" aria-checked={value === key} className={'vbSegBtn' + (value === key ? ' on' : '')}
          onClick={() => onPick(key)}>{text}</button>
      ))}
    </div>
  );
}

export default function RecordPeek({ collection, field: firstField, value: firstValue, currentPath, onOpenPath, onBrowse, onClose }) {
  // What the window is aimed at. It starts at the value that was clicked on the record and moves
  // when a value is clicked on a card inside it.
  const [aim, setAim] = React.useState({ field: firstField, value: firstValue });
  React.useEffect(() => { setAim({ field: firstField, value: firstValue }); }, [firstField.key, firstValue]);
  const { field, value } = aim;
  const [all, setAll] = React.useState(null);
  const [error, setError] = React.useState(null);
  const hasPictures = fileFieldsOf(collection).length > 0;
  const [layout, setLayout] = React.useState(hasPictures ? 'gallery' : 'list');
  const [where, setWhereState] = React.useState(readWhere);
  const setWhere = next => { setWhereState(next); try { window.localStorage.setItem(WHERE_KEY, next); } catch { /* private mode */ } };

  // The collection is fetched once; re-aiming the window only re-filters what is already here.
  React.useEffect(() => {
    let alive = true;
    setAll(null); setError(null);
    api.allDocuments(collection.id)
      .then(r => { if (alive) setAll(r.rows || []); })
      .catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [collection.id]);
  const rows = React.useMemo(() => (all ? applyQuick(all, [{ field: field.key, value: String(value) }]) : null), [all, field.key, value]);
  const bodyRef = React.useRef(null);
  React.useEffect(() => { const el = bodyRef.current && bodyRef.current.querySelector('[data-scroll], .galleryScroll, .lvScroll'); if (el) el.scrollTop = 0; }, [field.key, value]);

  React.useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const open = row => {
    if (where === 'tab') { window.open(recordUrl(row.path), '_blank'); return; }
    onClose();
    if (row.path !== currentPath) onOpenPath(row.path);
  };
  const openSet = () => {
    if (where === 'tab') { window.open(setUrl(collection.id, field.key, value), '_blank'); return; }
    onClose();
    if (onBrowse) onBrowse(collection.id, field.key, value);
  };

  // A temporary view, never saved: small cards or rows, the collection's first few short fields.
  const shown = (collection.fields || [])
    .filter(f => !f.primary && f.type !== 'file' && !(f.type === 'text' && f.multiline))
    .filter(f => ['select', 'status', 'multiselect', 'relation', 'date'].includes(f.type))
    .slice(0, 3).map(f => f.key);
  const view = { id: 'peek', type: layout, size: 's', fit: 'contain', fields: shown, summary: layout === 'list', filter: [], sort: [] };
  const Body = layout === 'gallery' ? GalleryView : ListView;
  const count = rows ? rows.length : null;

  return (
    <div className="peekScrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="peek" role="dialog" aria-modal="true" aria-label={'Records with ' + fieldLabel(field) + ' ' + value}>
        <header className="peekHead">
          <div className="peekTitle">
            <span className="peekDot" style={{ background: colourOf(collection) }} />
            <span className="peekCollection">{collectionLabel(collection)}</span>
            <span className="peekWith">with {fieldLabel(field).toLowerCase()}</span>
            <span className="peekValue">{String(value)}</span>
            {count != null ? <span className="peekCount" style={{ fontFamily: MONO }}>{count.toLocaleString('en-US')} {count === 1 ? 'record' : 'records'}</span> : null}
          </div>
          <div className="peekTools">
            <Seg label="Layout" value={layout} options={[['gallery', 'Cards'], ['list', 'List']]} onPick={setLayout} />
            <Seg label="Where a record opens" value={where} options={[['here', 'Open here'], ['tab', 'Open in new tab']]} onPick={setWhere} />
            {onBrowse ? (
              <button type="button" className="peekAll hBdAccent" onClick={openSet}
                title={where === 'tab' ? 'Open all of these as a page, in a new tab' : 'Open all of these as a full page'}>Open as page</button>
            ) : null}
            <button type="button" className="peekClose hFg" onClick={onClose} aria-label="Close" title="Close (Esc)">×</button>
          </div>
        </header>
        <div className="peekBody" ref={bodyRef}>
          {error ? <p className="peekNote" style={{ color: 'var(--danger)' }}>{error}</p>
            : !rows ? <p className="peekNote">Looking…</p>
            : !rows.length ? <p className="peekNote">No other record has this yet.</p>
            : (
              <Body collection={collection} view={view} rows={rows} selected={currentPath}
                onSelect={open} onOpen={open} onFollow={() => {}} onPick={(f, v) => setAim({ field: f, value: v })} />
            )}
        </div>
        <footer className="peekFoot">
          {where === 'tab' ? 'Click a record to open it in a new tab — this window stays open.' : 'Click a record to open it here.'}
          {' '}Click a tag on a card to browse that tag instead. The record you came from is highlighted.
        </footer>
      </div>
    </div>
  );
}
