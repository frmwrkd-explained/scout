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

export const INSPECTOR_W = 302;
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
    <div style={sx('border-bottom:1px solid var(--line)')}>
      <button onClick={() => onToggle(open ? null : id)}
        style={{ ...sx('display:flex;align-items:center;gap:9px;width:100%;padding:11px 16px;cursor:pointer;background:transparent;border:none;transition:color 130ms ease'), color: open ? 'var(--fg-soft)' : 'var(--fg-muted)' }}>
        <span style={{ ...mono('font-size:8px;width:12px;text-align:left'), color: 'var(--fg-faint)' }}>{open ? '▾' : '▸'}</span>
        <Eyebrow style={sx('font-size:9px;font-weight:800;letter-spacing:.16em;color:inherit;flex:1;text-align:left')}>{name}</Eyebrow>
        {count != null ? (
          <span style={{ ...mono('font-size:10px;font-weight:600;font-variant-numeric:tabular-nums'), color: 'var(--fg-faint)' }}>{count}</span>
        ) : null}
      </button>
      {open ? <div style={sx('padding:0 16px 14px')}>{children}</div> : null}
    </div>
  );
}

function Nothing({ children }) {
  return <span style={{ ...mono('font-size:9.5px;font-weight:500;letter-spacing:.08em'), color: 'var(--fg-faint)' }}>{children}</span>;
}

// `onChange(key, value)` is optional and is the ONLY difference between this panel reading a
// record and editing it. Pass it and every non-derived property row here becomes live.
// `screen` names the working-preference scope for the collapse toggle — App.jsx's current screen
// key ('collection' | 'document'). Omit it and the preference is shared, which is still correct
// behaviour, just one scope instead of two.
export default function Inspector({ collection, doc, referencedBy = [], open, onToggle, onOpen, onChange, onOpenPath, onOpenBoard, screen }) {
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

  const [collapsed, setCollapsed] = React.useState(() => readCollapsed(screen));
  React.useEffect(() => { setCollapsed(readCollapsed(screen)); }, [screen]);
  const toggleCollapsed = () => setCollapsed(v => { writeCollapsed(screen, !v); return !v; });

  if (collapsed) {
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
    <button type="button" onClick={toggleCollapsed} title="Collapse the inspector" className="hFg"
      style={{ ...mono('flex:none;width:18px;height:18px;display:flex;align-items:center;justify-content:center;background:none;border:none;cursor:pointer;font-size:10px'), color: 'var(--fg-faint)' }}>
      ›
    </button>
  );

  if (!doc) {
    return (
      <aside style={{ ...sx('flex:none;background:var(--surface);border-left:1px solid var(--line);display:flex;flex-direction:column;overflow:hidden'), width: INSPECTOR_W }}>
        <div style={sx('flex:none;height:40px;display:flex;align-items:center;justify-content:space-between;padding:0 12px 0 16px;border-bottom:1px solid var(--line)')}>
          <Eyebrow style={sx('font-size:9px;font-weight:800;letter-spacing:.18em;color:var(--fg-muted)')}>INSPECTOR</Eyebrow>
          {collapseBtn}
        </div>
        <div style={sx('flex:1;display:flex;align-items:center;justify-content:center;padding:16px')}>
          <Nothing>NOTHING SELECTED</Nothing>
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
    <aside style={{ ...sx('flex:none;background:var(--surface);border-left:1px solid var(--line);display:flex;flex-direction:column;overflow:hidden'), width: INSPECTOR_W }}>
      <div style={sx('flex:none;height:40px;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 16px;border-bottom:1px solid var(--line)')}>
        <Eyebrow style={sx('font-size:9px;font-weight:800;letter-spacing:.18em;color:var(--fg-muted)')}>INSPECTOR</Eyebrow>
        {/* Law 8 — every record shows its path, and it is the same string the API takes. It is
            also CLICKABLE, the way the identical line on the document surface has always been:
            rendered as dead text it printed the promise of two clicks without honouring it, and
            with the row's open gesture hidden behind a double-click this was the last exit from a
            selected record. Selecting a row and clicking its path is now the two clicks. */}
        <span style={sx('flex:1;min-width:0;display:flex;justify-content:flex-end')}>
          <button type="button" title={onOpenPath ? 'Open ' + doc.path : doc.path}
            onClick={() => onOpenPath && onOpenPath(doc.path)}
            className={onOpenPath ? 'hAccent' : ''}
            style={{ ...mono('font-size:9.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:none;border:none;padding:0'), color: 'var(--fg-faint)', cursor: onOpenPath ? 'pointer' : 'default' }}>
            {doc.path}
          </button>
        </span>
        {collapseBtn}
      </div>

      <div style={sx('flex:1;min-height:0;overflow-y:auto')}>
        <Section id="props" name="PROPERTIES" count={shown.length} open={open === 'props'} onToggle={onToggle}>
          {shown.length
            ? <PropertyRows collection={collection} values={doc.fields} onChange={onChange} onFollow={onOpen} variant="inspector" hideEmpty />
            : <Nothing>NO PROPERTIES SET</Nothing>}
        </Section>

        <Section id="refs" name="REFERENCED BY" count={referencedBy.length} open={open === 'refs'} onToggle={onToggle}>
          {referencedBy.length
            ? referencedBy.map((r, i) => (
                <button key={i} onClick={() => onOpen && onOpen(null, r.path)}
                  style={{ ...sx('display:flex;flex-direction:column;gap:3px;width:100%;text-align:left;padding:7px 0;cursor:pointer;background:transparent;border:none;border-bottom:1px solid var(--line)') }}>
                  <span style={sx('font-size:12px;font-weight:500;color:var(--fg-soft)')}>{r.title}</span>
                  {/* The pointing FIELD name is the whole point of this section. A DECLARED
                      relation is typed — it gets the marked colour and a #collection, because `#`
                      means "a collection" everywhere else in this app. A loose frontmatter pointer
                      from a memory object (territory/, learnings/) is a real reference but is not
                      schema, so it says where it came from WITHOUT claiming to be a collection. */}
                  <span style={{ ...mono('font-size:9.5px;font-weight:500'), color: 'var(--fg-faint)' }}>
                    <span style={{ color: r.declared ? 'var(--marked)' : 'var(--fg-muted)' }}>{r.field}:</span>
                    {' '}{r.declared ? '#' + r.collection : r.source}
                  </span>
                </button>
              ))
            : <Nothing>NOTHING POINTS HERE</Nothing>}
        </Section>

        <Section id="links" name="LINKS" count={linksOut.length} open={open === 'links'} onToggle={onToggle}>
          {linksOut.length ? (
            <>
              <span style={{ ...mono('font-size:8.5px;font-weight:700;letter-spacing:.12em;display:block;padding:4px 0'), color: 'var(--fg-faint)' }}>OUT / WRITTEN HERE</span>
              {linksOut.map((l, i) => {
                // The one resolver (DecideCards.resolveWikilink) — never a second `|label` stripper.
                const p = resolveWikilink('[[' + l + ']]');
                return p && onOpenPath ? (
                  <button key={i} type="button" onClick={() => onOpenPath(p)} className="hAccent"
                    style={sx('font-size:12px;padding:3px 0;background:none;border:none;text-align:left;cursor:pointer;color:var(--accent)')}>
                    {l}
                  </button>
                ) : (
                  <div key={i} style={sx('font-size:12px;color:var(--fg-soft);padding:3px 0')}>{l}</div>
                );
              })}
            </>
          ) : <Nothing>NO WIKILINKS IN THE BODY</Nothing>}
        </Section>

        <Section id="history" name="HISTORY" count={history.length || null} open={open === 'history'} onToggle={onToggle}>
          {history.length
            ? history.map((ev, i) => <ActivityRow key={ev.id || i} ev={ev} onOpenPath={onOpenPath} />)
            : <Nothing>NOTHING HAS HAPPENED TO THIS RECORD YET</Nothing>}
        </Section>

        {/* A PREVIEW that opens INTO the whiteboard — never a second graph feature (T05 §5).
            `GraphPreview` is exported by Whiteboard.jsx, so there is one implementation of the
            relation view and the big canvas is the same code as the small one. Its own button
            carries THIS document's path, so the board it opens onto already has this record (and
            its relations) placed — there is no second, path-less "open the whiteboard" control
            here any more; two buttons doing the same thing is the bug this replaces. */}
        <Section id="graph" name="GRAPH" count={null} open={open === 'graph'} onToggle={onToggle}>
          <GraphPreview doc={doc} references={referencedBy} onOpenBoard={onOpenBoard} />
        </Section>
      </div>
    </aside>
  );
}
