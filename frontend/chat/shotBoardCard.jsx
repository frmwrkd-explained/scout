// Shot-board card (ticket 17) — story development as a conversation.
//
// Two shapes, both owned by the `shot-board` chat tool (shared/chatTools.mjs) and therefore gated
// behind its enablement by the registry (toolRegistry.jsx). Registered once via registerToolCard so
// disabled → enable-notice automatically. The single renderer branches on the directive type:
//
//   · proposal.breakdown  → a STAGED proposal. This is the ONE directive that carries content
//                           (directive.shots), because nothing canonical exists yet — it is a
//                           proposal awaiting confirm. Confirm writes each shot through the existing
//                           shot-create route (api.addShot → POST /api/story/:pid/shots); Dismiss
//                           drops it. Until confirmed, nothing is written.
//   · show.shot-board /    → the LIVE BREAKDOWN (Director Chat design, state 4). Fetches canonical
//     show.shots /           shot records (api.story) and mirrors them as approve/change rows grouped
//     shot-board /           by sequence: id · action beat · size + angle chips · the assigned
//     breakdown              @entity. Inline edits (size, angle, approve, change) persist through the
//                            EXISTING shot route (api.patchShot) — the Story tab reads the same
//                            canonical records, so it reflects them.
//
// Approval rides its own `approved` field rather than `status`: SHOT_STATUS means render progress and
// its 'generating' key is the SERVER's write (backend/generate.mjs). A change note is UI-local until
// send, at which point it becomes the shot's `desc` plus a log line.
//
// Never renders shots from directive prose on the live board — the directive is a pointer; the card
// fetches by id. (The proposal is the deliberate exception: it has no canonical record yet.)
import React from 'react';
import { sx } from '../sx';
import { api } from '../api';
import { registerToolCard } from './toolRegistry';
import { CardShell } from './directives';
import { SegmentedControl, TechSettings, Cost } from '../Composer';
import { SHOT_TYPES, estCost } from '../models';
import { modelName } from '../GenerationControls';
import { RenderMedia } from '../RenderMedia';
import { buildAssetPool, buildEntityPool } from '../entities';
import MentionText from '../MentionText';
import { shotGenerateBody, defaultShotModel, entityIndex, shotCast, shotLoc, lookForShot } from '../shotGenerate';
import ShotWorkspace from '../ShotWorkspace';
import { MONO } from '../tokens';


// Camera-angle vocabulary. There is no canonical angle list anywhere in the app (models.js owns
// SHOT_TYPES — the *size* axis — and cameraMovements.js owns movement, not static angle), so this
// is a first declaration, not a second copy. Cycled by clicking the angle chip; persisted as
// `shot.angle` through the existing PATCH route (writeShot spreads unknown keys into frontmatter).
const ANGLES = ['EYE', 'LOW', 'HIGH', 'OTS', 'DUTCH', 'TOP'];

const VIEWS = [{ id: 'list', label: 'LIST' }, { id: 'action', label: 'ACTION' }];

// The row's action line. `desc` is the shot's action beat; title is the fallback for older records.
const actionOf = sh => (sh.desc || sh.title || 'Untitled shot').replace(/\s+/g, ' ').trim();
const sizeOf = sh => String(sh.type || 'Medium').toUpperCase();

// The @entity the AI assigned to a row: first cast key, else the location. Null when it found none —
// the row then shows the dashed "+ cast?" prompt instead.
//
// With an entity index (the live board has one), this goes through the SHARED resolver, which also
// reads @-mentions out of the shot's own text. That matters: the agent often writes "the @deckhand
// crosses…" without ever filling a structured `cast` field, and those shots must still show — and
// generate with — their character. Without the index (the staged proposal, which has no project
// context yet) it falls back to the explicit fields alone.
function entityOf(sh, idx) {
  if (idx) {
    const cast = shotCast(sh, idx);
    if (cast.length) return '@' + cast[0];
    const loc = shotLoc(sh, idx);
    return loc ? '@' + loc : null;
  }
  const cast = Array.isArray(sh.cast) ? sh.cast.filter(Boolean) : [];
  if (cast.length) return '@' + cast[0];
  if (sh.loc) return '@' + sh.loc;
  return null;
}

// Sequence grouping. `seq` is an optional shot field ('A', 'B', …) with an optional `seqTitle`.
// Records without one collapse into a single unlabelled group, so a flat board still renders.
function groupBySeq(shots) {
  const groups = [];
  for (const sh of shots) {
    const key = sh.seq ? String(sh.seq) : '';
    let g = groups.find(x => x.key === key);
    if (!g) { g = { key, title: '', shots: [] }; groups.push(g); }
    if (!g.title && sh.seqTitle) g.title = String(sh.seqTitle);
    g.shots.push(sh);
  }
  return groups;
}

const ROW = sx('display:flex;align-items:center;gap:9px;border-radius:8px;padding:7px 10px');
const ID_CELL = { fontFamily: MONO, fontSize: 10, color: 'var(--fg-soft)', flex: 'none', width: 44, fontVariantNumeric: 'tabular-nums' };
const OUTLINE_CHIP = { ...sx('flex:none;border:1px solid var(--border);border-radius:5px;padding:2px 7px;cursor:pointer'), fontFamily: MONO, fontSize: 9, color: 'var(--fg-muted)' };
const AFFORD = sx('flex:none;font-size:9px;font-weight:700;border-radius:5px;padding:2px 7px;border:1px solid var(--border-2);color:var(--fg-soft);cursor:pointer');

// ── shared row chips ── the design's row vocabulary, as ONE set of renderers, so the STAGED proposal
// and the LIVE board draw byte-identical chips. They used to be inlined in the live board and
// re-typed (wrong) in the proposal — which is exactly how the proposal drifted into a plain list.
// An onClick makes a chip a cycle affordance (hover border); its absence makes it static. This is the
// design at Director Chat.dc.html:125-127,167 — outline size/angle chips, accent cast pill, dashed
// "+ cast?" when the shot has no assignment.
const SizeChip = ({ label, onClick, title }) => (
  <span className={onClick ? 'hBd' : ''} onClick={onClick} title={title || (onClick ? 'Click to cycle shot size' : undefined)}
    style={{ ...OUTLINE_CHIP, cursor: onClick ? 'pointer' : 'default' }}>{String(label || 'MEDIUM').toUpperCase()}</span>
);
const AngleChip = ({ label, onClick, title }) => (
  <span className={onClick ? 'hBd' : ''} onClick={onClick} title={title || (onClick ? 'Click to cycle camera angle' : undefined)}
    style={{ ...OUTLINE_CHIP, cursor: onClick ? 'pointer' : 'default' }}>{String(label || 'EYE').toUpperCase()}</span>
);
const CastPill = ({ ent }) => ent ? (
  <span style={{ ...sx('flex:none;border-radius:999px;padding:2px 7px'), fontFamily: MONO, fontSize: 9, color: 'var(--accent)', border: '1px solid var(--accent-35)', background: 'var(--accent-05)' }}>{ent}</span>
) : (
  <span title="No cast assigned — the agent found none"
    style={{ ...sx('flex:none;border-radius:999px;padding:2px 7px'), fontFamily: MONO, fontSize: 9, color: 'var(--fg-faint)', border: '1px dashed var(--border)' }}>+ cast?</span>
);
// Inline @-aware row editor — the SAME field the composer's prompt uses (MentionText), sized down
// to a row slot. Typing `@` opens the cast/location menu, so a beat can pick up its character or
// location without leaving the card — the shot page's add affordance, not a third mention UI.
const EditBox = ({ value, entities, placeholder, onChange, onEnter, onEscape, inputRef }) => (
  <div style={sx('flex:1;min-width:0;border:1px solid var(--border-2);border-radius:7px;padding:2px 10px;background:var(--sunk)')}>
    <MentionText ref={inputRef} value={value} placeholder={placeholder} entities={entities}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEnter(); } if (e.key === 'Escape') onEscape(); }}
      style={{ fontSize: 11, minHeight: '1.9em', lineHeight: 1.8 }} />
  </div>
);
// Sequence group header — "SEQ A — DEPARTURE" (Director Chat.dc.html:120).
const SeqHead = ({ children, first }) => (
  <div style={{ ...sx('padding:4px 2px 6px'), fontFamily: MONO, fontSize: 8.5, fontWeight: 700, letterSpacing: '.14em', color: 'var(--fg-faint)', paddingTop: first ? 4 : 10 }}>{children}</div>
);

// ── the live shot board ── mirrors canonical records; inline edits persist through existing routes ──
class ShotBoardCard extends React.Component {
  // `changing` maps shot id → the in-flight change note (the row's second line). It is UI-local:
  // nothing is written until send.
  // `gen` is the card's own generation settings — the TECH popover's value shape (model, aspect,
  // resolution, seed, params), shared with every other composer in the app. It starts at the
  // project's default model so "press go" works without opening anything.
  // `open` is the shot id whose full workspace overlay is up ("see everything in detail").
  // `collapsed` shrinks the whole card to a one-line receipt — a reviewed board should not keep
  // its full height in the transcript forever. `sel` is the keyboard cursor (a shot id); the key
  // flow only runs while the pointer is over the card, so two boards in one transcript never fight.
  state = { shots: null, loading: true, err: null, busy: null, view: 'list', changing: {}, gen: null, open: null, running: {}, collapsed: !!this.props.startCollapsed, sel: null, progress: null };
  pid() { const d = this.props.directive || {}; return d.project || d.pid || (this.props.ctx || {}).pid || null; }
  componentDidMount() { this.load(); document.addEventListener('keydown', this.onKey); }
  componentWillUnmount() { document.removeEventListener('keydown', this.onKey); }
  // ── keyboard review ── hover the board, then ↑↓ walk the rows; a approve · e change · g generate.
  // Guarded off while typing (any input/contenteditable), while the workspace overlay is up, and in
  // the prose ACTION view — the keys belong to review, never to text entry.
  onKey = e => {
    if (!this._hover || this.state.collapsed || this.state.open || this.state.view !== 'list') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target && e.target.closest && e.target.closest('input,textarea,select,[contenteditable="true"],[contenteditable=""]')) return;
    const flat = groupBySeq(this.state.shots || []).flatMap(g => g.shots);
    if (!flat.length) return;
    const ix = flat.findIndex(s => s.id === this.state.sel);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? Math.min(flat.length - 1, ix + 1) : Math.max(0, ix <= 0 ? 0 : ix - 1);
      this.setState({ sel: flat[next].id });
      return;
    }
    if (e.key === 'Escape') { if (this.state.sel) this.setState({ sel: null }); return; }
    const cur = ix >= 0 ? flat[ix] : null;
    if (!cur || this.state.busy) return;
    if (e.key === 'a') { e.preventDefault(); this.approve(cur); }
    else if (e.key === 'e') { e.preventDefault(); this.openChange(cur); }
    else if (e.key === 'g') { e.preventDefault(); this.generate(cur); }
  };

  app() { return this.props.ctx?.app; }
  // the TECH settings, defaulted lazily so a project switch is picked up
  settings() {
    const app = this.app(), pid = this.pid();
    const g = this.state.gen;
    if (g && g.model) return g;
    return { model: app && pid ? defaultShotModel(app, pid) : '', aspect: '16:9', resolution: null, seed: null, params: {} };
  }
  // Rebuilt per render pass, memoised only WITHIN one pass (row() calls it once per row). Caching it
  // across renders would go stale the moment a reference image is added to the project — the pool is
  // derived from app state, which is exactly the thing that changes underneath this card.
  entIdx() {
    const app = this.app(), pid = this.pid();
    if (!app || !pid) return null;
    if (!this._idx) this._idx = entityIndex(app, pid);
    return this._idx;
  }
  looks() { return (this.app()?.state?.styleLocks) || []; }

  // ── generation ──
  // One shot → one /api/generate call through the SHARED composer (frontend/shotGenerate.js), so a
  // shot rendered from the chat is byte-identical to the same shot rendered from the Story tab: same
  // model, same look fragment joined the same way, same cast/location reference images.
  //
  // N separate calls, never one batch: POST /api/batches composes ONE prompt and ONE refs array and
  // reuses them for every shotId (backend/batches.mjs), so a batch cannot carry per-shot prompts or
  // per-shot cast. Per-shot identity is the whole point here, so the batch route is the wrong tool.
  async generate(list) {
    const app = this.app(), pid = this.pid();
    const shots = (Array.isArray(list) ? list : [list]).filter(Boolean);
    if (!app || !pid || !shots.length) return;
    const s = this.settings();
    const idx = this.entIdx();
    let n = 0, skipped = 0;
    this.setState(st => ({
      progress: shots.length > 1 ? { done: 0, total: shots.length } : null,
      running: { ...st.running, ...Object.fromEntries(shots.map(sh => [sh.id, true])) }
    }));
    for (const sh of shots) {
      const body = shotGenerateBody(app, pid, sh, {
        model: s.model, aspect: s.aspect, resolution: s.resolution, seed: s.seed, params: s.params,
        extraLooks: this.looks(), entityIndex: idx,
      });
      // no prompt = nothing to render. Counted and reported, never a silent skip.
      if (!body) { skipped++; continue; }
      try { await api.generate(body); n++; }
      catch (e) { app.showToast?.('Generate failed on ' + sh.id + ' — ' + (e.message || ''), 'var(--danger)'); break; }
      this.setState(st => ({ progress: st.progress ? { ...st.progress, done: n + skipped } : null }));
    }
    this.setState({ running: {}, progress: null });
    app.showToast?.(
      n ? n + ' shot' + (n === 1 ? '' : 's') + ' queued' + (skipped ? ' · ' + skipped + ' skipped (no prompt)' : '')
        : 'Nothing queued' + (skipped ? ' — ' + skipped + ' had no prompt' : ''),
      n ? 'var(--ok)' : 'var(--danger)');
    app.sync?.();
    this.load();
  }
  // what "Generate approved" would cost, from the catalog's per-model estimate
  estimate(nShots) { return estCost(this.settings().model) * Math.max(0, nShots); }
  load() {
    const pid = this.pid();
    if (!pid) { this.setState({ loading: false, err: 'no project context' }); return; }
    api.story(pid)
      .then(s => this.setState({ shots: (s && Array.isArray(s.shots)) ? s.shots : [], loading: false, err: null }))
      .catch(e => this.setState({ loading: false, err: e.message }));
  }
  // one place every inline edit funnels through: PATCH the shot, refresh the board + app state, toast.
  async edit(id, patch, log) {
    const pid = this.pid();
    if (!pid) return;
    this.setState({ busy: id });
    try {
      await api.patchShot(pid, id, patch, log);
      const s = await api.story(pid);
      this.setState({ shots: (s && Array.isArray(s.shots)) ? s.shots : [] });
      this.props.ctx?.app?.sync?.(); // Story tab reads the same records — keep app state fresh
    } catch (e) { this.props.ctx?.app?.showToast?.('Shot edit failed — ' + e.message, 'var(--danger)'); }
    finally { this.setState({ busy: null }); }
  }
  cycleType(sh) {
    const cur = SHOT_TYPES.indexOf(sh.type);
    const next = SHOT_TYPES[(cur + 1 + SHOT_TYPES.length) % SHOT_TYPES.length];
    this.edit(sh.id, { type: next }, 'size → ' + next);
  }
  cycleAngle(sh) {
    const cur = ANGLES.indexOf(String(sh.angle || '').toUpperCase());
    const next = ANGLES[(cur + 1 + ANGLES.length) % ANGLES.length];
    this.edit(sh.id, { angle: next }, 'angle → ' + next);
  }
  // Approval is a review verdict on the AI's breakdown, so it rides its own field rather than
  // hijacking `status` — 'generating' there is the server's write (backend/generate.mjs) and the
  // other keys mean render progress, not sign-off.
  approve(sh) {
    if (sh.approved) return;
    this.edit(sh.id, { approved: true }, 'row approved');
  }
  // Bulk approve skips any row with an open change note — that row is mid-edit and approving it
  // would sign off on the beat the user is in the middle of rewriting. Matches the footer tally,
  // which counts a changing row under `change`, not `open`.
  async approveAll() {
    for (const sh of (this.state.shots || [])) {
      if (sh.approved || this.state.changing[sh.id] != null) continue;
      await this.edit(sh.id, { approved: true }, 'row approved');
    }
  }
  openChange(sh) {
    const cur = this.state.changing;
    if (cur[sh.id] != null) { const { [sh.id]: _drop, ...rest } = cur; this.setState({ changing: rest }); return; }
    this._focusChange = sh.id; // focus the editor once it mounts (MentionText has no autoFocus prop)
    this.setState({ changing: { ...cur, [sh.id]: '' } });
  }
  setChange(id, text) { this.setState(s => ({ changing: { ...s.changing, [id]: text } })); }
  // Sending a change is the moment the user tells the agent it got something wrong. That is the
  // single most valuable signal in the loop and it used to evaporate into one shot's `desc` — the
  // agent would make the same mistake on the next breakdown, and the next.
  //
  // So the correction is BOTH: it rewrites this shot's beat (what the user asked for) AND it is
  // captured as a project learning, which rides into every future session's boot payload alongside
  // the brief. It goes through the dedupe-aware learnings route, so a user who keeps making the
  // same correction gets one bullet, not twenty — and the toast says honestly whether it was new.
  async sendChange(sh) {
    const text = String(this.state.changing[sh.id] || '').trim();
    if (!text) return;
    await this.edit(sh.id, { desc: text, approved: false }, 'change — ' + text);
    const { [sh.id]: _drop, ...rest } = this.state.changing;
    this.setState({ changing: rest });
    this.learn(text, sh);
  }
  // A correction is only worth remembering as a PREFERENCE. A note that just restates one shot's
  // action ("slow dolly past empty benches") is about this shot; a note phrased as a rule ("no
  // passengers, ever" / "prefer 2.39:1") is about the film. We cannot tell reliably, so we store it
  // attributed and let the distiller's dedupe + the user's own curation of memory sort it out —
  // attribution is what makes a wrong one obvious and deletable later.
  learn(text, sh) {
    const app = this.app(), pid = this.pid();
    if (!pid || !text) return;
    api.appendLearnings(pid, 'On ' + sh.id + ' the user asked for: ' + text)
      .then(r => {
        const added = (r && r.added) || [];
        app?.showToast?.(added.length ? 'Learned — saved to project memory' : 'Already known — memory unchanged',
          added.length ? 'var(--ok)' : 'var(--fg-muted)');
      })
      .catch(() => { /* the shot edit already landed; a failed learning must not undo it */ });
  }
  openWorkspace() {
    const pid = this.pid();
    // Shots live in the project's Story tab (the shot workspace opens from there) — same nav the
    // shot-ref card uses (cards.jsx ShotRefCard.open).
    this.props.ctx?.app?.openProj?.(pid, 'story');
  }
  // "See everything in detail" WITHOUT leaving the conversation. ShotWorkspace is a self-contained
  // fixed overlay (it only needs app/pid/shotId/entities/looks/onClose), so the card mounts it
  // directly rather than navigating to the Story tab and making the user find the row again.
  // There is deliberately no second detail UI — this is the same workspace the Story tab opens.
  openDetail(sh) { this.setState({ open: sh.id }); }

  // The shot's current still + whether anything is in flight, read from the SAME source the Story
  // tab's takes strip reads (projDef().gens filtered by g.shot, hero = sh.selectedCandidate).
  // Without this the board can tell you a shot is approved but not that it already rendered.
  takeOf(sh) {
    const app = this.app(), pid = this.pid();
    if (!app || !pid) return { file: null, running: false };
    const gens = (app.projDef(pid).gens || []).filter(g => g.shot === sh.id);
    const running = gens.some(g => g.status === 'queued' || g.status === 'running');
    const hero = gens.find(g => g.id === sh.selectedCandidate && g.file);
    const last = hero || gens.filter(g => g.file && g.reviewState !== 'killed').pop() || null;
    return { file: last ? last.file : null, running, takes: gens.length };
  }
  // one row of the breakdown. Three visual states, per the design:
  //   approved  → --ok border + --ok-tinted bed, solid --ok "✓" badge
  //   changing  → --warn border + --warn-tinted bed, solid --warn "✎ change" badge, second line
  //   open      → plain --border row with the "✓ approve" / "✎" affordances
  row(sh) {
    const dis = this.state.busy === sh.id;
    const change = this.state.changing[sh.id];
    const changing = change != null;
    const approved = !!sh.approved && !changing;
    const ent = entityOf(sh, this.entIdx());
    const take = this.takeOf(sh);
    const running = take.running || !!this.state.running[sh.id];
    // The design writes these tints as raw rgba of --ok/--warn. There is no --ok-40/--warn-03 token,
    // so they are derived from the token with color-mix — the pattern already in force at
    // ShotWorkspace.jsx:308 and RenderMedia.jsx:145 — rather than hardcoding the hex behind the token.
    const bed = approved
      ? { border: '1px solid color-mix(in srgb, var(--ok) 40%, transparent)', background: 'color-mix(in srgb, var(--ok) 4%, transparent)' }
      : changing
        ? { border: '1px solid color-mix(in srgb, var(--warn) 40%, transparent)', background: 'color-mix(in srgb, var(--warn) 3%, transparent)' }
        : { border: '1px solid var(--border)' };
    // keyboard cursor — a ring on top of whatever state the row is in, never replacing it
    if (this.state.sel === sh.id) bed.boxShadow = '0 0 0 1px var(--accent-35)';
    const head = (
      <div style={{ ...ROW, ...(changing ? { padding: 0 } : null) }}>
        <span style={ID_CELL}>{sh.id}</span>
        {/* the frame itself — clicking it opens the full workspace, the same affordance the Story
            list gives its thumbnail. A running shot shows the marked/running channel, never accent. */}
        <span onClick={() => !dis && this.openDetail(sh)} className="hBd" title={take.file ? 'Open shot workspace' : running ? 'Rendering…' : 'Not rendered yet — open the workspace'}
          style={{ ...sx('flex:none;width:44px;border-radius:5px;overflow:hidden;cursor:pointer;background:var(--sunk);border:1px solid var(--border)'), aspectRatio: '16/9' }}>
          {take.file
            ? <RenderMedia src={api.renderUrl(this.pid(), take.file)} kind="image" fit="cover" style={sx('width:100%;height:100%;display:block')} />
            : <span style={sx('width:100%;height:100%;display:flex;align-items:center;justify-content:center')}>
                {running
                  ? <span style={{ ...sx('width:5px;height:5px;border-radius:99px'), background: 'var(--marked)', animation: 'dl-pulse 1.2s infinite' }} />
                  : <span style={{ fontFamily: MONO, fontSize: 9, color: 'var(--border-3)' }}>—</span>}
              </span>}
        </span>
        <span onClick={() => !dis && this.openDetail(sh)} title={actionOf(sh)}
          style={sx('font-size:11.5px;color:var(--fg);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer')}>{actionOf(sh)}</span>
        <SizeChip label={sizeOf(sh)} onClick={() => !dis && this.cycleType(sh)} />
        {!changing ? <AngleChip label={sh.angle} onClick={() => !dis && this.cycleAngle(sh)} /> : null}
        {!changing ? <CastPill ent={ent} /> : null}
        {changing ? (
          <span style={{ ...sx('flex:none;font-size:9px;font-weight:800;border-radius:5px;padding:2px 7px'), background: 'var(--warn)', color: 'var(--on-accent)' }}>✎ change</span>
        ) : approved ? (
          <span title="Approved" onClick={() => !dis && this.edit(sh.id, { approved: false }, 'approval withdrawn')}
            style={{ ...sx('flex:none;font-size:9px;font-weight:800;border-radius:5px;padding:2px 7px;cursor:pointer'), background: 'var(--ok)', color: 'var(--on-accent)' }}>✓</span>
        ) : (
          <>
            <span className="hBd" onClick={() => !dis && this.approve(sh)} style={AFFORD}>✓ approve</span>
            <span className="hBd" title="Send a change — the agent learns from it" onClick={() => !dis && this.openChange(sh)} style={AFFORD}>✎</span>
          </>
        )}
        {/* single generate — a TEXT affordance in the design's row-action register (like "✓ approve"),
            never an icon glyph. Running shows the marked/running channel + text, never the accent. */}
        {!changing ? (running ? (
          <span style={{ ...sx('flex:none;display:inline-flex;align-items:center;gap:5px;font-size:9px;font-weight:700;border-radius:5px;padding:2px 8px'), color: 'var(--marked)', border: '1px solid color-mix(in srgb, var(--marked) 40%, transparent)' }}>
            <span style={{ ...sx('width:5px;height:5px;border-radius:99px'), background: 'var(--marked)', animation: 'dl-pulse 1.2s infinite' }} />generating
          </span>
        ) : (
          <span className="hBdAccentChip" title={'Generate this shot — ' + modelName(this.settings().model)}
            onClick={() => !dis && this.generate(sh)}
            style={{ ...sx('flex:none;font-size:9px;font-weight:700;border-radius:5px;padding:2px 8px;cursor:pointer;border:1px solid var(--accent-35);color:var(--accent)') }}>Generate</span>
        )) : null}
      </div>
    );
    if (!changing) return <div key={sh.id} className={approved ? '' : 'hBd'} style={{ ...bed, borderRadius: 8, opacity: dis ? 0.55 : 1 }}>{head}</div>;
    return (
      <div key={sh.id} style={{ ...bed, ...sx('border-radius:8px;padding:7px 10px'), opacity: dis ? 0.55 : 1 }}>
        {head}
        <div style={sx('display:flex;align-items:center;gap:8px;margin-top:7px;padding-left:53px')}>
          <EditBox value={change} placeholder="what should change? @ adds cast or a location"
            entities={this.app() && this.pid() ? buildEntityPool(this.app(), this.pid()) : []}
            inputRef={r => { if (r && this._focusChange === sh.id) { this._focusChange = null; r.focus({ toEnd: true }); } }}
            onChange={t => this.setChange(sh.id, t)}
            onEnter={() => this.sendChange(sh)} onEscape={() => this.openChange(sh)} />
          <span className="hBtnAccent" onClick={() => !dis && this.sendChange(sh)}
            style={{ ...sx('flex:none;font-size:9px;font-weight:700;border-radius:5px;padding:3px 9px;cursor:pointer'), background: 'var(--accent)', color: 'var(--on-accent)' }}>send</span>
        </div>
      </div>
    );
  }
  render() {
    this._idx = null; // see entIdx() — one pool per render pass, never cached across them
    const { shots, loading, err, view, changing } = this.state;
    const pid = this.pid();
    if (loading) return <CardShell label="shot breakdown"><span style={sx('font-size:11.5px;color:var(--fg-muted)')}>Loading shots…</span></CardShell>;
    if (err) return <CardShell label="shot breakdown" tone="var(--danger)"><span style={sx('font-size:11.5px;color:var(--fg-muted)')}>{err}</span></CardShell>;
    if (!shots || !shots.length) return (
      <CardShell label="shot breakdown"><span style={sx('font-size:11.5px;color:var(--fg-muted)')}>No shots yet — break the story into shots to fill the board.</span></CardShell>
    );
    const groups = groupBySeq(shots);
    const act = (this.props.directive || {}).act || (this.props.directive || {}).scene || '';
    const label = ['shot breakdown', act, groups.length > 1 ? groups.length + ' seq' : null, shots.length + ' shots']
      .filter(Boolean).join(' · ');
    const nChange = shots.filter(s => changing[s.id] != null).length;
    const nApproved = shots.filter(s => s.approved && changing[s.id] == null).length;
    const nOpen = shots.length - nApproved - nChange;
    // Mirrors approveAll's skip rule, so the button greys out exactly when there is nothing it would act on.
    const remaining = shots.filter(s => !s.approved && changing[s.id] == null).length;
    const s = this.settings();
    const app = this.app();
    // ungenerated approved shots — what "Generate approved" would actually fire
    const toGen = shots.filter(x => x.approved && changing[x.id] == null && !this.takeOf(x).file);
    const anyRunning = shots.some(x => this.takeOf(x).running) || Object.keys(this.state.running).length > 0;
    // chevron that collapses/expands the whole card — a reviewed board becomes a one-line receipt
    const collapseBtn = (
      <span onClick={() => this.setState(st => ({ collapsed: !st.collapsed, sel: null }))} className="hFg"
        title={this.state.collapsed ? 'Expand the board' : 'Collapse to one line'}
        style={{ ...sx('cursor:pointer;font-size:8px;color:var(--fg-faint);padding:2px 4px'), display: 'inline-block', transform: this.state.collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 120ms ease' }}>▾</span>
    );
    if (this.state.collapsed) return (
      <CardShell label={label} right={collapseBtn}>
        <div onClick={() => this.setState({ collapsed: false })} className="hFg"
          style={{ ...sx('cursor:pointer'), fontFamily: MONO, fontSize: 10, color: 'var(--fg-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {nApproved} approved · {nOpen} open{anyRunning ? ' · rendering' : ''} — click to expand
        </div>
      </CardShell>
    );
    const prog = this.state.progress;
    return (
      <div onMouseEnter={() => { this._hover = true; }} onMouseLeave={() => { this._hover = false; }}>
      <CardShell label={label} right={
        <span style={sx('display:inline-flex;align-items:center;gap:10px')}>
          {/* THE settings, not a new ones. TechSettings is the shared TECH popover (model · output ·
              aspect · resolution · seed · per-model params from the fal schema) that the composer
              and the Story row already open — so what this board generates with is configured in
              exactly the same surface, and adding a model needs no edit here. */}
          {app && pid ? (
            <TechSettings align="right" width={380}
              label={modelName(s.model)}
              settings={app.state.settings || {}} value={s} onChange={gen => this.setState({ gen })} />
          ) : null}
          <SegmentedControl size="sm" options={VIEWS} value={view} onChange={v => this.setState({ view: v })} />
          {collapseBtn}
        </span>
      }>
        {groups.map((g, gi) => (
          <div key={g.key || 'g' + gi}>
            {g.key ? <SeqHead first={!gi}>SEQ {g.key.toUpperCase()}{g.title ? ' — ' + g.title.toUpperCase() : ''}</SeqHead> : null}
            <div style={sx('display:flex;flex-direction:column;gap:5px')}>
              {view === 'action'
                // ACTION view — the beats alone, for reading the sequence as prose.
                ? g.shots.map(sh => (
                  <div key={sh.id} style={sx('display:flex;align-items:baseline;gap:9px;padding:3px 2px')}>
                    <span style={ID_CELL}>{sh.id}</span>
                    <span style={sx('font-size:11.5px;color:var(--fg-soft);flex:1;min-width:0;line-height:1.5')}>{actionOf(sh)}</span>
                  </div>
                ))
                : g.shots.map(sh => this.row(sh))}
            </div>
          </div>
        ))}
        <div style={sx('display:flex;align-items:center;gap:9px;margin-top:12px;flex-wrap:wrap')}>
          <span className="hBtnAccent" onClick={() => remaining && this.approveAll()}
            style={{ ...sx('font-size:10.5px;font-weight:700;border-radius:7px;padding:5px 12px;cursor:pointer'), background: remaining ? 'var(--accent)' : 'var(--raise)', color: remaining ? 'var(--on-accent)' : 'var(--fg-faint)', pointerEvents: remaining ? 'auto' : 'none' }}>
            Approve all remaining
          </span>
          {/* THE go button. This used to say "Storyboard approved shots" and merely navigate to the
              Story tab — the board could list a breakdown but never render it. It now generates,
              in place, each shot through the shared composer (its own beat, its own look, its own
              cast/location references). The cost is the model's, shown before the click. */}
          <span className="hBtnAccent" title={toGen.length
            ? 'Generate ' + toGen.length + ' approved shot' + (toGen.length === 1 ? '' : 's') + ' on ' + modelName(s.model)
            : nApproved ? 'Every approved shot already has a frame' : 'Approve a shot first'}
            onClick={() => toGen.length && !anyRunning && this.generate(toGen)}
            style={{ ...sx('display:inline-flex;align-items:center;gap:7px;font-size:10.5px;font-weight:700;border-radius:7px;padding:5px 12px;cursor:pointer'),
              background: toGen.length && !anyRunning ? 'var(--accent)' : 'var(--raise)',
              color: toGen.length && !anyRunning ? 'var(--on-accent)' : 'var(--fg-faint)',
              pointerEvents: toGen.length && !anyRunning ? 'auto' : 'none' }}>
            {anyRunning ? (prog ? 'Generating ' + prog.done + '/' + prog.total + '…' : 'Generating…') : toGen.length ? 'Generate approved (' + toGen.length + ')' : 'Generate approved'}
          </span>
          {toGen.length ? <Cost value={this.estimate(toGen.length)} /> : null}
          <span className="hBd" onClick={() => this.openWorkspace()} title="Open the full shot list in the Story tab"
            style={{ ...sx('font-size:10.5px;font-weight:700;border-radius:7px;padding:5px 12px;cursor:pointer;border:1px solid var(--border);color:var(--fg-soft)'), pointerEvents: pid ? 'auto' : 'none', opacity: pid ? 1 : 0.5 }}>
            Open board
          </span>
          <span style={{ ...sx('margin-left:auto'), fontFamily: MONO, fontSize: 9, color: 'var(--fg-faint)', fontVariantNumeric: 'tabular-nums' }}>
            {nApproved} approved · {nChange} change · {nOpen} open
          </span>
        </div>
        {/* keyboard flow, discoverable — active only while the pointer is over this card */}
        <div style={{ ...sx('margin-top:6px'), fontFamily: MONO, fontSize: 8, letterSpacing: '.06em', color: 'var(--border-3)' }}>
          HOVER + ↑↓ SELECT · A APPROVE · E CHANGE · G GENERATE
        </div>
        {/* the full-detail overlay, mounted here so it opens WITHOUT leaving the conversation.
            Same component the Story tab opens — there is no second shot-detail UI. */}
        {this.state.open && app && pid ? (
          <ShotWorkspace app={app} pid={pid} shotId={this.state.open}
            entities={buildAssetPool(app, pid)} looks={this.looks()}
            renderMentions={t => t}
            onClose={() => { this.setState({ open: null }); this.load(); }} />
        ) : null}
      </CardShell>
      </div>
    );
  }
}

// ── the staged breakdown proposal ──
// The one card that reads shots from the directive (no canonical record yet). It is the SAME board as
// the live one, drawn from staged data instead of records: sequence groups, the design's size/angle
// chips, cast pills. It used to be a flat numbered list — which read nothing like the design and hid
// the whole point (that the agent already assigned cast and camera). Editing here is LOCAL (staged):
// cycling a chip changes what Confirm will write, nothing is persisted until then. Confirm writes each
// shot through the existing create route and the card BECOMES the live board; Dismiss drops it.
class BreakdownProposalCard extends React.Component {
  // `edits` holds per-row staged overrides { type, angle, desc } — every chip and the beat itself are
  // editable BEFORE anything is written; `editing` is which row's beat is open in an input right now;
  // `expanded` is which rows show their full beat; `gen` is the shared TECH settings so per-row and
  // "Generate all" fire on the model you chose; `openId` is the written shot whose full workspace
  // overlay is up (the pop window). Editing changes what a later write persists — nothing before that.
  state = { status: 'staged', written: 0, err: null, edits: {}, editing: {}, expanded: {}, gen: null, openId: null };
  pid() { const d = this.props.directive || {}; return d.project || d.pid || (this.props.ctx || {}).pid || null; }
  app() { return this.props.ctx?.app; }
  entIdx() {
    const app = this.app(), pid = this.pid();
    if (!app || !pid) return null;
    if (!this._idx) this._idx = entityIndex(app, pid);
    return this._idx;
  }
  // the TECH settings, defaulted to the project model so "Generate all" works with zero clicks
  settings() {
    const app = this.app(), pid = this.pid();
    const g = this.state.gen;
    if (g && g.model) return g;
    return { model: app && pid ? defaultShotModel(app, pid) : '', aspect: '16:9', resolution: null, seed: null, params: {} };
  }
  looks() { return (this.app()?.state?.styleLocks) || []; }
  estimate(n) { return estCost(this.settings().model) * Math.max(0, n); }
  toggleExpand(i) { this.setState(st => ({ expanded: { ...st.expanded, [i]: !st.expanded[i] } })); }
  proposed() {
    const d = this.props.directive || {};
    const raw = Array.isArray(d.shots) ? d.shots : (Array.isArray(d.proposal) ? d.proposal : []);
    return raw.filter(s => s && typeof s === 'object').map((s, i) => {
      const e = this.state.edits[i] || {};
      return {
        // preview id — the board reads `id`; nothing is written yet, so it is the proposal's own
        // number (the real SH-id is assigned by the create route on confirm).
        id: s.id || ('#' + String(s.no != null ? s.no : i + 1)),
        no: s.no != null ? s.no : i + 1,
        title: s.title || s.name || 'Shot ' + (i + 1),
        type: e.type || (SHOT_TYPES.includes(s.type) ? s.type : (s.type || 'Medium')),
        angle: e.angle || s.angle || '',
        dur: Number(s.dur) || 4,
        // the beat is editable in place — an override wins over the agent's original
        desc: e.desc != null ? e.desc : (s.desc || s.description || ''),
        prompt: s.prompt || '',
        // seq grouping if the agent supplied it — the board renders SEQ headers off these
        seq: s.seq || '', seqTitle: s.seqTitle || s.sceneTitle || '',
        // carried through so the row shows its @entity exactly like the live board and confirm writes
        // the assignment — the agent sets these (see the shot-board tool capability).
        cast: Array.isArray(s.cast) ? s.cast.filter(Boolean) : [],
        loc: s.loc || s.location || '',
        status: 'todo'
      };
    });
  }
  cycleType(i, sh) {
    const cur = SHOT_TYPES.indexOf(sh.type);
    const next = SHOT_TYPES[(cur + 1 + SHOT_TYPES.length) % SHOT_TYPES.length];
    this.setState(st => ({ edits: { ...st.edits, [i]: { ...st.edits[i], type: next } } }));
  }
  cycleAngle(i, sh) {
    const cur = ANGLES.indexOf(String(sh.angle || 'EYE').toUpperCase());
    const next = ANGLES[(cur + 1 + ANGLES.length) % ANGLES.length];
    this.setState(st => ({ edits: { ...st.edits, [i]: { ...st.edits[i], angle: next } } }));
  }
  // Inline beat editing — click the pencil, type, Enter (or blur) to keep, Escape to drop. It writes
  // the local override only; nothing hits disk until you add or generate. This is the "i can't edit
  // stuff" fix at the row level — the pop window edits everything else.
  startEdit(i, sh) { this._focusEdit = i; this.setState(st => ({ editing: { ...st.editing, [i]: sh.desc || '' } })); }
  setEditDraft(i, text) { this.setState(st => ({ editing: { ...st.editing, [i]: text } })); }
  cancelEdit(i) { this.setState(st => { const { [i]: _d, ...rest } = st.editing; return { editing: rest }; }); }
  saveEdit(i) {
    this.setState(st => {
      const text = String(st.editing[i] ?? '').trim();
      const { [i]: _d, ...rest } = st.editing;
      return { editing: rest, edits: { ...st.edits, [i]: { ...st.edits[i], desc: text } } };
    });
  }
  // Any per-row action that needs a real record — single generate, or opening the full workspace —
  // commits the whole proposal first (writing is cheap and is where shots live), then acts on the
  // target and becomes the live board. So a click here never fragments into "one written, rest staged";
  // it lands you on the board with the thing you asked for already happening. `action`: 'generate' fires
  // one render; 'open' raises that shot's workspace overlay (the pop window) on top of the board.
  async commitThen(action, i) {
    const app = this.app(), pid = this.pid();
    if (!app || !pid || !this.proposed().length) return;
    this.setState({ status: 'committing', written: 0, err: null });
    try {
      const created = await this.writeShots();
      const target = created[i] || null;
      if (action === 'generate' && target) {
        const st = this.settings();
        const body = shotGenerateBody(app, pid, target, { model: st.model, aspect: st.aspect, resolution: st.resolution, seed: st.seed, params: st.params, extraLooks: this.looks() });
        if (body) { try { await api.generate(body); } catch { /* one failure must not strand the board */ } }
        app.sync?.();
        app.showToast?.(created.length + ' shots added · generating ' + (target.id || ''), 'var(--ok)');
      } else if (action === 'open' && target) {
        app.showToast?.(created.length + ' shots added — opened ' + (target.id || ''), 'var(--ok)');
      }
      this.setState({ status: 'confirmed', openId: action === 'open' && target ? target.id : null });
    } catch (e) { this.setState({ status: 'staged', err: e.message }); }
  }
  // Write the staged shots as canonical records. Returns the created records (with their real ids) so
  // generateAll can render them; sequential so the create route's incremental id assignment stays
  // ordered. Strips the preview id — the route assigns the real one — and keeps the user's staged edits.
  async writeShots() {
    const pid = this.pid();
    const created = [];
    for (const sh of this.proposed()) {
      const { id, ...rec } = sh;
      const w = await api.addShot(pid, rec);
      created.push(w);
      this.setState({ written: created.length });
    }
    this.app()?.sync?.();
    return created;
  }
  // "Add to shot board" — write only. The card becomes the live board, where per-row Generate/approve live.
  async confirm() {
    const pid = this.pid();
    if (!pid || !this.proposed().length) { this.setState({ err: pid ? 'nothing to confirm' : 'no project context' }); return; }
    this.setState({ status: 'confirming', written: 0, err: null });
    try {
      const created = await this.writeShots();
      this.app()?.showToast?.(created.length + ' shots added to the board', 'var(--ok)');
      this.setState({ status: 'confirmed', written: created.length });
    } catch (e) { this.setState({ status: 'staged', err: e.message }); }
  }
  // "Generate all" — write AND render every shot in one action, without leaving the chat: each written
  // shot generates through the SHARED composer (its own beat, its look, its cast/location refs). Then
  // the card becomes the live board, already showing them rendering. This is the "press go" path.
  async generateAll() {
    const app = this.app(), pid = this.pid();
    if (!app || !pid || !this.proposed().length) { this.setState({ err: pid ? 'nothing to generate' : 'no project context' }); return; }
    const s = this.settings(), looks = this.looks();
    this.setState({ status: 'generating', written: 0, err: null, genDone: 0 });
    try {
      const created = await this.writeShots();
      let fired = 0, skipped = 0;
      for (const w of created) {
        const body = shotGenerateBody(app, pid, w, { model: s.model, aspect: s.aspect, resolution: s.resolution, seed: s.seed, params: s.params, extraLooks: looks });
        if (!body) { skipped++; this.setState({ genDone: fired + skipped }); continue; }
        try { await api.generate(body); fired++; } catch { /* one failure must not abort the rest */ }
        this.setState({ genDone: fired + skipped });
      }
      app.sync?.();
      app.showToast?.(created.length + ' shots added · generating ' + fired + (skipped ? ' · ' + skipped + ' had no prompt' : ''), 'var(--ok)');
      this.setState({ status: 'confirmed', written: created.length });
    } catch (e) { this.setState({ status: 'staged', err: e.message }); }
  }
  // cast + location as small @-entity avatars — the Story page's CAST/LOC cells (Story.jsx assignCell),
  // the same "@ feature" the user asked for. Resolved through the shared cast/loc resolver so a shot
  // the agent wrote as "@deckhand crosses…" shows the face even without a structured field. Renders
  // NOTHING when the shot has no cast or location — an insert of gulls should not carry an empty slot.
  castLoc(sh, idx) {
    if (!idx) return null;
    const cast = shotCast(sh, idx).map(k => idx.get(k)).filter(Boolean).slice(0, 3);
    const loc = idx.get(shotLoc(sh, idx) || '');
    if (!cast.length && !loc) return null;
    const av = (c, round) => <img key={c.key} src={c.thumb} title={'@' + c.key} alt=""
      style={{ width: 20, height: 20, objectFit: 'cover', border: '1px solid var(--border-2)', borderRadius: round ? 99 : 5, flex: 'none' }} />;
    return (
      <span style={sx('flex:none;display:inline-flex;align-items:center;gap:3px')}>
        {cast.map(c => av(c, true))}{loc ? av(loc, false) : null}
      </span>
    );
  }

  render() {
    this._idx = null; // rebuild the entity pool per pass — app state (new refs) changes under us
    const { status, written, err } = this.state;
    const pid = this.pid();
    const shots = this.proposed();
    // Confirmed → this card BECOMES the live board (the same swap-in-place confirmCard does when a
    // batch is approved). The shots are canonical records now, so the board can approve, correct, and
    // generate them. If an "open" brought us here, the target shot's workspace overlay rides on top —
    // the pop window, still inside the chat, never a tab jump.
    if (status === 'confirmed') {
      const app = this.app();
      return (
        <>
          <ShotBoardCard directive={{ type: 'show.shot-board', project: pid }} ctx={this.props.ctx} />
          {this.state.openId && app ? (
            <ShotWorkspace app={app} pid={pid} shotId={this.state.openId}
              entities={buildAssetPool(app, pid)} looks={this.looks()} renderMentions={t => t}
              onClose={() => this.setState({ openId: null })} />
          ) : null}
        </>
      );
    }
    if (status === 'dismissed') {
      return <CardShell label="breakdown" tone="var(--fg-faint)"><span style={sx('font-size:11.5px;color:var(--fg-muted)')}>Proposal dismissed — nothing was written.</span></CardShell>;
    }
    const busy = status === 'confirming' || status === 'generating' || status === 'committing';
    const idx = this.entIdx();
    const groups = groupBySeq(shots);
    const label = ['breakdown proposal', groups.length > 1 ? groups.length + ' seq' : null, shots.length + ' shots'].filter(Boolean).join(' · ');
    const s = this.settings();
    const app = this.app();
    const go = pid && shots.length && !busy;
    return (
      // Solid card, same shell as the live board — the proposal IS the breakdown board, drawn from
      // staged data. The header carries the SAME model/settings popover the live board and composer
      // use, so "Generate all" fires on the model you chose without leaving the card.
      <CardShell label={label} right={
        <span style={sx('display:inline-flex;align-items:center;gap:10px')}>
          {app && pid ? (
            <TechSettings align="right" width={380}
              label={modelName(s.model)}
              settings={app.state.settings || {}} value={s} onChange={gen => this.setState({ gen })} />
          ) : null}
          <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>staged · {shots.length}</span>
        </span>
      }>
        {!shots.length ? (
          <span style={sx('font-size:11.5px;color:var(--fg-muted)')}>The proposal carried no shots.</span>
        ) : groups.map((g, gi) => (
          <div key={g.key || 'g' + gi}>
            {g.key ? <SeqHead first={!gi}>SEQ {g.key.toUpperCase()}{g.title ? ' — ' + g.title.toUpperCase() : ''}</SeqHead> : null}
            <div style={sx('display:flex;flex-direction:column;gap:5px')}>
              {g.shots.map(sh => {
                const i = shots.indexOf(sh);
                const beat = actionOf(sh);
                const open = !!this.state.expanded[i];
                const editing = this.state.editing[i] != null;
                const look = app && pid ? lookForShot(app, pid, sh, this.looks()) : null;
                const ownLook = !!sh.look;
                return (
                  <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                    {/* COLLAPSED summary — the Story page's clean columns: id · beat · size·dur ·
                        style · cast/loc avatars. No action buttons; the whole row expands on click.
                        This is the "reduce the view, don't overwhelm" default. */}
                    <div className="hBg" onClick={() => !busy && this.toggleExpand(i)}
                      style={{ ...ROW, cursor: 'pointer', background: open ? 'var(--surface-2)' : undefined }}>
                      <span style={ID_CELL}>{sh.id}</span>
                      {/* lead frame — same 44px slot the live board's rows carry, so the proposal and
                          the board it becomes share one row anatomy. Nothing is rendered yet, so it
                          shows the first cast face (else the location), else the not-rendered dash. */}
                      {(() => {
                        const lead = idx ? (shotCast(sh, idx).map(k => idx.get(k)).find(Boolean) || idx.get(shotLoc(sh, idx) || '') || null) : null;
                        return (
                          <span style={{ ...sx('flex:none;width:44px;border-radius:5px;overflow:hidden;background:var(--sunk);border:1px solid var(--border)'), aspectRatio: '16/9' }}>
                            {lead
                              ? <img src={lead.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                              : <span style={{ ...sx('width:100%;height:100%;display:flex;align-items:center;justify-content:center'), fontFamily: MONO, fontSize: 9, color: 'var(--border-3)' }}>—</span>}
                          </span>
                        );
                      })()}
                      <span style={sx('font-size:11.5px;color:var(--fg);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{beat}</span>
                      {/* SETTINGS — "Insert · 3s", exactly how the Story list shows shot size (Story.jsx:1192) */}
                      <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--fg-muted)', flex: 'none', fontVariantNumeric: 'tabular-nums' }}>{[sh.type, sh.dur ? sh.dur + 's' : null].filter(Boolean).join(' · ')}</span>
                      {look ? <span title={ownLook ? 'shot look' : 'project style'} style={{ ...sx('flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), maxWidth: 96, fontFamily: MONO, fontSize: 9.5, color: ownLook ? 'var(--accent)' : 'var(--fg-faint)' }}>✦ {look.name}</span> : null}
                      {this.castLoc(sh, idx)}
                      <span aria-hidden style={{ flex: 'none', fontSize: 8, color: 'var(--fg-faint)', transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 120ms ease' }}>▾</span>
                    </div>
                    {/* EXPANDED — only now do editing and the actions appear. Full beat (click to edit,
                        no pencil), the size/angle you can cycle, and Open / Generate. */}
                    {open ? (
                      <div style={sx('padding:9px 12px 11px;border-top:1px solid var(--line);background:var(--surface)')}>
                        {editing ? (
                          <div style={sx('display:flex;gap:8px;align-items:center')}>
                            <EditBox value={this.state.editing[i]} placeholder="the action beat… @ adds cast or a location"
                              entities={app && pid ? buildEntityPool(app, pid) : []}
                              inputRef={r => { if (r && this._focusEdit === i) { this._focusEdit = null; r.focus({ toEnd: true }); } }}
                              onChange={t => this.setEditDraft(i, t)}
                              onEnter={() => this.saveEdit(i)} onEscape={() => this.cancelEdit(i)} />
                            <span className="hBtnAccent" onMouseDown={e => e.preventDefault()} onClick={() => this.saveEdit(i)}
                              style={{ ...sx('flex:none;font-size:9px;font-weight:700;border-radius:5px;padding:4px 10px;cursor:pointer'), background: 'var(--accent)', color: 'var(--on-accent)' }}>save</span>
                          </div>
                        ) : (
                          <div onClick={() => this.startEdit(i, sh)} title="Click to edit the beat"
                            style={sx('font-size:12px;color:var(--fg);line-height:1.5;cursor:text')}>{beat}</div>
                        )}
                        <div style={sx('display:flex;align-items:center;gap:7px;margin-top:9px;flex-wrap:wrap')}>
                          <SizeChip label={sh.type} onClick={() => !busy && this.cycleType(i, sh)} />
                          <AngleChip label={sh.angle} onClick={() => !busy && this.cycleAngle(i, sh)} />
                          <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)', fontVariantNumeric: 'tabular-nums' }}>{sh.dur}s</span>
                          <span style={sx('margin-left:auto;display:inline-flex;gap:7px')}>
                            <span className="hBd" title="Open the full shot — refs, cast, everything" onClick={() => !busy && this.commitThen('open', i)}
                              style={sx('flex:none;font-size:9.5px;font-weight:700;border-radius:6px;padding:4px 11px;cursor:pointer;border:1px solid var(--border-2);color:var(--fg-soft)')}>Open full</span>
                            <span className="hBdAccentChip" title={'Generate this shot — ' + modelName(s.model)} onClick={() => !busy && this.commitThen('generate', i)}
                              style={sx('flex:none;font-size:9.5px;font-weight:700;border-radius:6px;padding:4px 11px;cursor:pointer;border:1px solid var(--accent-35);color:var(--accent)')}>Generate</span>
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {err ? <div style={sx('font-size:10.5px;color:var(--danger);margin-top:8px')}>{err}</div> : null}
        {/* Two ways forward, both staying in the chat (the card becomes the live board either way):
            GENERATE ALL writes the shots and renders every image; ADD TO SHOT BOARD writes them so you
            can approve/generate per row. This is the user's "add to shotboard OR generate all". */}
        <div style={sx('display:flex;align-items:center;gap:9px;margin-top:12px;flex-wrap:wrap')}>
          <span onClick={() => go && this.generateAll()} className="hBtnAccent"
            title={go ? 'Write these shots and render every image — ' + modelName(s.model) : 'open a project'}
            style={{ ...sx('display:inline-flex;align-items:center;gap:7px;font-size:10.5px;font-weight:700;border-radius:7px;padding:5px 13px;cursor:pointer'), background: go ? 'var(--accent)' : 'var(--raise)', color: go ? 'var(--on-accent)' : 'var(--fg-faint)', pointerEvents: go ? 'auto' : 'none' }}>
            {status === 'generating'
              ? (written < shots.length
                ? 'Writing ' + written + '/' + shots.length + '…'
                : 'Generating ' + (this.state.genDone || 0) + '/' + shots.length + '…')
              : 'Generate all ' + shots.length}
          </span>
          {go ? <Cost value={this.estimate(shots.length)} /> : null}
          <span onClick={() => go && this.confirm()} className="hBd"
            title="Write the shots without rendering — approve and generate them per row on the board"
            style={{ ...sx('font-size:10.5px;font-weight:700;border-radius:7px;padding:5px 12px;cursor:pointer;border:1px solid var(--border-2);color:var(--fg-soft)'), pointerEvents: go ? 'auto' : 'none', opacity: go ? 1 : 0.5 }}>
            {status === 'confirming' ? 'Adding ' + written + '/' + shots.length + '…' : 'Add to shot board'}
          </span>
          <span onClick={() => !busy && this.setState({ status: 'dismissed' })} className="hFg"
            style={{ ...sx('font-size:10.5px;font-weight:600;border-radius:7px;padding:5px 10px;cursor:pointer;color:var(--fg-faint)'), pointerEvents: busy ? 'none' : 'auto' }}>Dismiss</span>
          <span style={{ ...sx('margin-left:auto;font-size:9px;color:var(--fg-faint)'), fontFamily: MONO }}>click a shot to expand · nothing saved until you act</span>
        </div>
      </CardShell>
    );
  }
}

// One registry entry drives every shot-board directive type (shared/chatTools.mjs). Branch on the
// directive type: a proposal is staged (carries its own shots); everything else is the live board.
registerToolCard('shot-board', (directive, ctx) => {
  const type = String((directive && directive.type) || '');
  const isProposal = type === 'proposal.breakdown' || type === 'breakdown.proposal'
    || (type === 'breakdown' && Array.isArray(directive && directive.shots));
  return isProposal
    ? <BreakdownProposalCard directive={directive} ctx={ctx} />
    : <ShotBoardCard directive={directive} ctx={ctx} />;
});

export { ShotBoardCard, BreakdownProposalCard };
