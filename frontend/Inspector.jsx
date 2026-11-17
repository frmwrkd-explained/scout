// The inspector — 302px, five sections, ONE EXPANDED AT A TIME, a count on every collapsed header.
// Order is fixed by docs/05_UI_SPEC.md §1 and T05: PROPERTIES · REFERENCED BY · LINKS · HISTORY · GRAPH.
//
// REFERENCED BY and LINKS are different things and must LOOK different. The first is structured
// and typed — it shows the pointing field name, because "which field points at me" is the question.
// The second is prose — wikilinks someone wrote in a body. Collapsing them into one list is what
// makes a tags feature stop feeling like a database.
//
// PROPERTIES is the SAME COMPONENT the document surface renders — PropertyRows.jsx, at the
// inspector's density. Not a second row implementation that happens to look similar (Law 10): the
// difference between reading a property here and editing it on the document surface is one prop.

import React from 'react';
import { api } from './api';
import { ActivityRow } from './Activity';
import { GraphPreview } from './Whiteboard';
import { sx } from './sx';
import { MONO } from './tokens';
import { Eyebrow } from './ui';
import { resolveWikilink } from './DecideCards';
import PropertyRows, { rowsFor } from './PropertyRows';
import PanelSplitter, { usePanelWidth } from './PanelSplitter';
import { RenderMedia } from './RenderMedia';
import { mediaSrc } from './media';
import { colourOf, collectionLabel, colourOfId, labelOfId } from './collectionColour';

export const INSPECTOR_W = 360;
const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });

// docs/05_UI_SPEC.md §1 draws the inspector "(collapsible)" — it never was. The preference is
// remembered per SCREEN, the same working-preference pattern Document.jsx uses for PROPERTIES
// (`scout.props.open.<collection>`): collapsing it while reading a document should not also
// collapse it on the collection table, and vice versa.
const COLLAPSE_KEY = screen => 'scout.inspector.collapsed.' + (screen || '_default');
function readCollapsed(screen) {
  try { return window.localStorage.getItem(COLLAPSE_KEY(screen)) === '1'; } catch { return false; }
}
function writeCollapsed(screen, on) {
  try { window.localStorage.setItem(COLLAPSE_KEY(screen), on ? '1' : '0'); } catch { /* private mode */ }
}
const RAIL_COLLAPSED_W = 28;

function Section({ id, name, count, open, onToggle, children }) {
  return (
    <div className="inspSection">
      <button type="button" className={'inspSectionHead' + (open ? ' on' : '')} onClick={() => onToggle(open ? null : id)} aria-expanded={open}>
        <span className="inspChevron" aria-hidden="true">›</span>
        <span className="inspSectionName">{name}</span>
        {count != null ? <span className="inspCount" style={{ fontFamily: MONO }}>{count}</span> : null}
      </button>
      {open ? <div className="inspSectionBody">{children}</div> : null}
    </div>
  );
}

function Nothing({ children }) {
  return <span className="inspNothing">{children}</span>;
}

// The selected record, at a glance. The picture is the collection's `primary_media` (else its first
// file field) shown whole; the name is the record's own. `Open` is a real button — a double-click
// on a tile is a gesture, and this is the one place a person looks after a single click.
function Preview({ collection, doc, onOpenPath }) {
  const files = (collection?.fields || []).filter(f => f.type === 'file');
  const field = files.find(f => f.primary_media) || files[0] || null;
  const src = field ? mediaSrc(doc.fields?.[field.key]) : null;
  return (
    <div className="inspPreview">
      {src ? (
        <div className="inspPreviewMedia">
          <RenderMedia src={src} fit="contain" controls style={sx('width:100%;height:100%;display:block')} />
        </div>
      ) : null}
      <div className="inspPreviewHead">
        <span className="inspPreviewTitle">{doc.title}</span>
        {onOpenPath ? (
          <button type="button" className="inspPreviewOpen hBd" onClick={() => onOpenPath(doc.path)}>Open</button>
        ) : null}
      </div>
      {doc.summary ? <p className="inspSummary">{doc.summary}</p> : null}
    </div>
  );
}

// `onChange(key, value)` is optional and is the ONLY difference between this panel reading a
// record and editing it. Pass it and every non-derived property row here becomes live.
// `screen` names the working-preference scope for the collapse toggle — App.jsx's current screen
// key ('collection' | 'document'). Omit it and the preference is shared, which is still correct
// behaviour, just one scope instead of two.
export default function Inspector({ collection, doc, referencedBy = [], open, onToggle, onOpen, onChange, onOpenPath, onOpenBoard, screen, properties, onClose, className }) {
  // HISTORY is the event log filtered to this one file — who changed what, agent or human,
  // newest first (T05 §4). It is fetched per selection rather than carried in the row, because a
  // table of 150 rows must not pay for 150 histories nobody opened.
  const [history, setHistory] = React.useState([]);
  const docPath = doc && doc.path;
  React.useEffect(() => {
    if (!docPath) { setHistory([]); return undefined; }
    let alive = true;
    api.history(docPath)
      .then(r => { if (alive) setHistory(r.events || []); })
      .catch(() => { if (alive) setHistory([]); });
    return () => { alive = false; };
  }, [docPath]);

  // Its width is the person's: drag the left edge. One remembered width for every place this panel
  // opens, because it is the same panel.
  const [width, setWidth, resetWidth] = usePanelWidth('scout.inspector.w', INSPECTOR_W, { min: 280, max: 820 });
  const splitter = <PanelSplitter edge="left" width={width} onResize={setWidth} onReset={resetWidth} label="Resize the details panel" />;

  const [collapsed, setCollapsed] = React.useState(() => readCollapsed(screen));
  React.useEffect(() => { setCollapsed(readCollapsed(screen)); }, [screen]);
  const toggleCollapsed = () => setCollapsed(v => { writeCollapsed(screen, !v); return !v; });

  if (collapsed && !onClose) {
    return (
      <aside style={{ ...sx('flex:none;background:var(--surface);border-left:1px solid var(--line);display:flex;flex-direction:column;align-items:center'), width: RAIL_COLLAPSED_W }}>
        <button type="button" onClick={toggleCollapsed} title="Expand the inspector" className="hFg"
          style={{ ...mono('flex:none;width:100%;height:40px;display:flex;align-items:center;justify-content:center;background:none;border:none;border-bottom:1px solid var(--line);cursor:pointer;font-size:11px'), color: 'var(--fg-faint)' }}>
          ‹
        </button>
      </aside>
    );
  }

  const collapseBtn = (
    <button type="button" onClick={onClose || toggleCollapsed} title={onClose ? 'Close details' : 'Collapse the inspector'} aria-label={onClose ? 'Close details' : 'Collapse the inspector'} className="hFg"
      style={{ ...sx('flex:none;width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:6px;background:none;border:none;cursor:pointer;font-size:16px;line-height:1'), color: 'var(--fg-faint)' }}>
      {onClose ? '×' : '›'}
    </button>
  );

  if (!doc) {
    return (
      <aside style={{ ...sx('position:relative;flex:none;background:var(--surface);border-left:1px solid var(--line);display:flex;flex-direction:column;overflow:hidden'), width }}>
        {splitter}
        <div style={sx('flex:none;height:40px;display:flex;align-items:center;justify-content:space-between;padding:0 12px 0 16px;border-bottom:1px solid var(--line)')}>
          <span className="inspWhere">Details</span>
          {collapseBtn}
        </div>
        <div style={sx('flex:1;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center')}>
          <Nothing>Select a record to see its details here.</Nothing>
        </div>
      </aside>
    );
  }

  // The row set (and therefore the count on the collapsed header) is decided in one place, by the
  // component that renders it.
  const shown = rowsFor(collection, doc.fields, { hideEmpty: true });
  // Body wikilinks, split by direction. Outgoing is what this document says; incoming is what
  // other bodies say about it — prose, not schema, which is why it is not REFERENCED BY.
  const linksOut = [...String(doc.body || '').matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]);

  return (
    <aside className={className} aria-label="Note details" style={{ ...sx('position:relative;flex:none;background:var(--surface);border-left:1px solid var(--line);display:flex;flex-direction:column;overflow:hidden'), width }}>
      {splitter}
      <div style={sx('flex:none;height:40px;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 16px;border-bottom:1px solid var(--line)')}>
        {/* Where the selected record lives, the way the sidebar names it. */}
        <span className="inspWhere">
          {collection ? <span className="relDot" style={{ background: colourOf(collection) }} aria-hidden="true" /> : null}
          {collection ? collectionLabel(collection) : 'Details'}
        </span>
        <span style={sx('flex:1')} />
        {collapseBtn}
      </div>

      <div style={sx('flex:1;min-height:0;overflow-y:auto')}>
        {/* What was just clicked, large: its picture and its name, and the way in. On the record's
            own page (`properties` is passed there) the page already shows both. */}
        {!properties ? <Preview collection={collection} doc={doc} onOpenPath={onOpenPath} /> : null}
        <Section id="props" name="Properties" count={properties ? null : shown.length} open={open === 'props'} onToggle={onToggle}>
          {properties || (shown.length
            ? <PropertyRows collection={collection} values={doc.fields} onChange={onChange} onFollow={onOpen} variant="inspector" hideEmpty
                // The preview above already shows the name and the picture — not twice.
                omit={(collection?.fields || []).filter(f => f.primary || (f.type === 'file' && f === ((collection.fields.filter(x => x.type === 'file').find(x => x.primary_media)) || collection.fields.find(x => x.type === 'file')))).map(f => f.key)} />
            : <Nothing>No properties set yet.</Nothing>)}
        </Section>

        {referencedBy.length ? <Section id="refs" name="Referenced by" count={referencedBy.length} open={open === 'refs'} onToggle={onToggle}>
          {referencedBy.length
            ? referencedBy.map((r, i) => (
                // What points here, by name — and WHICH property of it does the pointing, in the
                // property's own words ("People · Company"), not as `company: #people`.
                <button key={i} type="button" className="inspRef hBg" onClick={() => onOpen && onOpen(null, r.path)}>
                  <span className="inspRefTitle">{r.title}</span>
                  <span className="inspRefMeta">
                    {r.declared ? <span className="relDot" style={{ background: colourOfId(r.collection) }} aria-hidden="true" /> : null}
                    {(r.declared ? labelOfId(r.collection) || r.collection : r.source) + ' · ' + String(r.field || '').replace(/_/g, ' ')}
                  </span>
                </button>
              ))
            : <Nothing>Nothing points here.</Nothing>}
        </Section> : null}

        {linksOut.length ? <Section id="links" name="Links" count={linksOut.length} open={open === 'links'} onToggle={onToggle}>
          {linksOut.length ? (
            <>
              <span className="inspNothing" style={sx('display:block;padding:2px 0 6px')}>Written in this note</span>
              {linksOut.map((l, i) => {
                // The one resolver (DecideCards.resolveWikilink) — never a second `|label` stripper.
                const p = resolveWikilink('[[' + l + ']]');
                return p && onOpenPath ? (
                  <button key={i} type="button" onClick={() => onOpenPath(p)} className="hAccent"
                    style={sx('font-size:var(--t-body);padding:4px 0;background:none;border:none;text-align:left;cursor:pointer;color:var(--accent)')}>
                    {l}
                  </button>
                ) : (
                  <div key={i} style={sx('font-size:var(--t-body);color:var(--fg-soft);padding:4px 0')}>{l}</div>
                );
              })}
            </>
          ) : <Nothing>No links in the note.</Nothing>}
        </Section> : null}

        <Section id="history" name="History" count={history.length || null} open={open === 'history'} onToggle={onToggle}>
          {history.length
            ? history.map((ev, i) => <ActivityRow key={ev.id || i} ev={ev} onOpenPath={onOpenPath} />)
            : <Nothing>Nothing has happened to this record yet.</Nothing>}
        </Section>

        {/* A PREVIEW that opens INTO the whiteboard — never a second graph feature (T05 §5).
            `GraphPreview` is exported by Whiteboard.jsx, so there is one implementation of the
            relation view and the big canvas is the same code as the small one. Its own button
            carries THIS document's path, so the board it opens onto already has this record (and
            its relations) placed — there is no second, path-less "open the whiteboard" control
            here any more; two buttons doing the same thing is the bug this replaces. */}
        <Section id="graph" name="Connections" count={null} open={open === 'graph'} onToggle={onToggle}>
          <GraphPreview doc={doc} references={referencedBy} onOpenBoard={onOpenBoard} />
        </Section>
      </div>
      <div className="inspFoot">
        <span className="inspFootLabel">The file</span>
        <button type="button" className="inspFootPath hFg" title={'Open ' + doc.path} onClick={() => onOpenPath?.(doc.path)} style={{ fontFamily: MONO }}>{doc.path}</button>
      </div>
    </aside>
  );
}
