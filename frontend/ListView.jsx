// The list — one record per row: a picture if the view has one, the name, the opening line of the
// note, and the properties the view chose.
//
// What a row shows, how big it is and how the rows are sectioned all come from the saved view,
// through `./viewDisplay` — the same settings the table, the cards and the board read. Typed values
// still come from `./cells`. Nothing about a field renders differently here than in the table; only
// the arrangement changes.
//
// GROUPING. A list groups by the field the view names (Group in the view bar). With none named, a
// collection that has a real date field is still cut by day — that is the "what happened
// yesterday" log this layout began as. A collection with no date is NOT cut by its `updated`
// stamp: a thousand imported references under one heading that says TODAY told nobody anything.

import React from 'react';
import { Cell } from './cells';
import { Empty, OpenRecord } from './ui';
import { RenderMedia } from './RenderMedia';
import { mediaSrc } from './media';
import { MONO } from './tokens';
import { sx } from './sx';
import { sizeOf, coverOf, fitOf, wrapOf, summaryOf, shownFields, groupRows, groupFieldOf } from './viewDisplay';
import { useRecordNames, nameOf } from './recordNames';
import { colourOfId } from './collectionColour';
import { useIncremental, takeGroups, More } from './useIncremental.jsx';

// The date a list is cut on when the view names no group: the date the view sorts by, else the
// freshness date, else any declared date. Never the automatic `updated`.
export function listDateField(collection, view) {
  const fields = collection?.fields || [];
  const sorted = (view?.sort || []).map(s => fields.find(f => f.key === s.field)).find(f => f && f.type === 'date');
  return sorted || fields.find(f => f.type === 'date' && f.display === 'freshness') || fields.find(f => f.type === 'date') || null;
}

// A row's (or a board card's) picture: a small square on a recessed bed. Video plays muted on
// hover like every other tile; a value the browser cannot draw leaves the bed empty rather than
// showing a broken-image glyph.
export function Thumb({ value, size, fit = 'contain' }) {
  const src = mediaSrc(value);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => { setFailed(false); }, [src]);
  return (
    <span className="lvThumb" style={{ width: size, height: size }}>
      {src && !failed
        ? <RenderMedia src={src} fit={fit} hoverPlay onError={() => setFailed(true)} style={sx('width:100%;height:100%;display:block')} />
        : null}
    </span>
  );
}

// `field` + `value` + `onFollow` are optional. Given a RELATION field, the heading is the record
// the group stands for: it prints that record's name (not its slug) with its collection's dot,
// and clicking it opens the record — "Bellwether Trust" above its people is a way in to the
// company, not a label.
export function GroupHeader({ label, count, field, value, onFollow }) {
  const linked = !!(field && field.type === 'relation' && field.target && value);
  const names = useRecordNames(linked ? field.target : null);
  const title = linked ? nameOf(names, value).title : label;
  return (
    <div className="vgHead">
      {linked && onFollow ? (
        <button type="button" className="vgLabel vgLink" title={'Open ' + title} onClick={() => onFollow(field.target, String(value))}>
          <span aria-hidden="true" className="relDot" style={{ background: colourOfId(field.target) }} />
          <span>{title}</span>
          <span aria-hidden="true" className="vgGo">↗</span>
        </button>
      ) : <span className="vgLabel">{title}</span>}
      <span className="vgRule" />
      <span className="vgCount" style={{ fontFamily: MONO }}>{Number(count).toLocaleString('en-US')}</span>
    </div>
  );
}

export default function ListView({ collection, view, rows, selected, onSelect, onOpen, onFollow, onPick }) {
  const z = sizeOf(view);
  const cover = coverOf(collection, view);
  const fit = fitOf(view);
  const wrap = wrapOf(view);
  const summary = summaryOf(view);
  const defs = shownFields(collection, view);

  const dated = view.group ? null : listDateField(collection, view);
  const groups = groupRows(rows, collection, dated ? { ...view, group: dated.key } : view);
  // A screenful at a time (./useIncremental) — the rest is drawn as it is scrolled towards.
  const win = useIncremental(rows.length, { step: 150, resetKey: collection.id + '/' + view.id });

  if (!rows.length) {
    return (
      <div style={sx('flex:1;min-height:0;display:flex;align-items:flex-start;justify-content:center;padding:40px 20px')}>
        <Empty size="page" style={sx('max-width:420px')} title="Nothing in this view"
          body="The collection's query and this view's filters together return no records. Nothing is hidden — widen either one." />
      </div>
    );
  }

  // One piece of markup for the two places a row's properties can sit: beside the name, or under
  // it when the view wraps.
  const props = (r, where) => (defs.length ? (
    <div className={'lvProps ' + where} style={{ zoom: z.zoom }}>
      {defs.map(f => (
        <span key={f.key} className="lvProp"><Cell field={f} value={r.fields[f.key]} onFollow={onFollow} onPick={onPick} /></span>
      ))}
    </div>
  ) : null);

  const row = r => {
    const on = selected === r.path;
    return (
      // `rvH` arms OpenRecord's reveal-on-hover. The double-click still opens; the chip is what
      // tells a person it does.
      <div key={r.path} className={'lvRow rvH' + (on ? ' on' : '') + (wrap ? ' wrap' : '')}
        style={{ paddingTop: z.row, paddingBottom: z.row }}
        onClick={() => onSelect(r)} onDoubleClick={() => onOpen(r)}>
        {cover ? <Thumb value={r.fields[cover.key]} size={z.thumb} fit={fit} /> : null}
        <div className="lvMain">
          <span className="lvTitleLine">
            <span className="lvTitle" style={{ fontSize: z.title }}>{r.title}</span>
            <OpenRecord onOpen={() => onOpen(r)} />
          </span>
          {summary && r.summary ? <span className="lvSummary" style={{ fontSize: z.text }}>{r.summary}</span> : null}
          {wrap ? props(r, 'lvPropsBelow') : null}
        </div>
        {!wrap ? props(r, 'lvPropsBeside') : null}
      </div>
    );
  };

  return (
    <div className="lv">
      {groups
        ? takeGroups(groups, win.count).map(g => (
          <section key={g.key || 'none'}>
            <GroupHeader label={g.label} count={g.size} field={groupFieldOf(collection, view)} value={g.key} onFollow={onFollow} />
            {g.items.map(row)}
          </section>
        ))
        : rows.slice(0, win.count).map(row)}
      <More win={win} total={rows.length} />
    </div>
  );
}
