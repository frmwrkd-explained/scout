// Inline generation cards (ticket 14). Imported for its side effects by cards.jsx (which Chat.jsx
// already imports), so the registration chain stays intact without touching Chat.jsx.
//
// Generation directives are a CORE chat capability — starting/showing generations is the whole point
// of the filmmaker chat, not one of the gated Settings tools — so these register DIRECTLY via
// registerDirectiveRenderer (exactly like the core shot-ref card), never through the chat-tools
// registry. The router SKILL.md grammar carries ids only (rule 2); every card FETCHES the canonical
// generation record and renders that. The id lives on `directive.ref` (string or array) for single/
// multi, or on `directive.batch` for a whole batch.
//
// LIVE STATUS — mirrors ProjectGenerate exactly, no new fetch and no second SSE. `/api/state`
// already carries `projects[].gens` (backend/index.mjs:287), the app's revision SSE (App.connectEvents)
// re-syncs that state on every generation mutation, and Chat re-renders its cards from `ctx.app.state`
// on each App re-render. So a card reads its generation records straight out of app state and a
// queued→running→done transition simply re-renders it — the same passive-refresh path the generate
// console uses. `app.sync()` on mount just hastens the first read for a just-started generation.
import React from 'react';
import { sx } from '../sx';
import { api } from '../api';
import RenderMedia, { RenderTile, RenderLightbox } from '../RenderMedia';
import { registerDirectiveRenderer, CardShell } from './directives';
import { SplitFlow } from './splitCard';
import { isToolEnabled } from './toolRegistry'; // the oracle's real home — no pass-through hop
import { estCost, isVideoModel, isAudioModel, modelById } from '../models';
import { MONO } from '../tokens';


// Collect the generation id(s) a directive points at. `ref` is the router grammar's field (string or
// array); `.id`/`.generations`/`.gens` are accepted aliases so a slightly-different envelope still routes.
function genIds(d) {
  if (!d || typeof d !== 'object') return [];
  const raw = d.ref !== undefined ? d.ref
    : d.generations !== undefined ? d.generations
    : d.gens !== undefined ? d.gens
    : d.id !== undefined ? d.id : null;
  const arr = Array.isArray(raw) ? raw : (raw != null ? [raw] : []);
  return arr.map(x => (x != null ? String(x) : null)).filter(Boolean);
}
const dirPid = (d, ctx) => d.project || d.pid || (ctx || {}).pid || null;
const batchId = d => (d && (d.batch || d.batchId)) ? String(d.batch || d.batchId) : null;

// Read a project's generation records live out of app state (the ProjectGenerate source of truth).
function projGens(ctx, pid) {
  try {
    const p = (ctx?.app?.state?.projects || []).find(x => x.id === pid);
    return (p && Array.isArray(p.gens)) ? p.gens : [];
  } catch { return []; }
}
const aspectCss = a => String(a || '16:9').replace(':', '/');
const kindOfGen = g => (g && (isAudioModel(g.model) ? 'audio' : isVideoModel(g.model) ? 'video' : 'image'));
const modelName = m => (modelById(m)?.label) || m || 'model';

// Cost shown must match the ledger: gen.cost is the exact figure ledger() logged on completion. Before
// completion there is no ledgered cost, so we show the catalog estimate, clearly marked `est`.
function costLabel(g) {
  if (g && g.status === 'done' && typeof g.cost === 'number') return '$' + g.cost.toFixed(3);
  const est = estCost(g?.model);
  return '~$' + (typeof est === 'number' ? est : 0).toFixed(3) + ' est';
}

const STATUS_TONE = { queued: 'var(--accent)', running: '#5B9DFF', done: 'var(--ok)', failed: 'var(--danger)', cancelled: 'var(--fg-muted)' };

// ── review triage (ticket 21) ── ONE state across chat and the inbox ──
// Keep/reject/rating on a chat card write the SAME reviewState/rating fields the review inbox writes,
// through the SAME api.reviewCandidate route (PATCH /api/generations/:pid/:id/review, body { patch }).
// There is no parallel chat-side state: a decision is one edit to the generation record, so a decision
// made here shows in the inbox and vice-versa — both surfaces re-render from `projects[].gens` in app
// state, which the generations-domain revision SSE re-syncs on every review write (App.connectEvents).
// The keep/reject/rate patch shapes below are byte-for-byte the ones App.applyDecisionTo / App.ibRate
// send, so a rating or decision agrees everywhere the generation is shown.
function reviewPatchFor(kind, g) {
  const cur = (g && g.reviewState) || 'new';
  if (kind === 'keep') return { reviewState: cur === 'kept' ? 'new' : 'kept' };   // re-click un-decides
  if (kind === 'reject') return { reviewState: cur === 'killed' ? 'new' : 'killed' };
  return {};
}
// Rating: mirrors App.ibRate — rating a still-'new' candidate keeps it; an existing decision stands.
// r === 0 clears the stars only (never flips a decision).
function ratePatchFor(r, g) {
  if (!r) return { rating: 0 };
  const cur = (g && g.reviewState) || 'new';
  return { rating: r, reviewState: cur === 'new' ? 'kept' : cur };
}
function reviewToast(patch) {
  if (patch.reviewState === 'kept') return ['Kept', 'var(--ok)'];
  if (patch.reviewState === 'killed') return ['Rejected', 'var(--danger)'];
  if (patch.reviewState === 'new') return ['Decision cleared', 'var(--fg-muted)'];
  if (patch.rating !== undefined) return [patch.rating ? 'Rated ' + patch.rating + '/5' : 'Rating cleared', 'var(--accent)'];
  return ['Updated', 'var(--ok)'];
}

// Star rating — clicking the current star clears it. stopPropagation so a cell's stars don't open the
// lightbox underneath them.
function Stars({ rating = 0, onRate, size = 13 }) {
  return (
    <span style={sx('display:inline-flex;gap:1px;align-items:center')} onClick={e => e.stopPropagation()}>
      {[1, 2, 3, 4, 5].map(n => (
        <span key={n} onClick={e => { e.stopPropagation(); onRate(n === rating ? 0 : n); }}
          style={{ cursor: 'pointer', fontSize: size, lineHeight: 1, color: n <= rating ? 'var(--accent)' : 'var(--border-3)' }}>★</span>
      ))}
    </span>
  );
}

// Keep / Reject toggle + stars. Reads the live record's reviewState/rating; the active decision is
// filled. onReview(patch) is supplied by the card and routes to api.reviewCandidate.
function ReviewControls({ g, onReview, busy, compact }) {
  const rs = (g && g.reviewState) || 'new';
  const rating = (g && g.rating) || 0;
  const kept = rs === 'kept', killed = rs === 'killed';
  const btn = (active, onColor, label, kind) => (
    <span onClick={e => { e.stopPropagation(); if (!busy) onReview(reviewPatchFor(kind, g)); }}
      style={{ ...sx('font-weight:700;border-radius:6px;cursor:pointer;user-select:none;white-space:nowrap'),
        fontSize: compact ? 9 : 10.5, padding: compact ? '2px 7px' : '4px 10px',
        border: '1px solid ' + (active ? onColor : 'var(--border-2)'),
        background: active ? onColor : 'transparent', color: active ? 'var(--void)' : 'var(--fg-soft)',
        pointerEvents: busy ? 'none' : 'auto', opacity: busy ? 0.6 : 1 }}>
      {label}
    </span>
  );
  return (
    <span style={{ ...sx('display:inline-flex;align-items:center;flex-wrap:wrap'), gap: compact ? 5 : 8 }} onClick={e => e.stopPropagation()}>
      {btn(kept, 'var(--ok)', kept ? 'Kept ✓' : 'Keep', 'keep')}
      {btn(killed, 'var(--danger)', killed ? 'Rejected ✕' : 'Reject', 'reject')}
      <Stars rating={rating} size={compact ? 11 : 13} onRate={r => onReview(ratePatchFor(r, g))} />
    </span>
  );
}

// Corner badge showing the standing decision + rating on a grid cell (visible without hovering).
function DecisionBadge({ g }) {
  const rs = (g && g.reviewState) || 'new';
  const rating = (g && g.rating) || 0;
  if (rs !== 'kept' && rs !== 'killed' && !rating) return null;
  const chip = (bg, txt) => (
    <span style={{ ...sx('display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;border-radius:5px;padding:1px 5px'), background: bg, color: 'var(--void)' }}>{txt}</span>
  );
  return (
    <div style={sx('position:absolute;top:5px;left:5px;display:flex;align-items:center;gap:4px')}>
      {rs === 'kept' && chip('var(--ok)', '✓')}
      {rs === 'killed' && chip('var(--danger)', '✕')}
      {rating ? <span style={{ ...sx('font-size:9px'), color: 'var(--accent)', fontFamily: MONO }}>{'★'.repeat(rating)}</span> : null}
    </div>
  );
}

// A pulsing status pill (queued/running) or a plain one (done/failed).
function StatusPill({ status }) {
  const s = String(status || 'queued');
  const tone = STATUS_TONE[s] || 'var(--fg-muted)';
  const pulsing = s === 'queued' || s === 'running';
  return (
    <span style={{ ...sx('display:inline-flex;align-items:center;gap:5px;font-size:9.5px;font-weight:700;border-radius:5px;padding:2px 8px'), color: tone, border: '1px solid ' + tone + '55' }}>
      <span style={{ width: 5, height: 5, borderRadius: 99, background: tone, ...(pulsing ? { animation: 'dl-pulse 1.4s infinite' } : {}) }} />
      {s}
    </span>
  );
}

function ActionChip({ label, onClick, disabled, primary }) {
  return (
    <span onClick={() => !disabled && onClick()} className={primary ? 'hBtnAccent' : 'hBd'}
      style={{ ...sx('font-size:10.5px;font-weight:700;border-radius:7px;padding:5px 12px;cursor:pointer'),
        ...(primary ? { background: 'var(--accent)', color: 'var(--on-accent)' } : { border: '1px solid var(--border-2)', color: 'var(--fg-soft)' }),
        pointerEvents: disabled ? 'none' : 'auto', opacity: disabled ? 0.5 : 1 }}>
      {label}
    </span>
  );
}

// Navigate the app to a generation's Review view (the triage grid). openProj resets genView to
// 'compose', so flip it to 'review' immediately after — landing the filmmaker on the candidate grid.
function openInReview(ctx, pid) {
  const app = ctx?.app;
  if (!app || !pid) return;
  app.openProj?.(pid, 'generate');
  app.setState?.({ genView: 'review' });
}

// ── single generation card ──
class GenerationCard extends React.Component {
  state = { busy: false, lightbox: false, splitting: false };
  componentDidMount() {
    // A just-started generation may not be in the last-synced app state yet; hasten the first read.
    if (!this.gen()) { try { this.props.ctx?.app?.sync?.(); } catch { /* best-effort */ } }
  }
  pid() { return dirPid(this.props.directive, this.props.ctx); }
  gen() {
    const id = genIds(this.props.directive)[0];
    if (!id) return null;
    return projGens(this.props.ctx, this.pid()).find(g => String(g.id) === id) || null;
  }
  act(fn, okMsg, okTone) {
    const app = this.props.ctx?.app;
    this.setState({ busy: true });
    Promise.resolve(fn())
      .then(() => { app?.sync?.(); if (okMsg) app?.showToast?.(okMsg, okTone || 'var(--ok)'); })
      .catch(e => app?.showToast?.((e && e.message) || 'Action failed', 'var(--danger)'))
      .finally(() => this.setState({ busy: false }));
  }
  render() {
    const g = this.gen();
    const pid = this.pid();
    const id = genIds(this.props.directive)[0];
    if (!id) return <CardShell label="generation" tone="var(--danger)"><span style={sx('font-size:11.5px;color:var(--fg-muted)')}>no generation id in directive</span></CardShell>;
    if (!g) return <CardShell label="generation"><span style={sx('font-size:11.5px;color:var(--fg-muted)')}>Starting generation… ({id})</span></CardShell>;

    const status = String(g.status || 'queued');
    const kind = kindOfGen(g);
    const done = status === 'done' && g.file;
    const failed = status === 'failed';
    const src = done ? api.renderUrl(pid, g.file) : null;
    const meta = [modelName(g.model), kind, g.aspect].filter(Boolean).join(' · ');

    return (
      <CardShell label="generation" tone={STATUS_TONE[status] || 'var(--accent)'}
        right={<span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>{costLabel(g)}</span>}>
        <div style={sx('display:flex;gap:12px')}>
          <div style={{ ...sx('flex:none;width:120px;border-radius:8px;overflow:hidden;background:var(--sunk);display:flex;align-items:center;justify-content:center'), aspectRatio: aspectCss(g.aspect) }}>
            {done
              ? <RenderMedia src={src} kind={kind} fit="cover" hoverPlay={kind === 'video'}
                  onClick={() => this.setState({ lightbox: true })}
                  style={{ ...sx('width:100%;height:100%;cursor:zoom-in') }} />
              : <StatusPill status={status} />}
          </div>
          <div style={sx('flex:1;min-width:0')}>
            <div style={sx('display:flex;align-items:center;gap:8px')}>
              <StatusPill status={status} />
              <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>{g.shot ? '· ' + g.shot : ''}</span>
            </div>
            {meta ? <div style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)', marginTop: 6 }}>{meta}</div> : null}
            {g.prompt ? <div style={sx('font-size:11.5px;color:var(--fg-soft);margin-top:6px;line-height:1.5')}>{String(g.prompt).slice(0, 200)}</div> : null}
            {failed && g.error ? <div style={sx('font-size:11px;color:var(--danger);margin-top:7px;line-height:1.5')}>{String(g.error).slice(0, 200)}</div> : null}
          </div>
        </div>

        {done && (
          <div style={sx('display:flex;align-items:center;gap:10px;margin-top:11px')}>
            <ReviewControls g={g} busy={this.state.busy}
              onReview={p => { const [m, t] = reviewToast(p); this.act(() => api.reviewCandidate(pid, g.id, { patch: p }), m, t); }} />
          </div>
        )}

        <div style={sx('display:flex;align-items:center;flex-wrap:wrap;gap:9px;margin-top:11px')}>
          {done && <ActionChip primary label="Open in review" onClick={() => openInReview(this.props.ctx, pid)} disabled={!pid} />}
          {done && g.shot && <ActionChip label="Save to shot" disabled={this.state.busy}
            onClick={() => this.act(() => api.saveGenToShot(pid, g.id, g.shot), 'Kept for ' + g.shot)} />}
          {done && <ActionChip label="Reroll" disabled={this.state.busy}
            onClick={() => this.act(() => api.rerollCandidate(pid, g.id, {}), 'Reroll queued', 'var(--accent)')} />}
          {/* Split — only for a finished still, and only when the grid-splitter chat tool is enabled
              (same enablement oracle the directive card gates on; hidden entirely when off). */}
          {done && kind === 'image' && isToolEnabled(this.props.ctx, 'grid-splitter') &&
            <ActionChip label={this.state.splitting ? 'Close split' : 'Split'}
              onClick={() => this.setState(s => ({ splitting: !s.splitting }))} />}
          {failed && <ActionChip primary label={this.state.busy ? 'Retrying…' : 'Retry'} disabled={this.state.busy}
            onClick={() => this.act(() => api.rerollCandidate(pid, g.id, {}), 'Retry queued', 'var(--accent)')} />}
        </div>

        {done && this.state.splitting && (
          <div style={sx('margin-top:11px;border-top:1px solid var(--border);padding-top:11px')}>
            <SplitFlow pid={pid} genId={g.id} ctx={this.props.ctx} />
          </div>
        )}

        {this.state.lightbox && done && (
          <RenderLightbox src={src} kind={kind} keyboard onClose={() => this.setState({ lightbox: false })}
            caption={<span style={sx('font-size:11px;color:var(--fg-muted)')}>{modelName(g.model)} · {costLabel(g)}</span>} />
        )}
      </CardShell>
    );
  }
}

// ── batch / multi-variant grid card ── ONE compact grid, not N cards; each cell opens the shared lightbox ──
class GenerationGridCard extends React.Component {
  state = { busy: false, lightIx: -1 };
  componentDidMount() { if (!this.gens().length) { try { this.props.ctx?.app?.sync?.(); } catch { /* */ } } }
  pid() { return dirPid(this.props.directive, this.props.ctx); }
  gens() {
    const pid = this.pid();
    const all = projGens(this.props.ctx, pid);
    const bid = batchId(this.props.directive);
    if (bid) {
      // newest-in-batch stable ordering by variant index then start time
      return all.filter(g => g.batchId === bid)
        .sort((a, b) => (a.variantIndex ?? 0) - (b.variantIndex ?? 0) || (a.started || 0) - (b.started || 0));
    }
    const ids = genIds(this.props.directive);
    const byId = new Map(all.map(g => [String(g.id), g]));
    return ids.map(id => byId.get(id)).filter(Boolean);
  }
  // the media cells (done, with a file), in display order — the lightbox navigates across these
  mediaCells() {
    const pid = this.pid();
    return this.gens().filter(g => g.status === 'done' && g.file)
      .map(g => ({ g, src: api.renderUrl(pid, g.file), kind: kindOfGen(g) }));
  }
  act(fn, okMsg, okTone) {
    const app = this.props.ctx?.app;
    this.setState({ busy: true });
    Promise.resolve(fn())
      .then(() => { app?.sync?.(); if (okMsg) app?.showToast?.(okMsg, okTone || 'var(--ok)'); })
      .catch(e => app?.showToast?.((e && e.message) || 'Action failed', 'var(--danger)'))
      .finally(() => this.setState({ busy: false }));
  }
  navLight(dir) {
    const cells = this.mediaCells();
    if (!cells.length) return;
    this.setState(s => ({ lightIx: (s.lightIx + dir + cells.length) % cells.length }));
  }
  // "Review these" — open the review inbox scoped to exactly this batch's done candidates. Reuses the
  // inbox's own candidate-key model (an explicit key list = a scoped session), so triage there writes
  // the same reviewState/rating records this card reads; the outcome summary reflects it on return.
  openBatchReview() {
    const app = this.props.ctx?.app, pid = this.pid();
    const keys = this.gens().filter(g => g.status === 'done' && g.file).map(g => ({ pid, kind: 'gen', id: g.id }));
    if (!app || !pid || !keys.length) { app?.showToast?.('Nothing to review yet', 'var(--accent)'); return; }
    if (app.openInbox) app.openInbox(pid, { keys });
    else openInReview(this.props.ctx, pid);   // graceful fallback if the host predates scoped inbox
  }
  render() {
    const pid = this.pid();
    const gens = this.gens();
    const bid = batchId(this.props.directive);
    if (!gens.length) return <CardShell label="batch"><span style={sx('font-size:11.5px;color:var(--fg-muted)')}>Queuing variants…{bid ? ' (' + bid + ')' : ''}</span></CardShell>;

    const done = gens.filter(g => g.status === 'done').length;
    const failed = gens.filter(g => g.status === 'failed').length;
    const running = gens.filter(g => g.status === 'queued' || g.status === 'running').length;
    // triage outcome from the records (same reviewState the inbox writes) — kept n / rejected m
    const kept = gens.filter(g => g.reviewState === 'kept').length;
    const rejected = gens.filter(g => g.reviewState === 'killed').length;
    const triaged = kept + rejected;
    // cost from the ledgered per-gen figures (the exact numbers ledger() logged), summed
    const spend = gens.reduce((s, g) => s + (g.status === 'done' && typeof g.cost === 'number' ? g.cost : 0), 0);
    const cells = this.mediaCells();
    const model = modelName(gens[0]?.model);
    const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(gens.length))));

    const lightCell = this.state.lightIx >= 0 ? cells[this.state.lightIx] : null;
    return (
      <CardShell label="batch" tone={failed ? 'var(--danger)' : running ? '#5B9DFF' : 'var(--ok)'}
        right={<span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>${spend.toFixed(3)}</span>}>
        <div style={sx('display:flex;align-items:center;gap:8px;margin-bottom:9px')}>
          <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--fg-soft)' }}>{done}/{gens.length} done</span>
          {running ? <span style={{ fontFamily: MONO, fontSize: 9.5, color: '#5B9DFF' }}>· {running} running</span> : null}
          {failed ? <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--danger)' }}>· {failed} failed</span> : null}
          {triaged ? <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-muted)' }}>· kept {kept} / rejected {rejected}</span> : null}
          <span style={sx('margin-left:auto')}><span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>{model}</span></span>
        </div>
        <div style={{ ...sx('display:grid;gap:6px'), gridTemplateColumns: 'repeat(' + cols + ',1fr)' }}>
          {gens.map((g, i) => {
            const cellDone = g.status === 'done' && g.file;
            const ix = cells.findIndex(c => c.g.id === g.id);
            return (
              <RenderTile key={g.id} aspect={aspectCss(g.aspect)}
                src={cellDone ? api.renderUrl(pid, g.file) : null}
                kind={kindOfGen(g)} hoverPlay={kindOfGen(g) === 'video'}
                onClick={() => cellDone && this.setState({ lightIx: ix })}
                placeholder={<StatusPill status={g.status} />}
                overlay={cellDone ? <DecisionBadge g={g} /> : null}
                footer={cellDone ? (
                  <div style={sx('display:flex;align-items:center;justify-content:center;padding:5px 4px;background:var(--ink);border-top:1px solid var(--surface-2)')}>
                    <ReviewControls g={g} busy={this.state.busy} compact
                      onReview={p => { const [m, t] = reviewToast(p); this.act(() => api.reviewCandidate(pid, g.id, { patch: p }), m, t); }} />
                  </div>
                ) : null}
                title={g.prompt ? String(g.prompt).slice(0, 120) : g.id} />
            );
          })}
        </div>
        <div style={sx('display:flex;align-items:center;flex-wrap:wrap;gap:9px;margin-top:11px')}>
          <ActionChip primary label="Review these" onClick={() => this.openBatchReview()} disabled={!pid || !done} />
          <ActionChip label="Open in review" onClick={() => openInReview(this.props.ctx, pid)} disabled={!pid} />
          {failed > 0 && bid && <ActionChip label={this.state.busy ? 'Retrying…' : 'Retry failed'} disabled={this.state.busy}
            onClick={() => this.act(() => api.retryBatch(bid, false), 'Retrying ' + failed + ' failed', 'var(--accent)')} />}
          {failed > 0 && !bid && <ActionChip label={this.state.busy ? 'Retrying…' : 'Retry failed'} disabled={this.state.busy}
            onClick={() => this.act(() => Promise.all(gens.filter(g => g.status === 'failed').map(g => api.rerollCandidate(pid, g.id, {}))), 'Retry queued', 'var(--accent)')} />}
        </div>

        {lightCell && (
          <RenderLightbox src={lightCell.src} kind={lightCell.kind} keyboard
            onClose={() => this.setState({ lightIx: -1 })} onNav={d => this.navLight(d)}
            caption={<span style={sx('font-size:11px;color:var(--fg-muted)')}>{model} · {this.state.lightIx + 1}/{cells.length}</span>} />
        )}
      </CardShell>
    );
  }
}

// One dispatcher for every generation directive alias: a batch id, or more than one ref, → the grid
// card; a single ref → the single card. Registered under both `generation`/`show.generation`/
// `progress.generation` (single) and `generation.batch`/`show.batch`/`progress.batch`/`batch` (grid),
// but the shape — not the type string — makes the final single-vs-grid call, so a mislabelled envelope
// still renders correctly.
function renderGenerationDirective(directive, ctx) {
  const type = String((directive && (directive.type || directive.kind || directive.category)) || '');
  const isBatch = !!batchId(directive) || genIds(directive).length > 1 || /batch/i.test(type);
  return isBatch
    ? <GenerationGridCard directive={directive} ctx={ctx} />
    : <GenerationCard directive={directive} ctx={ctx} />;
}

for (const t of [
  'generation', 'show.generation', 'progress.generation', 'generation.show', 'gen',
  'generation.batch', 'show.batch', 'progress.batch', 'batch', 'batch.show', 'batch.progress'
]) registerDirectiveRenderer(t, renderGenerationDirective);

export { GenerationCard, GenerationGridCard, renderGenerationDirective };
