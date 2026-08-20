// The gallery — screenshot-first review (docs/02_DATA_MODEL.md §3: "anything with a `file` field").
//
// This is the view for work that is judged by looking: a sweep that captured screenshots, a set of
// proofs, a batch of stills. The picture leads and the fields follow it, which is the inverse of the
// table and the entire reason this is a separate type rather than a column.
//
// The tile itself is `RenderTile` from ./RenderMedia — the app's one selectable-thumbnail shell,
// which already owns the image-vs-video branch. A second thumbnail component would be a bug.

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { Cell } from './cells';
import { Empty } from './ui';
import { RenderTile } from './RenderMedia';

const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });

// The field the tiles are cut from: the one the schema marks `primary_media`, else any `file`
// field. `primary_media` is also what backend/views.mjs infers `gallery` from, so the two agree by
// construction — the view type and the field it renders are decided by the same flag.
export function mediaField(collection) {
  const fields = collection?.fields || [];
  return fields.find(f => f.type === 'file' && f.primary_media) || fields.find(f => f.type === 'file') || null;
}

// A `file` value is content-addressed under `<workspace>/files/` (docs/02_DATA_MODEL.md §5), and
// NOTHING SERVES THAT FOLDER YET — there is no `/api/file` route in backend/index.mjs. So: a value
// that is already a resolvable URL renders, and anything else renders as a named plate rather than
// a broken image. When the route lands, this function is the only thing that changes.
export function mediaSrc(value) {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) return null;
  const s = typeof first === 'object' ? (first.src || first.url || first.path || first.name || '') : String(first);
  return /^(https?:|data:|blob:|file:|\/)/.test(s) ? s : null;
}

export function mediaName(value) {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) return null;
  const s = typeof first === 'object' ? (first.name || first.path || first.src || '') : String(first);
  return String(s).split('/').pop() || null;
}

function Plate({ label }) {
  return (
    <div style={sx('display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px;text-align:center')}>
      <span style={{ ...mono('font-size:9px;font-weight:800;letter-spacing:.16em'), color: 'var(--border-3)' }}>NO PREVIEW</span>
      {label ? (
        <span style={{ ...mono('font-size:9.5px;word-break:break-all;line-height:1.4'), color: 'var(--fg-faint)' }}>{label}</span>
      ) : null}
    </div>
  );
}

export default function GalleryView({ collection, view, views, rows, counts, selected, onSelect, onOpen, onFollow, onPickView }) {
  const primary = (collection.fields || []).find(f => f.primary);
  const media = mediaField(collection);

  // Same rule as the board: the card's own fields if the view names them, else the view's columns
  // minus the title (the tile already carries it) and the media field (it IS the tile).
  const cardKeys = (view.card && view.card.fields && view.card.fields.length)
    ? view.card.fields
    : (view.fields || []).filter(k => k !== primary?.key && k !== media?.key).slice(0, 3);
  const defs = cardKeys
    .filter(k => k !== primary?.key)
    .map(k => (collection.fields || []).find(f => f.key === k) || { key: k, type: 'text' });

  if (!rows.length) {
    return (
      <div style={sx('flex:1;min-height:0;display:flex;align-items:flex-start;justify-content:center;padding:40px 20px')}>
        <Empty
          size="page"
          style={sx('max-width:420px')}
          title="Nothing to review"
          body="The collection's query and this view's filters together return no records. Nothing is hidden — widen either one."
        />
      </div>
    );
  }

  return (
    <div style={sx('flex:1;min-height:0;overflow:auto;padding:2px 20px 20px')}>
      {/* A gallery over a collection with no file field still shows every record — it just says so,
          in the app's own words, instead of rendering a grid of empty frames. */}
      {!media ? (
        <div style={{ ...mono('font-size:9px;font-weight:700;letter-spacing:.16em;padding:0 2px 10px'), color: 'var(--fg-faint)' }}>
          NO PRIMARY MEDIA FIELD — SHOWING RECORDS ONLY
        </div>
      ) : null}

      <div style={sx('display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:12px')}>
        {rows.map(r => {
          const on = selected === r.path;
          const value = media ? r.fields[media.key] : null;
          const src = mediaSrc(value);
          return (
            <RenderTile
              key={r.path}
              src={src}
              aspect="4/3"
              hoverPlay
              selected={on}
              // Selected is the neutral raised chip treatment (docs/05_UI_SPEC.md §6). RenderTile's
              // default selected edge is the accent, which is reserved for the primary action — so
              // the neutral edge is passed explicitly rather than inherited.
              selectedColor="var(--border-3)"
              idleColor="var(--border)"
              title={r.path}
              onClick={() => onSelect(r)}
              onDoubleClick={() => onOpen(r)}
              style={{ background: on ? 'var(--raise)' : 'var(--surface)' }}
              placeholder={<Plate label={mediaName(value)} />}
              footer={
                <div style={sx('display:flex;flex-direction:column;gap:6px;padding:9px 10px')}>
                  <span style={{ ...sx('font-size:12px;font-weight:600;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), color: on ? 'var(--fg)' : 'var(--fg-soft)' }}>
                    {r.title}
                  </span>
                  {defs.length ? (
                    <div style={sx('display:flex;align-items:center;gap:9px;flex-wrap:wrap')}>
                      {defs.map(f => <Cell key={f.key} field={f} value={r.fields[f.key]} onOpen={onOpen} />)}
                    </div>
                  ) : null}
                </div>
              }
            />
          );
        })}
      </div>
    </div>
  );
}
