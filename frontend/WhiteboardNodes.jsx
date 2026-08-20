// The whiteboard's node renderers — one component per node kind, all of them PRESENTATIONAL.
//
// Ported from `frontend/BoardNodes.jsx` in structure and in rule: they take a node, some resolved
// data and callbacks, and render. None of them fetches and none of them writes — `Whiteboard.jsx`
// owns every mutation, which is what keeps a 200-node canvas to one save path.
//
// ── WHY A CARD IS A LIVE DOCUMENT ──────────────────────────────────────────────────────────────
// `DocumentNode` renders the record itself: the typed properties through `cells.jsx`, the body
// through `Markdown.jsx`. Not a screenshot, not a denormalised copy — the node carries a path and
// the server resolves it on read (backend/scoutBoard.mjs `resolveCard`), so editing the record
// anywhere in the app changes the card. THIS is why the board is HTML nodes on one CSS transform
// rather than a canvas library: inside a `<canvas>` scene graph a document is a picture of a
// document, and the whole point of putting documents on a board is lost.
//
// ── THE ALTITUDE RULE APPLIES HERE TOO ─────────────────────────────────────────────────────────
// A card shows the summary and the THREE fields that matter (docs/05_UI_SPEC.md §2.1 — the gate
// status, the primary number, freshness). The rest of the record is one click away, in the surface
// that owns it. A card that rendered nine property rows would move the app's worst altitude bug
// onto its newest screen.
import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { Cell } from './cells';
import { Markdown } from './Markdown';
import { RenderMedia, mediaKind } from './RenderMedia';

const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });

// Selection is one visual language across every kind: an accent ring OUTSIDE the box (box-shadow,
// not border) so selecting never changes a node's layout size by a pixel.
export const ring = on => (on ? { boxShadow: '0 0 0 2px var(--accent), 0 8px 28px rgba(0,0,0,.5)' } : {});

export const NOTE_TONES = { accent: 'var(--accent)', ok: 'var(--ok)', warn: 'var(--warn)', danger: 'var(--danger)' , neutral: 'var(--border-3)' };

const CARD_BED = {
  ...sx('width:100%;height:100%;border-radius:12px;box-sizing:border-box;overflow:hidden;display:flex;flex-direction:column'),
  background: 'var(--surface)', border: '1px solid var(--border-2)',
};

// One header for every record card: what it is, what it is called, and the way down (Law 8 — the
// raw file is always reachable). `kind` is the mono eyebrow, never a second title.
function CardHead({ kind, title, right, onOpen, tone }) {
  return (
    <div style={sx('flex:none;display:flex;align-items:flex-start;gap:8px;padding:9px 11px 7px;border-bottom:1px solid var(--line)')}>
      <div style={sx('flex:1;min-width:0')}>
        <div style={{ ...mono('font-size:8.5px;font-weight:700;letter-spacing:.14em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'), color: tone || 'var(--fg-faint)' }}>{kind}</div>
        <div style={sx('font-size:13px;font-weight:700;color:var(--fg);line-height:1.3;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{title}</div>
      </div>
      {right}
      {onOpen ? (
        <span className="rv" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onOpen(); }}
          title="open the record"
          style={{ ...mono('flex:none;border-radius:5px;padding:3px 7px;cursor:pointer;font-size:8.5px;font-weight:700;letter-spacing:.1em'), color: 'var(--accent)', background: 'transparent', border: '1px solid var(--accent-35)' }}>OPEN</span>
      ) : null}
    </div>
  );
}

// The collapsed properties row from docs/05_UI_SPEC.md §2.1, rendered with the app's typed cells so
// a status chip on the board and a status chip in the table cannot drift apart.
function Props({ props }) {
  if (!props || !props.length) return null;
  return (
    <div style={sx('flex:none;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:7px 11px;border-bottom:1px solid var(--line)')}>
      {props.map(p => (
        <span key={p.key} style={sx('display:inline-flex;align-items:center;gap:6px;min-width:0')}>
          <span style={{ ...mono('font-size:8.5px;letter-spacing:.08em'), color: 'var(--fg-faint)' }}>{p.key}</span>
          <Cell field={p.field} value={p.value} />
        </span>
      ))}
    </div>
  );
}

// A card whose file is gone says so. It is never deleted for the user — Law 5 — and it never
// pretends the record still exists.
function Missing({ node, selected }) {
  return (
    <div style={{ ...CARD_BED, border: '1px dashed var(--border-3)', ...ring(selected) }}>
      <div style={sx('flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:12px;text-align:center')}>
        <span style={{ ...mono('font-size:9px;font-weight:700;letter-spacing:.14em'), color: 'var(--warn)' }}>FILE NOT FOUND</span>
        <span style={{ ...mono('font-size:9px'), color: 'var(--fg-faint)', wordBreak: 'break-all' }}>{node.path}</span>
      </div>
    </div>
  );
}

// ── document ───────────────────────────────────────────────────────────────────────────────────
export function DocumentNode({ node, card, selected, onOpen }) {
  if (!card || card.missing) return <Missing node={node} selected={selected} />;
  return (
    <div className="rvH" style={{ ...CARD_BED, ...ring(selected) }}>
      <CardHead kind={card.collection ? '#' + card.collection : (card.path || '').split('/')[0]} title={card.title} onOpen={onOpen ? () => onOpen(card.path) : null} />
      <Props props={card.props} />
      <div style={sx('flex:1;min-height:0;overflow:hidden;padding:9px 11px;position:relative')}>
        {card.summary ? <div style={sx('font-size:12px;line-height:1.55;color:var(--fg-soft)')}>{card.summary}</div> : null}
        {card.body && card.body.trim() !== (card.summary || '').trim()
          ? <Markdown text={card.body} style={{ ...sx('font-size:11.5px;margin-top:7px'), color: 'var(--fg-muted)' }} />
          : null}
        {/* the card is a card: the rest of the note is one click away, and the fade says so */}
        <div style={sx('position:absolute;left:0;right:0;bottom:0;height:26px;pointer-events:none;background:linear-gradient(0deg,var(--surface),transparent)')} />
      </div>
      <div style={{ ...mono('flex:none;padding:5px 11px;font-size:8.5px;border-top:1px solid var(--line);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), color: 'var(--fg-faint)' }}>{card.path}</div>
    </div>
  );
}

// ── territory ──────────────────────────────────────────────────────────────────────────────────
// The numbers on this card are COMPUTED and have exactly one writer (backend/territory.mjs). They
// are displayed, never derived here — a second yield calculation is the bug CLAUDE.md's
// source-of-truth table exists to prevent.
export function TerritoryNode({ node, card, selected, onOpen }) {
  if (!card || card.missing) return <Missing node={node} selected={selected} />;
  const s = card.stats || null;
  const figure = (label, value) => (
    <span key={label} style={sx('display:flex;flex-direction:column;gap:2px;min-width:0')}>
      <span style={{ ...mono('font-size:8px;letter-spacing:.12em'), color: 'var(--fg-faint)' }}>{label}</span>
      <span style={{ ...mono('font-size:13px;font-weight:700;font-variant-numeric:tabular-nums'), color: 'var(--fg-soft)' }}>{value}</span>
    </span>
  );
  return (
    <div className="rvH" style={{ ...CARD_BED, ...ring(selected) }}>
      <CardHead kind="TERRITORY" tone="var(--marked)" title={card.title} onOpen={onOpen ? () => onOpen(card.path) : null}
        right={s && s.stale ? <span style={{ ...mono('flex:none;font-size:8px;font-weight:700;letter-spacing:.12em;padding:3px 6px;border-radius:5px'), color: 'var(--warn)', border: '1px solid var(--warn)' }}>STALE</span> : null} />
      <div style={sx('flex:none;display:flex;gap:18px;padding:9px 11px')}>
        {s ? figure('FINDS', s.finds) : null}
        {s ? figure('WINS', s.wins) : null}
        {s ? figure('HIT RATE', Math.round((s.hit_rate || 0) * 100) + '%') : null}
        {!s ? <Props props={card.props} /> : null}
      </div>
      {card.summary ? <div style={sx('flex:1;min-height:0;overflow:hidden;padding:0 11px 9px;font-size:11.5px;line-height:1.5;color:var(--fg-muted)')}>{card.summary}</div> : null}
    </div>
  );
}

// ── goal ───────────────────────────────────────────────────────────────────────────────────────
export function GoalNode({ node, card, selected, onOpen }) {
  if (!card || card.missing) return <Missing node={node} selected={selected} />;
  const g = card.goal || null;
  const frac = g && g.target ? Math.max(0, Math.min(1, g.current / g.target)) : null;
  return (
    <div className="rvH" style={{ ...CARD_BED, ...ring(selected) }}>
      <CardHead kind="GOAL" title={(g && g.label) || card.title} onOpen={onOpen ? () => onOpen(card.path) : null}
        right={g && g.behind ? <span style={{ ...mono('flex:none;font-size:8px;font-weight:700;letter-spacing:.12em;padding:3px 6px;border-radius:5px'), color: 'var(--warn)', border: '1px solid var(--warn)' }}>BEHIND</span> : null} />
      <div style={sx('flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;gap:8px;padding:10px 11px')}>
        <div style={sx('display:flex;align-items:baseline;gap:8px')}>
          <span style={{ ...mono('font-size:20px;font-weight:700;font-variant-numeric:tabular-nums'), color: 'var(--fg)' }}>{g ? g.current : '·'}</span>
          {g && g.target != null ? <span style={{ ...mono('font-size:11px'), color: 'var(--fg-muted)' }}>/ {g.target} {g.unit}</span> : null}
          <span style={sx('flex:1')} />
          {g && g.daysLeft != null ? <span style={{ ...mono('font-size:9.5px'), color: g.behind ? 'var(--warn)' : 'var(--fg-faint)' }}>{g.daysLeft} DAYS LEFT</span> : null}
        </div>
        {frac != null ? (
          <span style={sx('display:flex;gap:2px;height:4px')}>
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i} style={{ ...sx('flex:1;border-radius:1px'), background: i < Math.round(frac * 10) ? 'var(--fg-muted)' : 'var(--border)' }} />
            ))}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ── collection-view ────────────────────────────────────────────────────────────────────────────
// A saved query on the canvas, live. It lists what the view holds right now — put "#guest · needs
// review" next to the territory that produces them and the board answers a question it could not
// answer with static cards.
export function CollectionViewNode({ node, rows, total, selected, onOpen }) {
  const list = rows || [];
  return (
    <div className="rvH" style={{ ...CARD_BED, ...ring(selected) }}>
      <CardHead kind={'#' + node.collection + (node.view ? ' · ' + node.view : '')} title={node.view ? node.view.replace(/-/g, ' ') : 'All'}
        right={<span style={{ ...mono('flex:none;font-size:10px;font-weight:700;font-variant-numeric:tabular-nums'), color: 'var(--fg-muted)' }}>{total == null ? '·' : total}</span>} />
      <div style={sx('flex:1;min-height:0;overflow:hidden')}>
        {list.length ? list.map(r => (
          <div key={r.path} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onOpen && onOpen(r.path); }}
            className="hBg" style={sx('display:flex;align-items:center;gap:8px;padding:5px 11px;cursor:pointer;border-bottom:1px solid var(--line)')}>
            <span style={sx('flex:1;min-width:0;font-size:11.5px;color:var(--fg-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{r.title}</span>
          </div>
        )) : (
          <div style={{ ...mono('padding:14px 11px;font-size:9px;font-weight:700;letter-spacing:.12em'), color: 'var(--fg-faint)' }}>NOTHING IN THIS VIEW</div>
        )}
      </div>
    </div>
  );
}

// ── note ───────────────────────────────────────────────────────────────────────────────────────
// The one node kind that is not a pointer: the human's own words, on the canvas, next to the
// evidence. Same treatment as FrameForge's sticky — a tinted bed is the point of the kind.
export function NoteNode({ node, selected, editing, onEdit, onChange, onCommit }) {
  const tone = NOTE_TONES[node.tone] || NOTE_TONES.accent;
  const bed = { background: 'var(--raise)', border: '1px solid ' + tone, borderLeft: '3px solid ' + tone };
  if (editing) {
    return (
      <textarea autoFocus value={node.text || ''} onPointerDown={e => e.stopPropagation()}
        onChange={e => onChange(e.target.value)} onBlur={onCommit}
        onKeyDown={e => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); e.target.blur(); } e.stopPropagation(); }}
        style={{ ...sx('width:100%;height:100%;resize:none;border-radius:9px;padding:11px 12px;box-sizing:border-box;outline:none;font-size:12.5px;line-height:1.5'), color: 'var(--fg)', ...bed }} />
    );
  }
  return (
    <div onDoubleClick={onEdit}
      style={{ ...sx('width:100%;height:100%;border-radius:9px;padding:11px 12px;box-sizing:border-box;overflow:hidden;font-size:12.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word'), color: node.text ? 'var(--fg)' : 'var(--fg-faint)', ...bed, ...ring(selected) }}>
      {node.text || 'Double-click to write'}
    </div>
  );
}

// ── image ──────────────────────────────────────────────────────────────────────────────────────
// A picture goes through RenderMedia — the repo's canonical media component — whenever it has a
// URL we can actually load. A workspace-relative path has no route to serve it until the FILES
// browser lands (T16), so it renders as a named placeholder rather than a broken box: an image
// that silently fails to load is indistinguishable from one that is missing.
export function ImageNode({ node, selected, onOpen }) {
  const remote = /^(https?:|data:image\/)/i.test(String(node.src || ''));
  return (
    <div className="rvH" style={{ ...sx('width:100%;height:100%;border-radius:10px;overflow:hidden;position:relative;box-sizing:border-box'), background: 'var(--sunk)', border: '1px solid var(--border)', ...ring(selected) }}>
      {remote
        ? <RenderMedia src={node.src} kind={mediaKind(node.src)} fit="cover" hoverPlay alt={node.alt || ''} style={sx('width:100%;height:100%;display:block')} />
        : (
          <div style={sx('width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:12px;text-align:center')}>
            <span style={{ ...mono('font-size:9px;font-weight:700;letter-spacing:.14em'), color: 'var(--fg-muted)' }}>IMAGE</span>
            <span style={{ ...mono('font-size:9px'), color: 'var(--fg-faint)', wordBreak: 'break-all' }}>{node.src}</span>
          </div>
        )}
      <div className="rv" style={sx('position:absolute;left:0;right:0;bottom:0;padding:14px 9px 7px;pointer-events:none;background:linear-gradient(0deg,var(--ink),transparent)')}>
        <div style={{ ...mono('font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'), color: 'var(--fg-soft)' }}>{node.alt || node.src}</div>
      </div>
      {onOpen && remote ? (
        <span className="rv" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onOpen(node); }}
          style={{ ...mono('position:absolute;top:7px;right:7px;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:9px;font-weight:700'), color: 'var(--accent)', background: 'var(--surface)', border: '1px solid var(--accent-35)' }}>VIEW</span>
      ) : null}
    </div>
  );
}

// ── frame ──────────────────────────────────────────────────────────────────────────────────────
// Drawn behind everything (the canvas renders frames first — array order IS z-order in the
// document). Its title bar is the only hit target: a frame you could grab anywhere would swallow
// every click meant for the cards inside it.
export function FrameNode({ node, selected, editing, onEdit, onChange, onCommit, onGrab }) {
  return (
    <div style={{ ...sx('width:100%;height:100%;border-radius:14px;box-sizing:border-box;pointer-events:none'), background: 'var(--surface)', border: '1px solid ' + (selected ? 'var(--accent)' : 'var(--border)'), ...(selected ? { boxShadow: '0 0 0 1px var(--accent-35)' } : {}) }}>
      <div onPointerDown={onGrab} onDoubleClick={onEdit}
        style={sx('display:inline-flex;align-items:center;gap:8px;padding:12px 18px 0;pointer-events:auto;cursor:move')}>
        {editing
          ? <input autoFocus value={node.label || ''} onPointerDown={e => e.stopPropagation()}
            onChange={e => onChange(e.target.value)} onBlur={onCommit}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); e.stopPropagation(); }}
            style={{ ...mono('border-radius:5px;padding:2px 7px;outline:none;width:220px;font-size:11.5px;font-weight:700;letter-spacing:.1em'), color: 'var(--fg)', background: 'var(--surface-2)', border: '1px solid var(--accent-35)' }} />
          : <span style={{ ...mono('font-size:11.5px;font-weight:700;letter-spacing:.12em'), color: 'var(--fg-muted)' }}>{node.label || 'FRAME'}</span>}
      </div>
    </div>
  );
}

// ── the lock pip ───────────────────────────────────────────────────────────────────────────────
// A locked node cannot be dragged or resized, which is what an arrangement you have finished wants.
// The pip is the only affordance: it shows on hover and stays visible while locked, so a card that
// refuses to move always says why.
export function LockPip({ locked, onToggle }) {
  return (
    <span className={locked ? '' : 'rv'} onPointerDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); onToggle(); }} title={locked ? 'Unlock' : 'Lock in place'}
      style={{
        ...sx('position:absolute;top:6px;left:6px;width:20px;height:20px;border-radius:5px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:4;font-size:10px'),
        background: 'var(--surface)', border: '1px solid ' + (locked ? 'var(--accent-35)' : 'var(--border-2)'),
        color: locked ? 'var(--accent)' : 'var(--fg-faint)',
      }}>{locked ? 'L' : 'U'}</span>
  );
}

// ── the edge label ─────────────────────────────────────────────────────────────────────────────
// The field name that CREATES the relation, drawn on the line. This is the difference between a
// diagram and a decoration: `found_in` and `top_finds` are facts you can go and check in the
// frontmatter, and the label is how you know which one you are looking at. A dashed, dimmer chip
// marks a loose frontmatter pointer — a field no collection declares as a relation — because
// printing `#collection` for one would be a lie (docs/decisions.md · D4).
export function EdgeLabel({ edge, on }) {
  return (
    <span style={{
      ...mono('display:inline-flex;align-items:center;gap:5px;padding:2px 7px;border-radius:6px;font-size:9px;font-weight:700;letter-spacing:.06em;white-space:nowrap'),
      background: 'var(--surface)',
      border: (edge.declared ? '1px solid ' : '1px dashed ') + (on ? 'var(--accent)' : 'var(--border-2)'),
      color: on ? 'var(--accent)' : (edge.declared ? 'var(--fg-muted)' : 'var(--fg-faint)'),
    }}>
      {edge.label}
      {edge.declared && edge.collection ? <span style={{ color: 'var(--fg-faint)' }}>#{edge.collection}</span> : null}
    </span>
  );
}
