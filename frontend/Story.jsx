// Story tab — idea/script → AI shot breakdown → skill-routed shot list & storyboard.
// Keyboard-first: J/K or ↑/↓ walk the list, Enter opens the shot, S cycles status,
// Esc closes. All records live as projects/<pid>/shots/*.md.
import React from 'react';
import { sx } from './sx';
import SnippetText from './SnippetText';
import Markdown, { MarkdownToolbar } from './Markdown';   // DEV-124 — story renders its own md
import MentionText from './MentionText';
import { buildEntityPool } from './entities';
import { api } from './api';
import { SHOT_STATUS, SHOT_TYPES, skillColor, kindDef, DEFAULT_RESOLUTION, estCost, estimateCost } from './models';
import { RenderTile, mediaKind } from './RenderMedia';
import { joinFragment } from './lookBuilder';
// the shared shot→generation composer (frontend/shotGenerate.js) — one implementation of
// cast/loc/props resolution, look selection, prompt joining and reference building, used here and
// by the chat's shot-board card. Aliased so the delegating methods below don't shadow the imports.
import {
  shotCast as castOf, shotLoc as locOf, shotProps as propsOf,
  lookForShot, refsForShot, defaultShotModel,
} from './shotGenerate';
import { assetUrl } from './Moodboard';
import { folderKind } from './AssetBoards';
import ShotWorkspace from './ShotWorkspace';
// manual round-trip — hand prompts out to an external tool, file the downloads back onto shots
import ManualHandoff from './ManualHandoff';
import ManualInbox from './ManualInbox';
import { handoffEntries } from './handoffCompose';
import { Btn, InlineEdit } from './ui';
import { TechSettings, Cost, EntityPicker } from './Composer';
import { CAMERA_MOVEMENTS } from './cameraMovements';
import { MONO } from './tokens';

const STATUS_ORDER = ['todo', 'generating', 'review', 'done'];
// quick add: the action column is one list line — hard cap so a dumped essay can't blow it up
const QUICK_DESC_MAX = 280;
// quick add: the handful of moves a director reaches for constantly (same spirit as the
// composer's QUICK_MOVES — full library stays in Tools → Camera Moves, do not list all 20 here)
const QUICK_MOVE_IDS = ['static', 'push-in', 'pull-out', 'pan-left', 'pan-right', 'arc-clockwise', 'boom-up'];

export default class StoryTab extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      // The Board's OPEN chip hands a shot id over through app state; StoryTab remounts on every
      // tab switch (the tab body is conditionally rendered), so reading it here is enough. It is
      // cleared on read so a later visit to Story does not re-open the same shot.
      open: (props.app.state || {}).storyOpenShot || null,
      storyDraft: null,      // null = not editing
      story: null,           // loaded story content
      busy: false,           // breakdown in flight
      transcribing: false,
      view: 'list', filStatus: 'all', filSkill: 'all', filFav: false, filEntity: null,
      colsOpen: false,
      selRows: {}, selAnchor: null,   // multi-select for batch assign/generate (⇧ range, ⌘ toggle)
      assign: null,                   // {ids, x, y, kind} — cast/location/props/look assign popover
      dragEnt: null,                  // entity chip being dragged from the production header
      fill: null,                     // Airtable-style fill-down: {col, fromIx, toIx, src}
      sel: 0,                // keyboard cursor (index in filtered list)
      open: null,            // open shot id (drawer)
      draft: null,           // editable copy of the open shot
      dragId: null, dragOver: null, // drag-reorder state (list view)
      rebreakAsk: false, exportOpen: false, moreOpen: false, collapsed: {}, descMention: null, storyOpen: false,
      handoff: null,         // shots being handed off to an external tool (manual round-trip)
      inboxOpen: false,      // the manual Inbox — downloads waiting to be filed back onto shots
      quickAdd: null,        // { scene, draft, type, dur } — the shot-dump capture row (N / ⇧N)
      expanded: null,        // shot id whose inline TAKES panel is open (click a row's thumbnail)
      gen: {} // per-shot generation settings held by the SETTINGS popover, keyed by shot id
    };
    this.audioRef = React.createRef();
    this.storyRef = React.createRef();   // DEV-124 — the markdown toolbar edits through it
  }
  componentDidMount() {
    // The Board's OPEN chip handed a shot id over through app state and the constructor consumed
    // it; clear it so a later visit to Story does not re-open the same shot.
    if (this.props.app.state.storyOpenShot) this.props.app.setState({ storyOpenShot: null });
    this.loadStory();
    this.props.app.reloadStyleLocks(); // the LOOK column and assign popover need the lock list
    api.looks().then(looks => this.setState({ looks })).catch(() => { }); // extracted LOOKs count too
    this._key = e => this.onKey(e);
    window.addEventListener('keydown', this._key, true);
    // fill-down commits on mouseup anywhere — the drag can end outside the list
    this._up = () => { if (this.state.fill) this.applyFill(); };
    window.addEventListener('mouseup', this._up);
    // track the fill range by hit-testing under the pointer — enter events alone drop out
    // when the pointer moves fast (or the drag is synthetic)
    this._mv = e => {
      if (!this.state.fill) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const row = el && el.closest && el.closest('[data-rowix]');
      if (!row) return;
      const ix = +row.dataset.rowix;
      this.setState(s => (s.fill && s.fill.toIx !== ix) ? { fill: { ...s.fill, toIx: ix } } : null);
    };
    window.addEventListener('mousemove', this._mv);
  }
  componentWillUnmount() {
    window.removeEventListener('keydown', this._key, true);
    window.removeEventListener('mouseup', this._up);
    window.removeEventListener('mousemove', this._mv);
  }

  async loadStory() {
    try {
      const r = await api.story(this.props.pid);
      this.setState({ story: r.story.content });
    } catch { this.setState({ story: '' }); }
  }
  shots() {
    const { app, pid } = this.props;
    return (app.state.shots || []).filter(s => s.proj === pid);
  }
  filtered() {
    const S = this.state;
    return this.shots().filter(s =>
      (S.filStatus === 'all' || s.status === S.filStatus) &&
      (S.filSkill === 'all' || s.skill === S.filSkill) &&
      (!S.filFav || s.fav) &&
      (!S.filEntity || this.shotCast(s).includes(S.filEntity) || this.shotLoc(s) === S.filEntity || this.shotMentions(s).includes(S.filEntity)))
      // SORTED BY SCENE, then by shot order. Scene groups are derived by ADJACENCY in the render
      // — without this sort, a shot quick-added "to scene 1" appends at the tail of the raw `no`
      // order and mints a DUPLICATE "SCENE 1" header at the bottom of the list ("more and more
      // sequences"), instead of appearing inside scene 1 where the user put it.
      .sort((a, b) => (this.sceneOf(a) - this.sceneOf(b)) || ((a.no || 0) - (b.no || 0)));
  }
  // entity keys (@mention basenames) referenced by a shot's desc or prompt
  shotMentions(sh) {
    const text = (sh.desc || '') + ' ' + (sh.prompt || '');
    return (text.match(/@[\w\-\.]+/g) || []).map(m => m.slice(1).toLowerCase());
  }

  // ── entities as production data ──────────────────────────────────────────────
  // A shot is WHO (cast) + WHERE (loc) + LOOK (style lock) + WHAT (prompt). Cast and
  // location are stored on the shot record (cast: [key…], loc: key) and resolve
  // against the asset pool; @mentions in the text remain a read-only fallback.
  entityPool() {
    const seen = new Set(); const out = [];
    const K = { cast: 'talent', talent: 'talent', characters: 'talent', locations: 'location', location: 'location', props: 'prop', prop: 'prop' };
    for (const c of this.mentionPool()) {
      const key = this.mentionKey(c.name);
      if (seen.has(key)) continue; seen.add(key);
      const base = String(c.folder || '').split('/').pop().toLowerCase();
      // `label` is the human name shown everywhere; `key` stays the stable id used by
      // shot.cast/shot.loc and @mentions, so renaming never breaks an assignment.
      out.push({ ...c, key, label: (c.label || (c.meta || {}).label || '').trim() || key, kind: (c.meta || {}).kind || K[base] || null });
    }
    return out;
  }
  entMap() { return new Map(this.entityPool().map(e => [e.key, e])); }
  // Delegated to shotGenerate.js — the shared shot→generation composer the chat's shot-board card
  // also generates through. Story keeps passing its OWN entity map (entityPool/mentionPool, which
  // predates entities.js and stays authoritative for these columns), so behaviour is unchanged.
  shotCast(sh, m) { return castOf(sh, m || this.entMap()); }
  shotLoc(sh, m) { return locOf(sh, m || this.entMap()); }
  shotProps(sh) { return propsOf(sh); }
  // The design's list is grouped by SCENE. The shot record has a `scene` field, but breakdowns
  // written before it existed leave it null and encode the scene in the title prefix instead
  // ("S01_T02 THE EMPTY STERN DECK" -> scene 1). Derive it so the grouping the design specifies
  // works on real data rather than only on records that happen to carry the field.
  sceneOf(sh) {
    if (sh.scene != null && sh.scene !== '') return Number(sh.scene) || 1;
    const m = /^S(\d+)[_\s-]/i.exec(String(sh.title || ''));
    return m ? Number(m[1]) : 1;
  }
  sceneTitleOf(sh) {
    if (sh.sceneTitle) return String(sh.sceneTitle);
    // no stored scene title — the header still reads "SCENE n", which is what the design shows
    // when a sequence has not been named.
    return '';
  }
  // every reusable look in one list: style locks (prompt-builder styles) + extracted LOOKs
  // (Look Extractor two-tier fragments). Both carry {id, name, fragment}.
  allLooks() {
    const locks = (this.props.app.state.styleLocks || []).map(l => ({ id: l.id, name: l.name, fragment: l.fragment || '', model: l.model }));
    const looks = (this.state.looks || []).map(k => ({ id: k.id, name: k.summary ? k.summary.slice(0, 48) : k.id, fragment: k.tier2 || k.tier1 || '' }));
    return [...locks, ...looks];
  }
  // the LOOK that governs a shot: its own assigned look, else the project's session lock.
  // The look is never re-typed in a prompt — it's composed in silently so prompts stay action-only.
  lookOf(sh) { return lookForShot(this.props.app, this.props.pid, sh, this.state.looks || []); }
  // optimistic write — rows update the instant you click; the server catches up behind it
  patchShotsLocal(byId) {
    const { app, pid } = this.props;
    app.setState(s => ({ shots: (s.shots || []).map(x => x.proj === pid && byId[x.id] ? { ...x, ...byId[x.id] } : x) }));
  }
  // toggle an entity/look on one or many shots. Bulk rule: if every target already has it,
  // remove it; otherwise add it to all. kinds: talent → cast[], prop → props[], location → loc,
  // look → look (style lock id).
  async assignEntity(ids, ent, { forceAdd = false } = {}) {
    const { app, pid } = this.props;
    const m = this.entMap();
    const targets = this.shots().filter(s => ids.includes(s.id));
    if (!targets.length || !ent) return;
    const byId = {};
    if (ent.kind === 'look') {
      const allHave = targets.every(s => s.look === ent.key);
      const look = allHave && !forceAdd ? '' : ent.key;
      targets.forEach(s => { byId[s.id] = { look }; });
    } else if (ent.kind === 'location') {
      const allHave = targets.every(s => this.shotLoc(s, m) === ent.key);
      const loc = allHave && !forceAdd ? '' : ent.key;
      targets.forEach(s => { byId[s.id] = { loc }; });
    } else if (ent.kind === 'prop') {
      const allHave = targets.every(s => this.shotProps(s).includes(ent.key));
      targets.forEach(s => {
        const props = this.shotProps(s).filter(k => k !== ent.key);
        if (!(allHave && !forceAdd)) props.push(ent.key);
        byId[s.id] = { props };
      });
    } else {
      const allHave = targets.every(s => this.shotCast(s, m).includes(ent.key));
      targets.forEach(s => {
        const cast = this.shotCast(s, m).filter(k => k !== ent.key);
        if (!(allHave && !forceAdd)) cast.push(ent.key);
        byId[s.id] = { cast };
      });
    }
    this.patchShotsLocal(byId);
    await Promise.all(Object.entries(byId).map(([id, patch]) => api.patchShot(pid, id, patch, 'assigned ' + (ent.kind || 'cast') + ' ' + (ent.name || ent.key)).catch(() => { })));
    app.sync();
  }
  // Airtable-style fill-down: grab a cell's handle, drag over the rows below, release —
  // the source shot's cast / location / look / props copies onto every row in the range.
  async applyFill() {
    const F = this.state.fill;
    this.setState({ fill: null });
    if (!F) return;
    const list = this.filtered();
    const [a, b] = [Math.min(F.fromIx, F.toIx), Math.max(F.fromIx, F.toIx)];
    if (a === b) return;
    const m = this.entMap();
    const src = this.shots().find(s => s.id === F.src.id) || F.src;
    const patch = F.col === 'cast' ? { cast: this.shotCast(src, m) }
      : F.col === 'loc' ? { loc: this.shotLoc(src, m) || '' }
      : F.col === 'look' ? { look: src.look || '' }
      : { props: this.shotProps(src) };
    const ids = list.slice(a, b + 1).map(s => s.id).filter(id => id !== src.id);
    if (!ids.length) return;
    this.patchShotsLocal(Object.fromEntries(ids.map(id => [id, patch])));
    await Promise.all(ids.map(id => api.patchShot(this.props.pid, id, patch, 'filled down from ' + src.id).catch(() => { })));
    this.props.app.showToast('Filled ' + ids.length + ' shot' + (ids.length === 1 ? '' : 's') + ' from ' + src.id, 'var(--ok)');
    this.props.app.sync();
  }
  // assigned entities' images ride along as generation references — identity holds
  entityRefs(sh, model) { return refsForShot(this.props.app, this.props.pid, sh, model, this.entMap()); }
  selIds() { return Object.keys(this.state.selRows).filter(id => this.state.selRows[id]); }
  toggleRow(sh, ix, e) {
    const S = this.state;
    const sel = { ...S.selRows };
    if (e && e.shiftKey && S.selAnchor != null) {
      const list = this.filtered();
      const [a, b] = [Math.min(S.selAnchor, ix), Math.max(S.selAnchor, ix)];
      for (let i = a; i <= b; i++) if (list[i]) sel[list[i].id] = true;
    } else sel[sh.id] = !sel[sh.id];
    this.setState({ selRows: sel, selAnchor: ix });
  }
  // the model a batch generate will use. One resolver so the selection bar's estimate and the
  // actual run can never disagree.
  batchModel() { return defaultShotModel(this.props.app, this.props.pid); }

  // `repeat` asks for N takes of each id. It fires N separate /api/generate calls rather than one
  // request carrying variantCount: variantCount > 1 belongs to /api/batches (backend/index.mjs:252)
  // and /api/generate does not destructure it, so passing it here would silently collapse to 1×.
  // DEV-134 — "one more take" must mean THE SAME REQUEST AGAIN.
  //
  // ＋1 used to call batchGenerate(), which RE-DERIVES the prompt from `sh.prompt || sh.desc` plus
  // the current look fragment and always uses defaultShotModel(). So after a filmmaker had tuned a
  // shot in the composer — different model, edited prompt, per-model schema params, references —
  // "one more take" quietly produced something else entirely, from stale inputs. That is the
  // mismatch in the report.
  //
  // Now: if the shot has already generated, re-roll its most recent take through the server's own
  // rerollCandidate, which replays the stored prompt/model/aspect/resolution/refs/params snapshot
  // and records reroll lineage. A never-generated shot has nothing to replay, so it still falls
  // back to deriving — that is the only case where deriving is the honest answer.
  //
  // freshSeed: a re-roll for VARIETY, not reproduction. Replaying the stored seed on a deterministic
  // model would hand back the identical image, which is not what "one more" means.
  async takeAgain(ids, { repeat = 1 } = {}) {
    const { app, pid } = this.props;
    const derive = [];
    let n = 0;
    for (const id of ids) {
      const last = this.lastGenOf(id);
      if (!last) { derive.push(id); continue; }
      for (let i = 0; i < Math.max(1, repeat); i++) {
        try { await api.rerollCandidate(pid, last.id, { freshSeed: true }); n++; }
        catch (err) { app.showToast('Re-roll failed on ' + id + ' — ' + (err.message || ''), 'var(--danger)'); return; }
      }
    }
    if (n) {
      app.showToast(n + (n === 1 ? ' take' : ' takes') + ' queued — same prompt, model and settings as the last one', 'var(--accent)');
      app.sync();
    }
    if (derive.length) await this.batchGenerate(derive, { repeat });
  }
  // The shot's most recent finished generation — the one ＋1 replays. Finished only: a queued or
  // failed record has no settled snapshot worth repeating.
  lastGenOf(shotId) {
    const gens = (this.props.proj && this.props.proj.gens) || [];
    return gens
      .filter(g => g.shot === shotId && g.status === 'done')
      .sort((a, b) => (b.started || 0) - (a.started || 0))[0] || null;
  }

  async batchGenerate(ids, { repeat = 1 } = {}) {
    const { app, pid } = this.props;
    const model = this.batchModel();
    const runs = ids.flatMap(id => Array.from({ length: Math.max(1, repeat) }, () => id));
    let n = 0, skipped = 0;
    for (const id of runs) {
      const sh = this.shots().find(s => s.id === id);
      const prompt = ((sh && (sh.prompt || sh.desc)) || '').trim();
      if (!sh || !prompt) { skipped++; continue; }
      const lock = this.lookOf(sh); // each shot generates under ITS look, not one global one
      try {
        // joinFragment, not `prompt + ', ' + fragment` — the naive concat is the double-comma bug
        // and makes this path disagree with every other composer in the app.
        await api.generate({
          pid, shot: sh.id,
          prompt: lock && lock.fragment ? joinFragment(prompt, lock.fragment) : prompt,
          model, aspect: '16:9', resolution: DEFAULT_RESOLUTION, seed: null, refs: this.entityRefs(sh, model)
        });
        // shot status is the SERVER's write (backend/generate.mjs:129) — writing it here too races it
        n++;
      } catch (err) { app.showToast('Generate failed on ' + id + ' — ' + (err.message || ''), 'var(--danger)'); break; }
    }
    app.showToast(n + ' take' + (n === 1 ? '' : 's') + ' queued' + (skipped ? ' · ' + skipped + ' skipped (no prompt)' : ''), n ? 'var(--ok)' : 'var(--danger)');
    this.setState({ selRows: {}, selAnchor: null });
    app.sync();
  }

  onKey(e) {
    if (e.target.isContentEditable) return; // the composer's contenteditable prompt — same bail as INPUT/TEXTAREA
    const tag = (e.target.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return; // ⌘S must save the page, not cycle a shot status
    if (this.props.app.state.paletteOpen || this.state.rebreakAsk) return; // modal owns the keyboard
    const S = this.state;
    const list = this.filtered();
    const k = e.key.toLowerCase();
    if (S.open) return; // the shot workspace owns the keyboard (incl. Esc) while open
    // Escape dismisses whatever transient surface is open — including the inline takes panel,
    // which is otherwise only closable by clicking the same thumbnail again.
    if (k === 'escape' && (this.selIds().length || S.assign || S.expanded || S.quickAdd)) { e.preventDefault(); e.stopPropagation(); this.setState({ selRows: {}, selAnchor: null, assign: null, expanded: null, quickAdd: null }); return; }
    // N — dump shots into the cursor row's scene; ⇧N starts the next scene. Power-user path:
    // the capture row chains ⏎ add-and-next, so ideas pour in without touching the mouse.
    if (k === 'n') {
      e.preventDefault(); e.stopPropagation();
      const cur = list[Math.min(S.sel, list.length - 1)];
      this.openQuickAdd(e.shiftKey ? 'new' : (cur ? this.sceneOf(cur) : null));
      return;
    }
    // A — jump to the Timeline tab. Above the `!list.length` guard: it is a project-level
    // surface and must open even when a status filter has emptied the visible list.
    if (k === 'a') { e.preventDefault(); e.stopPropagation(); this.props.app.setState({ projTab: 'timeline' }); return; }
    if (!list.length) return;
    if (k === 'j' || k === 'arrowdown') { e.preventDefault(); e.stopPropagation(); this.setState({ sel: Math.min(list.length - 1, S.sel + 1) }); }
    else if (k === 'k' || k === 'arrowup') { e.preventDefault(); e.stopPropagation(); this.setState({ sel: Math.max(0, S.sel - 1) }); }
    else if (k === 'enter') { e.preventDefault(); e.stopPropagation(); this.openShot(list[Math.min(S.sel, list.length - 1)]); }
    else if (k === 's') {
      e.preventDefault(); e.stopPropagation();
      const sh = list[Math.min(S.sel, list.length - 1)];
      if (sh) this.cycleStatus(sh);
    }
    else if (k === '.') {
      e.preventDefault(); e.stopPropagation();
      const sh = list[Math.min(S.sel, list.length - 1)];
      if (sh) this.toggleFav(sh);
    }
  }
  // One writer for every inline field edit on a shot row. Not optimistic on purpose: the row
  // re-renders from app state after sync(), so a rejected write reverts visibly instead of
  // leaving the UI claiming a value the file does not have.
  patchShotField(sh, patch, logLine) {
    const { app, pid } = this.props;
    api.patchShot(pid, sh.id, patch, logLine)
      .then(() => app.sync())
      .catch(e => app.showToast('Could not save — ' + (e.message || ''), 'var(--danger)'));
  }
  async toggleFav(sh) {
    const { app, pid } = this.props;
    await api.patchShot(pid, sh.id, { fav: !sh.fav }, !sh.fav ? 'favorited' : 'unfavorited').catch(() => { });
    app.sync();
  }

  async saveStory() {
    const { app, pid } = this.props;
    const content = this.state.storyDraft;
    this.setState({ storyDraft: null, story: content });
    try {
      await api.saveStory(pid, content);
      app.showToast('Story saved to story.md', 'var(--accent)');
    } catch (e) {
      this.setState({ storyDraft: content }); // reopen the editor — the save didn't land
      app.showToast('Story save failed — ' + (e.message || 'server unreachable'), 'var(--danger)');
    }
  }
  breakdown() {
    const { app } = this.props;
    const story = this.state.storyDraft != null ? this.state.storyDraft : this.state.story;
    if (!story || !story.trim()) { app.showToast('Write or transcribe a story first', 'var(--danger)'); return; }
    // existing shots → ask merge vs replace instead of silently archiving (F5)
    if (this.shots().length) this.setState({ rebreakAsk: true });
    else this.runBreakdown('replace');
  }
  async runBreakdown(mode) {
    const { app, pid } = this.props;
    const story = this.state.storyDraft != null ? this.state.storyDraft : this.state.story;
    this.setState({ busy: true, storyDraft: null, story, rebreakAsk: false });
    try {
      const r = await api.breakdown(pid, story, mode);
      app.showToast('Story broken into ' + r.shots.length + ' shots — ' + (mode === 'merge' ? 'merged after the existing set' : 'previous set archived as .bak'), 'var(--ok)');
      this.setState({ sel: 0 });
      app.sync();
    } catch (e) {
      app.showToast('Breakdown failed — ' + (e.message || 'Groq error'), 'var(--danger)');
    }
    this.setState({ busy: false });
  }
  async transcribe(file) {
    const { app } = this.props;
    if (!file) return;
    // Groq Whisper rejects files over 25 MB — catch it here rather than uploading the whole
    // file (up to 80 MB) only to fail server-side with a generic error.
    if (file.size > 25 * 1024 * 1024) {
      app.showToast('That audio is ' + (file.size / 1048576).toFixed(0) + ' MB — Groq Whisper caps at 25 MB. Trim or compress it first.', 'var(--danger)');
      return;
    }
    this.setState({ transcribing: true });
    try {
      const r = await api.transcribe(file);
      const base = this.state.storyDraft != null ? this.state.storyDraft : (this.state.story || '');
      this.setState({ storyDraft: (base.trim() ? base.trim() + '\n\n' : '') + r.text.trim() });
      app.showToast('Transcribed with Groq Whisper — review, then break it down', 'var(--ok)');
    } catch (e) { app.showToast('Transcription failed — ' + (e.message || ''), 'var(--danger)'); }
    this.setState({ transcribing: false });
  }

  openShot(sh) { if (sh) this.setState({ open: sh.id }); }
  closeShot() { this.setState({ open: null }); }
  async cycleStatus(sh) {
    const { app, pid } = this.props;
    const next = STATUS_ORDER[(STATUS_ORDER.indexOf(sh.status) + 1) % STATUS_ORDER.length];
    await api.patchShot(pid, sh.id, { status: next }, 'status → ' + next).catch(() => { });
    app.sync();
  }
  async deleteShot(id) {
    const { app, pid } = this.props;
    const snap = this.shots().find(s => s.id === id);
    await api.deleteShot(pid, id).catch(() => { });
    this.closeShot();
    app.sync();
    app.showToast('Shot ' + id + ' deleted', 'var(--danger)', snap ? async () => {
      const { proj, log, ...data } = snap;
      await api.addShot(pid, data).catch(() => { });
      app.sync();
    } : undefined);
  }
  async duplicateShot(id) {
    const { app, pid } = this.props;
    const sh = await api.duplicateShot(pid, id).catch(() => null);
    if (sh) { app.showToast(id + ' duplicated → ' + sh.id, 'var(--ok)'); app.sync(); this.openShot(sh); }
  }
  async dropReorder(targetId) {
    const { app, pid } = this.props;
    const dragId = this.state.dragId;
    this.setState({ dragId: null, dragOver: null });
    if (!dragId || dragId === targetId) return;
    const ids = this.shots().map(s => s.id).filter(x => x !== dragId);
    const ix = ids.indexOf(targetId);
    ids.splice(ix < 0 ? ids.length : ix, 0, dragId);
    await api.reorderShots(pid, ids).catch(() => app.showToast('Reorder failed', 'var(--danger)'));
    app.sync();
  }
  // Resolve which scene an add targets. 'new' = one past the last scene.
  targetScene(scene) {
    const shots = this.shots();
    const maxScene = shots.length ? Math.max(...shots.map(s => this.sceneOf(s))) : 0;
    return scene === 'new' ? maxScene + 1 : (scene != null ? scene : Math.max(1, maxScene));
  }
  // ── quick add — the shot-dump POPUP ─────────────────────────────────────────
  // Adding a shot NEVER opens the workspace. It opens a centered glass dialog built for pouring
  // ideas in: one big ACTION field (title stays the shot's own id), quick settings in reach, an
  // ADVANCED fold for cast/location/look, and a running strip of what this session added.
  //   ⏎ add & next · ⌘⏎ add & done · esc done · ⌘1-8 shot type · ⌃1-9 duration
  // EVERYTHING IS STICKY across adds — set CU + deckhand once, then it's pure typing.
  // Open it from any "＋ Shot · scene N" row, "＋ New scene", the toolbar ＋ Shot, or N / ⇧N.
  openQuickAdd(scene) {
    this.setState({
      quickAdd: {
        scene: this.targetScene(scene), draft: '', type: 'Medium', dur: 4,
        look: '', move: '', panel: null, tagPick: false, added: [],
      }
    });
    // MentionText is a contenteditable div — no autoFocus attribute exists; focus it by handle
    setTimeout(() => this._qaField && this._qaField.focus({ toEnd: true }), 30);
  }
  async quickCreate({ close = false } = {}) {
    const { app, pid } = this.props;
    const QA = this.state.quickAdd;
    if (!QA) return;
    // the action is a LIST LINE, not an essay — cap it so one shot can't blow the whole list up.
    // The full thought belongs in the shot's prompt (workspace), not the action column.
    const desc = QA.draft.trim().slice(0, QUICK_DESC_MAX);
    if (!desc) { if (close) this.setState({ quickAdd: null }); return; }
    // clear the draft immediately — the writer below is async and the user is already typing
    this.setState(close ? { quickAdd: null } : { quickAdd: { ...QA, draft: '' } });
    // @tags in the idea ARE the assignment — "@deckhand boards @pier-7" fills the CAST and LOC
    // columns without ever leaving the field. The tokens stay in the text (the list renders them
    // as chips), and the explicit fields make the columns and refs work from the first render.
    // resolve tags against the SAME pool the menu offered (frontend/entities.js), so what you
    // could tag and what gets assigned can never disagree
    const m = new Map(buildEntityPool(this.props.app, this.props.pid).map(e => [e.key, e]));
    const keys = (desc.match(/@[\w\-.]+/g) || []).map(t => t.slice(1).toLowerCase());
    const cast = keys.filter(k => (m.get(k) || {}).kind === 'talent');
    const loc = keys.find(k => (m.get(k) || {}).kind === 'location') || '';
    // no title — the server titles the shot with its own id (writeShot)
    const sh = await api.addShot(pid, {
      desc, type: QA.type, dur: QA.dur, status: 'todo', scene: QA.scene,
      ...(cast.length ? { cast } : {}),
      ...(loc ? { loc } : {}),
      ...(QA.look ? { look: QA.look } : {}),
      ...(QA.move ? { move: QA.move } : {}),
    }).catch(() => null);
    if (!sh) { app.showToast('Could not add the shot', 'var(--danger)'); return; }
    if (!close) this.setState(s => (s.quickAdd ? { quickAdd: { ...s.quickAdd, added: [...s.quickAdd.added, { id: sh.id, desc }] } } : null));
    app.sync();
  }
  // programmatic add (delete-undo etc.) — creates silently in the target scene
  async addShot({ scene = null } = {}) {
    this.openQuickAdd(scene);
  }
  async openRemotion() {
    const { app } = this.props;
    try {
      const r = await api.openRemotion(this.props.pid);
      app.showToast('Handed ' + r.shots + ' shots to Remotion — frameforge-shots.json written', 'var(--ok)');
      // The old branch tested for 'api ' — the generic status fallback — which is only ever the
      // message when the body carries NO error field. /api/remotion/open always sends one, so the
      // useful reason was always discarded in favour of a generic toast. Show the server's words.
    } catch (e) { app.showToast(e.message || 'Remotion handoff failed', 'var(--danger)'); }
  }

  // ── export menu (F5) — everything an external tool needs, from the client ──
  // Composed through shotGenerate.js (via handoffEntries), NOT read raw off `shot.prompt`: the raw
  // field is the action beat alone, so a straight copy silently dropped the project's look and
  // handed out prompts that render differently from the same shot's Generate button. Same text as
  // the handoff dialog produces — this is just the shortcut that skips recording the order.
  exportPrompts() {
    const { app, pid } = this.props;
    const { entries, skipped } = handoffEntries(app, pid, this.shots());
    const text = entries.map(e => e.shot + ' — ' + e.title + '\n' + e.prompt).join('\n\n');
    navigator.clipboard && navigator.clipboard.writeText(text).catch(() => { });
    app.showToast(
      entries.length + ' prompts copied' + (skipped.length ? ' · ' + skipped.length + ' had no prompt yet' : ''),
      'var(--accent)'
    );
  }
  // The full handoff: same prompts, plus a persisted record of the ORDER, which is what lets the
  // Inbox file the downloads back without renaming or an AI call. Defaults to the current
  // selection, falling back to every shot in view.
  openHandoff(ids) {
    const list = ids && ids.length ? this.shots().filter(s => ids.includes(s.id)) : this.filtered();
    if (!list.length) return this.props.app.showToast('No shots to hand off', 'var(--fg-faint)');
    this.setState({ handoff: list, selRows: {}, selAnchor: null });
  }
  download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  exportCsv() {
    const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const cols = ['id', 'no', 'scene', 'title', 'desc', 'type', 'dur', 'move', 'light', 'transition', 'skill', 'status', 'prompt', 'videoPrompt', 'tags'];
    const rows = [cols.join(','), ...this.shots().map(s => cols.map(c => esc(c === 'tags' ? (s.tags || []).join(' ') : s[c])).join(','))];
    this.download(this.props.pid + '-shots.csv', rows.join('\n'), 'text/csv');
    this.props.app.showToast('shots.csv downloaded', 'var(--ok)');
  }
  exportJson() {
    const shots = this.shots().map(({ log, ...s }) => s);
    this.download(this.props.pid + '-shots.json', JSON.stringify({ project: this.props.pid, exportedAt: new Date().toISOString(), shots }, null, 2), 'application/json');
    this.props.app.showToast('shots.json downloaded', 'var(--ok)');
  }

  skillNames() {
    const { app } = this.props;
    return (app.state.skillRepos || []).filter(r => r.exists).flatMap(r => r.skills.map(s => s.name));
  }
  // "skill 1 for shots 1–4, skill 3 for 5" — the routing plan, computed from the list
  skillPlan(shots) {
    const runs = [];
    shots.slice().sort((a, b) => a.no - b.no).forEach(s => {
      const last = runs[runs.length - 1];
      if (last && last.skill === s.skill) last.nos.push(s.no);
      else runs.push({ skill: s.skill, nos: [s.no] });
    });
    return runs;
  }

  render() {
    const S = this.state;
    const shots = this.shots();
    return (
      <div style={sx('padding:20px 28px 90px')}>
        {this.renderStoryPanel(shots.length)}
        {/* the production strip renders INSIDE renderShots, between the settings row and the
            list — the design's order is story → settings/filters → production → list */}
        {shots.length > 0 && this.renderShots(shots)}
        {S.open && (
          <ShotWorkspace app={this.props.app} pid={this.props.pid} shotId={S.open}
            entities={this.entityPool()} looks={this.allLooks()}
            onClose={() => this.closeShot()}
            renderMentions={t => this.renderMentions(t)}
            onDelete={id => this.deleteShot(id)}
            onDuplicate={id => this.duplicateShot(id)} />
        )}
        {S.assign && this.renderAssign()}
        {S.rebreakAsk && this.renderRebreakAsk()}
        {S.quickAdd && this.renderQuickAdd()}
      </div>
    );
  }

  // assign popover — kind-scoped (cast / location / props / look), anchored at the click,
  // applies to one shot or the whole selection. Assignment is optimistic: the ✓ and the row
  // update the instant you click.
  renderAssign() {
    const S = this.state;
    const { app } = this.props;
    const ids = S.assign.ids || [];
    const kind = S.assign.kind || 'talent';
    const m = this.entMap();
    const targets = this.shots().filter(s => ids.includes(s.id));
    const ents = kind === 'look'
      ? this.allLooks().map(l => ({ kind: 'look', key: l.id, name: l.name }))
      : this.entityPool().filter(e => e.kind === kind);
    const hasAll = ent => targets.length > 0 && targets.every(s =>
      ent.kind === 'look' ? s.look === ent.key :
      ent.kind === 'location' ? this.shotLoc(s, m) === ent.key :
      ent.kind === 'prop' ? this.shotProps(s).includes(ent.key) :
      this.shotCast(s, m).includes(ent.key));
    const x = Math.max(12, Math.min(S.assign.x - 130, window.innerWidth - 292));
    const y = Math.max(12, Math.min(S.assign.y + 10, window.innerHeight - 340));
    const TITLE = { talent: 'CAST', location: 'LOCATION', prop: 'PROPS', look: 'LOOK' }[kind];
    const row = ent => {
      const on = hasAll(ent);
      return (
        <div key={ent.key} onClick={() => this.assignEntity(ids, ent)} className="hRow"
          style={sx('display:flex;align-items:center;gap:9px;padding:6px 12px;cursor:pointer;border-bottom:1px solid var(--line)')}>
          {ent.kind === 'look'
            ? <span style={sx('width:26px;height:26px;border-radius:6px;border:1px solid var(--accent-35);display:inline-flex;align-items:center;justify-content:center;color:var(--accent);font-size:12px;flex:none')}>✦</span>
            : <img src={assetUrl(ent.scope, ent.name, ent.folder)} alt="" style={{ ...sx('width:26px;height:26px;object-fit:cover;flex:none;border:1px solid var(--border-2)'), borderRadius: ent.kind === 'talent' ? 99 : 6 }} />}
          <span style={{ ...sx('font-size:11px;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO }}>{ent.name || ent.key}</span>
          <span style={{ ...sx('margin-left:auto;font-size:11px;flex:none;font-weight:700'), color: on ? 'var(--ok)' : 'var(--fg-faint)' }}>{on ? '✓' : '+'}</span>
        </div>
      );
    };
    return (
      <div onClick={() => this.setState({ assign: null })} style={sx('position:fixed;inset:0;z-index:80')}>
        <div onClick={e => e.stopPropagation()}
          style={{ ...sx('position:fixed;width:280px;max-height:330px;overflow-y:auto;border:1px solid var(--border-3);border-radius:12px;background:var(--surface-2);box-shadow:0 24px 70px rgba(0,0,0,.75);animation:dl-in .12s ease-out'), left: x, top: y }}>
          <div style={sx('padding:9px 12px 6px;font-size:9px;font-weight:700;letter-spacing:.14em;color:var(--fg-muted)')}>
            {TITLE} <span style={sx('color:var(--fg-faint)')}>— {ids.length > 1 ? ids.length + ' shots' : ids[0]} · click toggles</span>
          </div>
          {ents.map(row)}
          {!ents.length && (kind === 'look'
            ? <div onClick={() => { this.setState({ assign: null }); app.openStyleLockPicker(this.props.pid); }}
                style={sx('padding:14px 12px;font-size:11px;color:var(--fg-muted);cursor:pointer')}>No style locks yet — develop one in Tools → Style Locks →</div>
            : <div onClick={() => { this.setState({ assign: null }); app.setState({ projTab: 'assets' }); }}
                style={sx('padding:14px 12px;font-size:11px;color:var(--fg-muted);cursor:pointer')}>Nothing here yet — add images to the {TITLE.toLowerCase()} board in Assets →</div>)}
        </div>
      </div>
    );
  }

  renderRebreakAsk() {
    const n = this.shots().length;
    return (
      <div style={sx('position:fixed;inset:0;z-index:90;background:rgba(5,6,8,.7);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center')}>
        <div style={sx('width:440px;padding:22px 24px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border-3);box-shadow:0 24px 80px rgba(0,0,0,.8)')}>
          <div style={sx('font-weight:700;font-size:15px')}>Re-break: {n} shot{n === 1 ? '' : 's'} already exist</div>
          <div style={sx('font-size:12.5px;color:var(--fg-muted);line-height:1.6;margin-top:8px')}>
            <b style={{ color: 'var(--fg)' }}>Merge</b> appends the new shots after the current set — numbering and linked
            generations stay intact. <b style={{ color: 'var(--fg)' }}>Replace</b> archives the current set to a
            <span style={{ fontFamily: MONO, fontSize: 11 }}> shots-&lt;ts&gt;.bak/</span> folder and starts fresh.
          </div>
          <div style={sx('display:flex;gap:10px;justify-content:flex-end;margin-top:20px')}>
            <Btn size="md" onClick={() => this.setState({ rebreakAsk: false })} style={{ padding: '8px 14px' }}>Cancel</Btn>
            <Btn size="md" onClick={() => this.runBreakdown('merge')} style={{ padding: '8px 14px' }}>Merge after existing</Btn>
            <Btn variant="primary" size="md" onClick={() => this.runBreakdown('replace')}>Replace (archive old)</Btn>
          </div>
        </div>
      </div>
    );
  }

  // STORY — one line, per the handover. It collapses to a single ellipsized row the moment the
  // story has been broken into shots: at that point the shot list IS the working surface and a
  // 180px wall of prose above it just pushes the list off screen. Click the text (or Edit) to
  // expand; it stays expanded while editing and while there are no shots yet.
  renderStoryPanel(nShots) {
    const S = this.state;
    const { app } = this.props;
    const editing = S.storyDraft != null;
    const oneLine = nShots > 0 && !editing && !S.storyOpen;
    // DEV-124 — the collapsed one-liner is a PREVIEW, so it shows the prose, not the syntax. It
    // cannot use <Markdown> (that renders blocks; this is one ellipsized line), so the inline
    // markers are stripped here instead of leaking "**Logline.**" into the summary row.
    const firstLine = String(S.story || '')
      .replace(/^#.*$/m, '').trim().split(/\n+/).filter(Boolean)[0]
      ?.replace(/^\s*[-*+>]\s+/, '')
      .replace(/(\*\*|__|[*_`])/g, '') || '';

    const actions = (
      <>
        <input ref={this.audioRef} type="file" accept="audio/*,video/mp4,video/webm" style={{ display: 'none' }}
          onChange={e => { this.transcribe(e.target.files[0]); e.target.value = ''; }} />
        <span onClick={e => { e.stopPropagation(); this.audioRef.current && this.audioRef.current.click(); }} className="hFg"
          title="Transcribe a voice memo"
          style={{ ...sx('cursor:pointer;flex:none'), fontFamily: MONO, fontSize: 9.5, color: S.transcribing ? 'var(--accent)' : 'var(--fg-faint)' }}>
          {S.transcribing ? 'Transcribing…' : 'Transcribe'}
        </span>
        {/* DEV-124 — focused mode: the same panel, given the height to actually write in. Reusing
            the panel rather than opening a second editor overlay keeps one story surface. */}
        <span onClick={e => { e.stopPropagation(); this.setState(x => ({ storyFocus: !x.storyFocus, storyOpen: true })); }} className="hFg"
          title={S.storyFocus ? 'Back to the compact panel' : 'Focused writing mode'}
          style={{ ...sx('flex:none;cursor:pointer'), fontFamily: MONO, fontSize: 9.5, color: S.storyFocus ? 'var(--accent)' : 'var(--fg-faint)' }}>
          {S.storyFocus ? '⤡ Exit focus' : '⤢ Focus'}
        </span>
        {!editing && <span onClick={e => { e.stopPropagation(); this.setState({ storyDraft: S.story || '' }); }} className="hAccent"
          style={sx('flex:none;font-size:11px;font-weight:600;color:var(--accent);cursor:pointer')}>Edit</span>}
        {editing && <span onClick={e => { e.stopPropagation(); this.setState({ storyDraft: null }); }} className="hFgL"
          style={sx('flex:none;font-size:11px;color:var(--fg-faint);cursor:pointer')}>Cancel</span>}
        {editing && <Btn size="sm" onClick={e => { e.stopPropagation(); this.saveStory(); }}>Save</Btn>}
        <Btn variant="primary" size="sm" busy={S.busy} onClick={e => { e.stopPropagation(); this.breakdown(); }} style={{ padding: '6px 15px', gap: 8, flex: 'none' }}>
          {S.busy ? <><span style={sx('width:7px;height:7px;border-radius:99px;background:var(--accent);animation:dl-pulse 1s infinite')} />Breaking down…</> : <>{nShots ? 'Re-break into shots' : 'Break into shots'}</>}
        </Btn>
      </>
    );

    if (oneLine) {
      return (
        <div onClick={() => this.setState({ storyOpen: true })}
          style={sx('display:flex;align-items:center;gap:12px;border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:10px 16px;margin-bottom:12px;cursor:pointer')}>
          <span style={sx('flex:none;font-size:9px;font-weight:700;letter-spacing:.16em;color:var(--fg-muted)')}>STORY</span>
          <span title="Click to expand"
            style={sx('flex:1;min-width:0;font-size:12px;color:var(--fg-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>
            {firstLine || <span style={sx('color:var(--fg-faint)')}>No story yet — click to write one.</span>}
          </span>
          {actions}
        </div>
      );
    }

    return (
      <div style={{ ...sx('border-radius:12px;background:var(--surface);overflow:hidden;margin-bottom:12px'), border: editing ? '1px solid var(--accent-35)' : '1px solid var(--border)' }}>
        <div style={sx('display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--line)')}>
          <span style={sx('flex:none;font-size:9px;font-weight:700;letter-spacing:.16em;color:var(--fg-muted)')}>STORY</span>
          <span style={{ ...sx('flex:1;min-width:0;color:var(--fg-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 9.5 }}>projects/{this.props.pid}/story.md</span>
          {nShots > 0 && !editing && (
            <span onClick={() => this.setState({ storyOpen: false })} className="hFg"
              style={{ ...sx('flex:none;cursor:pointer'), fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>collapse</span>
          )}
          {actions}
        </div>
        {/* DEV-124 — SOURCE ON EDIT, RENDERED ON READ. The markdown stays the single representation
            (it is what lives in story.md), so there is no rich-text model that could drift from the
            file. The toolbar edits that source through the textarea's own selection. */}
        {editing ? (
          <div style={sx('padding:14px 16px 16px')}>
            <MarkdownToolbar textareaRef={this.storyRef} value={S.storyDraft}
              onChange={v => this.setState({ storyDraft: v })} />
            <textarea ref={this.storyRef} value={S.storyDraft} onChange={e => this.setState({ storyDraft: e.target.value })} autoFocus
              onKeyDown={e => e.stopPropagation()}
              placeholder={'Write the idea, paste a script, or hit Transcribe.\nMarkdown works: # heading, **bold**, - list.\nThe breakdown reads this + the project brief, then routes every shot to the best skill.'}
              style={{ ...sx('width:100%;box-sizing:border-box;resize:vertical;background:var(--sunk);border:1px solid var(--border-2);border-radius:10px;color:var(--fg);font-size:13px;line-height:1.7;padding:14px 16px'), height: S.storyFocus ? '58vh' : '200px' }} />
          </div>
        ) : (
          <div onClick={() => this.setState({ storyDraft: S.story || '' })}
            style={{ ...sx('padding:14px 16px 16px;cursor:text;font-size:12.5px'), maxHeight: S.storyFocus ? '68vh' : '150px', overflowY: 'auto' }}>
            {S.story == null ? <span style={sx('color:var(--fg-faint)')}>Loading…</span>
              : S.story ? <Markdown text={S.story} />
                : <span style={sx('color:var(--fg-faint)')}>No story yet — click to write one, or transcribe a voice memo. Then break it into shots.</span>}
          </div>
        )}
        {!editing && nShots > 0 && app.state.groqReady === false && (
          <div style={sx('padding:8px 16px;border-top:1px solid var(--line);font-size:10.5px;color:var(--danger)')}>No Groq key configured — transcription and breakdown are disabled. Add one in Settings.</div>
        )}
      </div>
    );
  }

  renderShots(shots) {
    const S = this.state;
    const { app } = this.props;
    const list = this.filtered();
    const totalDur = shots.reduce((a, s) => a + (s.dur || 0), 0);
    // Filter pills are Title Case ("To do 3", "Generating 1") while the row status pill is
    // lowercase ("done", "review") — the design frame writes them differently on purpose, so the
    // one shared label is capitalised here rather than stored twice.
    const cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
    const statusDefs = [['all', 'All', shots.length], ...STATUS_ORDER.map(st => [st, cap(SHOT_STATUS[st].label), shots.filter(s => s.status === st).length])];
    const ungenerated = shots.filter(s => !this.shotGenSummary(s).count);
    const pill = (label, on, onClick, accent) => (
      <span key={label} onClick={onClick}
        style={{
          ...sx('padding:3px 11px;border-radius:99px;cursor:pointer;font-size:10.5px'),
          background: on && !accent ? 'var(--fg)' : 'transparent',
          color: accent ? 'var(--accent)' : on ? 'var(--on-accent)' : 'var(--fg-muted)',
          border: '1px solid ' + (accent ? 'var(--accent-35)' : on ? 'var(--fg)' : 'var(--border)'),
          fontWeight: on || accent ? 600 : 400,
        }}>{label}</span>
    );
    return (
      <div>
        {/* ── one settings row: filters left, view + the single ⋯ menu right ── */}
        <div style={sx('display:flex;align-items:center;gap:5px;margin-bottom:12px;flex-wrap:wrap')}>
          {statusDefs.map(([v, l, n]) => pill(l + ' ' + n, S.filStatus === v, () => this.setState({ filStatus: v, sel: 0 })))}
          {ungenerated.length > 0 && pill(
            'Generate all (' + ungenerated.length + ')',
            false,
            () => this.batchGenerate(ungenerated.map(x => x.id)),
            true
          )}
          <span style={sx('margin-left:auto;display:inline-flex;align-items:center;gap:8px')}>
            <span style={{ ...sx('color:var(--fg-faint)'), fontFamily: MONO, fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>{shots.length} shots · {totalDur}s</span>
            <Btn variant="secondary" size="sm" onClick={() => this.addShot()} style={{ padding: '4px 11px' }}>＋ Shot</Btn>
            {shots.length > 0 && (
              <Btn variant="secondary" size="sm"
                title="Open the Timeline — lay these shots down as a cut, add footage, export XML"
                onClick={() => this.props.app.setState({ projTab: 'timeline' })} style={{ padding: '4px 11px' }}>
                Timeline
              </Btn>
            )}
            <span style={sx('display:inline-flex;border:1px solid var(--border);border-radius:7px;overflow:hidden')}>
              {['list', 'board'].map(v => (
                <span key={v} onClick={() => this.setState({ view: v })}
                  style={{ ...sx('padding:4px 11px;font-weight:600;cursor:pointer;font-size:10.5px'), background: S.view === v ? 'var(--raise)' : 'transparent', color: S.view === v ? 'var(--fg)' : 'var(--fg-faint)' }}>
                  {v === 'list' ? 'List' : 'Board'}
                </span>
              ))}
            </span>
            {this.renderMoreMenu()}
          </span>
        </div>

        {this.renderProduction()}

        {/* skill routing folds into the scene headers (dot + range); the standalone strip the
            handover removed only reappears when a filter is active, so it stays clearable */}
        {S.filSkill && S.filSkill !== 'all' && (
          <div style={sx('display:flex;align-items:center;gap:8px;margin-bottom:10px')}>
            <span style={{ ...sx('display:inline-flex;align-items:center;gap:7px;padding:3px 10px;border-radius:99px'), border: '1px solid ' + skillColor(S.filSkill) }}>
              <span style={{ ...sx('width:7px;height:7px;border-radius:2px'), background: skillColor(S.filSkill) }} />
              <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--fg)' }}>{S.filSkill}</span>
            </span>
            <span onClick={() => this.setState({ filSkill: 'all', sel: 0 })} className="hFg"
              style={{ ...sx('cursor:pointer'), fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>✕ clear skill filter</span>
          </div>
        )}

        {S.view === 'list' ? this.renderList(list) : this.renderBoard(list)}
        {!list.length && <div style={{ ...sx('padding:50px 0;text-align:center;color:var(--fg-faint);letter-spacing:.14em;text-transform:uppercase'), fontFamily: MONO, fontSize: 10.5 }}>No shots match this filter — clear a chip above</div>}
        {this.renderSelectionBar()}
        {S.handoff && (
          <ManualHandoff app={app} pid={this.props.pid} shots={S.handoff}
            onClose={() => this.setState({ handoff: null })}
            // straight from "prompts are on your clipboard" into the place the files come back to,
            // so the loop is one continuous surface rather than two features you have to connect
            onDone={() => this.setState({ handoff: null, inboxOpen: true })} />
        )}
        {S.inboxOpen && (
          <ManualInbox app={app} pid={this.props.pid} onClose={() => this.setState({ inboxOpen: false })} />
        )}
      </div>
    );
  }

  // ── the single ⋯ menu — columns · export · remotion ──
  // The handover: "HIDDEN → columns picker, export (csv/json/prompts/pack), Remotion handoff: all
  // inside the single ⋯ menu". Three toolbar buttons became one.
  renderMoreMenu() {
    const S = this.state;
    const { app } = this.props;
    const item = (label, fn, sub) => (
      <div key={label} onClick={() => { this.setState({ moreOpen: false }); fn(); }} className="hRow"
        style={sx('display:flex;align-items:center;gap:9px;padding:7px 13px;font-size:11.5px;color:var(--fg-soft);cursor:pointer;white-space:nowrap')}>
        {label}{sub ? <span style={{ ...sx('margin-left:auto'), fontFamily: MONO, fontSize: 9, color: 'var(--fg-faint)' }}>{sub}</span> : null}
      </div>
    );
    return (
      <span style={sx('position:relative')}>
        <span onClick={() => this.setState(s => ({ moreOpen: !s.moreOpen }))} className="hBd"
          title="Columns · Export · Remotion — everything else"
          aria-expanded={S.moreOpen} aria-haspopup="menu"
          style={{ ...sx('display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;cursor:pointer;font-size:12px'), border: '1px solid var(--border)', color: 'var(--fg-muted)' }}>⋯</span>
        {S.moreOpen && (
          <>
            <div onClick={() => this.setState({ moreOpen: false })} style={sx('position:fixed;inset:0;z-index:19')} />
            <div style={sx('position:absolute;top:32px;right:0;min-width:220px;border:1px solid var(--border-3);border-radius:10px;background:var(--surface-2);box-shadow:0 16px 48px rgba(0,0,0,.7);z-index:20;overflow:hidden;animation:dl-in .12s ease-out')}>
              <div style={sx('padding:8px 13px 5px;font-size:9px;font-weight:700;letter-spacing:.12em;color:var(--fg-faint)')}>COLUMNS — saved per project</div>
              {Object.entries(StoryTab.COL_DEFS).map(([id, def]) => {
                const on = this.listCols().includes(id);
                return (
                  <div key={id} onClick={() => this.toggleCol(id)} className="hRow"
                    style={sx('display:flex;align-items:center;gap:9px;padding:6px 13px;font-size:11.5px;color:var(--fg-soft);cursor:pointer')}>
                    <span style={{ ...sx('width:13px;height:13px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:9px'), border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border-3)'), background: on ? 'var(--accent)' : 'transparent', color: 'var(--on-accent)' }}>{on ? '✓' : ''}</span>
                    {def.label.charAt(0) + def.label.slice(1).toLowerCase()}
                  </div>
                );
              })}
              <div style={sx('border-top:1px solid var(--line)')} />
              {/* manual round-trip — only when the module is on (shared/integrations.mjs) */}
              {(app.state.modules || {}).manualroundtrip && <>
                <div style={sx('border-top:1px solid var(--line)')} />
                <div style={sx('padding:8px 13px 5px;font-size:9px;font-weight:700;letter-spacing:.12em;color:var(--fg-faint)')}>RENDER ELSEWHERE</div>
                {item('Hand off prompts…', () => this.openHandoff(this.selIds()), 'copy + record order')}
                {item('Open Inbox', () => this.setState({ inboxOpen: true }), 'file downloads back')}
              </>}
              <div style={sx('border-top:1px solid var(--line)')} />
              <div style={sx('padding:8px 13px 5px;font-size:9px;font-weight:700;letter-spacing:.12em;color:var(--fg-faint)')}>EXPORT</div>
              {item('Copy all prompts', () => this.exportPrompts())}
              {item('Download shots.csv', () => this.exportCsv())}
              {item('Download shots.json', () => this.exportJson())}
              {item('Export pack', async () => {
                try {
                  const r = await api.exportPack(this.props.pid);
                  app.showToast('Export pack written — ' + r.files.length + ' files in projects/' + this.props.pid + '/export/', 'var(--ok)');
                } catch (e) { app.showToast('Export failed — ' + (e.message || ''), 'var(--danger)'); }
              }, 'export/')}
              <div style={sx('border-top:1px solid var(--line)')} />
              {item('Open in Remotion', () => this.openRemotion())}
            </div>
          </>
        )}
      </span>
    );
  }

  // ── the floating glass selection bar ──
  // Mid-screen, not docked and not an inline strip: the handover puts it at the vertical centre,
  // in the SAME glass shell as the composer, so batch actions read as an overlay on the list
  // rather than as another toolbar competing with the one above.
  renderSelectionBar() {
    const ids = this.selIds();
    if (!ids.length) return null;
    // same model resolution batchGenerate() uses, so the estimate matches what actually runs
    const est = estCost(this.batchModel()) * ids.length;
    return (
      <div className="glass"
        style={{ ...sx('position:fixed;left:50%;top:50%;z-index:60;display:flex;align-items:center;gap:8px;padding:11px 14px'), transform: 'translate(-50%,-50%)', width: 640, boxSizing: 'border-box' }}>
        <span style={{ ...sx('flex:none;font-weight:700;color:var(--accent)'), fontFamily: MONO, fontSize: 10.5 }}>{ids.length} selected</span>
        {[['Cast', 'talent'], ['Location', 'location'], ['Look', 'look'], ['Camera', 'camera'], ['Props', 'prop']].map(([l, kind]) => (
          <Btn key={kind} size="sm" onClick={e => this.setState({ assign: { ids, x: e.clientX, y: e.clientY, kind } })}
            style={{ padding: '4px 11px', fontSize: 10.5 }}>{l}</Btn>
        ))}
        <Cost value={est} style={sx('margin-left:auto')} />
        {/* the free alternative to the button next to it — same prompts, rendered on someone
            else's dime. Sits beside Generate rather than in a menu because the choice between
            "spend here" and "render elsewhere" is made at exactly this moment. */}
        {(this.props.app.state.modules || {}).manualroundtrip && (
          <Btn size="sm" onClick={() => this.openHandoff(ids)} style={{ padding: '5px 14px', fontSize: 11 }}
            title="Copy these prompts for Google Flow / Midjourney / your own rig — free">
            Hand off {ids.length}
          </Btn>
        )}
        <Btn variant="secondary" size="sm" onClick={() => this.batchGenerate(ids)} style={{ padding: '5px 14px', fontSize: 11 }}>
          Generate {ids.length}
        </Btn>
        <span onClick={() => this.setState({ selRows: {}, selAnchor: null })} className="hFg"
          style={{ ...sx('flex:none;cursor:pointer'), fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)' }}>✕ Esc</span>
      </div>
    );
  }

  // ── @mention entities in shot descriptions (F5, proposal-app pattern) ──
  // pool: this project's context assets + library, keyed by basename without extension
  mentionPool() {
    const { app, pid } = this.props;
    const pool = [];
    const p = app.state.projects.find(x => x.id === pid);
    (((p || {}).context || {}).items || []).forEach(c => (c.type === 'image' || c.type === 'video') && pool.push({ ...c, scope: pid }));
    ((app.state.library || {}).items || []).forEach(c => (c.type === 'image' || c.type === 'video') && pool.push({ ...c, scope: 'library' }));
    return pool;
  }
  mentionKey(name) { return name.replace(/\.\w+$/, '').toLowerCase(); }
  // render desc text with @asset-name mentions as kind-colored chips → lightbox
  renderMentions(text) {
    if (!text || !text.includes('@')) return text;
    const { app } = this.props;
    const byKey = new Map(this.mentionPool().map(c => [this.mentionKey(c.name), c]));
    const parts = String(text).split(/(@[\w\-\.]+)/g);
    return parts.map((part, i) => {
      if (!part.startsWith('@')) return part;
      const c = byKey.get(part.slice(1).toLowerCase());
      if (!c) return part;
      const kd = kindDef(c.meta?.kind);
      return (
        <span key={i} onClick={e => {
          e.stopPropagation();
          if (c.scope === 'library') app.go('library');
          else app.setState(folderKind(c.folder) === 'asset' ? { projTab: 'assets' } : { projTab: 'references', refSub: 'moods' });
        }} title={'@' + part.slice(1) + ' — ' + c.name + (c.meta?.description ? ' · ' + c.meta.description : '')}
          style={{ ...sx('display:inline-flex;align-items:center;gap:4px;border-radius:5px;padding:0 6px;cursor:pointer;font-weight:600'), fontFamily: MONO, fontSize: '0.9em', color: kd ? kd.color : 'var(--accent)', background: 'var(--raise)', border: '1px solid ' + (kd ? 'var(--border-2)' : 'var(--accent-35)') }}>
          {/* always the @ sigil — ASSET_KINDS.icon carries a pictographic glyph for `talent`,
              and this surface is typographic-only. The kind still reads through kd.color.
              DISPLAY NAME, never the raw key: a generated asset's key is 'gen-1784…-32', and a
              chip reading that is noise. The key survives in the tooltip; renaming the entity
              (production strip) fixes every chip at once. */}
          @{(c.label || c.meta?.label || '').trim() || part.slice(1)}
        </span>
      );
    });
  }

  // last real file linked to a shot (via shot.assets → item versions) — null if none
  shotFile(sh) {
    const { app } = this.props;
    for (const aid of (sh.assets || []).slice().reverse()) {
      const it = (app.state.items || []).find(x => x.id === aid);
      const f = it && app.fileOf(it);
      if (f) return f;
    }
    return null;
  }

  // ── list columns (project-level setting) ──
  // Widths come straight from the design frame's grid template
  // (16px 52px 66px 1fr 84px 130px 92px 30px 104px): SETTINGS 84 · STYLE 130 · CAST 92 · LOC 30.
  // The fixed head/tail (select · SHOT · IMAGE · ACTION · status) is not a COL_DEF — it is not
  // optional, so it lives in renderList's template rather than in the Columns menu.
  // Declaration order IS the column order the Columns menu re-derives on toggle (see toggleCol),
  // so it must open on the design's set, left to right: SETTINGS · STYLE · CAST · LOC.
  static COL_DEFS = {
    settings: { label: 'SETTINGS', w: '84px' },
    look: { label: 'STYLE', w: '130px' },
    cast: { label: 'CAST', w: '92px' },
    loc: { label: 'LOC', w: '30px' },
    props: { label: 'PROPS', w: '76px' },
    type: { label: 'TYPE', w: '72px' },
    dur: { label: 'DUR', w: '48px' },
    skill: { label: 'SKILL', w: '140px' },
    tags: { label: 'TAGS', w: '130px' }
  };
  listCols() {
    const p = this.props.app.projDef(this.props.pid);
    const raw = p.listCols || ['settings', 'look', 'cast', 'loc'];
    // migrate the short-lived combined 'entities' column to the split cast/loc pair
    let cols = raw.flatMap(c => c === 'entities' ? ['cast', 'loc'] : [c]);
    // migrate the separate TYPE + DUR pair to the merged SETTINGS cell (the handover's column set:
    // SHOT · IMAGE · ACTION · SETTINGS · STYLE · CAST · LOC). A saved layout that predates SETTINGS
    // gains it at the front; it can still be turned off again from the Columns menu.
    if (!cols.includes('settings')) cols = ['settings', ...cols];
    // the design's header row is SHOT · IMAGE · ACTION · SETTINGS · STYLE · CAST · LOC —
    // type/dur folded into SETTINGS, and PROPS is not one of its columns.
    cols = cols.filter(c => c !== 'type' && c !== 'dur' && c !== 'props');
    const on = new Set(cols.filter(c => StoryTab.COL_DEFS[c]));
    // ORDER COMES FROM COL_DEFS, NOT FROM THE SAVED ARRAY. A project saved before the handover
    // holds its own order (e.g. cast·loc·look·props), and honouring it renders
    // SETTINGS·CAST·LOC·STYLE — not the design's SETTINGS·STYLE·CAST·LOC. The saved value decides
    // WHICH columns show; COL_DEFS decides the order. That is why COL_DEFS' key order is
    // load-bearing — see the note on the declaration.
    return Object.keys(StoryTab.COL_DEFS).filter(c => on.has(c));
  }
  toggleCol(id) {
    const cur = this.listCols();
    const next = cur.includes(id) ? cur.filter(c => c !== id) : [...Object.keys(StoryTab.COL_DEFS).filter(c => cur.includes(c) || c === id)];
    this.props.app.patchProjMeta(this.props.pid, { listCols: next });
  }

  // ── per-shot generation summary (drives glyph, thumb, badge) ──
  shotGenSummary(sh) {
    const { app } = this.props;
    const files = new Set(); let pending = 0; let heroFile = null;
    for (const g of (app.projDef(this.props.pid).gens || [])) {
      if (g.shot !== sh.id || g.reviewState === 'killed') continue;
      if (g.status === 'queued' || g.status === 'running') pending++;
      if (g.file) { files.add(g.file); if (sh.selectedCandidate === g.id) heroFile = g.file; }
    }
    for (const aid of (sh.assets || [])) {
      const it = (app.state.items || []).find(x => x.id === aid);
      for (const v of ((it && it.versions) || [])) if (v.file) files.add(v.file);
    }
    if (!heroFile) heroFile = this.shotFile(sh) || (files.size ? [...files][files.size - 1] : null);
    const hasVid = [...files].some(f => /\.(mp4|mov|webm)$/i.test(f));
    return { count: files.size, pending, heroFile, hasVid };
  }
  // ── inline TAKES panel ─────────────────────────────────────────────────────
  // Every take of a shot, oldest → newest. Deliberately INCLUDES killed candidates, unlike
  // shotGenSummary(), because the panel has to show the ✕ badge on them — the row thumbnail and
  // the ×N count must keep ignoring them, so the two readers stay separate on purpose.
  shotTakes(sh) {
    const { app } = this.props;
    const out = []; const seen = new Set();
    for (const g of (app.projDef(this.props.pid).gens || [])) {
      if (g.shot !== sh.id) continue;
      if (g.file) seen.add(g.file);
      out.push({
        key: 'g' + g.id, gen: g, file: g.file || null, status: g.status, ts: g.started || 0,
        kept: g.reviewState === 'kept', killed: g.reviewState === 'killed',
        hero: sh.selectedCandidate === g.id, cost: g.cost, model: g.model
      });
    }
    for (const aid of (sh.assets || [])) {
      const it = (app.state.items || []).find(x => x.id === aid); if (!it) continue;
      for (const v of (it.versions || [])) {
        if (!v.file || seen.has(v.file)) continue;
        seen.add(v.file);
        out.push({ key: aid + v.v, gen: null, file: v.file, status: 'done', ts: v.ts || 0, kept: true, killed: false, hero: false, cost: v.cost });
      }
    }
    return out.sort((a, b) => a.ts - b.ts);
  }
  // keep · kill · re-roll · final — the same four endpoints the shot workspace drives, so a take
  // reviewed from the list and one reviewed from the overlay land in exactly the same place.
  async takeKeep(t) {
    const { app, pid } = this.props;
    if (!t.gen || !t.file || t.kept) return;
    try { await api.saveGenToShot(pid, t.gen.id, t.gen.shot); app.showToast('Kept', 'var(--ok)'); app.sync(); }
    catch (e) { app.showToast('Keep failed — ' + (e.message || ''), 'var(--danger)'); }
  }
  async takeKill(t) {
    const { app, pid } = this.props;
    if (!t.gen) return;
    try {
      await api.reviewCandidate(pid, t.gen.id, { patch: { reviewState: 'killed' } });
      app.showToast('Killed — staged for cleanup in Trash', 'var(--danger)');
      app.sync();
    } catch (e) { app.showToast('Kill failed — ' + (e.message || ''), 'var(--danger)'); }
  }
  async takeReroll(t) {
    const { app, pid } = this.props;
    if (!t.gen || t.status !== 'done') return;
    try { await api.rerollCandidate(pid, t.gen.id, { freshSeed: true }); app.showToast('Re-roll queued — fresh seed', 'var(--accent)'); app.sync(); }
    catch (e) { app.showToast('Re-roll failed — ' + (e.message || ''), 'var(--danger)'); }
  }
  // "▶ start" — designate this take as the video's start image. On disk that IS the shot's final
  // select (save-to-shot with final:true), which is what STEP 2 then attaches as a kind:'render'
  // reference. One concept, one write — not a second per-shot field the backend never reads.
  async takeStart(t, sh) {
    const { app, pid } = this.props;
    if (!t.gen || !t.file) return;
    try {
      await api.saveGenToShot(pid, t.gen.id, sh.id, true);
      app.showToast('Start image set — selects/ updated on disk', 'var(--ok)');
      app.sync();
    } catch (e) { app.showToast('Could not set start image — ' + (e.message || ''), 'var(--danger)'); }
  }
  // STEP 2 — animate the final still into a clip. The chosen take rides along as a kind:'render'
  // reference (backend/generate.mjs:206), which is how a start image reaches an i2v model.
  async animateFinal(sh, take) {
    const { app, pid } = this.props;
    const model = (app.state.settings || {}).modelDefaults?.video;
    if (!model) { app.showToast('No video model default set — pick one in Settings → Model defaults', 'var(--danger)'); return; }
    const prompt = (sh.videoPrompt || sh.prompt || sh.desc || '').trim();
    if (!prompt) { app.showToast('This shot has no prompt to animate', 'var(--danger)'); return; }
    const lock = this.lookOf(sh);
    try {
      await api.generate({
        pid, shot: sh.id,
        prompt: lock && lock.fragment ? joinFragment(prompt, lock.fragment) : prompt,
        model, aspect: '16:9', resolution: DEFAULT_RESOLUTION, seed: null,
        refs: [{ kind: 'render', scope: pid, name: take.file }]
      });
      app.showToast('STEP 2 queued — animating ' + sh.id + ' from its start image', 'var(--ok)');
      app.sync();
    } catch (e) { app.showToast('Animate failed — ' + (e.message || ''), 'var(--danger)'); }
  }

  // The panel itself — drops in directly beneath its row, spanning the full list width.
  renderTakesPanel(sh) {
    const { app, pid } = this.props;
    const takes = this.shotTakes(sh);
    const final = takes.find(t => t.hero) || takes.filter(t => t.file && !t.killed).pop() || null;
    const spent = takes.reduce((a, t) => a + (Number(t.cost) || 0), 0);
    const model = this.batchModel();
    const batch4 = estimateCost(model, { variantCount: 4 }).total;
    const act = (label, on, tone, title) => (
      <span key={label} onClick={e => { e.stopPropagation(); on(); }} title={title}
        style={{
          ...sx('font-size:8.5px;font-weight:700;border-radius:5px;padding:2px 7px;cursor:pointer;white-space:nowrap'),
          background: tone === 'keep' ? 'var(--ok)' : 'rgba(13,14,17,.6)',
          color: tone === 'keep' ? 'var(--on-accent)' : tone === 'kill' ? 'var(--danger)' : 'var(--fg-soft)',
          border: '1px solid ' + (tone === 'keep' ? 'var(--ok)' : tone === 'kill' ? 'var(--danger)' : 'var(--border-2)')
        }}>{label}</span>
    );
    const badge = t => {
      const b = t.killed ? ['✕', 'var(--danger)'] : t.hero ? ['FINAL', 'var(--accent)'] : t.kept ? ['✓', 'var(--ok)'] : null;
      if (!b) return null;
      return (
        <span style={{ ...sx('position:absolute;top:4px;left:4px;font-size:8px;font-weight:800;border-radius:3px;padding:0 4px;z-index:2'), background: b[1], color: 'var(--on-accent)' }}>{b[0]}</span>
      );
    };
    const dashed = (main, sub, onClick, title) => (
      <div onClick={e => { e.stopPropagation(); onClick(); }} title={title} className="hBdAccent"
        style={{ ...sx('border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer'), aspectRatio: '16/9', border: '1.5px dashed var(--border)' }}>
        <span style={{ fontFamily: MONO, fontSize: 9, color: 'var(--accent)' }}>{main}</span>
        {sub && <span style={{ fontFamily: MONO, fontSize: 8.5, color: 'var(--fg-muted)', fontVariantNumeric: 'tabular-nums' }}>{sub}</span>}
      </div>
    );
    return (
      <div key={'takes' + sh.id} onClick={e => e.stopPropagation()}
        style={sx('padding:11px 16px 13px;border-bottom:1px solid var(--line);background:var(--ink)')}>
        <div style={sx('display:flex;align-items:center;gap:8px;margin-bottom:8px')}>
          <span style={{ ...sx('letter-spacing:.12em;text-transform:uppercase;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9 }}>
            {sh.id} · STEP 1 — IMAGES · {takes.length} TAKE{takes.length === 1 ? '' : 'S'}
          </span>
          <span style={{ ...sx('margin-left:auto;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9, fontVariantNumeric: 'tabular-nums' }}>${spent.toFixed(3)} spent</span>
        </div>
        <div style={sx('display:grid;grid-template-columns:repeat(6,1fr);gap:7px')}>
          {takes.map(t => (
            <RenderTile key={t.key} src={t.file ? api.renderUrl(pid, t.file) : null} kind={mediaKind(t.file || '')}
              aspect="16/9" selected={t.hero} idleColor="var(--border)"
              title={t.model || ''} onClick={() => { this.setState({ sel: this.filtered().findIndex(x => x.id === sh.id) }); this.openShot(sh); }}
              style={sx('border-radius:8px')}
              placeholder={t.status === 'queued' || t.status === 'running'
                ? <span style={{ ...sx('width:7px;height:7px;border-radius:99px'), background: 'var(--marked)', animation: 'dl-pulse 1.2s infinite' }} />
                : <span style={{ fontFamily: MONO, fontSize: 9, color: 'var(--border-3)' }}>—</span>}
              overlay={<>
                {badge(t)}
                {t.gen && t.file && (
                  <div className="rv" style={sx('position:absolute;inset:0;display:flex;align-items:flex-end;justify-content:center;padding:6px;background:linear-gradient(180deg,transparent 55%,rgba(6,7,10,.75))')}>
                    <span style={sx('display:inline-flex;gap:4px;flex-wrap:wrap;justify-content:center')}>
                      {act('keep', () => this.takeKeep(t), 'keep', 'Keep this take')}
                      {act('kill', () => this.takeKill(t), 'kill', 'Kill — staged for cleanup in Trash')}
                      {act('re-roll', () => this.takeReroll(t), 'ghost', 'Same prompt, fresh seed')}
                      {act('▶ start', () => this.takeStart(t, sh), 'ghost', 'Use as start image for video — marks it FINAL')}
                    </span>
                  </div>
                )}
              </>} />
          ))}
          {dashed('＋1', null, () => this.takeAgain([sh.id]), 'One more take of ' + sh.id + ' — same prompt, model and settings as the last')}
          {dashed('＋4×', 'batch ≈$' + batch4.toFixed(3), () => this.takeAgain([sh.id], { repeat: 4 }), 'Four more takes of ' + sh.id + ' — same prompt, model and settings as the last')}
        </div>
        <div style={sx('display:flex;align-items:center;gap:8px;margin-top:9px;flex-wrap:wrap')}>
          <span onClick={() => final && this.animateFinal(sh, final)} className={final ? 'hBdAccent' : ''}
            title={final ? 'Generate the clip with the final still attached as its start image' : 'Pick a final still first — ▶ start on any take'}
            style={{
              ...sx('font-size:9.5px;font-weight:700;border-radius:6px;padding:3px 10px;white-space:nowrap'),
              border: '1px solid ' + (final ? 'var(--accent-35)' : 'var(--border)'),
              color: final ? 'var(--accent)' : 'var(--fg-faint)',
              cursor: final ? 'pointer' : 'default'
            }}>▶ STEP 2 · Animate final → video (start image attached)</span>
          <span onClick={() => this.openShot(sh)} className="hBd"
            style={{ ...sx('font-size:9.5px;font-weight:700;border-radius:6px;padding:3px 10px;cursor:pointer;color:var(--fg-soft)'), border: '1px solid var(--border-2)' }}>Open workspace</span>
          <span style={{ ...sx('margin-left:auto;letter-spacing:.06em;color:var(--border-3)'), fontFamily: MONO, fontSize: 8.5 }}>
            SOLO GENERATE ON ANY ROW · BATCH VIA ROW SELECTION + GLASS BAR
          </span>
        </div>
      </div>
    );
  }

  // one assignable cell — click opens the picker, the corner handle drags down to fill.
  // Cell content updates optimistically the instant an assignment lands.
  assignCell(sh, i, col) {
    const S = this.state;
    const m = this.entMap();
    const ent = k => m.get(k);
    const av = (c, round) => c && <img key={c.key} src={assetUrl(c.scope, c.name, c.folder)} title={c.key} alt=""
      style={{ ...sx('width:21px;height:21px;object-fit:cover;border:1px solid var(--border-2);flex:none'), borderRadius: round ? 99 : 5 }} />;
    let content, has;
    if (col === 'cast') {
      const cast = this.shotCast(sh, m).map(ent).filter(Boolean);
      has = cast.length > 0;
      content = <>{cast.slice(0, 3).map(c => av(c, true))}{cast.length > 3 && <span style={{ fontFamily: MONO, fontSize: 9, color: 'var(--fg-muted)' }}>+{cast.length - 3}</span>}</>;
    } else if (col === 'loc') {
      const loc = ent(this.shotLoc(sh, m) || '');
      has = !!loc;
      content = av(loc, false);
    } else if (col === 'props') {
      const props = this.shotProps(sh).map(ent).filter(Boolean);
      has = props.length > 0;
      content = <>{props.slice(0, 2).map(c => av(c, false))}{props.length > 2 && <span style={{ fontFamily: MONO, fontSize: 9, color: 'var(--fg-muted)' }}>+{props.length - 2}</span>}</>;
    } else {
      const own = sh.look && (this.allLooks().find(x => x.id === sh.look) || null);
      const eff = this.lookOf(sh);
      has = !!own;
      content = (own || eff)
        ? <span style={{ ...sx('overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 9.5, color: own ? 'var(--accent)' : 'var(--fg-faint)' }}>✦ {(own || eff).name}{!own ? ' ·proj' : ''}</span>
        : null;
    }
    const kind = { cast: 'talent', loc: 'location', props: 'prop', look: 'look' }[col];
    const inFill = S.fill && S.fill.col === col && i >= Math.min(S.fill.fromIx, S.fill.toIx) && i <= Math.max(S.fill.fromIx, S.fill.toIx);
    return (
      <span key={col} className="hBg ffCell"
        onClick={e => { e.stopPropagation(); this.setState({ assign: { ids: [sh.id], x: e.clientX, y: e.clientY, kind } }); }}
        title={StoryTab.COL_DEFS[col].label.toLowerCase() + ' — click to assign · drag the corner handle down to fill'}
        style={{ ...sx('position:relative;display:inline-flex;align-items:center;gap:3px;overflow:hidden;cursor:pointer;min-height:23px;border-radius:6px;padding:1px 3px'), boxShadow: inFill ? 'inset 0 0 0 1px var(--accent)' : 'none' }}>
        {content}
        {!has && (col !== 'look' || !content) && <span style={sx('font-size:13px;color:var(--border-3);line-height:1')}>＋</span>}
        {(has || col === 'look') && (
          <span className="ffFill" onMouseDown={e => { e.stopPropagation(); e.preventDefault(); this.setState({ fill: { col, fromIx: i, toIx: i, src: sh } }); }}
            title="Drag down to fill the shots below"
            style={sx('position:absolute;right:1px;bottom:1px;width:9px;height:9px;border-radius:2px;border:1px solid var(--accent);background:var(--accent-12);cursor:ns-resize')} />
        )}
      </span>
    );
  }

  renderList(list) {
    const S = this.state;
    const { app } = this.props;
    const colIds = this.listCols();
    // The design's grid, exactly: 16px 52px 66px 1fr 84px 130px 92px 30px 104px — select · SHOT ·
    // IMAGE · ACTION · <the toggleable columns> · status/action. There is NO gen-glyph column; the
    // progress it showed now reads off the thumbnail itself (pulse while generating, ×N when there
    // are several takes), which is where the eye already is.
    const cols = ['16px', '52px', '66px', '1fr', ...colIds.map(c => StoryTab.COL_DEFS[c].w), '104px'].join(' ');
    const cell = (sh, id, ix) => {
      // SETTINGS — "Wide · 6s". Opens the composer's TECH popover, not a second picker:
      // the handover allows exactly two popovers app-wide. Shot type/duration are shot fields and
      // get their own section at the top; model/aspect/resolution/params stay spec-driven.
      if (id === 'settings') return (
        <TechSettings
          key={id}
          label={[sh.type, sh.dur ? sh.dur + 's' : null].filter(Boolean).join(' · ') || '—'}
          settings={app.state.settings}
          value={S.gen[sh.id] || { model: '', aspect: '16:9', resolution: undefined, seed: '', variantCount: 1, params: {} }}
          onChange={g => this.setState(st => ({ gen: { ...st.gen, [sh.id]: g } }))}
          shot={sh}
          shotTypes={SHOT_TYPES}
          onShotChange={patch => this.patchShotField(sh, patch, 'settings → ' + JSON.stringify(patch))}
        />
      );
      if (id === 'type') return <span key={id} style={sx('font-size:10.5px;color:var(--fg-muted)')}>{sh.type}</span>;
      if (id === 'dur') return <span key={id} style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--fg-muted)', fontVariantNumeric: 'tabular-nums' }}>{sh.dur}s</span>;
      if (id === 'skill') return (
        <span key={id} title={sh.skillWhy} style={sx('display:inline-flex;align-items:center;gap:7px;min-width:0')}>
          <span style={{ ...sx('width:7px;height:7px;border-radius:2px;flex:none'), background: skillColor(sh.skill) }} />
          <span style={{ ...sx('overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 10.5, color: 'var(--fg-soft)' }}>{sh.skill || '—'}</span>
        </span>
      );
      if (id === 'cast' || id === 'loc' || id === 'look' || id === 'props') return this.assignCell(sh, ix, id);
      if (id === 'tags') return (
        <span key={id} style={sx('display:inline-flex;gap:4px;overflow:hidden')}>
          {(sh.tags || []).slice(0, 3).map(t => <span key={t} style={{ ...sx('font-size:9px;color:var(--fg-faint);border:1px solid var(--border);border-radius:4px;padding:0 5px;white-space:nowrap'), fontFamily: MONO }}>{t}</span>)}
        </span>
      );
      return null;
    };
    return (
      <div style={sx('border:1px solid var(--border);border-radius:12px;background:var(--surface);overflow:hidden')}>
        <div style={{ ...sx('display:grid;gap:12px;padding:8px 16px;font-size:9px;font-weight:700;letter-spacing:.12em;color:var(--fg-faint);border-bottom:1px solid var(--border)'), gridTemplateColumns: cols }}>
          <span /><span>SHOT</span><span>IMAGE</span><span>ACTION</span>
          {colIds.map(c => <span key={c}>{StoryTab.COL_DEFS[c].label}</span>)}
          <span />
        </div>
        {list.map((sh, i) => {
          const st = SHOT_STATUS[sh.status] || SHOT_STATUS.todo;
          const cur = i === Math.min(S.sel, list.length - 1);
          const gs = this.shotGenSummary(sh);
          // The design ALWAYS groups the list by scene, so this is unconditional. It used to be
          // gated on `list.some(x => x.scene)`, and every shot in a real project carries
          // scene:null — the gate was false and the headers the design specifies never rendered
          // at all. sceneOf() derives the scene from the title prefix when the field is absent.
          const scene = this.sceneOf(sh);
          const sceneHead = i === 0 || this.sceneOf(list[i - 1]) !== scene;
          const collapsed = S.collapsed[scene];
          // The scene header absorbs the skill-routing plan: the standalone SKILL ROUTING strip
          // that used to sit above the list is gone, and its dot + range now reads inline where
          // the shots it describes actually are. skillPlan() already computes the runs; feeding it
          // just this scene's shots yields the per-scene segments.
          const header = sceneHead && (() => {
            const mine = list.filter(x => this.sceneOf(x) === scene);
            const sceneTitle = this.sceneTitleOf(sh);
            return (
              <div key={'scene' + scene} onClick={() => this.setState(s => ({ collapsed: { ...s.collapsed, [scene]: !collapsed } }))}
                title={collapsed ? 'Expand scene ' + scene : 'Collapse scene ' + scene}
                className="hBg" style={sx('display:flex;align-items:baseline;gap:10px;padding:9px 16px;background:var(--surface);border-bottom:1px solid var(--line);cursor:pointer')}>
                {/* DEV-124 — collapse/expand HAS existed since Phase 1, but the only cue was a 9px
                    glyph at the far right of the row, which is why the report read it as missing.
                    A disclosure triangle belongs at the head of the thing it discloses: leading,
                    larger, and it turns instead of swapping character. */}
                <span style={{
                  ...sx('flex:none;display:inline-block;width:11px;transition:transform .12s ease'),
                  fontSize: 11, color: 'var(--fg-muted)',
                  transform: collapsed ? 'none' : 'rotate(90deg)'
                }}>▸</span>
                <span style={sx('font-size:10px;font-weight:800;letter-spacing:.16em;color:var(--fg-muted)')}>SCENE {scene}{sceneTitle ? ' — ' + sceneTitle.toUpperCase() : ''}</span>
                <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)', fontVariantNumeric: 'tabular-nums' }}>{mine.length} shot{mine.length === 1 ? '' : 's'} · {mine.reduce((a, x) => a + (x.dur || 0), 0)}s</span>
                {this.skillPlan(mine).filter(r => r.skill).map((r, ri) => (
                  <span key={r.skill + ri} title={'Filter the list to ' + r.skill}
                    onClick={e => { e.stopPropagation(); this.setState({ filSkill: S.filSkill === r.skill ? 'all' : r.skill, sel: 0 }); }}
                    style={sx('display:inline-flex;align-items:center;gap:5px;margin-left:6px;cursor:pointer')}>
                    <span style={{ ...sx('width:7px;height:7px;border-radius:2px;flex:none'), background: skillColor(r.skill) }} />
                    <span style={{ fontFamily: MONO, fontSize: 9, color: 'var(--fg-faint)', fontVariantNumeric: 'tabular-nums' }}>
                      {r.skill} {r.nos.length > 1 ? r.nos[0] + '–' + r.nos[r.nos.length - 1] : r.nos[0]}
                    </span>
                  </span>
                ))}
                {/* the trailing glyph is now a word — "collapse"/"expand" says what the row does
                    without the reader having to know what a bare ▾ means here */}
                <span style={{ ...sx('margin-left:auto;flex:none'), fontFamily: MONO, fontSize: 9, color: 'var(--fg-faint)' }}>{collapsed ? 'expand' : 'collapse'}</span>
              </div>
            );
          })();
          if (collapsed) return header || null;
          const rowSel = !!S.selRows[sh.id];
          const row = (
            <div key={sh.id}
              onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey) { this.toggleRow(sh, i, e); return; } this.setState({ sel: i }); this.openShot(sh); }}
              onMouseEnter={() => S.fill && this.setState(s => ({ fill: { ...s.fill, toIx: i } }))}
              data-rowix={i}
              className="hBg rvH" draggable
              onDragStart={e => { this.setState({ dragId: sh.id }); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={e => { if (S.dragId || S.dragEnt) { e.preventDefault(); if (S.dragOver !== sh.id) this.setState({ dragOver: sh.id }); } }}
              onDrop={e => {
                e.preventDefault();
                // an entity chip dropped from the production header assigns; a row drop reorders
                if (S.dragEnt) { this.assignEntity([sh.id], S.dragEnt, { forceAdd: true }); this.setState({ dragEnt: null, dragOver: null }); return; }
                this.dropReorder(sh.id);
              }}
              onDragEnd={() => this.setState({ dragId: null, dragOver: null })}
              style={{ ...sx('display:grid;gap:12px;align-items:center;padding:9px 16px;border-bottom:1px solid var(--line);cursor:pointer'), gridTemplateColumns: cols, background: rowSel ? 'var(--accent-05)' : cur ? 'var(--surface-2)' : 'transparent', boxShadow: S.dragOver === sh.id && (S.dragEnt || S.dragId !== sh.id) ? 'inset 0 2px 0 var(--accent)' : cur ? 'inset 2px 0 0 var(--accent)' : 'none', opacity: S.dragId === sh.id ? 0.4 : 1 }}>
              <span onClick={e => { e.stopPropagation(); this.toggleRow(sh, i, e); }} title="Select — ⇧ for a range, then batch assign / generate"
                style={{ ...sx('width:14px;height:14px;border-radius:5px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:800'), border: '1px solid ' + (rowSel ? 'var(--accent)' : 'var(--border-2)'), background: rowSel ? 'var(--accent)' : 'transparent', color: 'var(--on-accent)' }}>{rowSel ? '✓' : ''}</span>
              <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>{sh.id}</span>
              {/* IMAGE — the thumbnail is the takes affordance: clicking it expands the inline
                  panel beneath this row rather than opening the full workspace overlay. Empty is a
                  dashed em-dash placeholder; the Generate call-to-action lives in the last column,
                  where every other row action is. */}
              <span onClick={e => { e.stopPropagation(); this.setState(s => ({ expanded: s.expanded === sh.id ? null : sh.id, sel: i })); }}
                title={gs.count ? gs.count + ' take' + (gs.count === 1 ? '' : 's') + ' — click for the takes panel' : 'No takes yet — click to open the takes panel'}
                style={sx('position:relative;width:60px;height:34px;border-radius:5px;overflow:hidden;display:flex;align-items:center;justify-content:center;cursor:pointer')}>
                {gs.heroFile
                  ? <>
                      <img src={api.renderUrl(sh.proj, gs.heroFile)} alt="" loading="lazy" style={sx('width:100%;height:100%;object-fit:cover;display:block')} />
                      {gs.count > 1 && <span style={{ ...sx('position:absolute;bottom:1px;right:2px;border-radius:3px;padding:0 4px'), fontFamily: MONO, fontSize: 8.5, background: 'rgba(6,7,10,.8)', color: 'var(--fg-soft)' }}>×{gs.count}</span>}
                    </>
                  : gs.pending
                    ? <span style={{ ...sx('width:100%;height:100%;border-radius:5px;display:flex;align-items:center;justify-content:center;background:var(--sunk)') }}>
                        <span style={{ ...sx('width:7px;height:7px;border-radius:99px'), background: 'var(--marked)', animation: 'dl-pulse 1.2s infinite' }} />
                      </span>
                    : <span className="hBdAccent" style={{ ...sx('width:100%;height:100%;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--border-3)'), border: '1px dashed var(--border-2)', boxSizing: 'border-box' }}>—</span>}
              </span>
              {/* TITLE + ACTION — both inline-editable. Two separate persisted fields that have
                  existed on the shot record all along (backend/story.mjs:50); the list just never
                  offered a way to write them. Enter or blur commits, Escape reverts, and a
                  no-op edit writes nothing. */}
              <div style={sx('min-width:0')}>
                <InlineEdit
                  value={sh.title}
                  placeholder={sh.id}
                  title="Shot title — click to edit"
                  onCommit={v => this.patchShotField(sh, { title: v }, 'title → ' + (v || '(empty)'))}
                  style={sx('font-size:12.5px;font-weight:600;color:var(--fg)')}
                />
                <div style={sx('margin-top:2px')}>
                  <InlineEdit
                    value={sh.desc}
                    placeholder="Describe the action…"
                    title="Action — click to edit"
                    renderValue={v => this.renderMentions(v)}
                    onCommit={v => this.patchShotField(sh, { desc: v }, 'action → ' + (v || '(empty)'))}
                    style={sx('font-size:11px;color:var(--fg-muted)')}
                  />
                </div>
              </div>
              {colIds.map(c => cell(sh, c, i))}
              {/* Last cell is either/or, per the design: a shot with no generation at all offers
                  the outlined accent Generate; anything else shows its status pill (＋ the ✓
                  approve affordance once there is something to approve). The ★ has no column of
                  its own any more — it reveals on row hover so the fav filter stays reachable
                  without spending a ninth column on it. */}
              {/* No 'to do' pill exists anywhere in the design frame — its rows carry only
                  done / generating / review pills, and every to-do shot shows Generate instead.
                  So the fork is on STATUS, not on take count: a todo shot keeps its Generate
                  call-to-action even if stale takes exist. */}
              {(gs.count || gs.pending) && sh.status !== 'todo' ? (
                <span style={sx('display:inline-flex;align-items:center;gap:5px;min-width:0')}>
                  <span onClick={e => { e.stopPropagation(); this.cycleStatus(sh); }} title="Cycle status — S"
                    style={{ ...sx('font-size:9.5px;font-weight:700;letter-spacing:.08em;border-radius:99px;padding:2px 9px;text-align:center;cursor:pointer'), color: st.fg, border: '1px solid ' + st.bd }}>{st.label}</span>
                  {sh.status !== 'done' && gs.count > 0 && (
                    <span onClick={e => { e.stopPropagation(); api.patchShot(this.props.pid, sh.id, { status: 'done' }, 'approved from list').then(() => app.sync()).catch(() => { }); }}
                      title="Approve — mark done" className="hAccent" style={sx('font-size:11px;color:var(--ok);cursor:pointer')}>✓</span>
                  )}
                  <span onClick={e => { e.stopPropagation(); this.toggleFav(sh); }} className={sh.fav ? 'hAccent' : 'rv hAccent'}
                    title="Favourite — ." style={{ ...sx('margin-left:auto;font-size:11px;cursor:pointer'), color: sh.fav ? 'var(--accent)' : 'var(--border-2)' }}>{sh.fav ? '★' : '☆'}</span>
                </span>
              ) : (
                <span style={sx('display:inline-flex;align-items:center;gap:5px;min-width:0')}>
                  <span onClick={e => { e.stopPropagation(); this.batchGenerate([sh.id]); }} className="hBdAccent"
                    title="Generate this shot — its cast, location and look ride along as references"
                    style={{ ...sx('font-size:10px;font-weight:700;color:var(--accent);border-radius:7px;padding:3px 10px;cursor:pointer;text-align:center;white-space:nowrap'), border: '1px solid var(--accent-35)' }}>Generate</span>
                  <span onClick={e => { e.stopPropagation(); this.toggleFav(sh); }} className={sh.fav ? 'hAccent' : 'rv hAccent'}
                    title="Favourite — ." style={{ ...sx('margin-left:auto;font-size:11px;cursor:pointer'), color: sh.fav ? 'var(--accent)' : 'var(--border-2)' }}>{sh.fav ? '★' : '☆'}</span>
                </span>
              )}
            </div>
          );
          const panel = S.expanded === sh.id ? this.renderTakesPanel(sh) : null;
          // last row of its scene → a quiet "＋ Shot" row closes the group, opening the
          // quick-add dialog targeted at this scene
          const sceneEnd = i === list.length - 1 || this.sceneOf(list[i + 1]) !== scene;
          const addRow = sceneEnd ? (
            <div key={'add' + scene + '-' + i} onClick={() => this.openQuickAdd(scene)} className="hBg"
              title={'Add shots to scene ' + scene + ' — N'}
              style={{ ...sx('padding:6px 16px 7px 44px;border-bottom:1px solid var(--line);cursor:pointer'), fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>
              ＋ Shot <span style={sx('color:var(--border-3)')}>· scene {scene} · N</span>
            </div>
          ) : null;
          return (header || panel || addRow)
            ? <React.Fragment key={'f' + sh.id}>{header}{row}{panel}{addRow}</React.Fragment>
            : row;
        })}
        {/* the list's own footer: start the NEXT scene. The toolbar ＋ Shot appends to the last
            scene; this is the only way to grow the scene count without a re-break. */}
        <div onClick={() => this.openQuickAdd('new')} className="hBg"
          title="Start a new scene with its first shot — ⇧N"
          style={{ ...sx('padding:8px 16px;cursor:pointer'), fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-muted)' }}>
          ＋ New scene <span style={sx('color:var(--border-3)')}>· ⇧N</span>
        </div>
      </div>
    );
  }

  // ── quick-add option registry ──────────────────────────────────────────────
  // THE sustainable seam: every pill on the quick-add settings line is one declarative entry
  // here — label, is-it-set, and either an options panel or a direct action. The row renders
  // from the USER'S saved order (settings.quickAddPills, managed from the ⚙ panel: show/hide,
  // move left/right) — the same registry+saved-selection pattern as the list's COL_DEFS/listCols,
  // except here the SAVED order wins, because reordering is the point. Adding a new quick option
  // = one entry in this table. Never a new hardcoded pill in the JSX.
  static QUICK_OPTS = {
    scene: {
      name: 'Scene',
      label: c => 'scene ' + c.QA.scene,
      isSet: c => c.QA.scene > c.maxScene,
      panel: c => [
        ...Array.from({ length: c.maxScene }, (_, i) => c.opt('sc' + (i + 1), 'scene ' + (i + 1), null, c.QA.scene === i + 1, () => c.set({ scene: i + 1, panel: null }))),
        c.opt('scnew', '＋ new scene', '⇧N', c.QA.scene > c.maxScene, () => c.set({ scene: c.maxScene + 1, panel: null }), 'Start the next scene'),
      ],
    },
    type: {
      name: 'Shot type',
      label: c => c.QA.type,
      isSet: () => false,
      panel: c => SHOT_TYPES.map((t, i) => c.opt(t, t, '⌘' + (i + 1), c.QA.type === t, () => c.set({ type: t, panel: null }))),
    },
    dur: {
      name: 'Duration',
      label: c => c.QA.dur + 's',
      isSet: () => false,
      panel: c => [
        ...[2, 3, 4, 5, 6, 8].map(d => c.opt('d' + d, d + 's', '⌃' + d, c.QA.dur === d, () => c.set({ dur: d, panel: null }))),
        c.opt('d10', '10s', null, c.QA.dur === 10, () => c.set({ dur: 10, panel: null })),
      ],
    },
    move: {
      name: 'Camera move',
      label: c => (c.curMove ? '▶ ' + c.curMove.name : '▶ move'),
      isSet: c => !!c.curMove,
      panel: c => [
        ...CAMERA_MOVEMENTS.filter(mv => QUICK_MOVE_IDS.includes(mv.id) || mv.id === c.QA.move)
          .map(mv => c.opt(mv.id, mv.name, '▶', c.QA.move === mv.id, () => c.set({ move: c.QA.move === mv.id ? '' : mv.id, panel: null }), mv.description)),
        c.link('lib', 'all ' + CAMERA_MOVEMENTS.length + ' → camera library', () => { c.story.setState({ quickAdd: null }); c.app.go('tools', { toolsSel: 'moves' }); }),
      ],
    },
    look: {
      name: 'Look',
      label: c => (c.curLook ? '✦ ' + c.short(c.curLook.name) : '✦ look'),
      isSet: c => !!c.curLook,
      panel: c => [
        ...c.looks.slice(0, 6).map(l => c.opt(l.id, '✦ ' + c.short(l.name), null, c.QA.look === l.id, () => c.set({ look: c.QA.look === l.id ? '' : l.id, panel: null }), l.fragment)),
        c.link('new', 'new style → prompt builder', () => { c.story.setState({ quickAdd: null }); c.app.openPromptBuilder(null); }),
      ],
    },
    tag: {
      name: 'Tag assets',
      label: () => '@ tag',
      isSet: () => false,
      action: c => c.set({ tagPick: true }),
    },
  };
  // the user's row: saved order+selection, defaulting to the registry's declaration order
  quickPillOrder() {
    const ids = Object.keys(StoryTab.QUICK_OPTS);
    const saved = (this.props.app.state.settings || {}).quickAddPills;
    if (!Array.isArray(saved)) return ids;
    const valid = saved.filter(id => ids.includes(id));
    return valid.length ? valid : ids;
  }
  saveQuickPills(next) { this.props.app.saveSettings({ quickAddPills: next }); }

  // ── the shot-dump dialog ───────────────────────────────────────────────────
  // One glass panel, one field, one settings line rendered FROM THE REGISTRY above. Every pill
  // unfolds into its options row with the keyboard chord printed on each option, so the mouse
  // path is the shortcut tutorial. ⚙ manages the row itself: hide, show, move left/right —
  // persisted app-wide in settings.quickAddPills. ⏎ add & next · ⌘⏎ done · esc.
  renderQuickAdd() {
    const { app, pid } = this.props;
    const QA = this.state.quickAdd;
    const set = patch => this.setState(s => (s.quickAdd ? { quickAdd: { ...s.quickAdd, ...patch } } : null));
    const looks = this.allLooks();
    const ctx = {
      QA, set, app, story: this,
      maxScene: Math.max(1, ...this.shots().map(s => this.sceneOf(s))),
      looks,
      curLook: looks.find(l => l.id === QA.look) || null,
      curMove: CAMERA_MOVEMENTS.find(mv => mv.id === QA.move) || null,
      short: n => { const s = String(n || '').trim(); return s.length > 20 ? s.slice(0, 19).trimEnd() + '…' : s; },
      opt: (key, label, hint, on, onClick, title) => (
        <span key={key} onClick={onClick} title={title || ''} className={on ? '' : 'hBd'}
          style={{
            ...sx('display:inline-flex;align-items:baseline;gap:5px;border-radius:6px;padding:4px 10px;cursor:pointer;white-space:nowrap'),
            fontFamily: MONO, fontSize: 10,
            color: on ? 'var(--fg)' : 'var(--fg-muted)', background: on ? 'var(--raise)' : 'transparent',
            border: '1px solid ' + (on ? 'var(--border-3)' : 'var(--border-2)'), fontWeight: on ? 700 : 400,
          }}>
          {hint ? <span style={{ fontSize: 8.5, color: on ? 'var(--accent)' : 'var(--fg-faint)' }}>{hint}</span> : null}
          {label}
        </span>
      ),
      link: (key, label, onClick) => (
        <span key={key} onClick={onClick} className="hAccent"
          style={{ ...sx('cursor:pointer'), fontFamily: MONO, fontSize: 9, color: 'var(--accent)' }}>{label}</span>
      ),
    };
    const order = this.quickPillOrder();
    const entities = buildEntityPool(app, pid); // THE shared @-mention resolver (frontend/entities.js)
    const onKeyDown = e => {
      e.stopPropagation();
      const d = /^Digit[1-9]$/.test(e.code || '') ? Number(e.code.slice(5)) : null;
      if (d != null && e.metaKey && !e.ctrlKey) { e.preventDefault(); if (SHOT_TYPES[d - 1]) set({ type: SHOT_TYPES[d - 1] }); return; }
      if (d != null && e.ctrlKey && !e.metaKey) { e.preventDefault(); set({ dur: d }); return; }
      if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); this.quickCreate({ close: e.metaKey || e.ctrlKey }); return; }
      if (e.key === 'Escape') { e.preventDefault(); this.setState({ quickAdd: null }); }
    };
    const openDef = QA.panel && StoryTab.QUICK_OPTS[QA.panel];
    const over = QA.draft.length > QUICK_DESC_MAX - 80;
    return (
      <div onClick={() => this.setState({ quickAdd: null })}
        style={{ ...sx('position:fixed;inset:0;z-index:80;display:flex;align-items:flex-start;justify-content:center;padding-top:12vh'), background: 'rgba(5,6,8,.45)', backdropFilter: 'blur(5px)', WebkitBackdropFilter: 'blur(5px)' }}>
        <div onClick={e => e.stopPropagation()} className="glassPop"
          style={{ ...sx('display:flex;flex-direction:column'), width: 620, borderRadius: 16, animation: 'dl-in .14s ease-out' }}>

          <div style={sx('padding:16px 18px 12px')}>
            <MentionText
              ref={el => { this._qaField = el; }}
              value={QA.draft}
              onChange={e => set({ draft: e.target.value })}
              onKeyDown={onKeyDown}
              entities={entities}
              snippets={(app.state.snippets || [])}
              onBrowse={() => set({ tagPick: true })}
              placeholder="Dump the shot — @ tags cast & locations · / snippets…"
              style={{ fontSize: 13, lineHeight: 1.7, minHeight: '2.2em', maxHeight: '4.5em' }}
              wrapStyle={sx('width:100%')}
            />
            {over && (
              <div style={{ ...sx('margin-top:4px;text-align:right'), fontFamily: MONO, fontSize: 8.5, color: QA.draft.length >= QUICK_DESC_MAX ? 'var(--danger)' : 'var(--fg-faint)' }}>
                {Math.min(QA.draft.length, QUICK_DESC_MAX)}/{QUICK_DESC_MAX} — keep the action short; detail belongs in the shot's prompt
              </div>
            )}
          </div>

          {/* the settings line — rendered from the registry in the USER'S order */}
          <div style={sx('display:flex;align-items:center;gap:7px;padding:0 18px 13px;flex-wrap:wrap')}>
            {order.map(id => {
              const def = StoryTab.QUICK_OPTS[id];
              if (!def) return null;
              const on = def.isSet(ctx);
              const open = QA.panel === id;
              return (
                <span key={id}
                  onClick={() => (def.action ? def.action(ctx) : set({ panel: open ? null : id }))}
                  title={def.action ? def.name : def.name + ' — click for options, each shows its shortcut'}
                  className="hBd"
                  style={{
                    ...sx('display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:3px 11px;cursor:pointer;white-space:nowrap'),
                    fontFamily: MONO, fontSize: 10,
                    border: '1px solid ' + (on || open ? 'var(--accent-35)' : 'var(--border-2)'),
                    color: on || open ? 'var(--accent)' : 'var(--fg-soft)',
                    background: on ? 'var(--accent-05)' : 'transparent',
                  }}>
                  {def.label(ctx)}
                  {def.panel ? <span style={{ fontSize: 8, color: 'var(--border-3)' }}>{open ? '▴' : '▾'}</span> : null}
                </span>
              );
            })}
            <span onClick={() => set({ panel: QA.panel === '__manage' ? null : '__manage' })}
              title="Manage this row — show, hide, reorder" className="hFg"
              style={{ ...sx('display:inline-flex;align-items:center;border-radius:999px;padding:3px 8px;cursor:pointer'), fontFamily: MONO, fontSize: 10, color: QA.panel === '__manage' ? 'var(--accent)' : 'var(--fg-faint)' }}>⚙</span>
            <span style={{ ...sx('margin-left:auto;letter-spacing:.04em'), fontFamily: MONO, fontSize: 8.5, color: 'var(--fg-faint)' }}>⏎ add · ⌘⏎ done</span>
          </div>

          {openDef && openDef.panel && (
            <div style={sx('display:flex;gap:5px;flex-wrap:wrap;align-items:center;padding:0 18px 13px')}>{openDef.panel(ctx)}</div>
          )}

          {/* ⚙ manage — same idea as the list's Columns menu: the saved array decides which pills
              show AND their order; ◂ ▸ move, ✓ toggles. Persisted app-wide (settings.quickAddPills). */}
          {QA.panel === '__manage' && (
            <div style={sx('padding:0 18px 13px')}>
              {Object.entries(StoryTab.QUICK_OPTS).map(([id, def]) => {
                const cur = this.quickPillOrder();
                const ix = cur.indexOf(id);
                const on = ix >= 0;
                return (
                  <div key={id} style={sx('display:flex;align-items:center;gap:9px;padding:3px 0')}>
                    <span onClick={() => this.saveQuickPills(on ? cur.filter(x => x !== id) : [...cur, id])}
                      style={{ ...sx('width:13px;height:13px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:9px;cursor:pointer'), border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border-3)'), background: on ? 'var(--accent)' : 'transparent', color: 'var(--on-accent)' }}>{on ? '✓' : ''}</span>
                    <span style={{ ...sx('flex:1'), fontFamily: MONO, fontSize: 10.5, color: on ? 'var(--fg-soft)' : 'var(--fg-faint)' }}>{def.name}</span>
                    {on && ix > 0 && <span onClick={() => { const n = [...cur]; [n[ix - 1], n[ix]] = [n[ix], n[ix - 1]]; this.saveQuickPills(n); }} className="hFg" title="Move left" style={sx('cursor:pointer;font-size:10px;color:var(--fg-faint)')}>◂</span>}
                    {on && ix < cur.length - 1 && <span onClick={() => { const n = [...cur]; [n[ix + 1], n[ix]] = [n[ix], n[ix + 1]]; this.saveQuickPills(n); }} className="hFg" title="Move right" style={sx('cursor:pointer;font-size:10px;color:var(--fg-faint)')}>▸</span>}
                  </div>
                );
              })}
            </div>
          )}

          {QA.added.length > 0 && (
            <div style={sx('padding:10px 18px 12px;border-top:1px solid var(--line)')}>
              {QA.added.slice(-4).map(a => (
                <div key={a.id} style={{ ...sx('overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.9'), fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)' }}>
                  <span style={{ color: 'var(--ok)' }}>✓</span> <span style={{ color: 'var(--fg-muted)' }}>{a.id}</span> {a.desc}
                </div>
              ))}
              <div style={{ ...sx('margin-top:2px;letter-spacing:.08em'), fontFamily: MONO, fontSize: 8.5, color: 'var(--border-3)' }}>{QA.added.length} ADDED · SCENE {QA.scene}</div>
            </div>
          )}

          {/* tag picker — the SAME EntityPicker the composer's @-menu opens (frontend/Composer.jsx) */}
          {QA.tagPick && (
            <EntityPicker
              app={app} pid={pid}
              onClose={() => set({ tagPick: false })}
              onPick={ent => {
                set({ tagPick: false });
                if (this._qaField && this._qaField.insertAtCaret) this._qaField.insertAtCaret('@' + ent.key + ' ');
                else set({ draft: (QA.draft ? QA.draft + ' ' : '') + '@' + ent.key + ' ' });
                setTimeout(() => this._qaField && this._qaField.focus({ toEnd: true }), 30);
              }}
            />
          )}
        </div>
      </div>
    );
  }


  renderBoard(list) {
    const S = this.state;
    const { app } = this.props;
    return (
      <div style={sx('display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px')}>
        {list.map((sh, i) => {
          const st = SHOT_STATUS[sh.status] || SHOT_STATUS.todo;
          const cur = i === Math.min(S.sel, list.length - 1);
          // graphite neutrals + one accent-family tint only (see frontend/styles.css :root and
          // docs/DESIGN.md "The accent spend rule" — no blue/purple/teal)
          const G = ['linear-gradient(135deg,var(--surface-2),var(--border))', 'linear-gradient(135deg,var(--surface),var(--border-2))', 'linear-gradient(135deg,var(--raise),var(--border-2))', 'linear-gradient(135deg,var(--surface-2),var(--accent-12))'];
          return (
            <div key={sh.id} onClick={() => { this.setState({ sel: i }); this.openShot(sh); }} className="hCard"
              style={{ ...sx('border-radius:12px;background:var(--surface);overflow:hidden;cursor:pointer'), border: '1.5px solid ' + (cur ? 'var(--accent)' : 'var(--border)') }}>
              <div style={{ ...sx('position:relative;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center'), background: G[(sh.no || i) % G.length] }}>
                {this.shotFile(sh)
                  ? <img src={api.renderUrl(sh.proj, this.shotFile(sh))} alt="" loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontFamily: MONO, fontSize: 26, fontWeight: 700, color: 'var(--border-3)', letterSpacing: '.06em', fontVariantNumeric: 'tabular-nums' }}>{String(sh.no).padStart(2, '0')}</span>}
                <span style={{ ...sx('position:absolute;top:8px;left:9px;border-radius:4px;padding:2px 7px'), fontFamily: MONO, fontSize: 9.5, fontWeight: 600, background: 'rgba(6,7,10,.72)', color: 'var(--accent)' }}>{sh.id}</span>
                <span style={{ ...sx('position:absolute;top:8px;right:9px;font-size:9px;font-weight:700;letter-spacing:.06em;border-radius:99px;padding:2px 8px'), color: st.fg, border: '1px solid ' + st.bd, background: 'rgba(6,7,10,.6)' }}>{st.label}</span>
                <span style={{ ...sx('position:absolute;bottom:8px;right:9px;border-radius:4px;padding:1px 6px'), fontFamily: MONO, fontSize: 10, background: 'rgba(6,7,10,.72)', color: 'var(--fg-soft)' }}>{sh.type} · {sh.dur}s</span>
              </div>
              <div style={sx('padding:10px 12px 12px')}>
                <div style={sx('font-size:12.5px;font-weight:700;color:var(--fg)')}>{sh.title || sh.id}</div>
                <div style={sx('font-size:11px;color:var(--fg-muted);line-height:1.5;margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden')}>{this.renderMentions(sh.desc)}</div>
                <div style={sx('display:flex;align-items:center;gap:7px;margin-top:9px')}>
                  <span style={{ ...sx('width:7px;height:7px;border-radius:2px;flex:none'), background: skillColor(sh.skill) }} />
                  <span style={{ ...sx('overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 10, color: 'var(--fg-muted)' }}>{sh.skill || 'unassigned'}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ── production header — the project's world pinned above the list ──
  // Style (active style lock), Cast (talent), Locations, Props — sourced from the same
  // asset-kind system the @mentions use. Clicking an entity filters the list to shots
  // referencing it; clicking the style chip opens the picker.
  // Rename an entity for display only. Stored on the asset's own meta, so the name follows the
  // asset everywhere rather than living in this page's state. The KEY is never rewritten — shot
  // records point at it by key, and renaming must not orphan an assignment.
  renameEntity(c, label) {
    const { app } = this.props;
    const next = { ...(c.meta || {}), label: String(label || '').trim() };
    api.saveMeta(c.scope, c.name, c.folder || '', next)
      .then(() => app.sync())
      .catch(e => app.showToast('Could not rename — ' + (e.message || ''), 'var(--danger)'));
  }

  renderProduction() {
    const S = this.state;
    const { app, pid } = this.props;
    const lock = (app.state.activeStyleLocks || {})[pid] || null;
    const pool = this.entityPool();
    const used = k => this.shots().some(sh => this.shotMentions(sh).includes(k));
    const byKind = kind => pool.filter(e => e.kind === kind);
    // The design shows COUNTS for everything available, but CHIPS only for the entities actually
    // used in this project — "+211 more ▾" is the rest. A 214-strong cast cannot be a chip row.
    const groups = [['CAST', 'talent'], ['LOC', 'location'], ['PROPS', 'prop']]
      .map(([label, kind]) => {
        const all = byKind(kind);
        const inUse = all.filter(c => used(c.key));
        return { label, kind, all, shown: S.prodAll ? all : (inUse.length ? inUse : all.slice(0, 3)) };
      })
      .filter(g => g.all.length);
    const q = String(S.prodQuery || '').trim().toLowerCase();

    const chip = c => {
      const on = S.filEntity === c.key;
      const n = this.shots().filter(sh => this.shotMentions(sh).includes(c.key)).length;
      const round = c.kind === 'talent';
      return (
        <span key={c.scope + c.key} onClick={() => this.setState({ filEntity: on ? null : c.key, sel: 0 })}
          title={c.label + (c.label !== c.key ? ' (' + c.key + ')' : '') + ' — ' + n + ' shot' + (n === 1 ? '' : 's') + ' · click filters · drag onto a shot to assign'}
          draggable
          onDragStart={e => { this.setState({ dragEnt: c }); e.dataTransfer.effectAllowed = 'copy'; try { e.dataTransfer.setData('text/plain', '@' + c.key); } catch { /* */ } }}
          onDragEnd={() => this.setState({ dragEnt: null, dragOver: null })}
          className="hBd" style={{ ...sx('display:inline-flex;align-items:center;gap:5px;padding:2px 9px 2px 2px;border-radius:999px;cursor:pointer'), border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border)'), background: on ? 'var(--accent-05)' : 'transparent' }}>
          <img src={assetUrl(c.scope, c.name, c.folder)} alt="" loading="lazy"
            style={{ ...sx('width:18px;height:18px;object-fit:cover;display:block;flex:none'), borderRadius: round ? 99 : 5 }} />
          <InlineEdit
            value={c.label}
            placeholder={c.key}
            title={'Rename — the id stays ' + c.key}
            onCommit={v => this.renameEntity(c, v)}
            style={{ fontFamily: MONO, fontSize: 9.5, color: on ? 'var(--accent)' : 'var(--fg-soft)' }}
            inputStyle={{ width: Math.max(70, String(c.label).length * 7) }}
          />
        </span>
      );
    };

    return (
      <div style={sx('border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:9px 14px;margin-bottom:12px')}>
        {/* head: caret · PRODUCTION · project style lock · totals · search */}
        <div style={sx('display:flex;align-items:center;gap:12px;flex-wrap:wrap')}>
          <span onClick={() => this.setState(x => ({ prodOpen: x.prodOpen === false }))} className="hFg"
            style={sx('font-size:9px;color:var(--fg-faint);cursor:pointer')}>{S.prodOpen === false ? '▸' : '▾'}</span>
          <span style={{ ...sx('font-weight:700;letter-spacing:.16em;color:var(--fg-muted)'), fontFamily: MONO, fontSize: 9 }}>PRODUCTION</span>
          <span onClick={() => app.openStyleLockPicker(pid)} className={lock ? 'hBdAccentChip' : 'hBd'}
            title={lock ? lock.fragment : 'No style lock — every shot generates unstyled. Click to pick one.'}
            style={{ ...sx('display:inline-flex;align-items:center;gap:5px;padding:3px 11px;border-radius:999px;cursor:pointer'), border: '1px solid ' + (lock ? 'var(--accent-35)' : 'var(--border)'), background: lock ? 'var(--accent-05)' : 'transparent' }}>
            <span style={{ fontSize: 9.5, color: lock ? 'var(--accent)' : 'var(--fg-faint)' }}>✦</span>
            <span style={{ fontFamily: MONO, fontSize: 10, color: lock ? 'var(--accent)' : 'var(--fg-faint)' }}>{lock ? lock.name : 'No style lock'}</span>
          </span>
          <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)', fontVariantNumeric: 'tabular-nums' }}>
            {groups.map(g => g.label + ' ' + g.all.length).join(' · ')}
          </span>
          <span style={{ ...sx('margin-left:auto;display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);border-radius:7px;padding:3px 10px'), cursor: 'text' }}>
            <span style={sx('font-size:10px;color:var(--fg-faint)')}>⌕</span>
            <input value={S.prodQuery || ''} onChange={e => this.setState({ prodQuery: e.target.value })}
              onKeyDown={e => e.stopPropagation()} placeholder="search cast &amp; locations…"
              style={{ ...sx('background:transparent;border:none;padding:0;width:150px;color:var(--fg)'), fontFamily: MONO, fontSize: 9.5 }} />
          </span>
        </div>

        {S.prodOpen !== false && (
          <div style={sx('display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:9px')}>
            {groups.map(g => {
              const list = q ? g.all.filter(c => (c.label + ' ' + c.key).toLowerCase().includes(q)) : g.shown;
              const hidden = g.all.length - list.length;
              return (
                <span key={g.label} style={sx('display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap')}>
                  <span style={{ ...sx('font-weight:700;letter-spacing:.14em;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 8.5 }}>{g.label}</span>
                  {list.map(chip)}
                  {hidden > 0 && (
                    <span onClick={() => this.setState(x => ({ prodAll: !x.prodAll }))} className="hBd"
                      title="Only entities USED IN THIS PROJECT show as chips — the rest live behind search"
                      style={{ ...sx('border-radius:999px;padding:3px 10px;cursor:pointer;border:1px dashed var(--border)'), fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>
                      +{hidden} more ▾
                    </span>
                  )}
                  {S.prodAll && !q && <span onClick={() => this.setState({ prodAll: false })} className="hFg"
                    style={{ ...sx('cursor:pointer'), fontFamily: MONO, fontSize: 9, color: 'var(--fg-faint)' }}>less</span>}
                </span>
              );
            })}
            {!groups.length && (
              <span onClick={() => app.setState({ projTab: 'assets' })} className="hFg" style={sx('font-size:10.5px;color:var(--fg-faint);cursor:pointer')}>
                No cast or locations yet — tag assets as Talent / Location / Prop and they appear here →
              </span>
            )}
            {S.filEntity && <span onClick={() => this.setState({ filEntity: null })} className="hAccent"
              style={sx('margin-left:auto;font-size:10.5px;color:var(--accent);cursor:pointer;font-weight:600')}>✕ clear filter</span>}
          </div>
        )}
      </div>
    );
  }

}
