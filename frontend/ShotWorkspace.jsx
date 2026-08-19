// Shot Workspace — one shot, reviewed like the Inbox: a single BIG stage frame, a filmstrip of
// every take underneath, and keyboard-first decisions (←/→ walk · L final · K keep · X kill ·
// F zoom · Esc close). Local-first: no downloads — every take is already a file in
// projects/<pid>/renders/, the meta strip shows that path and reveals it in Finder, and a final
// selection is mirrored to projects/<pid>/selects/ by the server the moment it happens.
// The docked bar generates more takes in place; metadata hides in a collapsible Details panel.
import React from 'react';
import { sx } from './sx';
import SnippetText from './SnippetText';
import { api } from './api';
import { SHOT_STATUS, SHOT_TYPES, skillColor, enabledCatalog, DEFAULT_PREVIEW_MODEL, DEFAULT_RESOLUTION, maxRefs, AXES, modelKind } from './models';
import Composer, { SegmentedControl } from './Composer';
import { modelName } from './GenerationControls';
import { joinFragment } from './lookBuilder';
import { CAMERA_MOVEMENTS, MOVE_SPEEDS, MOVE_STABILIZATIONS, assembleMovePrompt } from './cameraMovements';
import { assetUrl } from './Moodboard';
import { RenderMedia, RenderLightbox, MediaAction } from './RenderMedia';
import { MONO } from './tokens';

const STATUS_ORDER = ['todo', 'generating', 'review', 'done'];
// running = the marked/running blue channel (DESIGN.md) — a state, never the accent
const stC = { queued: 'var(--fg-faint)', running: 'var(--marked)', failed: 'var(--danger)' };
const STAGE_G = 'linear-gradient(130deg,var(--on-accent),var(--raise) 60%,var(--border-2))';

export default class ShotWorkspace extends React.Component {
  constructor(props) {
    super(props);
    const sh = this.shot() || {};
    // reference images seed from the shot's assigned cast + location — identity by default
    const pool = new Map((props.entities || []).map(e => [e.key, e]));
    const keys = [...(Array.isArray(sh.cast) ? sh.cast : []), ...(sh.loc ? [sh.loc] : [])];
    const refs = keys.map(k => pool.get(k)).filter(Boolean)
      .map(c => ({ kind: 'asset', scope: c.scope, name: c.name, folder: c.folder || '', key: c.key }))
      .slice(0, maxRefs((props.app.projDef(props.pid) || {}).model || DEFAULT_PREVIEW_MODEL));
    this.state = {
      cur: null,              // selected take key — null = auto (hero, else newest done)
      zoom: false,            // fullscreen viewer for the current take
      details: false, draft: null,
      prompt: sh.prompt || sh.desc || '',
      promptBig: false,       // prompt stays one compact line until focused
      refs, refPick: false,   // attached reference images + the picker popover
      strip: 'image',         // filmstrip channel — IMAGE ⇄ VIDEO switches in place
      lookPick: false,        // header look pill popover
      mode: 'manual', // AGENT routes the request; MANUAL drives the model directly
      move: null, moveSpeed: 'normal', moveStab: 'smooth', // camera movement fragment
      // PROMPT · FULL in-place edits. null = derived (lock fragment / assembled move); a string
      // is the user's own text for that section and ships verbatim. Cleared whenever the
      // underlying selection changes, so a stale edit can't shadow a new lock or move.
      styleOverride: null, moveOverride: null,
      angle: null,   // DEV-129 — camera angle = the `framing` axis token name (models.js AXES)
      model: '', aspect: '16:9', resolution: DEFAULT_RESOLUTION, seed: '', variantCount: 1, params: {}, busy: false
    };
    this._pop = React.createRef();   // the ref picker, for click-outside dismiss
    this._closedAt = 0;
  }
  componentDidMount() {
    this._key = e => this.onKey(e);
    window.addEventListener('keydown', this._key, true); // capture — beats the app keymap
    // click-outside dismiss for the ref picker. It is absolutely positioned inside the
    // composer's wrapper, so nothing else in the app can eat its clicks — without this it
    // stayed open forever (clicking the chat, the stage or the window did nothing).
    this._down = e => {
      if (!this.state.refPick) return;
      if (this._pop.current && this._pop.current.contains(e.target)) return;
      this._closedAt = Date.now();   // so the "+ Ref" click right after this does not re-open it
      this.setState({ refPick: false });
    };
    document.addEventListener('pointerdown', this._down, true);
  }
  componentWillUnmount() {
    window.removeEventListener('keydown', this._key, true);
    document.removeEventListener('pointerdown', this._down, true);
  }

  shot() {
    const { app, pid, shotId } = this.props;
    return (app.state.shots || []).find(s => s.proj === pid && s.id === shotId) || null;
  }
  pdef() { return this.props.app.projDef(this.props.pid); }
  // the shot's OWN look wins; the project's session lock is the fallback. Prompts stay
  // action-only — the look fragment is composed in at generate time, never re-typed.
  lock() {
    const { app, pid, looks } = this.props;
    const sh = this.shot() || {};
    if (sh.look) { const l = (looks || []).find(x => x.id === sh.look); if (l) return l; }
    return (app.state.activeStyleLocks || {})[pid] || null;
  }
  async setLook(id) {
    const { app, pid } = this.props;
    this.setState({ lookPick: false, styleOverride: null });
    await api.patchShot(pid, this.shot().id, { look: id }, id ? 'look → ' + id : 'look → project default').catch(() => { });
    app.sync();
  }
  model() {
    return this.state.model || this.pdef().model ||
      ((this.props.app.state.settings || {}).modelDefaults || {}).preview || DEFAULT_PREVIEW_MODEL;
  }
  isVid(f) { return /\.(mp4|mov|webm)$/i.test(f || ''); }

  // every take of this shot, oldest → newest: shot-linked candidates (in-flight included) +
  // legacy saved item versions, deduped by render file
  takes() {
    const { app } = this.props;
    const sh = this.shot(); if (!sh) return [];
    const out = []; const seen = new Set();
    for (const g of (this.pdef().gens || [])) {
      if (g.shot !== sh.id || g.reviewState === 'killed') continue;
      if (g.file) seen.add(g.file);
      out.push({ key: 'g' + g.id, gen: g, file: g.file || null, status: g.status, ts: g.started || 0, kept: g.reviewState === 'kept', hero: sh.selectedCandidate === g.id, cost: g.cost, model: g.model, rating: g.rating || 0 });
    }
    for (const aid of (sh.assets || [])) {
      const it = (app.state.items || []).find(x => x.id === aid); if (!it) continue;
      for (const v of (it.versions || [])) {
        if (!v.file || seen.has(v.file)) continue;
        seen.add(v.file);
        out.push({ key: aid + v.v, item: it, file: v.file, status: 'done', ts: v.ts || 0, kept: true, hero: false, cost: v.cost });
      }
    }
    return out.sort((a, b) => a.ts - b.ts);
  }
  current() {
    const ts = this.takes();
    if (!ts.length) return null;
    return ts.find(t => t.key === this.state.cur) || ts.find(t => t.hero) || ts.filter(t => t.file).pop() || ts[ts.length - 1];
  }
  move(delta) {
    const ts = this.takes();
    if (!ts.length) return;
    const cur = this.current();
    const ix = Math.max(0, ts.findIndex(t => t.key === (cur && cur.key)));
    const next = ts[Math.max(0, Math.min(ts.length - 1, ix + delta))];
    if (next) this.setState({ cur: next.key, zoom: false });
  }

  onKey(e) {
    // an open popover owns Escape before anything else — including the composer's
    // contenteditable, which otherwise swallows the key and leaves the picker stuck open
    if (e.key === 'Escape' && (this.state.refPick || this.state.lookPick)) {
      e.preventDefault(); e.stopPropagation();
      this.setState({ refPick: false, lookPick: false });
      return;
    }
    if (e.target.isContentEditable) return; // the composer's contenteditable prompt — same bail as INPUT/TEXTAREA
    const tag = (e.target.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.target.blur(); }
      return;
    }
    const k = e.key.toLowerCase();
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === 'escape') { stop(); this.state.zoom ? this.setState({ zoom: false }) : this.props.onClose(); return; }
    if (k === 'arrowleft') { stop(); this.move(-1); return; }
    if (k === 'arrowright') { stop(); this.move(1); return; }
    if (k === 's') { stop(); this.cycleStatus(); return; }
    const t = this.current();
    // Consumed above the `!t` bail for the same reason as ProjectGenerate: a shot with no takes yet
    // would otherwise let `f` reach the global feedback shortcut, which renders its panel at
    // zIndex 9000 — on top of this full-screen overlay.
    if (k === 'f') { stop(); if (t && t.file) this.setState({ zoom: !this.state.zoom }); return; }
    if (!t) return;
    if (k === 'l') { stop(); this.selectFinal(t); return; }
    if (k === 'k') { stop(); this.keep(t); return; }
    if (k === 'x') { stop(); this.reject(t); return; }
    if (k === 'r') { stop(); this.reroll(t); return; }
  }
  // re-roll the current take — same prompt/model/refs snapshot, fresh seed, lineage recorded
  async reroll(t) {
    const { app, pid } = this.props;
    if (!t || !t.gen || t.status !== 'done') return;
    try { await api.rerollCandidate(pid, t.gen.id, { freshSeed: true }); app.showToast('Re-roll queued — fresh seed', 'var(--accent)'); app.sync(); }
    catch (e) { app.showToast('Re-roll failed — ' + (e.message || ''), 'var(--danger)'); }
  }

  // what PROMPT · FULL shows — the same composition generate() performs, so the preview cannot
  // drift from what ships. Keep these two in step.
  // the two composed-in sections, each honouring its FULL-view override
  styleFrag() {
    if (this.state.styleOverride != null) return this.state.styleOverride.trim();
    const lock = this.lock();
    return (lock && String(lock.fragment || '').trim()) || '';
  }
  moveFrag() {
    const S = this.state;
    if (S.moveOverride != null) return S.moveOverride.trim();
    const sh = this.shot() || {};
    const move = CAMERA_MOVEMENTS.find(m => m.id === S.move);
    return move ? assembleMovePrompt(move, { speed: S.moveSpeed, stabilization: S.moveStab, duration: sh.dur }).trim() : '';
  }
  // DEV-129 — the camera angle, from the canonical `framing` axis in models.js AXES. This surface
  // stores camera state flat (S.move/S.moveSpeed/S.moveStab) rather than as a picks object, so the
  // angle is one more flat field here; the token NAME is stored and the prompt fragment is looked
  // up, so the wording stays owned by the axis catalog and is never copied into shot state.
  angleFrag() {
    const t = (AXES.find(a => a.key === 'framing') || { tokens: [] }).tokens.find(x => x.t === this.state.angle);
    return t ? String(t.f || '').trim() : '';
  }
  composedPreview() {
    let out = String(this.state.prompt || '').trim();
    const fragment = this.styleFrag();
    const angleFrag = this.angleFrag();
    const moveFrag = this.moveFrag();
    if (fragment) out = joinFragment(out, fragment);
    // angle before movement: framing is where the camera IS, movement is what it then does
    if (angleFrag) out = joinFragment(out, angleFrag);
    if (moveFrag) out = joinFragment(out, moveFrag);
    return out;
  }

  async generate() {
    const { app, pid } = this.props;
    const sh = this.shot();
    const S = this.state;
    const prompt = S.prompt.trim();
    if (S.busy || !prompt || !sh) return;
    this.setState({ busy: true });
    try {
      // Compose the style lock into the prompt CLIENT-SIDE on both paths and send
      // styleLockFragment empty, exactly as ProjectGenerate does. Previously the batch path sent
      // the fragment while the single path did `prompt + ', ' + fragment` — and the server joins
      // batches with ' '. A 1× and a 2× from identical settings produced prompts differing by one
      // character. joinFragment is comma/period aware; plain concat is the double-comma bug.
      const fragment = this.styleFrag();
      // camera movement is a prompt fragment too — same joinFragment seam as the style lock, so a
      // move never lands as a naked sentence glued on with a comma. Both come through the same
      // helpers PROMPT · FULL previews, overrides included, so what ships is what was shown.
      const moveFrag = this.moveFrag();
      const angleFrag = this.angleFrag();   // DEV-129 — same order as composedPreview()
      let composed = prompt;
      if (fragment) composed = joinFragment(composed, fragment);
      if (angleFrag) composed = joinFragment(composed, angleFrag);
      if (moveFrag) composed = joinFragment(composed, moveFrag);
      const refs = S.refs.map(({ key, ...r }) => r);
      // drop undefined/null/''/'-' exactly like ProjectGenerate.paramsField()
      const clean = {};
      for (const [k, val] of Object.entries(S.params || {})) {
        if (val === undefined || val === null || val === '' || val === '-') continue;
        clean[k] = val;
      }
      const paramsField = Object.keys(clean).length ? { params: clean } : {};

      if (S.variantCount > 1) {
        await api.createBatch({
          pid, shotIds: [sh.id], prompt: composed, model: this.model(),
          aspect: S.aspect, resolution: S.resolution,
          styleLockFragment: '',
          variantCount: S.variantCount, baseSeed: S.seed === '' ? null : Number(S.seed),
          maxSpend: null, refs, ...paramsField
        });
        app.showToast('Batch queued — ' + S.variantCount + ' takes for ' + sh.id, 'var(--accent)');
      } else {
        await api.generate({
          pid, shot: sh.id, prompt: composed, model: this.model(),
          aspect: S.aspect, resolution: S.resolution,
          seed: S.seed === '' ? null : Number(S.seed), refs, ...paramsField
        });
        app.showToast('Take queued for ' + sh.id, 'var(--accent)');
      }
      // Persist the prompt only. The shot's `generating` status is the SERVER's to write —
      // backend/generate.mjs:129 does it inside startGeneration. Writing it here too raced that
      // and could clobber a status the server had already moved on from.
      await api.patchShot(pid, sh.id, { prompt: S.prompt }, 'generated from shot workspace').catch(() => { });
      app.sync();
    } catch (e) { app.showToast('Generate failed — ' + (e.message || ''), 'var(--danger)'); }
    this.setState({ busy: false });
  }
  // final select — the server rebuilds edit-manifest.md and re-exports selects/ before answering
  async selectFinal(t) {
    const { app, pid } = this.props;
    if (!t.gen || !t.file) return;
    try {
      await api.saveGenToShot(pid, t.gen.id, this.shot().id, true);
      app.showToast('Final — selects/ updated on disk', 'var(--ok)');
      app.sync();
    } catch (e) { app.showToast('Select failed — ' + (e.message || ''), 'var(--danger)'); }
  }
  async keep(t) {
    const { app, pid } = this.props;
    if (!t.gen || !t.file || t.kept) return;
    try { await api.saveGenToShot(pid, t.gen.id, this.shot().id); app.showToast('Kept', 'var(--ok)'); app.sync(); }
    catch (e) { app.showToast('Keep failed — ' + (e.message || ''), 'var(--danger)'); }
  }
  // reject = the same staged cleanup the Inbox uses (killed → Trash) — never a hard delete
  async reject(t) {
    const { app, pid } = this.props;
    if (!t.gen) return;
    try {
      await api.reviewCandidate(pid, t.gen.id, { patch: { reviewState: 'killed' } });
      app.showToast('Killed — staged for cleanup in Trash', 'var(--danger)');
      this.setState({ cur: null });
      app.sync();
    } catch (e) { app.showToast('Reject failed — ' + (e.message || ''), 'var(--danger)'); }
  }
  reveal(t) {
    const { app, pid } = this.props;
    if (!t || !t.file) return;
    api.revealRender(pid, t.file)
      .then(() => app.showToast('Revealed in Finder — renders/' + t.file, 'var(--accent)'))
      .catch(e => app.showToast('Reveal failed — ' + (e.message || ''), 'var(--danger)'));
  }
  async setStatus(st) {
    const { app, pid } = this.props;
    await api.patchShot(pid, this.shot().id, { status: st }, 'status → ' + st).catch(() => { });
    app.sync();
  }

  // S walks todo → generating → review → done → todo (the header pill is the same affordance)
  cycleStatus() {
    const sh = this.shot(); if (!sh) return;
    const ix = STATUS_ORDER.indexOf(sh.status);
    this.setStatus(STATUS_ORDER[(ix + 1 + STATUS_ORDER.length) % STATUS_ORDER.length] || STATUS_ORDER[0]);
  }

  openDetails() { this.setState({ details: true, draft: { ...this.shot() } }); }
  async saveDetails() {
    const { app, pid } = this.props;
    const d = this.state.draft, orig = this.shot();
    const { proj, log, created, updated, ...full } = d;
    const patch = {};
    for (const k of Object.keys(full)) if (JSON.stringify(full[k]) !== JSON.stringify(orig[k])) patch[k] = full[k];
    this.setState({ details: false, draft: null });
    if (!Object.keys(patch).length) return;
    try { await api.patchShot(pid, d.id, patch, 'edited in shot workspace'); app.showToast(d.id + ' saved', 'var(--ok)'); app.sync(); }
    catch (e) { app.showToast('Save failed — ' + (e.message || ''), 'var(--danger)'); }
  }

  render() {
    const { app, onClose, pid } = this.props;
    const sh = this.shot();
    if (!sh) return null;
    const S = this.state;
    const st = SHOT_STATUS[sh.status] || SHOT_STATUS.todo;
    const takes = this.takes();
    const cur = this.current();
    const kept = takes.filter(t => t.kept || t.hero).length;
    const lock = this.lock();
    const curIx = cur ? takes.findIndex(t => t.key === cur.key) : -1;
    return (
      <div style={sx('position:fixed;inset:0;z-index:60;background:var(--void);display:flex;flex-direction:column;animation:dl-in .14s ease-out')}>

        {/* ── header — one identity line: id · title · status · format · look, then the exits ── */}
        <div style={sx('flex:none;display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid var(--line);background:var(--ink)')}>
          <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>{sh.id}</span>
          <span style={sx('font-size:13px;font-weight:700;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px')}>{sh.title || '—'}</span>
          {/* status pill — click or S walks the cycle */}
          <span onClick={() => this.cycleStatus()} title="S cycles status"
            style={{ ...sx('flex:none;font-size:9.5px;font-weight:700;letter-spacing:.08em;border-radius:99px;padding:2px 9px;cursor:pointer'), color: st.fg, border: '1px solid ' + st.bd }}>{st.label}</span>
          <span style={{ ...sx('flex:none;color:var(--fg-muted)'), fontFamily: MONO, fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>{sh.type} · {sh.dur}s</span>
          {/* look pill — outlined accent, opens the look picker */}
          <span style={sx('position:relative;flex:none')}>
            <span onClick={() => this.setState({ lookPick: !S.lookPick })} title="Shot look — click to change" className="hBdAccent"
              style={{ ...sx('display:inline-flex;align-items:center;gap:5px;border:1px solid var(--accent-35);border-radius:999px;padding:2px 9px;cursor:pointer'), background: 'var(--accent-05)' }}>
              <span style={sx('font-size:9px;color:var(--accent)')}>✦</span>
              <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--accent)' }}>{lock ? lock.name : 'no look'}</span>
            </span>
            {S.lookPick && this.renderLookPick()}
          </span>
          <span style={{ ...sx('margin-left:auto;flex:none;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9 }}>←/→ · K · X · L</span>
          {sh.status !== 'done' && kept > 0 && (
            <span onClick={() => this.setStatus('done')} className="hBd" title="Mark this shot done"
              style={{ ...sx('flex:none;font-size:11px;font-weight:700;color:var(--ok);border-radius:7px;padding:3px 9px;cursor:pointer'), border: '1px solid color-mix(in srgb, var(--ok) 45%, transparent)' }}>✓ Approve</span>
          )}
          <span onClick={() => S.details ? this.setState({ details: false, draft: null }) : this.openDetails()} className="hBd"
            title="Details — seed, path, log"
            style={{ ...sx('flex:none;font-size:11px;border:1px solid var(--border);border-radius:7px;padding:3px 9px;cursor:pointer'), color: S.details ? 'var(--accent)' : 'var(--fg-muted)' }}>Details ▾</span>
          <span onClick={onClose} className="hFg" title="Esc"
            style={sx('flex:none;font-size:12px;color:var(--fg-faint);cursor:pointer;padding:0 2px')}>✕</span>
        </div>

        <div style={sx('flex:1;display:flex;min-height:0')}>
          <div style={sx('flex:1;display:flex;flex-direction:column;min-width:0')}>

            {/* ── stage — one 21/9 frame over the sunk bed; review actions live ON it ── */}
            <div style={sx('flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:var(--sunk);overflow:hidden')}>
              {!cur && (
                <div style={{ ...sx('text-align:center;color:var(--fg-faint);font-size:10.5px;font-weight:700;letter-spacing:.14em'), fontFamily: MONO }}>
                  NO TAKES — WRITE A PROMPT BELOW · <span style={{ color: 'var(--accent)' }}>⌘⏎ GENERATES</span>
                </div>
              )}
              {cur && this.renderStage(cur, curIx, takes.length)}
            </div>

            {/* ── filmstrip — ONE strip; the IMAGE⇄VIDEO segment switches it in place ── */}
            {takes.length > 0 && this.renderStrip(takes, cur)}

            {/* ── THE composer — frontend/Composer.jsx ──
                The bespoke docked bar that used to live here (raw <select> model picker, a second
                <select> for aspect, a hand-rolled ×N group, its own Generate slab) is gone. Same
                bar as the chat and the generate console; see docs/COMPONENTS.md §3.1. */}
            <div style={sx('flex:none;display:flex;justify-content:center;padding:14px 26px 18px')}>
              {/* position:relative anchors the ref picker, which opens upward off the composer's
                  attach control (renderRefPick is absolutely positioned bottom:30px) */}
              <div style={{ ...sx('position:relative;width:100%'), maxWidth: 680 }}>
                {S.refPick && this.renderRefPick()}
                <Composer
                  app={app}
                  value={{ prompt: S.prompt, model: this.model(), aspect: S.aspect, resolution: S.resolution, seed: S.seed, variantCount: S.variantCount, params: S.params }}
                  onChange={v => this.setState({
                    prompt: v.prompt, model: v.model, aspect: v.aspect,
                    resolution: v.resolution, seed: v.seed,
                    variantCount: v.variantCount, params: v.params,
                  })}
                  mentions={S.refs.map((r, i) => {
                    // human name, never the raw gen-… filename: the entity's display label wins,
                    // the key/filename survives only in the tooltip via the chip's own title
                    const ent = (this.props.entities || []).find(e => e.key === (r.key || '').toLowerCase() || e.name === r.name);
                    return {
                      id: r.scope + r.name + i,
                      label: (ent && ent.label) || r.key || r.name.replace(/\.\w+$/, ''),
                      thumb: assetUrl(r.scope, r.name, r.folder),
                      onRemove: () => this.setState({ refs: S.refs.filter((_, j) => j !== i) }),
                    };
                  })}
                  mode={S.mode}
                  onMode={m => this.setState({ mode: m })}
                  fragments={{ label: [
                    lock ? 'style' : null,
                    S.move ? 'cam' : null,
                    S.refs.length ? S.refs.length + ' refs' : null,
                  ].filter(Boolean).join(' · ') || 'no look' }}
                  fragmentProps={{
                    pid,
                    looks: this.props.looks || [],
                    activeLookId: (this.shot() || {}).look || '',
                    projectLock: (app.state.activeStyleLocks || {})[pid] || null,
                    onLook: id => this.setLook(id),
                    move: S.move, speed: S.moveSpeed, stab: S.moveStab,
                    onMove: id => this.setState({ move: id, moveOverride: null }),
                    onSpeed: id => this.setState({ moveSpeed: id, moveOverride: null }),
                    onStab: id => this.setState({ moveStab: id, moveOverride: null }),
                    angle: S.angle,
                    onAngle: t => this.setState({ angle: t }),
                    video: /\.mp4$|video/i.test(String(this.model() || '')) || modelKind(this.model()) === 'video',
                  }}
                  entities={(this.props.entities || []).filter(e => e.kind).map(e => ({ ...e, thumb: assetUrl(e.scope, e.name, e.folder) }))}
                  pid={pid}
                  provenance={[
                    this.styleFrag() || this.state.styleOverride != null ? {
                      text: this.styleFrag(),
                      tag: 'style · ' + ((lock && lock.name) || 'edited'),
                      onEdit: t => this.setState({ styleOverride: t }),
                    } : null,
                    this.moveFrag() ? {
                      text: this.moveFrag(),
                      tag: 'cam',
                      onEdit: t => this.setState({ moveOverride: t }),
                    } : null,
                  ].filter(Boolean)}
                  // the pointerdown dismiss above already closed it — swallow the click that
                  // follows, or the toggle would re-open what the user just clicked away from
                  onAttach={() => { if (Date.now() - this._closedAt > 250) this.setState(s => ({ refPick: !s.refPick })); }}
                  attachHint="Attach reference images — cast, locations, any project asset"
                  busy={S.busy}
                  onSubmit={() => this.generate()}
                  composedPrompt={this.composedPreview()}
                  placeholder="Describe the frame — style lock + references are added automatically."
                />
              </div>
            </div>
          </div>

          {S.details && S.draft && this.renderDetails()}
        </div>

        {/* fullscreen viewer (F) — shared lightbox; this component owns its own capture-phase
            keymap (Esc/F close zoom), so RenderLightbox runs with keyboard off */}
        {S.zoom && cur && cur.file && (
          <RenderLightbox src={api.renderUrl(pid, cur.file)} kind={this.isVid(cur.file) ? 'video' : 'image'}
            onClose={() => this.setState({ zoom: false })}
            // standardized chrome — same top strip as the gallery zoom, so "open an image"
            // is ONE look everywhere
            title={(this.shot() || {}).id}
            meta={['renders/' + cur.file, cur.cost != null ? '$' + Number(cur.cost).toFixed(3) : null]}
            caption={(cur.gen || {}).prompt || ''}
            /* takes carry sound — the pre-shared-component viewer autoplayed unmuted, and reviewing a
               performance silently reads as a broken render */
            muted={false}
            /* no cursor:zoom-out — the shared lightbox stops click propagation on the media, so only
               the backdrop dismisses; advertising zoom-out over the image would be a dead affordance */
            backdropStyle={sx('z-index:70;background:rgba(5,6,8,.94)')}
            /* DEV-132 — no per-surface size cap. RenderLightbox fits the media to the frame for
               every surface, so the shot stage and the compose viewer magnify identically. */
            />
        )}
      </div>
    );
  }

  renderStage(t, ix, total) {
    const { pid } = this.props;
    const pending = t.status === 'queued' || t.status === 'running';
    const url = t.file ? api.renderUrl(pid, t.file) : null;
    const border = t.hero ? 'var(--accent)' : t.kept ? 'color-mix(in srgb, var(--ok) 55%, transparent)' : 'var(--border)';
    const seed = t.gen && (t.gen.seed ?? t.gen.baseSeed);
    // badge line — take position, seed, cost. Mono, tabular, one dim strip over the frame.
    const badge = ['take ' + (ix + 1) + '/' + total,
      seed != null && seed !== '' ? 'seed ' + seed : null,
      t.cost != null ? '$' + Number(t.cost).toFixed(3) : null].filter(Boolean).join(' · ');
    return (
      // FILL the stage area — no fixed 21/9 letterbox. The frame's own aspect is whatever the
      // take is; forcing a scope box around a 3:2 still rendered the image at half the screen
      // with dead space on every side. The media object-contains inside whatever is available.
      <div style={sx('position:relative;width:100%;height:100%;overflow:hidden;background:var(--sunk)')}>
        <div style={{ ...sx('position:absolute;inset:0;display:flex;align-items:center;justify-content:center'), background: url ? 'var(--sunk)' : STAGE_G, borderTop: '1px solid ' + border, borderBottom: '1px solid ' + border }}>
          {url
            ? <RenderMedia key={url} src={url} kind={this.isVid(t.file) ? 'video' : 'image'} fit="contain"
                autoPlay={this.isVid(t.file)} hoverPlay={false}
                onDoubleClick={this.isVid(t.file) ? undefined : () => this.setState({ zoom: true })}
                style={{ ...sx('display:block;max-width:100%;max-height:100%'), cursor: this.isVid(t.file) ? undefined : 'zoom-in' }} />
            : (
              <div style={sx('display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px')}>
                {pending && <span style={{ ...sx('width:10px;height:10px;border-radius:99px;animation:dl-pulse 1.1s infinite'), background: stC[t.status] }} />}
                <span style={{ ...sx('font-size:10.5px;font-weight:700;letter-spacing:.12em'), fontFamily: MONO, color: stC[t.status] || 'var(--fg-faint)' }}>{(t.status || '').toUpperCase()}</span>
                {t.status === 'failed' && t.gen && t.gen.error && <span style={sx('font-size:10px;color:var(--fg-muted);max-width:420px;text-align:center;line-height:1.5')}>{String(t.gen.error).slice(0, 160)}</span>}
              </div>
            )}
        </div>

        {/* top-left — what this take IS */}
        <span style={{ ...sx('position:absolute;top:10px;left:12px;border-radius:4px;padding:2px 7px'), fontFamily: MONO, fontSize: 9, background: 'rgba(6,7,10,.72)', color: 'var(--sand)', fontVariantNumeric: 'tabular-nums' }}>{badge}</span>
        {/* top-right — the local file IS the deliverable: show its path, click reveals it */}
        {t.file && (
          <span onClick={() => this.reveal(t)} title="Reveal in Finder" className="hFg"
            style={{ ...sx('position:absolute;top:10px;right:12px;border-radius:4px;padding:2px 7px;cursor:pointer;max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 9, background: 'rgba(6,7,10,.72)', color: 'var(--fg-faint)' }}>renders/{t.file}</span>
        )}
        {t.rating > 0 && <span style={{ ...sx('position:absolute;top:32px;right:12px;font-size:12px;color:var(--accent)'), fontFamily: MONO }}>{'★'.repeat(t.rating)}</span>}

        {/* review actions — centred on the stage's bottom edge, over a scrim */}
        {t.gen && t.file && (
          <div style={{ ...sx('position:absolute;inset:0;display:flex;align-items:flex-end;justify-content:center;padding:14px;pointer-events:none'), background: 'linear-gradient(180deg,transparent 62%,rgba(6,7,10,.7))' }}>
            {/* MediaAction is the ONE review chip (RenderMedia.jsx) — same pill here, in the
                gallery zoom and every future viewer. Keep stays the one filled control. */}
            <span style={sx('display:inline-flex;gap:8px;pointer-events:auto')}>
              {!t.kept && !t.hero && <MediaAction label="Keep" hotkey="K" tone="ok" fill onClick={() => this.keep(t)} />}
              <MediaAction label="Kill" hotkey="X" tone="danger" title="Kill (X) — staged for cleanup in Trash" onClick={() => this.reject(t)} />
              {!t.hero && <MediaAction label="Final" hotkey="L" tone="accent" title="Final (L) — mirrors to selects/" onClick={() => this.selectFinal(t)} />}
              <MediaAction label="Re-roll" hotkey="R" title="Re-roll (R) — same prompt & refs, fresh seed" onClick={() => this.reroll(t)} />
            </span>
          </div>
        )}
      </div>
    );
  }

  // ── filmstrip ── one strip. The segment switches the CHANNEL in place; in-flight takes (no file
  // yet, so no kind) show in whichever channel is open so a queued render is never invisible.
  renderStrip(takes, cur) {
    const { pid } = this.props;
    const S = this.state;
    const imgN = takes.filter(t => t.file && !this.isVid(t.file)).length;
    const vidN = takes.filter(t => t.file && this.isVid(t.file)).length;
    const shown = takes.filter(t => !t.file || (this.isVid(t.file) ? S.strip === 'video' : S.strip === 'image'));
    const killed = (this.pdef().gens || []).filter(g => g.shot === (this.shot() || {}).id && g.reviewState === 'killed');
    const kept = takes.filter(t => t.kept || t.hero).length;
    const total = [...takes, ...killed].reduce((n, x) => n + (Number(x.cost) || 0), 0);
    return (
      <div style={sx('flex:none;display:flex;gap:7px;align-items:center;padding:10px 18px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);overflow-x:auto')}>
        <SegmentedControl
          size="sm"
          style={{ marginRight: 4 }}
          value={S.strip}
          onChange={id => this.setState({ strip: id })}
          options={[{ id: 'image', label: 'IMAGE ' + imgN }, { id: 'video', label: 'VIDEO ' + vidN }]}
        />
        {shown.map(t => {
          const i = takes.indexOf(t);
          const on = cur && t.key === cur.key;
          const pending = t.status === 'queued' || t.status === 'running';
          return (
            <span key={t.key} onClick={() => this.setState({ cur: t.key })}
              title={'Take ' + (i + 1) + (t.hero ? ' · FINAL' : t.kept ? ' · kept' : '') + (t.file ? ' · ' + t.file : '')}
              style={{ ...sx('flex:none;position:relative;width:92px;border-radius:6px;overflow:hidden;cursor:pointer;background:var(--sunk);display:inline-flex;align-items:center;justify-content:center'), aspectRatio: '16 / 9', border: '1.5px solid ' + (on ? 'var(--accent)' : 'var(--border)'), opacity: on ? 1 : .7 }}>
              {t.file
                ? <RenderMedia src={api.renderUrl(pid, t.file)} kind={this.isVid(t.file) ? 'video' : 'image'}
                    fit="cover" hoverPlay={false} style={sx('width:100%;height:100%;display:block')} />
                : pending
                  ? <span style={{ ...sx('width:6px;height:6px;border-radius:99px;animation:dl-pulse 1.2s infinite'), background: stC[t.status] || 'var(--marked)' }} />
                  : <span style={{ ...sx('font-size:8px;font-weight:700;letter-spacing:.08em'), fontFamily: MONO, color: stC[t.status] || 'var(--fg-faint)' }}>{(t.status || '').toUpperCase()}</span>}
              {t.hero && <span style={{ ...sx('position:absolute;top:3px;left:3px;border-radius:3px;padding:0 4px;font-weight:800'), fontSize: 8, background: 'var(--accent)', color: 'var(--on-accent)' }}>FINAL</span>}
              {!t.hero && t.kept && <span style={{ ...sx('position:absolute;top:3px;left:3px;border-radius:3px;padding:0 4px;font-weight:800'), fontSize: 8, background: 'var(--ok)', color: 'var(--on-accent)' }}>✓</span>}
              {t.status === 'failed' && <span style={{ ...sx('position:absolute;top:3px;left:3px;border-radius:3px;padding:0 4px;font-weight:800'), fontSize: 8, background: 'var(--danger)', color: 'var(--on-accent)' }}>✕</span>}
            </span>
          );
        })}
        <span style={{ ...sx('margin-left:auto;flex:none;padding-left:12px;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9, fontVariantNumeric: 'tabular-nums' }}>
          {takes.length} takes · {kept} kept · {killed.length} killed · ${total.toFixed(3)} total
        </span>
      </div>
    );
  }

  // look picker — the header pill's popover. Sets the SHOT's own look; '' falls back to the
  // project's session lock (see lock()).
  renderLookPick() {
    const looks = this.props.looks || [];
    const active = (this.shot() || {}).look || '';
    const row = (id, label, on) => (
      <div key={id || 'default'} onClick={() => this.setLook(id)} className="hBd"
        style={{ ...sx('padding:5px 9px;border-radius:7px;cursor:pointer;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'), color: on ? 'var(--fg)' : 'var(--fg-muted)', background: on ? 'var(--raise)' : 'transparent', border: '1px solid ' + (on ? 'var(--border-3)' : 'transparent') }}>{label}</div>
    );
    return (
      <div onClick={e => e.stopPropagation()} className="glassPop"
        style={sx('position:absolute;top:26px;left:0;z-index:40;width:220px;max-height:280px;overflow-y:auto;border:1px solid var(--border-3);border-radius:12px;background:var(--surface-2);box-shadow:0 24px 70px rgba(0,0,0,.7);padding:7px;display:flex;flex-direction:column;gap:2px;animation:dl-in .12s ease-out')}>
        <div style={{ ...sx('font-size:9px;font-weight:700;letter-spacing:.14em;color:var(--fg-faint);padding:2px 5px 6px'), fontFamily: MONO }}>SHOT LOOK</div>
        {row('', '— project default —', !active)}
        {looks.map(l => row(l.id, l.name, active === l.id))}
        {!looks.length && <div style={sx('padding:6px 9px;font-size:10.5px;color:var(--fg-muted)')}>No looks yet — build one in Style Lab.</div>}
      </div>
    );
  }

  // + Ref picker — entities first (cast/locations/props), then every other project image
  renderRefPick() {
    const S = this.state;
    const cap = maxRefs(this.model());
    const pool = (this.props.entities || []).filter(c => c.type === 'image' || !c.type);
    const ranked = [...pool.filter(c => c.kind), ...pool.filter(c => !c.kind)];
    const attached = c => S.refs.some(r => r.scope === c.scope && r.name === c.name && (r.folder || '') === (c.folder || ''));
    return (
      <div ref={this._pop} onClick={e => e.stopPropagation()}
        style={sx('position:absolute;bottom:30px;left:0;z-index:30;width:300px;max-height:280px;overflow-y:auto;border:1px solid var(--border-3);border-radius:12px;background:var(--surface-2);box-shadow:0 24px 70px rgba(0,0,0,.75);padding:8px;cursor:default;animation:dl-in .12s ease-out')}>
        <div style={sx('font-size:9px;font-weight:700;letter-spacing:.14em;color:var(--fg-faint);padding:2px 4px 7px')}>
          ATTACH REFERENCE — {S.refs.length}/{cap} · click toggles · esc closes
        </div>
        <div style={sx('display:grid;grid-template-columns:repeat(4,1fr);gap:6px')}>
          {ranked.map(c => {
            const on = attached(c);
            return (
              <div key={c.scope + (c.folder || '') + c.name}
                onClick={() => {
                  if (on) this.setState({ refs: S.refs.filter(r => !(r.scope === c.scope && r.name === c.name && (r.folder || '') === (c.folder || ''))) });
                  else if (S.refs.length >= cap) this.props.app.showToast(modelName(this.model()) + ' takes ' + cap + ' reference' + (cap === 1 ? '' : 's'), 'var(--danger)');
                  else this.setState({ refs: [...S.refs, { kind: 'asset', scope: c.scope, name: c.name, folder: c.folder || '', key: c.key }] });
                }}
                title={c.key || c.name} className="hBd"
                style={{ ...sx('position:relative;aspect-ratio:1;border-radius:8px;overflow:hidden;cursor:pointer'), border: '1.5px solid ' + (on ? 'var(--accent)' : 'var(--border)') }}>
                <img src={assetUrl(c.scope, c.name, c.folder)} alt="" loading="lazy" style={sx('width:100%;height:100%;object-fit:cover;display:block')} />
                {on && <span style={sx('position:absolute;top:2px;right:3px;font-size:9px;color:var(--accent);font-weight:800')}>✓</span>}
              </div>
            );
          })}
          {!ranked.length && <div style={sx('grid-column:1/-1;padding:10px;font-size:10.5px;color:var(--fg-muted)')}>No project images yet — add some in Assets.</div>}
        </div>
      </div>
    );
  }

  renderDetails() {
    const S = this.state;
    const d = S.draft;
    const skills = (this.props.app.state.skillRepos || []).filter(r => r.exists).flatMap(r => r.skills.map(s => s.name));
    const field = (label, el) => (
      <div>
        <div style={sx('font-size:10px;font-weight:700;letter-spacing:.12em;color:var(--fg-faint);margin-bottom:5px')}>{label}</div>
        {el}
      </div>
    );
    const input = (key, props = {}) => (
      <input value={d[key] ?? ''} onChange={e => this.setState({ draft: { ...d, [key]: props.number ? +e.target.value || 0 : e.target.value } })}
        onKeyDown={e => e.stopPropagation()} type={props.number ? 'number' : 'text'}
        style={sx('width:100%;box-sizing:border-box;background:var(--ink);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);font-size:12px;padding:7px 10px')} />
    );
    return (
      <div style={sx('flex:none;width:270px;border-left:1px solid var(--surface-2);background:var(--ink);display:flex;flex-direction:column;min-height:0')}>
        <div style={sx('flex:1;overflow-y:auto;padding:16px 16px 12px;display:flex;flex-direction:column;gap:13px')}>
          {field('TITLE', input('title'))}
          {field('WHAT WE SEE', (
            <textarea value={d.desc || ''} onChange={e => this.setState({ draft: { ...d, desc: e.target.value } })} onKeyDown={e => e.stopPropagation()}
              style={sx('width:100%;box-sizing:border-box;height:72px;resize:vertical;background:var(--ink);border:1px solid var(--border-2);border-radius:8px;color:var(--fg-soft);font-size:12px;line-height:1.6;padding:8px 10px')} />
          ))}
          <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
            {field('TYPE', (
              <select value={d.type} onChange={e => this.setState({ draft: { ...d, type: e.target.value } })}
                style={sx('width:100%;background:var(--ink);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);font-size:12px;padding:7px 8px')}>
                {SHOT_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            ))}
            {field('DUR (S)', input('dur', { number: true }))}
          </div>
          {field('SKILL', (
            <select value={d.skill || ''} onChange={e => this.setState({ draft: { ...d, skill: e.target.value } })}
              style={{ ...sx('width:100%;background:var(--ink);border-radius:8px;color:var(--fg);font-size:12px;padding:7px 8px'), border: '1px solid ' + skillColor(d.skill) }}>
              <option value="">— unassigned —</option>
              {skills.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          ))}
          {field('VIDEO PROMPT', (
            <textarea value={d.videoPrompt || ''} onChange={e => this.setState({ draft: { ...d, videoPrompt: e.target.value } })} onKeyDown={e => e.stopPropagation()}
              placeholder="subject motion + camera move + pacing"
              style={{ ...sx('width:100%;box-sizing:border-box;height:50px;resize:vertical;background:var(--sunk);border:1px solid var(--border-2);border-radius:8px;color:var(--fg-muted);line-height:1.6;padding:8px 10px'), fontFamily: MONO, fontSize: 10.5 }} />
          ))}
          <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
            {field('CAMERA MOVE', input('move'))}
            {field('LIGHT', input('light'))}
          </div>
          <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
            {field('STORY BEAT', input('beat'))}
            {field('TRANSITION', input('transition'))}
          </div>
          {field('STATUS', (
            <div style={sx('display:flex;gap:5px;flex-wrap:wrap')}>
              {STATUS_ORDER.map(stt => {
                const s2 = SHOT_STATUS[stt]; const on = d.status === stt;
                // selected = the neutral RAISED chip, never a solid status fill (DESIGN rule 3)
                return <span key={stt} onClick={() => this.setState({ draft: { ...d, status: stt } })}
                  style={{ ...sx('font-size:9px;font-weight:700;letter-spacing:.06em;border-radius:99px;padding:3px 10px;cursor:pointer'), color: on ? 'var(--fg)' : s2.fg, background: on ? 'var(--raise)' : 'transparent', border: '1px solid ' + (on ? 'var(--border-3)' : s2.bd) }}>{s2.label}</span>;
              })}
            </div>
          ))}
          {field('TAGS', (
            <input value={(d.tags || []).join(', ')} onChange={e => this.setState({ draft: { ...d, tags: e.target.value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) } })}
              onKeyDown={e => e.stopPropagation()} placeholder="comma, separated"
              style={sx('width:100%;box-sizing:border-box;background:var(--ink);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);font-size:11.5px;padding:7px 10px')} />
          ))}
          <div style={sx('display:flex;gap:8px;margin-top:2px')}>
            <span onClick={() => this.props.onDelete && this.props.onDelete(d.id)} className="hBdRed5" style={sx('font-size:11px;color:var(--danger);cursor:pointer;font-weight:600')}>Delete</span>
            <span onClick={() => this.props.onDuplicate && this.props.onDuplicate(d.id)} className="hFg" style={sx('font-size:11px;color:var(--fg-muted);cursor:pointer;font-weight:600')}>Duplicate</span>
          </div>
          <div style={{ ...sx('font-size:9.5px;color:var(--fg-faint)'), fontFamily: MONO }}>projects/{this.props.pid}/shots/{d.id}.md</div>
        </div>
        <div style={sx('flex:none;display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--surface-2)')}>
          <div onClick={() => this.setState({ details: false, draft: null })} className="hBd" style={sx('flex:1;text-align:center;padding:7px 0;border:1px solid var(--border-2);border-radius:8px;color:var(--fg-soft);font-weight:600;font-size:11.5px;cursor:pointer')}>Cancel</div>
          {/* outlined-primary — the docked Generate keeps the screen's single solid accent fill */}
          <div onClick={() => this.saveDetails()} className="hBdAccent" style={sx('flex:1;text-align:center;padding:7px 0;border-radius:8px;border:1px solid var(--accent-35);color:var(--accent);font-weight:700;font-size:11.5px;cursor:pointer')}>Save</div>
        </div>
      </div>
    );
  }
}
