// THE WHITEBOARD — one board per project. `docs/05_UI_SPEC.md` §5, T15.
//
// ── WHY THIS IS NOT A CANVAS LIBRARY ───────────────────────────────────────────────────────────
// HTML nodes on ONE CSS transform, ported from FrameForge's `Board.jsx` in structure. Every mature
// canvas library (tldraw, Excalidraw, Konva, Fabric) paints to `<canvas>`, where a document becomes
// a picture of a document — and putting live documents on a board is the entire point of this
// surface for Scout. So: HTML nodes, a CSS-transform viewport, and the document stays markdown.
// (tldraw is separately licensed too, which forecloses it for an app that gets sold.)
//
// ── THE ONE INVARIANT ──────────────────────────────────────────────────────────────────────────
// Nothing moves that the user did not move. AUTO-ALIGN IS A BUTTON (`tidy` from boardLayout.js),
// never a render-time derivation, so a card you dragged next to its territory stays there. A
// derived layout cannot hold a deliberate placement. The same goes for the camera: choosing a tool
// never pans or zooms.
//
// ── TWO KINDS OF LINE ──────────────────────────────────────────────────────────────────────────
// EDGES are read, never drawn: the server derives one for every real relation between the records
// on the board and labels it with the field that makes it (backend/scoutBoard.mjs `deriveEdges`).
// They are quiet and grey, because they are facts and not anyone's emphasis.
// LINKS are drawn: a person drags from a dot on the side of anything to anything else. They are
// stored in the board file's `links` list, carry the person's own label, arrowhead and colour, and
// say nothing about the records. When a link happens to join two records a relation field could
// join, its bar offers to make it real — one explicit button, and the record is then written by
// the record writer, not by this file.
//
// ── SAVE DISCIPLINE ────────────────────────────────────────────────────────────────────────────
// A drag is ONE save, fired on pointerup — not one per mousemove. Node coordinates live in this
// component during a gesture and are flushed once; the camera saves on a longer debounce, carries
// no base revision and never writes a log line, because panning is not document content. A pen
// stroke and a connector being dragged are drawn straight to the DOM and become state once, when
// the pointer comes up.
//
// ── WHAT A PERSON CAN DO HERE ──────────────────────────────────────────────────────────────────
// Put records on it (the shelf), a collection as one live list, pictures. WRITE: bare text, notes,
// shapes with words in them — all edited where they stand. CONNECT: drag a link between any two
// things, name it, point it, colour it; Tab grows a connected note, so a mind-map is typed, not
// assembled. DRAW: freehand strokes, and an eraser. Move, resize, multi-select, nudge, line up,
// lock, duplicate, copy and paste, arrange, undo and redo. Removing a card takes it off the BOARD;
// the record is never touched (Law 5) and the UI says so every time.
//
// Props:
//   board            board id (the project id). Default 'main'.
//   onOpenDocument   (path) => void — OPEN on a card, and a row in a collection-view card.
//   onToast          (message, tone) => void — 'green' | 'amber' | 'red'. Optional.
//   full             boolean — the shell has hidden its chrome for this surface.
//   onToggleFull     () => void — Shift+F. When absent, the key does nothing and no button is drawn.
//   place            a `.md` path, carried in from the inspector's GRAPH ("Open in the whiteboard",
//                     docs/05_UI_SPEC.md §5). Placed on mount if it is not already a node on this
//                     board, along with its REFERENCED BY relations — so the click that says
//                     "show me how this connects" lands on a board that already shows it, not an
//                     empty canvas with one card.
import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { MONO } from './tokens';
import { Btn } from './ui';
import {
  GRID, clampZoom, snap, bounds, fitView, toBoard, arrowGeom, curvePoint, isRect,
  alignNodes, distributeNodes, snapGuides, tidy, BOARD_CARD, gridSlots, freeSpot, labelSpot,
  packStroke, parsePoints, strokeHit,
} from './boardLayout';
import {
  DocumentNode, TerritoryNode, GoalNode, CollectionViewNode, NoteNode, TextNode, ShapeNode, DrawNode, ImageNode, FrameNode,
  LockPip, EdgeLabel, LinkLabel, Swatches, hueVar, TEXT_SIZES, TEXT_SIZE_NAMES, SHAPES, SHAPE_NAMES,
} from './WhiteboardNodes';
import { ToolIcon } from './whiteboardIcons';
import { colourOf, collectionLabel } from './collectionColour';
import { mediaSrc } from './media';
import './whiteboard.css';

const RAIL_INSET = 62;              // the tool rail: 10 + 44 + 8 — it never moves, so nothing else jumps
const SHELF_W = 268;
const SHELF_INSET = RAIL_INSET + SHELF_W + 12;   // the canvas width the rail and the shelf cover, for fit and for placing
const ADD_MANY = 30;                // "Add these" places at most this many at once — a board, not a table
const HISTORY = 80;

const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });
const stop = e => e.stopPropagation();

// What a new node is born as. Record cards come from boardLayout's BOARD_CARD (shared with the
// server, which is the authority on a record card's size — see `sizeFor`); the rest are the
// canvas's own.
const SIZES = {
  document: BOARD_CARD.plain,
  'collection-view': { w: 340, h: 320 },
  territory: { w: 300, h: 200 },
  goal: { w: 300, h: 160 },
  note: { w: 220, h: 80 },             // a note starts small and grows downward as you write in it
  image: { w: 320, h: 240 },
  frame: { w: 800, h: 520 },
  shape: { w: 200, h: 120 },
};
// How wide bare text is allowed to run before it wraps, per size. A text node hugs its words up to
// this width; drag its corner and the width is yours instead (`fixed`).
const TEXT_WRAP = { s: 320, m: 400, l: 520, xl: 720 };
const TEXT_LINE = { s: 21, m: 26, l: 34, xl: 50 };
const LINK_GAP = 140;               // between a card and the related ones brought in beside it — room for the label
const GROW_GAP = 140;               // between a node and the note Tab grows from it

// The tools, in rail order. `once` tools place one thing and hand you back the pointer; pen and
// eraser stay until Esc, because nobody draws one stroke.
const TOOL_KEYS = { v: 'select', h: 'hand', t: 'text', n: 'note', c: 'connect', p: 'pen', e: 'eraser', f: 'frame' };
const SHAPE_KEYS = { r: 'rect', o: 'ellipse', d: 'diamond' };
const STROKE_WIDTHS = [2, 4, 8];
// What a link may be drawn from or to: anything you can point at. A frame is a region (only its
// title is solid) and a stroke is a line, so neither is an end.
const linkable = n => !!n && n.t !== 'frame' && n.t !== 'draw';
const WORDY = new Set(['note', 'text', 'shape']);
const COLOURABLE = new Set(['note', 'text', 'shape', 'draw']);
const ARRANGED = new Set(['document', 'territory', 'goal', 'collection-view', 'image']);

const isTyping = () => {
  const el = document.activeElement;
  return !!el && (/^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable);
};
const isUrl = s => /^https?:\/\/\S+$/i.test(String(s || '').trim());

// The board routes api.js does not carry (it is not this file's to edit): what a record is related
// to, storing a picture dropped onto the board, and making a drawn link real. Errors carry the
// server's sentence.
const answer = async response => {
  let body = null;
  try { body = await response.json(); } catch { /* an empty or non-JSON body */ }
  if (!response.ok) throw Object.assign(new Error((body && body.error) || 'api ' + response.status), { status: response.status });
  return body;
};
const boardUrl = id => '/api/scout/board/' + encodeURIComponent(id);
const boardApi = {
  related: (id, path) => fetch(boardUrl(id) + '/related?path=' + encodeURIComponent(path)).then(answer),
  image: (id, file) => fetch(boardUrl(id) + '/image?name=' + encodeURIComponent(file.name || ''), {
    method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file,
  }).then(answer),
  realise: (id, link) => fetch(boardUrl(id) + '/links/' + encodeURIComponent(link) + '/realise', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  }).then(answer),
};

// A picture's own proportions, so an image node is born the shape of its picture.
async function shapeOf(file) {
  try {
    if (!/^image\//.test(file.type) || typeof createImageBitmap !== 'function') return null;
    const bmp = await createImageBitmap(file);
    const out = { w: bmp.width, h: bmp.height };
    if (bmp.close) bmp.close();
    return out.w && out.h ? out : null;
  } catch { return null; }
}

// Keep the object a card already has when the server hands back an equal one: every card on the
// board is memoised on its node and its resolved record, and a save that changed one card must not
// re-render the other ninety-nine.
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
function keepEqual(prev, next, key = x => x.id) {
  const old = new Map((prev || []).map(x => [key(x), x]));
  return (next || []).map(x => { const o = old.get(key(x)); return o && same(o, x) ? o : x; });
}
function keepEqualMap(prev, next) {
  const out = {};
  for (const k of Object.keys(next || {})) out[k] = prev && prev[k] && same(prev[k], next[k]) ? prev[k] : next[k];
  return out;
}
// Links whose two ends are both still on the board.
const prune = (links, nodes) => { const ids = new Set(nodes.map(n => n.id)); return (links || []).filter(l => ids.has(l.from) && ids.has(l.to)); };

// ── one node on the canvas ─────────────────────────────────────────────────────────────────────
// Memoised: a drag changes the objects of the nodes being dragged and nobody else's, so a board of
// a hundred cards re-renders the three that moved. `ops` is one stable object of the component's
// own methods — a fresh closure per render would defeat the memo.
const BoardNode = React.memo(function BoardNode({ node: n, card, on, editing, rows, total, canOpen, ops }) {
  const open = canOpen ? ops.open : null;
  let body = null;
  if (n.t === 'document') body = <DocumentNode node={n} card={card} selected={on} onOpen={open} />;
  else if (n.t === 'territory') body = <TerritoryNode node={n} card={card} selected={on} onOpen={open} />;
  else if (n.t === 'goal') body = <GoalNode node={n} card={card} selected={on} onOpen={open} />;
  else if (n.t === 'collection-view') body = <CollectionViewNode node={n} rows={rows} total={total} selected={on} onOpen={open} />;
  else if (n.t === 'note') body = <NoteNode node={n} selected={on} editing={editing} ops={ops} />;
  else if (n.t === 'text') body = <TextNode node={n} editing={editing} ops={ops} />;
  else if (n.t === 'shape') body = <ShapeNode node={n} selected={on} editing={editing} ops={ops} />;
  else if (n.t === 'draw') body = <DrawNode node={n} selected={on} ops={ops} />;
  else if (n.t === 'image') body = <ImageNode node={n} selected={on} />;
  else if (n.t === 'frame') body = <FrameNode node={n} selected={on} editing={editing} ops={ops} />;

  // A frame is pointer-transparent except for its title, and a stroke except for its line, so
  // neither swallows a click aimed at what sits inside its box.
  const frame = n.t === 'frame', stroke = n.t === 'draw';
  const bare = stroke || n.t === 'text' || n.t === 'shape';
  return (
    <div data-wb-node={n.id} data-wb-kind={n.t}
      className={'wbNode' + (frame ? ' frame' : stroke ? ' stroke' : ' grab') + (bare ? ' bare' : '') + (n.locked ? ' locked' : '')}
      onPointerDown={frame || stroke ? undefined : e => ops.down(e, n)}
      style={{ left: n.x, top: n.y, width: n.w, height: n.h }}>
      {body}
      {on && !editing && !n.locked && !stroke ? <div className="wbGrip" onPointerDown={e => ops.resize(e, n)} title="Drag to resize" /> : null}
    </div>
  );
});

export default class Whiteboard extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      doc: null,                 // { nodes, links, edges, cards, offers, view, rev, seq, log }
      sel: {},                   // node id → true
      selLink: null,             // the one drawn link that is selected
      editLink: null,            // the drawn link whose label is being written
      marquee: null,             // { x0, y0, x1, y1 } in board space, while one is being dragged
      gesturing: false,          // a move / resize / marquee / stroke is in flight — hides the selection bar
      edit: null,                // node id whose text is being edited
      hover: null,               // node id under the pointer — it shows its link dots
      hoverEdge: null,
      tool: 'select',
      shapeKind: 'rect',
      pen: { width: 4, colour: null },
      connectFrom: null,         // Connect tool: the node already clicked, waiting for the second
      // The records list starts CLOSED. Open, it covered the left of the board on every visit and
      // its search box took the keyboard, so T / N / C did nothing until it was dismissed. The
      // Records button and the empty board's "Add records" open it.
      shelf: false,
      collections: [],
      shelfCollection: null,
      shelfRows: [],
      memoryRows: { territory: [], goal: [] },
      viewRows: {},              // 'collection/view' → { rows, total } for the collection-view cards
      q: '',
      menu: null,                // 'view' | 'shape' | 'pen' while that flyout is open
      busy: '', err: '',
      dropping: false,           // files from outside are being dragged over the canvas
      guides: [],                // live snap lines, transient — never persisted
      undo: 0, redo: 0,          // how deep each history stack is — only so the buttons can enable
    };
    this.canvas = React.createRef();
    this.layer = React.createRef();
    this.ink = React.createRef();       // the stroke being drawn — painted directly, never through state
    this.band = React.createRef();      // the connector being dragged — likewise
    this.zoomLabel = React.createRef();
    this.bar = React.createRef();       // the floating selection bar — see placeBar
    this.filter = React.createRef();
    this.picker = React.createRef();
    this._key = e => this.onKey(e);
    this._wheel = e => this.onWheel(e);
    this._saveT = null; this._viewT = null; this._commitT = null; this._raf = 0;
    this._space = false;
    this._view = null;           // the LIVE camera — see setView
    this._ver = 0;               // bumped by every local change to nodes or links — see flush
    this._rev = null;            // the board revision the server last told us — the `base` of the next save
    this._undo = []; this._redo = [];
    this._editing = null;        // { id, before, fresh, at } while a node's words are being written
    this._clip = null;
    // The node components' handlers, bound once (see BoardNode).
    this.ops = {
      down: (e, n) => this.onNodeDown(e, n),
      resize: (e, n) => this.startResize(e, n),
      open: path => this.props.onOpenDocument && this.props.onOpenDocument(path),
      edit: n => this.beginEdit(n.id),
      text: (n, v) => { this.patchNode(n.id, { text: v }); if (n.t === 'note' || n.t === 'shape') this.fitWords(n.id); },
      label: (n, v) => this.patchNode(n.id, { label: v }),
      commit: then => this.endEdit(then),
      lock: n => this.setNodes(this.state.doc.nodes.map(x => (x.id === n.id ? { ...x, locked: !x.locked || undefined } : x)), n.locked ? 'unlocked a card' : 'locked a card'),
    };
  }

  boardId() { return this.props.board || 'main'; }
  toast(msg, tone) { if (this.props.onToast) this.props.onToast(msg, tone); }

  componentDidMount() {
    this.load().then(() => this.placeIncoming());
    this.loadCollections();
    window.addEventListener('keydown', this._key, true);
    window.addEventListener('keyup', this._key, true);
    window.addEventListener('paste', this._paste = e => this.onPaste(e));
    window.addEventListener('pointerdown', this._away = e => {
      if (this.state.menu && !(e.target.closest && e.target.closest('.wbMenuWrap'))) this.setState({ menu: null });
    }, true);
    // Re-read on focus. An agent rearranging the board through its own door, or a second window, is
    // the ordinary case here — not an edge one — and coming back to a stale canvas is how a clobber
    // starts. Skipped mid-gesture and mid-sentence so nothing is yanked out from under the cursor.
    window.addEventListener('focus', this._focus = () => {
      if (!this.state.gesturing && !this.state.edit && !this.state.editLink && !this._saveT && !this._saving) this.load();
    });
  }
  componentWillUnmount() {
    window.removeEventListener('keydown', this._key, true);
    window.removeEventListener('keyup', this._key, true);
    window.removeEventListener('paste', this._paste);
    window.removeEventListener('pointerdown', this._away, true);
    window.removeEventListener('focus', this._focus);
    if (this._wheelOn) this._wheelOn.removeEventListener('wheel', this._wheel);
    if (this._bandOff) this._bandOff();
    clearTimeout(this._saveT); clearTimeout(this._viewT); clearTimeout(this._commitT);
    cancelAnimationFrame(this._raf);
    this.flush();
  }
  componentDidUpdate(prev) {
    // The wheel listener is attached by hand, NOT through React's onWheel: React registers wheel
    // listeners as passive, so `preventDefault()` there is ignored and a trackpad pinch zooms the
    // whole app window instead of the board. The canvas element only exists once the board has
    // loaded, hence here rather than in componentDidMount.
    const el = this.canvas.current;
    if (el !== this._wheelOn) {
      if (this._wheelOn) this._wheelOn.removeEventListener('wheel', this._wheel);
      if (el) el.addEventListener('wheel', this._wheel, { passive: false });
      this._wheelOn = el;
      this.paintView();
    }
    this.placeBar();
    if (prev.board !== this.props.board) { this._view = null; this.load().then(() => this.placeIncoming()); return; }
    if (prev.place !== this.props.place && this.props.place) this.placeIncoming();
  }

  // ── data ─────────────────────────────────────────────────────────────────────────────────────
  async load() {
    try {
      const doc = await api.scoutBoard(this.boardId());
      doc.links = doc.links || []; doc.offers = doc.offers || {};
      // What somebody else did cannot be undone from here: a reload starts the history again.
      this._undo = []; this._redo = []; this._ver++; this._editing = null;
      this._rev = doc.rev;
      if (!this._moving) this._view = doc.view;
      this.setState({ doc, undo: 0, redo: 0, edit: null, editLink: null, selLink: null, err: doc.foreign ? 'This project already holds a different kind of board — it has not been touched.' : '' },
        () => { this.paintView(); this.loadViewNodes(); });
    } catch (e) { this.setState({ err: e.message }); }
  }
  async loadCollections() {
    try {
      const { collections } = await api.collections();
      this.setState({ collections }, () => {
        if (collections.length) this.pickShelf(collections[0].id);
      });
    } catch { /* the shelf is an accelerator, not the surface */ }
    // Territory and goals are memory objects, not collection records — they get their own two tabs
    // on the shelf, loaded once alongside the collections.
    Promise.all([
      api.territory().catch(() => ({ territory: [] })),
      api.goals().catch(() => ({ goals: [] })),
    ]).then(([t, g]) => this.setState({
      memoryRows: {
        territory: (t.territory || []).map(x => ({ path: x.path, title: (x.data && x.data.name) || x.id })),
        goal: (g.goals || []).map(x => ({ path: x.path, title: x.label || x.id })),
      },
    }));
  }
  async pickShelf(id) {
    this.setState({ shelfCollection: id, shelfRows: [], q: '' });
    try {
      const { rows } = await api.documents(id, '');
      this.setState(s => (s.shelfCollection === id ? { shelfRows: rows || [] } : null));
    } catch (e) { this.setState({ err: e.message }); }
  }
  // The two MEMORY tabs — sentinel ids so a collection somebody happens to call "territory" or
  // "goal" can never be shadowed by these.
  pickMemoryShelf(kind) {
    this.setState({ shelfCollection: kind === 'goal' ? '__goal__' : '__territory__', shelfRows: this.state.memoryRows[kind] || [], q: '' });
  }

  // The collection a record path belongs to, by its folder — good enough to choose a card's size
  // before the server has resolved it (the server then has the last word, see `sizeFor`).
  collectionOfPath(path) {
    const p = String(path || '');
    return (this.state.collections || []).find(c => {
      const glob = String((c.query && c.query.path) || '');
      const prefix = glob.split('*')[0];
      return prefix && p.startsWith(prefix);
    }) || null;
  }
  pictureField(collection) {
    const files = ((collection && collection.fields) || []).filter(f => f.type === 'file');
    return files.find(f => f.primary_media) || files[0] || null;
  }
  // The size a record card is born at. `_auto` marks it as a guess: `flush` sends the node without
  // a size and the server decides from the record itself whether there is a picture to make room
  // for (backend/scoutBoard.mjs `saveBoard`), so a card placed here and one placed by an agent
  // agree.
  sizeFor(spec) {
    if (spec.t !== 'document') return SIZES[spec.t] || SIZES.note;
    return { ...(this.pictureField(this.collectionOfPath(spec.path)) ? BOARD_CARD.picture : BOARD_CARD.plain), _auto: true };
  }

  // A `.md` path handed in from the inspector's GRAPH ("Open in the whiteboard"). Places the
  // document if it is not already here, and what it is related to beside it — so the click that
  // says "show me how this connects" lands on a board that already shows it.
  async placeIncoming() {
    const path = this.props.place;
    const doc = this.state.doc;
    if (!path || !doc || doc.foreign) return;
    let node = doc.nodes.find(n => n.path === path);
    if (!node) {
      const made = await this.addRecords([{ t: /^territory\//.test(path) ? 'territory' : /^goals\//.test(path) ? 'goal' : 'document', path }], 'placed ' + path, { reveal: false });
      node = made && made[0];
    }
    if (node) await this.showRelated(node, { quiet: true });
    this.fit();
  }
  // A collection-view card is a LIVE query, so it reads the same route the table reads. One fetch
  // per distinct collection+view on the board, not one per card.
  async loadViewNodes() {
    const doc = this.state.doc;
    if (!doc) return;
    const want = [...new Set(doc.nodes.filter(n => n.t === 'collection-view').map(n => n.collection + '/' + (n.view || '')))];
    for (const key of want) {
      if (this.state.viewRows[key]) continue;
      const [collection, view] = key.split('/');
      try {
        const r = await api.documents(collection, view || '');
        this.setState(s => ({ viewRows: { ...s.viewRows, [key]: { rows: r.rows || [], total: r.total ?? (r.rows || []).length } } }));
      } catch {
        this.setState(s => ({ viewRows: { ...s.viewRows, [key]: { rows: [], total: 0 } } }));
      }
    }
  }

  // ── the one way the board's content changes ──────────────────────────────────────────────────
  // Every local change to nodes or links goes through `put`, which counts it. The count is how a
  // save knows whether the board it sent is still the board on screen when the answer comes back
  // (see `flush`) — the alternative is a reply landing mid-sentence and replacing what you typed.
  put(patch, done) {
    this._ver++;
    this.setState(s => {
      if (!s.doc) return null;
      const p = typeof patch === 'function' ? patch(s.doc) : patch;
      return p ? { doc: { ...s.doc, ...p } } : null;
    }, done);
  }
  node(id) { const doc = this.state.doc; return doc ? doc.nodes.find(n => n.id === id) || null : null; }
  link(id) { const doc = this.state.doc; return doc ? doc.links.find(l => l.id === id) || null : null; }
  // Ids for what is made here are minted here, so a note and the link that points at it can be
  // made in one gesture and one save. The server keeps any id it is handed and never reuses one.
  newId(prefix = 'c') {
    const doc = this.state.doc;
    const taken = new Set([...(doc ? doc.nodes : []), ...(doc ? doc.links : [])].map(x => x.id));
    let id;
    do { id = prefix + Math.random().toString(36).slice(2, 8); } while (taken.has(id));
    return id;
  }
  // What a person would call a node — for the log line a save writes.
  nameOf(n) {
    if (!n) return 'something';
    const card = n.path && this.state.doc.cards ? this.state.doc.cards[n.path] : null;
    const words = (card && card.title) || n.text || n.label || n.alt || n.t;
    return String(words).replace(/\s+/g, ' ').trim().slice(0, 40) || n.t;
  }

  // ── history ──────────────────────────────────────────────────────────────────────────────────
  // Undo and redo for what a person did to the BOARD: moves, resizes, adds, removes, words, links,
  // strokes, colours. It is the node list and the link list before each change, kept in memory —
  // nothing in the document. The board is saved whole, so restoring an earlier state is an
  // ordinary save (same route, same stale-write guard). A reload — somebody else changed the board
  // — empties both stacks: you can undo your work, not theirs.
  remember() {
    const doc = this.state.doc;
    if (!doc) return;
    this._undo.push({ nodes: doc.nodes, links: doc.links });
    if (this._undo.length > HISTORY) this._undo.shift();
    this._redo = [];
    this.setState({ undo: this._undo.length, redo: 0 });
  }
  // Take back the last `remember` — for an edit that turned out to change nothing.
  forget() { this._undo.pop(); this.setState({ undo: this._undo.length }); }
  step(from, to, word) {
    const doc = this.state.doc;
    if (!doc || !from.length || doc.foreign) return;
    if (this._editing) this.endEdit();
    const snap0 = from.pop();
    to.push({ nodes: this.state.doc.nodes, links: this.state.doc.links });
    this._ver++;
    this.setState(s => ({ doc: { ...s.doc, nodes: snap0.nodes, links: snap0.links }, sel: {}, selLink: null, edit: null, editLink: null, undo: this._undo.length, redo: this._redo.length }),
      () => this.queueSave(word));
  }
  undo() { this.step(this._undo, this._redo, 'undid a change'); }
  redo() { this.step(this._redo, this._undo, 'redid a change'); }

  // ── saving ───────────────────────────────────────────────────────────────────────────────────
  // Optimistic: state moves now, disk catches up. A failed save surfaces as an error and the board
  // is reloaded, because a canvas silently out of sync with its file is worse than a jump.
  setNodes(nodes, log, { remember = true } = {}) {
    if (remember) this.remember();
    this.put(d => ({ nodes, links: prune(d.links, nodes) }), () => this.queueSave(log));
  }
  setLinks(links, log, { remember = true } = {}) {
    if (remember) this.remember();
    this.put({ links }, () => this.queueSave(log));
  }
  patchNode(id, patch) {
    this.put(d => ({ nodes: d.nodes.map(x => (x.id === id ? { ...x, ...patch } : x)) }));
  }
  queueSave(log) {
    clearTimeout(this._saveT);
    this._pendingLog = log || this._pendingLog || '';
    this._saveT = setTimeout(() => this.flush(), 350);
  }
  // ONE save in flight at a time. Two overlapping flushes both send the rev the client currently
  // holds, so the second is stale by construction and 409s against the first — the client racing
  // itself. A change during a save asks for another flush; the in-flight response carries the
  // fresh rev and the re-flush rides on it.
  //
  // When the answer arrives it replaces the board ONLY if nothing changed here in the meantime and
  // nobody is mid-sentence. Otherwise what is on screen is newer than what was sent: it stays, and
  // only the things the server alone knows are taken from the answer — the revision, the derived
  // edges, the live cards, and the size of a record card it measured.
  flush() {
    clearTimeout(this._saveT); this._saveT = null;
    const doc = this.state.doc;
    if (!doc || doc.foreign) return Promise.resolve(null);
    if (this._saving) { this._again = true; return this._saving; }
    const log = this._pendingLog; this._pendingLog = '';
    const ver = this._ver;
    // A card whose size was a guess goes without one: the server sizes it from the record.
    const nodes = doc.nodes.map(n => { if (!n._auto) return n; const { _auto, w, h, ...rest } = n; return rest; });
    // `base` is the revision of the last answer, kept on the instance: a re-flush fires from this
    // promise's own `finally`, before React has applied the state the answer set, and a base read
    // from state there is one revision behind — the client 409ing against its own previous save.
    this._saving = api.saveScoutBoard(this.boardId(), { nodes, links: doc.links, log, base: this._rev == null ? doc.rev : this._rev })
      .then(saved => {
        this._rev = saved.rev;
        saved.links = saved.links || []; saved.offers = saved.offers || {};
        const settled = ver === this._ver && !this.state.edit && !this.state.editLink && !this.state.gesturing;
        this.setState(s => {
          if (!s.doc) return null;
          let next, links;
          if (settled) {
            next = keepEqual(s.doc.nodes, saved.nodes);
            links = keepEqual(s.doc.links, saved.links);
          } else {
            const measured = new Map(saved.nodes.map(n => [n.id, n]));
            next = s.doc.nodes.map(n => {
              const m = n._auto ? measured.get(n.id) : null;
              if (!m) return n;
              const { _auto, ...rest } = n;
              return { ...rest, w: m.w, h: m.h };
            });
            links = s.doc.links;
          }
          return { doc: { ...saved, view: this.view(), nodes: next, links, cards: keepEqualMap(s.doc.cards, saved.cards) }, err: '' };
        }, () => this.loadViewNodes());
        return saved;
      })
      .catch(e => {
        this._again = false;
        if (e.status === 409) this.toast('The board changed somewhere else — it has been reloaded, and your last change was not saved.', 'amber');
        else this.setState({ err: e.message });
        this.load();
        return null;
      })
      .finally(() => {
        this._saving = null;
        if (this._again) { this._again = false; this.flush(); }
      });
    return this._saving;
  }

  // ── the camera ───────────────────────────────────────────────────────────────────────────────
  // THE CAMERA IS NOT REACT STATE WHILE IT MOVES. A pan or a zoom used to `setState` the view on
  // every wheel and pointer event, which re-rendered every card on the board per frame. The live
  // camera is `this._view`; moving it writes ONE transform on the layer (and the grid's offset)
  // straight to the DOM in an animation frame. When the motion stops the view is committed to
  // state once — so what depends on it (the selection bar's position) re-renders once — and saved.
  // It is not document content: it carries no base revision, cannot conflict and never advances
  // `rev` (backend/scoutBoard.mjs), so panning while an agent edits does not 409 in your face.
  view() { return this._view || (this.state.doc && this.state.doc.view) || { x: 0, y: 0, z: 1 }; }
  setView(view, { now = false } = {}) {
    this._view = { x: view.x, y: view.y, z: view.z };
    if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = 0; this.paintView(); });
    const el = this.canvas.current;
    if (el && !this._moving) { this._moving = true; el.classList.add('moving'); }
    clearTimeout(this._commitT);
    this._commitT = setTimeout(() => this.commitView(), now ? 0 : 170);
  }
  paintView() {
    const el = this.canvas.current, layer = this.layer.current;
    if (!el || !layer) return;
    const v = this.view();
    layer.style.transform = 'translate(' + v.x + 'px,' + v.y + 'px) scale(' + v.z + ')';
    // The lattice is drawn in the SAME unit the cards snap to. Zoomed far out it would be a field
    // of static, so it is switched off below a third.
    el.style.backgroundSize = (GRID * v.z) + 'px ' + (GRID * v.z) + 'px';
    el.style.backgroundPosition = v.x + 'px ' + v.y + 'px';
    el.style.backgroundImage = v.z < 0.34 ? 'none' : '';
    el.style.setProperty('--wb-z', String(v.z));
    if (this.zoomLabel.current) this.zoomLabel.current.textContent = Math.round(v.z * 100) + '%';
  }
  commitView() {
    const el = this.canvas.current;
    this._moving = false;
    if (el) el.classList.remove('moving');
    const v = this.view();
    this.setState(s => (s.doc ? { doc: { ...s.doc, view: v } } : null));
    clearTimeout(this._viewT);
    this._viewT = setTimeout(() => api.saveScoutBoard(this.boardId(), { view: v }).catch(() => {}), 500);
  }

  // ── coordinates ──────────────────────────────────────────────────────────────────────────────
  rect() { const el = this.canvas.current; return el ? el.getBoundingClientRect() : { left: 0, top: 0, width: 1200, height: 800 }; }
  pt(e) { const r = this.rect(); return toBoard(e.clientX - r.left, e.clientY - r.top, this.view()); }
  inset() { return { left: this.state.shelf ? SHELF_INSET : RAIL_INSET, right: 0, top: 0, bottom: 34 }; }
  // The middle of the canvas a person can actually see — the rail and the shelf float over its left.
  centre() {
    const r = this.rect(); const i = this.inset();
    return toBoard(i.left + (r.width - i.left) / 2, (r.height - i.bottom) / 2, this.view());
  }

  // ── selection ────────────────────────────────────────────────────────────────────────────────
  selIds() { return Object.keys(this.state.sel).filter(k => this.state.sel[k]); }
  selNodes() { const s = this.state.sel; return (this.state.doc.nodes || []).filter(n => s[n.id]); }
  select(id, additive) { this.setState(s => ({ selLink: null, sel: additive ? { ...s.sel, [id]: !s.sel[id] } : { [id]: true } })); }

  // ── tools ────────────────────────────────────────────────────────────────────────────────────
  // Choosing a tool changes what the next press on the canvas does, and nothing else: it never
  // moves the camera and never moves a node.
  setTool(tool, extra = {}) {
    if (this._editing) this.endEdit();
    if (this.state.editLink) this.endLinkEdit();
    this.dropBand();
    const quiet = tool === 'pen' || tool === 'eraser' || tool === 'hand';
    this.setState(s => ({ tool, menu: null, connectFrom: null, ...(quiet ? { sel: {}, selLink: null } : null), ...extra, hover: tool === 'select' || tool === 'connect' ? s.hover : null }));
  }

  // ── gestures ─────────────────────────────────────────────────────────────────────────────────
  // One pointerdown handler on the background, one on a node, and a single window-level move/up
  // pair per gesture. Listeners are torn down on up, so a drag that ends outside the window (very
  // common on a canvas) cannot leave a live pointermove attached.
  begin(e, onMove, onEnd, { camera = false } = {}) {
    e.preventDefault();
    const el = this.canvas.current;
    if (el) el.classList.add(camera ? 'panning' : 'dragging');
    if (!camera) this.setState({ gesturing: true });
    const move = ev => onMove(ev);
    const up = ev => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (el) el.classList.remove('panning', 'dragging');
      if (!camera) this.setState({ gesturing: false });
      if (onEnd) onEnd(ev);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // What every press on the canvas does first, whatever it lands on: finish whatever was being
  // written, then let the tool in hand have it. Returns true when the tool took the press.
  press(e, node) {
    if (e.button === 1 || this._space || e.altKey || this.state.tool === 'hand') { this.startPan(e); return true; }
    if (e.button !== 0) return true;
    if (this._editing) this.endEdit();
    if (this.state.editLink) this.endLinkEdit();
    switch (this.state.tool) {
      case 'pen': this.startStroke(e); return true;
      case 'eraser': this.startErase(e); return true;
      case 'text': this.placeText(this.pt(e)); e.preventDefault(); return true;
      case 'note': this.placeNote(this.pt(e)); e.preventDefault(); return true;
      case 'shape': this.dragOut(e, 'shape'); return true;
      case 'frame': this.dragOut(e, 'frame'); return true;
      case 'connect':
        e.preventDefault();
        if (node && linkable(node)) this.connectClick(node);
        else { this.dropBand(); this.setState({ connectFrom: null }); }
        return true;
      default: return false;
    }
  }

  onBackgroundDown(e) {
    if (this.press(e, null)) return;
    const start = this.pt(e);
    const keep = e.shiftKey ? { ...this.state.sel } : {};
    if (!e.shiftKey) this.setState({ sel: {}, selLink: null });
    let box = { x0: start.x, y0: start.y, x1: start.x, y1: start.y };
    this.begin(e,
      ev => { const p = this.pt(ev); box = { ...box, x1: p.x, y1: p.y }; this.setState({ marquee: box }); },
      () => {
        this.setState({ marquee: null });
        const r = { x: Math.min(box.x0, box.x1), y: Math.min(box.y0, box.y1), w: Math.abs(box.x1 - box.x0), h: Math.abs(box.y1 - box.y0) };
        if (r.w < 4 && r.h < 4) return;      // a click is a deselect, not a zero-area selection
        const hit = { ...keep };
        for (const n of this.state.doc.nodes) {
          if (!isRect(n) || !n.id) continue;
          if (n.x < r.x + r.w && n.x + n.w > r.x && n.y < r.y + r.h && n.y + n.h > r.y) hit[n.id] = true;
        }
        this.setState({ sel: hit, selLink: null });
      });
  }

  startPan(e) {
    const v = this.view();
    const x0 = e.clientX, y0 = e.clientY;
    this.begin(e, ev => this.setView({ ...v, x: v.x + (ev.clientX - x0), y: v.y + (ev.clientY - y0) }), null, { camera: true });
  }

  onNodeDown(e, node) {
    e.stopPropagation();
    if (this.press(e, node)) return;
    // A locked node still SELECTS — you need its pip to unlock it — it just refuses to move.
    if (node.locked) { this.select(node.id, e.shiftKey); return; }
    const sel = this.state.sel[node.id] ? this.state.sel : (e.shiftKey ? { ...this.state.sel, [node.id]: true } : { [node.id]: true });
    if (sel !== this.state.sel || this.state.selLink) this.setState({ sel, selLink: null });
    const ids = Object.keys(sel).filter(k => sel[k]);
    const origin = new Map(this.state.doc.nodes.filter(n => ids.includes(n.id) && !n.locked).map(n => [n.id, { x: n.x, y: n.y }]));
    const others = this.state.doc.nodes.filter(n => !ids.includes(n.id) && n.t !== 'draw');
    const p0 = this.pt(e);
    let moved = false;

    this.begin(e,
      ev => {
        const p = this.pt(ev);
        const dx = p.x - p0.x, dy = p.y - p0.y;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;   // a click must not write a save
        if (!moved) { moved = true; this.remember(); }
        // Shift constrains to one axis — the only way to slide a card along a row without drifting.
        const ax = ev.shiftKey && Math.abs(dx) < Math.abs(dy) ? 0 : dx;
        const ay = ev.shiftKey && Math.abs(dy) <= Math.abs(dx) ? 0 : dy;
        const free = ev.metaKey || ev.ctrlKey || node.t === 'draw';    // suspends every kind of snapping

        // Snapping is computed from the LEAD node (the one under the cursor) and the correction is
        // applied to the whole set, so a multi-selection keeps its internal spacing while still
        // landing flush against a neighbour.
        let gx = 0, gy = 0, guides = [];
        const lead = origin.get(node.id);
        if (!free && lead) {
          const g = snapGuides({ x: lead.x + ax, y: lead.y + ay, w: node.w, h: node.h, t: node.t }, others);
          gx = g.dx; gy = g.dy; guides = g.guides;
        }
        this.setState({ guides });
        this.put(d => ({
          nodes: d.nodes.map(n => {
            const o = origin.get(n.id);
            if (!o) return n;
            // an edge snap wins over the lattice: landing flush against a neighbour is what the
            // person aimed at, and re-snapping to the grid would push it back off by a pixel
            const nx = free ? Math.round(o.x + ax) : (gx ? Math.round(o.x + ax + gx) : snap(o.x + ax));
            const ny = free ? Math.round(o.y + ay) : (gy ? Math.round(o.y + ay + gy) : snap(o.y + ay));
            return nx === n.x && ny === n.y ? n : { ...n, x: nx, y: ny };
          }),
        }));
      },
      () => {
        this.setState({ guides: [] });
        if (moved) this.queueSave('moved ' + ids.length + ' thing' + (ids.length === 1 ? '' : 's'));
      });
  }

  startResize(e, node) {
    e.stopPropagation();
    if (this._editing) this.endEdit();
    const p0 = this.pt(e);
    const w0 = node.w, h0 = node.h;
    const small = node.t === 'text' || node.t === 'shape';
    const minW = small ? GRID * 2 : GRID * 6, minH = small ? GRID * 2 : GRID * 3;
    let changed = false;
    this.begin(e,
      ev => {
        const p = this.pt(ev);
        const w = Math.max(minW, snap(w0 + (p.x - p0.x)));
        const h = node.t === 'text' ? h0 : Math.max(minH, snap(h0 + (p.y - p0.y)));
        if (!changed) { changed = true; this.remember(); }
        // A size somebody dragged is theirs: it is no longer the server's to choose, and bare text
        // now wraps where they said.
        this.patchNode(node.id, { w, h, _auto: undefined, ...(node.t === 'text' ? { fixed: true } : null) });
      },
      () => {
        if (!changed) return;
        if (node.t === 'text') this.refitText([node.id]);
        this.queueSave('resized ' + this.nameOf(node));
      });
  }

  onWheel(e) {
    e.preventDefault();
    const v = this.view();
    const r = this.rect();
    if (e.ctrlKey || e.metaKey) {
      // Zoom at the CURSOR, not the centre — the difference between "I zoomed into that card" and
      // "everything ran away from me". (A trackpad pinch arrives as ctrl+wheel.)
      const z = clampZoom(v.z * Math.exp(-e.deltaY / 300));
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      this.setView({ z, x: cx - (cx - v.x) * (z / v.z), y: cy - (cy - v.y) * (z / v.z) });
    } else {
      this.setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
    }
  }
  zoomTo(z0) {
    const v = this.view(); const r = this.rect(); const i = this.inset();
    const z = clampZoom(z0);
    const cx = i.left + (r.width - i.left) / 2, cy = r.height / 2;
    this.setView({ z, x: cx - (cx - v.x) * (z / v.z), y: cy - (cy - v.y) * (z / v.z) }, { now: true });
  }
  zoomBy(k) { this.zoomTo(this.view().z * k); }
  // Fit frames `nodes` (default: everything) in the part of the canvas the shelf does not cover.
  fit(nodes) {
    const r = this.rect();
    const list = nodes || (this.state.doc ? this.state.doc.nodes : []);
    if (!list.length) return;
    this.setView(fitView(list, r.width, r.height, 60, this.inset()), { now: true });
  }
  // Bring freshly placed cards into view — only if they are not already in it.
  reveal(nodes) {
    if (!nodes || !nodes.length) return;
    const r = this.rect(); const v = this.view(); const i = this.inset();
    const b = bounds(nodes);
    const l = b.x * v.z + v.x, t = b.y * v.z + v.y, rr = l + b.w * v.z, bb = t + b.h * v.z;
    if (l >= i.left && t >= 0 && rr <= r.width && bb <= r.height - i.bottom) return;
    this.fit(this.state.doc.nodes.length <= nodes.length + 12 ? this.state.doc.nodes : nodes);
  }
  // Slide the board just far enough that `box` is on screen. The zoom is left alone: this is for a
  // note that grew off the edge while you were typing a mind-map, and a zoom change there would be
  // the board deciding where you look.
  scrollTo(box) {
    const r = this.rect(); const v = this.view(); const i = this.inset();
    const pad = 28;
    const l = box.x * v.z + v.x, t = box.y * v.z + v.y, rr = l + box.w * v.z, bb = t + box.h * v.z;
    let dx = 0, dy = 0;
    if (rr > r.width - pad) dx = r.width - pad - rr;
    if (l + dx < i.left + pad) dx = i.left + pad - l;
    if (bb > r.height - i.bottom - pad) dy = r.height - i.bottom - pad - bb;
    if (t + dy < pad) dy = pad - t;
    if (dx || dy) this.setView({ ...v, x: v.x + dx, y: v.y + dy }, { now: true });
  }

  // ── writing ──────────────────────────────────────────────────────────────────────────────────
  // Text, notes, shapes and frame names are all written where they stand. Starting to write takes
  // a history snapshot; finishing compares, so opening a note and closing it again leaves nothing
  // to undo. The node's corner never moves while you type — a text node only becomes as wide as it
  // is allowed to run, and hugs its words again when you are done.
  beginEdit(id, { fresh = false } = {}) {
    const n = this.node(id);
    if (!n || n.locked || !(WORDY.has(n.t) || n.t === 'frame')) return;
    if (this._editing) { if (this._editing.id === id) return; this.endEdit(); }
    if (!fresh) this.remember();
    this._editing = { id, fresh, before: n.t === 'frame' ? (n.label || '') : (n.text || ''), w: n.w, h: n.h, at: performance.now() };
    if (n.t === 'text' && !n.fixed) this.patchNode(id, { w: Math.max(n.w, TEXT_WRAP[n.size] || TEXT_WRAP.m) });
    this.setState({ edit: id, sel: { [id]: true }, selLink: null, hover: null });
  }
  // `then` is what the editor's own keys ask for next: 'child' (Tab) or 'sibling' (Shift+Enter).
  endEdit(then) {
    const e = this._editing;
    if (!e) return;
    // A field that loses focus in the instant it appears (the press that created it is still
    // finishing) is not somebody clicking away: give it the caret back instead of closing it.
    if (!then && performance.now() - e.at < 260 && document.activeElement && !document.activeElement.hasAttribute('data-wb-edit')) {
      const el = this.canvas.current && this.canvas.current.querySelector('[data-wb-node="' + e.id + '"] [data-wb-edit]');
      if (el && !this._refocused) { this._refocused = true; requestAnimationFrame(() => { this._refocused = false; if (this._editing === e) el.focus({ preventScroll: true }); }); return; }
    }
    this._editing = null;
    const n = this.node(e.id);
    this.setState({ edit: null });
    if (!n) return;
    const now = n.t === 'frame' ? (n.label || '') : (n.text || '');

    if (n.t === 'text' && !now.trim()) {
      // Words with no words are removed — and if they were never anything else, so is the history
      // entry that made them: an empty click should not be something you have to undo.
      if (e.fresh) this._undo.pop();
      this.setState({ sel: {}, undo: this._undo.length });
      this.put(d => { const nodes = d.nodes.filter(x => x.id !== e.id); return { nodes, links: prune(d.links, nodes) }; }, () => this.queueSave(e.fresh ? '' : 'removed empty text'));
      return;
    }
    let size = null;
    if (n.t === 'text') {
      const el = this.canvas.current && this.canvas.current.querySelector('[data-wb-node="' + e.id + '"]');
      const area = el && el.querySelector('textarea'), mirror = el && el.querySelector('[data-wb-mirror]');
      const w = n.fixed ? n.w : Math.max(12, Math.min(n.w, (mirror ? mirror.offsetWidth : n.w) + 2));
      const h = area ? Math.max(12, area.scrollHeight) : n.h;
      size = { w, h };
      this.patchNode(e.id, size);
    }
    if (n.t === 'note' || n.t === 'shape') this.fitWords(e.id);
    const changed = now !== e.before || (size && (size.w !== e.w || size.h !== e.h));
    if (!changed && !e.fresh) this.forget();
    else this.queueSave(e.fresh ? 'wrote ' + (n.t === 'frame' ? 'a group name' : 'a ' + n.t) : 'edited ' + this.nameOf(n));
    if (then) this.grow(e.id, then);
  }

  // A note or a shape is never shorter than its words: it grows DOWNWARD as you type (its corner
  // stays where it is) and is never shrunk for you — a box you sized is a box you meant.
  fitWords(id) {
    requestAnimationFrame(() => {
      const n = this.node(id);
      const box = n && this.canvas.current ? this.canvas.current.querySelector('[data-wb-node="' + id + '"]') : null;
      if (!box) return;
      let need = 0;
      if (n.t === 'note') {
        const el = box.querySelector('.wbNote');
        if (el && el.scrollHeight > el.clientHeight + 1) need = n.h + (el.scrollHeight - el.clientHeight);
      } else if (n.t === 'shape') {
        const el = box.querySelector('.wbShapeText');
        if (el && el.offsetHeight > n.h) need = el.offsetHeight;
      }
      if (need > n.h) this.patchNode(id, { h: Math.ceil(need / GRID) * GRID });
    });
  }

  // Bare text after something other than typing changed how big it is (its size, its weight, its
  // width): measured from the words as they are drawn, so the box you select is the box you see.
  refitText(ids) {
    const root = this.canvas.current;
    if (!root) return;
    requestAnimationFrame(() => {
      for (const id of ids) {
        const n = this.node(id);
        const el = n && n.t === 'text' ? root.querySelector('[data-wb-node="' + id + '"] .wbText') : null;
        if (!el) continue;
        const keep = { w: el.style.width, ws: el.style.whiteSpace };
        let w = n.w;
        if (!n.fixed) {
          el.style.whiteSpace = 'pre'; el.style.width = 'max-content';
          w = Math.max(12, Math.min(TEXT_WRAP[n.size] || TEXT_WRAP.m, el.offsetWidth + 2));
        }
        el.style.whiteSpace = keep.ws; el.style.width = w + 'px';
        const h = Math.max(12, el.offsetHeight);
        el.style.width = keep.w;
        if (w !== n.w || h !== n.h) this.patchNode(id, { w, h });
      }
      this.queueSave();
    });
  }

  // Put a node on the board and start writing in it, in one step and one history entry.
  placeEditable(node, log) {
    const id = this.newId();
    this.remember();
    this._pendingLog = log;
    this.put(d => ({ nodes: [...d.nodes, { ...node, id }] }), () => this.beginEdit(id, { fresh: true }));
    this.setState({ tool: 'select', menu: null });
    return id;
  }
  placeText(p, extra = {}) {
    const size = extra.size || 'm';
    return this.placeEditable({ t: 'text', text: '', size, x: Math.round(p.x), y: Math.round(p.y - TEXT_LINE[size] / 2), w: TEXT_WRAP[size], h: TEXT_LINE[size], ...extra }, 'wrote text');
  }
  placeNote(p, extra = {}) {
    const s = SIZES.note;
    return this.placeEditable({ t: 'note', text: '', tone: 'accent', x: snap(p.x - s.w / 2), y: snap(p.y - 24), ...s, ...extra }, 'added a note');
  }
  newNote() {
    const c = this.centre(); const s = SIZES.note;
    const at = freeSpot(this.state.doc.nodes, { x: c.x - s.w / 2, y: c.y - s.h / 2, ...s });
    this.placeEditable({ t: 'note', text: '', tone: 'accent', ...s, ...at }, 'added a note');
  }

  // Shape and Frame: press and drag out the box, or just click for one at the usual size. Either
  // way you are typing in it the moment the pointer comes up.
  dragOut(e, kind) {
    const p0 = this.pt(e);
    let box = { x0: p0.x, y0: p0.y, x1: p0.x, y1: p0.y };
    this.begin(e,
      ev => { const p = this.pt(ev); box = { ...box, x1: p.x, y1: p.y }; this.setState({ marquee: box }); },
      () => {
        this.setState({ marquee: null });
        const s = SIZES[kind];
        let r = { x: snap(Math.min(box.x0, box.x1)), y: snap(Math.min(box.y0, box.y1)), w: snap(Math.abs(box.x1 - box.x0)), h: snap(Math.abs(box.y1 - box.y0)) };
        if (r.w < 40 || r.h < 40) r = { x: snap(p0.x - s.w / 2), y: snap(p0.y - s.h / 2), ...s };
        if (kind === 'shape') this.placeEditable({ t: 'shape', shape: this.state.shapeKind, text: '', ...r }, 'added a ' + this.state.shapeKind);
        else this.placeEditable({ t: 'frame', label: '', ...r }, 'added a group');
      });
  }

  // ── mind-map: grow a connected note ──────────────────────────────────────────────────────────
  // Tab makes a note to the right of the selected thing, linked from it, with the caret in it.
  // Shift+Enter makes one UNDER it, linked from the same parent. Typed in a row — word, Tab, word,
  // Shift+Enter, word — that is a tree, and nothing was dragged.
  grow(id, how) {
    const doc = this.state.doc;
    const n = this.node(id);
    if (!doc || doc.foreign || !linkable(n)) return;
    const s = SIZES.note;
    let parent = n, want;
    if (how === 'sibling') {
      const up = doc.links.find(l => l.to === id);
      parent = up ? this.node(up.from) : null;
      want = { x: n.x, y: n.y + n.h + 40 };
    } else {
      want = { x: n.x + n.w + GROW_GAP, y: n.y + Math.round((n.h - s.h) / 2) };
    }
    // The first free slot going DOWN that column, so children stack under each other.
    const solid = doc.nodes.filter(m => m.t !== 'frame' && m.t !== 'draw');
    const clear = y => !solid.some(m => want.x < m.x + m.w + 20 && want.x + s.w + 20 > m.x && y < m.y + m.h + 40 && y + s.h + 40 > m.y);
    let y = want.y;
    for (let k = 0; k < 40 && !clear(y); k++) y += 20;
    const note = { id: this.newId(), t: 'note', text: '', tone: n.t === 'note' ? n.tone : 'accent', ...(n.t === 'note' && n.colour ? { colour: n.colour } : null), x: snap(want.x), y: snap(y), ...s };
    const link = parent ? { id: this.newId('k'), from: parent.id, to: note.id, ends: 'arrow', line: 'solid' } : null;
    this.remember();
    this._pendingLog = 'grew a note from ' + this.nameOf(parent || n);
    this.put(d => ({ nodes: [...d.nodes, note], links: link ? [...d.links, link] : d.links }), () => { this.beginEdit(note.id, { fresh: true }); this.scrollTo(note); });
  }

  // ── links ────────────────────────────────────────────────────────────────────────────────────
  // A drawn link is the person's own line between two things. One per direction per pair: drawing
  // the same one again selects the one that is there.
  addLink(from, to, extra = {}) {
    const doc = this.state.doc;
    if (!doc || from === to) return null;
    const twin = doc.links.find(l => l.from === from && l.to === to);
    if (twin) { this.setState({ selLink: twin.id, sel: {} }); return twin; }
    const link = { id: this.newId('k'), from, to, ends: 'arrow', line: 'solid', ...extra };
    this.remember();
    this.put(d => ({ links: [...d.links, link] }), () => this.queueSave('linked ' + this.nameOf(this.node(from)) + ' to ' + this.nameOf(this.node(to))));
    this.setState({ selLink: link.id, sel: {} });
    return link;
  }
  patchLink(id, patch, log) {
    this.remember();
    this.put(d => ({
      links: d.links.map(l => {
        if (l.id !== id) return l;
        const next = { ...l, ...patch };
        for (const k of Object.keys(patch)) if (patch[k] == null) delete next[k];
        return next;
      }),
    }), () => this.queueSave(log));
  }
  removeLink(id) {
    this.setState({ selLink: null, editLink: null });
    this.setLinks(this.state.doc.links.filter(l => l.id !== id), 'removed a link');
  }
  beginLinkEdit(id) {
    const l = this.link(id);
    if (!l) return;
    if (this._editing) this.endEdit();
    this.remember();
    this._linkBefore = l.label || '';
    this.setState({ editLink: id, selLink: id, sel: {} });
  }
  endLinkEdit() {
    const id = this.state.editLink;
    if (!id) return;
    const l = this.link(id);
    this.setState({ editLink: null });
    const labelled = (x, label) => { const { label: _was, ...rest } = x; return label ? { ...rest, label } : rest; };
    const now = l ? String(l.label || '').replace(/\s+/g, ' ').trim() : '';
    if (!l || now === this._linkBefore) {
      // nothing was said: no history entry, and the label is exactly what it was
      this.forget();
      if (l) this.put(d => ({ links: d.links.map(x => (x.id === id ? labelled(x, this._linkBefore) : x)) }));
      return;
    }
    this.put(d => ({ links: d.links.map(x => (x.id === id ? labelled(x, now) : x)) }), () => this.queueSave(now ? 'named a link “' + now.slice(0, 40) + '”' : 'cleared a link’s name'));
  }

  // The connector while it is being dragged: one <path>, written straight to the DOM. It leaves
  // from whichever side of the source faces the pointer, exactly as the finished link will.
  paintBand(from, p) {
    const el = this.band.current;
    if (!el) return;
    el.setAttribute('d', arrowGeom({ from: from.id, toPt: p }, { [from.id]: from }).path);
  }
  dropBand() {
    if (this.band.current) this.band.current.setAttribute('d', '');
    if (this._target) { this._target.classList.remove('wbAim'); this._target = null; }
    if (this._bandOff) { this._bandOff(); this._bandOff = null; }
  }
  // The node under the pointer that a link could land on.
  aim(ev, from) {
    const hit = document.elementFromPoint(ev.clientX, ev.clientY);
    const el = hit && hit.closest ? hit.closest('[data-wb-node]') : null;
    const n = el ? this.node(el.getAttribute('data-wb-node')) : null;
    const ok = n && n.id !== from.id && linkable(n) ? el : null;
    if (ok !== this._target) {
      if (this._target) this._target.classList.remove('wbAim');
      if (ok) ok.classList.add('wbAim');
      this._target = ok;
    }
    return ok ? n : null;
  }
  // Drag from one of a node's four dots. Onto another node: a link. Onto empty board: a note
  // right there, linked, with the caret in it — the fastest way to say "and that leads to…".
  startLink(e, from) {
    e.stopPropagation();
    if (this._editing) this.endEdit();
    const p0 = this.pt(e);
    let target = null, far = false;
    this.setState({ hover: null });
    this.begin(e,
      ev => {
        const p = this.pt(ev);
        far = far || Math.hypot(p.x - p0.x, p.y - p0.y) > 24;
        target = this.aim(ev, from);
        this.paintBand(from, target ? { x: target.x + target.w / 2, y: target.y + target.h / 2 } : p);
      },
      ev => {
        const p = this.pt(ev);
        this.dropBand();
        if (target) { this.addLink(from.id, target.id); return; }
        if (!far) return;
        const s = SIZES.note;
        const dx = p.x - (from.x + from.w / 2), dy = p.y - (from.y + from.h / 2);
        const at = Math.abs(dx) >= Math.abs(dy)
          ? { x: dx > 0 ? p.x : p.x - s.w, y: p.y - s.h / 2 }
          : { x: p.x - s.w / 2, y: dy > 0 ? p.y : p.y - s.h };
        const note = { id: this.newId(), t: 'note', text: '', tone: 'accent', x: snap(at.x), y: snap(at.y), ...s };
        const link = { id: this.newId('k'), from: from.id, to: note.id, ends: 'arrow', line: 'solid' };
        this.remember();
        this._pendingLog = 'linked ' + this.nameOf(from) + ' to a new note';
        this.put(d => ({ nodes: [...d.nodes, note], links: [...d.links, link] }), () => this.beginEdit(note.id, { fresh: true }));
      });
  }
  // The Connect tool: click the thing a link starts at, then the thing it ends at.
  connectClick(node) {
    const from = this.state.connectFrom ? this.node(this.state.connectFrom) : null;
    if (!from) {
      this.setState({ connectFrom: node.id, sel: { [node.id]: true }, selLink: null });
      const move = ev => { const t = this.aim(ev, node); this.paintBand(node, t ? { x: t.x + t.w / 2, y: t.y + t.h / 2 } : this.pt(ev)); };
      window.addEventListener('pointermove', move);
      this._bandOff = () => window.removeEventListener('pointermove', move);
      return;
    }
    this.dropBand();
    if (from.id !== node.id) this.addLink(from.id, node.id);
    this.setState({ connectFrom: null, tool: 'select' });
  }

  // "Make it real": the one button that turns a drawn link into a relation on a record. The
  // server does it through the record writer and then removes the drawn link (see
  // backend/scoutBoard.mjs `realiseLink`); this only asks, and says what happened.
  async makeReal(id) {
    const offer = this.state.doc.offers && this.state.doc.offers[id];
    if (!offer) return;
    this.setState({ busy: 'Saving the record…' });
    try {
      if (this._saveT || this._saving) await this.flush();
      const out = await boardApi.realise(this.boardId(), id);
      out.links = out.links || []; out.offers = out.offers || {};
      // A record changed. That is not the board's to undo, so the board's history starts again.
      this._undo = []; this._redo = []; this._ver++; this._rev = out.rev;
      this.setState(s => ({ doc: { ...out, view: this.view(), nodes: keepEqual(s.doc.nodes, out.nodes) }, selLink: null, undo: 0, redo: 0, err: '' }));
      this.toast(offer.sentence + ' — saved on the record. The line is now the record’s own.', 'green');
    } catch (e) {
      this.setState({ err: e.message });
      this.toast(e.message, 'red');
    } finally {
      this.setState({ busy: '' });
    }
  }

  // ── pen and eraser ───────────────────────────────────────────────────────────────────────────
  // A stroke is drawn by writing ONE path's `d` on every pointer sample — no state, no render —
  // and becomes a node once, when the pointer comes up.
  startStroke(e) {
    const el = this.ink.current;
    const { width, colour } = this.state.pen;
    const pts = [this.pt(e)];
    let d = 'M ' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1);
    if (el) {
      el.setAttribute('stroke', hueVar(colour) || 'var(--fg-soft)');
      el.setAttribute('stroke-width', String(width));
      el.setAttribute('d', d + ' l 0.1 0');
    }
    this.begin(e,
      ev => {
        for (const c of (ev.getCoalescedEvents && ev.getCoalescedEvents().length ? ev.getCoalescedEvents() : [ev])) {
          const p = this.pt(c);
          pts.push(p);
          d += ' L ' + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
        }
        if (el) el.setAttribute('d', d);
      },
      () => {
        if (el) el.setAttribute('d', '');
        const s = packStroke(pts, width);
        if (!s) return;
        const node = { id: this.newId(), t: 'draw', ...s, width, ...(colour ? { colour } : null) };
        this.remember();
        this.put(doc => ({ nodes: [...doc.nodes, node] }), () => this.queueSave('drew a stroke'));
      });
  }
  // The eraser removes whole strokes — the ones its path touches — and nothing else. They fade as
  // they are touched and go in one step when the pointer comes up, so one sweep is one undo.
  startErase(e) {
    const strokes = this.state.doc.nodes.filter(n => n.t === 'draw' && !n.locked).map(n => ({ ...n, _pts: parsePoints(n.points) }));
    const gone = new Set();
    const root = this.canvas.current;
    const reach = 9 / this.view().z;
    const touch = ev => {
      const p = this.pt(ev);
      for (const s of strokes) {
        if (gone.has(s.id) || !strokeHit(s, p, reach)) continue;
        gone.add(s.id);
        const el = root && root.querySelector('[data-wb-node="' + s.id + '"]');
        if (el) el.style.opacity = '0.12';
      }
    };
    touch(e);
    this.begin(e, touch, () => {
      if (!gone.size) return;
      this.remember();
      this.put(d => ({ nodes: d.nodes.filter(n => !gone.has(n.id)) }), () => this.queueSave('erased ' + gone.size + ' stroke' + (gone.size === 1 ? '' : 's')));
    });
  }

  // ── keyboard ─────────────────────────────────────────────────────────────────────────────────
  // Capture phase, and every key this surface consumes calls stopPropagation(), so a focused canvas
  // claims a letter before the app's global bindings on the bubble phase. Nothing here fires while
  // you are typing in a field — the first line below is that whole rule.
  onKey(e) {
    if (e.type === 'keyup') { if (e.key === ' ') this._space = false; return; }
    if (isTyping() || !this.state.doc) return;
    const k = e.key;
    const low = k.length === 1 ? k.toLowerCase() : k;
    const mod = e.metaKey || e.ctrlKey;
    const mine = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === ' ') { this._space = true; mine(); return; }               // hold to pan
    if (k === 'Escape') {
      e.stopPropagation();
      if (this.state.menu) return this.setState({ menu: null });
      if (this.state.connectFrom) { this.dropBand(); return this.setState({ connectFrom: null }); }
      if (this.state.tool !== 'select') return this.setTool('select');
      if (this.props.full && this.props.onToggleFull) return this.props.onToggleFull();
      this.setState({ sel: {}, selLink: null });
      return;
    }
    const ids = this.selIds();
    const link = this.state.selLink;
    if (mod && low === 'z') { mine(); if (e.shiftKey) this.redo(); else this.undo(); return; }
    if (mod && low === 'y') { mine(); this.redo(); return; }
    if (k === 'Delete' || k === 'Backspace') {
      if (link) { mine(); this.removeLink(link); } else if (ids.length) { mine(); this.removeSelected(); }
      return;
    }
    if (mod && low === 'd' && ids.length) { mine(); this.duplicateSelected(); return; }
    if (mod && low === 'c' && ids.length) { mine(); this.copySelected(false); return; }
    if (mod && low === 'x' && ids.length) { mine(); this.copySelected(true); return; }
    if (mod && low === 'a') {
      mine();
      this.setState({ selLink: null, sel: Object.fromEntries(this.state.doc.nodes.map(n => [n.id, true])) });
      return;
    }
    if (mod || e.altKey) return;

    // growing a mind-map from the selected thing
    if (k === 'Tab' && ids.length === 1) { mine(); this.grow(ids[0], 'child'); return; }
    if (k === 'Enter' && e.shiftKey && ids.length === 1) { mine(); this.grow(ids[0], 'sibling'); return; }

    // tools
    if (low === 'f' && e.shiftKey) { if (this.props.onToggleFull) { mine(); this.props.onToggleFull(); } return; }
    if (TOOL_KEYS[low]) { mine(); this.setTool(TOOL_KEYS[low]); return; }
    if (SHAPE_KEYS[low]) { mine(); this.setTool('shape', { shapeKind: SHAPE_KEYS[low] }); return; }

    if (k === '=' || k === '+') { mine(); this.zoomBy(1.25); }
    else if (k === '-') { mine(); this.zoomBy(0.8); }
    else if (k === '0') { mine(); this.fit(); }
    else if (k === '1') { mine(); this.zoomTo(1); }
    else if (low === 'g') { mine(); this.arrange(); }
    else if (k === 'Enter' && link) { mine(); this.beginLinkEdit(link); }
    else if (k === 'Enter' && ids.length === 1) {
      const n = this.selNodes()[0];
      if (n && n.path && this.props.onOpenDocument) { mine(); this.props.onOpenDocument(n.path); }
      else if (n && (WORDY.has(n.t) || n.t === 'frame')) { mine(); this.beginEdit(n.id); }
    } else if (ids.length && (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown')) {
      // Nudge by one grid cell, or by one pixel with shift for the last hair of alignment.
      mine();
      const d = e.shiftKey ? 1 : GRID;
      const dx = k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0;
      const dy = k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0;
      this.setNodes(this.state.doc.nodes.map(n => (this.state.sel[n.id] && !n.locked ? { ...n, x: n.x + dx, y: n.y + dy } : n)), 'nudged ' + ids.length);
    }
  }

  // ── node operations ──────────────────────────────────────────────────────────────────────────
  // Every one of them is "change the list, save the list". New nodes are named here (`newId`) and
  // appear at once; the save that follows only brings back what the server alone knows — for a
  // record card, the size its record calls for.
  async addNodes(specs, log, { select = true } = {}) {
    const doc = this.state.doc;
    if (!doc || doc.foreign || !specs.length) return [];
    this.remember();
    const made = specs.map(s => ({ ...s, id: s.id || this.newId() }));
    const ids = new Set(made.map(n => n.id));
    this._pendingLog = log || ('added ' + specs.length);
    await new Promise(done => this.put(d => ({ nodes: [...d.nodes, ...made] }), done));
    if (select) this.setState({ selLink: null, sel: Object.fromEntries(made.map(n => [n.id, true])) });
    const saved = await this.flush();
    const from = saved && saved.nodes.some(n => ids.has(n.id)) ? saved.nodes : (this.state.doc ? this.state.doc.nodes : []);
    return from.filter(n => ids.has(n.id));
  }
  // One node of any kind, at a point if given, else at the first free spot near the middle of what
  // is on screen — never on top of another card.
  async add(spec, log) {
    const doc = this.state.doc;
    if (!doc || doc.foreign) return null;
    const size = spec.w ? {} : this.sizeFor(spec);
    const w = spec.w || size.w, h = spec.h || size.h;
    let at;
    if (spec.x != null) at = { x: spec.x, y: spec.y };
    else if (spec.t === 'frame') { const c = this.centre(); at = { x: snap(c.x - w / 2), y: snap(c.y - h / 2) }; }
    else { const c = this.centre(); at = freeSpot(doc.nodes, { x: c.x - w / 2, y: c.y - h / 2, w, h }); }
    const made = await this.addNodes([{ ...size, ...spec, ...at }], log || ('added a ' + spec.t));
    if (made[0]) this.reveal(made);
    return made[0] || null;
  }
  // Several records at once: a tidy grid of same-sized slots in the first free block of board,
  // then brought into view. This is how thirty references become a contact sheet instead of a pile.
  async addRecords(items, log, { near = null, cols = null, gap, reveal = true } = {}) {
    const doc = this.state.doc;
    if (!doc || doc.foreign || !items.length) return [];
    const sizes = items.map(it => this.sizeFor(it));
    const cell = { w: Math.max(...sizes.map(s => s.w)), h: Math.max(...sizes.map(s => s.h)) };
    const g = gap == null ? 40 : gap;
    const c = cols || Math.max(1, Math.ceil(Math.sqrt(items.length * 1.6)));
    const rows = Math.ceil(items.length / c);
    const block = { w: c * cell.w + (c - 1) * g, h: rows * cell.h + (rows - 1) * g };
    const centre = this.centre();
    const want = near || { x: centre.x - block.w / 2, y: centre.y - block.h / 2 };
    const origin = freeSpot(doc.nodes, { ...want, ...block }, g);
    const slots = gridSlots(items.length, cell, { x: origin.x, y: origin.y, cols: c, gap: g });
    const made = await this.addNodes(items.map((it, i) => ({ ...sizes[i], ...it, ...slots[i] })), log);
    if (reveal) this.reveal(made);
    return made;
  }
  // Taking things off the board. A locked node stays — that is what locking is for — and the
  // lines drawn to whatever goes, go with it.
  removeSelected() {
    const picked = this.selNodes();
    const going = picked.filter(n => !n.locked);
    const kept = picked.length - going.length;
    if (!going.length) { if (kept) this.toast('Locked — unlock it first to take it off the board.', 'amber'); return; }
    const ids = new Set(going.map(n => n.id));
    const records = going.filter(n => n.path).length;
    this.setState({ sel: {} });
    this.setNodes(this.state.doc.nodes.filter(n => !ids.has(n.id)), 'removed ' + ids.size + ' thing' + (ids.size === 1 ? '' : 's'));
    // Said out loud, once per removal: on a board of records, "delete" must never be ambiguous.
    const back = ' ⌘Z puts ' + (ids.size === 1 ? 'it' : 'them') + ' back.' + (kept ? ' ' + kept + ' locked ' + (kept === 1 ? 'one was' : 'ones were') + ' left where ' + (kept === 1 ? 'it is' : 'they are') + '.' : '');
    this.toast(records
      ? 'Taken off the board. The record' + (records === 1 ? ' itself is' : 's themselves are') + ' untouched.' + back
      : 'Removed.' + back, 'green');
  }
  // Copies of `nodes`, offset, with the links BETWEEN them copied too — a duplicated diagram is
  // still a diagram. The copies are what ends up selected.
  cloneNodes(nodes, links, offset, log) {
    if (!nodes.length) return;
    const map = new Map();
    const copies = nodes.map(n => {
      const { _auto, locked, ...rest } = n;
      const id = this.newId();
      map.set(n.id, id);
      return { ...rest, id, x: n.x + offset, y: n.y + offset };
    });
    const joined = (links || []).filter(l => map.has(l.from) && map.has(l.to))
      .map(l => ({ ...l, id: this.newId('k'), from: map.get(l.from), to: map.get(l.to) }));
    this.remember();
    this.put(d => ({ nodes: [...d.nodes, ...copies], links: [...d.links, ...joined] }), () => this.queueSave(log));
    this.setState({ selLink: null, sel: Object.fromEntries(copies.map(n => [n.id, true])) });
  }
  duplicateSelected() {
    const nodes = this.selNodes();
    this.cloneNodes(nodes, this.state.doc.links, GRID * 2, 'duplicated ' + nodes.length);
  }
  // Copy keeps the selection — and the links inside it — in this window, and puts its WORDS on
  // the system clipboard, so pasting into a document elsewhere gives you something too.
  copySelected(cut) {
    const nodes = this.selNodes();
    if (!nodes.length) return;
    const ids = new Set(nodes.map(n => n.id));
    this._clip = { nodes: nodes.map(n => ({ ...n })), links: this.state.doc.links.filter(l => ids.has(l.from) && ids.has(l.to)).map(l => ({ ...l })), times: 0 };
    const words = nodes.map(n => (n.path ? this.nameOf(n) : n.text || n.label || '')).filter(Boolean).join('\n') || 'Scout whiteboard — ' + nodes.length + ' item' + (nodes.length === 1 ? '' : 's');
    this._clipText = words; this._clipAny = false;
    try { navigator.clipboard.writeText(words).catch(() => { this._clipAny = true; }); } catch { this._clipAny = true; }
    if (cut) this.removeSelected();
  }
  pasteClip() {
    const c = this._clip;
    if (!c) return;
    c.times += 1;
    this.cloneNodes(c.nodes, c.links, GRID * 2 * c.times, 'pasted ' + c.nodes.length);
  }

  // "Show related": the records this one points at and the ones that point at it, placed beside it
  // — and because they come from the same resolver the edges do, every one of them arrives with
  // its line already drawn.
  async showRelated(node, { quiet = false } = {}) {
    if (!node || !node.path) return;
    this.setState({ busy: 'Finding what this is related to…' });
    try {
      const r = await boardApi.related(this.boardId(), node.path);
      const onBoard = new Set(this.state.doc.nodes.map(n => n.path).filter(Boolean));
      const all = [...(r.out || []), ...(r.in || [])];
      const fresh = all.filter(x => !onBoard.has(x.path));
      if (!fresh.length) {
        if (!quiet) this.toast(all.length ? 'Everything related to this is already on the board.' : 'Nothing points to this record or from it yet.', 'amber');
        return;
      }
      const kindOf = p => (/^territory\//.test(p) ? 'territory' : /^goals\//.test(p) ? 'goal' : 'document');
      const here = this.node(node.id) || node;
      const made = await this.addRecords(fresh.map(x => ({ t: kindOf(x.path), path: x.path })),
        'placed ' + fresh.length + ' related to ' + node.path,
        { near: { x: here.x + here.w + LINK_GAP, y: here.y }, cols: Math.max(1, Math.ceil(fresh.length / 4)), gap: 60, reveal: false });
      this.reveal([here, ...made]);
      if (r.more && !quiet) this.toast(r.more + ' more related record' + (r.more === 1 ? ' was' : 's were') + ' left off — a board is not a table.', 'amber');
    } catch (e) {
      this.setState({ err: e.message });
    } finally {
      this.setState({ busy: '' });
    }
  }

  // ARRANGE IS AN ACTION (T15 §5). One press, one new node list, as editable afterwards as
  // anything placed by hand — and the geometry is `boardLayout.js`'s, not a second implementation.
  // It lines up CARDS: records, live lists and pictures (or exactly what is selected, if two or
  // more things are). Text, notes, shapes and strokes are a diagram somebody drew, and locked
  // things are finished: neither is touched.
  arrange() {
    const doc = this.state.doc;
    if (!doc) return;
    const picked = this.selNodes().filter(n => !n.locked && n.t !== 'frame' && n.t !== 'draw');
    const pool = picked.length > 1 ? picked : doc.nodes.filter(n => ARRANGED.has(n.t) && !n.locked);
    if (pool.length < 2) { this.toast('There is nothing to line up yet — Arrange puts cards in rows.', 'amber'); return; }
    // As many columns as the cards' own footprint is wide, so lining them up does not push a row
    // out over the notes and shapes beside them. Cards in a pile have no footprint to keep: those
    // get a block a little wider than it is tall.
    const gap = 60;
    const foot = bounds(pool), colW = Math.max(...pool.map(n => n.w));
    const fits = Math.floor((foot.w + gap) / (colW + gap));
    const cols = fits >= 2 ? Math.min(fits, 8) : Math.max(2, Math.min(8, Math.ceil(Math.sqrt(pool.length * 1.6))));
    // `tidy` decides the ORDER (reading order of where the cards are now) and the grid; a slot that
    // a note, some text or a shape already occupies is skipped, so a card is never lined up
    // underneath something that was written there.
    const order = tidy(pool, { cols, gap }).slice().sort((a, b) => a.y - b.y || a.x - b.x);
    const inPool = new Set(pool.map(n => n.id));
    const blocked = doc.nodes.filter(n => !inPool.has(n.id) && n.t !== 'frame' && n.t !== 'draw');
    const rowH = Math.max(...pool.map(n => n.h));
    const x0 = snap(foot.x), y0 = snap(foot.y);
    const placed = new Map();
    let slot = 0;
    for (const n of order) {
      let at;
      for (let tries = 0; tries < 400; tries++, slot++) {
        at = { x: x0 + (slot % cols) * (colW + gap), y: y0 + Math.floor(slot / cols) * (rowH + gap) };
        const hit = blocked.some(o => at.x < o.x + o.w + 20 && at.x + n.w + 20 > o.x && at.y < o.y + o.h + 20 && at.y + n.h + 20 > o.y);
        if (!hit) { slot++; break; }
      }
      placed.set(n.id, at);
    }
    const next = doc.nodes.map(n => { const p = placed.get(n.id); return p && (p.x !== n.x || p.y !== n.y) ? { ...n, x: p.x, y: p.y } : n; });
    this.remember();
    this.put({ nodes: next }, () => {
      this.queueSave('arranged ' + pool.length + ' card' + (pool.length === 1 ? '' : 's'));
      // Framing the result is part of the gesture: an arrange that leaves you looking at empty
      // board reads as nothing having happened.
      this.fit(next);
      this.toast('Lined up ' + pool.length + ' cards in rows. ⌘Z undoes it.', 'green');
    });
  }

  // Change every selected node. A key whose new value is null is removed, not written as null.
  patchSel(patch, log, done) {
    const sel = this.state.sel;
    this.remember();
    this.put(d => ({
      nodes: d.nodes.map(n => {
        if (!sel[n.id]) return n;
        const next = { ...n, ...patch };
        for (const k of Object.keys(patch)) if (patch[k] == null) delete next[k];
        return next;
      }),
    }), () => { this.queueSave(log); if (done) done(); });
  }
  reorderSel(toFront) {
    // z-order IS array order in this document, so "bring to front" is a splice, not a field every
    // reader has to reconcile.
    const sel = this.state.sel;
    const picked = this.state.doc.nodes.filter(n => sel[n.id]);
    const rest = this.state.doc.nodes.filter(n => !sel[n.id]);
    this.setNodes(toFront ? [...rest, ...picked] : [...picked, ...rest], toFront ? 'brought to front' : 'sent to back');
  }
  movable() { return this.selNodes().filter(n => !n.locked).map(n => n.id); }
  doAlign(edge) { this.setNodes(alignNodes(this.state.doc.nodes, this.movable(), edge), 'aligned ' + edge); }
  doDistribute(axis) { this.setNodes(distributeNodes(this.state.doc.nodes, this.movable(), axis), 'distributed'); }

  // ── things from outside ──────────────────────────────────────────────────────────────────────
  // A picture dropped from Finder, pasted, or picked: stored like every other attachment
  // (content-addressed under files/, through the board's own route) and placed as an image node
  // the shape of the picture.
  async addImages(files, at) {
    const list = [...(files || [])].filter(f => /^(image|video)\//.test(f.type));
    if (!list.length) { this.toast('Only pictures and videos can be put on the board this way.', 'amber'); return; }
    this.setState({ busy: 'Adding ' + list.length + ' picture' + (list.length === 1 ? '' : 's') + '…' });
    const specs = [];
    for (const f of list.slice(0, 12)) {
      try {
        const { path } = await boardApi.image(this.boardId(), f);
        const s = await shapeOf(f);
        const w = SIZES.image.w;
        const h = s ? Math.max(120, Math.min(520, snap(w * s.h / s.w))) : SIZES.image.h;
        specs.push({ t: 'image', src: path, alt: String(f.name || '').slice(0, 200), w, h });
      } catch (e) { this.setState({ err: e.message }); }
    }
    this.setState({ busy: '' });
    if (!specs.length) return;
    const doc = this.state.doc;
    const g = 40, cols = Math.min(specs.length, 4);
    const cellH = Math.max(...specs.map(s => s.h));
    const block = { w: cols * SIZES.image.w + (cols - 1) * g, h: Math.ceil(specs.length / cols) * (cellH + g) - g };
    const c = this.centre();
    const want = at ? { x: at.x, y: at.y } : { x: c.x - block.w / 2, y: c.y - block.h / 2 };
    const origin = freeSpot(doc.nodes, { ...want, ...block }, g);
    const slots = gridSlots(specs.length, { w: SIZES.image.w, h: cellH }, { x: origin.x, y: origin.y, cols, gap: g });
    const made = await this.addNodes(specs.map((s, i) => ({ ...s, ...slots[i] })), 'added ' + specs.length + ' picture' + (specs.length === 1 ? '' : 's'));
    this.reveal(made);
  }

  onDrop(e) {
    e.preventDefault();
    this.setState({ dropping: false });
    const at = this.pt(e);
    const raw = e.dataTransfer.getData('application/x-scout-node');
    if (raw) {
      try {
        const spec = JSON.parse(raw);
        const size = this.sizeFor(spec);
        this.add({ ...spec, x: snap(at.x - size.w / 2), y: snap(at.y - 24) }, 'placed ' + (spec.path || spec.collection || spec.t));
        return;
      } catch { /* not one of ours */ }
    }
    if (e.dataTransfer.files && e.dataTransfer.files.length) this.addImages(e.dataTransfer.files, { x: snap(at.x), y: snap(at.y) });
  }
  // Paste: what was copied here comes back as it was (links and all); a picture becomes a picture;
  // an address becomes a note holding the link; any other words become text on the board.
  onPaste(e) {
    if (isTyping() || !this.state.doc || this.state.doc.foreign) return;
    const cd = e.clipboardData;
    if (cd && cd.files && cd.files.length) { e.preventDefault(); this.addImages(cd.files); return; }
    const text = String((cd && cd.getData('text/plain')) || '');
    if (this._clip && (this._clipAny || text === this._clipText)) { e.preventDefault(); this.pasteClip(); return; }
    const words = text.trim().slice(0, 4000);
    if (!words) return;
    e.preventDefault();
    const c = this.centre();
    if (isUrl(words)) {
      const s = SIZES.note;
      const at = freeSpot(this.state.doc.nodes, { x: c.x - s.w / 2, y: c.y - s.h / 2, ...s });
      this.addNodes([{ t: 'note', text: words, tone: 'neutral', ...s, ...at }], 'pasted a link');
      return;
    }
    // Sized by estimate, then measured from the words as drawn (`refitText`).
    const lines = words.split('\n');
    const w = Math.max(40, Math.min(TEXT_WRAP.m, Math.max(...lines.map(l => l.length)) * 10 + 8));
    const h = Math.max(TEXT_LINE.m, lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.length * 10 / w)), 0) * TEXT_LINE.m);
    const at = freeSpot(this.state.doc.nodes, { x: c.x - w / 2, y: c.y - h / 2, w, h });
    this.addNodes([{ t: 'text', text: words, size: 'm', w, h, ...at }], 'pasted text').then(made => { if (made[0]) this.refitText([made[0].id]); });
  }
  openShelf() {
    this.setState({ shelf: true }, () => { if (this.filter.current) this.filter.current.focus(); });
  }

  // ── render: the tool rail ────────────────────────────────────────────────────────────────────
  // What the next press on the board does. It floats at the left edge and never moves, each tool
  // says its key, and the one in hand is visibly held. Placing tools hand the pointer back after
  // one use; pen and eraser stay until Esc.
  renderRail() {
    const { tool, shapeKind, menu, pen } = this.state;
    // Every tool says its name and its key the moment the pointer is on it — a real element, not
    // the browser's delayed `title`, because the key IS the thing being taught.
    const aria = (label, key) => ({ 'aria-label': label + (key ? ' (' + key + ')' : ''), 'aria-keyshortcuts': key || undefined });
    const tip = (label, key) => <span className="wbTip" aria-hidden="true">{label}{key ? <kbd style={{ fontFamily: MONO }}>{key}</kbd> : null}</span>;
    const T = (id, icon, label, key, onClick) => (
      <button key={id} type="button" className={'wbTool' + (tool === id ? ' on' : '')} aria-pressed={tool === id} {...aria(label, key)}
        // the tool is taken, the button lets go of the keyboard: Space is then "hold to pan" again
        // and Enter is the board's, not a second press of this button
        onClick={e => { e.currentTarget.blur(); (onClick || (() => this.setTool(id)))(); }}><ToolIcon name={icon} />{tip(label, key)}</button>
    );
    const shapeKey = { rect: 'R', ellipse: 'O', diamond: 'D' };
    return (
      <div className="wbRail wbGlass" role="toolbar" aria-label="Board tools" aria-orientation="vertical"
        onPointerDown={stop} onDoubleClick={stop} onWheel={stop}>
        {T('select', 'select', 'Select and move', 'V')}
        {T('hand', 'hand', 'Hand — drag the board', 'H')}
        <span className="wbRailSep" />
        {T('text', 'text', 'Text', 'T')}
        {T('note', 'note', 'Note', 'N')}
        <span className="wbMenuWrap">
          {T('shape', shapeKind, 'Shape — ' + SHAPE_NAMES[shapeKind].toLowerCase(), shapeKey[shapeKind] || '',
            () => { const open = !(tool === 'shape' && menu === 'shape'); this.setTool('shape', { menu: open ? 'shape' : null }); })}
          {menu === 'shape' ? (
            <div className="wbFly wbGlass" role="menu" aria-label="Shapes">
              {SHAPES.map(k => (
                <button key={k} type="button" role="menuitemradio" aria-checked={shapeKind === k} className={'wbTool' + (shapeKind === k ? ' on' : '')}
                  {...aria(SHAPE_NAMES[k], shapeKey[k])} onClick={() => this.setTool('shape', { shapeKind: k })}><ToolIcon name={k} />{tip(SHAPE_NAMES[k], shapeKey[k])}</button>
              ))}
            </div>
          ) : null}
        </span>
        {T('connect', 'connect', 'Connect two things', 'C')}
        <span className="wbMenuWrap">
          {T('pen', 'pen', 'Pen', 'P', () => this.setTool('pen', { menu: 'pen' }))}
          {tool === 'pen' && menu === 'pen' ? (
            <div className="wbFly wbGlass" role="group" aria-label="Pen">
              {STROKE_WIDTHS.map(w => (
                <button key={w} type="button" className={'wbTool' + (pen.width === w ? ' on' : '')} aria-pressed={pen.width === w}
                  {...aria(w === 2 ? 'Thin' : w === 4 ? 'Medium' : 'Thick')} onClick={() => this.setState({ pen: { ...pen, width: w } })}>
                  <span className="wbNib" style={{ width: w + 3, height: w + 3 }} />{tip(w === 2 ? 'Thin' : w === 4 ? 'Medium' : 'Thick')}
                </button>
              ))}
              <span className="wbFlySep" />
              <Swatches value={pen.colour} onPick={c => this.setState({ pen: { ...pen, colour: c } })} />
            </div>
          ) : null}
        </span>
        {T('eraser', 'eraser', 'Eraser — removes strokes', 'E')}
        {T('frame', 'frame', 'Frame — a named group', 'F')}
        <span className="wbRailSep" />
        {T('picture', 'picture', 'Picture from this computer', '', () => this.picker.current && this.picker.current.click())}
        <input ref={this.picker} type="file" accept="image/*,video/*" multiple hidden
          onChange={e => { const files = [...e.target.files]; e.target.value = ''; if (files.length) this.addImages(files); }} />
      </div>
    );
  }

  // ── render: the shelf ────────────────────────────────────────────────────────────────────────
  // Where records come from: every collection (by name, with its dot), and the records in it.
  // Drag one out, double-click it, or put the first thirty shown on the board as a grid. It never
  // opens a dialog.
  renderShelf() {
    const { collections, shelfCollection, shelfRows, q, doc } = this.state;
    const needle = q.trim().toLowerCase();
    const matched = shelfRows.filter(r => !needle || String(r.title).toLowerCase().includes(needle));
    const rows = matched.slice(0, 200);
    const onBoard = new Set((doc ? doc.nodes : []).map(n => n.path).filter(Boolean));
    const kind = shelfCollection === '__territory__' ? 'territory' : shelfCollection === '__goal__' ? 'goal' : 'document';
    const current = collections.find(c => c.id === shelfCollection) || null;
    const picture = this.pictureField(current);
    const fresh = matched.filter(r => !onBoard.has(r.path)).slice(0, ADD_MANY);
    const tab = (id, label, dot, onClick) => (
      <button key={id} type="button" className={'wbTab' + (shelfCollection === id ? ' on' : '')} onClick={onClick}>
        <span className="wbDot" style={{ background: dot }} />{label}
      </button>
    );
    return (
      <div className="wbShelf wbGlass" onPointerDown={stop} onWheel={stop} onDoubleClick={stop}>
        <div className="wbShelfHead">
          <div className="wbShelfTitle">
            <span>Records</span>
            <button type="button" className="wbSelBtn" onClick={() => this.setState({ shelf: false })} title="Hide this list" aria-label="Hide the records list">×</button>
          </div>
          <div className="wbShelfTabs">
            {collections.map(c => tab(c.id, collectionLabel(c), colourOf(c), () => this.pickShelf(c.id)))}
            {tab('__territory__', 'Territory', 'var(--marked)', () => this.pickMemoryShelf('territory'))}
            {tab('__goal__', 'Goals', 'var(--fg-muted)', () => this.pickMemoryShelf('goal'))}
          </div>
          <input ref={this.filter} value={q} onChange={e => this.setState({ q: e.target.value })} className="wbShelfFilter"
            placeholder={'Find in ' + (current ? collectionLabel(current) : kind === 'goal' ? 'Goals' : 'Territory') + '…'}
            aria-label="Filter the records list" onKeyDown={stop} />
        </div>
        <div className="wbShelfList">
          {!rows.length ? (
            <div className="wbShelfNone">{shelfRows.length ? 'Nothing here matches “' + q + '”.' : 'Nothing in here yet.'}</div>
          ) : null}
          {rows.map(r => {
            const placed = onBoard.has(r.path);
            const thumb = picture && r.fields ? mediaSrc(r.fields[picture.key]) : null;
            return (
              <button type="button" key={r.path} draggable className={'wbShelfRow' + (placed ? ' placed' : '')}
                onDragStart={e => { e.dataTransfer.setData('application/x-scout-node', JSON.stringify({ t: kind, path: r.path })); e.dataTransfer.effectAllowed = 'copy'; }}
                onDoubleClick={() => this.add({ t: kind, path: r.path }, 'placed ' + r.path)}
                title={(placed ? 'Already on the board. ' : '') + 'Drag onto the board, or double-click to place — ' + r.path}>
                {picture ? (thumb ? <img className="wbShelfThumb" src={thumb} alt="" loading="lazy" draggable={false} /> : <span className="wbShelfThumb" />) : null}
                <span className="wbShelfRowTitle">{r.title}</span>
                {placed ? <span className="wbShelfRowMark">on board</span> : null}
              </button>
            );
          })}
          {matched.length > rows.length ? <div className="wbShelfNone">{(matched.length - rows.length).toLocaleString('en-US')} more — type to narrow the list.</div> : null}
        </div>
        <div className="wbShelfFoot">
          {fresh.length > 1 ? (
            <button type="button" className="wbBtn" onClick={() => this.addRecords(fresh.map(r => ({ t: kind, path: r.path })), 'placed ' + fresh.length + ' from ' + (current ? current.id : kind))}
              title="Puts them on the board as a tidy grid">
              Add {fresh.length === matched.filter(r => !onBoard.has(r.path)).length ? 'these ' : 'the first '}{fresh.length} as a grid
            </button>
          ) : null}
          {current ? (
            <button type="button" className="wbBtn" onClick={() => this.add({ t: 'collection-view', collection: current.id }, 'placed the ' + current.id + ' view')}
              title="A live list of this collection, as one card">
              Add {collectionLabel(current)} as a live list
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  // ── render: the top bar ──────────────────────────────────────────────────────────────────────
  // What the board holds and how you look at it: records, a live list, arrange, undo, zoom. The
  // things you MAKE are on the rail.
  renderBar() {
    const { doc, busy, shelf, menu, collections, undo, redo } = this.state;
    const things = (doc.nodes || []).filter(n => n.t !== 'frame' && n.t !== 'draw').length;
    const cards = (doc.nodes || []).filter(n => ARRANGED.has(n.t)).length;
    const facts = (doc.edges || []).length;
    const drawn = (doc.links || []).length;
    const b = (label, onClick, title, extra = {}) => (
      <button key={label} type="button" className={'wbBtn' + (extra.cls ? ' ' + extra.cls : '')} onClick={onClick} title={title} disabled={!!extra.disabled}
        aria-pressed={extra.pressed} aria-label={extra.aria}>{label}</button>
    );
    return (
      <div className="wbBar">
        {b('Records', () => (shelf ? this.setState({ shelf: false }) : this.openShelf()), 'Show or hide the list of records you can put on the board', { cls: shelf ? 'on' : '', pressed: shelf })}
        <span className="wbMenuWrap">
          <button type="button" className={'wbBtn' + (menu === 'view' ? ' on' : '')} aria-expanded={menu === 'view'} onClick={() => this.setState({ menu: menu === 'view' ? null : 'view' })}
            title="A collection on the board as one live list">Live list ▾</button>
          {menu === 'view' ? (
            <div className="wbMenu">
              <span className="wbMenuHint">A collection as one card that lists what is in it right now.</span>
              {collections.map(c => (
                <button type="button" key={c.id} className="wbMenuRow" onClick={() => { this.setState({ menu: null }); this.add({ t: 'collection-view', collection: c.id }, 'placed the ' + c.id + ' view'); }}>
                  <span className="wbDot" style={{ background: colourOf(c) }} />{collectionLabel(c)}
                </button>
              ))}
              {!collections.length ? <span className="wbMenuHint">There are no collections yet.</span> : null}
            </div>
          ) : null}
        </span>
        <span className="wbSep" />
        {b('Arrange', () => this.arrange(), 'G — line the cards up in rows on the grid (or just what is selected). Notes, text, shapes and drawing are left where you put them.', { disabled: cards < 2 && Object.keys(this.state.sel).length < 2 })}
        {b('↶', () => this.undo(), 'Undo (⌘Z)', { cls: 'icon', disabled: !undo, aria: 'Undo' })}
        {b('↷', () => this.redo(), 'Redo (⇧⌘Z)', { cls: 'icon', disabled: !redo, aria: 'Redo' })}

        <span style={{ flex: 1 }} />

        {this.state.err ? <span className="wbErr" title={this.state.err} role="alert">{this.state.err}</span> : null}
        {busy ? <span className="wbStat" role="status">{busy}</span> : null}
        {/* what the board is showing, as numbers: the links the records make, and the ones you drew */}
        <span className="wbStat wbCounts" style={{ fontFamily: MONO }} title="Things on the board · links read from the records · links you drew">
          {things.toLocaleString('en-US')} {things === 1 ? 'item' : 'items'} · {facts.toLocaleString('en-US')} {facts === 1 ? 'link' : 'links'}{drawn ? ' · ' + drawn.toLocaleString('en-US') + ' drawn' : ''}
        </span>

        {this.props.onToggleFull ? b(this.props.full ? 'Exit full screen' : 'Full screen', this.props.onToggleFull, '⇧F', { cls: this.props.full ? 'on' : '' }) : null}

        <span className="wbZoom">
          {b('−', () => this.zoomBy(0.8), 'Zoom out (−)', { cls: 'icon', aria: 'Zoom out' })}
          <button type="button" className="wbBtn wbZoomPct" onClick={() => this.zoomTo(1)} title="Back to 100% (1)" style={{ fontFamily: MONO }}>
            <span ref={this.zoomLabel}>{Math.round(this.view().z * 100)}%</span>
          </button>
          {b('+', () => this.zoomBy(1.25), 'Zoom in (+)', { cls: 'icon', aria: 'Zoom in' })}
          {b('Fit', () => this.fit(), 'Fit everything on screen (0)', { disabled: !doc.nodes.length })}
        </span>
      </div>
    );
  }

  // Where a floating bar goes: centred over `box` (board space), kept whole inside the canvas (it
  // is one line, never wrapped), and dropped BELOW when there is no room above — it must not sit
  // on the thing it acts on.
  barAt(box) {
    const v = this.view();
    const r = this.rect();
    const i = this.inset();
    const above = box.y * v.z + v.y - 48, below = (box.y + box.h) * v.z + v.y + 14;
    const top = above >= 8 ? above : (below <= r.height - i.bottom - 44 ? below : 8);
    return { centre: box.x * v.z + v.x + (box.w * v.z) / 2, top };
  }
  // The bar's width is whatever its buttons add up to, so it is placed from its MEASURED width,
  // before the browser paints: centred where it wants to be, but never over the rail and never off
  // the right edge.
  placeBar() {
    const el = this.bar.current;
    if (!el) return;
    const r = this.rect();
    const half = el.offsetWidth / 2;
    const want = Number(el.dataset.centre) || 0;
    el.style.left = Math.round(Math.max(RAIL_INSET + half + 4, Math.min(want, r.width - half - 8))) + 'px';
  }

  // ── the selection bar ────────────────────────────────────────────────────────────────────────
  // A floating bar above the selection, carrying the verbs for whatever is selected — and only
  // those: a note gets colours, text gets sizes, a stroke gets widths, a record gets Open.
  renderSelBar() {
    if (this.state.selLink) return this.renderLinkBar();
    const nodes = this.selNodes().filter(isRect);
    const { tool } = this.state;
    if (!nodes.length || this.state.gesturing || this.state.edit || tool !== 'select') return null;
    const one = nodes.length === 1 ? nodes[0] : null;
    const locked = nodes.every(n => n.locked);
    const every = pred => nodes.every(pred);
    const shared = key => (nodes.every(n => n[key] === nodes[0][key]) ? nodes[0][key] : undefined);

    const btn = (label, onClick, title, cls = '') => (
      <button key={title} type="button" className={'wbSelBtn' + (cls ? ' ' + cls : '')} title={title} aria-label={typeof label === 'string' ? undefined : title}
        onClick={e => { e.stopPropagation(); onClick(); }}>{label}</button>
    );
    const sep = k => <span key={'s' + k} className="wbSelSep" />;
    const textIds = nodes.filter(n => n.t === 'text').map(n => n.id);

    const bits = [];
    if (one && one.path) {
      if (this.props.onOpenDocument) bits.push(btn('Open', () => this.props.onOpenDocument(one.path), 'Open the record (Enter)'));
      bits.push(btn('Show related', () => this.showRelated(one), 'Bring in the records this one points to, and the ones that point to it'));
      bits.push(sep(0));
    }
    if (one && !one.locked && (WORDY.has(one.t) || one.t === 'frame')) {
      bits.push(btn('Write', () => this.beginEdit(one.id), 'Write in it (Enter, or double-click)'));
      bits.push(sep(1));
    }
    if (every(n => COLOURABLE.has(n.t))) {
      bits.push(<Swatches key="colour" value={shared('colour') || null} onPick={c => this.patchSel({ colour: c }, 'changed a colour')} />);
      bits.push(sep(2));
    }
    if (every(n => n.t === 'text' || n.t === 'shape')) {
      const size = shared('size') || (nodes.length === 1 || every(n => !n.size) ? 'm' : undefined);
      bits.push(...TEXT_SIZES.map(s => btn(s.toUpperCase(), () => this.patchSel({ size: s }, 'changed the text size', () => this.refitText(textIds)),
        TEXT_SIZE_NAMES[s] + ' text', size === s ? 'on' : '')));
      if (textIds.length === nodes.length) {
        const bold = every(n => n.bold);
        bits.push(btn(<b>B</b>, () => this.patchSel({ bold: bold ? null : true }, bold ? 'made text regular' : 'made text bold', () => this.refitText(textIds)), 'Bold', bold ? 'on' : ''));
      }
      bits.push(sep(3));
    }
    if (every(n => n.t === 'shape')) {
      const kind = shared('shape');
      bits.push(...SHAPES.map(k => btn(<ToolIcon name={k} size={16} />, () => this.patchSel({ shape: k }, 'changed a shape'), SHAPE_NAMES[k], kind === k ? 'on' : '')));
      bits.push(sep(4));
    }
    if (every(n => n.t === 'draw')) {
      const width = shared('width');
      bits.push(...STROKE_WIDTHS.map(w => btn(<span className="wbNib" style={{ width: w + 3, height: w + 3 }} />, () => this.patchSel({ width: w }, 'changed a stroke'),
        w === 2 ? 'Thin line' : w === 4 ? 'Medium line' : 'Thick line', width === w ? 'on' : '')));
      bits.push(sep(5));
    }
    if (nodes.length > 1) {
      bits.push(...[['left', '⇤', 'Line up left edges'], ['hcenter', '↔', 'Centre on one vertical line'], ['right', '⇥', 'Line up right edges'],
        ['top', '⤒', 'Line up top edges'], ['vcenter', '↕', 'Centre on one horizontal line'], ['bottom', '⤓', 'Line up bottom edges']]
        .map(([edge, glyph, title]) => btn(glyph, () => this.doAlign(edge), title)));
      if (nodes.length > 2) {
        bits.push(btn('Space →', () => this.doDistribute('h'), 'Equal gaps, left to right'));
        bits.push(btn('Space ↓', () => this.doDistribute('v'), 'Equal gaps, top to bottom'));
      }
      bits.push(sep(6));
    }
    bits.push(btn('To front', () => this.reorderSel(true), 'Bring to the front'));
    bits.push(btn('To back', () => this.reorderSel(false), 'Send to the back'));
    bits.push(btn(locked ? 'Unlock' : 'Lock', () => this.patchSel({ locked: locked ? null : true }, locked ? 'unlocked' : 'locked'),
      locked ? 'Let it be moved and removed again' : 'Keep it where it is — it cannot be moved or removed until unlocked', locked ? 'on' : ''));
    bits.push(sep(7));
    bits.push(btn('Duplicate', () => this.duplicateSelected(), 'A copy, with the links between the copies (⌘D). ⌘C and ⌘V copy and paste.'));
    bits.push(btn('Remove', () => this.removeSelected(), 'Take off the board (⌫). A record itself is never deleted.', 'danger'));

    const at = this.barAt(bounds(nodes));
    return (
      <div ref={this.bar} data-centre={at.centre} className="wbSelBar wbGlass" onPointerDown={stop} onDoubleClick={stop} style={{ left: at.centre, top: at.top }}>
        {bits}
      </div>
    );
  }

  // The bar of a selected DRAWN link: which way it points, how it is drawn, its colour, its name —
  // and, when the two records it joins could say the same thing themselves, the one explicit
  // button that makes it so.
  renderLinkBar() {
    const l = this.link(this.state.selLink);
    if (!l || this.state.gesturing || this.state.editLink) return null;
    const a = this.node(l.from), b = this.node(l.to);
    if (!a || !b) return null;
    const mid = curvePoint(arrowGeom({ from: a.id, to: b.id }, { [a.id]: a, [b.id]: b }), 0.5);
    const offer = this.state.doc.offers ? this.state.doc.offers[l.id] : null;
    const btn = (label, onClick, title, cls = '') => (
      <button key={title} type="button" className={'wbSelBtn' + (cls ? ' ' + cls : '')} title={title} onClick={e => { e.stopPropagation(); onClick(); }}>{label}</button>
    );
    const sep = k => <span key={'s' + k} className="wbSelSep" />;
    const at = this.barAt({ x: mid.x - 20, y: mid.y - 20, w: 40, h: 40 });
    return (
      <div ref={this.bar} data-centre={at.centre} className="wbSelBar wbGlass" onPointerDown={stop} onDoubleClick={stop} style={{ left: at.centre, top: at.top }}>
        {btn('—', () => this.patchLink(l.id, { ends: 'none' }, 'made a link plain'), 'No arrowhead', l.ends === 'none' ? 'on' : '')}
        {btn('→', () => this.patchLink(l.id, { ends: 'arrow' }, 'pointed a link'), 'Arrow at the far end', l.ends === 'arrow' ? 'on' : '')}
        {btn('↔', () => this.patchLink(l.id, { ends: 'both' }, 'pointed a link both ways'), 'Arrows at both ends', l.ends === 'both' ? 'on' : '')}
        {btn('Flip', () => this.patchLink(l.id, { from: l.to, to: l.from }, 'turned a link round'), 'Point it the other way')}
        {sep(0)}
        {btn('Solid', () => this.patchLink(l.id, { line: 'solid' }, 'made a link solid'), 'A solid line', l.line !== 'dashed' ? 'on' : '')}
        {btn('Dashed', () => this.patchLink(l.id, { line: 'dashed' }, 'made a link dashed'), 'A dashed line', l.line === 'dashed' ? 'on' : '')}
        {sep(1)}
        <Swatches value={l.colour || null} onPick={c => this.patchLink(l.id, { colour: c }, 'coloured a link')} />
        {sep(2)}
        {btn(l.label ? 'Rename' : 'Name it', () => this.beginLinkEdit(l.id), 'Write on the line (Enter, or double-click it)')}
        {offer ? (
          <>
            {sep(3)}
            {btn(offer.sentence, () => this.makeReal(l.id),
              'Saves this on the record itself (' + offer.path + '), then takes the drawn line away — the record’s own relation is drawn in its place.', 'strong')}
          </>
        ) : null}
        {sep(4)}
        {btn('Remove', () => this.removeLink(l.id), 'Remove this link (⌫)', 'danger')}
      </div>
    );
  }

  renderEmpty() {
    return (
      <div className="wbEmpty" style={{ left: this.inset().left }}>
        <div className="wbEmptyBox">
          <div className="wbEmptyTitle">Lay things out and connect them</div>
          <div className="wbEmptyBody">
            Put records on the board and every real link between them draws itself. Write, draw and connect around them in your own words.
            Nothing you do here changes a record.
          </div>
          <div className="wbEmptyActions">
            <button type="button" className="wbBtn primary" onClick={() => this.openShelf()}>Add records</button>
            <button type="button" className="wbBtn" onClick={e => { e.stopPropagation(); this.setState({ menu: 'view' }); }}>Add a live list</button>
            <button type="button" className="wbBtn" onClick={() => this.newNote()}>Write a note</button>
          </div>
          <div className="wbEmptyBody" style={{ fontSize: 'var(--t-small)' }}>
            Or just start: double-click anywhere to write, press <b>N</b> for a note, <b>Tab</b> to grow a connected one, and drag from the dot on the side of anything to link it.
          </div>
        </div>
      </div>
    );
  }

  // The keys for the tool in hand, on the canvas rather than in a help page: this is a surface
  // where nobody reads documentation, and these are the whole interaction.
  hints() {
    const { tool, connectFrom } = this.state;
    if (tool === 'pen') return [['Drag', 'draw'], ['Esc', 'done drawing'], ['⌘Z', 'undo a stroke']];
    if (tool === 'eraser') return [['Drag over strokes', 'erase them'], ['Esc', 'done']];
    if (tool === 'connect') return connectFrom ? [['Click', 'what it links to'], ['Esc', 'cancel']] : [['Click', 'what the link starts at'], ['Esc', 'cancel']];
    if (tool === 'text') return [['Click', 'where the text goes'], ['Esc', 'cancel']];
    if (tool === 'note') return [['Click', 'where the note goes'], ['Esc', 'cancel']];
    if (tool === 'shape' || tool === 'frame') return [['Click or drag', 'place it'], ['Esc', 'cancel']];
    if (tool === 'hand') return [['Drag', 'move the board'], ['Esc', 'back to select']];
    if (this.state.edit) return [['Enter', 'new line'], ['Tab', 'connected note'], ['⇧Enter', 'one under it'], ['Esc', 'done']];
    return [['Double-click', 'write'], ['Drag a dot', 'link'], ['Tab', 'connected note'], ['Space-drag', 'move around'], ['⌘-scroll', 'zoom'], ['⌘Z', 'undo'], ['⌫', 'take off the board — records are never deleted']];
  }

  onLinkDown(e, l) {
    e.stopPropagation();
    if (this.press(e, null)) return;
    e.preventDefault();
    this.setState({ selLink: l.id, sel: {} });
  }
  // Which node the pointer is over — it shows its four link dots. Bubbling `pointerover` fires on
  // boundaries, not on every move, and state only changes when the node does.
  onOver(e) {
    const { tool, gesturing, hover } = this.state;
    if (gesturing || (tool !== 'select' && tool !== 'connect')) return;
    const el = e.target && e.target.closest ? e.target.closest('[data-wb-node],[data-wb-h]') : null;
    const id = el ? (el.getAttribute('data-wb-h') || el.getAttribute('data-wb-node')) : null;
    if (id !== hover) this.setState({ hover: id });
  }

  render() {
    const { doc, marquee, shelf, sel, selLink, editLink, edit, hover, viewRows, dropping, tool, gesturing } = this.state;
    if (!doc) {
      return <div className="wb" style={sx('align-items:center;justify-content:center;color:var(--fg-faint);font-size:var(--t-body)')} role="status">Opening the board…</div>;
    }
    const v = this.view();
    const byId = {};
    for (const n of doc.nodes) byId[n.id] = n;
    // Array order IS z-order, and frames render first so they sit behind their contents.
    const frames = [], rest = [];
    for (const n of doc.nodes) (n.t === 'frame' ? frames : rest).push(n);
    const bd = bounds(doc.nodes);
    // A label sits ON its curve, and slides along it out from under any card in the way. Strokes
    // are lines, not cards: a label may cross one.
    const solid = rest.filter(n => n.t !== 'draw'), taken = [];
    const edges = (doc.edges || []).filter(e => byId[e.from] && byId[e.to]).map(e => {
      const g = arrowGeom({ from: e.from, to: e.to }, byId);
      return { e, g, spot: labelSpot(g, solid, { w: 24 + String(e.label || e.field || '').length * 6.5, taken }) };
    });
    const links = (doc.links || []).filter(l => byId[l.from] && byId[l.to]).map(l => {
      const g = arrowGeom({ from: l.from, to: l.to }, byId);
      const named = !!l.label || editLink === l.id;
      return { l, g, spot: named ? labelSpot(g, solid, { w: 30 + Math.max(8, String(l.label || '').length) * 7, taken }) : null };
    });
    const canOpen = !!this.props.onOpenDocument;
    const node = n => {
      const view = n.t === 'collection-view' ? (viewRows[n.collection + '/' + (n.view || '')] || null) : null;
      return (
        <BoardNode key={n.id} node={n} card={n.path ? (doc.cards || {})[n.path] : null}
          on={!!sel[n.id]} editing={edit === n.id}
          rows={view ? view.rows : null} total={view ? view.total : null} canOpen={canOpen} ops={this.ops} />
      );
    };
    // The link dots: on the node under the pointer, and on the one selected node.
    const dots = [];
    if (!gesturing && !edit && (tool === 'select' || tool === 'connect')) {
      const ids = Object.keys(sel).filter(k => sel[k]);
      for (const id of [hover, ids.length === 1 ? ids[0] : null]) {
        if (id && byId[id] && linkable(byId[id]) && !dots.includes(byId[id])) dots.push(byId[id]);
      }
    }
    const boxed = rest.filter(n => sel[n.id] && edit !== n.id && (n.t === 'text' || n.t === 'shape' || n.t === 'draw'));
    const svgBox = { position: 'absolute', left: bd.x - 400, top: bd.y - 400, width: bd.w + 800, height: bd.h + 800, pointerEvents: 'none', overflow: 'visible' };

    return (
      <div className="wb">
        {this.renderBar()}
        <div ref={this.canvas} data-wb-canvas="1" data-tool={tool} data-multi={Object.keys(sel).length > 1 ? '1' : undefined} className="wbCanvas"
          onPointerDown={e => this.onBackgroundDown(e)}
          onPointerOver={e => this.onOver(e)}
          onPointerLeave={() => { if (this.state.hover) this.setState({ hover: null }); }}
          // A press on the board must not take the caret out of the field it has just put there
          // (or select the page's text). Real fields and buttons keep their own behaviour.
          onMouseDown={e => {
            if (e.target.closest && e.target.closest('input,textarea,select,button,a,[contenteditable="true"]')) return;
            e.preventDefault();
            // …and a press on the board DOES leave any other field (the shelf's filter, say): with
            // the default prevented nothing else would take the caret out of it, and the board's
            // keys stay off while a field has it.
            const el = document.activeElement;
            if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !el.hasAttribute('data-wb-edit')) el.blur();
          }}
          onDoubleClick={e => {
            if (tool !== 'select' || (e.target !== this.canvas.current && e.target !== this.layer.current)) return;
            this.placeText(this.pt(e));
          }}
          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!dropping && [...(e.dataTransfer.types || [])].includes('Files')) this.setState({ dropping: true }); }}
          onDragLeave={e => { if (dropping && e.target === this.canvas.current) this.setState({ dropping: false }); }}
          onDrop={e => this.onDrop(e)}
          style={{
            backgroundSize: (GRID * v.z) + 'px ' + (GRID * v.z) + 'px',
            backgroundPosition: v.x + 'px ' + v.y + 'px',
            '--wb-z': v.z,
          }}>
          <div ref={this.layer} className="wbLayer" style={{ transform: 'translate(' + v.x + 'px,' + v.y + 'px) scale(' + v.z + ')' }}>
            {frames.map(node)}

            {/* THE LINES. One <svg> for all of them, not one each: N absolutely-positioned SVGs is
                N composited layers. Two kinds, drawn to be told apart at a glance:
                · relations READ from the records — thin, grey, named after their field;
                · links a person DREW — heavier, in their colour, with their arrowhead. */}
            {edges.length || links.length ? (
              <svg style={svgBox}>
                <defs>
                  <marker id="wb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--border-3)" />
                  </marker>
                  <marker id="wb-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--fg-muted)" />
                  </marker>
                  {/* takes the colour of whichever link uses it */}
                  <marker id="wb-link-head" viewBox="0 0 10 10" refX="8.6" refY="5" markerWidth="5.4" markerHeight="5.4" orient="auto-start-reverse">
                    <path d="M 0 0.6 L 10 5 L 0 9.4 z" fill="context-stroke" />
                  </marker>
                </defs>
                <g transform={'translate(' + (-(bd.x - 400)) + ',' + (-(bd.y - 400)) + ')'}>
                  {edges.map(({ e, g }) => {
                    const on = this.state.hoverEdge === e.id || sel[e.from] || sel[e.to];
                    return (
                      <g key={e.id}>
                        {/* a fat invisible stroke is the hit target — a 2px curve is unclickable */}
                        <path d={g.path} className="wbEdgeHit"
                          onPointerEnter={() => this.setState({ hoverEdge: e.id })}
                          onPointerLeave={() => this.setState(s => (s.hoverEdge === e.id ? { hoverEdge: null } : null))}
                          onPointerDown={ev => { ev.stopPropagation(); if (this.press(ev, null)) return; this.setState({ selLink: null, sel: { [e.from]: true, [e.to]: true } }); }} />
                        <path d={g.path} stroke={on ? 'var(--fg-muted)' : 'var(--border-3)'} strokeWidth={on ? 2.25 : 1.5} fill="none"
                          strokeDasharray={e.declared ? undefined : '5 4'}
                          markerEnd={'url(#' + (on ? 'wb-arrow-on' : 'wb-arrow') + ')'} />
                      </g>
                    );
                  })}
                  {links.map(({ l, g }) => {
                    const on = selLink === l.id;
                    return (
                      <g key={l.id}>
                        {on ? <path d={g.path} className="wbLinkHalo" /> : null}
                        <path d={g.path} className="wbEdgeHit" onPointerDown={ev => this.onLinkDown(ev, l)}
                          onDoubleClick={ev => { ev.stopPropagation(); this.beginLinkEdit(l.id); }} />
                        <path d={g.path} className="wbLinkLine" stroke={hueVar(l.colour) || 'var(--fg-soft)'} strokeWidth={on ? 3 : 2.25}
                          strokeDasharray={l.line === 'dashed' ? '8 7' : undefined}
                          markerEnd={l.ends !== 'none' ? 'url(#wb-link-head)' : undefined}
                          markerStart={l.ends === 'both' ? 'url(#wb-link-head)' : undefined} />
                      </g>
                    );
                  })}
                </g>
              </svg>
            ) : null}

            {rest.map(node)}

            {/* the labels are HTML, on the same transform as everything else — which is exactly why
                this board is not a canvas library. Drawn above the cards so a line's name is never
                hidden by the cards it joins. */}
            {edges.map(({ e, spot }) => (
              <div key={'l' + e.id} className="wbEdgeLabelAt"
                onPointerDown={ev => { ev.stopPropagation(); if (this.press(ev, null)) return; this.setState({ selLink: null, sel: { [e.from]: true, [e.to]: true } }); }}
                onPointerEnter={() => this.setState({ hoverEdge: e.id })}
                onPointerLeave={() => this.setState(s => (s.hoverEdge === e.id ? { hoverEdge: null } : null))}
                title={(e.declared ? 'A relation field' : 'A plain value that names another record') + ' — ' + e.field + (e.collection ? ' on ' + e.collection : '')}
                style={{ left: spot.x, top: spot.y }}>
                <EdgeLabel edge={e} on={this.state.hoverEdge === e.id || !!sel[e.from] || !!sel[e.to]} />
              </div>
            ))}
            {links.filter(x => x.spot).map(({ l, spot }) => (
              <div key={'k' + l.id} className="wbEdgeLabelAt" style={{ left: spot.x, top: spot.y }}
                onPointerDown={ev => this.onLinkDown(ev, l)} onDoubleClick={ev => { ev.stopPropagation(); this.beginLinkEdit(l.id); }}>
                <LinkLabel link={l} on={selLink === l.id} editing={editLink === l.id}
                  onChange={val => this.put(d => ({ links: d.links.map(x => (x.id === l.id ? { ...x, label: val } : x)) }))}
                  onCommit={() => this.endLinkEdit()} />
              </div>
            ))}

            {/* a locked thing says so, just under its corner — outside it, so it never covers a word */}
            {!gesturing && !edit ? rest.filter(n => sel[n.id] && n.locked).map(n => (
              <div key={'p' + n.id} className="wbLockAt" style={{ left: n.x, top: n.y + n.h }}>
                <LockPip locked onToggle={() => this.ops.lock(n)} />
              </div>
            )) : null}

            {/* a selected word, shape or stroke has no card to light up, so it gets a box */}
            {boxed.map(n => <div key={'b' + n.id} className="wbSelBox" style={{ left: n.x, top: n.y, width: n.w, height: n.h }} />)}

            {/* the four dots a link is dragged from. They sit just outside the node, so they
                appear and disappear without anything else moving. */}
            {dots.map(n => (
              <div key={'h' + n.id} className="wbHandles" data-wb-h={n.id} style={{ left: n.x, top: n.y, width: n.w, height: n.h }}>
                {['t', 'r', 'b', 'l'].map(side => (
                  <span key={side} className={'wbHandle ' + side} title="Drag to link this to something — or let go on empty board for a new note"
                    onPointerDown={e => this.startLink(e, n)} onDoubleClick={stop} />
                ))}
              </div>
            ))}

            {/* what is being drawn right now — a connector or a pen stroke — painted straight to
                the DOM by the gesture, never through React */}
            <svg className="wbInk" aria-hidden="true">
              <path ref={this.band} className="wbBand" />
              <path ref={this.ink} className="wbInkPath" />
            </svg>

            {/* snap guides — drawn in BOARD space so they line up with the cards exactly, with the
                stroke divided by zoom so the line stays hairline at any camera */}
            {(this.state.guides || []).map((g, i) => (
              <div key={i} className="wbGuide" style={g.axis === 'x'
                ? { left: g.at, top: bd.y - 400, width: 'calc(1px / var(--wb-z))', height: bd.h + 800 }
                : { top: g.at, left: bd.x - 400, height: 'calc(1px / var(--wb-z))', width: bd.w + 800 }} />
            ))}

            {marquee ? (
              <div className={'wbMarquee' + (tool === 'shape' || tool === 'frame' ? ' making' : '')} style={{
                left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1),
                width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0),
              }} />
            ) : null}
          </div>

          {!doc.nodes.length && !doc.foreign ? this.renderEmpty() : null}
          {dropping ? <div className="wbDropHint">Drop pictures to put them on the board</div> : null}

          <div className="wbHints" role="note">
            {this.hints().map(([k, what]) => (
              <span key={k}><b style={{ fontFamily: MONO }}>{k}</b> {what}</span>
            ))}
          </div>

          {this.renderSelBar()}
          {this.renderRail()}
          {shelf ? this.renderShelf() : null}
        </div>
      </div>
    );
  }
}

// ── the inspector's GRAPH section ──────────────────────────────────────────────────────────────
// THE ONLY graph preview in the app, exported from here on purpose: the inspector's GRAPH section
// is a preview that opens INTO the whiteboard (docs/05_UI_SPEC.md §5), never a second graph
// feature. It renders the same facts the board draws — the pointing field name, and whether that
// field is a declared relation — because they come from the same derivation.
// `onOpenBoard(path)` — NOT `onOpen`. The old prop name was the inspector's own "open a record"
// callback, reused here by accident, so this button opened the DOCUMENT SURFACE — the screen it was
// already sitting on — instead of the whiteboard its label promises. `onOpenBoard` navigates to the
// board and Whiteboard.jsx's `place` prop puts this document (and its relations) on it, so the
// button is offered whether or not any relation has been drawn yet — opening the (possibly empty)
// board is still useful, and it is the one door in, never a second one competing with it.
export function GraphPreview({ doc, references = [], onOpenBoard }) {
  const byField = [];
  for (const r of references) {
    const hit = byField.find(x => x.field === r.field);
    if (hit) hit.n += 1; else byField.push({ field: r.field, n: 1, declared: r.declared, collection: r.collection, source: r.source });
  }
  return (
    <div style={sx('display:flex;flex-direction:column;gap:8px')}>
      {byField.length ? (
        <div style={sx('display:flex;flex-wrap:wrap;gap:5px')}>
          {byField.map(f => (
            <span key={f.field} title={f.declared ? 'a declared relation on #' + f.collection : 'a frontmatter pointer from ' + f.source}
              style={{
                ...mono('display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:6px;font-size:var(--t-label);font-weight:700'),
                color: f.declared ? 'var(--fg-muted)' : 'var(--fg-faint)',
                border: (f.declared ? '1px solid ' : '1px dashed ') + 'var(--border-2)',
              }}>
              {f.field}<span style={{ color: 'var(--fg-faint)' }}>{f.n}</span>
            </span>
          ))}
        </div>
      ) : (
        <span style={{ ...mono('font-size:var(--t-label);font-weight:500;letter-spacing:.08em'), color: 'var(--fg-faint)' }}>NO RELATIONS TO DRAW YET</span>
      )}
      {onOpenBoard && doc && doc.path ? (
        <Btn variant="secondary" size="sm" style={sx('justify-content:center')} onClick={() => onOpenBoard(doc.path)}>
          Open in the whiteboard
        </Btn>
      ) : (
        <span style={{ ...mono('font-size:var(--t-label);letter-spacing:.08em'), color: 'var(--fg-faint)' }}>
          PUT TWO OF THESE ON THE WHITEBOARD AND THE RELATION DRAWS ITSELF
        </span>
      )}
    </div>
  );
}
