// The whiteboard's node renderers — one component per node kind, all of them PRESENTATIONAL.
//
// Ported from `frontend/BoardNodes.jsx` in structure and in rule: they take a node, some resolved
// data and callbacks, and render. None of them fetches and none of them writes — `Whiteboard.jsx`
// owns every mutation, which is what keeps a 200-node canvas to one save path.
//
// ── A CARD IS THE RECORD, AS IT LOOKS EVERYWHERE ELSE ──────────────────────────────────────────
// A record on the board carries only a path; the server resolves it on every read
// (backend/scoutBoard.mjs `resolveCard`), so the card is live — edit the record anywhere and the
// card changes. What it shows is what the rest of the app shows for that record:
//   · its collection's coloured dot and name (frontend/collectionColour.js — the sidebar's dot)
//   · its name
//   · its PICTURE when its collection has a picture field — whole, on a recessed bed, the same
//     treatment as the cards layout (a reference is judged by its composition; nothing is cropped)
//   · up to three properties through `cells.jsx`, the one place a field type becomes UI
//   · the note's opening lines when there is no picture to lead
// It does not render the note's body. A card is a card: the rest is one click away, on the page
// that owns it — and a wall of thirty cards each painting four thousand characters of Markdown was
// both the app's altitude bug moved onto its newest screen and the slowest thing on the canvas.
//
// Every component here is memoised: a drag re-renders the cards that moved, not the board.
import React from 'react';
import { MONO } from './tokens';
import { Cell } from './cells';
import { RenderMedia, mediaKind } from './RenderMedia';
import { mediaSrc } from './media';
import { colourOfId, labelOfId } from './collectionColour';
import { strokePath } from './boardLayout';

// What a note's stored tone looks like. The ids are the document's (backend/scoutBoard.mjs
// NOTE_TONES — boards on disk carry them, so they do not change); the colours are the app's hue
// tokens, because a sticky note's colour is a way of telling notes apart, never a call to action.
// `accent` therefore renders as the yellow of a paper sticky, not as the interactive accent.
export const NOTE_TONES = {
  accent: 'var(--hue-amber)', ok: 'var(--hue-green)', warn: 'var(--hue-orange)', danger: 'var(--hue-red)', neutral: 'var(--border-3)',
};
export const NOTE_TONE_NAMES = { accent: 'Yellow', ok: 'Green', warn: 'Orange', danger: 'Red', neutral: 'Grey' };

// The eight colours anything a person makes can take — the app's hue tokens, stored BY NAME in the
// board file (backend/scoutBoard.mjs HUES) so a board is right in light and in dark.
export const HUES = ['red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'];
export const hueVar = name => (HUES.includes(name) ? 'var(--hue-' + name + ')' : null);
// A note's colour: its hue if it has one, else what its tone has always looked like.
export const noteInk = node => hueVar(node.colour) || NOTE_TONES[node.tone] || NOTE_TONES.accent;

export const TEXT_SIZES = ['s', 'm', 'l', 'xl'];
export const TEXT_SIZE_NAMES = { s: 'Small', m: 'Medium', l: 'Large', xl: 'Heading' };

const stop = e => e.stopPropagation();

// ── writing in place ───────────────────────────────────────────────────────────────────────────
// One set of keys for every editor on the board, so a note, a shape and bare text all behave the
// same: Enter is a new line; Esc (or ⌘Enter, or clicking away) is done; Tab is "done, and give me
// a connected note beside this one"; Shift+Enter is "done, and one under it". The last two are what
// make a mind-map something you type rather than something you assemble.
function editKeys(e, ops) {
  e.stopPropagation();
  if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); ops.commit(); }
  else if (e.key === 'Tab') { e.preventDefault(); ops.commit('child'); }
  else if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); ops.commit('sibling'); }
}

// A textarea that is exactly as tall as what is in it, with the caret at the end the moment it
// appears. Its height is set from its own content before paint, so typing never makes it jump.
function AutoArea({ value, onChange, ops, className, style, placeholder }) {
  const ref = React.useRef(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = el.scrollHeight + 'px';
  }, [value, className]);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);
  return (
    <textarea ref={ref} data-wb-edit="1" rows={1} value={value} placeholder={placeholder} className={className} style={style}
      spellCheck={false} onPointerDown={stop} onDoubleClick={stop}
      onChange={e => onChange(e.target.value)} onBlur={() => ops.commit()} onKeyDown={e => editKeys(e, ops)} />
  );
}

// Words with links in them: an address in a note is something you can click.
const URL_RE = /(https?:\/\/[^\s<>"']+)/g;
function Linked({ text }) {
  const parts = String(text || '').split(URL_RE);
  if (parts.length === 1) return text;
  return parts.map((part, i) => (i % 2
    ? <a key={i} href={part} target="_blank" rel="noreferrer noopener" className="wbLinkText" onPointerDown={stop} onDoubleClick={stop}>{part}</a>
    : part));
}

// The way down (Law 8): every record card opens its record. A real button; it stops the press
// from starting a drag of the card underneath it.
function Open({ onOpen, label = 'Open' }) {
  if (!onOpen) return null;
  return (
    <button type="button" className="wbOpen rv" title="Open the record" onPointerDown={stop} onDoubleClick={stop}
      onClick={e => { e.stopPropagation(); onOpen(); }}>{label}</button>
  );
}

// One header for every record card: which collection (dot + name), what it is called, the way in.
function Head({ dot, kind, title, right, onOpen }) {
  return (
    <div className="wbHead">
      <div className="wbHeadMain">
        <div className="wbKind">
          {dot ? <span className="wbDot" style={{ background: dot }} /> : null}
          <span className="wbKindText">{kind}</span>
        </div>
        <div className="wbTitle" title={title}>{title}</div>
      </div>
      {right}
      <Open onOpen={onOpen} />
    </div>
  );
}

// Up to three properties, drawn by the app's typed cells so a status chip on the board and one in
// the table cannot drift apart. A chip, a tag or a relation says what it is by its shape; a bare
// number or a date needs its name beside it.
const NEEDS_LABEL = new Set(['number', 'date', 'checkbox', 'text', 'url', 'email', 'phone', 'rollup', 'formula']);
function Props({ props }) {
  if (!props || !props.length) return null;
  return (
    <div className="wbProps">
      {props.map(p => (
        <span key={p.key} className="wbProp">
          {NEEDS_LABEL.has(p.field && p.field.type) ? <span className="wbPropLabel">{p.label || p.key}</span> : null}
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
    <div className={'wbCard wbMissing' + (selected ? ' on' : '')}>
      <span className="wbMissingLabel" style={{ fontFamily: MONO }}>FILE NOT FOUND</span>
      <span className="wbMissingPath" style={{ fontFamily: MONO }}>{node.path}</span>
    </div>
  );
}

// The record's picture: whole (contain), on a recessed bed. A source that will not load leaves the
// bed with the word for it rather than the browser's broken-image glyph.
function Picture({ value, alt }) {
  const src = mediaSrc(value);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => { setFailed(false); }, [src]);
  return (
    <div className="wbMedia">
      {src && !failed
        ? <RenderMedia src={src} kind={mediaKind(String(value))} fit="contain" hoverPlay alt={alt || ''} draggable={false}
            onError={() => setFailed(true)} className="wbMediaImg" />
        : <span className="wbMediaNone" style={{ fontFamily: MONO }}>NO PREVIEW</span>}
    </div>
  );
}

// ── document ───────────────────────────────────────────────────────────────────────────────────
export const DocumentNode = React.memo(function DocumentNode({ node, card, selected, onOpen }) {
  if (!card || card.missing) return <Missing node={node} selected={selected} />;
  const collection = card.collection;
  const kind = collection ? labelOfId(collection) : String(card.path || '').split('/')[0];
  const open = onOpen ? () => onOpen(card.path) : null;
  return (
    <div className={'wbCard rvH' + (selected ? ' on' : '')} title={card.path} onDoubleClick={open ? e => { e.stopPropagation(); open(); } : undefined}>
      <Head dot={collection ? colourOfId(collection) : null} kind={kind} title={card.title} onOpen={open} />
      {card.cover ? <Picture value={card.cover} alt={card.title} /> : null}
      <Props props={card.props} />
      {!card.cover && card.summary ? <div className="wbSummary">{card.summary}</div> : null}
    </div>
  );
});

// ── territory ──────────────────────────────────────────────────────────────────────────────────
// The numbers on this card are COMPUTED and have exactly one writer (backend/territory.mjs). They
// are displayed, never derived here — a second yield calculation is the bug CLAUDE.md's
// source-of-truth table exists to prevent.
export const TerritoryNode = React.memo(function TerritoryNode({ node, card, selected, onOpen }) {
  if (!card || card.missing) return <Missing node={node} selected={selected} />;
  const s = card.stats || null;
  const figure = (label, value) => (
    <span key={label} className="wbFigure">
      <span className="wbFigureLabel" style={{ fontFamily: MONO }}>{label}</span>
      <span className="wbFigureValue" style={{ fontFamily: MONO }}>{value}</span>
    </span>
  );
  const open = onOpen ? () => onOpen(card.path) : null;
  return (
    <div className={'wbCard rvH' + (selected ? ' on' : '')} title={card.path} onDoubleClick={open ? e => { e.stopPropagation(); open(); } : undefined}>
      <Head dot="var(--marked)" kind="Territory" title={card.title} onOpen={open}
        right={s && s.stale ? <span className="wbFlag" style={{ fontFamily: MONO }}>STALE</span> : null} />
      <div className="wbFigures">
        {s ? figure('FINDS', s.finds) : null}
        {s ? figure('WINS', s.wins) : null}
        {s ? figure('HIT RATE', Math.round(s.hit_rate || 0) + '%') : null}
      </div>
      {!s ? <Props props={card.props} /> : null}
      {card.summary ? <div className="wbSummary">{card.summary}</div> : null}
    </div>
  );
});

// ── goal ───────────────────────────────────────────────────────────────────────────────────────
export const GoalNode = React.memo(function GoalNode({ node, card, selected, onOpen }) {
  if (!card || card.missing) return <Missing node={node} selected={selected} />;
  const g = card.goal || null;
  const frac = g && g.target ? Math.max(0, Math.min(1, g.current / g.target)) : null;
  const open = onOpen ? () => onOpen(card.path) : null;
  return (
    <div className={'wbCard rvH' + (selected ? ' on' : '')} title={card.path} onDoubleClick={open ? e => { e.stopPropagation(); open(); } : undefined}>
      <Head dot="var(--fg-muted)" kind="Goal" title={(g && g.label) || card.title} onOpen={open}
        right={g && g.behind ? <span className="wbFlag" style={{ fontFamily: MONO }}>BEHIND</span> : null} />
      <div className="wbGoal">
        <div className="wbGoalLine">
          <span className="wbGoalNow" style={{ fontFamily: MONO }}>{g ? g.current : '·'}</span>
          {g && g.target != null ? <span className="wbGoalOf" style={{ fontFamily: MONO }}>/ {g.target} {g.unit}</span> : null}
          <span style={{ flex: 1 }} />
          {g && g.daysLeft != null ? <span className="wbGoalDays" style={{ fontFamily: MONO, color: g.behind ? 'var(--warn)' : 'var(--fg-faint)' }}>{g.daysLeft} DAYS LEFT</span> : null}
        </div>
        {frac != null ? (
          <span className="wbGoalBar">
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i} style={{ background: i < Math.round(frac * 10) ? 'var(--fg-muted)' : 'var(--border)' }} />
            ))}
          </span>
        ) : null}
      </div>
    </div>
  );
});

// ── collection-view ────────────────────────────────────────────────────────────────────────────
// A saved view on the canvas, live. It lists what the view holds right now — put "Guests · needs
// review" next to the ground that produces them and the board answers a question static cards
// cannot. Rows open their record; what does not fit is counted, never silently cut.
const VIEW_ROWS = 40;
export const CollectionViewNode = React.memo(function CollectionViewNode({ node, rows, total, selected, onOpen }) {
  const list = rows || [];
  const shown = list.slice(0, VIEW_ROWS);
  const count = total == null ? list.length : total;
  return (
    <div className={'wbCard rvH' + (selected ? ' on' : '')}>
      <Head dot={colourOfId(node.collection)} kind={labelOfId(node.collection) + ' · view'}
        title={node.view ? node.view.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase()) : 'Everything'}
        right={<span className="wbCount" style={{ fontFamily: MONO }}>{rows == null ? '·' : Number(count).toLocaleString('en-US')}</span>} />
      <div className="wbRows">
        {shown.length ? shown.map(r => (
          <button type="button" key={r.path} className="wbRow hBg" onPointerDown={stop} onDoubleClick={stop}
            onClick={e => { e.stopPropagation(); if (onOpen) onOpen(r.path); }}>
            <span className="wbRowTitle">{r.title}</span>
          </button>
        )) : (
          <div className="wbRowsNone" style={{ fontFamily: MONO }}>{rows == null ? 'LOADING…' : 'NOTHING IN THIS VIEW'}</div>
        )}
        {list.length > shown.length ? <div className="wbRowsMore">and {(list.length - shown.length).toLocaleString('en-US')} more</div> : null}
      </div>
    </div>
  );
});

// ── note ───────────────────────────────────────────────────────────────────────────────────────
// The one node kind that is not a pointer: the human's own words, on the canvas, next to the
// evidence. A tinted edge is the point of the kind — it is how two notes are told apart.
export const NoteNode = React.memo(function NoteNode({ node, selected, editing, ops }) {
  const ink = noteInk(node);
  const style = { '--wb-ink': ink };
  if (editing) {
    return (
      <textarea autoFocus data-wb-edit="1" value={node.text || ''} onPointerDown={stop} onDoubleClick={stop} className="wbNote wbNoteEdit" style={style}
        spellCheck={false} onChange={e => ops.text(node, e.target.value)} onBlur={() => ops.commit()} placeholder="Write a note…"
        onFocus={e => { const end = e.target.value.length; e.target.setSelectionRange(end, end); }}
        onKeyDown={e => editKeys(e, ops)} />
    );
  }
  return (
    <div onDoubleClick={e => { e.stopPropagation(); ops.edit(node); }} className={'wbNote' + (selected ? ' on' : '') + (node.text ? '' : ' empty')} style={style}>
      {node.text ? <Linked text={node.text} /> : 'Double-click to write'}
    </div>
  );
});

// ── text ───────────────────────────────────────────────────────────────────────────────────────
// Bare words on the canvas: a heading over a group, a label beside a line, a remark. No card
// around them. While it is being written the node is a textarea in exactly the same type, plus an
// invisible copy of the words on one line each — that copy is how the board learns how wide the
// text really is, so the box can hug it when you click away (Whiteboard.jsx `commitEdit`).
export const TextNode = React.memo(function TextNode({ node, editing, ops }) {
  const cls = 'wbText sz-' + (TEXT_SIZES.includes(node.size) ? node.size : 'm') + (node.bold ? ' bold' : '');
  const ink = hueVar(node.colour);
  const style = ink ? { color: ink } : undefined;
  if (editing) {
    return (
      <>
        <AutoArea value={node.text || ''} className={cls + ' wbTextEdit'} style={style} placeholder="Type…" ops={ops} onChange={v => ops.text(node, v)} />
        <span data-wb-mirror="1" className={cls + ' wbTextMirror'} aria-hidden="true">{(node.text || '') + '\u200b'}</span>
      </>
    );
  }
  return <div className={cls} style={style} onDoubleClick={e => { e.stopPropagation(); ops.edit(node); }}><Linked text={node.text} /></div>;
});

// ── shape ──────────────────────────────────────────────────────────────────────────────────────
// A box with words in the middle: the step, the decision and the terminator of a flowchart. The
// outline is the shape's colour and its fill is a tint of it — never the accent, which on this
// screen means "press me".
export const SHAPES = ['rect', 'round', 'ellipse', 'diamond'];
export const SHAPE_NAMES = { rect: 'Rectangle', round: 'Rounded', ellipse: 'Ellipse', diamond: 'Diamond' };
export const ShapeNode = React.memo(function ShapeNode({ node, selected, editing, ops }) {
  const shape = SHAPES.includes(node.shape) ? node.shape : 'rect';
  const ink = hueVar(node.colour);
  const w = node.w, h = node.h;
  return (
    <div className={'wbShape ' + shape + (selected ? ' on' : '')} style={ink ? { '--wb-ink': ink } : undefined}
      onDoubleClick={e => { e.stopPropagation(); ops.edit(node); }}>
      {shape === 'diamond' ? (
        <svg className="wbShapeSvg" width={w} height={h} aria-hidden="true">
          <polygon points={(w / 2) + ',1 ' + (w - 1) + ',' + (h / 2) + ' ' + (w / 2) + ',' + (h - 1) + ' 1,' + (h / 2)} />
        </svg>
      ) : null}
      <div className={'wbShapeText sz-' + (TEXT_SIZES.includes(node.size) ? node.size : 'm')}>
        {editing
          ? <AutoArea value={node.text || ''} className="wbShapeEdit" ops={ops} onChange={v => ops.text(node, v)} />
          : (node.text || null)}
      </div>
    </div>
  );
});

// ── draw ───────────────────────────────────────────────────────────────────────────────────────
// A freehand stroke. The node's box is only where the stroke lives; what you can click (and what
// the eraser touches) is the LINE — a fat invisible copy of it — so a long diagonal does not own
// the rectangle of board it happens to cross.
export const DrawNode = React.memo(function DrawNode({ node, selected, ops }) {
  const d = React.useMemo(() => strokePath(node.points), [node.points]);
  const width = node.width || 4;
  return (
    <svg className={'wbDraw' + (selected ? ' on' : '')} width={node.w} height={node.h}>
      <path d={d} className="wbDrawHit" strokeWidth={Math.max(16, width + 12)} onPointerDown={e => ops.down(e, node)} />
      {selected ? <path d={d} className="wbDrawHalo" strokeWidth={width + 6} /> : null}
      <path d={d} className="wbDrawInk" stroke={hueVar(node.colour) || 'var(--fg-soft)'} strokeWidth={width} />
    </svg>
  );
});

// ── image ──────────────────────────────────────────────────────────────────────────────────────
// A picture on the board. `src` is a URL or a workspace-relative path; a path is served by the
// same route every other picture in the app uses (`mediaSrc` → GET /api/files/raw), so a
// screenshot dropped onto the board and a record's own image are drawn by the same code. Whole
// picture, never cropped.
export const ImageNode = React.memo(function ImageNode({ node, selected }) {
  const src = mediaSrc(node.src);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => { setFailed(false); }, [src]);
  return (
    <div className={'wbImage' + (selected ? ' on' : '')} title={node.alt || node.src}>
      {src && !failed
        ? <RenderMedia src={src} kind={mediaKind(String(node.src))} fit="contain" hoverPlay alt={node.alt || ''} draggable={false}
            onError={() => setFailed(true)} className="wbMediaImg" />
        : (
          <div className="wbMissing" style={{ border: 'none' }}>
            <span className="wbMissingLabel" style={{ fontFamily: MONO }}>IMAGE NOT FOUND</span>
            <span className="wbMissingPath" style={{ fontFamily: MONO }}>{node.src}</span>
          </div>
        )}
    </div>
  );
});

// ── frame ──────────────────────────────────────────────────────────────────────────────────────
// Drawn behind everything (the canvas renders frames first — array order IS z-order in the
// document). Its title is the only hit target: a frame you could grab anywhere would swallow every
// click meant for the cards inside it.
export const FrameNode = React.memo(function FrameNode({ node, selected, editing, ops }) {
  return (
    <div className={'wbFrame' + (selected ? ' on' : '')}>
      <div className="wbFrameTitle" onPointerDown={e => ops.down(e, node)} onDoubleClick={e => { e.stopPropagation(); ops.edit(node); }}>
        {editing
          ? <input autoFocus data-wb-edit="1" value={node.label || ''} onPointerDown={stop} onDoubleClick={stop} className="wbFrameInput" placeholder="Name this group"
              onChange={e => ops.label(node, e.target.value)} onBlur={() => ops.commit()}
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); ops.commit(); } }} />
          : <span className="wbFrameLabel">{node.label || 'Group'}</span>}
      </div>
    </div>
  );
});

// ── the lock pip ───────────────────────────────────────────────────────────────────────────────
// A locked node cannot be dragged or resized, which is what an arrangement you have finished wants.
// The pip shows on a selected card and stays visible while locked, so a card that refuses to move
// always says why.
export function LockPip({ locked, onToggle }) {
  return (
    <button type="button" className={'wbLock' + (locked ? ' on' : '')} onPointerDown={stop}
      onClick={e => { e.stopPropagation(); onToggle(); }} title={locked ? 'Locked in place — click to unlock' : 'Lock in place'}
      aria-pressed={locked}>{locked ? 'Locked' : 'Lock'}</button>
  );
}

// ── the edge label ─────────────────────────────────────────────────────────────────────────────
// The field that CREATES the relation, drawn on the line, in the words the rest of the app uses
// for it ("Company", "Found in"). This is the difference between a diagram and a decoration: the
// label is a fact you can go and check in the frontmatter. A dashed, dimmer chip marks a loose
// pointer — a field no collection declares as a relation (docs/decisions.md · D4).
export function EdgeLabel({ edge, on }) {
  return (
    <span className={'wbEdgeLabel' + (edge.declared ? '' : ' loose') + (on ? ' on' : '')}>{edge.label}</span>
  );
}

// ── a drawn link's label ───────────────────────────────────────────────────────────────────────
// The person's own word for a line they drew. It sits on the line with a solid bed under it, so it
// is never printed over a card, and it takes the line's colour so the two read as one thing. While
// it is being written it is a real field in the same place.
export function LinkLabel({ link, on, editing, onChange, onCommit }) {
  const ink = hueVar(link.colour);
  if (editing) {
    return (
      <input autoFocus data-wb-edit="1" value={link.label || ''} className="wbLinkInput" placeholder="Name this link" size={Math.max(8, String(link.label || '').length + 1)}
        onPointerDown={stop} onDoubleClick={stop} onChange={e => onChange(e.target.value)} onBlur={onCommit}
        onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); onCommit(); } }} />
    );
  }
  return <span className={'wbLinkLabel' + (on ? ' on' : '')} style={ink ? { '--wb-ink': ink } : undefined}>{link.label}</span>;
}

// ── colour swatches ────────────────────────────────────────────────────────────────────────────
// The eight hues, and "no colour". Used for notes, text, shapes, strokes and links alike, so a
// colour means the same thing on all of them.
export function Swatches({ value, onPick, none = 'No colour' }) {
  return (
    <span className="wbSwatches" role="group" aria-label="Colour">
      {none ? (
        <button type="button" className={'wbTone plain' + (!value ? ' on' : '')} title={none} aria-label={none} aria-pressed={!value}
          onPointerDown={stop} onClick={e => { e.stopPropagation(); onPick(null); }} />
      ) : null}
      {HUES.map(h => (
        <button type="button" key={h} className={'wbTone' + (value === h ? ' on' : '')} title={h.charAt(0).toUpperCase() + h.slice(1)} aria-label={h} aria-pressed={value === h}
          style={{ background: hueVar(h) }} onPointerDown={stop} onClick={e => { e.stopPropagation(); onPick(h); }} />
      ))}
    </span>
  );
}
