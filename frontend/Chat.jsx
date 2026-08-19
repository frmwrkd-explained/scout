// Filmmaker Chat — the conversation surface (ticket 11).
//
// Mounted as a project tab (App.jsx renderProject). It is the SHELL only: session sidebar, a message
// list that streams the agent's reply live over the per-session SSE channel, and a composer. The
// Production Panel (ticket 13), real directive cards (ticket 12), Manual-mode generation form
// (ticket 19) and cost surfacing (ticket 22) mount into seams left here — see the notes at each.
//
// Everything talks to the committed backend (backend/chat.mjs) through the api.js wrappers exactly as
// documented: chatSessions / chatSession / createChatSession / patchChatSession / archiveChatSession
// / chatTurn / cancelChatTurn / chatCheckpoint / restoreChatCheckpoint, plus chatStreamUrl for the
// EventSource. The POST /turn returns immediately; ALL turn progress arrives on the SSE stream:
//   turn-started · text-delta · directive · turn-done · turn-cancelled · error   (+ pass-through)
//
// Streaming model: `messages` holds the persisted transcript (source of truth, refetched at each
// turn boundary). `live` holds the in-flight turn only (its streamed text + directives). At turn-done
// we refetch and drop `live`, so the persisted record is always what you see once a turn settles. The
// live user bubble is de-duped against `messages` by id, because runTurn persists the user message
// BEFORE it broadcasts turn-started — so a mid-stream reconnect refetch can legitimately already
// contain it.
import React from 'react';
import { marked } from 'marked';
import { sx } from './sx';
import { api } from './api';
import { renderDirective, renderMessageBody } from './chat/directives';
import ProductionPanel from './chat/ProductionPanel';
import Composer, { ComposerDock, DOCK_WIDTH } from './Composer';
import PanelSplitter from './PanelSplitter';
import { Btn } from './ui';
import { joinFragment } from './lookBuilder';
import { CAMERA_MOVEMENTS, assembleMovePrompt } from './cameraMovements';
import { modelById, DEFAULT_PREVIEW_MODEL, DEFAULT_RESOLUTION, maxRefs } from './models';
import { RenderMedia, RenderLightbox } from './RenderMedia';
import { buildEntityPool } from './entities';
import { MONO } from './tokens';
import './chat/cards'; // side effect: registers the style-lock + shot-ref directive cards

marked.setOptions({ breaks: true, mangle: false, headerIds: false });
// ── resizable panels (ticket 07) ──
const SIDEBAR_MIN = 180, SIDEBAR_MAX = 420, SIDEBAR_DEFAULT = 224;
const PROD_MIN = 220, PROD_MAX = 520, PROD_DEFAULT = 290;
const clampW = (v, min, max) => Math.min(max, Math.max(min, Number(v) || 0));
const Md = ({ src }) => <div className="mdBody" dangerouslySetInnerHTML={{ __html: marked.parse(String(src || '')) }} />;
const fmtTime = ts => { try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const fmtCost = (app, c) => { try { return app.fmt$ ? app.fmt$(c) : '$' + Number(c || 0).toFixed(4); } catch { return '$' + Number(c || 0).toFixed(4); } };

// ── attachments (ticket 18) ──
// Images and documents dropped/picked in the composer upload into the project's context boards through
// the EXISTING context upload route (api.uploadContext). Classification follows the existing folder
// vocabulary: reference stills land in `References`, script/treatment documents in `Script` — both
// reference-classified (folderKind), matching "material we look up to" rather than generated assets.
const ATT_IMG_RE = /\.(png|jpe?g|gif|webp|avif|bmp|heic|heif)$/i;
const ATT_DOC_RE = /\.(pdf|txt|md|markdown)$/i;
const ATT_ACCEPT = 'image/*,.pdf,.txt,.md,.markdown';
function attachKind(name) { if (ATT_IMG_RE.test(name)) return 'image'; if (ATT_DOC_RE.test(name)) return 'document'; return null; }
function attachFolderFor(kind) { return kind === 'image' ? 'References' : 'Script'; }

export default class Chat extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      sessions: [], activeId: null, session: null, messages: [],
      loading: true, err: null,
      live: null, streaming: false, esState: 'idle',
      input: '',
      renameId: null, renameDraft: '',
      cpOpen: false, setupOpen: true, busy: false,
      pending: [], dragOver: false, lightbox: null, // ticket 18 — attachment uploads + image viewer
      // manual-mode generation settings, owned here now that the Composer is shared and
      // controlled. `prompt` is NOT in here — it stays `input`, which send() already clears.
      gen: { model: DEFAULT_PREVIEW_MODEL, aspect: '16:9', resolution: DEFAULT_RESOLUTION, seed: '', variantCount: 1, params: {} },
      // prompt fragments — the SAME shape ShotWorkspace holds, driving the SAME shared popover
      lookId: '', move: null, moveSpeed: 'normal', moveStab: 'smooth',
      // PROMPT · FULL in-place section edits; null = derived from the lock / assembled move
      styleOverride: null, moveOverride: null,
      chatSidebarW: SIDEBAR_DEFAULT, prodPanelW: PROD_DEFAULT // ticket 07 — resizable panels
    };
    this.es = null; this.esId = null;
    this._streamOpen = false; this._ready = null; this._readyResolve = null; this._helloSeen = false;
    this._attSeq = 0;
    this.scrollRef = React.createRef();
    this.taRef = React.createRef();
    this.fileRef = React.createRef();
    this.prodPanelRef = React.createRef();
  }

  componentDidMount() {
    this.loadSessions(true);
    // ticket 07 — restore persisted panel widths; clamp on read so a stale value from a wider
    // monitor can't brick a laptop session (min/max may have moved, or the value predates them).
    api.uiState().then(ui => {
      if (!ui) return;
      const patch = {};
      if (typeof ui.chatSidebarW === 'number') patch.chatSidebarW = clampW(ui.chatSidebarW, SIDEBAR_MIN, SIDEBAR_MAX);
      if (typeof ui.prodPanelW === 'number') patch.prodPanelW = clampW(ui.prodPanelW, PROD_MIN, PROD_MAX);
      if (Object.keys(patch).length) this.setState(patch);
    }).catch(() => {});
  }
  componentWillUnmount() { this.closeStream(); }
  componentDidUpdate(_p, prev) {
    // switching sessions always lands you at the newest message, pinned
    if (prev.activeId !== this.state.activeId) { this._pinned = true; if (this.state.unseen) this.setState({ unseen: false }); }
    // Follow the stream ONLY while the user is already at the bottom. Scrolled up to reread an
    // earlier card, new content must not yank the view — it raises the "new messages" chip instead.
    if (prev.messages !== this.state.messages || prev.live !== this.state.live) {
      if (this._pinned !== false) this.scrollToBottom();
      else if (!this.state.unseen) this.setState({ unseen: true });
    }
  }
  scrollToBottom() { this._pinned = true; const el = this.scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }
  // 140px of slack means a card's border or a half-line off the edge still counts as "at bottom"
  onTranscriptScroll = e => {
    const el = e.currentTarget;
    this._pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (this._pinned && this.state.unseen) this.setState({ unseen: false });
  };

  // ── resizable panels (ticket 07) — live width during drag/keyboard, committed (persisted) once
  // the gesture settles. Never PUT per pointermove — that's the whole point of onChange/onCommit
  // being separate callbacks on PanelSplitter.
  setSidebarW(px) { this.setState({ chatSidebarW: clampW(px, SIDEBAR_MIN, SIDEBAR_MAX) }); }
  commitSidebarW(px) {
    const w = clampW(px, SIDEBAR_MIN, SIDEBAR_MAX);
    this.setState({ chatSidebarW: w });
    api.saveUiState({ chatSidebarW: w }).catch(() => {});
  }
  setProdPanelW(px) { this.setState({ prodPanelW: clampW(px, PROD_MIN, PROD_MAX) }); }
  commitProdPanelW(px) {
    const w = clampW(px, PROD_MIN, PROD_MAX);
    this.setState({ prodPanelW: w });
    api.saveUiState({ prodPanelW: w }).catch(() => {});
  }
  toggleProdPanelCollapse() { this.prodPanelRef.current && this.prodPanelRef.current.toggleCollapse(); }

  // ── session spend (ticket 22) ──
  // Running generation spend for THIS session, summed from the project's generation records in app
  // state (the same source the cards read). Only generations started FROM this session carry its
  // sessionId (agent confirm-card / manual mode → backend startGeneration|createBatch). We sum the
  // ledgered per-gen cost of the finished ones, so the header total matches the ledger numbers.
  sessionSpend() {
    const { pid } = this.props;
    const id = this.state.activeId;
    if (!pid || !id) return 0;
    try {
      const p = (this.props.app.state.projects || []).find(x => x.id === pid);
      const gens = (p && Array.isArray(p.gens)) ? p.gens : [];
      return gens.reduce((s, g) => s + (g.sessionId === id && g.status === 'done' && typeof g.cost === 'number' ? g.cost : 0), 0);
    } catch { return 0; }
  }

  // ── sessions ──
  loadSessions(selectFirst) {
    api.chatSessions(this.props.pid).then(list => {
      const sessions = Array.isArray(list) ? list : [];
      this.setState({ sessions, loading: false });
      if (selectFirst && !this.state.activeId && sessions.length) this.selectSession(sessions[0].id);
    }).catch(e => this.setState({ loading: false, err: e.message }));
  }

  async newSession() {
    this.setState({ busy: true });
    try {
      const s = await api.createChatSession({ project: this.props.pid });
      this.setState(st => ({ sessions: [s, ...st.sessions], busy: false }));
      this.selectSession(s.id);
    } catch (e) { this.setState({ busy: false }); this.props.app.showToast('Could not create chat — ' + e.message, 'var(--danger)'); }
  }

  selectSession(id) {
    if (!id || id === this.state.activeId) return;
    this.closeStream();
    this._helloSeen = false;
    this.setState({ activeId: id, session: null, messages: [], live: null, streaming: false, err: null, cpOpen: false });
    api.chatSession(id).then(s => {
      this.setState(st => st.activeId === id ? { session: s, messages: Array.isArray(s.messages) ? s.messages : [] } : null);
    }).catch(e => this.setState(st => st.activeId === id ? { err: e.message } : null));
    this.openStream(id);
  }

  reconcile(id) {
    // (re)connect / heartbeat: pull the persisted transcript so we recover anything a dropped socket
    // missed. `live` is intentionally left alone — the in-flight assistant reply is not on disk yet.
    api.chatSession(id).then(s => this.setState(st => st.activeId === id
      ? { session: s, messages: Array.isArray(s.messages) ? s.messages : st.messages, esState: 'live' } : null)).catch(() => {});
  }

  // ── SSE ──
  openStream(id) {
    this._streamOpen = false;
    this._ready = new Promise(res => { this._readyResolve = res; });
    let es;
    try { es = new EventSource(api.chatStreamUrl(id)); }
    catch { this._readyResolve && this._readyResolve(); return; } // no EventSource → turns still post, just no live stream
    this.es = es; this.esId = id;
    const active = () => this.state.activeId === id;
    const on = (t, fn) => es.addEventListener(t, ev => { let d = {}; try { d = JSON.parse(ev.data); } catch {} if (active()) fn(d); });
    const opened = () => { this._streamOpen = true; this._readyResolve && this._readyResolve(); if (active()) this.setState({ esState: 'live' }); };
    es.addEventListener('hello', () => { opened(); if (this._helloSeen) this.reconcile(id); this._helloSeen = true; });
    es.onopen = opened;
    on('turn-started', d => this.setState(st => ({ streaming: true, esState: 'live', live: { userMessage: d.userMessage || null, userText: (d.userMessage && d.userMessage.text) || (st.live && st.live.userText) || '', text: '', directives: [] } })));
    on('text-delta', d => this.setState(st => st.live ? { live: { ...st.live, text: st.live.text + (d.text || '') } } : null));
    on('directive', d => this.setState(st => st.live ? { live: { ...st.live, directives: [...st.live.directives, d.directive] } } : null));
    // ticket 13 — a lock change from the Production Panel appends a compact system message to this
    // session; refetch the transcript so it shows live (works mid-turn: `live` is left untouched).
    on('system-event', () => this.reconcile(id));
    // DEV-135 — a turn that recovered from a dead CLI conversation, or that streamed some text and
    // then failed, still completes. Without this the recovery and the partial failure are both
    // invisible and the user is left guessing why the reply is short (or why context was lost).
    on('notice', d => d.text && this.props.app.showToast(d.text, 'var(--marked)'));
    on('turn-done', () => this.onTurnEnd(id));
    on('turn-cancelled', () => { this.onTurnEnd(id); this.props.app.showToast('Turn cancelled', 'var(--fg-muted)'); });
    on('error', d => { this.onTurnEnd(id); this.setState({ err: d.message || 'agent error' }); this.props.app.showToast('Agent error — ' + (d.message || 'see transcript'), 'var(--danger)'); });
    es.onerror = () => { if (active()) this.setState({ esState: 'reconnecting' }); }; // EventSource auto-retries; `hello` re-fires and reconcile() catches up
  }

  onTurnEnd(id) {
    // the terminal event of a turn always means everything is on disk — refetch is authoritative
    api.chatSession(id).then(s => this.setState(st => st.activeId === id
      ? { messages: Array.isArray(s.messages) ? s.messages : st.messages, session: s, live: null, streaming: false } : null))
      .catch(() => this.setState(st => st.activeId === id ? { live: null, streaming: false } : null));
  }

  closeStream() { if (this.es) { try { this.es.close(); } catch {} } this.es = null; this.esId = null; this._streamOpen = false; }
  streamReady() {
    if (this._streamOpen) return Promise.resolve();
    // never hang a send on a stream that won't open — turn-done reconciles the final text regardless
    return Promise.race([this._ready || Promise.resolve(), new Promise(r => setTimeout(r, 1200))]);
  }

  // ── attachments (ticket 18) ──
  // Uploads are project-scoped (into context boards), NOT session-scoped, so they can start before a
  // session even exists. Standalone chat (no project) has no context surface here → attach is disabled
  // with a hint (see renderComposer); library-scoped attach is left to ticket 24.
  attachEnabled() { return !!this.props.pid; }
  attSrc(a) { return api.contextUrl(a.scope || this.props.pid, a.name, a.folder || ''); }

  addFiles(fileList) {
    if (!this.attachEnabled()) return;
    const files = [...(fileList || [])];
    if (!files.length) return;
    const accepted = [];
    for (const file of files) {
      const kind = attachKind(file.name);
      if (!kind) { this.props.app.showToast('Unsupported file — attach images, PDF, TXT or MD', 'var(--danger)'); continue; }
      accepted.push({ key: 'att-' + (++this._attSeq), file, name: file.name, kind, status: 'uploading', ref: null });
    }
    if (!accepted.length) return;
    this.setState(st => ({ pending: [...st.pending, ...accepted] }));
    for (const p of accepted) this.uploadOne(p);
  }

  async uploadOne(p) {
    const folder = attachFolderFor(p.kind);
    try {
      const saved = await api.uploadContext(this.props.pid, p.file, folder);
      const ref = { id: 'context/' + (saved.folder ? saved.folder + '/' : '') + saved.name, kind: p.kind, name: saved.name, folder: saved.folder || '', scope: this.props.pid };
      this.setState(st => ({ pending: st.pending.map(x => x.key === p.key ? { ...x, status: 'done', ref } : x) }));
    } catch (e) {
      this.setState(st => ({ pending: st.pending.map(x => x.key === p.key ? { ...x, status: 'error' } : x) }));
      this.props.app.showToast('Upload failed: ' + p.name, 'var(--danger)');
    }
  }

  removePending(key) { this.setState(st => ({ pending: st.pending.filter(x => x.key !== key) })); }

  // ── manual mode (ticket 19) ──
  // Done image attachments become generation refs, by id — the SAME {scope,folder,name} triple the
  // /api/generate route accepts (ticket 18's mechanism), so a still dropped in the composer is a
  // reference frame for the manual generation, never described into the prompt.
  manualAttachmentRefs() {
    return this.state.pending.filter(p => p.status === 'done' && p.ref && p.kind === 'image')
      .map(p => ({ kind: 'asset', scope: p.ref.scope || this.props.pid, name: p.ref.name, folder: p.ref.folder || '' }));
  }
  // the style lock this composer will fold in: the explicitly chosen one, else the project's
  activeLock() {
    const locks = this.props.app.state.styleLocks || [];
    if (this.state.lookId) return locks.find(l => l.id === this.state.lookId) || null;
    return (this.props.app.state.activeStyleLocks || {})[this.props.pid] || null;
  }
  // the two composed-in sections, each honouring its PROMPT · FULL in-place edit (null = derived)
  styleFrag() {
    if (this.state.styleOverride != null) return this.state.styleOverride.trim();
    const lock = this.activeLock();
    return (lock && String(lock.fragment || '').trim()) || '';
  }
  moveFrag() {
    const S = this.state;
    if (S.moveOverride != null) return S.moveOverride.trim();
    const move = CAMERA_MOVEMENTS.find(m => m.id === S.move);
    return move ? assembleMovePrompt(move, { speed: S.moveSpeed, stabilization: S.moveStab }).trim() : '';
  }
  // what PROMPT · FULL shows — identical composition to submitManual(), so the preview cannot
  // drift from what ships. Keep the two in step.
  composedPreview() {
    let out = String(this.state.input || '').trim();
    const fragment = this.styleFrag();
    const moveFrag = this.moveFrag();
    if (fragment) out = joinFragment(out, fragment);
    if (moveFrag) out = joinFragment(out, moveFrag);
    return out;
  }

  // i2v models animate a still — block with a hint when nothing will be sent as a reference frame.
  // Ported verbatim from ManualComposer.jsx:146-155; the same regex pair lives at
  // ProjectGenerate.jsx:245. Do not loosen it: without a ref the provider fails AFTER the click,
  // once per variant, and the user is billed for the attempt.
  manualBlockReason() {
    const id = (this.state.gen || {}).model;
    if (!id) return 'Pick a model';
    const i2v = /image-to-video/.test(String(id)) || /\bi2v\b/i.test((modelById(id) || {}).note || '');
    if (i2v && !this.manualAttachmentRefs().length) return 'This model animates a still — attach a reference frame first';
    return null;
  }

  // Manual generate. Ported from ManualComposer.submit() (:157-207) with its three load-bearing
  // details intact:
  //   1. joinFragment folds the style lock into the prompt — NOT `prompt + ', ' + fragment`.
  //      ShotWorkspace's concat is the live double-comma bug (docs/COMPONENTS.md §3.1).
  //   2. styleLockFragment is sent EMPTY on the batch path because the fragment is already inside
  //      `prompt`. The server joins with ' ' on batches and ', ' on singles, so splitting it would
  //      make a 1x and a 2x from identical settings differ by one character.
  //   3. params is OMITTED when empty, never sent as {}.
  // The route fork is real: variantCount === 1 -> /api/generate, > 1 -> /api/batches. variantCount
  // is not a field on /api/generate at all.
  async submitManual() {
    const { app, pid } = this.props;
    const sessionId = this.state.activeId;
    const S = this.state.gen || {};
    if (this.state.busy) return;
    const rawPrompt = String(this.state.input || '').trim();
    if (!rawPrompt) { app.showToast('Write a prompt to generate', 'var(--danger)'); return; }
    const block = this.manualBlockReason();
    if (block) { app.showToast(block, 'var(--danger)'); return; }

    const prompt = this.composedPreview() || rawPrompt;
    const refs = this.manualAttachmentRefs().slice(0, maxRefs(S.model));
    const isBatch = Number(S.variantCount) > 1;

    // drop undefined/null/''/'-' exactly like ProjectGenerate.paramsField()
    const clean = {};
    for (const [k, val] of Object.entries(S.params || {})) {
      if (val === undefined || val === null || val === '' || val === '-') continue;
      clean[k] = val;
    }
    const paramsField = Object.keys(clean).length ? { params: clean } : {};

    this.setState({ busy: true });
    try {
      let directive;
      if (isBatch) {
        const batch = await api.createBatch({
          pid, shotIds: [], prompt, model: S.model, aspect: S.aspect, resolution: S.resolution,
          styleLockFragment: '',
          variantCount: Number(S.variantCount), baseSeed: S.seed === '' ? null : Number(S.seed),
          refs, sessionId, ...paramsField
        });
        directive = { type: 'generation.batch', batch: batch.id, project: pid };
      } else {
        const gen = await api.generate({
          pid, shot: null, prompt, model: S.model, aspect: S.aspect, resolution: S.resolution,
          seed: S.seed === '' ? null : Number(S.seed),
          refs, sessionId, ...paramsField
        });
        directive = { type: 'generation', ref: gen.id, project: pid };
      }
      const modelLabel = (modelById(S.model) || {}).label || String(S.model).split('/').pop();
      const userText = 'Manual · ' + modelLabel + (isBatch ? ' · ' + S.variantCount + '×' : '')
        + '\n' + '“' + rawPrompt.slice(0, 160) + '”';
      // ordering is load-bearing — the directive carries the id these calls just returned
      await api.chatManualTurn(sessionId, { userText, directive });
      app.sync?.();
      app.showToast((isBatch ? 'Batch queued — ' : 'Generation queued — ') + modelLabel, 'var(--accent)');
      this.setState({ input: '', busy: false });
      this.onManualSubmitted();
    } catch (e) {
      this.setState({ busy: false });
      app.showToast('Manual generate failed — ' + (e.message || ''), 'var(--danger)');
    }
  }

  // After a manual generate is recorded: clear the attachment tray and refetch the transcript so the
  // new user + directive-card turn renders inline (the manual-turn route also broadcasts turn-done).
  onManualSubmitted() {
    const id = this.state.activeId;
    this.setState({ pending: [] });
    if (id) this.reconcile(id);
  }

  onComposerDrop(e) {
    if (!this.attachEnabled()) return;
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault(); e.stopPropagation();
    this.setState({ dragOver: false });
    this.addFiles(e.dataTransfer.files);
  }

  // ── turns ──
  async send() {
    const text = this.state.input.trim();
    const attachments = this.state.pending.filter(p => p.status === 'done' && p.ref).map(p => p.ref);
    const uploading = this.state.pending.some(p => p.status === 'uploading');
    if (uploading) { this.props.app.showToast('Attachments still uploading…', 'var(--fg-muted)'); return; }
    if ((!text && !attachments.length) || this.state.streaming) return;
    let id = this.state.activeId;
    if (!id) {
      this.setState({ busy: true });
      try {
        const s = await api.createChatSession({ project: this.props.pid });
        this.setState(st => ({ sessions: [s, ...st.sessions], busy: false }));
        this.selectSession(s.id);
        id = s.id;
      } catch (e) { this.setState({ busy: false }); this.props.app.showToast('Could not start chat — ' + e.message, 'var(--danger)'); return; }
    }
    this.setState({ input: '', pending: [], live: { userMessage: null, userText: text, attachments, text: '', directives: [] }, streaming: true, err: null });
    if (this.taRef.current) this.taRef.current.style.height = 'auto';
    await this.streamReady(); // ensure we're subscribed before runTurn broadcasts turn-started
    api.chatTurn(id, text, attachments).catch(e => {
      this.setState(st => ({ streaming: false, live: null }));
      this.props.app.showToast('Send failed — ' + e.message, 'var(--danger)');
    });
  }

  cancel() {
    const id = this.state.activeId;
    if (!id) return;
    api.cancelChatTurn(id).catch(() => {}); // turn-cancelled arrives on the SSE channel and clears `live`
  }

  // ── session mutations ──
  toggleMode() {
    // Agent ⇄ Manual. Manual is INERT until ticket 19 — the switch persists the choice and swaps the
    // composer for a placeholder; nothing generates yet.
    const s = this.state.session; if (!s) return;
    const mode = s.mode === 'manual' ? 'agent' : 'manual';
    api.patchChatSession(s.id, { mode }).then(next => this.patchLocal(next)).catch(e => this.props.app.showToast(e.message, 'var(--danger)'));
  }
  commitRename() {
    const { renameId, renameDraft } = this.state;
    if (!renameId) return;
    const title = renameDraft.trim();
    this.setState({ renameId: null, renameDraft: '' });
    if (!title) return;
    api.patchChatSession(renameId, { title }).then(next => this.patchLocal(next)).catch(e => this.props.app.showToast(e.message, 'var(--danger)'));
  }
  archive(id) {
    api.archiveChatSession(id, true).then(() => {
      this.setState(st => {
        const sessions = st.sessions.filter(s => s.id !== id);
        const active = st.activeId === id;
        return { sessions, ...(active ? { activeId: null, session: null, messages: [], live: null, streaming: false } : {}) };
      });
      if (this.state.activeId === id) this.closeStream();
    }).catch(e => this.props.app.showToast(e.message, 'var(--danger)'));
  }
  patchLocal(next) {
    if (!next) return;
    this.setState(st => ({
      session: st.activeId === next.id ? { ...st.session, ...next } : st.session,
      sessions: st.sessions.map(s => s.id === next.id ? { ...s, ...next } : s)
    }));
  }

  // ── promote to project (ticket 24) ──
  // A standalone session becomes project-bound: create a project (existing route), then bind this
  // session to it (same id, records move server-side). We then navigate into that project's Chat tab,
  // where the Production Panel appears and manual generation works — the bound session is the most
  // recently-updated one, so the project Chat auto-selects it.
  async promoteToProject() {
    const id = this.state.activeId;
    if (!id || this.props.pid || this.state.busy) return;
    const s = this.state.session;
    const name = (s && s.title && s.title !== 'New chat') ? s.title.slice(0, 60) : 'Chat project';
    this.setState({ busy: true });
    try {
      const p = await api.createProject(name, '', 0);
      await api.chatBindSession(id, p.id);
      this.setState({ busy: false });
      await this.props.app.sync();
      this.props.app.showToast('Promoted to project "' + p.name + '" — this chat moved with it', 'var(--ok)');
      this.props.app.openProj(p.id, 'chat');
    } catch (e) {
      this.setState({ busy: false });
      this.props.app.showToast('Promote failed — ' + (e.message || ''), 'var(--danger)');
    }
  }

  // ── checkpoints ──
  // manual distillation (ticket 20) — always allowed, independent of the chatAutoDistill toggle
  saveLearnings() {
    const id = this.state.activeId;
    if (!id) return;
    api.distillChatSession(id).then(r => {
      const n = (r.added || []).length;
      this.props.app.showToast(n ? n + ' learning' + (n === 1 ? '' : 's') + ' saved to project memory' : 'Nothing new to remember', 'var(--ok)');
    }).catch(e => this.props.app.showToast(e.message, 'var(--danger)'));
  }

  createCheckpoint() {
    const id = this.state.activeId; if (!id) return;
    api.chatCheckpoint(id, {}).then(() => {
      api.chatSession(id).then(s => this.setState(st => st.activeId === id ? { session: s, cpOpen: true } : null)).catch(() => {});
      this.props.app.showToast('Checkpoint saved', 'var(--ok)');
    }).catch(e => this.props.app.showToast(e.message, 'var(--danger)'));
  }
  branchFrom(cid) {
    const id = this.state.activeId; if (!id) return;
    api.restoreChatCheckpoint(id, cid).then(branch => {
      this.setState(st => ({ sessions: [branch, ...st.sessions] }));
      this.selectSession(branch.id);
      this.props.app.showToast('Branched to a new session', 'var(--accent)');
    }).catch(e => this.props.app.showToast(e.message, 'var(--danger)'));
  }

  // ── render pieces ──
  renderSidebar() {
    const { sessions, activeId, renameId, renameDraft, busy, chatSidebarW } = this.state;
    return (
      <div style={{ ...sx('flex:none;display:flex;flex-direction:column;background:var(--ink)'), width: chatSidebarW }}>
        <div style={sx('display:flex;align-items:center;gap:8px;padding:12px 12px 10px')}>
          <span style={sx('font-size:11px;font-weight:700;letter-spacing:.14em;color:var(--fg-faint)')}>SESSIONS</span>
          {/* outlined-accent, not a solid fill — the composer's Send is this screen's one solid accent */}
          <Btn size="sm" disabled={busy} onClick={() => this.newSession()} title="New session"
            style={{ marginLeft: 'auto', padding: '4px 10px', fontWeight: 700, ...(busy ? null : { color: 'var(--accent)', borderColor: 'var(--accent-35)' }) }}>＋ New</Btn>
        </div>
        <div className="chatScroll" style={sx('flex:1;padding:0 8px 10px')}>
          {sessions.length === 0 && <div style={{ ...sx('padding:10px 6px;letter-spacing:.07em;text-transform:uppercase;color:var(--fg-faint);line-height:1.8'), fontFamily: MONO, fontSize: 9.5 }}>{this.props.pid ? 'NO SESSIONS YET — START ONE TO DIRECT THIS PROJECT' : 'NO SESSIONS YET — START ONE TO THINK A STORY THROUGH'}</div>}
          {sessions.map(s => {
            const on = s.id === activeId;
            if (renameId === s.id) return (
              <input key={s.id} value={renameDraft} autoFocus onChange={e => this.setState({ renameDraft: e.target.value })}
                onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') this.commitRename(); else if (e.key === 'Escape') this.setState({ renameId: null, renameDraft: '' }); }}
                onBlur={() => this.commitRename()}
                style={{ ...sx('width:100%;box-sizing:border-box;margin:2px 0;background:var(--ink);border:1px solid var(--accent-60);border-radius:7px;color:var(--fg);padding:6px 9px'), fontSize: 12 }} />
            );
            return (
              <div key={s.id} className={'chatSessRow ' + (on ? '' : 'hRow')} onClick={() => this.selectSession(s.id)}
                style={{ ...sx('display:flex;align-items:center;gap:7px;padding:8px 9px;border-radius:8px;cursor:pointer;margin:2px 0'), background: on ? 'var(--raise)' : 'transparent', border: '1px solid ' + (on ? 'var(--border-2)' : 'transparent') }}>
                <div style={sx('flex:1;min-width:0')}>
                  <div style={{ ...sx('font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'), color: on ? 'var(--fg)' : 'var(--fg-soft)' }}>{s.title || 'New chat'}</div>
                  <div style={sx('font-size:9.5px;color:var(--fg-faint);margin-top:2px;display:flex;gap:6px')}>
                    <span>{(s.mode || 'agent')}</span>
                    {s.executor === 'simulate' && <span style={sx('color:var(--fg-muted)')}>· simulated</span>}
                    {(s.checkpoints || []).length ? <span>· {(s.checkpoints || []).length}✚</span> : null}
                  </div>
                </div>
                <div className="chatSessAct" style={sx('display:flex;gap:4px;flex:none')}>
                  <span onClick={e => { e.stopPropagation(); this.setState({ renameId: s.id, renameDraft: s.title || '' }); }} className="hFg" title="Rename" style={sx('font-size:11px;color:var(--fg-faint);cursor:pointer')}>✎</span>
                  <span onClick={e => { e.stopPropagation(); this.archive(s.id); }} className="hBdRed" title="Archive" style={sx('font-size:11px;color:var(--fg-faint);cursor:pointer')}>⌫</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  renderSetupPanel() {
    // No agent CLI → the session's executor is `simulate`. Instead of erroring, surface the app's
    // existing three-click CONNECT CLAUDE wizard (install / sign-in / test) so replies become real.
    const { setupOpen } = this.state;
    return (
      <div style={sx('margin:12px 16px 0;border:1px solid var(--accent-12);border-radius:12px;background:var(--surface);overflow:hidden')}>
        <div onClick={() => this.setState({ setupOpen: !setupOpen })} className="hBg" style={sx('display:flex;align-items:center;gap:9px;padding:10px 14px;cursor:pointer')}>
          <span style={sx('width:7px;height:7px;border-radius:99px;background:var(--accent);flex:none')} />
          <span style={sx('font-size:12px;font-weight:700;color:var(--fg)')}>Replies are simulated</span>
          <span style={sx('font-size:10.5px;color:var(--fg-muted)')}>connect Claude to run the agent for real</span>
          <span style={sx('margin-left:auto;font-size:11px;color:var(--fg-faint)')}>{setupOpen ? '▴' : '▾'}</span>
        </div>
        {setupOpen && <div style={sx('padding:6px 14px 14px')}>{this.props.app.renderAgentWizard()}</div>}
      </div>
    );
  }

  // attachment chips on a user bubble: image refs render as clickable thumbnails (→ lightbox),
  // documents as a compact file chip that opens the raw file via the context route.
  renderAttachments(list) {
    const atts = (list || []).filter(Boolean);
    if (!atts.length) return null;
    return (
      <div style={sx('display:flex;flex-wrap:wrap;gap:7px;margin-top:8px')}>
        {atts.map((a, i) => a.kind === 'image' ? (
          <div key={i} onClick={() => this.setState({ lightbox: { src: this.attSrc(a), name: a.name } })}
            className="hBd" title={a.name}
            style={sx('width:56px;height:56px;border-radius:8px;overflow:hidden;border:1px solid var(--border-2);cursor:pointer;background:var(--sunk)')}>
            <RenderMedia src={this.attSrc(a)} kind="image" fit="cover" style={sx('width:100%;height:100%')} />
          </div>
        ) : (
          <a key={i} href={this.attSrc(a)} target="_blank" rel="noreferrer" title={a.name} className="hBd"
            style={{ ...sx('display:flex;align-items:center;gap:6px;max-width:200px;padding:6px 10px;border-radius:8px;border:1px solid var(--border-2);background:var(--surface);color:var(--fg-soft);text-decoration:none'), fontSize: 11 }}>
            <span>📄</span>
            <span style={sx('white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{a.name}</span>
          </a>
        ))}
      </div>
    );
  }

  renderMessage(m, key) {
    // system events (ticket 13) — a compact, centered, machine-authored line (ids only). Not a chat
    // bubble: it marks a world change (e.g. the style lock moved) between turns.
    if (m.role === 'system') return (
      <div key={key} style={sx('display:flex;justify-content:center;margin:10px 0')}>
        <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '.04em', color: 'var(--fg-muted)', background: 'var(--sunk)', border: '1px solid var(--border)', borderRadius: 999, padding: '3px 12px' }}>
          {m.text}
        </span>
      </div>
    );
    if (m.role === 'user') return (
      <div key={key} style={sx('display:flex;justify-content:flex-end;margin:14px 0')}>
        <div style={sx('max-width:76%;background:var(--raise);border:1px solid var(--border-2);border-radius:12px 12px 4px 12px;padding:9px 13px')}>
          {m.text ? <div style={sx('font-size:12.5px;line-height:1.6;color:var(--fg);white-space:pre-wrap;word-break:break-word')}>{m.text}</div> : null}
          {this.renderAttachments(m.attachments)}
        </div>
      </div>
    );
    // assistant
    const ctx = { app: this.props.app, pid: this.props.pid, session: this.state.session, message: m };
    return (
      <div key={key} style={sx('margin:14px 0')}>
        <div style={sx('display:flex;align-items:baseline;gap:8px;margin-bottom:4px')}>
          <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--fg-faint)' }}>agent</span>
          {m.tsStamp || m.ts ? <span style={sx('font-size:9.5px;color:var(--border-3)')}>{fmtTime(m.ts)}</span> : null}
          {m.cancelled ? <span style={sx('font-size:9.5px;color:var(--fg-muted)')}>· cancelled</span> : null}
          {m.cost ? <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>· {fmtCost(this.props.app, m.cost)}</span> : null}
        </div>
        {m.error
          ? <div style={sx('border:1px solid rgba(240,91,84,.4);background:rgba(240,91,84,.08);border-radius:10px;padding:10px 13px;font-size:12px;color:var(--danger)')}>⚠ {m.error}</div>
          : <>{renderMessageBody(m.text, m.directives, ctx, Md)}</>}
      </div>
    );
  }

  renderLive() {
    const { live, messages } = this.state;
    if (!live) return null;
    const ctx = { app: this.props.app, pid: this.props.pid, session: this.state.session, live: true };
    // de-dupe the live user bubble: runTurn persists the user message before turn-started, so a
    // mid-stream reconnect refetch may already carry it in `messages`.
    const userDup = live.userMessage && messages.some(m => m.id === live.userMessage.id);
    const liveAtts = (live.userMessage && live.userMessage.attachments) || live.attachments;
    return (
      <>
        {!userDup && (live.userMessage || live.userText || (liveAtts && liveAtts.length)) && (
          <div style={sx('display:flex;justify-content:flex-end;margin:14px 0')}>
            <div style={sx('max-width:76%;background:var(--raise);border:1px solid var(--border-2);border-radius:12px 12px 4px 12px;padding:9px 13px')}>
              <div style={sx('font-size:12.5px;line-height:1.6;color:var(--fg);white-space:pre-wrap;word-break:break-word')}>{(live.userMessage && live.userMessage.text) || live.userText}</div>
            {this.renderAttachments((live.userMessage && live.userMessage.attachments) || live.attachments)}
            </div>
          </div>
        )}
        <div style={sx('margin:14px 0')}>
          <div style={sx('display:flex;align-items:baseline;gap:8px;margin-bottom:4px')}>
            <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--fg-faint)' }}>agent</span>
            {/* running is a state, not a call to action — the marked/running blue channel, never accent */}
            <span style={{ ...sx('font-size:9.5px'), color: '#5B9DFF' }}>streaming…</span>
          </div>
          {live.text ? <Md src={live.text} /> : <span style={sx('font-size:12.5px;color:var(--fg-muted)')}>Thinking</span>}
          <span className="chatCaret" />
          {live.directives.map((d, i) => <div key={i}>{renderDirective(d, ctx)}</div>)}
        </div>
      </>
    );
  }

  renderComposer() {
    const { input, streaming, session, activeId, pending } = this.state;
    const manualCapable = !!this.props.pid;
    const manual = manualCapable && session && session.mode === 'manual';
    const attachOk = this.attachEnabled();
    return (
      <>
        {/* the transcript runs UNDER the floating bar; this fade is what keeps the last line
            readable instead of colliding with the glass. pointer-events:none so it never eats
            a click meant for a card. */}
        <div style={sx('position:absolute;left:0;right:0;bottom:0;height:160px;pointer-events:none;background:linear-gradient(180deg,transparent,var(--ink) 55%)')} />
        {/* new-content chip — raised when a message lands while the user is scrolled up */}
        {this.state.unseen ? (
          <div onClick={() => { this.setState({ unseen: false }); this.scrollToBottom(); }} className="hBtnAccent"
            style={{ ...sx('position:absolute;left:50%;z-index:41;cursor:pointer;border-radius:999px;padding:4px 13px;font-size:10.5px;font-weight:700'),
              transform: 'translateX(-50%)', bottom: 186, background: 'var(--accent)', color: 'var(--on-accent)', boxShadow: '0 8px 24px rgba(0,0,0,.45)' }}>
            ↓ new messages
          </div>
        ) : null}
        {/* placement comes from ComposerDock — the ONE dock recipe every surface shares */}
        <ComposerDock position="absolute">
          <div>
        {/* the picker is hidden but must stay mounted: resetting e.target.value in onChange is
            what lets the same file be re-picked after a send (Chat.jsx:589/:611 did this too —
            send() clears state.pending but never the DOM input) */}
        <input ref={this.fileRef} type="file" multiple accept={ATT_ACCEPT} style={{ display: 'none' }}
          onChange={e => { this.addFiles(e.target.files); e.target.value = ''; }} />
        <Composer
          app={this.props.app}
          value={{ prompt: input, ...(this.state.gen || {}) }}
          onChange={next => {
            const { prompt, ...gen } = next;
            this.setState(s => ({ input: prompt != null ? prompt : s.input, gen }));
          }}
          mode={manual ? 'manual' : 'agent'}
          onMode={() => { if (session) this.toggleMode(); }}
          modeDisabled={manualCapable ? null : 'Manual generation needs a project — promote this chat first'}
          busy={manual ? this.state.busy : streaming}
          onCancel={!manual && streaming ? () => this.cancel() : null}
          blockReason={manual ? this.manualBlockReason() : null}
          onSubmit={() => (manual ? this.submitManual() : this.send())}
          submitLabel={manual ? 'Generate' : 'Send'}
          submitOnEnter={!manual}
          allowEmptyPrompt
          showTech={manual}
          placeholder={manual
            ? 'Describe the shot — ⌘⏎ generates. Type / for a snippet.'
            : (activeId ? 'Direct the scene — @ for refs, / for tools' : 'Start a new session — type your first message…')}
          attachments={attachOk ? pending : []}
          onAttach={attachOk ? () => this.fileRef.current && this.fileRef.current.click() : null}
          onRemoveAttachment={key => this.removePending(key)}
          onDropFiles={attachOk ? files => this.addFiles(files) : null}
          attachHint={manual
            ? 'References attach as generation frames — up to 4'
            : 'Attach images or documents (pdf/txt/md) — drag-drop works too'}
          fragments={manual ? { label: [
            this.activeLock() ? 'style' : null,
            this.state.move ? 'cam' : null,
            this.manualAttachmentRefs().length ? this.manualAttachmentRefs().length + ' refs' : null,
          ].filter(Boolean).join(' · ') || 'no look' } : null}
          fragmentProps={manual ? {
            pid: this.props.pid,
            looks: this.props.app.state.styleLocks || [],
            activeLookId: this.state.lookId || '',
            projectLock: (this.props.app.state.activeStyleLocks || {})[this.props.pid] || null,
            onLook: id => this.setState({ lookId: id, styleOverride: null }),
            move: this.state.move, speed: this.state.moveSpeed, stab: this.state.moveStab,
            onMove: id => this.setState({ move: id, moveOverride: null }),
            onSpeed: id => this.setState({ moveSpeed: id, moveOverride: null }),
            onStab: id => this.setState({ moveStab: id, moveOverride: null }),
          } : null}
          entities={this.props.pid ? buildEntityPool(this.props.app, this.props.pid) : []}
          pid={this.props.pid}
          composedPrompt={manual ? this.composedPreview() : ''}
          provenance={manual ? [
            (this.styleFrag() || this.state.styleOverride != null) ? {
              text: this.styleFrag(),
              tag: 'style · ' + ((this.activeLock() || {}).name || 'edited'),
              onEdit: t => this.setState({ styleOverride: t }),
            } : null,
            this.moveFrag() ? { text: this.moveFrag(), tag: 'cam', onEdit: t => this.setState({ moveOverride: t }) } : null,
          ].filter(Boolean) : []}
        />
          </div>
        </ComposerDock>
      </>
    );
  }

  renderCheckpoints() {
    const s = this.state.session;
    const cps = (s && s.checkpoints) || [];
    return (
      <div style={sx('border-bottom:1px solid var(--line);padding:10px 16px;background:var(--ink)')}>
        <div style={sx('font-size:10px;font-weight:700;letter-spacing:.12em;color:var(--fg-faint);margin-bottom:8px')}>CHECKPOINTS</div>
        {cps.length === 0 && <div style={{ ...sx('letter-spacing:.07em;text-transform:uppercase;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9.5 }}>NONE YET — SAVE ONE TO BRANCH OR ROLL BACK</div>}
        {cps.map(cp => (
          <div key={cp.id} style={sx('display:flex;align-items:center;gap:9px;padding:6px 0')}>
            <span style={sx('font-size:11.5px;color:var(--fg-soft);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{cp.label}</span>
            <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>turn {cp.turn}</span>
            <span onClick={() => this.branchFrom(cp.id)} className="hBdAccentChip" style={sx('font-size:10.5px;font-weight:700;color:var(--accent);border:1px solid var(--accent-35);border-radius:6px;padding:3px 9px;cursor:pointer')}>Branch</span>
          </div>
        ))}
      </div>
    );
  }

  // ── standalone rail (ticket 24) ──
  // Replaces the Production Panel when the chat isn't bound to a project. There is no creative context
  // to render yet, so this explains what standalone chat can and can't do and offers promote-to-project
  // (the same action the header carries), which unlocks the panel, attachments and manual generation.
  renderStandaloneRail() {
    const { activeId, prodPanelW } = this.state;
    return (
      <div style={{ ...sx('flex:none;background:var(--ink);display:flex;flex-direction:column'), width: prodPanelW }}>
        <div style={sx('display:flex;align-items:center;gap:8px;padding:12px 12px 8px;border-bottom:1px solid var(--line)')}>
          <span style={sx('font-size:11px;font-weight:700;letter-spacing:.14em;color:var(--fg)')}>STANDALONE</span>
        </div>
        <div className="chatScroll" style={sx('flex:1;padding:14px 14px 16px;overflow-y:auto')}>
          <div style={sx('font-size:12px;color:var(--fg-soft);line-height:1.6;margin-bottom:12px')}>
            This chat isn’t tied to a project. Think out loud, sketch a story, ask questions — it all stays here.
          </div>
          <div style={sx('font-size:11px;color:var(--fg-faint);line-height:1.7;margin-bottom:14px')}>
            Promote it to a project to unlock the Production Panel (brief, style locks, cast &amp; locations),
            file attachments, and manual generation — the whole conversation moves across, keeping its history.
          </div>
          <Btn variant="primary" disabled={!activeId} busy={this.state.busy} onClick={() => this.promoteToProject()}
            title={activeId ? 'Create a project from this chat' : 'Start a chat first'}
            style={{ width: '100%', boxSizing: 'border-box', justifyContent: 'center', padding: '9px 12px', borderRadius: 9 }}>
            ↑ Promote to project
          </Btn>
        </div>
      </div>
    );
  }

  render() {
    const { session, activeId, messages, loading, cpOpen, esState } = this.state;
    const simulate = session && session.executor === 'simulate';
    return (
      // The shell FILLS its locked parent (App.render's `agentLocked` column) rather than guessing the
      // viewport. `calc(100vh - 196px)` + minHeight:520 WAS that guess: it over-measured on every
      // window, so the page scrolled and dragged the rails and the floating composer out of frame.
      // flex:1 + min-height:0 is what makes the transcript the only thing that scrolls.
      <div style={sx('display:flex;box-sizing:border-box;flex:1;min-height:0;height:100%')}>
        {this.renderSidebar()}
        <PanelSplitter value={this.state.chatSidebarW} onChange={w => this.setSidebarW(w)} onCommit={w => this.commitSidebarW(w)}
          min={SIDEBAR_MIN} max={SIDEBAR_MAX} defaultValue={SIDEBAR_DEFAULT} side="left" label="Resize sessions panel" />
        {/* position:relative — the composer floats over this column, absolutely placed */}
        <div style={sx('flex:1;min-width:360px;display:flex;flex-direction:column;position:relative')}>
          {activeId ? (
            <>
              {/* session header */}
              <div style={sx('display:flex;align-items:center;gap:10px;padding:11px 16px;border-bottom:1px solid var(--line)')}>
                <span style={sx('font-size:13px;font-weight:700;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:340px')}>{session ? (session.title || 'New chat') : '…'}</span>
                {esState === 'reconnecting' && <span style={sx('font-size:10px;color:var(--fg-muted)')}>reconnecting…</span>}
                {/* ticket 22 — running generation spend for this session (matches the ledger) */}
                {(() => { const spend = this.sessionSpend(); return spend > 0 ? (
                  <span title="Generation spend this session" style={{ ...sx('display:inline-flex;align-items:center;gap:5px;border:1px solid var(--accent-35);border-radius:999px;padding:3px 10px'), fontFamily: MONO, fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
                    <span style={sx('color:var(--fg-faint)')}>session</span>
                    <span style={sx('color:var(--accent)')}>{fmtCost(this.props.app, spend)}</span>
                  </span>
                ) : null; })()}
                <div style={sx('margin-left:auto;display:flex;align-items:center;gap:8px')}>
                  {/* ticket 24 — standalone chat: promote this session into a new project (binds it) */}
                  {!this.props.pid && (
                    <Btn size="sm" busy={this.state.busy} onClick={() => this.promoteToProject()}
                      title="Create a project from this chat — the conversation moves with it and the Production Panel appears"
                      style={{ padding: '5px 11px', fontWeight: 700, ...(this.state.busy ? null : { color: 'var(--accent)', borderColor: 'var(--accent-35)' }) }}>↑ Promote to project</Btn>
                  )}
                  <Btn size="sm" onClick={() => this.createCheckpoint()} style={{ padding: '5px 11px' }}>✚ Checkpoint</Btn>
                  {session && session.project && (
                    <Btn size="sm" onClick={() => this.saveLearnings()} title="Distill this session's decisions into project memory" style={{ padding: '5px 11px' }}>Save learnings</Btn>
                  )}
                  <Btn size="sm" onClick={() => this.setState(st => ({ cpOpen: !st.cpOpen }))}
                    style={{ padding: '5px 11px', fontVariantNumeric: 'tabular-nums', ...(cpOpen ? { color: 'var(--accent)' } : null) }}>
                    History {((session && session.checkpoints) || []).length || ''}
                  </Btn>
                </div>
              </div>
              {cpOpen && this.renderCheckpoints()}
              {simulate && this.renderSetupPanel()}
              {/* bottom padding clears the floating composer — the bar overlays the transcript
                  rather than sitting in a bordered footer (handover: "floating glass bar") */}
              <div ref={this.scrollRef} onScroll={this.onTranscriptScroll} className="chatScroll" style={sx('flex:1;padding:6px 16px 248px')}>
                {/* the conversation is a CENTERED COLUMN, the SAME width as the composer dock
                    (DOCK_WIDTH) so a card and the bar that acts on it line up edge-to-edge. It was
                    pinned at 600 while the dock is 760 — which is why the shot-board cards read as
                    cramped, their rows truncating under the chips. One width, imported, never two. */}
                <div style={{ ...sx('width:100%;margin:0 auto'), maxWidth: DOCK_WIDTH }}>
                  {messages.length === 0 && !this.state.live && (
                    <div style={{ ...sx('padding:40px 10px;text-align:center;letter-spacing:.08em;color:var(--fg-faint);line-height:2'), fontFamily: MONO, fontSize: 10 }}>
                      NOTHING HERE YET<br />DESCRIBE YOUR STORY, ASK FOR A SHOT LIST, OR REQUEST A STORYBOARD
                    </div>
                  )}
                  {messages.map((m, i) => this.renderMessage(m, m.id || i))}
                  {this.renderLive()}
                </div>
              </div>
              {this.renderComposer()}
            </>
          ) : (
            <div style={sx('flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px')}>
              {loading ? <span style={sx('font-size:12px;color:var(--fg-faint)')}>Loading sessions…</span> : (<>
                <div style={sx('font-size:15px;font-weight:700;color:var(--fg)')}>{this.props.pid ? 'Direct this project in conversation' : 'Start a standalone chat'}</div>
                <div style={sx('font-size:12px;color:var(--fg-muted);max-width:380px;text-align:center;line-height:1.6')}>{this.props.pid
                  ? 'Start a chat to develop story, break down shots, preview storyboards, and lock a look — all in one thread.'
                  : 'Think through a story with the agent, then promote the chat to a project to generate, attach references, and lock a look.'}</div>
                <Btn variant="primary" size="lg" onClick={() => this.newSession()} style={{ padding: '9px 20px', borderRadius: 9 }}>＋ New session</Btn>
                {this.state.err && <div style={sx('font-size:11px;color:var(--danger)')}>{this.state.err}</div>}
              </>)}
            </div>
          )}
        </div>
        {/* ticket 13 — Production Panel: the project's creative context as visuals, beside the chat.
            Reads canonical records (brief/memory, style locks, cast/locations, looks); a lock change
            here posts a compact system event (ids only) to the active session.
            ticket 24 — standalone chat has no project, so no creative context to show; a compact hint
            replaces the panel and points at promote-to-project. */}
        <PanelSplitter value={this.state.prodPanelW} onChange={w => this.setProdPanelW(w)} onCommit={w => this.commitProdPanelW(w)}
          min={PROD_MIN} max={PROD_MAX} defaultValue={PROD_DEFAULT} side="right" label="Resize production panel"
          onToggleCollapse={this.props.pid ? () => this.toggleProdPanelCollapse() : undefined} />
        {this.props.pid
          ? <ProductionPanel ref={this.prodPanelRef} app={this.props.app} pid={this.props.pid} pdef={this.props.pdef}
              activeId={activeId} styleLocks={this.props.app.state.styleLocks} width={this.state.prodPanelW} />
          : this.renderStandaloneRail()}
        {/* ticket 18 — attached-image viewer: click a thumbnail on a user bubble to open it full-size */}
        {this.state.lightbox && (
          <RenderLightbox src={this.state.lightbox.src} kind="image" keyboard
            onClose={() => this.setState({ lightbox: null })}
            caption={<span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--fg-muted)' }}>{this.state.lightbox.name}</span>} />
        )}
      </div>
    );
  }
}
