// Quick Generate — a generation console that lives INSIDE the project page, so the user never
// leaves the project to compose → generate → review → act.
//
// THE COMPOSER IS frontend/Composer.jsx. The bespoke chip-row console that used to live here —
// its own IMAGE/VIDEO switch, six hand-rolled pills, four popover bodies, a private popover shell
// and a duplicate modelName() — is gone. This was the last bespoke composer in the app; chat, the
// shot workspace and this console now render the same bar, the same TECH popover and the same ✦
// FRAGMENTS panel. Do not re-grow a second one here.
//
// What this file still owns, because it is genuinely surface-specific:
//   · the SUBMIT path and its two money guards (see submit()) — the /api/generate ⇄ /api/batches
//     fork is real logic and Composer is deliberately presentational.
//   · billModel()'s implicit FAL edit-model routing when references attach.
//   · the reference pool strip, the drag-a-result-onto-the-composer well, and the ITERATE band.
//   · the whole results half: grid, filters, multi-select, preview panel, fullscreen viewer.
//
// IMAGE ⇄ VIDEO is no longer a stored mode. It is DERIVED from the effective model (isVideo()),
// the same rule Composer's TECH popover applies to its OUTPUT filter — two sources of truth for
// "what am I making" is how a UI ends up claiming Video with a still model armed.
//
// Style and camera are no longer typed into the prompt: they live as two serializable objects in
// state (`style`, `camera`), are edited in the StyleLab overlay, and are turned into prompt text
// by lookBuilder at submit time. See composed()/suffix().
//
// Props contract (App wires these in renderProject):
//   app             — the god-class; app.setState / app.sync() / app.showToast()
//   proj            — the live project def (pdef): { id, name, context:{folders,items}, gens,
//                     model? } — proj.model is the project's default IMAGE model (⚙ Project
//                     Settings), preferred over settings.modelDefaults.preview (see model()).
//   activeStyleLock — a full style record | null, owned by App (set from a project's default
//                     style, or by the global `s` overlay when the composer isn't mounted).
//                     RECONCILIATION: a style handed down here is seeded into state.style via
//                     styleFromLock() — which restores its PICKS, not just its prose — so the lab
//                     and the project default are two doors into ONE piece of state. composed()
//                     therefore reads state.style only and can never append a fragment twice.
//                     See syncLock().
//   onRequestStyleLock() — legacy callback, still accepted so App can force the picker open; the
//                     `s` key now opens the composer's own StyleLab instead.
import React from 'react';
import { sx } from './sx';
import { api } from './api';
import StyleLab from './StyleLab';
import { assetUrl } from './Moodboard';
import { RenderMedia, RenderTile, RenderLightbox, MediaAction } from './RenderMedia';
import { providerOfModel, modelById, estCost, isEditModel, isVideoModel, DEFAULT_RESOLUTION, DEFAULT_PREVIEW_MODEL, fmtSize, maxRefs } from './models';
import { ASPECTS, modelName } from './GenerationControls';
import Composer, { ComposerDock } from './Composer';
import { emptyStyle, emptyCamera, styleFragment, cameraFragment, styleFromLock, cameraFromLock, isStyleEmpty, isCameraEmpty, joinFragment, joinFragments, styleLabel } from './lookBuilder';
import { buildEntityPool } from './entities';
import { MONO } from './tokens';

// Above this estimated total the Generate button arms instead of firing. A 4× video batch is
// $1.60 and an 8× is $3.20, both two clicks from idle — cheap enough to reach by accident and
// expensive enough that "I meant to click that" has to be said out loud once.
const CONFIRM_SPEND = 1.00;
const CONFIRM_MS = 4000;
// Is the keyboard currently inside something the user is typing into? The ⌥digit batch shortcut
// runs before the review keymap's own field bail, so it needs its own answer — on a German Apple
// layout ⌥8 is `{`, and swallowing that keystroke to silently arm an 8× batch is a $3.20 typo.
const inField = t => {
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = (t.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};
const isFal = m => providerOfModel(m) === 'fal'; // only FAL auto-reroutes a plain t2i model → edit
// private drag mime — identifies a result-card drag during dragover, where getData() is blocked
const DND = 'application/x-frameforge-gen';
// running rides the marked/running blue channel (DESIGN.md) — a state, never the accent
const stC = { queued: 'var(--fg-faint)', running: 'var(--marked)', done: 'var(--ok)', failed: 'var(--danger)' };
// the badge on a finished card reflects the REVIEW decision, not just delivery: a done generation
// is "DONE" only until the user decides — then it reads KEPT ✓ / KILLED ✕.
const reviewBadge = g => {
  if (g.status !== 'done') return { label: (g.status || '').toUpperCase(), color: stC[g.status] || 'var(--fg-faint)' };
  if (g.reviewState === 'kept') return { label: g.final ? 'FINAL ✓' : 'KEPT ✓', color: 'var(--ok)' };
  if (g.reviewState === 'killed') return { label: 'KILLED ✕', color: 'var(--danger)' };
  return { label: 'NEEDS REVIEW', color: 'var(--accent)' };
};

export class ProjectGenerate extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      prompt: '', model: '', aspect: '16:9', resolution: DEFAULT_RESOLUTION, seed: '', refs: [],
      modelParams: {},    // spec-driven settings (ticket 05) — keyed by the model schema's field
                          // names, materialized by SchemaForm and passed to the payload as `params`.
                          // Reset to {} on every model change so one model's fields never leak into
                          // another's; SchemaForm re-applies the new model's spec defaults on load.
      style: emptyStyle(),   // lookBuilder selection — grade/light/atmosphere. Also the home of a
                             // style lock, which lands as style.override (see syncLock()).
      camera: emptyCamera(), // lookBuilder selection — framing/body/glass + movement. move/speed/
                             // stabilization are what the shared ✦ FRAGMENTS panel writes.
      cameraOverride: null,  // PROMPT · FULL in-place edit of the camera clause; null = derived.
                             // (style has no twin field — styleFragment() already honours
                             // style.override, lookBuilder's own edit slot.)
      studio: null,       // null | 'styles' | 'style' | 'camera' — open tab of the StyleLab overlay
      refsOpen: false,    // the project reference pool strip. Collapsed by default, always.
      shot: null,         // target shot id — the generation/batch is created linked to it
      variantCount: 1, maxSpend: '', // batch composer (Phase 7): 1 = single generate; 2/4/8 = batch
      busy: false, enhancing: null, undo: null,
      selId: null,        // review cursor — tracked by id so poll refreshes don't shift it
      marked: [],         // multi-select — gen ids ticked for a bulk action (checkbox · ⇧click · ⌘click · space)
      anchor: null,       // last cursor position a ⇧click range extends from
      confirmDel: false,  // delete is two-step: the button/key arms first, the second press commits
      confirmSpend: null, // armed estimated total ($) — Generate is two-step above CONFIRM_SPEND
      open: false,        // large inline preview panel
      sendOpen: false,    // "send to…" picker
      renaming: null,     // gen id being inline-renamed (renames the resulting item's name)
      renameText: '',
      savingLock: null,   // gen id being saved as a style lock (inline name input)
      lockNameText: '',
      ghost: null,        // selected gen's prompt, parked for the iterate loop
      zoom: null,         // gen id shown in the fullscreen viewer (f · double-click · ⤢)
      dragOver: false,    // a result is hovering the composer's reference well
      filterReview: 'all',// results filter: all | new (needs review) | kept | killed
      minRating: 0,       // rating filter — show only gens rated at least this many stars
      groupShot: false,   // group the results grid per shot (review-completeness view)
      tile: 200,          // gallery tile min-width in px — the bigger/smaller slider
      dims: {}            // file → {w,h} measured on load — covers records generated before the
                          // server started recording width/height (see noteDims)
    };
    this.taRef = React.createRef();
  }
  componentDidMount() {
    this._key = e => this.onKey(e);
    window.addEventListener('keydown', this._key, true); // capture — beats the app-level keymap
    // one-shot handoffs from other surfaces (palette, Prompt Builder, Model Catalog, shot rows) —
    // this composer is the only one (Phase 10A), so it must honor the old Generate.jsx contract
    const A = this.props.app.state;
    if (A.genPrompt || A.genModel || A.genShot) {
      const gs = A.genShot && (!A.genShot.proj || A.genShot.proj === this.pid()) ? A.genShot : null;
      const shot = gs ? (this.shots().find(s => s.id === gs.id) || gs) : null;
      this.setState({
        prompt: A.genPrompt || (shot ? (shot.prompt || shot.desc || '') : ''),
        model: A.genModel || '',
        shot: shot ? shot.id : null
      });
      this.props.app.setState({ genPrompt: null, genModel: null, genShot: null });
    }
    this.syncLock();
    // the ✦ FRAGMENTS panel lists saved looks — App fetches them lazily, so ask once on mount
    if (!(this.props.app.state.styleLocks || []).length && this.props.app.reloadStyleLocks) this.props.app.reloadStyleLocks();
  }
  componentDidUpdate(prev) { if (prev.activeStyleLock !== this.props.activeStyleLock) this.syncLock(); }
  componentWillUnmount() { window.removeEventListener('keydown', this._key, true); clearTimeout(this._spendT); }

  // ── style-lock reconciliation ────────────────────────────────────────────
  // App owns the lock (project.md seeding, the `s` picker, per-project map). The studio owns the
  // richer selection. Rather than let the two append separately — which would put the same fragment
  // in the prompt twice — a NEW lock overwrites state.style through styleFromLock(), and from that
  // moment the studio is the only reader.
  //
  // The guard is on record IDENTITY, not on lock.id. Keying it on the id was wrong twice over:
  // activeStyleLocks is client-only App state that sync() never rewrites, so the 2s poll it was
  // written to defend against does not exist — and every write path (applyStyleLock,
  // applyStyleSelection, seedStyleLockForProject, setDefaultStyleLock) mints a fresh `{...lock}`
  // record, so identity already changes exactly when a pick happens. Under the id guard, picking a
  // lock → editing the picks in the lab (which clears lockId) → picking the SAME lock again toasted
  // success and re-seeded nothing, stranding that lock until a different one was picked first.
  syncLock() {
    const lock = this.props.activeStyleLock;
    if (lock === this._lockSeed) return;
    this._lockSeed = lock;
    // Clearing the lock upstream is not a command to wipe the look — the picks stay, they just stop
    // being attributed to a lock.
    if (!lock) return;
    // A style can carry a camera half (lens, framing) as well as a look. cameraFromLock returns
    // null when it says nothing about the camera, which must leave the composer's own camera
    // alone rather than resetting it to defaults.
    const cam = cameraFromLock(lock);
    this.setState(s => ({ style: styleFromLock(lock), camera: cam || s.camera }));
  }

  pid() { return this.props.proj.id; }
  settings() { return this.props.app.state.settings || {}; }
  // DERIVED, never stored. Picking a video model in the shared TECH popover IS switching to video;
  // there is no separate mode flag that could disagree with the model actually armed.
  isVideo() { return isVideoModel(this.model()); }
  // per-project default (Project Settings ⚙ → Default model, project.md `model` frontmatter) wins
  // over the app-wide preview default — lets a project stick to one look's preferred model.
  // Deliberately does NOT consult isVideo(): that would recurse, and the OUTPUT filter in the TECH
  // popover already hands us a concrete video model the moment the user asks for one.
  model() {
    if (this.state.model) return this.state.model;
    const d = this.settings().modelDefaults || {};
    return (this.props.proj || {}).model || d.preview || DEFAULT_PREVIEW_MODEL;
  }
  // the camera-movement half of state.camera, which the shared ✦ FRAGMENTS panel edits
  setCam(patch) {
    this.disarmSpend(); // the outgoing prompt just changed under an armed confirm — re-ask
    // a new selection supersedes a hand-edited camera clause — same rule as syncLock for style
    this.setState(s => ({ camera: { ...s.camera, ...patch }, cameraOverride: null }));
  }
  // ✦ FRAGMENTS → STYLE. The panel speaks in style-lock ids; App owns the per-project active lock
  // and syncLock() is what turns it into state.style, so the pick is routed through App rather than
  // written here — that keeps ONE seeding path and preserves the identity guard in syncLock().
  setLook(id) {
    const { app } = this.props;
    const pid = this.pid();
    const lock = id ? (app.state.styleLocks || []).find(l => l.id === id) : null;
    this.disarmSpend();
    if (!lock) {
      // Clearing the project lock also clears the look it seeded — the composer is the only reader.
      app.setState(s => ({ activeStyleLocks: { ...s.activeStyleLocks, [pid]: null } }));
      this._lockSeed = null;
      this.setState({ style: emptyStyle() });
      return;
    }
    app._styleLockTarget = pid;
    app.applyStyleLock(lock);
  }
  // newest first — stable across the 2s /api/state poll
  gens() { return (this.props.proj.gens || []).slice().sort((a, b) => (b.started || 0) - (a.started || 0)); }
  selected() { return this.gens().find(g => g.id === this.state.selId) || null; }
  // the results grid + keyboard cursor operate on the FILTERED list, so ←/→ never lands on a hidden card
  visibleGens() {
    const S = this.state;
    return this.gens().filter(g => {
      if (S.filterReview === 'new' && !(g.status === 'done' && (g.reviewState === 'new' || !g.reviewState))) return false;
      if (S.filterReview === 'kept' && g.reviewState !== 'kept') return false;
      if (S.filterReview === 'killed' && g.reviewState !== 'killed') return false;
      if (S.minRating > 0 && (g.rating || 0) < S.minRating) return false;
      return true;
    });
  }
  // project context images are the reference pool (favorites first)
  pool() {
    return (((this.props.proj || {}).context || {}).items || [])
      .filter(c => c.type === 'image')
      .sort((a, b) => ((b.meta?.fav ? 1 : 0) - (a.meta?.fav ? 1 : 0)));
  }
  boards() { return (((this.props.proj || {}).context || {}).folders || []); }
  shots() { return (this.props.app.state.shots || []).filter(s => s.proj === this.pid()); }
  // the model an actual generation will bill at — FAL reroutes to the edit model when refs attach
  billModel() {
    const m = this.model();
    return this.state.refs.length && isFal(m) && !isEditModel(m) ? ((this.settings().modelDefaults || {}).edit || m) : m;
  }
  // The spec-driven settings as a payload fragment: `{ params }` when SchemaForm has produced any,
  // else `{}` so a model with no extra spec sends byte-for-byte what it always did. Empty strings and
  // half-typed numerics (a bare '-' mid-edit) are dropped rather than shipped to a provider.
  paramsField() {
    const src = this.state.modelParams || {};
    const params = {};
    for (const [k, val] of Object.entries(src)) {
      if (val === undefined || val === null || val === '' || val === '-') continue;
      params[k] = val;
    }
    return Object.keys(params).length ? { params } : {};
  }

  // ── "can this actually succeed?" ─────────────────────────────────────────
  // Most of the video catalog is image-to-video, and providers.mjs only carries a still through
  // when refs are attached (runFal sets input.image_url, runKie payload.imageUrl and
  // runHiggsfield --start-image all inside `if (refUrls?.length)`). With no reference the provider
  // is handed a bare prompt and rejects it — so flip-to-VIDEO-and-type fails after the click, and
  // in an 8× batch it fails eight times. Scoped to the models that genuinely need a frame: the
  // ids that say image-to-video plus the CLI entries whose catalog note marks them i2v. Kie's
  // veo-3.1/sora2 and the Arcads video tools take a bare prompt, so they are left alone.
  needsRefFrame() {
    if (!this.isVideo()) return false;
    const id = this.model();
    return /image-to-video/.test(String(id)) || /\bi2v\b/i.test((modelById(id) || {}).note || '');
  }
  // The one sentence that explains why Generate is dead, or null when it isn't. Rendered next to
  // the reference row AND on the button, so the state is legible before the click rather than
  // after the provider's error comes back.
  blockReason() {
    if (this.needsRefFrame() && !this.state.refs.length) {
      return modelName(this.model()) + ' animates a still — attach a reference frame first';
    }
    return null;
  }

  select(id) { this.setState({ selId: id, anchor: id, confirmDel: false, ghost: (this.gens().find(g => g.id === id) || {}).prompt || null, sendOpen: false, renaming: null }); }
  move(delta) {
    const gs = this.visibleGens();
    if (!gs.length) return;
    const ix = gs.findIndex(g => g.id === this.state.selId);
    const next = ix < 0 ? 0 : Math.max(0, Math.min(gs.length - 1, ix + delta));
    this.select(gs[next].id);
  }

  // ── multi-select ─────────────────────────────────────────────────────────
  // `marked` is the bulk-action set and is deliberately independent of `selId` (the review cursor):
  // walking the grid with ←/→ must never disturb a set the user built up by hand. Every bulk action
  // falls back to the cursor when nothing is ticked, so the buttons are never dead.
  isMarked(id) { return this.state.marked.includes(id); }
  markToggle(id) {
    this.setState(s => ({ marked: s.marked.includes(id) ? s.marked.filter(x => x !== id) : [...s.marked, id], anchor: id, confirmDel: false }));
  }
  // ⇧click — extend from the anchor across the FILTERED order, so a range never picks up hidden cards
  markRange(id) {
    const gs = this.visibleGens();
    const a = gs.findIndex(g => g.id === (this.state.anchor || this.state.selId));
    const b = gs.findIndex(g => g.id === id);
    if (a < 0 || b < 0) { this.markToggle(id); return; }
    const span = gs.slice(Math.min(a, b), Math.max(a, b) + 1).map(g => g.id);
    this.setState(s => ({ marked: Array.from(new Set([...s.marked, ...span])), selId: id, confirmDel: false }));
  }
  markAdd(ids) {
    const add = ids.filter(Boolean);
    this.setState(s => ({ marked: Array.from(new Set([...s.marked, ...add])), confirmDel: false }));
  }
  clearMarks() { this.setState({ marked: [], confirmDel: false }); }
  markAllVisible() {
    const ids = this.visibleGens().map(g => g.id);
    // second press of ⌘A on a fully-marked grid clears — the same key both ways, no dead end
    this.setState(s => ({ marked: ids.every(i => s.marked.includes(i)) ? [] : ids, confirmDel: false }));
  }
  // the set a bulk action applies to: what's ticked, else the cursor
  targets() {
    const S = this.state;
    if (S.marked.length) { const by = new Map(this.gens().map(g => [g.id, g])); return S.marked.map(id => by.get(id)).filter(Boolean); }
    const g = this.selected();
    return g ? [g] : [];
  }

  async bulkKeep() {
    const { app } = this.props;
    const list = this.targets().filter(g => g.status === 'done');
    if (!list.length) { app.showToast('Nothing finished to keep', 'var(--danger)'); return; }
    for (const g of list) {
      if (g.shot) await api.saveGenToShot(this.pid(), g.id).catch(() => { });
      else await api.reviewCandidate(this.pid(), g.id, { patch: { reviewState: 'kept' } }).catch(() => { });
    }
    this.clearMarks(); app.sync();
    app.showToast(list.length + ' kept', 'var(--ok)');
  }
  async bulkKill() {
    const { app } = this.props;
    const list = this.targets();
    if (!list.length) return;
    for (const g of list) await api.reviewCandidate(this.pid(), g.id, { patch: { reviewState: 'killed' } }).catch(() => { });
    this.clearMarks(); app.sync();
    app.showToast(list.length + ' killed — staged for cleanup', 'var(--danger)');
  }
  // Two-step by design: this stages files into .trash (recoverable from the Trash page) but it still
  // removes the record, so a stray ⌫ on a 40-card selection should never land on the first press.
  async bulkDelete() {
    const { app } = this.props;
    const list = this.targets();
    if (!list.length) return;
    if (!this.state.confirmDel) { this.setState({ confirmDel: true }); return; }
    for (const g of list) await api.deleteGen(this.pid(), g.id).catch(() => { });
    this.setState({ marked: [], confirmDel: false, open: false, sendOpen: false, renaming: null });
    this.move(0); // clamp the cursor onto a surviving neighbour
    app.sync();
    app.showToast(list.length + ' deleted — recoverable from Trash', 'var(--danger)');
  }

  attach(c) {
    const S = this.state;
    if (S.refs.some(r => r.scope === c.scope && r.name === c.name && (r.folder || '') === (c.folder || ''))) {
      this.setState({ refs: S.refs.filter(r => !(r.scope === c.scope && r.name === c.name && (r.folder || '') === (c.folder || ''))) });
      return;
    }
    const cap = maxRefs(this.model());
    if (S.refs.length >= cap) { this.props.app.showToast(modelName(this.model()) + ' takes ' + cap + ' reference' + (cap === 1 ? '' : 's'), 'var(--danger)'); return; }
    this.setState({ refs: [...S.refs, { scope: this.pid(), name: c.name, folder: c.folder || '', meta: c.meta }] });
  }
  // Attach a finished generation as a reference — the image-to-image loop without a round-trip
  // through the library. kind:'render' tells the server to resolve the path under renders/ rather
  // than the asset scope. Refs on a plain FAL t2i model auto-route to the configured edit model.
  attachGen(g) {
    const S = this.state;
    if (!g || g.status !== 'done' || !g.file) { this.props.app.showToast('Only finished generations can be used as a reference', 'var(--danger)'); return; }
    if (/\.mp4$/.test(g.file)) { this.props.app.showToast('Video results can’t be used as an image reference', 'var(--danger)'); return; }
    if (S.refs.some(r => r.kind === 'render' && r.name === g.file)) return; // already attached — no-op
    const cap = maxRefs(this.model());
    if (S.refs.length >= cap) { this.props.app.showToast(modelName(this.model()) + ' takes ' + cap + ' reference' + (cap === 1 ? '' : 's'), 'var(--danger)'); return; }
    this.setState({ refs: [...S.refs, { kind: 'render', scope: this.pid(), name: g.file, folder: '', gen: g.id }] });
    this.props.app.showToast('Reference attached — ' + (g.label || g.id), 'var(--accent)');
  }
  // thumbnail source for a ref chip — renders and library assets live on different routes
  refUrl(r) { return r.kind === 'render' ? api.renderUrl(this.pid(), r.name) : assetUrl(r.scope, r.name, r.folder); }

  // ── resolution readout ───────────────────────────────────────────────────
  // The server records the delivered pixel size on new generations. Older records predate that,
  // so any <img> that renders also reports its intrinsic size back here — the label is always the
  // truth about the file on disk, never the request.
  noteDims(file, el) {
    if (!file || !el || !el.naturalWidth) return;
    if (this.state.dims[file]) return;
    this.setState(s => ({ dims: { ...s.dims, [file]: { w: el.naturalWidth, h: el.naturalHeight } } }));
  }
  sizeLabel(g) {
    if (!g) return '';
    if (g.width && g.height) return fmtSize(g.width, g.height);
    const d = this.state.dims[g.file];
    return d ? fmtSize(d.w, d.h) : '';
  }

  // ── drag & drop ──────────────────────────────────────────────────────────
  // A result card carries its generation id on a private mime type. dragPayload() answers "is this
  // drag ours?" during dragover (where dataTransfer.getData() is blocked by the browser), so the
  // well only lights up for drags we can actually accept.
  dragPayload(e) { return Array.from(e.dataTransfer?.types || []).includes(DND); }
  startDrag(e, g) {
    if (!g || g.status !== 'done' || !g.file) return;
    e.dataTransfer.setData(DND, g.id);
    e.dataTransfer.setData('text/plain', g.prompt || g.id); // dropping outside pastes the prompt
    e.dataTransfer.effectAllowed = 'copy';
  }
  onDrop(e) {
    if (!this.dragPayload(e)) return;
    e.preventDefault();
    this.setState({ dragOver: false });
    const id = e.dataTransfer.getData(DND);
    const g = this.gens().find(x => x.id === id);
    if (g) this.attachGen(g);
  }

  // The cinematography half of the outgoing prompt: style clause, then camera clause. joinFragments
  // owns every seam — it strips stray edge commas (an empty half must never leave a ', ,' or a
  // dangling comma) AND decides comma-vs-period per join, because these halves are not always
  // clauses: a movement-only camera and a hand-typed multi-sentence override are both whole prose,
  // and comma-splicing an imperative onto a noun phrase is what we're avoiding.
  // each half separately, honouring PROMPT · FULL's in-place edits: style.override is
  // lookBuilder's own edit slot; the camera clause gets a sibling field here.
  styleFrag() { return styleFragment(this.state.style); }
  camFrag() {
    if (this.state.cameraOverride != null) return this.state.cameraOverride.trim();
    return cameraFragment(this.state.camera, { video: this.isVideo() });
  }
  suffix() {
    return joinFragments(this.styleFrag(), this.camFrag());
  }
  // the outgoing prompt: draft + style + camera. The active style lock is NOT read here — it was
  // seeded into state.style by syncLock(), so styleFragment() already carries it exactly once.
  composed() {
    const raw = this.state.prompt.trim();
    const sfx = this.suffix();
    // No suffix means the draft IS the outgoing prompt — the user's own punctuation is theirs and
    // must survive untouched, trailing period and all. joinFragment would strip the trailing comma
    // off a draft it has nothing to join, so this early return is load-bearing, not a shortcut.
    if (!sfx) return raw;
    // Everything else is joinFragment's call. A clause suffix takes the draft's terminal period off
    // and comma-joins ('A wide shot.' + '85mm' → 'A wide shot, 85mm'); a sentence suffix keeps it
    // and joins with a space. The draft's own trailing comma goes either way — the starter-pack
    // look snippets are written to be pasted mid-list and routinely leave one behind, which is
    // what produced 'A wide shot,, A cinematic film still'.
    return joinFragment(raw, sfx);
  }
  // Cmd/Ctrl+Enter and the primary button both route here: single generate, or a batch when the
  // variant count is > 1 (Phase 7). Batches snapshot the composed prompt + style lock at queue time.
  //
  // This is also the ONE place the two money guards live, so ⌘⏎ and the button can never disagree:
  //   · nothing to send at all → say so, never a silent no-op
  //   · a video model that needs a still and has none → say what to attach
  //   · an estimate over CONFIRM_SPEND → arm the button, commit on the second press
  submit() {
    const { app } = this.props;
    const S = this.state;
    if (S.busy) return;
    // composed(), not state.prompt: a style with an empty draft is a legitimate generation, and
    // guarding the batch path on the raw draft is what made 4× a silent no-op where 1× fired.
    if (!this.composed()) { app.showToast('Nothing to generate — write a prompt or pick a style', 'var(--danger)'); return; }
    const blocked = this.blockReason();
    if (blocked) { app.showToast(blocked, 'var(--danger)'); return; }
    const total = estCost(this.billModel()) * S.variantCount;
    if (total > CONFIRM_SPEND && S.confirmSpend == null) { this.armSpend(total); return; }
    this.disarmSpend();
    return S.variantCount > 1 ? this.queueBatch() : this.go();
  }
  // Two-stage in the same idiom as confirmDel/renaming/savingLock: transient state on the class,
  // the control itself says what the second press will do, and it lapses on its own so an armed
  // button is never left lying around for a later stray click to find.
  armSpend(total) {
    clearTimeout(this._spendT);
    this._spendT = setTimeout(() => this.setState({ confirmSpend: null }), CONFIRM_MS);
    this.setState({ confirmSpend: total });
  }
  disarmSpend() {
    clearTimeout(this._spendT);
    if (this.state.confirmSpend != null) this.setState({ confirmSpend: null });
  }
  async queueBatch() {
    const { app } = this.props;
    const S = this.state;
    const prompt = this.composed();
    if (S.busy || !prompt || !this.pid()) return;
    this.setState({ busy: true });
    try {
      const batch = await api.createBatch({
        pid: this.pid(), shotIds: S.shot ? [S.shot] : [], prompt, model: this.model(), aspect: S.aspect, resolution: S.resolution,
        // No `duration` here, and none in go() either. The UI used to offer 4/6/8/10s and send it
        // on both paths, but no backend route destructures it — providers.mjs hardcodes 5s — so the
        // picker was a lie the UI told the user. Re-adding it means: per-model duration ranges
        // declared in frontend/modelCatalog.js (kie/kling-2.6 is 5-10s, so 4s was never valid),
        // then plumbed index.mjs → generate.mjs → providers.mjs with clamping per model, on BOTH
        // this path and go() together.
        // Deliberately EMPTY, and the composed prompt goes in whole. The server joins
        // prompt + ' ' + styleLockFragment (batches.mjs), where a single generate joins with ', ' —
        // splitting the suffix across the two fields would make a batch and a single generate from
        // identical settings produce prompts that differ by one character. Composing here is the
        // only way to guarantee they are byte-identical without touching the backend.
        styleLockFragment: '',
        variantCount: S.variantCount, baseSeed: S.seed === '' ? null : Number(S.seed),
        maxSpend: S.maxSpend === '' ? null : Number(S.maxSpend),
        refs: S.refs.map(r => ({ kind: r.kind || 'asset', scope: r.scope, name: r.name, folder: r.folder })),
        // Spec-driven per-model settings (ticket 05) — same passthrough as the single-generate path,
        // so a batch and a single generate from identical settings bill the model the same way.
        ...this.paramsField()
      });
      app.showToast('Batch queued — ' + (batch.entries || []).length + ' variants · est $' + Number(batch.estimatedCost || 0).toFixed(2), 'var(--accent)');
      app.sync();
    } catch (e) { app.showToast('Batch failed — ' + (e.message || ''), 'var(--danger)'); }
    this.setState({ busy: false });
  }
  async go() {
    const { app } = this.props;
    const S = this.state;
    const prompt = this.composed();
    if (S.busy || !prompt || !this.pid()) return;
    this.setState({ busy: true });
    try {
      const gen = await api.generate({
        pid: this.pid(), shot: S.shot || null, prompt, model: this.model(), aspect: S.aspect, resolution: S.resolution,
        seed: S.seed === '' ? null : Number(S.seed),
        // No `duration` — see queueBatch() for why it was removed and what re-adding requires.
        refs: S.refs.map(r => ({ kind: r.kind || 'asset', scope: r.scope, name: r.name, folder: r.folder })),
        // Spec-driven per-model settings (ticket 05). SchemaForm keys these by the model's own schema
        // field names, so no per-model branching is needed here; the provider layer (ticket 07) reads
        // them. Omitted entirely when empty, so a model with no extra spec sends exactly what it did.
        ...this.paramsField()
      });
      this.select(gen.id);
      app.showToast('Generation queued — ' + this.model().split('/').pop(), 'var(--accent)');
      app.sync();
    } catch (e) { app.showToast('Generate failed — ' + (e.message || ''), 'var(--danger)'); }
    this.setState({ busy: false });
  }
  // NOTE: an earlier duplicate reroll() (raw api.generate with a random seed) lived here and was
  // silently shadowed by the candidate-lineage version below — the class body simply kept the
  // last definition. Removed; rerollCandidate is the one that records parentGeneration.

  async enhance(mode) {
    const { app } = this.props;
    const S = this.state;
    if (S.enhancing || !S.prompt.trim()) return;
    this.setState({ enhancing: mode });
    try {
      const b = await api.enhance(S.prompt, mode);
      this.setState({ undo: S.prompt, prompt: b.text || S.prompt });
      app.showToast('Prompt enhanced (' + mode + ') — press u to undo', 'var(--accent)');
    } catch (e) { app.showToast('Enhance failed — ' + (e.message || ''), 'var(--danger)'); }
    this.setState({ enhancing: null });
  }
  undoEnhance() {
    if (this.state.undo == null) return;
    this.setState({ prompt: this.state.undo, undo: null });
    this.props.app.showToast('Prompt restored', 'var(--fg-muted)');
  }
  // Loads the parked prompt back into the field. The focus hop is best-effort now: the prompt
  // field belongs to Composer, which owns its own SnippetText instance, so taRef is only wired
  // when a surface hands one down. Setting the text is the load-bearing half and always happens.
  loadGhost() {
    if (!this.state.ghost) return;
    this.setState({ prompt: this.state.ghost }, () => {
      const el = this.taRef.current;
      if (el && typeof el.focus === 'function') el.focus({ toEnd: true });
    });
  }

  async keep(g) {
    const { app } = this.props;
    if (!g || g.status !== 'done') { app.showToast('Nothing to keep yet — wait for it to finish', 'var(--danger)'); return; }
    try {
      // Phase 2: keeping marks the candidate kept (the generation record IS the candidate) and — for
      // a shot-linked candidate — selects it for the shot when none is selected yet. No _gen item.
      if (g.shot) { const r = await api.saveGenToShot(this.pid(), g.id); app.showToast('Kept for ' + r.shot + (r.selected ? ' · selected' : ''), 'var(--ok)'); }
      else { await api.reviewCandidate(this.pid(), g.id, { patch: { reviewState: 'kept' } }); app.showToast('Candidate kept', 'var(--ok)'); }
      app.sync();
    } catch (e) { app.showToast('Keep failed — ' + (e.message || ''), 'var(--danger)'); }
  }
  async kill(g) {
    const { app } = this.props;
    if (!g) return;
    try { await api.reviewCandidate(this.pid(), g.id, { patch: { reviewState: 'killed' } }); app.showToast('Candidate killed — staged for cleanup', 'var(--danger)'); app.sync(); }
    catch (e) { app.showToast('Kill failed — ' + (e.message || ''), 'var(--danger)'); }
  }
  // freshSeed defaults ON: "re-roll" means give me another take. Re-running the same prompt with
  // the same seed is a re-render, not a roll — call it explicitly with false if that's what you want.
  async reroll(g, freshSeed = true) {
    const { app } = this.props;
    if (!g) return;
    try { await api.rerollCandidate(this.pid(), g.id, { freshSeed: !!freshSeed }); app.showToast('Reroll queued' + (freshSeed ? ' — fresh seed' : ''), 'var(--accent)'); app.sync(); }
    catch (e) { app.showToast('Reroll failed — ' + (e.message || ''), 'var(--danger)'); }
  }
  async discard(g) {
    const { app } = this.props;
    if (!g) return;
    await api.deleteGen(this.pid(), g.id).catch(() => { });
    this.setState({ open: false, sendOpen: false, renaming: null });
    this.move(0); // clamp cursor onto a surviving neighbour
    app.sync();
    app.showToast('Generation discarded', 'var(--danger)');
  }
  async sendTo(g, target) {
    const { app } = this.props;
    this.setState({ sendOpen: false });
    try {
      if (target.kind === 'shot') {
        // save-to-shot now accepts an explicit target shot id — attach to any shot the user picks
        const r = await api.saveGenToShot(this.pid(), g.id, target.id); app.showToast('Kept for ' + (r.shot || target.id), 'var(--ok)');
      } else {
        const s = await api.saveGenToBoard(this.pid(), g.id, target.folder); app.showToast('Saved to board — ' + (target.folder || 'root'), 'var(--ok)');
      }
      app.sync();
    } catch (e) { app.showToast('Send failed — ' + (e.message || ''), 'var(--danger)'); }
  }
  startRename(g) {
    const { app } = this.props;
    if (!g || g.status !== 'done') { app.showToast('Wait for it to finish before renaming', 'var(--danger)'); return; }
    this.setState({ renaming: g.id, renameText: g.label || '' });
  }
  async commitRename(g) {
    const { app } = this.props;
    const name = this.state.renameText.trim();
    this.setState({ renaming: null });
    if (!g || !name) return;
    // Phase 2: the candidate label lives on the generation record itself
    try { await api.reviewCandidate(this.pid(), g.id, { patch: { label: name } }); app.showToast('Renamed → ' + name, 'var(--ok)'); app.sync(); }
    catch (e) { app.showToast('Rename failed — ' + (e.message || ''), 'var(--danger)'); }
  }
  copyPrompt(g) {
    const text = (g && g.prompt) || this.composed();
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => { });
    this.props.app.showToast('Prompt copied', 'var(--accent)');
  }
  // save-as-style-lock — inline name input, default = the saved item's name (or shot/gen id) + " style"
  startSaveLock(g) {
    const { app } = this.props;
    if (!g) return;
    const it = g.savedTo ? (app.state.items || []).find(x => x.id === g.savedTo) : null;
    const base = (it && (it.label || it.name)) || g.shot || 'Generation';
    this.setState({ savingLock: g.id, lockNameText: base + ' style' });
  }
  commitSaveLock(g) {
    const { app } = this.props;
    const name = this.state.lockNameText.trim();
    this.setState({ savingLock: null, lockNameText: '' });
    if (!g || !name) return;
    const refPath = g.file ? (app.state.storageRoot + '/projects/' + this.pid() + '/renders/' + g.file) : '';
    app.saveStyleLockFrom({ name, prompt: g.prompt || '', refPath });
  }

  // capture-phase key handler — inert while typing (INPUT/TEXTAREA) and while the palette owns keys.
  // Decision: ←/→ and j move the cursor (j = next). k is KEEP (overrides vim-up) since the arrows
  // already cover navigation and keep is the hot path. All actions target the selected generation.
  onKey(e) {
    // The Style Studio runs its own capture-phase listener and owns the keyboard outright while
    // it is up — same contract the palette already has below. Bail before the Option+digit branch
    // so a batch shortcut can't fire behind the overlay either.
    if (this.state.studio) return;
    const tag = (e.target.tagName || '').toUpperCase();
    const typing = inField(e.target);
    // Option/Alt+2/4/8 set the batch variant count (Phase 7). e.code is layout-stable (Alt+digit
    // produces a special character in e.key on macOS) — which is exactly the problem this branch
    // used to have: it deliberately ran BEFORE the field bail, and on a German Apple layout ⌥8 is
    // `{`, ⌥5 `[`, ⌥6 `]`. Typing a brace into the prompt swallowed the character and silently
    // armed an 8× batch, so the next ⌘⏎ queued eight video calls — $3.20 from a keystroke the user
    // meant as punctuation. Outside a field the shortcut keeps working, and it now announces the
    // count and its cost so a batch can never change size in silence.
    if (e.altKey && !e.metaKey && !e.ctrlKey && /^Digit[248]$/.test(e.code) && !typing) {
      e.preventDefault();
      const n = Number(e.code.slice(5));
      const total = estCost(this.billModel()) * n;
      this.disarmSpend(); // the estimate just moved — an armed Generate no longer means what it said
      this.setState({ variantCount: n });
      this.props.app.showToast('Batch ' + n + '× · ≈ $' + total.toFixed(total >= 1 ? 2 : 3), 'var(--accent)');
      return;
    }
    if (typing || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return; // composer / rename own their keys
    // ⌘/Ctrl+A marks every visible card — checked before the modifier bail below, which drops
    // everything else so browser/app chords keep working.
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'a' && !this.props.app.state.paletteOpen) {
      e.preventDefault(); e.stopPropagation(); this.markAllVisible(); return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (this.props.app.state.paletteOpen) return;
    const k = e.key.toLowerCase();
    const g = this.selected();
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    // the fullscreen viewer owns the keyboard while it's up — Esc closes it first, arrows walk it
    if (this.state.zoom) {
      if (k === 'escape') { stop(); this.setState({ zoom: null }); return; }
      if (k === 'arrowright' || k === 'j') { stop(); this.zoomMove(1); return; }
      if (k === 'arrowleft') { stop(); this.zoomMove(-1); return; }
      if (k === 'f') { stop(); this.setState({ zoom: null }); return; }
    }
    // Esc unwinds one layer at a time, most transient first
    if (k === 'escape') {
      if (this.state.confirmDel) { stop(); this.setState({ confirmDel: false }); }
      else if (this.state.sendOpen) { stop(); this.setState({ sendOpen: false }); }
      else if (this.state.open) { stop(); this.setState({ open: false }); }
      else if (this.state.marked.length) { stop(); this.clearMarks(); }
      return;
    }
    // ⌫/Del — bulk delete (marked set, else the cursor). Armed on the first press, commits on the second.
    if (k === 'backspace' || k === 'delete') { stop(); this.bulkDelete(); return; }
    // ⇧←/→ extends the marked run while walking, the way a file list does
    if (e.shiftKey && (k === 'arrowright' || k === 'arrowleft')) {
      stop();
      const gs = this.visibleGens();
      const ix = gs.findIndex(x => x.id === this.state.selId);
      const next = gs[Math.max(0, Math.min(gs.length - 1, (ix < 0 ? 0 : ix) + (k === 'arrowright' ? 1 : -1)))];
      if (next) { this.markAdd([ix >= 0 && gs[ix] ? gs[ix].id : null, next.id]); this.setState({ selId: next.id }); }
      return;
    }
    if (k === 'arrowright' || k === 'j') { stop(); this.move(1); return; }
    if (k === 'arrowleft') { stop(); this.move(-1); return; }
    // ↑ loads the selected generation's prompt back into the composer — the key both the ITERATE
    // band and the preview panel already advertise, and until now bound to nothing. Guarded on the
    // ghost so ↑ with nothing parked still scrolls the page.
    if (k === 'arrowup' && this.state.ghost) { stop(); this.loadGhost(); return; }
    if (k === ' ') { stop(); if (this.state.selId) this.markToggle(this.state.selId); return; } // space = tick/untick
    if (k === 'u') { stop(); this.undoEnhance(); return; }
    // s = your saved styles, c = the camera axes. Same window, two doors: the lab opens on the
    // tab you asked for, and picking a saved style or building a new one both land in
    // state.style / state.camera the same way. (This used to hand off to a separate App-owned
    // picker overlay that could only pick, never build.)
    if (k === 's') { stop(); this.setState({ studio: 'styles' }); return; }
    if (k === 'c') { stop(); this.setState({ studio: 'camera' }); return; }
    // f = fullscreen, and this surface consumes it whether or not a card is selected. It sits ABOVE
    // the `!g` bail deliberately: `selId` starts null on every mount and project switch, so a bare
    // `f` used to fall through to the GLOBAL feedback shortcut (App.jsx) in this tab's DEFAULT
    // state — one key meaning two things, discriminated by an invisible cursor. Same contract `s`
    // already has: a surface that advertises a key owns it, selection or not.
    if (k === 'f') { stop(); if (g && g.file) this.setState({ zoom: g.id }); return; }
    if (!g) return;
    if (k === 'enter') { stop(); this.setState(s => ({ open: !s.open })); }
    else if (k === 'd') { stop(); this.attachGen(g); } // d = use as reference (the i2i loop)
    else if (k === 'k') { stop(); this.keep(g); }
    else if (k === 'x') { stop(); this.kill(g); } // x = kill (mark, reversible) — delete lives in the panel
    else if (k === 'r') { stop(); this.reroll(g); }
    else if (k === 'e') { stop(); this.startRename(g); }
    else if (k === 'a') { stop(); this.setState(s => ({ sendOpen: !s.sendOpen, open: true })); }
    else if (k === 'p') { stop(); this.copyPrompt(g); }
  }

  render() {
    const { app } = this.props;
    const S = this.state;
    const gens = this.visibleGens();
    const sel = this.selected();
    const pool = this.pool();
    return (
      // 240px tail: the dock is position:fixed, so the page must reserve room for the last
      // gallery row to scroll clear of the floating bar
      <div style={sx('padding:18px 24px 240px')}>
        {this.renderResults(gens, sel)}
        {S.open && sel && this.renderPreview(sel)}
        {/* the composer floats at the BOTTOM, like the chat bar — the gallery is the page, the
            bar hovers over it. Placement comes from ComposerDock, the ONE dock recipe every
            surface shares — do not wrap the bar in a hand-rolled positioner again. */}
        <ComposerDock>{this.renderComposer(pool)}</ComposerDock>
        {S.zoom && this.renderZoom(gens.find(g => g.id === S.zoom))}
        {S.studio && (
          // One surface for picking a saved style, building a new one, and rendering its preview
          // — the composer no longer needs a separate picker overlay. StyleLab owns its own
          // save/delete/favourite I/O, so there is no onSaveLock hop through App any more.
          <StyleLab app={app} tab={S.studio} video={this.isVideo()}
            style={S.style} camera={S.camera} locks={app.state.styleLocks || []}
            onApply={r => this.applyStudio(r)}
            onClose={() => this.setState({ studio: null })} />
        )}
      </div>
    );
  }

  // The studio hands back a whole selection plus, when a preset was used, the frame shape that
  // preset implies. A null aspect means "this preset maps to a ratio the composer can't show" —
  // leave the user's current aspect alone rather than snapping it to something arbitrary.
  applyStudio({ style, camera, aspect }) {
    const patch = { style, camera };
    if (aspect && ASPECTS.includes(aspect)) patch.aspect = aspect;
    this.disarmSpend(); // the outgoing prompt just changed under an armed confirm — re-ask
    this.setState(patch);
    // DEV-127 acceptance 2 — a style SAVED in the lab comes back carrying its new lockId (StyleLab
    // sets it in save()). The look chips read App's active lock, not this draft, so without this
    // the user saves a style, lands back in the composer, and sees nothing selected. Make it the
    // active look. Guarded on it being a different lock so re-applying an already-active one is a
    // no-op rather than a redundant App round-trip.
    const { app } = this.props;
    const lockId = style && style.lockId;
    if (lockId && lockId !== ((this.props.activeStyleLock || {}).id || '')) {
      const lock = (app.state.styleLocks || []).find(l => l.id === lockId);
      // A just-saved lock may not be in App's list yet (reloadStyleLocks is async), so fall back to
      // re-reading after it lands rather than silently dropping the selection.
      if (lock) { app._styleLockTarget = this.pid(); app.applyStyleLock(lock); }
      else app.reloadStyleLocks().then?.(() => {
        const l2 = (app.state.styleLocks || []).find(x => x.id === lockId);
        if (l2) { app._styleLockTarget = this.pid(); app.applyStyleLock(l2); }
      });
    }
  }

  // Fullscreen viewer — the missing "just let me look at it big" surface. ←/→ walk the results
  // without leaving it, Esc closes, and the actions that matter most while looking are one key away.
  renderZoom(g) {
    if (!g || !g.file) return null;
    const isVid = /\.mp4$/.test(g.file);
    const url = api.renderUrl(this.pid(), g.file);
    // MediaAction (RenderMedia.jsx) is the ONE review chip — same pill as the shot workspace
    // stage, so the two fullscreen viewers read as one app.
    // Shared fullscreen viewer. Keyboard nav stays with this component's own capture-phase onKey
    // (the zoom branch there coordinates with the popover/preview layers), so RenderLightbox runs
    // with keyboard={false} and just owns the shell + the image/video branch. Drag-out (image →
    // composer reference) rides the same startDrag payload as the result cards.
    const actions = (
      <div onClick={e => e.stopPropagation()} style={sx('display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center')}>
        <MediaAction label="← Prev" onClick={() => this.zoomMove(-1)} />
        <MediaAction label="Next →" onClick={() => this.zoomMove(1)} />
        {/* keep · kill · re-roll — canonical order and tones */}
        <MediaAction label="Keep" hotkey="K" tone="ok" onClick={() => this.keep(g)} />
        <MediaAction label="Kill" hotkey="X" tone="danger" onClick={() => this.kill(g)} />
        <MediaAction label="Re-roll" hotkey="R" onClick={() => this.reroll(g)} />
        <MediaAction label="Use as reference" tone="accent" onClick={() => this.attachGen(g)} />
        <MediaAction label="Copy prompt" hotkey="P" onClick={() => this.copyPrompt(g)} />
        <MediaAction label="Close" hotkey="Esc" onClick={() => this.setState({ zoom: null })} />
      </div>
    );
    return (
      <RenderLightbox src={url} kind={isVid ? 'video' : 'image'}
        onClose={() => this.setState({ zoom: null })}
        draggable onDragStart={e => this.startDrag(e, g)}
        onMediaLoad={e => this.noteDims(g.file, e.currentTarget)}
        // standardized chrome — title/meta render the shared top strip, the string caption
        // renders as the shared clamped one-liner. No hand-rolled header/caption here again.
        title={g.label || g.id}
        meta={[(g.model || '').split('/').pop(), this.sizeLabel(g) || null,
          (g.aspect || '') + (g.resolution ? ' · ' + g.resolution : ''), '$' + (g.cost || 0).toFixed(3)]}
        actions={actions} caption={g.prompt || ''}
        /* DEV-132 — the size caps that used to live here (max-height:52vh) are gone. They existed
           because the composer below shared vertical space with the media; now the chrome floats
           OVER the media and fades when idle, so RenderLightbox governs the fit for every surface
           alike. Only the corner radius is a local concern. */
        mediaStyle={sx('border-radius:10px')}>
        {/* THE COMPOSER, inside the viewer — the whole point: look at the take and iterate on
            it without leaving. Same bar, same width as the dock everywhere else. */}
        <div onClick={e => e.stopPropagation()} style={sx('width:100%;display:flex;justify-content:center')}>
          <div style={{ ...sx('width:100%'), maxWidth: 760 }}>{this.renderComposer(this.pool())}</div>
        </div>
      </RenderLightbox>
    );
  }
  // walk the result list from inside the viewer, skipping anything with nothing to show yet
  zoomMove(delta) {
    const viewable = this.visibleGens().filter(g => g.file);
    if (!viewable.length) return;
    const ix = viewable.findIndex(g => g.id === this.state.zoom);
    const next = viewable[Math.max(0, Math.min(viewable.length - 1, (ix < 0 ? 0 : ix + delta)))];
    if (next) { this.select(next.id); this.setState({ zoom: next.id }); }
  }

  // ══ THE COMPOSER — frontend/Composer.jsx, unmodified ══
  // Everything that used to be six hand-rolled pills and four popover bodies now lives in the
  // shared bar: its TECH popover carries model · output kind · aspect · resolution · seed ·
  // variants and every per-model param (from the synced fal spec, never a hardcoded table), and
  // its ✦ FRAGMENTS popover is the SAME FragmentsPopoverBody the shot workspace opens.
  //
  // What stays outside the bar, because it belongs to this surface rather than to the composer:
  //   · the drop well — dragging a finished result anywhere onto this card attaches it as a
  //     reference (image-to-image). Composer's own onDropFiles is for FILES; this rides a private
  //     mime type, so the handlers stay on the wrapper.
  //   · ✦ quick / ✦ full prompt enhancement and its undo.
  //   · the ITERATE band and the collapsed project reference pool.
  renderComposer(pool) {
    const { app } = this.props;
    const S = this.state;
    const blocked = this.blockReason();
    const armed = S.confirmSpend != null;
    const fragLabel = [
      !this.isLookEmpty('style') ? 'style' : null,
      !this.isLookEmpty('camera') ? 'cam' : null,
      S.refs.length ? S.refs.length + ' ref' + (S.refs.length === 1 ? '' : 's') : null,
    ].filter(Boolean).join(' · ') || 'no look';
    return (
      <div
        onDragOver={e => { if (this.dragPayload(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!S.dragOver) this.setState({ dragOver: true }); } }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) this.setState({ dragOver: false }); }}
        onDrop={e => this.onDrop(e)}
        style={sx('position:relative;margin-bottom:20px')}>
        {S.dragOver && (
          <div style={{ ...sx('position:absolute;inset:-6px;z-index:20;display:flex;align-items:center;justify-content:center;border-radius:16px;pointer-events:none'), background: 'color-mix(in srgb, var(--surface) 86%, transparent)', border: '1px dashed var(--accent)' }}>
            <span style={sx('font-size:12.5px;font-weight:700;color:var(--accent);letter-spacing:.04em')}>Drop to use as a reference — image-to-image</span>
          </div>
        )}

        {/* Enhancement is the ONE thing the shared bar does not carry, and it only earns pixels
            once there is a prompt to enhance — an idle composer shows no extra chrome at all.
            The QUICK GENERATE eyebrow and the always-on billing note are gone (the note survives
            as a tooltip on the enhance row). */}
        {(S.prompt.trim() || S.undo != null) && (
          <div style={sx('display:flex;align-items:center;gap:7px;margin-bottom:8px;justify-content:flex-end')}
            title={S.refs.length ? 'image-to-image · billing as ' + modelName(this.billModel()) : undefined}>
            {S.refs.length > 0 && (
              <span style={{ ...sx('margin-right:auto'), fontFamily: MONO, fontSize: 9, color: 'var(--fg-faint)' }}>i2i · {modelName(this.billModel())}</span>
            )}
            {[['quick', '✦ quick'], ['full', '✦ full']].map(([m, l]) => (
              <span key={m} onClick={() => this.enhance(m)} className="hFg"
                style={{ ...sx('padding:2px 7px;border-radius:6px;cursor:pointer;font-size:10px'), fontFamily: MONO, color: S.enhancing === m ? 'var(--accent)' : 'var(--fg-faint)', opacity: S.enhancing && S.enhancing !== m ? 0.5 : 1 }}>
                {S.enhancing === m ? 'Enhancing…' : l}
              </span>
            ))}
            {S.undo != null && <span onClick={() => this.undoEnhance()} className="hFg" style={sx('padding:2px 7px;font-size:10px;color:var(--fg-faint);cursor:pointer')}>↺ undo (u)</span>}
          </div>
        )}

        {/* ITERATE — the selected generation's prompt, parked and one click from the field */}
        {S.ghost && S.ghost !== S.prompt && (
          <div style={{ ...sx('display:flex;align-items:center;gap:8px;padding:7px 12px;margin-bottom:9px;border-radius:9px;border:1px solid var(--line)'), background: 'var(--accent-05)' }}>
            <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>ITERATE</span>
            <span style={sx('font-size:10.5px;color:var(--fg-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1')}>Change the subject, keep the style — load the selected generation's prompt.</span>
            <span onClick={() => this.loadGhost()} className="hAccent" style={sx('font-size:10.5px;color:var(--accent);font-weight:600;cursor:pointer;flex:none')}>Edit prompt ↑</span>
          </div>
        )}

        {/* the project reference pool — opt-in behind + Ref. ABOVE the bar: the dock is pinned
            to the viewport bottom, so anything that appears on toggle must grow upward where
            it is visible — below the bar it opens off-screen and reads as a dead button. */}
        {S.refsOpen && (
          <div className="glassPill" style={sx('padding:10px 12px;margin-bottom:9px;border-radius:12px;border:1px solid rgba(58,63,73,.55)')}>
            {pool.length
              ? (
                <div style={sx('display:flex;gap:6px;overflow-x:auto;padding-bottom:2px')}>
                  {pool.slice(0, 40).map(c => {
                    const on = S.refs.some(r => (r.kind || 'asset') === 'asset' && r.name === c.name && (r.folder || '') === (c.folder || ''));
                    return (
                      <div key={(c.folder || '') + '/' + c.name} onClick={() => this.attach(c)} title={c.name}
                        className="hBd" style={{ ...sx('position:relative;flex:none;width:46px;height:46px;border-radius:8px;overflow:hidden;cursor:pointer;background:var(--sunk)'), border: '1.5px solid ' + (on ? 'var(--accent)' : 'var(--border)') }}>
                        <img src={assetUrl(this.pid(), c.name, c.folder)} alt="" loading="lazy" style={sx('width:100%;height:100%;object-fit:cover')} />
                      </div>
                    );
                  })}
                </div>
              )
              : <div style={sx('font-size:10.5px;color:var(--fg-faint);line-height:1.6')}>No images in this project's context yet — add some to a board, or drag a finished result onto the composer to iterate on it.</div>}
          </div>
        )}

        <Composer
          app={app}
          // `model` is the RESOLVED id, not state.model — the bar has to state what will actually
          // bill, and the project default is only a fallback, never a label the user can read.
          value={{ prompt: S.prompt, model: this.model(), aspect: S.aspect, resolution: S.resolution, seed: S.seed, variantCount: S.variantCount, params: S.modelParams }}
          onChange={v => {
            // any settings change moves the estimate, so an armed Generate no longer means what
            // it said — disarm before the value lands, exactly as the old pill toggles did.
            this.disarmSpend();
            this.setState({
              prompt: v.prompt, model: v.model, aspect: v.aspect, resolution: v.resolution,
              seed: v.seed, variantCount: v.variantCount, modelParams: v.params || {},
            });
          }}
          // references are attachments, not fragments — chips under the prompt, capped at 4 by
          // attach()/attachGen(), and each one removable in place
          mentions={S.refs.map((r, i) => ({
            id: (r.kind || 'asset') + ':' + r.scope + ':' + r.name + ':' + i,
            label: r.kind === 'render' ? '↺ ' + (r.gen || r.name) : r.name,
            thumb: this.refUrl(r),
            onRemove: () => this.setState(s => ({ refs: s.refs.filter((_, j) => j !== i) })),
          }))}
          fragments={{ label: fragLabel }}
          // THE shared ✦ panel — same props shape as ShotWorkspace, so the two popovers are one
          // panel. STYLE routes through App's active lock (syncLock() is the only path into
          // state.style); CAMERA MOVEMENT writes straight onto state.camera, where cameraFragment()
          // already reads move/speed/stabilization.
          fragmentProps={{
            pid: this.pid(),
            looks: app.state.styleLocks || [],
            activeLookId: (this.props.activeStyleLock || {}).id || '',
            projectLock: this.props.activeStyleLock || null,
            onLook: id => this.setLook(id),
            // DEV-127 — the ✦ panel's "New style →" / "Manage style locks →" open THIS surface's
            // StyleLab (S.studio), not App's global one and never the Tools page, so Apply lands
            // on the composer state the user is looking at.
            onOpenStyleLab: tab => this.setState({ studio: tab || 'styles' }),
            // DEV-129 — the angle IS the `framing` axis pick (max 1), so it reads and writes the
            // same camera.picks the StyleLab CAMERA tab edits. One selection, two ways in.
            angle: (S.camera.picks && S.camera.picks.framing && S.camera.picks.framing[0]) || null,
            onAngle: t => this.setCam({ picks: { ...(S.camera.picks || {}), framing: t ? [t] : [] } }),
            video: this.isVideo(),
            move: S.camera.move || null,
            speed: S.camera.speed || 'normal',
            stab: S.camera.stabilization || 'smooth',
            onMove: id => this.setCam({ move: id }),
            onSpeed: id => this.setCam({ speed: id }),
            onStab: id => this.setCam({ stabilization: id }),
          }}
          onAttach={() => this.setState(s => ({ refsOpen: !s.refsOpen }))}
          attachHint="Attach reference images — or drag a finished result onto the composer"
          busy={S.busy}
          blockReason={blocked}
          onSubmit={() => this.submit()}
          // the two-step spend confirm keeps its voice on the button itself, the same idiom the
          // bulk Delete uses — never window.confirm, which nothing else in this app does
          submitLabel={armed
            ? 'Confirm $' + S.confirmSpend.toFixed(2) + ' — click again'
            : S.variantCount > 1 ? 'Queue ' + S.variantCount + '×' : 'Generate'}
          composedPrompt={this.composed()}
          entities={buildEntityPool(app, this.pid())}
          pid={this.pid()}
          provenance={[
            (this.styleFrag() || typeof this.state.style.override === 'string') ? {
              text: this.styleFrag(),
              tag: 'style · ' + styleLabel(this.state.style),
              onEdit: t => { this.disarmSpend(); this.setState(s => ({ style: { ...s.style, override: t, edited: true } })); },
            } : null,
            (this.camFrag() || this.state.cameraOverride != null) ? {
              text: this.camFrag(),
              tag: 'cam',
              onEdit: t => { this.disarmSpend(); this.setState({ cameraOverride: t }); },
            } : null,
          ].filter(Boolean)}
          placeholder="Describe the frame… ⌘⏎ generates. Type / or @ for snippets & refs."
        />

      </div>
    );
  }

  // "does this pill hold anything?" — asks the SELECTION, not its label: string-comparing against
  // 'No style' / 'Default camera' meant a saved lock actually NAMED "No style" read as empty.
  // lookBuilder exports these two predicates for exactly this question.
  isLookEmpty(which) {
    return which === 'style' ? isStyleEmpty(this.state.style) : isCameraEmpty(this.state.camera);
  }

  renderResults(gens, sel) {
    const S = this.state;
    const all = this.gens();
    const chip = (label, on, fn, color) => (
      <span key={label} onClick={fn} className="hBd"
        // ACTIVE is the neutral RAISED chip, never a solid accent fill — the one solid accent on
        // this screen belongs to Generate. The semantic colour survives as the text tint.
        style={{ ...sx('font-size:10px;border-radius:6px;padding:3.5px 9px;cursor:pointer'), fontFamily: MONO, fontWeight: on ? 700 : 400, color: on ? (color || 'var(--fg)') : (color || 'var(--fg-muted)'), background: on ? 'var(--raise)' : 'transparent', border: '1px solid ' + (on ? 'var(--border-3)' : 'var(--border-2)') }}>{label}</span>
    );
    const count = f => all.filter(g => f === 'new' ? (g.status === 'done' && (g.reviewState === 'new' || !g.reviewState)) : g.reviewState === f).length;
    const grid = list => (
      <div style={{ ...sx('display:grid;gap:12px'), gridTemplateColumns: 'repeat(auto-fill,minmax(' + (S.tile || 200) + 'px,1fr))' }}>
        {list.map(g => this.renderCard(g))}
      </div>
    );
    // per-shot sections — the "do we have every shot covered?" review view
    const groups = () => {
      const by = new Map();
      gens.forEach(g => { const k = g.shot || '— no shot'; if (!by.has(k)) by.set(k, []); by.get(k).push(g); });
      const keys = Array.from(by.keys()).sort((a, b) => (a === '— no shot') - (b === '— no shot') || a.localeCompare(b));
      return keys.map(k => {
        const list = by.get(k);
        const kept = list.filter(g => g.reviewState === 'kept').length;
        return (
          <div key={k} style={sx('margin-bottom:18px')}>
            <div style={sx('display:flex;align-items:baseline;gap:10px;margin-bottom:8px')}>
              <span style={{ ...sx('font-size:11px;font-weight:800;letter-spacing:.1em'), fontFamily: MONO, color: k === '— no shot' ? 'var(--fg-faint)' : 'var(--accent)' }}>{k}</span>
              <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>{list.length} gen{list.length === 1 ? '' : 's'}</span>
              <span style={{ ...sx('font-size:9.5px;font-weight:700'), fontFamily: MONO, color: kept ? 'var(--ok)' : 'var(--danger)' }}>{kept ? kept + ' kept ✓' : 'nothing kept yet'}</span>
            </div>
            {grid(list)}
          </div>
        );
      });
    };
    return (
      <div>
        {/* One row: review filters lead, everything secondary sits quiet on the right. The old
            10-key hotkey legend now lives in the tooltip on the count — the keys still work,
            they just stop shouting. Rating collapsed to a single cycling chip (Any ★ → ★3+ →
            ★4+ → ★5+); the slider scales the whole gallery. */}
        <div className="glassPill" style={{ ...sx('display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:12px;padding:7px 11px;border-radius:12px;position:sticky;top:8px;z-index:15'), border: '1px solid rgba(58,63,73,.55)' }}>
          <span title={'←/→ move · f fullscreen · ↵ panel · d use as ref · k keep · x kill · r re-roll · a send · p copy · s style · c camera'}
            style={{ ...sx('margin-right:6px;cursor:default'), fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)' }}>
            {gens.length}{gens.length !== all.length ? ' / ' + all.length : ''} generation{gens.length === 1 ? '' : 's'} <span style={sx('color:var(--border-3)')}>⌨</span>
          </span>
          {chip('All', S.filterReview === 'all', () => this.setState({ filterReview: 'all' }))}
          {chip('Needs review · ' + count('new'), S.filterReview === 'new', () => this.setState({ filterReview: 'new' }), 'var(--accent)')}
          {chip('Kept · ' + count('kept'), S.filterReview === 'kept', () => this.setState({ filterReview: 'kept' }), 'var(--ok)')}
          {chip('Killed · ' + count('killed'), S.filterReview === 'killed', () => this.setState({ filterReview: 'killed' }), 'var(--danger)')}
          {chip(S.minRating ? '★' + S.minRating + '+' : 'Any ★', S.minRating > 0,
            () => this.setState(s => ({ minRating: s.minRating === 0 ? 3 : s.minRating === 5 ? 0 : s.minRating + 1 })))}
          {chip('By shot', S.groupShot, () => this.setState(s => ({ groupShot: !s.groupShot })))}
          <span style={sx('margin-left:auto;display:flex;align-items:center;gap:7px')} title="Tile size">
            <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)' }}>▫</span>
            <input type="range" min={130} max={340} step={10} value={S.tile || 200}
              onChange={e => this.setState({ tile: Number(e.target.value) })}
              style={sx('width:110px;accent-color:var(--fg-muted)')} />
            <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--fg-faint)' }}>◻</span>
          </span>
        </div>
        {this.renderBulkBar()}
        {S.groupShot && gens.length ? groups() : grid(gens)}
        {!gens.length && (
          all.length
            ? (
              <div style={sx('border:1px dashed var(--border-2);border-radius:14px;padding:30px 20px;text-align:center')}>
                <div style={{ ...sx('font-size:10.5px;font-weight:700;letter-spacing:.14em;color:var(--fg-soft)'), fontFamily: MONO }}>NOTHING MATCHES THIS FILTER</div>
                <div style={sx('font-size:11px;color:var(--fg-faint);margin-top:6px')}>{all.length} generation{all.length === 1 ? '' : 's'} hidden — switch back to All or lower the rating filter.</div>
              </div>
            )
            : (
              <div style={sx('border:1px dashed var(--border-2);border-radius:14px;padding:40px 20px;text-align:center')}>
                <div style={{ ...sx('font-size:10.5px;font-weight:700;letter-spacing:.14em;color:var(--fg-soft)'), fontFamily: MONO }}>NO GENERATIONS YET — WRITE A PROMPT · ⌘⏎</div>
                <div style={sx('font-size:11.5px;color:var(--fg-faint);margin-top:6px')}>A preview costs about $0.003. Stays right here in the project.</div>
              </div>
            )
        )}
      </div>
    );
  }

  // Bulk action bar — only present once something is ticked, so it never competes with the filter
  // row in the idle state. Sticks to the top of the scroll area: on a 60-card grid the buttons have
  // to stay reachable from wherever the selection was made.
  renderBulkBar() {
    const S = this.state;
    if (!S.marked.length) return null;
    const n = this.targets().length;
    const act = (label, fn, color) => (
      <span onClick={fn} className="hBd"
        style={{ ...sx('font-size:10.5px;border-radius:7px;padding:4px 10px;cursor:pointer;font-weight:700'), fontFamily: MONO, color, border: '1px solid ' + color, background: 'transparent' }}>{label}</span>
    );
    return (
      <div style={{ ...sx('position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:12px;padding:7px 11px;border-radius:9px'), border: '1px solid color-mix(in srgb, var(--marked) 35%, transparent)', background: 'var(--raise)', backdropFilter: 'blur(6px)' }}>
        <span style={{ ...sx('font-size:11px;font-weight:800'), fontFamily: MONO, fontVariantNumeric: 'tabular-nums', color: 'var(--marked)' }}>{n} selected</span>
        <span style={sx('width:1px;height:14px;background:var(--border);margin:0 3px')} />
        {act('Keep', () => this.bulkKeep(), 'var(--ok)')}
        {act('Kill', () => this.bulkKill(), 'var(--danger)')}
        {/* the armed state says exactly what will happen and where it goes — no second hint line */}
        {act(S.confirmDel ? 'Delete ' + n + ' → Trash?' : 'Delete', () => this.bulkDelete(), 'var(--danger)')}
        <span style={{ ...sx('margin-left:auto;font-size:10px;color:var(--fg-faint)'), fontFamily: MONO }}>
          <span onClick={() => this.markAllVisible()} className="hAccent" style={sx('cursor:pointer')}>all ⌘A</span>
          {' · '}
          <span onClick={() => this.clearMarks()} className="hAccent" style={sx('cursor:pointer')}>clear esc</span>
        </span>
      </div>
    );
  }

  renderCard(g) {
    const on = this.state.selId === g.id;
    const mk = this.isMarked(g.id);
    const selMode = this.state.marked.length > 0; // a selection exists — pin the ticks open grid-wide
    const busy = g.status === 'running' || g.status === 'queued';
    const rb = reviewBadge(g);
    // ⌘/Ctrl+click toggles one · ⇧click extends from the anchor · plain click moves the cursor
    const click = e => {
      if (e.metaKey || e.ctrlKey) { e.preventDefault(); this.markToggle(g.id); return; }
      if (e.shiftKey) { e.preventDefault(); this.markRange(g.id); return; }
      this.select(g.id);
    };
    // Status/rating/badge chrome lives in the tile's overlay slot; the image/video branch is now
    // RenderTile → RenderMedia. Behaviour is unchanged: hover-play video, object-fit:cover, the
    // whole card drags its generation id (startDrag), double-click opens the zoom viewer.
    const overlay = (
      <>
        {/* The tick is reveal-on-hover and rides on top of the ⤢ corner rather than claiming
            its own — an idle grid of 60 cards shows no selection chrome at all. Once a
            selection exists the whole set stays visible, so you can see what you're acting on. */}
        <span className={selMode ? '' : 'rv'} onClick={e => { e.stopPropagation(); this.markToggle(g.id); }} title="Select (space · ⇧click for a range)"
          style={{ ...sx('position:absolute;top:5px;left:6px;z-index:2;width:16px;height:16px;border-radius:5px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:10px;line-height:1'), border: '1.5px solid ' + (mk ? 'var(--marked)' : 'var(--border-3)'), background: mk ? 'var(--marked)' : 'color-mix(in srgb, var(--sunk) 60%, transparent)', color: 'var(--on-accent)', fontWeight: 800 }}>{mk ? '✓' : ''}</span>
        {/* ALL metadata chrome is reveal-on-hover (`rv` under RenderTile's rvH root): the idle
            gallery is images, nothing else. The only always-on states are the ones that need
            attention without a hover — a failure, and the queued/running placeholder. */}
        {g.file && <span className="rv rvShift" style={{ ...sx('position:absolute;top:6px;left:7px;font-size:8px;font-weight:800;letter-spacing:.06em;border-radius:4px;padding:1.5px 6px'), color: rb.color, background: 'color-mix(in srgb, var(--sunk) 72%, transparent)', transform: selMode ? 'translateX(22px)' : 'none' }}>{rb.label}</span>}
        {(g.rating || 0) > 0 && <span className="rv" style={{ ...sx('position:absolute;top:6px;right:28px;border-radius:4px;padding:1px 6px'), fontFamily: MONO, fontSize: 9, background: 'color-mix(in srgb, var(--sunk) 72%, transparent)', color: 'var(--accent)' }}>{'★'.repeat(g.rating)}</span>}
        {/* DEV-131: the tile used to cut the error at 70 chars, which lands mid-token on every real
            provider message ("FAL fal-ai/nano-banana-pro timed out after 300s (last queue…"). The
            tile is small, so it shows what fits over a few lines and the full text rides on `title`
            — the whole message is always reachable, and always copyable, from the card itself. */}
        {g.status === 'failed' && <span title={g.error || 'failed'} style={sx('position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:9.5px;line-height:1.35;color:var(--danger);font-weight:700;padding:0 10px;text-align:center;overflow:hidden')}>{(g.error || 'failed').slice(0, 160)}</span>}
        {/* the old below-the-image footer, folded into a hover bar INSIDE the frame — model,
            shot, delivered size, cost. Idle cards carry no text at all. */}
        {g.file && (
          <span className="rv" style={{ ...sx('position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;gap:7px;padding:14px 9px 6px'), background: 'linear-gradient(180deg,transparent,color-mix(in srgb, var(--sunk) 82%, transparent))' }}>
            {g.shot && <span style={{ fontFamily: MONO, fontSize: 9, color: 'var(--accent)', flex: 'none' }}>{g.shot}</span>}
            {g.savedTo && <span style={sx('flex:none;font-size:8px;font-weight:800;color:var(--ok)')}>SAVED</span>}
            <span style={{ ...sx('flex:1;color:var(--fg-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 9 }}>{(g.model || '').split('/').pop()}</span>
            {this.sizeLabel(g) && <span style={{ fontFamily: MONO, fontSize: 9, color: 'var(--fg-muted)', flex: 'none', fontVariantNumeric: 'tabular-nums' }}>{this.sizeLabel(g)}</span>}
            <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-soft)', flex: 'none', fontVariantNumeric: 'tabular-nums' }}>${(g.cost || 0).toFixed(3)}</span>
          </span>
        )}
        {/* explicit open affordance — double-click and ↵ do the same, but the icon makes
            it discoverable instead of a thing you have to already know */}
        {g.file && (
          <span onClick={e => { e.stopPropagation(); this.select(g.id); this.setState({ zoom: g.id }); }} className="hAccent rv" title="Open (f)"
            style={{ ...sx('position:absolute;top:5px;right:6px;border-radius:5px;padding:2px 6px;cursor:pointer;font-size:11px;line-height:1.2'), background: 'color-mix(in srgb, var(--sunk) 72%, transparent)', color: 'var(--fg)' }}>⤢</span>
        )}
      </>
    );
    return (
      <RenderTile key={g.id}
        src={g.file ? api.renderUrl(this.pid(), g.file) : null}
        kind={/\.mp4$/.test(g.file || '') ? 'video' : 'image'}
        selected={on} marked={mk}
        onClick={click}
        onDoubleClick={() => { this.select(g.id); this.setState({ zoom: g.id }); }}
        draggable={g.status === 'done' && !!g.file}
        onDragStart={e => this.startDrag(e, g)}
        title={g.status === 'done' ? 'Double-click to open · ⇧click / ⌘click to multi-select · drag onto the composer to use as a reference' : ''}
        onMediaLoad={e => this.noteDims(g.file, e.currentTarget)}
        placeholder={<span style={{ ...sx('font-size:9.5px;font-weight:700;letter-spacing:.1em'), color: stC[g.status] || 'var(--fg-faint)', animation: busy ? 'dl-pulse 1.2s infinite' : 'none' }}>{(g.status || '').toUpperCase()}</span>}
        overlay={overlay} />
    );
  }

  // large inline preview — a panel, NOT a route change
  renderPreview(g) {
    const S = this.state;
    const isVid = /\.mp4$/.test(g.file || '');
    // amber = outlined-primary (accent border + accent text): the composer's Generate is the ONE
    // solid accent fill on this screen. ok = the keep tone; red = the kill/danger tone.
    const btn = (label, fn, tone) => (
      <div onClick={fn} className={tone === 'red' ? 'hBdRed5' : tone === 'amber' ? 'hBdAccent' : 'hBd'}
        style={{ ...sx('padding:8px 14px;border-radius:8px;font-weight:600;font-size:11.5px;cursor:pointer'), ...(tone === 'amber' ? sx('border:1px solid var(--accent-35);color:var(--accent);font-weight:700') : tone === 'ok' ? sx('border:1px solid color-mix(in srgb, var(--ok) 45%, transparent);color:var(--ok)') : sx('border:1px solid var(--border-2);color:' + (tone === 'red' ? 'var(--danger)' : 'var(--fg-soft)'))) }}>{label}</div>
    );
    return (
      <div style={sx('margin-top:18px;border:1px solid var(--border);border-radius:14px;background:var(--surface);overflow:hidden;display:grid;grid-template-columns:minmax(0,1fr) 320px')}>
        <div style={sx('background:var(--sunk);display:flex;align-items:center;justify-content:center;min-height:220px;border-right:1px solid var(--line)')}>
          {g.file
            ? <RenderMedia src={api.renderUrl(this.pid(), g.file)} kind={isVid ? 'video' : 'image'}
                fit="contain" controls={isVid} muted loop
                onLoad={e => this.noteDims(g.file, e.currentTarget)}
                onClick={isVid ? undefined : () => this.setState({ zoom: g.id })}
                title={isVid ? undefined : 'Open fullscreen (f)'}
                style={sx('width:100%;max-height:520px;display:block' + (isVid ? '' : ';cursor:zoom-in'))} />
            /* DEV-131: the stage is the one surface with room for the whole provider error, so it
               prints it in full — truncating to 60 chars here was what made a real failure ("FAL
               rejected the API key while polling (401) — …") unreadable exactly where the user
               went to read it. The status word stays letter-spaced; the message wraps below it. */
            : <span style={{ ...sx('display:block;font-size:11px;font-weight:700;padding:60px 18px;max-width:560px'), color: stC[g.status], animation: g.status === 'running' || g.status === 'queued' ? 'dl-pulse 1.2s infinite' : 'none' }}>
              <span style={sx('letter-spacing:.1em')}>{(g.status || '').toUpperCase()}</span>
              {g.error && <span style={sx('display:block;margin-top:10px;font-size:10.5px;font-weight:600;line-height:1.5;letter-spacing:0;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere')}>{g.error}</span>}
            </span>}
        </div>
        <div style={sx('padding:16px 18px;display:flex;flex-direction:column;gap:14px;overflow-y:auto;max-height:540px;position:relative')}>
          <div style={sx('display:flex;align-items:center;gap:8px')}>
            {S.renaming === g.id ? (
              <input value={S.renameText} autoFocus onChange={e => this.setState({ renameText: e.target.value })}
                onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') this.commitRename(g); else if (e.key === 'Escape') this.setState({ renaming: null }); }}
                style={sx('flex:1;background:var(--ink);border:1px solid var(--accent-60);border-radius:7px;color:var(--fg);font-size:12px;padding:6px 9px')} />
            ) : (
              <span style={sx('font-size:12.5px;font-weight:700;color:var(--fg)')}>Generation</span>
            )}
            <span onClick={() => this.setState({ open: false })} className="hFgL" style={sx('margin-left:auto;font-size:11px;color:var(--fg-faint);cursor:pointer')}>✕ Esc</span>
          </div>

          <div>
            <div style={sx('font-size:9.5px;font-weight:700;letter-spacing:.14em;color:var(--fg-faint);margin-bottom:6px')}>PROMPT</div>
            <div style={{ ...sx('padding:9px 11px;border:1px solid var(--border);border-radius:9px;background:var(--sunk);line-height:1.6;color:var(--fg-muted);max-height:120px;overflow-y:auto'), fontFamily: MONO, fontSize: 10 }}>{g.prompt}</div>
          </div>

          <div style={sx('display:grid;grid-template-columns:56px 1fr;row-gap:6px;font-size:10.5px')}>
            <span style={sx('color:var(--fg-faint)')}>Model</span><span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-muted)' }}>{g.model}</span>
            <span style={sx('color:var(--fg-faint)')}>Size</span><span style={{ fontFamily: MONO, color: 'var(--fg-muted)' }}>{this.sizeLabel(g) || '—'}{g.resolution ? '  ·  ' + g.resolution + ' ' + (g.aspect || '') : ''}</span>
            <span style={sx('color:var(--fg-faint)')}>Seed</span><span style={{ fontFamily: MONO, color: 'var(--fg-muted)', fontVariantNumeric: 'tabular-nums' }}>{g.seed ?? '—'}</span>
            <span style={sx('color:var(--fg-faint)')}>Cost</span><span style={{ fontFamily: MONO, color: 'var(--fg-soft)', fontVariantNumeric: 'tabular-nums' }}>${(g.cost || 0).toFixed(3)}</span>
          </div>

          {S.savingLock === g.id ? (
            <div style={sx('display:flex;align-items:center;gap:8px')}>
              <input value={S.lockNameText} autoFocus onChange={e => this.setState({ lockNameText: e.target.value })}
                onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') this.commitSaveLock(g); else if (e.key === 'Escape') this.setState({ savingLock: null }); }}
                placeholder="Style lock name"
                style={sx('flex:1;background:var(--ink);border:1px solid var(--accent-60);border-radius:7px;color:var(--fg);font-size:11.5px;padding:7px 10px')} />
              {btn('Save', () => this.commitSaveLock(g), 'amber')}
              {btn('Cancel', () => this.setState({ savingLock: null }))}
            </div>
          ) : (
            <div style={sx('display:flex;flex-wrap:wrap;gap:8px')}>
              {/* keep · kill · re-roll lead, in the canonical order — MediaAction is the ONE
                  review chip, shared with the zoom viewer and the shot stage */}
              <MediaAction label="Keep" hotkey="K" tone="ok" onClick={() => this.keep(g)} />
              <MediaAction label="Kill" hotkey="X" tone="danger" onClick={() => this.kill(g)} />
              <MediaAction label="Re-roll" hotkey="R" onClick={() => this.reroll(g)} />
              <MediaAction label="Send…" hotkey="A" onClick={() => this.setState(s => ({ sendOpen: !s.sendOpen }))} />
              <MediaAction label="Edit prompt" hotkey="↑" onClick={() => this.loadGhost()} />
              <MediaAction label="Use as reference" tone="accent" onClick={() => this.attachGen(g)} />
              <MediaAction label="Copy" hotkey="P" onClick={() => this.copyPrompt(g)} />
              <MediaAction label="Rename" hotkey="E" onClick={() => this.startRename(g)} />
              <MediaAction label="✦ Save style" onClick={() => this.startSaveLock(g)} />
              <MediaAction label="Delete file" tone="danger" onClick={() => this.discard(g)} />
            </div>
          )}

          {S.sendOpen && (
            <div style={sx('position:absolute;right:18px;top:52px;z-index:30;min-width:200px;border:1px solid var(--border-3);border-radius:10px;background:var(--surface-2);box-shadow:0 16px 48px color-mix(in srgb, var(--sunk) 70%, transparent);overflow:hidden;max-height:320px;overflow-y:auto')}>
              <div style={sx('font-size:9px;font-weight:800;letter-spacing:.12em;color:var(--fg-faint);padding:8px 12px 4px')}>SEND TO SHOT</div>
              {this.shots().length ? this.shots().map(sh => (
                <div key={sh.id} onClick={() => this.sendTo(g, { kind: 'shot', id: sh.id })} className="hRow"
                  style={sx('display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer')}>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--accent)', flex: 'none' }}>{sh.id}</span>
                  <span style={sx('font-size:11px;color:var(--fg-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{sh.title}</span>
                  {g.shot === sh.id && <span style={{ ...sx('flex:none;margin-left:auto;color:var(--ok)'), fontFamily: MONO, fontSize: 8.5 }}>linked</span>}
                </div>
              )) : <div style={sx('padding:4px 12px 8px;font-size:10px;color:var(--fg-faint)')}>No shots yet.</div>}
              <div style={sx('font-size:9px;font-weight:800;letter-spacing:.12em;color:var(--fg-faint);padding:8px 12px 4px;border-top:1px solid var(--line)')}>SEND TO BOARD</div>
              <div onClick={() => this.sendTo(g, { kind: 'board', folder: '' })} className="hRow" style={sx('padding:6px 12px;font-size:11px;color:var(--fg-soft);cursor:pointer')}>(root)</div>
              {this.boards().map(f => (
                <div key={f} onClick={() => this.sendTo(g, { kind: 'board', folder: f })} className="hRow" style={sx('padding:6px 12px;font-size:11px;color:var(--fg-soft);cursor:pointer')}>{f}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
}

export default ProjectGenerate;
