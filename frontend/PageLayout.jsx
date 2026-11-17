// PageLayout — "Edit layout": how every record of a collection is laid out.
//
// A record's page is always live — you click and write, there is no edit mode — so the button
// that used to say "Edit note" now edits the one thing that is NOT the record: the page's shape.
// And the shape belongs to the COLLECTION. Change it on any reference and every reference follows:
// where the picture sits, how wide the page is, which parts show and in what order, and which
// properties sit under the title.
//
// It is a panel beside the page, not a dialog over it, so the record stays in view and every
// choice shows immediately on the real thing. Each choice is saved as it is made, into the
// collection's own file (`page` and `header` in `.scout/collections/<id>.md`, through
// `PATCH /api/collections/:id/meta`) — the same keys an agent can read or set.
//
// What the keys mean, their defaults and the validation live in shared/recordPage.mjs; which
// fields may be header properties lives in RecordHeader.jsx. This file only draws the controls.

import React from 'react';
import { FieldIcon } from './cells';
import { propertyLabel } from './PropertyRows';
import { headerFields, headerCandidates } from './RecordHeader';
import { pageOf, PAGE_LAYOUTS, PAGE_WIDTHS, PAGE_SECTIONS, PAGE_LABELS, PAGE_MEDIA, PAGE_MEDIA_SIZES, PAGE_TEXT } from '../shared/recordPage.mjs';
import PanelSplitter, { usePanelWidth } from './PanelSplitter';

// A small drawing of each layout: the picture is the filled block, the lines are text.
function Diagram({ layout }) {
  const lines = <span className="plLines"><i /><i /><i style={{ width: '60%' }} /></span>;
  if (layout === 'side') return <span className="plDiagram plDiagramSide"><span className="plPic" />{lines}</span>;
  if (layout === 'compact') return <span className="plDiagram plDiagramCompact"><span className="plRow"><i style={{ flex: 1 }} /><span className="plPic" /></span>{lines}</span>;
  return <span className="plDiagram"><span className="plPic" />{lines}</span>;
}

function Seg({ label, value, options, onPick }) {
  return (
    <div className="plSeg" role="radiogroup" aria-label={label}>
      {options.map(([key, text]) => (
        <button key={key} type="button" role="radio" aria-checked={value === key} className={'plSegBtn' + (value === key ? ' on' : '')}
          onClick={() => onPick(key)}>{text}</button>
      ))}
    </div>
  );
}

function Group({ title, hint, children }) {
  return (
    <section className="plGroup">
      <h3 className="plTitle">{title}</h3>
      {hint ? <p className="plHint">{hint}</p> : null}
      {children}
    </section>
  );
}

// One row of an ordered, tickable list (sections; header properties).
function Row({ on, label, icon, first, last, onToggle, onMove }) {
  return (
    <div className="plRow2">
      <button type="button" role="checkbox" aria-checked={on} className="plPick hBg" onClick={onToggle}>
        <span aria-hidden="true" className={'plCheck' + (on ? ' on' : '')}>{on ? '✓' : ''}</span>
        {icon ? <FieldIcon type={icon} size={14} style={{ color: 'var(--fg-faint)' }} /> : null}
        <span className="plPickLabel" style={{ color: on ? 'var(--fg)' : 'var(--fg-muted)' }}>{label}</span>
      </button>
      {on && onMove ? (
        <span className="plMove">
          <button type="button" aria-label={'Move ' + label + ' up'} title="Move up" disabled={first} onClick={() => onMove(-1)}>↑</button>
          <button type="button" aria-label={'Move ' + label + ' down'} title="Move down" disabled={last} onClick={() => onMove(1)}>↓</button>
        </span>
      ) : null}
    </div>
  );
}

const moved = (list, key, by) => {
  const at = list.indexOf(key), to = at + by;
  if (at < 0 || to < 0 || to >= list.length) return list;
  const next = [...list]; next.splice(at, 1); next.splice(to, 0, key);
  return next;
};

// `schema` is the collection as currently shown (including changes not yet confirmed by the
// server); `onChange(patch)` takes `{ page }` and/or `{ header }` and applies + saves it.
export default function PageLayout({ schema, onChange, onClose, error }) {
  const [width, setWidth, resetWidth] = usePanelWidth('scout.layout.w', 340, { min: 300, max: 560 });
  const page = pageOf(schema);
  const stored = { layout: page.layout, width: page.width, sections: page.sections, media: page.media, mediaSize: page.mediaSize, text: page.text };
  const setPage = patch => onChange({ page: { ...stored, ...patch } });

  const shown = headerFields(schema).map(f => f.key);
  const candidates = headerCandidates(schema);
  const setHeader = keys => onChange({ header: keys });
  const customised = !!schema.page || Array.isArray(schema.header);
  const name = schema.label || schema.id;

  return (
    <aside className="pl" aria-label="Edit layout" style={{ width }}>
      <PanelSplitter edge="left" width={width} onResize={setWidth} onReset={resetWidth} label="Resize the layout panel" />
      <div className="plHead">
        <span className="plHeadTitle">Edit layout</span>
        <button type="button" className="plClose hFg" onClick={onClose} aria-label="Close layout" title="Close">×</button>
      </div>
      <div className="plScroll">
        <p className="plLead">This is how every <b>{name}</b> record looks. Changes apply to all of them at once and are saved as you make them.</p>

        <Group title="Where the picture sits">
          <div className="plLayouts" role="radiogroup" aria-label="Where the picture sits">
            {PAGE_LAYOUTS.map(l => (
              <button key={l} type="button" role="radio" aria-checked={page.layout === l} className={'plLayout' + (page.layout === l ? ' on' : '')}
                onClick={() => setPage({ layout: l, ...(l === 'side' && !schema.page?.width ? { width: 'wide' } : {}) })}>
                <Diagram layout={l} />
                <span>{PAGE_LABELS.layout[l]}</span>
              </button>
            ))}
          </div>
        </Group>

        <Group title="Several pictures" hint="How a record with more than one picture shows them. Add pictures with the + tile or by dropping files on the page.">
          <Seg label="Picture style" value={page.media} options={PAGE_MEDIA.map(m => [m, PAGE_LABELS.media[m]])} onPick={media => setPage({ media })} />
          {page.layout === 'stack' ? (
            <Seg label="Picture size" value={page.mediaSize} options={PAGE_MEDIA_SIZES.map(m => [m, PAGE_LABELS.mediaSize[m]])} onPick={mediaSize => setPage({ mediaSize })} />
          ) : null}
        </Group>

        <Group title="Long text" hint="A prompt or a brief can start folded to a few lines, or fully open.">
          <Seg label="Long text" value={page.text} options={PAGE_TEXT.map(t => [t, PAGE_LABELS.text[t]])} onPick={text => setPage({ text })} />
        </Group>

        <Group title="Width">
          <div className="plSeg" role="radiogroup" aria-label="Page width">
            {PAGE_WIDTHS.map(w => (
              <button key={w} type="button" role="radio" aria-checked={page.width === w} className={'plSegBtn' + (page.width === w ? ' on' : '')}
                onClick={() => setPage({ width: w })}>{PAGE_LABELS.width[w]}</button>
            ))}
          </div>
        </Group>

        <Group title="Parts of the page" hint="Untick a part to hide it. Use the arrows to change the order.">
          {page.sections.map((s, i) => (
            <Row key={s} on label={PAGE_LABELS.sections[s]} first={i === 0} last={i === page.sections.length - 1}
              onToggle={() => setPage({ sections: page.sections.filter(x => x !== s) })}
              onMove={by => setPage({ sections: moved(page.sections, s, by) })} />
          ))}
          {page.hidden.map(s => (
            <Row key={s} on={false} label={PAGE_LABELS.sections[s]} onToggle={() => setPage({ sections: [...page.sections, s] })} />
          ))}
        </Group>

        <Group title="Under the title" hint="The properties shown at the top of every record. The rest stay one click away in Details.">
          {shown.map((key, i) => {
            const f = candidates.find(c => c.key === key);
            return f ? (
              <Row key={key} on label={propertyLabel(f)} icon={f.type} first={i === 0} last={i === shown.length - 1}
                onToggle={() => setHeader(shown.filter(k => k !== key))}
                onMove={by => setHeader(moved(shown, key, by))} />
            ) : null;
          })}
          {candidates.filter(f => !shown.includes(f.key)).map(f => (
            <Row key={f.key} on={false} label={propertyLabel(f)} icon={f.type} onToggle={() => setHeader([...shown, f.key])} />
          ))}
          {!candidates.length ? <p className="plHint">This collection has no short properties yet. Add one from Details.</p> : null}
        </Group>

        {error ? <p className="plError" role="alert">{error}</p> : null}

        {customised ? (
          <button type="button" className="plReset hBd" onClick={() => onChange({ page: null, header: null })}>Back to the default layout</button>
        ) : null}
      </div>
    </aside>
  );
}

export { PAGE_SECTIONS };
