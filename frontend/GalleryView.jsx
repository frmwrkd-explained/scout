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
import { Empty, OpenRecord } from './ui';
import { RenderTile } from './RenderMedia';
import { mediaSrc, mediaName } from './media';
import { GroupHeader } from './ListView';
import { sizeOf, coverOf, fitOf, summaryOf, shownFields, groupRows, groupFieldOf } from './viewDisplay';
import { useIncremental, takeGroups, More } from './useIncremental.jsx';

const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });

// The field the tiles are cut from: the one the schema marks `primary_media`, else any `file`
// field. `primary_media` is also what backend/views.mjs infers `gallery` from, so the two agree by
// construction — the view type and the field it renders are decided by the same flag.
export function mediaField(collection) {
  const fields = collection?.fields || [];
  return fields.find(f => f.type === 'file' && f.primary_media) || fields.find(f => f.type === 'file') || null;
}

// `mediaSrc` / `mediaName` live in ./media now, unchanged, so the property rows resolve a file the
// same way a tile does. Re-exported here because this is where they have always been imported from.
export { mediaSrc, mediaName } from './media';

function Plate({ label }) {
  return (
    <div className="galleryPlate">
      <span className="galleryPlateLabel" style={{ fontFamily: MONO }}>NO PREVIEW</span>
      {label ? <span className="galleryPlateName" style={{ fontFamily: MONO }}>{label}</span> : null}
    </div>
  );
}

export default function GalleryView({ collection, view, rows, selected, onSelect, onOpen, onFollow, onPick }) {
  // Everything about how a card looks is the saved view's: its size, its picture and how the
  // picture fits, the properties under the name, whether the note's opening lines show.
  const z = sizeOf(view);
  const cover = coverOf(collection, view);
  const fit = fitOf(view);
  const summary = summaryOf(view);
  const defs = shownFields(collection, view);
  const groups = groupRows(rows, collection, view);
  // A screenful at a time (./useIncremental). Bigger cards, fewer per batch.
  const win = useIncremental(rows.length, { step: Math.max(40, Math.round(26000 / z.card)), resetKey: collection.id + '/' + view.id });

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

  const foot = (r, on) => (
    <div className="galleryFoot">
      <span className="galleryTitle" style={{ fontSize: z.title, color: on ? 'var(--fg)' : 'var(--fg-soft)' }}>{r.title}</span>
      {summary && r.summary ? <span className="gallerySummary" style={{ fontSize: z.text }}>{r.summary}</span> : null}
      {defs.length ? (
        <div className="galleryFields" style={{ zoom: z.zoom }}>
          {/* `onFollow`, not `onOpen`. Cell's relation chip hands back (collection, id); the row
              handler takes a row. One prop name, one meaning. */}
          {defs.map(f => <Cell key={f.key} field={f} value={r.fields[f.key]} onFollow={onFollow} onPick={onPick} />)}
        </div>
      ) : null}
    </div>
  );

  const card = r => {
    const on = selected === r.path;
    if (!cover) {
      // No picture field (or the view switched it off): a card of words. Not a RenderTile — that
      // shell exists to hold media, and an empty frame above every name would be a grid of holes.
      return (
        <div key={r.path} className={'galleryCard rvH' + (on ? ' on' : '')} title={r.path}
          onClick={() => onSelect(r)} onDoubleClick={() => onOpen(r)}>
          <OpenRecord onOpen={() => onOpen(r)} className="galleryOpen" />
          {/* Name, then what it is in a sentence, then its properties pinned to the bottom edge so
              a row of cards lines up whatever the length of each summary. */}
          <span className="cardTitle" style={{ fontSize: z.title }}>{r.title}</span>
          {summary && r.summary ? <span className="cardSummary" style={{ fontSize: z.text }}>{r.summary}</span> : null}
          {defs.length ? (
            <div className="cardFields" style={{ zoom: z.zoom }}>
              {defs.map(f => {
                const v = r.fields[f.key];
                if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return null;
                return <Cell key={f.key} field={f} value={v} onFollow={onFollow} onPick={onPick} />;
              })}
            </div>
          ) : null}
        </div>
      );
    }
    const value = r.fields[cover.key];
    return (
      <RenderTile
        key={r.path}
        src={mediaSrc(value)}
        // WHOLE PICTURE by default (`fit: contain`): a reference is judged by its composition, and
        // a library mixes portrait ads with 16:9 thumbnails, so any one crop cuts the headline off
        // half of them. A square frame keeps every card the same size and nothing reflows as
        // pictures arrive. "Fill the frame" is one click away in the Picture control.
        aspect="1/1"
        fit={fit}
        mediaStyle={fit === 'contain' ? sx('padding:10px;box-sizing:border-box') : undefined}
        hoverPlay
        selected={on}
        // Selected is the neutral raised chip treatment (docs/05_UI_SPEC.md §6). RenderTile's
        // default selected edge is the accent, which is reserved for the primary action.
        selectedColor="var(--border-3)"
        idleColor="var(--border)"
        title={r.path}
        onClick={() => onSelect(r)}
        onDoubleClick={() => onOpen(r)}
        className="hBd rvH galleryTile"
        style={{ background: on ? 'var(--raise)' : 'var(--surface)' }}
        placeholder={<Plate label={mediaName(value)} />}
        // OPEN sits over the picture's corner, not beside the name. Beside the name it reserved its
        // width even while invisible, which cut every name off at about 18 characters.
        overlay={<OpenRecord onOpen={() => onOpen(r)} className="galleryOpen" />}
        footer={foot(r, on)}
      />
    );
  };

  const grid = items => (
    <div className="galleryGrid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(' + z.card + 'px,1fr))' }}>
      {items.map(card)}
    </div>
  );

  return (
    <div className="galleryScroll">
      {groups
        ? takeGroups(groups, win.count).map(g => (
          <section key={g.key || 'none'} className="galleryGroup">
            <GroupHeader label={g.label} count={g.size} field={groupFieldOf(collection, view)} value={g.key} onFollow={onFollow} />
            {grid(g.items)}
          </section>
        ))
        : grid(rows.slice(0, win.count))}
      <More win={win} total={rows.length} noun="cards" />
    </div>
  );
}
