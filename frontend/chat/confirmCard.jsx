// Pre-flight confirm card (ticket 22). A batch above the router skill's money-gate threshold is NOT
// fired immediately — the agent emits a `confirm.batch` directive (SKILL.md's core `confirm` category,
// `<category>.<event>` grammar), and THIS card renders the estimate BEFORE anything runs:
//
//     "9 storyboard frames on <preview model> ≈ $x — proceed?"   [ Proceed ] [ Decline ]
//
// Confirm envelopes are a CORE chat capability (the money gate is universal, rule 6 — no pack overrides
// it), so this registers DIRECTLY via registerDirectiveRenderer, exactly like the core generation card
// — never through the gated chat-tools registry.
//
//  · Proceed  → api.createBatch(payload + this session's id) then swaps IN PLACE to the live batch grid
//               card (ticket 14 shapes), which reads the queued candidates straight out of app state.
//  · Decline  → runs NOTHING and tells the agent so: appends a compact system event ("Declined: …")
//               through the existing chat seam (api.chatSystemEvent) so the agent sees it next turn.
//
// The directive carries the batch REQUEST (ids + settings), never restated prose. The estimate uses the
// existing server route (POST /api/batches/estimate) so the number the user confirms is the number the
// server will compute, with the catalog estCost as a hermetic fallback.
import React from 'react';
import { sx } from '../sx';
import { api } from '../api';
import { registerDirectiveRenderer, CardShell as Shell } from './directives';
import { GenerationGridCard } from './generationCards';
import { estCost, modelById, maxRefs } from '../models';
import { MONO } from '../tokens';

const modelName = m => (modelById(m)?.label) || m || 'model';
const dirPid = (d, ctx) => d.project || d.pid || (ctx || {}).pid || null;

// The batch request the directive describes. The agent addresses the batch route's own body fields; we
// accept the obvious aliases so a slightly-different envelope still queues the right batch.
function batchPayload(d) {
  const shots = d.shotIds || d.shots || d.shot || [];
  const shotIds = (Array.isArray(shots) ? shots : (shots != null ? [shots] : [])).map(String).filter(Boolean);
  const variantCount = Number(d.variantCount ?? d.variants ?? d.n ?? d.count ?? 1) || 1;
  return {
    prompt: String(d.prompt || ''),
    model: String(d.model || ''),
    shotIds,
    variantCount,
    aspect: d.aspect || '16:9',
    resolution: d.resolution || undefined,
    refs: Array.isArray(d.refs) ? d.refs.slice(0, maxRefs(String(d.model || ''))) : [],
    styleLockFragment: d.styleLockFragment || '',
    baseSeed: d.baseSeed ?? d.seed ?? null,
    maxSpend: d.maxSpend ?? null,
    params: (d.params && typeof d.params === 'object' && !Array.isArray(d.params)) ? d.params : null
  };
}
// candidate count = (shots or 1) × variants — matches batches.estimateBatch exactly.
function candidateCount(p) { return (p.shotIds.length || 1) * p.variantCount; }
// Local estimate (hermetic fallback): the same math the server runs, from the catalog per-model cost.
function localEstimate(p) { const per = estCost(p.model); return { candidates: candidateCount(p), estPerCandidate: per, estimatedCost: per * candidateCount(p) }; }

function Btn({ label, onClick, disabled, primary, danger }) {
  const base = primary ? { background: 'var(--accent)', color: 'var(--on-accent)' }
    : danger ? { border: '1px solid rgba(240,91,84,.5)', color: 'var(--danger)' }
      : { border: '1px solid var(--border-2)', color: 'var(--fg-soft)' };
  return (
    <span onClick={() => !disabled && onClick()} className={primary ? 'hBtnAccent' : 'hBd'}
      style={{ ...sx('font-size:10.5px;font-weight:700;border-radius:7px;padding:5px 13px;cursor:pointer'), ...base,
        pointerEvents: disabled ? 'none' : 'auto', opacity: disabled ? 0.5 : 1 }}>{label}</span>
  );
}

class ConfirmBatchCard extends React.Component {
  state = { est: null, loading: true, busy: false, decision: null, batchId: null, err: null };

  componentDidMount() {
    const p = batchPayload(this.props.directive);
    // Prefer the server estimate so the confirmed figure equals what the queue will compute; fall back
    // to the catalog estimate if the route is unreachable (keeps the card useful and tests hermetic).
    api.estimateBatch({ model: p.model, shotIds: p.shotIds, variantCount: p.variantCount })
      .then(est => this.setState({ est: est && typeof est.estimatedCost === 'number' ? est : localEstimate(p), loading: false }))
      .catch(() => this.setState({ est: localEstimate(p), loading: false }));
  }
  pid() { return dirPid(this.props.directive, this.props.ctx); }
  sessionId() { const s = (this.props.ctx || {}).session; return s ? s.id : null; }

  proceed() {
    const p = batchPayload(this.props.directive);
    const pid = this.pid();
    const app = this.props.ctx?.app;
    if (!pid || !p.model) { app?.showToast?.('Cannot queue — missing project or model', 'var(--danger)'); return; }
    this.setState({ busy: true });
    api.createBatch({ pid, sessionId: this.sessionId() || undefined, ...p })
      .then(batch => {
        this.setState({ decision: 'proceeded', batchId: batch.id, busy: false });
        app?.sync?.();
        app?.showToast?.('Batch queued — ' + (this.state.est?.candidates || candidateCount(p)) + ' frames', 'var(--accent)');
      })
      .catch(e => { this.setState({ busy: false }); app?.showToast?.('Could not queue — ' + (e.message || ''), 'var(--danger)'); });
  }
  decline() {
    const p = batchPayload(this.props.directive);
    const app = this.props.ctx?.app;
    const id = this.sessionId();
    const est = this.state.est || localEstimate(p);
    // Tell the agent so — a compact system event on this session (existing seam). Runs NOTHING.
    const note = 'Declined: ' + (est.candidates || candidateCount(p)) + ' frames on ' + modelName(p.model)
      + ' (~$' + Number(est.estimatedCost || 0).toFixed(3) + ') — not queued.';
    this.setState({ decision: 'declined', busy: true });
    const done = () => { this.setState({ busy: false }); app?.showToast?.('Declined — nothing was queued', 'var(--fg-muted)'); };
    if (id) api.chatSystemEvent(id, note).then(done).catch(done); else done();
  }

  render() {
    const p = batchPayload(this.props.directive);
    const { est, loading, busy, decision, batchId } = this.state;
    const pid = this.pid();

    // Proceeded → this card becomes the live batch grid (ticket 14), reading the queued candidates.
    if (decision === 'proceeded' && batchId) {
      return <GenerationGridCard directive={{ type: 'generation.batch', batch: batchId, project: pid }} ctx={this.props.ctx} />;
    }
    if (decision === 'declined') {
      return (
        <Shell label="estimate · declined" tone="var(--fg-muted)">
          <span style={sx('font-size:11.5px;color:var(--fg-muted)')}>Declined — nothing was queued.</span>
        </Shell>
      );
    }

    const n = est ? est.candidates : candidateCount(p);
    const total = est ? est.estimatedCost : 0;
    return (
      <Shell label="estimate · confirm"
        right={<span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>{loading ? '…' : '≈ $' + Number(total || 0).toFixed(3)}</span>}>
        <div style={sx('font-size:12.5px;color:var(--fg);line-height:1.55')}>
          <b>{n}</b> {n === 1 ? 'frame' : 'frames'} on <b>{modelName(p.model)}</b>
          {loading ? ' — estimating…' : <> ≈ <b>${Number(total || 0).toFixed(3)}</b></>}
          {p.maxSpend != null ? <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)' }}> · cap ${Number(p.maxSpend).toFixed(2)}</span> : null}
        </div>
        {p.prompt ? <div style={sx('font-size:11px;color:var(--fg-muted);margin-top:6px;line-height:1.5')}>{String(p.prompt).slice(0, 180)}</div> : null}
        <div style={sx('display:flex;align-items:center;gap:9px;margin-top:11px')}>
          <Btn primary label={busy ? 'Queuing…' : 'Proceed'} disabled={busy || loading || !pid || !p.model} onClick={() => this.proceed()} />
          <Btn danger label="Decline" disabled={busy} onClick={() => this.decline()} />
          {!pid ? <span style={sx('font-size:10px;color:var(--fg-faint)')}>open a project to queue</span> : null}
        </div>
      </Shell>
    );
  }
}

// CORE registration (not a gated tool). The money gate/confirm grammar is universal, so bind the
// router's `confirm.batch` type + the obvious aliases directly. Shape carries the batch request.
for (const t of ['confirm.batch', 'confirm.generation.batch', 'generation.batch.confirm', 'batch.confirm'])
  registerDirectiveRenderer(t, (directive, ctx) => <ConfirmBatchCard directive={directive} ctx={ctx} />);

export { ConfirmBatchCard };
