// The inspector — 302px, five sections, ONE EXPANDED AT A TIME, a count on every collapsed header.
// Order is fixed by docs/05_UI_SPEC.md §1 and T05: PROPERTIES · REFERENCED BY · LINKS · HISTORY · GRAPH.
//
// REFERENCED BY and LINKS are different things and must LOOK different. The first is structured
// and typed — it shows the pointing field name, because "which field points at me" is the question.
// The second is prose — wikilinks someone wrote in a body. Collapsing them into one list is what
// makes a tags feature stop feeling like a database.
//
// PROPERTIES is the same typed row set the document surface uses (./cells), for when the centre
// pane holds a table rather than a document.

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { Eyebrow } from './ui';
import { Cell } from './cells';

export const INSPECTOR_W = 302;
const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });

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

function Row({ k, children }) {
  return (
    <div style={sx('display:flex;align-items:center;gap:10px;min-height:26px;padding:3px 0')}>
      {/* A long key (evidence_weight) used to run under its own value at a fixed 74px. It
          truncates instead — the full key is on the title, and the VALUE is what the eye is
          here for. */}
      <span title={k} style={{ ...mono('flex:none;width:74px;font-size:9.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), color: 'var(--fg-faint)' }}>{k}</span>
      <span style={sx('flex:1;min-width:0')}>{children}</span>
    </div>
  );
}

function Nothing({ children }) {
  return <span style={{ ...mono('font-size:9.5px;font-weight:500;letter-spacing:.08em'), color: 'var(--fg-faint)' }}>{children}</span>;
}

export default function Inspector({ collection, doc, referencedBy = [], open, onToggle, onOpen }) {
  if (!doc) {
    return (
      <aside style={{ ...sx('flex:none;background:var(--surface);border-left:1px solid var(--line);display:flex;flex-direction:column;overflow:hidden'), width: INSPECTOR_W }}>
        <div style={sx('flex:none;height:40px;display:flex;align-items:center;padding:0 16px;border-bottom:1px solid var(--line)')}>
          <Eyebrow style={sx('font-size:9px;font-weight:800;letter-spacing:.18em;color:var(--fg-muted)')}>INSPECTOR</Eyebrow>
        </div>
        <div style={sx('flex:1;display:flex;align-items:center;justify-content:center;padding:16px')}>
          <Nothing>NOTHING SELECTED</Nothing>
        </div>
      </aside>
    );
  }

  const defs = collection?.fields || [];
  const shown = defs.filter(f => doc.fields[f.key] !== undefined && doc.fields[f.key] !== '');
  // Body wikilinks, split by direction. Outgoing is what this document says; incoming is what
  // other bodies say about it — prose, not schema, which is why it is not REFERENCED BY.
  const linksOut = [...String(doc.body || '').matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]);

  return (
    <aside style={{ ...sx('flex:none;background:var(--surface);border-left:1px solid var(--line);display:flex;flex-direction:column;overflow:hidden'), width: INSPECTOR_W }}>
      <div style={sx('flex:none;height:40px;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 16px;border-bottom:1px solid var(--line)')}>
        <Eyebrow style={sx('font-size:9px;font-weight:800;letter-spacing:.18em;color:var(--fg-muted)')}>INSPECTOR</Eyebrow>
        {/* Law 8 — every record shows its path, and it is the same string the API takes. */}
        <span style={{ ...mono('font-size:9.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), color: 'var(--fg-faint)' }} title={doc.path}>
          {doc.path}
        </span>
      </div>

      <div style={sx('flex:1;min-height:0;overflow-y:auto')}>
        <Section id="props" name="PROPERTIES" count={shown.length} open={open === 'props'} onToggle={onToggle}>
          {shown.length
            ? shown.map(f => <Row key={f.key} k={f.key}><Cell field={f} value={doc.fields[f.key]} onOpen={onOpen} /></Row>)
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
              {linksOut.map((l, i) => <div key={i} style={sx('font-size:12px;color:var(--fg-soft);padding:3px 0')}>{l}</div>)}
            </>
          ) : <Nothing>NO WIKILINKS IN THE BODY</Nothing>}
        </Section>

        <Section id="history" name="HISTORY" count={null} open={open === 'history'} onToggle={onToggle}>
          <Nothing>M2 — THE EVENT LOG</Nothing>
        </Section>

        <Section id="graph" name="GRAPH" count={null} open={open === 'graph'} onToggle={onToggle}>
          <Nothing>M5 — OPENS INTO THE WHITEBOARD</Nothing>
        </Section>
      </div>
    </aside>
  );
}
