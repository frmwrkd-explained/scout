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
// derived layout cannot hold a deliberate placement.
//
// ── EDGES ARE NOT DRAWN, THEY ARE READ ─────────────────────────────────────────────────────────
// There is no arrow tool. The server derives every edge from the real relations between the
// documents on the board and labels it with the field name that creates it (backend/scoutBoard.mjs
// `deriveEdges`). Placing a guest and the territory it was found in draws `found_in` by itself.
// This component therefore never invents, stores or edits an edge — it renders what the read
// returned, using the SAME connector geometry as the FrameForge board (`arrowGeom`).
//
// ── SAVE DISCIPLINE ────────────────────────────────────────────────────────────────────────────
// A drag is ONE save, fired on pointerup — not one per mousemove. Node coordinates live in this
// component during a gesture and are flushed once; the camera saves on a longer debounce, carries
// no base revision and never writes a log line, because panning is not document content.
//
// Props:
//   board            board id (the project id). Default 'main'.
//   onOpenDocument   (path) => void — OPEN on a card, and a row in a collection-view card.
//   onToast          (message, tone) => void — 'green' | 'amber' | 'red'. Optional.
//   full             boolean — the shell has hidden its chrome for this surface.
//   onToggleFull     () => void — F. When absent, F does nothing and the button is not drawn.
//   place            a `.md` path, carried in from the inspector's GRAPH ("Open in the whiteboard",
//                     docs/05_UI_SPEC.md §5). Placed on mount if it is not already a node on this
//                     board, along with its REFERENCED BY relations — so the click that says
//                     "show me how this connects" lands on a board that already shows it, not an
//                     empty canvas with one card.
import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { MONO } from './tokens';
import { Btn, Empty, Eyebrow } from './ui';
import {
  GRID, CARD, clampZoom, snap, bounds, fitView, toBoard, arrowGeom, isRect,
  alignNodes, distributeNodes, snapGuides, tidy,
} from './boardLayout';
import {
  DocumentNode, TerritoryNode, GoalNode, CollectionViewNode, NoteNode, ImageNode, FrameNode,
  LockPip, EdgeLabel, NOTE_TONES,
} from './WhiteboardNodes';

const SHELF_W = 240;
const HANDLE = 12;                 // resize grip, in SCREEN px — a grip that shrinks with zoom is unusable

const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });

// Default sizes mirror backend/scoutBoard.mjs SIZES. The server is the authority — it re-sanitises
// everything — and this is only what the card looks like before the round trip returns.
const SIZES = {
  document: { w: CARD.w, h: 260 },
  'collection-view': { w: 360, h: 300 },
  territory: { w: 300, h: 180 },
  goal: { w: 300, h: 160 },
  note: { w: 240, h: 160 },
  image: { w: CARD.w, h: CARD.h },
  frame: { w: 800, h: 520 },
};

const isTyping = () => {
  const el = document.activeElement;
  return !!el && (/^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable);
};

export default class Whiteboard extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      doc: null,                 // { nodes, edges, cards, view, rev, seq, log }
      sel: {},                   // id → true
      gesture: null,             // { kind, … } — transient, never persisted
      edit: null,                // node id whose text is being edited
      hoverEdge: null,
      shelf: true,
      collections: [],
      shelfCollection: null,
      shelfRows: [],
      memoryRows: { territory: [], goal: [] },
      viewRows: {},              // 'collection/view' → { rows, total } for the collection-view cards
      q: '',
      busy: '', err: '',
      guides: [],                 // live snap lines, transient — never persisted
    };
    this.canvas = React.createRef();
    this._key = e => this.onKey(e);
    this._saveT = null;
    this._viewT = null;
    this._space = false;
  }

  boardId() { return this.props.board || 'main'; }
  toast(msg, tone) { if (this.props.onToast) this.props.onToast(msg, tone); }

  componentDidMount() {
    this.load().then(() => this.placeIncoming());
    this.loadCollections();
    window.addEventListener('keydown', this._key, true);
    window.addEventListener('keyup', this._key, true);
    window.addEventListener('paste', this._paste = e => this.onPaste(e));
    // Re-read on focus. An agent rearranging the board through its own door, or a second window, is
    // the ordinary case here — not an edge one — and coming back to a stale canvas is how a clobber
    // starts. Skipped mid-gesture so a drag is never yanked out from under the cursor.
    window.addEventListener('focus', this._focus = () => {
      if (!this.state.gesture && !this.state.edit && !this._saveT) this.load();
    });
  }
  componentWillUnmount() {
    window.removeEventListener('keydown', this._key, true);
    window.removeEventListener('keyup', this._key, true);
    window.removeEventListener('paste', this._paste);
    window.removeEventListener('focus', this._focus);
    clearTimeout(this._saveT); clearTimeout(this._viewT);
    this.flush();
  }
  componentDidUpdate(prev) {
    if (prev.board !== this.props.board) { this.load().then(() => this.placeIncoming()); return; }
    if (prev.place !== this.props.place && this.props.place) this.placeIncoming();
  }

  // ── data ─────────────────────────────────────────────────────────────────────────────────────
  async load() {
    try {
      const doc = await api.scoutBoard(this.boardId());
      this.setState({ doc, err: doc.foreign ? 'This project already holds a different kind of board — it has not been touched.' : '' },
        () => this.loadViewNodes());
    } catch (e) { this.setState({ err: e.message }); }
  }
  async loadCollections() {
    try {
      const { collections } = await api.collections();
      this.setState({ collections }, () => {
        if (collections.length) this.pickShelf(collections[0].id);
      });
    } catch { /* the shelf is an accelerator, not the surface */ }
    // Territory and goals are memory objects, not collection records — item 17's "place a
    // territory or a goal" needs its own two rows on the shelf, loaded once alongside the
    // collections rather than refetched on every click into the tab.
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
    this.setState({ shelfCollection: id, shelfRows: [] });
    try {
      const { rows } = await api.documents(id, '');
      this.setState(s => (s.shelfCollection === id ? { shelfRows: rows || [] } : null));
    } catch (e) { this.setState({ err: e.message }); }
  }
  // The two MEMORY tabs on the shelf — sentinel ids so a collection a person happens to call
  // "territory" or "goal" can never be shadowed by these. Rows are already in state (loadCollections
  // above); nothing to fetch on the click itself.
  pickMemoryShelf(kind) {
    this.setState({ shelfCollection: kind === 'goal' ? '__goal__' : '__territory__', shelfRows: this.state.memoryRows[kind] || [] });
  }

  // A `.md` path handed in from the inspector's GRAPH (item 18). Places the document if it is not
  // already on the board, and up to eight of its REFERENCED BY relations alongside it, so opening
  // "the whole picture" is one action rather than one drag per related card.
  async placeIncoming() {
    const path = this.props.place;
    const doc = this.state.doc;
    if (!path || !doc || doc.foreign) return;
    const onBoard = new Set(doc.nodes.map(n => n.path).filter(Boolean));
    const additions = [];
    if (!onBoard.has(path)) additions.push({ t: 'document', path });
    try {
      const { references } = await api.references(path);
      for (const r of (references || [])) {
        if (!r.path || onBoard.has(r.path) || additions.some(a => a.path === r.path)) continue;
        additions.push({ t: 'document', path: r.path });
        if (additions.length >= 8) break;   // a card wall is not a relationship diagram
      }
    } catch { /* the document itself still lands even if the reference walk fails */ }
    if (!additions.length) return;
    const c = this.centre();
    const cols = Math.max(1, Math.ceil(Math.sqrt(additions.length)));
    const stepX = SIZES.document.w + GRID * 3, stepY = SIZES.document.h + GRID * 3;
    const startX = c.x - ((Math.min(cols, additions.length) - 1) * stepX) / 2;
    const nodes = [...doc.nodes, ...additions.map((spec, i) => ({
      ...SIZES.document, ...spec,
      x: snap(startX + (i % cols) * stepX),
      y: snap(c.y + Math.floor(i / cols) * stepY),
    }))];
    this.setNodes(nodes, 'placed ' + path + (additions.length > 1 ? ' and ' + (additions.length - 1) + ' related' : ''));
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

  // ── saving ───────────────────────────────────────────────────────────────────────────────────
  // Optimistic: state moves now, disk catches up. A failed save surfaces as an error banner and the
  // board is reloaded, because a canvas silently out of sync with its file is worse than a jump.
  setNodes(nodes, log) {
    this.setState(s => ({ doc: { ...s.doc, nodes } }), () => this.queueSave(log));
  }
  queueSave(log) {
    clearTimeout(this._saveT);
    this._pendingLog = log || this._pendingLog || '';
    this._saveT = setTimeout(() => this.flush(), 350);
  }
  // ONE save in flight at a time. Two overlapping flushes both send the rev the client currently
  // holds, so the second is stale by construction and 409s against the first — the client racing
  // itself. A gesture during a save marks the document dirty; the in-flight response carries the
  // fresh rev and the re-flush rides on it.
  flush() {
    clearTimeout(this._saveT);
    const doc = this.state.doc;
    if (!doc || doc.foreign) return Promise.resolve(null);
    if (this._saving) { this._dirty = true; return this._saving; }
    const log = this._pendingLog; this._pendingLog = '';
    this._saving = api.saveScoutBoard(this.boardId(), { nodes: doc.nodes, log, base: doc.rev })
      .then(saved => {
        this.setState(s => ({ doc: { ...saved, nodes: this._dirty ? s.doc.nodes : saved.nodes }, err: '' }), () => this.loadViewNodes());
        return saved;
      })
      .catch(e => {
        if (e.status === 409) {
          this.toast('The board changed elsewhere — reloaded, your last move was not saved', 'amber');
          this._dirty = false;
          this.load();
          return null;
        }
        this.setState({ err: e.message });
        this._dirty = false;
        this.load();
        return null;
      })
      .finally(() => {
        this._saving = null;
        if (this._dirty) { this._dirty = false; this.flush(); }
      });
    return this._saving;
  }
  // The camera is not document content: it carries no base stamp, can never conflict, and does not
  // advance `rev` on the server — which is why panning while an agent edits does not 409 in your face.
  setView(view, immediate) {
    this.setState(s => ({ doc: { ...s.doc, view } }));
    clearTimeout(this._viewT);
    this._viewT = setTimeout(() => api.saveScoutBoard(this.boardId(), { view })
      .then(saved => { if (saved && saved.rev != null && !this._saving) this.setState(st => (st.doc ? { doc: { ...st.doc, rev: saved.rev } } : null)); })
      .catch(() => {}), immediate ? 0 : 700);
  }

  // ── coordinates ──────────────────────────────────────────────────────────────────────────────
  view() { return (this.state.doc && this.state.doc.view) || { x: 0, y: 0, z: 1 }; }
  rect() { const el = this.canvas.current; return el ? el.getBoundingClientRect() : { left: 0, top: 0, width: 1200, height: 800 }; }
  pt(e) { const r = this.rect(); return toBoard(e.clientX - r.left, e.clientY - r.top, this.view()); }
  centre() { const r = this.rect(); return toBoard(r.width / 2, r.height / 2, this.view()); }

  // ── selection ────────────────────────────────────────────────────────────────────────────────
  selIds() { return Object.keys(this.state.sel).filter(k => this.state.sel[k]); }
  selNodes() { const s = this.state.sel; return (this.state.doc.nodes || []).filter(n => s[n.id]); }
  select(id, additive) { this.setState(s => ({ sel: additive ? { ...s.sel, [id]: !s.sel[id] } : { [id]: true } })); }

  // ── gestures ─────────────────────────────────────────────────────────────────────────────────
  // One pointerdown handler on the background, one on a node, and a single window-level move/up
  // pair per gesture. Listeners are torn down on up, so a drag that ends outside the window (very
  // common on a canvas) cannot leave a live mousemove attached.
  begin(e, gesture, onMove, onEnd) {
    e.preventDefault();
    this.setState({ gesture });
    const move = ev => onMove(ev);
    const up = ev => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.setState({ gesture: null });
      if (onEnd) onEnd(ev);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  onBackgroundDown(e) {
    if (e.button === 1 || this._space || e.altKey) return this.startPan(e);
    if (e.button !== 0) return;
    const start = this.pt(e);
    const keep = e.shiftKey ? { ...this.state.sel } : {};
    if (!e.shiftKey) this.setState({ sel: {}, edit: null });
    this.begin(e, { kind: 'marquee', x0: start.x, y0: start.y, x1: start.x, y1: start.y },
      ev => { const p = this.pt(ev); this.setState(s => ({ gesture: { ...s.gesture, x1: p.x, y1: p.y } })); },
      () => {
        const g = this.state.gesture;
        if (!g) return;
        const box = { x: Math.min(g.x0, g.x1), y: Math.min(g.y0, g.y1), w: Math.abs(g.x1 - g.x0), h: Math.abs(g.y1 - g.y0) };
        if (box.w < 4 && box.h < 4) return;      // a click is a deselect, not a zero-area selection
        const hit = { ...keep };
        for (const n of this.state.doc.nodes) {
          if (!isRect(n)) continue;
          if (n.x < box.x + box.w && n.x + n.w > box.x && n.y < box.y + box.h && n.y + n.h > box.y) hit[n.id] = true;
        }
        this.setState({ sel: hit });
      });
  }

  startPan(e) {
    const v = this.view();
    const x0 = e.clientX, y0 = e.clientY;
    this.begin(e, { kind: 'pan' }, ev => this.setView({ ...v, x: v.x + (ev.clientX - x0), y: v.y + (ev.clientY - y0) }));
  }

  onNodeDown(e, node) {
    if (e.button === 1 || this._space || e.altKey) return this.startPan(e);
    if (e.button !== 0) return;
    e.stopPropagation();
    // A locked node still SELECTS — you need its lock pip to unlock it — it just refuses to move.
    if (node.locked) { this.select(node.id, e.shiftKey); return; }
    const sel = this.state.sel[node.id] ? this.state.sel : (e.shiftKey ? { ...this.state.sel, [node.id]: true } : { [node.id]: true });
    if (sel !== this.state.sel) this.setState({ sel });
    const ids = Object.keys(sel).filter(k => sel[k]);
    const origin = new Map(this.state.doc.nodes.filter(n => ids.includes(n.id)).map(n => [n.id, { x: n.x, y: n.y }]));
    const p0 = this.pt(e);
    let moved = false;

    this.begin(e, { kind: 'move' },
      ev => {
        const p = this.pt(ev);
        const dx = p.x - p0.x, dy = p.y - p0.y;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 2) return;   // a click must not write a save
        moved = true;
        // Shift constrains to one axis — the only way to slide a card along a row without drifting.
        const ax = ev.shiftKey && Math.abs(dx) < Math.abs(dy) ? 0 : dx;
        const ay = ev.shiftKey && Math.abs(dy) <= Math.abs(dx) ? 0 : dy;
        const free = ev.metaKey || ev.ctrlKey;    // suspends every kind of snapping

        // Snapping is computed from the LEAD node (the one under the cursor) and the correction is
        // applied to the whole set, so a multi-selection keeps its internal spacing while still
        // landing flush against a neighbour.
        let gx = 0, gy = 0, guides = [];
        if (!free) {
          const lead = origin.get(node.id);
          const probe = { x: lead.x + ax, y: lead.y + ay, w: node.w, h: node.h, t: node.t };
          const g = snapGuides(probe, this.state.doc.nodes.filter(n => !ids.includes(n.id)));
          gx = g.dx; gy = g.dy; guides = g.guides;
        }

        this.setState(s => ({
          guides,
          doc: {
            ...s.doc,
            nodes: s.doc.nodes.map(n => {
              const o = origin.get(n.id);
              if (!o) return n;
              // an edge snap wins over the lattice: landing flush against a neighbour is what the
              // user aimed at, and re-snapping to the grid would push it back off by a pixel
              const nx = free ? Math.round(o.x + ax) : (gx ? Math.round(o.x + ax + gx) : snap(o.x + ax));
              const ny = free ? Math.round(o.y + ay) : (gy ? Math.round(o.y + ay + gy) : snap(o.y + ay));
              return { ...n, x: nx, y: ny };
            }),
          },
        }));
      },
      () => {
        this.setState({ guides: [] });
        if (moved) this.queueSave('moved ' + ids.length + ' node' + (ids.length === 1 ? '' : 's'));
      });
  }

  startResize(e, node) {
    e.stopPropagation();
    const p0 = this.pt(e);
    const w0 = node.w, h0 = node.h;
    this.begin(e, { kind: 'resize' },
      ev => {
        const p = this.pt(ev);
        const w = Math.max(GRID * 3, snap(w0 + (p.x - p0.x)));
        const h = Math.max(GRID * 2, snap(h0 + (p.y - p0.y)));
        this.setState(s => ({ doc: { ...s.doc, nodes: s.doc.nodes.map(n => (n.id === node.id ? { ...n, w, h } : n)) } }));
      },
      () => this.queueSave('resized a node'));
  }

  onWheel(e) {
    e.preventDefault();
    const v = this.view();
    const r = this.rect();
    if (e.ctrlKey || e.metaKey) {
      // Zoom at the CURSOR, not the centre — the difference between "I zoomed into that card" and
      // "everything ran away from me".
      const z = clampZoom(v.z * Math.exp(-e.deltaY / 300));
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      this.setView({ z, x: cx - (cx - v.x) * (z / v.z), y: cy - (cy - v.y) * (z / v.z) });
    } else {
      this.setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
    }
  }
  zoomBy(k) {
    const v = this.view(); const r = this.rect();
    const z = clampZoom(v.z * k);
    this.setView({ z, x: r.width / 2 - (r.width / 2 - v.x) * (z / v.z), y: r.height / 2 - (r.height / 2 - v.y) * (z / v.z) }, true);
  }
  fit() {
    const r = this.rect();
    const nodes = this.state.doc ? this.state.doc.nodes : [];
    if (!nodes.length) return;
    this.setView(fitView(nodes, r.width, r.height), true);
  }

  // ── keyboard ─────────────────────────────────────────────────────────────────────────────────
  // Capture phase, and every key this surface consumes calls stopPropagation(), so a focused canvas
  // claims a letter before the app's global bindings on the bubble phase.
  onKey(e) {
    if (e.type === 'keyup') { if (e.key === ' ') this._space = false; return; }
    if (isTyping() || !this.state.doc) return;
    const k = e.key;
    const mine = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === ' ') { this._space = true; mine(); return; }               // hold to pan
    if (k === 'Escape') {
      e.stopPropagation();
      if (this.props.full && this.props.onToggleFull) return this.props.onToggleFull();
      this.setState({ sel: {}, edit: null });
      return;
    }
    const ids = this.selIds();
    if ((k === 'Delete' || k === 'Backspace') && ids.length) { mine(); this.removeSelected(); return; }
    if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'd' && ids.length) { mine(); this.duplicateSelected(); return; }
    if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'a') {
      mine();
      this.setState({ sel: Object.fromEntries(this.state.doc.nodes.map(n => [n.id, true])) });
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (k === '=' || k === '+') { mine(); this.zoomBy(1.25); }
    else if (k === '-') { mine(); this.zoomBy(0.8); }
    else if (k === '0') { mine(); this.fit(); }
    else if (k === 'g') { mine(); this.align(); }
    else if (k === 'f' && this.props.onToggleFull) { mine(); this.props.onToggleFull(); }
    else if (ids.length && (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown')) {
      // Nudge by one grid cell, or by one pixel with shift for the last hair of alignment.
      mine();
      const d = e.shiftKey ? 1 : GRID;
      const dx = k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0;
      const dy = k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0;
      this.setNodes(this.state.doc.nodes.map(n => (this.state.sel[n.id] ? { ...n, x: n.x + dx, y: n.y + dy } : n)), 'nudged ' + ids.length);
    }
  }

  // ── node operations ──────────────────────────────────────────────────────────────────────────
  // Every one of them is "change the list, save the list": the server owns the whole node list and
  // mints the ids, so there is one write path and a node can never carry a client-invented id.
  // A new node is sent WITHOUT an id: ids come off the document's own counter on the server, so a
  // card can never carry a client-invented one. The saved list comes back and the new card — the
  // last one — is what gets selected.
  async add(spec, log) {
    const doc = this.state.doc;
    if (!doc || doc.foreign) return null;
    const size = SIZES[spec.t] || SIZES.note;
    const at = spec.x != null ? { x: spec.x, y: spec.y } : (() => { const c = this.centre(); return { x: snap(c.x - size.w / 2), y: snap(c.y - size.h / 2) }; })();
    const nodes = [...doc.nodes, { ...size, ...spec, ...at }];
    this._pendingLog = log || ('added a ' + spec.t);
    await new Promise(done => this.setState({ doc: { ...doc, nodes } }, done));
    const saved = await this.flush();
    const made = saved && saved.nodes.length === nodes.length ? saved.nodes[saved.nodes.length - 1] : null;
    if (made) this.setState({ sel: { [made.id]: true } });
    return made;
  }
  removeSelected() {
    const ids = new Set(this.selIds());
    if (!ids.size) return;
    this.setState({ sel: {} });
    this.setNodes(this.state.doc.nodes.filter(n => !ids.has(n.id)), 'removed ' + ids.size + ' node' + (ids.size === 1 ? '' : 's'));
  }
  async duplicateSelected() {
    const copies = this.selNodes().map(n => { const { id, ...rest } = n; return { ...rest, x: n.x + GRID * 2, y: n.y + GRID * 2 }; });
    if (!copies.length) return;
    const doc = this.state.doc;
    if (doc.foreign) return;
    const nodes = [...doc.nodes, ...copies];
    this._pendingLog = 'duplicated ' + copies.length;
    await new Promise(done => this.setState({ doc: { ...doc, nodes } }, done));
    const saved = await this.flush();
    if (saved && saved.nodes.length === nodes.length) this.setState({ sel: Object.fromEntries(saved.nodes.slice(-copies.length).map(n => [n.id, true])) });
  }

  // AUTO-ALIGN IS AN ACTION (T15 §5). One press, one new node list, as editable afterwards as
  // anything placed by hand — and the geometry is `boardLayout.js`'s, not a second implementation.
  align() {
    const doc = this.state.doc;
    if (!doc || !doc.nodes.length) return;
    this.setState({ busy: 'align' });
    const next = tidy(doc.nodes, { cols: 4 }).map(n => ({ ...n }));
    this.setState(s => ({ doc: { ...s.doc, nodes: next }, busy: '', sel: {} }), () => {
      this.queueSave('auto-aligned · tidy — ' + next.length + ' node' + (next.length === 1 ? '' : 's'));
      // Framing the result is part of the gesture: an align that leaves you looking at empty board
      // reads as nothing having happened.
      setTimeout(() => this.fit(), 30);
      this.toast('Aligned · tidy', 'green');
    });
  }

  patchSel(patch, log) {
    this.setNodes(this.state.doc.nodes.map(n => (this.state.sel[n.id] ? { ...n, ...patch } : n)), log);
  }
  reorderSel(toFront) {
    // z-order IS array order in this document, so "bring to front" is a splice, not a field every
    // reader has to reconcile.
    const sel = this.state.sel;
    const picked = this.state.doc.nodes.filter(n => sel[n.id]);
    const rest = this.state.doc.nodes.filter(n => !sel[n.id]);
    this.setNodes(toFront ? [...rest, ...picked] : [...picked, ...rest], toFront ? 'brought to front' : 'sent to back');
  }
  doAlign(edge) { this.setNodes(alignNodes(this.state.doc.nodes, this.selIds(), edge), 'aligned ' + edge); }
  doDistribute(axis) { this.setNodes(distributeNodes(this.state.doc.nodes, this.selIds(), axis), 'distributed'); }

  // ── bringing documents in ────────────────────────────────────────────────────────────────────
  onDrop(e) {
    e.preventDefault();
    const at = this.pt(e);
    const raw = e.dataTransfer.getData('application/x-scout-node');
    if (raw) {
      try {
        const spec = JSON.parse(raw);
        this.add({ ...spec, x: snap(at.x), y: snap(at.y) }, 'placed ' + (spec.path || spec.collection || spec.t));
        return;
      } catch { /* not one of ours */ }
    }
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      // The FILES browser exists now (item 15) and its rows carry the same `application/x-scout-
      // node` payload the `if (raw)` branch above already handles — so a genuine drop FROM there
      // lands as a document node, and only a native file dragged in from the OS (an image from
      // Finder, say) ever reaches this branch.
      this.toast('Drag a document from the shelf or from FILES ON DISK — a file from outside the workspace cannot be dropped here yet', 'amber');
    }
  }
  onPaste(e) {
    if (isTyping() || !this.state.doc) return;
    const text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (text && text.trim()) {
      e.preventDefault();
      const c = this.centre();
      this.add({ t: 'note', text: text.trim().slice(0, 4000), x: snap(c.x), y: snap(c.y) }, 'pasted a note');
    }
  }

  // ── render: the shelf ────────────────────────────────────────────────────────────────────────
  // Every collection, and the documents in it. This is the "put documents in there" half of the
  // surface, and it never opens a dialog: drag a row, or double-click it.
  renderShelf() {
    const { collections, shelfCollection, shelfRows, q } = this.state;
    const needle = q.trim().toLowerCase();
    const rows = shelfRows.filter(r => !needle || String(r.title + ' ' + r.path).toLowerCase().includes(needle)).slice(0, 200);
    const onBoard = new Set((this.state.doc ? this.state.doc.nodes : []).map(n => n.path).filter(Boolean));
    // The node kind the drag/double-click payload carries — 'document' for a real collection's
    // rows, 'territory'/'goal' for the two memory tabs (item 17). One shelf, one drag contract
    // (`application/x-scout-node`), three sources.
    const shelfNodeType = shelfCollection === '__territory__' ? 'territory' : shelfCollection === '__goal__' ? 'goal' : 'document';
    return (
      <div onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}
        style={{
          ...sx('position:absolute;top:10px;left:10px;bottom:10px;display:flex;flex-direction:column;border-radius:12px;overflow:hidden;z-index:20'),
          width: SHELF_W,
          // glass, so the canvas underneath stays legible and the panel reads as floating chrome
          background: 'color-mix(in srgb, var(--surface) 88%, transparent)',
          backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
          border: '1px solid var(--border-2)', boxShadow: '0 18px 44px rgba(0,0,0,.5)',
        }}>
        <div style={sx('flex:none;display:flex;flex-wrap:wrap;gap:2px;padding:8px;border-bottom:1px solid var(--border)')}>
          {collections.map(c => (
            <span key={c.id} onClick={() => this.pickShelf(c.id)} className={shelfCollection === c.id ? '' : 'hBd'}
              style={{
                ...mono('padding:4px 9px;border-radius:6px;cursor:pointer;font-size:9.5px;font-weight:700'),
                color: shelfCollection === c.id ? 'var(--fg)' : 'var(--fg-muted)',
                background: shelfCollection === c.id ? 'var(--raise)' : 'transparent',
                border: '1px solid ' + (shelfCollection === c.id ? 'var(--border-3)' : 'var(--border-2)'),
              }}>#{c.id}</span>
          ))}
          {!collections.length ? <Eyebrow style={sx('padding:6px 2px')}>NO COLLECTIONS YET</Eyebrow> : null}
          {/* the two memory tabs — territory and goals are placed on the board the same way any
              document is, they just carry no collection (item 17) */}
          {[['__territory__', 'TERRITORY'], ['__goal__', 'GOALS']].map(([kind, label]) => (
            <span key={kind} onClick={() => this.pickMemoryShelf(kind === '__goal__' ? 'goal' : 'territory')}
              className={shelfCollection === kind ? '' : 'hBd'}
              style={{
                ...mono('padding:4px 9px;border-radius:6px;cursor:pointer;font-size:9.5px;font-weight:700'),
                color: shelfCollection === kind ? 'var(--fg)' : 'var(--fg-muted)',
                background: shelfCollection === kind ? 'var(--raise)' : 'transparent',
                border: '1px solid ' + (shelfCollection === kind ? 'var(--border-3)' : 'var(--border-2)'),
              }}>{label}</span>
          ))}
        </div>
        <div style={sx('flex:none;padding:8px 10px;border-bottom:1px solid var(--line)')}>
          <input value={q} onChange={e => this.setState({ q: e.target.value })} placeholder="Filter…"
            onKeyDown={e => e.stopPropagation()}
            style={{ ...sx('width:100%;box-sizing:border-box;border-radius:6px;padding:5px 8px;outline:none;font-size:11px'), background: 'var(--sunk)', border: '1px solid var(--border-2)', color: 'var(--fg)' }} />
        </div>
        <div style={sx('flex:1;overflow-y:auto;padding:8px')}>
          {!rows.length ? (
            <div style={sx('padding:18px 6px;font-size:11px;color:var(--fg-faint);line-height:1.6')}>
              Nothing here yet. Every document in a collection can go on the board — drag one out, and any relation it has with another card draws itself.
            </div>
          ) : null}
          {rows.map(r => (
            <div key={r.path} draggable
              onDragStart={e => { e.dataTransfer.setData('application/x-scout-node', JSON.stringify({ t: shelfNodeType, path: r.path })); e.dataTransfer.effectAllowed = 'copy'; }}
              onDoubleClick={() => this.add({ t: shelfNodeType, path: r.path }, 'placed ' + r.path)}
              title={onBoard.has(r.path) ? 'already on the board — drag to place another card' : 'drag onto the board, or double-click to place'}
              className="hBg"
              style={{ ...sx('display:flex;flex-direction:column;gap:1px;padding:5px 7px;border-radius:7px;cursor:grab;margin-bottom:2px'), opacity: onBoard.has(r.path) ? 0.45 : 1 }}>
              <span style={sx('font-size:11.5px;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{r.title}</span>
              <span style={{ ...mono('font-size:8.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'), color: 'var(--fg-faint)' }}>{r.path}</span>
            </div>
          ))}
        </div>
        {/* a saved-query card only means something for a REAL collection — the memory tabs have
            no view to put on the board, only the objects themselves */}
        {shelfCollection && collections.some(c => c.id === shelfCollection) ? (
          <div style={sx('flex:none;padding:8px;border-top:1px solid var(--line)')}>
            <Btn variant="ghost" size="sm" style={sx('width:100%;justify-content:center')}
              onClick={() => this.add({ t: 'collection-view', collection: shelfCollection }, 'placed the #' + shelfCollection + ' view')}>
              + Put #{shelfCollection} on the board
            </Btn>
          </div>
        ) : null}
      </div>
    );
  }

  // ── render: the toolbar ──────────────────────────────────────────────────────────────────────
  renderBar() {
    const { doc, busy, shelf } = this.state;
    const pill = (label, onClick, title) => (
      <span key={label} onClick={onClick} title={title} className="hBd"
        style={{ ...sx('padding:4px 10px;border-radius:7px;cursor:pointer;font-size:11px;font-weight:600;white-space:nowrap'), color: 'var(--fg-soft)', border: '1px solid var(--border-2)' }}>{label}</span>
    );
    return (
      <div style={sx('flex:none;display:flex;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid var(--border);flex-wrap:wrap;background:var(--surface)')}>
        <span onClick={() => this.setState({ shelf: !shelf })} className="hBd" title="toggle the shelf"
          style={{ ...sx('padding:4px 9px;border-radius:7px;cursor:pointer;font-size:11px;font-weight:600'), color: 'var(--fg-soft)', border: '1px solid var(--border-2)' }}>DOCS</span>

        <span style={{ ...mono('font-size:9.5px;letter-spacing:.1em;margin-left:4px'), color: 'var(--fg-faint)' }}>ALIGN</span>
        {pill('Tidy', () => this.align(), 'G — snap everything to the grid and close the gaps, keeping your arrangement')}

        <span style={sx('width:1px;height:18px;background:var(--border-2);margin:0 4px')} />
        {pill('+ Note', () => this.add({ t: 'note', text: '' }, 'added a note'), 'a sticky note')}
        {pill('+ Frame', () => this.add({ t: 'frame', label: 'GROUP' }, 'added a frame'), 'a titled group')}

        <span style={sx('flex:1')} />

        {this.state.err ? <span style={{ fontSize: 10.5, color: 'var(--danger)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={this.state.err}>{this.state.err}</span> : null}
        {busy ? <span style={{ ...mono('font-size:9.5px'), color: 'var(--accent)' }}>{busy.toUpperCase()}…</span> : null}

        {/* what the board is actually FOR, stated as a number: how many real relations it is showing */}
        <span style={{ ...mono('font-size:9.5px;letter-spacing:.06em'), color: 'var(--fg-faint)' }}>
          {(doc.nodes || []).length} NODES · {(doc.edges || []).length} RELATIONS
        </span>

        {this.props.onToggleFull ? (
          <span onClick={this.props.onToggleFull} className="hBd"
            style={{ ...sx('padding:4px 9px;border-radius:7px;cursor:pointer;font-size:11px;font-weight:600'), color: this.props.full ? 'var(--on-accent)' : 'var(--fg-soft)', background: this.props.full ? 'var(--accent)' : 'transparent', border: '1px solid ' + (this.props.full ? 'var(--accent)' : 'var(--border-2)') }}>
            {this.props.full ? 'Exit full screen' : 'Full screen'}
          </span>
        ) : null}

        <span style={sx('display:flex;align-items:center;gap:2px')}>
          <span onClick={() => this.zoomBy(0.8)} className="hBd" style={{ ...sx('width:24px;text-align:center;padding:3px 0;border-radius:6px;cursor:pointer;font-size:13px'), color: 'var(--fg-soft)', border: '1px solid var(--border-2)' }}>−</span>
          <span onClick={() => this.fit()} className="hBd" title="0 — fit everything"
            style={{ ...mono('padding:3px 8px;border-radius:6px;cursor:pointer;font-size:10px'), color: 'var(--fg-soft)', border: '1px solid var(--border-2)' }}>{Math.round(this.view().z * 100)}%</span>
          <span onClick={() => this.zoomBy(1.25)} className="hBd" style={{ ...sx('width:24px;text-align:center;padding:3px 0;border-radius:6px;cursor:pointer;font-size:13px'), color: 'var(--fg-soft)', border: '1px solid var(--border-2)' }}>+</span>
        </span>
      </div>
    );
  }

  // ── the selection toolbar ────────────────────────────────────────────────────────────────────
  // A floating context bar above the selection, carrying the verbs for whatever is selected. Every
  // canvas tool worth copying has one, and for the same reason: a canvas has no room for a
  // permanent inspector, and a note colour in a global toolbar is greyed out most of the time.
  renderSelBar() {
    const nodes = this.selNodes().filter(isRect);
    if (!nodes.length || this.state.gesture || this.state.edit) return null;
    const v = this.view();
    const b = bounds(nodes);
    const one = nodes.length === 1 ? nodes[0] : null;
    const locked = nodes.every(n => n.locked);
    const r = this.rect();
    const left = Math.min(Math.max(12, b.x * v.z + v.x + (b.w * v.z) / 2), r.width - 12);
    const top = Math.max(8, b.y * v.z + v.y - 46);

    const btn = (label, onClick, on, title) => (
      <span key={label + title} onClick={e => { e.stopPropagation(); onClick(); }} title={title} className={on ? '' : 'hBg'}
        style={{
          ...sx('display:flex;align-items:center;justify-content:center;min-width:24px;height:24px;padding:0 6px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600'),
          background: on ? 'var(--accent)' : 'transparent', color: on ? 'var(--on-accent)' : 'var(--fg-soft)',
        }}>{label}</span>
    );
    const sep = k => <span key={'s' + k} style={sx('width:1px;height:16px;background:var(--border-2);margin:0 3px')} />;

    const bits = [];
    if (one && one.t === 'note') {
      bits.push(
        <span key="tones" style={sx('display:flex;gap:4px;align-items:center')}>
          {Object.entries(NOTE_TONES).map(([t, c]) => (
            <span key={t} onClick={e => { e.stopPropagation(); this.patchSel({ tone: t }, 'note colour'); }} title={t}
              style={{ ...sx('width:15px;height:15px;border-radius:4px;cursor:pointer;flex:none'), background: c, border: '2px solid ' + ((one.tone || 'accent') === t ? 'var(--fg)' : 'transparent') }} />
          ))}
        </span>,
      );
      bits.push(sep(1));
    }
    if (nodes.length > 1) {
      bits.push(...[['left', 'L'], ['hcenter', 'C'], ['right', 'R'], ['top', 'T'], ['vcenter', 'M'], ['bottom', 'B']]
        .map(([edge, g]) => btn(g, () => this.doAlign(edge), false, 'align ' + edge)));
      if (nodes.length > 2) {
        bits.push(sep(2));
        bits.push(btn('H≡', () => this.doDistribute('h'), false, 'distribute horizontally'));
        bits.push(btn('V≡', () => this.doDistribute('v'), false, 'distribute vertically'));
      }
      bits.push(sep(3));
    }
    bits.push(btn('FRONT', () => this.reorderSel(true), false, 'bring to front'));
    bits.push(btn('BACK', () => this.reorderSel(false), false, 'send to back'));
    bits.push(btn(locked ? 'LOCKED' : 'LOCK', () => this.patchSel({ locked: !locked }, locked ? 'unlocked' : 'locked'), locked, locked ? 'unlock' : 'lock in place'));
    bits.push(sep(4));
    bits.push(btn('COPY', () => this.duplicateSelected(), false, 'duplicate'));
    bits.push(
      <span key="del" onClick={e => { e.stopPropagation(); this.removeSelected(); }} className="hBgRed" title="remove from the board — the record itself is never touched"
        style={{ ...sx('display:flex;align-items:center;justify-content:center;min-width:24px;height:24px;padding:0 6px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600'), color: 'var(--danger)' }}>REMOVE</span>,
    );

    return (
      <div onPointerDown={e => e.stopPropagation()}
        style={{
          ...sx('position:absolute;display:flex;align-items:center;gap:2px;padding:4px 6px;border-radius:9px;z-index:25'),
          left, top, transform: 'translateX(-50%)',
          background: 'color-mix(in srgb, var(--surface-2) 94%, transparent)',
          backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
          border: '1px solid var(--border-2)', boxShadow: '0 10px 30px rgba(0,0,0,.5)',
          maxWidth: 'calc(100% - 24px)', flexWrap: 'wrap',
        }}>
        {bits}
      </div>
    );
  }

  // ── render: one node ─────────────────────────────────────────────────────────────────────────
  renderNode(n) {
    const { sel, edit, doc } = this.state;
    const on = !!sel[n.id];
    const editing = edit === n.id;
    const card = n.path ? (doc.cards || {})[n.path] : null;
    const setText = v => this.setState(s => ({ doc: { ...s.doc, nodes: s.doc.nodes.map(x => (x.id === n.id ? { ...x, text: v } : x)) } }));
    const setLabel = v => this.setState(s => ({ doc: { ...s.doc, nodes: s.doc.nodes.map(x => (x.id === n.id ? { ...x, label: v } : x)) } }));
    const commit = () => { this.setState({ edit: null }); this.queueSave('edited text'); };
    const open = this.props.onOpenDocument || null;

    let body = null;
    if (n.t === 'document') body = <DocumentNode node={n} card={card} selected={on} onOpen={open} />;
    else if (n.t === 'territory') body = <TerritoryNode node={n} card={card} selected={on} onOpen={open} />;
    else if (n.t === 'goal') body = <GoalNode node={n} card={card} selected={on} onOpen={open} />;
    else if (n.t === 'collection-view') {
      const v = (this.state.viewRows[n.collection + '/' + (n.view || '')] || {});
      body = <CollectionViewNode node={n} rows={v.rows} total={v.total} selected={on} onOpen={open} />;
    } else if (n.t === 'note') body = <NoteNode node={n} selected={on} editing={editing} onEdit={() => this.setState({ edit: n.id })} onChange={setText} onCommit={commit} />;
    else if (n.t === 'image') body = <ImageNode node={n} selected={on} />;
    else if (n.t === 'frame') body = <FrameNode node={n} selected={on} editing={editing} onEdit={() => this.setState({ edit: n.id })} onChange={setLabel} onCommit={commit} onGrab={e => this.onNodeDown(e, n)} />;

    // A frame is pointer-transparent except for its title bar (see FrameNode) so it never swallows
    // a click aimed at a card sitting inside it.
    const passthrough = n.t === 'frame';
    return (
      <div key={n.id}
        onPointerDown={passthrough ? undefined : e => this.onNodeDown(e, n)}
        style={{
          ...sx('position:absolute'),
          left: n.x, top: n.y, width: n.w, height: n.h,
          pointerEvents: passthrough ? 'none' : 'auto',
          cursor: this.state.gesture ? 'grabbing' : 'grab',
        }}>
        {body}
        {on && !editing && n.t !== 'frame' ? (
          <LockPip locked={!!n.locked} onToggle={() => this.setNodes(this.state.doc.nodes.map(x => (x.id === n.id ? { ...x, locked: !x.locked } : x)), n.locked ? 'unlocked a node' : 'locked a node')} />
        ) : null}
        {on && !editing && !n.locked ? (
          // The grip is sized in SCREEN pixels — divided by zoom so it stays the same physical size
          // whatever the camera is doing. A grip that shrinks to two pixels at 20% is not a grip.
          <div onPointerDown={e => this.startResize(e, n)}
            style={{
              ...sx('position:absolute;border-radius:3px;z-index:5'),
              width: HANDLE / this.view().z, height: HANDLE / this.view().z,
              right: -(HANDLE / this.view().z) / 2, bottom: -(HANDLE / this.view().z) / 2,
              background: 'var(--accent)', border: '1px solid var(--on-accent)',
              cursor: 'nwse-resize', pointerEvents: 'auto',
            }} />
        ) : null}
      </div>
    );
  }

  render() {
    const { doc, gesture, shelf } = this.state;
    if (!doc) {
      return <div style={sx('flex:1;display:flex;align-items:center;justify-content:center;color:var(--fg-faint);font-size:12px')}>Loading the board…</div>;
    }
    const v = this.view();
    const byId = Object.fromEntries(doc.nodes.map(n => [n.id, n]));
    // Array order IS z-order, and frames render first so they sit behind their contents.
    const frames = doc.nodes.filter(n => n.t === 'frame');
    const rest = doc.nodes.filter(n => n.t !== 'frame');
    const b = bounds(doc.nodes);
    const edges = (doc.edges || []).map(e => ({ e, g: arrowGeom({ from: e.from, to: e.to }, byId) }));

    return (
      <div style={sx('flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;position:relative')}>
        {this.renderBar()}
        <div ref={this.canvas}
          onPointerDown={e => this.onBackgroundDown(e)}
          onWheel={e => this.onWheel(e)}
          onDoubleClick={e => {
            if (e.target !== this.canvas.current && !e.target.dataset.bg) return;
            const p = this.pt(e);
            this.add({ t: 'note', text: '', x: snap(p.x), y: snap(p.y) }, 'added a note')
              .then(n => n && this.setState({ edit: n.id, sel: { [n.id]: true } }));
          }}
          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
          onDrop={e => this.onDrop(e)}
          style={{
            ...sx('flex:1;position:relative;overflow:hidden;min-height:0'),
            background: 'var(--ink)',
            // The lattice is drawn in the SAME unit the align action snaps to, so a hand-placed card
            // and an auto-aligned one visibly land on the same grid.
            backgroundImage: 'radial-gradient(circle, var(--border) 1px, transparent 1px)',
            backgroundSize: (GRID * v.z) + 'px ' + (GRID * v.z) + 'px',
            backgroundPosition: v.x + 'px ' + v.y + 'px',
            cursor: gesture && gesture.kind === 'pan' ? 'grabbing' : 'default',
            touchAction: 'none',
          }}>
          <div style={{
            ...sx('position:absolute;top:0;left:0;width:0;height:0'),
            transform: 'translate(' + v.x + 'px,' + v.y + 'px) scale(' + v.z + ')',
            transformOrigin: '0 0',
          }}>
            {frames.map(n => this.renderNode(n))}

            {/* THE RELATIONS. One <svg> for every edge, not one per edge: N absolutely-positioned
                SVGs is N composited layers. Clicking a relation selects both of its documents —
                there is nothing else to do to it, because it is not yours to edit. */}
            {edges.length ? (
              <svg style={{ position: 'absolute', left: b.x - 400, top: b.y - 400, width: b.w + 800, height: b.h + 800, pointerEvents: 'none', overflow: 'visible' }}>
                <defs>
                  <marker id="wb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--border-3)" />
                  </marker>
                  <marker id="wb-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
                  </marker>
                </defs>
                <g transform={'translate(' + (-(b.x - 400)) + ',' + (-(b.y - 400)) + ')'}>
                  {edges.map(({ e, g }) => {
                    const on = this.state.hoverEdge === e.id || this.state.sel[e.from] || this.state.sel[e.to];
                    return (
                      <g key={e.id}>
                        {/* a fat invisible stroke is the hit target — a 2px curve is unclickable */}
                        <path d={g.path} stroke="transparent" strokeWidth={16} fill="none" style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                          onPointerEnter={() => this.setState({ hoverEdge: e.id })}
                          onPointerLeave={() => this.setState(s => (s.hoverEdge === e.id ? { hoverEdge: null } : null))}
                          onPointerDown={ev => { ev.stopPropagation(); this.setState({ sel: { [e.from]: true, [e.to]: true } }); }} />
                        <path d={g.path} stroke={on ? 'var(--accent)' : 'var(--border-3)'} strokeWidth={on ? 2.5 : 1.75} fill="none"
                          strokeDasharray={e.declared ? undefined : '5 4'}
                          markerEnd={'url(#' + (on ? 'wb-arrow-on' : 'wb-arrow') + ')'} />
                      </g>
                    );
                  })}
                </g>
              </svg>
            ) : null}

            {/* the label is HTML, on the same transform as everything else — which is exactly why
                this board is not a canvas library */}
            {edges.map(({ e, g }) => (
              <div key={'l' + e.id} onPointerDown={ev => { ev.stopPropagation(); this.setState({ sel: { [e.from]: true, [e.to]: true } }); }}
                onPointerEnter={() => this.setState({ hoverEdge: e.id })}
                onPointerLeave={() => this.setState(s => (s.hoverEdge === e.id ? { hoverEdge: null } : null))}
                title={e.declared ? 'a declared relation on #' + e.collection : 'a frontmatter pointer no collection declares'}
                style={{
                  ...sx('position:absolute;cursor:pointer;z-index:6'),
                  left: (g.a.x + g.b.x) / 2, top: (g.a.y + g.b.y) / 2, transform: 'translate(-50%,-50%)',
                }}>
                <EdgeLabel edge={e} on={this.state.hoverEdge === e.id || !!this.state.sel[e.from] || !!this.state.sel[e.to]} />
              </div>
            ))}

            {rest.map(n => this.renderNode(n))}

            {/* snap guides — drawn in BOARD space so they line up with the cards exactly, with the
                stroke divided by zoom so the line stays hairline at any camera */}
            {(this.state.guides || []).map((g, i) => (
              <div key={i} style={{
                ...sx('position:absolute;pointer-events:none;z-index:24'),
                background: 'var(--accent)',
                ...(g.axis === 'x'
                  ? { left: g.at, top: b.y - 400, width: Math.max(1, 1 / v.z), height: b.h + 800 }
                  : { top: g.at, left: b.x - 400, height: Math.max(1, 1 / v.z), width: b.w + 800 }),
              }} />
            ))}

            {gesture && gesture.kind === 'marquee' ? (
              <div style={{
                ...sx('position:absolute;pointer-events:none;border-radius:3px'),
                left: Math.min(gesture.x0, gesture.x1), top: Math.min(gesture.y0, gesture.y1),
                width: Math.abs(gesture.x1 - gesture.x0), height: Math.abs(gesture.y1 - gesture.y0),
                background: 'var(--accent-12)', border: '1px solid var(--accent-60)',
              }} />
            ) : null}
          </div>

          {!doc.nodes.length ? (
            <div data-bg="1" style={sx('position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none')}>
              <Empty size="page" style={sx('max-width:460px')} title="Nothing on the board yet"
                body="Drag a document out of the shelf. Put two that are related next to each other and the relation draws itself, labelled with the field that makes it — you never draw a line here." />
            </div>
          ) : null}

          {/* Hints stay on the canvas rather than in a help modal: this is a surface where nobody
              reads documentation, and these keys are the whole interaction. */}
          <div style={{ ...sx('position:absolute;display:flex;gap:12px;pointer-events:none;flex-wrap:wrap'), left: (shelf ? SHELF_W + 22 : 12), right: 12, bottom: 10 }}>
            {[['space / ⌥ drag', 'pan'], ['⌘ scroll', 'zoom'], ['G', 'tidy'], ['0', 'fit'], ['double-click', 'note']].map(([k, what]) => (
              <span key={k} style={{ ...mono('font-size:9px'), color: 'var(--fg-faint)' }}>
                <span style={{ color: 'var(--fg-muted)' }}>{k}</span> {what}
              </span>
            ))}
          </div>

          {this.renderSelBar()}
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
                ...mono('display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:6px;font-size:9.5px;font-weight:700'),
                color: f.declared ? 'var(--fg-muted)' : 'var(--fg-faint)',
                border: (f.declared ? '1px solid ' : '1px dashed ') + 'var(--border-2)',
              }}>
              {f.field}<span style={{ color: 'var(--fg-faint)' }}>{f.n}</span>
            </span>
          ))}
        </div>
      ) : (
        <span style={{ ...mono('font-size:9.5px;font-weight:500;letter-spacing:.08em'), color: 'var(--fg-faint)' }}>NO RELATIONS TO DRAW YET</span>
      )}
      {onOpenBoard && doc && doc.path ? (
        <Btn variant="secondary" size="sm" style={sx('justify-content:center')} onClick={() => onOpenBoard(doc.path)}>
          Open in the whiteboard
        </Btn>
      ) : (
        <span style={{ ...mono('font-size:9px;letter-spacing:.08em'), color: 'var(--fg-faint)' }}>
          PUT TWO OF THESE ON THE WHITEBOARD AND THE RELATION DRAWS ITSELF
        </span>
      )}
    </div>
  );
}
