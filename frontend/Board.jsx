// The BOARD — a per-project infinite canvas. One tab, one surface, everything a project holds.
//
// ── WHY THIS IS NOT A WHITEBOARD LIBRARY ───────────────────────────────────────────────────────
// Four of the five things this board has to do are domain features no canvas library ships: align
// by scene and shot, toggle between the approved plan and every take, load THIS project's assets
// in one gesture, and be legible enough that an agent can rearrange it. A library would have
// donated pan/zoom — about 250 lines — and taken away the ability to put RenderMedia inside a card,
// because every mature option (tldraw, Excalidraw, Konva, Fabric) paints to <canvas>, where a video
// take is a still frame you decode by hand. tldraw is also licensed, which forecloses it for an app
// that gets sold. So: HTML nodes, CSS transform viewport, and the document lives in markdown.
//
// ── THE ONE INVARIANT ──────────────────────────────────────────────────────────────────────────
// Nothing moves that the user did not move. Auto-align is a BUTTON (backend/board.mjs alignBoard),
// never a render-time derivation, so a card you dragged next to a reference stays there. This is
// the same rule the reel's layDownShots follows and for the same reason: a derived layout cannot
// hold a deliberate placement.
//
// ── SAVE DISCIPLINE ────────────────────────────────────────────────────────────────────────────
// A drag is ONE save, fired on pointerup — not one per mousemove. Node coordinates live in this
// component during a gesture and are flushed once; the camera saves on a longer debounce and never
// writes a log line. A board with 200 nodes therefore costs one ~20KB PATCH per gesture.
import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { MONO } from './tokens';
import { Btn, Empty } from './ui';
import { RenderLightbox, mediaKind } from './RenderMedia';
import { takesForShot, heroTake, isVideoFile } from './shotTakes';
import { buildEntityPool } from './entities';
import { assetKindOf, assetKindDef } from '../shared/assetKinds.mjs';
import { ShotNode, AssetNode, TextNode, NoteNode, FrameNode, LockPip, TEXT_TONES } from './BoardNodes';
import BoardInspector, { INSPECTOR_H } from './BoardInspector';
import {
  GRID, CARD, CAPTION_H, LAYOUTS,
  clampZoom, snap, bounds, fitView, toBoard, arrowGeom, isRect, blankNode,
  alignNodes, distributeNodes, snapGuides
} from './boardLayout';

const SHELF_W = 232;
const HANDLE = 12;                 // resize grip, in SCREEN px — a grip that shrinks with zoom is unusable

// The shelf FLOATS over the canvas rather than sitting in the flex row beside it. As a column it
// permanently narrowed the drawing surface by its own width even when you were not using it, on the
// one surface in the app whose whole value is area. Floating costs the strip of canvas it covers
// and only while it is open.

// Assets dropped or pasted onto the board land in one folder rather than the context root, so the
// board never silently pollutes the References tab with untitled screenshots.
const DROP_FOLDER = 'board';

const isTyping = () => {
  const el = document.activeElement;
  return !!el && (/^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable);
};

export default class Board extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      doc: null,                 // the board document (view, layout, show, nodes, seq)
      sel: {},                   // id → true
      gesture: null,             // { kind, ... } — transient, never persisted
      edit: null,                // node id whose text is being edited
      shelf: 'shots',            // 'shots' | 'assets' | 'refs' | 'library' | null
      folderKinds: {},           // per-folder References/Assets overrides (context/_folders.md)
      q: '',
      busy: '', err: '',
      lightbox: null,
      exported: null,
      inspect: null,              // shot id whose side card is open
      guides: []                  // live snap lines, transient — never persisted
    };
    this.canvas = React.createRef();
    this._key = e => this.onKey(e);
    this._saveT = null;
    this._viewT = null;
    this._space = false;
  }

  componentDidMount() {
    this.load();
    window.addEventListener('keydown', this._key, true);
    window.addEventListener('keyup', this._key, true);
    window.addEventListener('paste', this._paste = e => this.onPaste(e));
    // Re-read on focus. An agent aligning the board through the chat tool, or a second window, is
    // the ordinary case here — not an edge one — and coming back to a stale canvas is how the
    // clobber above starts. Skipped mid-gesture so a drag is never yanked out from under the cursor.
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

  // ── data ─────────────────────────────────────────────────────────────────────────────────────
  async load() {
    try { this.setState({ doc: await api.board(this.props.pid), err: '' }); }
    catch (e) { this.setState({ err: e.message }); }
    // the user's per-folder References/Assets overrides — the same manifest the Assets tab reads,
    // so the shelf's idea of "a production asset" cannot disagree with theirs
    try { const r = await api.folderKinds(this.props.pid); this.setState({ folderKinds: (r && r.kinds) || {} }); }
    catch { /* no manifest yet — the name-based defaults stand */ }
  }
  pdef() { return this.props.pdef || {}; }
  shots() { return (this.props.app.state.shots || []).filter(s => s.proj === this.props.pid); }
  shotById(id) { return this.shots().find(s => s.id === id) || null; }

  // A take's URL. renders/ files are served per project; a take with no file yet (still rendering)
  // has none, and the strip shows its status instead of a broken image.
  takeUrl(t) { return t && t.file ? api.renderUrl(this.props.pid, t.file) : null; }
  assetUrl(n) {
    return n.scope === 'library' ? api.libraryUrl(n.name, n.folder) : api.contextUrl(n.scope, n.name, n.folder);
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
  flush() {
    clearTimeout(this._saveT);
    const doc = this.state.doc;
    if (!doc) return;
    // ONE save in flight at a time. Two overlapping flushes both send the rev the client currently
    // holds, so the second one is stale by construction and 409s against the first — the client
    // racing itself. A second gesture during a save just marks the document dirty; the in-flight
    // response carries the fresh rev and the re-flush rides on it.
    if (this._saving) { this._dirty = true; return; }
    this._saving = true;
    const log = this._pendingLog; this._pendingLog = '';
    // The base rev is what stops this whole-list PATCH from clobbering a newer document. On a
    // 409 the server hands the current one back, so adopting it is a setState, not a refetch — and
    // the user is told, because silently discarding their drag would be the same bug wearing a hat.
    api.patchBoard(this.props.pid, { nodes: doc.nodes }, log, doc.rev)
      .then(saved => this.setState({ doc: { ...saved, nodes: this._dirty ? this.state.doc.nodes : saved.nodes }, err: '' }))
      .catch(e => {
        if (e.status === 409) {
          this.props.app.showToast('The board changed elsewhere — reloaded, your last move was not saved', 'amber');
          this._dirty = false;
          this.load();
          return;
        }
        this.setState({ err: e.message });
        this._dirty = false;
        this.load();
      })
      .finally(() => {
        this._saving = false;
        if (this._dirty) { this._dirty = false; this.flush(); }
      });
  }
  setView(view, immediate) {
    this.setState(s => ({ doc: { ...s.doc, view } }));
    clearTimeout(this._viewT);
    // the camera is not document content — it carries no base stamp and can never conflict, which
    // is why panning while an agent edits does not throw a 409 in your face
    this._viewT = setTimeout(() => api.patchBoard(this.props.pid, { view })
      // adopt the rev the server reports. It no longer moves on a view-only write (see
      // backend/board.mjs `write`), but adopting it costs nothing and means the client can never
      // drift behind for any reason a future change introduces.
      .then(saved => { if (saved && saved.rev != null && !this._saving) this.setState(st => (st.doc ? { doc: { ...st.doc, rev: saved.rev } } : null)); })
      .catch(() => {}), immediate ? 0 : 700);
  }

  // ── coordinates ──────────────────────────────────────────────────────────────────────────────
  view() { return (this.state.doc && this.state.doc.view) || { x: 0, y: 0, z: 1 }; }
  rect() { const el = this.canvas.current; return el ? el.getBoundingClientRect() : { left: 0, top: 0, width: 1200, height: 800 }; }
  pt(e) {
    const r = this.rect();
    return toBoard(e.clientX - r.left, e.clientY - r.top, this.view());
  }

  // ── selection ────────────────────────────────────────────────────────────────────────────────
  selIds() { return Object.keys(this.state.sel).filter(k => this.state.sel[k]); }
  selNodes() { const s = this.state.sel; return (this.state.doc.nodes || []).filter(n => s[n.id]); }
  select(id, additive) {
    this.setState(s => ({ sel: additive ? { ...s.sel, [id]: !s.sel[id] } : { [id]: true } }));
  }

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
      onEnd && onEnd(ev);
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
      ev => {
        const p = this.pt(ev);
        this.setState(s => ({ gesture: { ...s.gesture, x1: p.x, y1: p.y } }));
      },
      () => {
        const g = this.state.gesture;
        if (!g) return;
        const box = { x: Math.min(g.x0, g.x1), y: Math.min(g.y0, g.y1), w: Math.abs(g.x1 - g.x0), h: Math.abs(g.y1 - g.y0) };
        // A click (a marquee smaller than a grid cell) is a deselect, not a zero-area selection.
        if (box.w < 4 && box.h < 4) return;
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
    this.begin(e, { kind: 'pan' },
      ev => this.setView({ ...v, x: v.x + (ev.clientX - x0), y: v.y + (ev.clientY - y0) }));
  }

  onNodeDown(e, node) {
    if (e.button === 1 || this._space || e.altKey) return this.startPan(e);
    if (e.button !== 0) return;
    e.stopPropagation();
    // A locked node still SELECTS — you need to be able to reach its lock pip to unlock it — it
    // just refuses to move.
    if (node.locked) { this.select(node.id, e.shiftKey); return; }
    // Grabbing an unselected node selects it first, so a drag always moves what is under the
    // cursor. Grabbing one that is already part of a multi-selection moves the whole set.
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
        // Shift constrains to one axis — the standard, and the only way to slide a card along a
        // row without drifting a few pixels off it.
        const ax = ev.shiftKey && Math.abs(dx) < Math.abs(dy) ? 0 : dx;
        const ay = ev.shiftKey && Math.abs(dy) <= Math.abs(dx) ? 0 : dy;
        const free = ev.metaKey || ev.ctrlKey;    // ⌘/⌃ suspends every kind of snapping

        // Alignment snapping is computed from the LEAD node (the one under the cursor) and the
        // correction is applied to the whole set, so a multi-selection keeps its internal spacing
        // while still landing flush against a neighbour.
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
              // user aimed at, and re-snapping that to the grid would push it back off by a pixel
              const nx = free ? Math.round(o.x + ax) : (gx ? Math.round(o.x + ax + gx) : snap(o.x + ax));
              const ny = free ? Math.round(o.y + ay) : (gy ? Math.round(o.y + ay + gy) : snap(o.y + ay));
              return { ...n, x: nx, y: ny };
            })
          }
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
    // A shot card is a fixed 16:9 plus its caption strip — resizing it freely would letterbox the
    // take inside its own card. Shots and assets keep aspect; text, notes and frames are free.
    const lock = node.t === 'shot' ? (CARD.w / CARD.h) : node.t === 'asset' ? (w0 / h0) : 0;
    this.begin(e, { kind: 'resize' },
      ev => {
        const p = this.pt(ev);
        let w = Math.max(GRID * 3, snap(w0 + (p.x - p0.x)));
        let h = lock ? Math.round(w / lock) + (node.t === 'shot' ? CAPTION_H : 0) : Math.max(GRID * 2, snap(h0 + (p.y - p0.y)));
        this.setState(s => ({ doc: { ...s.doc, nodes: s.doc.nodes.map(n => (n.id === node.id ? { ...n, w, h } : n)) } }));
      },
      () => this.queueSave('resized a node'));
  }

  onWheel(e) {
    e.preventDefault();
    const v = this.view();
    const r = this.rect();
    if (e.ctrlKey || e.metaKey) {
      // Zoom at the CURSOR, not at the centre — the difference between "I zoomed into that card"
      // and "everything ran away from me".
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
    const cx = r.width / 2, cy = r.height / 2;
    this.setView({ z, x: cx - (cx - v.x) * (z / v.z), y: cy - (cy - v.y) * (z / v.z) }, true);
  }
  fit() {
    const r = this.rect();
    const nodes = this.state.doc ? this.state.doc.nodes : [];
    if (!nodes.length) return;
    this.setView(fitView(nodes, r.width, r.height), true);
  }

  // ── keyboard ─────────────────────────────────────────────────────────────────────────────────
  // Capture phase, and every key this surface consumes calls stopPropagation(). App.jsx binds its
  // globals on the BUBBLE phase precisely so a focused surface can claim a letter first — the same
  // contract Story.jsx and ProjectGenerate.jsx already use. Without the stop, `f` opened the
  // feedback panel *and* toggled full screen, and `g` jumped to the Generate tab mid-align.
  onKey(e) {
    if (e.type === 'keyup') { if (e.key === ' ') this._space = false; return; }
    if (isTyping()) return;
    const k = e.key;
    const mine = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === ' ') { this._space = true; e.preventDefault(); e.stopPropagation(); return; }  // hold to pan
    if (k === 'Escape') {
      e.stopPropagation();
      // peel one layer at a time — Escape out of a full-screen canvas straight to nothing selected
      // loses two states at once and feels like the app dropped your place
      if (this.state.lightbox) return this.setState({ lightbox: null });
      if (this.state.inspect) return this.setState({ inspect: null });
      if (this.props.app.state.boardFull) return this.props.app.setState({ boardFull: false });
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
    else if (k === 'f') { mine(); this.props.app.setState(st => ({ boardFull: !st.boardFull })); }
    else if (k === 'v') { mine(); this.toggleShow(); }
    else if (k === 'g') { mine(); this.align(this.state.doc ? this.state.doc.layout : 'scene-grid'); }
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
  async add(spec, log) {
    try {
      const { board } = await api.addBoardNodes(this.props.pid, [spec], log);
      this.setState({ doc: board });
      return board.nodes[board.nodes.length - 1];
    } catch (e) { this.setState({ err: e.message }); return null; }
  }
  // Place at the centre of what the user is currently looking at — never at board origin, which on
  // a panned canvas means "somewhere off screen".
  centre() {
    const r = this.rect(); const v = this.view();
    return toBoard(r.width / 2, r.height / 2, v);
  }
  addAt(t, patch, log) {
    const c = this.centre();
    const b = blankNode(t, patch, () => 'tmp');
    return this.add({ ...patch, t, x: snap(c.x - (b.w || 200) / 2), y: snap(c.y - (b.h || 100) / 2) }, log);
  }
  async removeSelected() {
    const ids = this.selIds();
    if (!ids.length) return;
    try {
      const board = await api.deleteBoardNodes(this.props.pid, ids);
      this.setState({ doc: board, sel: {} });
    } catch (e) { this.setState({ err: e.message }); }
  }
  async duplicateSelected() {
    const copies = this.selNodes().filter(isRect).map(n => {
      const { id, ...rest } = n;
      return { ...rest, x: n.x + GRID * 2, y: n.y + GRID * 2 };
    });
    if (!copies.length) return;
    try {
      const { board, added } = await api.addBoardNodes(this.props.pid, copies, 'duplicated ' + copies.length);
      this.setState({ doc: board, sel: Object.fromEntries(added.map(n => [n.id, true])) });
    } catch (e) { this.setState({ err: e.message }); }
  }

  async align(layout) {
    this.setState({ busy: 'align' });
    try {
      const board = await api.alignBoard(this.props.pid, layout);
      this.setState({ doc: board, busy: '', sel: {} });
      // Framing the result is part of the gesture: an align that leaves you looking at empty board
      // reads as nothing having happened.
      setTimeout(() => this.fit(), 30);
      this.props.app.showToast('Aligned · ' + (LAYOUTS.find(l => l.id === layout) || {}).label, 'green');
    } catch (e) { this.setState({ err: e.message, busy: '' }); }
  }
  async toggleShow() {
    const next = this.state.doc.show === 'all' ? 'selected' : 'all';
    this.setState(s => ({ doc: { ...s.doc, show: next } }));
    try { await api.setBoardShow(this.props.pid, next); } catch (e) { this.setState({ err: e.message }); }
  }
  async syncShots() {
    this.setState({ busy: 'sync' });
    try {
      const { board, added } = await api.syncBoardShots(this.props.pid);
      this.setState({ doc: board, busy: '' });
      this.props.app.showToast(added.length ? 'Pulled in ' + added.length + ' shot' + (added.length === 1 ? '' : 's') : 'Every shot is already on the board', added.length ? 'green' : 'amber');
      if (added.length) setTimeout(() => this.fit(), 30);
    } catch (e) { this.setState({ err: e.message, busy: '' }); }
  }
  async syncAssets() {
    this.setState({ busy: 'assets' });
    try {
      const { board, added } = await api.syncBoardAssets(this.props.pid);
      this.setState({ doc: board, busy: '' });
      this.props.app.showToast(
        added.length
          ? 'Pulled in ' + added.length + ' asset' + (added.length === 1 ? '' : 's')
          : 'No new production assets — cast, locations, wardrobe and props are already on the board',
        added.length ? 'green' : 'amber');
      if (added.length) setTimeout(() => this.fit(), 30);
    } catch (e) { this.setState({ err: e.message, busy: '' }); }
  }
  async exportPng() {
    this.setState({ busy: 'export' });
    try {
      const r = await api.exportBoard(this.props.pid, { width: 2600 });
      this.setState({ busy: '', exported: r });
      this.props.app.showToast('Board exported · ' + r.width + '×' + r.height, 'green');
    } catch (e) { this.setState({ err: e.message, busy: '' }); }
  }

  // Clicking a take in the filmstrip SETS it. The board is a decision surface: a version toggle
  // that only displays would make you leave the board to act on what it just showed you.
  async pickTake(shot, take) {
    try {
      await api.patchShot(this.props.pid, shot.id, { selectedCandidate: take.id, selectedAt: Date.now() }, 'selected ' + take.id + ' from the board');
      this.props.app.sync && this.props.app.sync();
      this.props.app.showToast('Take selected · ' + (shot.title || shot.id), 'green');
    } catch (e) { this.setState({ err: e.message }); }
  }

  // ── bringing assets in ───────────────────────────────────────────────────────────────────────
  // Four ways, all landing at the point you gestured at: drop a file, paste an image, drag from the
  // shelf, or click a shelf row. "Load in assets very quick" is the whole point of the surface, so
  // none of them opens a dialog.
  async onDrop(e) {
    e.preventDefault();
    const at = this.pt(e);
    const raw = e.dataTransfer.getData('application/x-frameforge-node');
    if (raw) {
      try {
        const spec = JSON.parse(raw);
        await this.add({ ...spec, x: snap(at.x), y: snap(at.y) }, 'dropped a ' + spec.t);
        return;
      } catch { /* fall through to files */ }
    }
    const files = [...(e.dataTransfer.files || [])];
    if (!files.length) return;
    this.setState({ busy: 'upload' });
    let i = 0;
    for (const f of files) {
      try {
        const r = await api.uploadContext(this.props.pid, f, DROP_FOLDER);
        await this.add({
          t: 'asset', scope: this.props.pid, folder: DROP_FOLDER, name: (r && r.name) || f.name,
          x: snap(at.x + (i % 4) * (CARD.w + 24)), y: snap(at.y + Math.floor(i / 4) * (CARD.h + 24))
        }, 'dropped ' + f.name);
        i++;
      } catch (err) { this.setState({ err: err.message }); }
    }
    this.setState({ busy: '' });
    this.props.app.sync && this.props.app.sync();
  }

  async onPaste(e) {
    if (isTyping() || !this.state.doc) return;
    const items = [...((e.clipboardData && e.clipboardData.items) || [])];
    const img = items.find(i => i.type && i.type.startsWith('image/'));
    if (img) {
      const file = img.getAsFile();
      if (!file) return;
      e.preventDefault();
      this.setState({ busy: 'upload' });
      try {
        // A pasted screenshot has no name; stamping one keeps the context folder browsable.
        const named = new File([file], 'paste-' + Date.now() + '.' + (file.type.split('/')[1] || 'png'), { type: file.type });
        const r = await api.uploadContext(this.props.pid, named, DROP_FOLDER);
        const c = this.centre();
        await this.add({ t: 'asset', scope: this.props.pid, folder: DROP_FOLDER, name: (r && r.name) || named.name, x: snap(c.x), y: snap(c.y) }, 'pasted an image');
        this.props.app.sync && this.props.app.sync();
      } catch (err) { this.setState({ err: err.message }); }
      this.setState({ busy: '' });
      return;
    }
    const text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (text && text.trim()) {
      e.preventDefault();
      const c = this.centre();
      this.add({ t: 'note', text: text.trim().slice(0, 4000), x: snap(c.x), y: snap(c.y) }, 'pasted a note');
    }
  }

  // ── render: the shelf ────────────────────────────────────────────────────────────────────────
  shelfRows() {
    const { q, shelf } = this.state;
    const needle = q.trim().toLowerCase();
    const match = s => !needle || s.toLowerCase().includes(needle);
    if (shelf === 'shots') {
      const on = new Set((this.state.doc.nodes || []).filter(n => n.t === 'shot').map(n => n.shot));
      return this.shots().filter(s => match((s.title || '') + ' ' + s.id))
        .map(s => {
          const hero = heroTake(this.pdef(), s);
          return {
            key: s.id, label: s.title || s.id,
            sub: [s.scene ? 'sc ' + s.scene : '', s.type, s.status].filter(Boolean).join(' · '),
            url: this.takeUrl(hero), video: hero && hero.video, dim: on.has(s.id),
            spec: { t: 'shot', shot: s.id }
          };
        });
    }
    const src = shelf === 'library'
      ? ((this.props.app.state.library || {}).items || []).map(c => ({ ...c, scope: 'library' }))
      : (((this.pdef().context || {}).items) || []).map(c => ({ ...c, scope: this.props.pid }));

    // ASSETS and REFS are not the same material and must not share a list. Everything that is not
    // in a production folder — the moodboard, the references board, and anything dropped at the
    // context root (which is where a mood import lands) — is a REFERENCE. Mixing them buried the
    // cast under twenty frames of scraped mood the moment a project had any.
    const ov = this.state.folderKinds || {};
    const isProduction = c => c.scope !== 'library' && !!assetKindOf(c.folder, ov);

    return src
      .filter(c => (c.type === 'image' || c.type === 'video') && match(c.name + ' ' + (c.folder || '')))
      .filter(c => (shelf === 'assets' ? isProduction(c) : shelf === 'refs' ? !isProduction(c) : true))
      .slice(0, 200)
      .map(c => {
        const kind = c.scope === 'library' ? '' : assetKindOf(c.folder, ov);
        return {
          key: (c.folder || '') + '/' + c.name, label: c.name,
          // the KIND leads when there is one — "Cast" is what the card is, the folder is just where
          // it happens to sit — and a root-level reference reads as "unfiled", never as a blank dash
          sub: kind ? ((assetKindDef(kind) || {}).label || kind) : (c.folder || 'unfiled'),
          url: c.scope === 'library' ? api.libraryUrl(c.name, c.folder) : api.contextUrl(c.scope, c.name, c.folder),
          video: c.type === 'video',
          spec: { t: 'asset', scope: c.scope, folder: c.folder || '', name: c.name, kind }
        };
      });
  }

  renderShelf() {
    const { shelf, q } = this.state;
    const rows = this.state.doc ? this.shelfRows() : [];
    return (
      <div onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}
        style={{
          ...sx('position:absolute;top:10px;left:10px;bottom:10px;display:flex;flex-direction:column;border-radius:12px;overflow:hidden;z-index:20'),
          width: SHELF_W,
          // glass, so the canvas underneath stays legible and the panel reads as floating chrome
          // rather than as a second page region
          background: 'color-mix(in srgb, var(--surface) 88%, transparent)',
          backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
          border: '1px solid var(--border-2)', boxShadow: '0 18px 44px rgba(0,0,0,.5)'
        }}>
        <div style={sx('flex:none;display:flex;border-bottom:1px solid var(--border)')}>
          {[['shots', 'Shots'], ['assets', 'Assets'], ['refs', 'Refs'], ['library', 'Library']].map(([id, label]) => (
            <div key={id} onClick={() => this.setState({ shelf: id })} className={shelf === id ? '' : 'hFg'}
              title={id === 'assets' ? 'cast · locations · wardrobe · props' : id === 'refs' ? 'moodboards, references and anything unfiled' : undefined}
              style={{ ...sx('flex:1;text-align:center;padding:9px 0;font-size:10.5px;font-weight:600;cursor:pointer'), color: shelf === id ? 'var(--fg)' : 'var(--fg-faint)', boxShadow: shelf === id ? 'inset 0 -2px 0 var(--accent)' : 'none' }}>
              {label}
            </div>
          ))}
        </div>
        <div style={sx('flex:none;padding:8px 10px;border-bottom:1px solid var(--line)')}>
          <input value={q} onChange={e => this.setState({ q: e.target.value })} placeholder="Filter…"
            style={{ ...sx('width:100%;box-sizing:border-box;border-radius:6px;padding:5px 8px;outline:none;font-size:11px'), background: 'var(--sunk)', border: '1px solid var(--border-2)', color: 'var(--fg)' }} />
        </div>
        <div style={sx('flex:1;overflow-y:auto;padding:8px')}>
          {!rows.length && (
            <div style={sx('padding:18px 6px;font-size:11px;color:var(--fg-faint);line-height:1.6')}>
              {shelf === 'assets'
                ? 'No production assets yet. Cast, Locations, Wardrobe and Props folders show up here — moodboards and references live under Refs.'
                : 'Nothing here yet. Drop files straight onto the canvas — they upload and land where you drop them.'}
            </div>
          )}
          {rows.map(r => (
            <div key={r.key} draggable
              onDragStart={e => { e.dataTransfer.setData('application/x-frameforge-node', JSON.stringify(r.spec)); e.dataTransfer.effectAllowed = 'copy'; }}
              onDoubleClick={() => this.addAt(r.spec.t, r.spec, 'added from the shelf')}
              title={r.dim ? 'already on the board — drag to add another card' : 'drag onto the board, or double-click to place'}
              className="hBg"
              style={{ ...sx('display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:7px;cursor:grab;margin-bottom:2px'), opacity: r.dim ? 0.45 : 1 }}>
              <div style={{ ...sx('flex:none;width:44px;height:26px;border-radius:4px;overflow:hidden;background:var(--sunk)'), border: '1px solid var(--border)' }}>
                {r.url && <img src={r.url} alt="" style={sx('width:100%;height:100%;object-fit:cover;display:block')} />}
              </div>
              <div style={sx('flex:1;min-width:0')}>
                <div style={sx('font-size:11px;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{r.label}</div>
                <div style={{ fontFamily: MONO, fontSize: 8.5, color: 'var(--fg-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── render: the toolbar ──────────────────────────────────────────────────────────────────────
  renderBar() {
    const { doc, busy, shelf } = this.state;
    const all = doc.show === 'all';
    const full = !!this.props.app.state.boardFull;
    const pill = (label, on, onClick, title) => (
      <div key={label} onClick={onClick} title={title} className={on ? '' : 'hBd'}
        style={{ ...sx('padding:4px 10px;border-radius:7px;cursor:pointer;font-size:11px;font-weight:600;white-space:nowrap'), color: on ? 'var(--on-accent)' : 'var(--fg-soft)', background: on ? 'var(--accent)' : 'transparent', border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border-2)') }}>
        {label}
      </div>
    );
    return (
      <div style={sx('flex:none;display:flex;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid var(--border);flex-wrap:wrap;background:var(--surface)')}>
        <div onClick={() => this.setState({ shelf: shelf ? null : 'shots' })} className="hBd" title="toggle the shelf"
          style={{ ...sx('padding:4px 9px;border-radius:7px;cursor:pointer;font-size:11px;font-weight:600'), color: 'var(--fg-soft)', border: '1px solid var(--border-2)' }}>☰</div>

        <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)', letterSpacing: '.1em', marginLeft: 4 }}>ALIGN</span>
        {LAYOUTS.map(l => pill(l.label, doc.layout === l.id && busy !== 'align', () => this.align(l.id), l.hint))}

        <div style={sx('width:1px;height:18px;background:var(--border-2);margin:0 4px')} />

        {/* THE version toggle. Named for what it means to a director — the plan versus the takes —
            rather than for the field it flips. */}
        <div onClick={() => this.toggleShow()} title="V — switch between the approved plan and every take"
          style={{ ...sx('display:flex;border-radius:7px;overflow:hidden;cursor:pointer'), border: '1px solid ' + (all ? 'var(--marked)' : 'var(--border-2)') }}>
          {[['Selected plan', !all], ['All takes', all]].map(([label, on]) => (
            <span key={label} style={{ ...sx('padding:4px 10px;font-size:11px;font-weight:600;white-space:nowrap'), background: on ? (all ? 'var(--marked)' : 'var(--raise)') : 'transparent', color: on ? (all ? 'var(--on-accent)' : 'var(--fg)') : 'var(--fg-faint)' }}>{label}</span>
          ))}
        </div>

        <div style={sx('width:1px;height:18px;background:var(--border-2);margin:0 4px')} />

        {pill('+ Text', false, () => this.addAt('text', { text: '' }, 'added a heading'), 'a heading')}
        {pill('+ Note', false, () => this.addAt('note', { text: '' }, 'added a note'), 'a sticky note')}
        {pill('+ Frame', false, () => this.addAt('frame', { label: 'GROUP' }, 'added a frame'), 'a titled group')}
        {pill('+ Arrow', false, () => this.addArrow(), 'connect the two selected nodes')}

        <div style={sx('flex:1')} />

        {this.state.err && <span style={{ fontSize: 10.5, color: 'var(--danger)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={this.state.err}>{this.state.err}</span>}
        {busy && <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--accent)', animation: 'dl-pulse 1.1s infinite' }}>{busy.toUpperCase()}…</span>}

        <Btn variant="ghost" size="sm" onClick={() => this.syncShots()} title="put every shot on the board without moving anything">+ Shots</Btn>
        <Btn variant="ghost" size="sm" onClick={() => this.syncAssets()} title="put the project's cast, locations, wardrobe and props on the board">+ Assets</Btn>
        <Btn variant="ghost" size="sm" onClick={() => this.exportPng()} title="flatten the board to a PNG in the project's export folder">Export</Btn>

        <div onClick={() => this.props.app.setState(st => ({ boardFull: !st.boardFull }))} className="hBd"
          title={full ? 'F — leave full screen' : 'F — full screen, hide everything but the canvas'}
          style={{ ...sx('padding:4px 9px;border-radius:7px;cursor:pointer;font-size:11px;font-weight:600'), color: full ? 'var(--on-accent)' : 'var(--fg-soft)', background: full ? 'var(--accent)' : 'transparent', border: '1px solid ' + (full ? 'var(--accent)' : 'var(--border-2)') }}>
          {full ? '⤡ Exit' : '⤢ Full screen'}
        </div>

        <div style={sx('display:flex;align-items:center;gap:2px')}>
          <div onClick={() => this.zoomBy(0.8)} className="hBd" style={{ ...sx('width:24px;text-align:center;padding:3px 0;border-radius:6px;cursor:pointer;font-size:13px'), color: 'var(--fg-soft)', border: '1px solid var(--border-2)' }}>−</div>
          <div onClick={() => this.fit()} className="hBd" title="0 — fit everything"
            style={{ ...sx('padding:3px 8px;border-radius:6px;cursor:pointer'), fontFamily: MONO, fontSize: 10, color: 'var(--fg-soft)', border: '1px solid var(--border-2)' }}>{Math.round(this.view().z * 100)}%</div>
          <div onClick={() => this.zoomBy(1.25)} className="hBd" style={{ ...sx('width:24px;text-align:center;padding:3px 0;border-radius:6px;cursor:pointer;font-size:13px'), color: 'var(--fg-soft)', border: '1px solid var(--border-2)' }}>+</div>
        </div>
      </div>
    );
  }

  // Arrows connect the two SELECTED nodes rather than being drawn by dragging. Deliberate: a drag
  // gesture for arrows means every empty-canvas drag has to first decide whether it is a marquee,
  // and that ambiguity is the single most annoying thing about node editors.
  addArrow() {
    const ids = this.selNodes().filter(isRect).map(n => n.id);
    if (ids.length !== 2) {
      this.props.app.showToast('Select exactly two cards, then press + Arrow', 'amber');
      return;
    }
    this.add({ t: 'arrow', from: ids[0], to: ids[1] }, 'connected two nodes');
  }

  // ── the selection toolbar ────────────────────────────────────────────────────────────────────
  // A floating context bar above the selection, carrying the verbs for whatever is selected. Every
  // canvas tool worth copying has one (Figma, Excalidraw, tldraw) and the reason is the same in all
  // of them: a canvas has no room for a permanent inspector, and putting a text size or a note
  // colour in a global toolbar means it is greyed out most of the time.
  patchSel(patch, log) {
    const ids = this.selIds();
    this.setNodes(this.state.doc.nodes.map(n => (this.state.sel[n.id] ? { ...n, ...patch } : n)), log);
  }
  reorderSel(toFront) {
    // z-order IS array order in this document, so "bring to front" is a splice, not a field to
    // reconcile across every reader.
    const sel = this.state.sel;
    const picked = this.state.doc.nodes.filter(n => sel[n.id]);
    const rest = this.state.doc.nodes.filter(n => !sel[n.id]);
    this.setNodes(toFront ? [...rest, ...picked] : [...picked, ...rest], toFront ? 'brought to front' : 'sent to back');
  }
  doAlign(edge) { this.setNodes(alignNodes(this.state.doc.nodes, this.selIds(), edge), 'aligned ' + edge); }
  doDistribute(axis) { this.setNodes(distributeNodes(this.state.doc.nodes, this.selIds(), axis), 'distributed'); }

  renderSelBar() {
    const nodes = this.selNodes().filter(isRect);
    if (!nodes.length || this.state.gesture || this.state.edit) return null;
    const v = this.view();
    const b = bounds(nodes);
    const one = nodes.length === 1 ? nodes[0] : null;
    const kinds = new Set(nodes.map(n => n.t));
    const locked = nodes.every(n => n.locked);

    // Positioned in SCREEN space above the selection, clamped into the viewport so a bar for a card
    // near the top edge does not render off screen where you cannot reach it.
    const r = this.rect();
    const left = Math.min(Math.max(12, b.x * v.z + v.x + (b.w * v.z) / 2), r.width - 12);
    const top = Math.max(8, b.y * v.z + v.y - 46);

    const btn = (label, onClick, on, title) => (
      <span key={label + title} onClick={e => { e.stopPropagation(); onClick(); }} title={title} className={on ? '' : 'hBg'}
        style={{
          ...sx('display:flex;align-items:center;justify-content:center;min-width:24px;height:24px;padding:0 6px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600'),
          background: on ? 'var(--accent)' : 'transparent', color: on ? 'var(--on-accent)' : 'var(--fg-soft)'
        }}>{label}</span>
    );
    const sep = k => <span key={'s' + k} style={sx('width:1px;height:16px;background:var(--border-2);margin:0 3px')} />;
    const swatch = (tone, colour, on, onClick) => (
      <span key={tone} onClick={e => { e.stopPropagation(); onClick(); }} title={tone}
        style={{ ...sx('width:15px;height:15px;border-radius:4px;cursor:pointer;flex:none'), background: colour, border: '2px solid ' + (on ? 'var(--fg)' : 'transparent'), boxShadow: on ? '0 0 0 1px var(--fg)' : 'none' }} />
    );

    const bits = [];
    if (one && one.t === 'text') {
      bits.push(...['sm', 'md', 'lg', 'xl'].map(sz => btn(sz.toUpperCase(), () => this.patchSel({ size: sz }, 'text size'), one.size === sz, 'size ' + sz)));
      bits.push(sep(1));
      bits.push(...[['left', '⇤'], ['center', '↔'], ['right', '⇥']].map(([a, g]) => btn(g, () => this.patchSel({ align: a }, 'text align'), (one.align || 'left') === a, 'align ' + a)));
      bits.push(sep(2));
      bits.push(<span key="tones" style={sx('display:flex;gap:4px;align-items:center')}>
        {Object.entries(TEXT_TONES).map(([t, c]) => swatch(t, c, (one.tone || 'fg') === t, () => this.patchSel({ tone: t }, 'text colour')))}
      </span>);
      bits.push(sep(3));
    }
    if (one && one.t === 'note') {
      bits.push(<span key="tones" style={sx('display:flex;gap:4px;align-items:center')}>
        {[['accent', 'var(--accent)'], ['ok', 'var(--ok)'], ['warn', 'var(--warn)'], ['danger', 'var(--danger)'], ['neutral', 'var(--border-3)']]
          .map(([t, c]) => swatch(t, c, (one.tone || 'accent') === t, () => this.patchSel({ tone: t }, 'note colour')))}
      </span>);
      bits.push(sep(1));
    }
    if (nodes.length > 1) {
      bits.push(...[['left', '⇤'], ['hcenter', '⇹'], ['right', '⇥'], ['top', '⇞'], ['vcenter', '⇕'], ['bottom', '⇟']]
        .map(([e, g]) => btn(g, () => this.doAlign(e), false, 'align ' + e)));
      if (nodes.length > 2) {
        bits.push(sep(4));
        bits.push(btn('⇹≡', () => this.doDistribute('h'), false, 'distribute horizontally'));
        bits.push(btn('⇕≡', () => this.doDistribute('v'), false, 'distribute vertically'));
      }
      bits.push(sep(5));
    }
    bits.push(btn('⤒', () => this.reorderSel(true), false, 'bring to front'));
    bits.push(btn('⤓', () => this.reorderSel(false), false, 'send to back'));
    bits.push(btn(locked ? '🔒' : '🔓', () => this.patchSel({ locked: !locked }, locked ? 'unlocked' : 'locked'), locked, locked ? 'unlock' : 'lock in place'));
    bits.push(sep(6));
    if (kinds.has('shot') && nodes.length === 1) {
      bits.push(btn('Open', () => this.setState({ inspect: nodes[0].shot }), false, 'open the shot inspector'));
    }
    bits.push(btn('⧉', () => this.duplicateSelected(), false, '⌘D — duplicate'));
    bits.push(<span key="del" onClick={e => { e.stopPropagation(); this.removeSelected(); }} className="hBgRed" title="⌫ — delete"
      style={sx('display:flex;align-items:center;justify-content:center;min-width:24px;height:24px;border-radius:6px;cursor:pointer;font-size:11px;color:var(--danger)')}>✕</span>);

    return (
      <div onPointerDown={e => e.stopPropagation()}
        style={{
          ...sx('position:absolute;display:flex;align-items:center;gap:2px;padding:4px 6px;border-radius:9px;z-index:25'),
          left, top, transform: 'translateX(-50%)',
          background: 'color-mix(in srgb, var(--surface-2) 94%, transparent)',
          backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
          border: '1px solid var(--border-2)', boxShadow: '0 10px 30px rgba(0,0,0,.5)',
          maxWidth: 'calc(100% - 24px)', flexWrap: 'wrap'
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
    const setText = v => this.setState(s => ({ doc: { ...s.doc, nodes: s.doc.nodes.map(x => (x.id === n.id ? { ...x, text: v } : x)) } }));
    const setLabel = v => this.setState(s => ({ doc: { ...s.doc, nodes: s.doc.nodes.map(x => (x.id === n.id ? { ...x, label: v } : x)) } }));
    const commit = () => { this.setState({ edit: null }); this.queueSave('edited text'); };

    let body = null;
    if (n.t === 'shot') {
      const shot = this.shotById(n.shot);
      const takes = shot ? takesForShot(this.pdef(), shot).map(t => ({ ...t, url: this.takeUrl(t) })) : [];
      const hero = shot ? heroTake(this.pdef(), shot) : null;
      body = <ShotNode node={n} shot={shot} takes={takes} showAll={doc.show === 'all'} selected={on}
        hero={hero ? { ...hero, url: this.takeUrl(hero) } : null}
        onOpen={s => this.setState({ inspect: s.id, sel: { [n.id]: true } })}
        onPickTake={(s, t) => this.pickTake(s, t)} />;
    } else if (n.t === 'asset') {
      const url = this.assetUrl(n);
      body = <AssetNode node={n} url={url} kind={mediaKind ? mediaKind(n.name) : (isVideoFile(n.name) ? 'video' : 'image')} selected={on}
        onOpen={() => this.setState({ lightbox: { url, kind: isVideoFile(n.name) ? 'video' : 'image', name: n.name } })} />;
    } else if (n.t === 'text') {
      body = <TextNode node={n} selected={on} editing={editing} onEdit={() => this.setState({ edit: n.id })} onChange={setText} onCommit={commit} />;
    } else if (n.t === 'note') {
      body = <NoteNode node={n} selected={on} editing={editing} onEdit={() => this.setState({ edit: n.id })} onChange={setText} onCommit={commit} />;
    } else if (n.t === 'frame') {
      body = <FrameNode node={n} selected={on} editing={editing} onEdit={() => this.setState({ edit: n.id })} onChange={setLabel} onCommit={commit}
        onGrab={e => this.onNodeDown(e, n)} />;
    }

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
          cursor: this.state.gesture ? 'grabbing' : 'grab'
        }}>
        {body}
        {on && !editing && n.t !== 'frame' && <LockPip locked={!!n.locked} onToggle={() => this.setNodes(this.state.doc.nodes.map(x => (x.id === n.id ? { ...x, locked: !x.locked } : x)), n.locked ? 'unlocked a node' : 'locked a node')} />}
        {on && !editing && !n.locked && (
          // The grip is sized in SCREEN pixels — divided by zoom so it stays the same physical size
          // whatever the camera is doing. A grip that shrinks to two pixels at 20% is not a grip.
          <div onPointerDown={e => this.startResize(e, n)}
            style={{
              ...sx('position:absolute;border-radius:3px;z-index:5'),
              width: HANDLE / this.view().z, height: HANDLE / this.view().z,
              right: -(HANDLE / this.view().z) / 2, bottom: -(HANDLE / this.view().z) / 2,
              background: 'var(--accent)', border: '1px solid var(--on-accent)',
              cursor: 'nwse-resize', pointerEvents: 'auto'
            }} />
        )}
      </div>
    );
  }

  render() {
    const { doc, gesture, lightbox, shelf } = this.state;
    if (!doc) {
      return <div style={sx('flex:1;display:flex;align-items:center;justify-content:center;color:var(--fg-faint);font-size:12px')}>Loading the board…</div>;
    }
    const v = this.view();
    const byId = Object.fromEntries(doc.nodes.map(n => [n.id, n]));
    // Array order IS z-order, and frames render first so they sit behind their contents. That is
    // why "send to back" on this board is a splice rather than a z field to keep reconciled.
    const frames = doc.nodes.filter(n => n.t === 'frame');
    const arrows = doc.nodes.filter(n => n.t === 'arrow');
    const rest = doc.nodes.filter(n => n.t !== 'frame' && n.t !== 'arrow');
    const b = bounds(doc.nodes);

    const inspected = this.state.inspect ? this.shotById(this.state.inspect) : null;

    return (
      <div style={sx('flex:1;display:flex;min-height:0;overflow:hidden')}>
        <div style={sx('flex:1;display:flex;flex-direction:column;min-width:0;position:relative')}>
          {this.renderBar()}
          <div ref={this.canvas}
            onPointerDown={e => this.onBackgroundDown(e)}
            onWheel={e => this.onWheel(e)}
            onDoubleClick={e => {
              if (e.target !== this.canvas.current && !e.target.dataset.bg) return;
              const p = this.pt(e);
              this.add({ t: 'text', text: '', x: snap(p.x), y: snap(p.y) }, 'added a heading')
                .then(n => n && this.setState({ edit: n.id, sel: { [n.id]: true } }));
            }}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
            onDrop={e => this.onDrop(e)}
            style={{
              ...sx('flex:1;position:relative;overflow:hidden;min-height:0'),
              background: 'var(--ink)',
              // The lattice is drawn in the SAME unit the layouts snap to, so a hand-placed card
              // and an auto-aligned one visibly land on the same grid.
              backgroundImage: 'radial-gradient(circle, var(--border) 1px, transparent 1px)',
              backgroundSize: (GRID * v.z) + 'px ' + (GRID * v.z) + 'px',
              backgroundPosition: v.x + 'px ' + v.y + 'px',
              cursor: gesture && gesture.kind === 'pan' ? 'grabbing' : 'default',
              touchAction: 'none'
            }}>
            <div style={{
              ...sx('position:absolute;top:0;left:0;width:0;height:0'),
              transform: 'translate(' + v.x + 'px,' + v.y + 'px) scale(' + v.z + ')',
              transformOrigin: '0 0'
            }}>
              {frames.map(n => this.renderNode(n))}

              {/* Connectors ride in one SVG sized to the content bounds. One <svg> for every arrow,
                  not one per arrow: N absolutely-positioned SVGs is N composited layers. */}
              {arrows.length > 0 && (
                <svg style={{ position: 'absolute', left: b.x - 400, top: b.y - 400, width: b.w + 800, height: b.h + 800, pointerEvents: 'none', overflow: 'visible' }}>
                  <defs>
                    <marker id="bd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--border-3)" />
                    </marker>
                  </defs>
                  <g transform={'translate(' + (-(b.x - 400)) + ',' + (-(b.y - 400)) + ')'}>
                    {arrows.map(a => {
                      const g = arrowGeom(a, byId);
                      const on = !!this.state.sel[a.id];
                      return (
                        <g key={a.id}>
                          {/* a fat invisible stroke is the hit target — a 2px curve is unclickable */}
                          <path d={g.path} stroke="transparent" strokeWidth={16} fill="none" style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                            onPointerDown={e => { e.stopPropagation(); this.select(a.id, e.shiftKey); }} />
                          <path d={g.path} stroke={on ? 'var(--accent)' : 'var(--border-3)'} strokeWidth={on ? 2.5 : 1.75} fill="none" markerEnd="url(#bd-arrow)" />
                        </g>
                      );
                    })}
                  </g>
                </svg>
              )}

              {rest.map(n => this.renderNode(n))}

              {/* snap guides — drawn in BOARD space so they line up with the cards exactly, with the
                  stroke divided by zoom so the line stays hairline at any camera */}
              {(this.state.guides || []).map((g, i) => (
                <div key={i} style={{
                  ...sx('position:absolute;pointer-events:none;z-index:24'),
                  background: 'var(--accent)',
                  ...(g.axis === 'x'
                    ? { left: g.at, top: b.y - 400, width: Math.max(1, 1 / v.z), height: b.h + 800 }
                    : { top: g.at, left: b.x - 400, height: Math.max(1, 1 / v.z), width: b.w + 800 })
                }} />
              ))}

              {gesture && gesture.kind === 'marquee' && (
                <div style={{
                  ...sx('position:absolute;pointer-events:none;border-radius:3px'),
                  left: Math.min(gesture.x0, gesture.x1), top: Math.min(gesture.y0, gesture.y1),
                  width: Math.abs(gesture.x1 - gesture.x0), height: Math.abs(gesture.y1 - gesture.y0),
                  background: 'var(--accent-12)', border: '1px solid var(--accent-60)'
                }} />
              )}
            </div>

            {!doc.nodes.length && (
              <div data-bg="1" style={sx('position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none')}>
                <Empty size="page" title="Nothing on the board yet"
                  body="Pull in your shots and hit an align, or just drop files straight onto the canvas — they upload where you drop them. Double-click anywhere to write." />
              </div>
            )}

            {/* Hints stay on the canvas rather than in a help modal: this is a surface where
                nobody reads documentation, and the four keys below are the whole interaction. */}
            <div style={{ ...sx('position:absolute;display:flex;gap:12px;pointer-events:none'), left: (shelf ? SHELF_W + 22 : 12), right: 12, bottom: inspected ? INSPECTOR_H + 26 : 10, flexWrap: 'wrap' }}>
              {[['space / ⌥ drag', 'pan'], ['⌘ scroll', 'zoom'], ['V', 'plan ↔ takes'], ['G', 'align'], ['F', 'full screen'], ['0', 'fit']].map(([k, what]) => (
                <span key={k} style={{ fontFamily: MONO, fontSize: 9, color: 'var(--fg-faint)' }}>
                  <span style={{ color: 'var(--fg-muted)' }}>{k}</span> {what}
                </span>
              ))}
            </div>

            {this.renderSelBar()}

            {shelf && this.renderShelf()}

            {inspected && (
              <BoardInspector app={this.props.app} pid={this.props.pid} pdef={this.pdef()} shot={inspected}
                // THE resolver for "what can @ tag" — never a pool built or re-sorted here
                entities={buildEntityPool(this.props.app, this.props.pid)}
                onClose={() => this.setState({ inspect: null })}
                onPickTake={(sh, t) => this.pickTake(sh, t)} />
            )}

            {this.state.exported && (
              <div style={{ ...sx('position:absolute;display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;z-index:31'), right: 12, bottom: (inspected ? INSPECTOR_H + 26 : 12), background: 'var(--surface-2)', border: '1px solid var(--border-2)' }}>
                <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-muted)' }}>{this.state.exported.width}×{this.state.exported.height}</span>
                <a href={api.boardExportUrl(this.props.pid)} target="_blank" rel="noreferrer" style={sx('font-size:11px;font-weight:600')}>Open PNG</a>
                <span onClick={() => this.setState({ exported: null })} className="hFg" style={sx('cursor:pointer;font-size:12px;color:var(--fg-faint)')}>✕</span>
              </div>
            )}
          </div>
        </div>

        {lightbox && (
          <RenderLightbox src={lightbox.url} kind={lightbox.kind} onClose={() => this.setState({ lightbox: null })}
            cap={<span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--fg-muted)' }}>{lightbox.name}</span>} />
        )}
      </div>
    );
  }
}
