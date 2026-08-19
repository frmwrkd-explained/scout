// Review Inbox (Phase 5) — the operational center of FrameForge. One global, keyboard-first queue of
// candidates that are ACTUALLY unreviewed (completed generations with reviewState 'new', plus legacy
// `st:new` items). No "review-all" fallback: an empty queue shows a real zero state. All keyboard
// handling lives in App.onKey (page === 'inbox'); this component renders the current candidate, the
// context header, the section counts, and the note/route popovers.
import React from 'react';
import { sx } from './sx.js';
import { api } from './api.js';
import { MONO } from './tokens';

const G = 'linear-gradient(130deg,var(--on-accent),var(--raise) 60%,var(--border-2))';

export default class ReviewInbox extends React.Component {
  mediaFor(cand) {
    if (!cand) return null;
    if (cand.kind === 'gen') {
      if (!cand.file) return null;
      return { url: api.renderUrl(cand.proj, cand.file), video: /\.mp4$/i.test(cand.file) };
    }
    const v = (cand.versions || []).filter(x => x.file).slice(-1)[0];
    if (v && v.file) return { url: api.renderUrl(cand.proj, v.file), video: cand.type === 'clip' };
    return null;
  }
  projName(pid) { const p = this.props.app.state.projects.find(x => x.id === pid); return p ? p.name : pid; }

  render() {
    const app = this.props.app;
    const IB = app.state.inbox;
    if (!IB) return null;
    const sections = app.inboxSections();
    const total = IB.keys.length;
    const done = IB.ix >= total;
    const cand = done ? null : app.inboxCandidate(IB.keys[IB.ix]);
    const activeLock = (app.state.activeStyleLocks || {})[cand ? cand.proj : ''];

    const selCount = Object.keys(IB.selected || {}).length;
    const againLabel = IB.lastCmd ? (IB.lastCmd.type === 'decide' ? IB.lastCmd.kind : IB.lastCmd.type === 'rate' ? 'rate ' + IB.lastCmd.r : IB.lastCmd.type === 'route' ? 'route → ' + IB.lastCmd.target : IB.lastCmd.type) : null;
    return (
      <div style={sx('position:fixed;inset:0;z-index:60;background:var(--void);display:flex;flex-direction:column')}>
        {this.header(app, IB, sections, total, cand, activeLock)}
        {(selCount > 0 || againLabel) && (
          <div style={sx('flex:none;display:flex;align-items:center;gap:16px;padding:5px 22px;background:var(--surface);border-bottom:1px solid var(--surface-2)')}>
            {/* multi-select is the marked channel (#5B9DFF), not the accent */}
            {selCount > 0 && <span style={{ ...sx('font-size:10.5px'), color: '#5B9DFF', fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>{selCount} selected · apply k/x/1–5/a to all · Esc clears</span>}
            {againLabel && <span style={{ ...sx('font-size:10.5px;color:var(--fg-faint);margin-left:auto'), fontFamily: MONO }}>Again (.): {againLabel}</span>}
          </div>
        )}
        <div style={sx('flex:1;display:flex;overflow:hidden')}>
          <div style={sx('flex:1;display:flex;align-items:center;justify-content:center;position:relative;padding:24px')}>
            {done ? this.summary(app, IB, sections) : this.stage(app, IB, cand)}
          </div>
          {this.sidebar(app, sections)}
        </div>
        {!done && app.state.settings.showHints && this.hints(app)}
        {IB.noteOpen && this.notePopover(app, IB, cand)}
        {IB.routeOpen && this.routePopover(app, cand)}
      </div>
    );
  }

  header(app, IB, sections, total, cand, activeLock) {
    const pos = Math.min(IB.ix + 1, total);
    const cell = (label, value) => (
      <div style={sx('display:flex;flex-direction:column;gap:2px;min-width:0')}>
        <div style={{ ...sx('font-size:8.5px;letter-spacing:.14em;color:var(--fg-faint);text-transform:uppercase') }}>{label}</div>
        <div style={{ ...sx('font-size:11px;color:var(--fg-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px'), fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>{value || '—'}</div>
      </div>
    );
    return (
      <div style={sx('flex:none;display:flex;align-items:center;gap:20px;height:56px;padding:0 22px;border-bottom:1px solid var(--border);background:var(--ink)')}>
        <div style={sx('display:flex;align-items:center;gap:9px')}>
          <span style={{ ...sx('font-weight:800;font-size:13px;letter-spacing:.2em;color:var(--fg-muted)') }}>INBOX</span>
          {/* a count is a figure, not a call to action — raised chip, not an accent fill */}
          <span style={{ ...sx('font-size:11px;color:var(--fg);background:var(--raise);border:1px solid var(--border-3);border-radius:20px;padding:2px 9px;font-weight:800'), fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>{total}</span>
        </div>
        <div style={sx('display:flex;align-items:center;gap:22px;flex:1;overflow:hidden')}>
          {cell('Project', cand ? this.projName(cand.proj) : '')}
          {cell('Shot', cand ? (cand.shot || (cand.kind === 'item' ? cand.label : '—')) : '')}
          {cell('Model', cand ? (cand.model || cand.type || '') : '')}
          {cell('Style lock', activeLock ? activeLock.name : '')}
          {cell('Cost', cand ? '$' + Number(cand.cost || 0).toFixed(3) : '')}
          {cell('Reviewed', '$' + Number(IB.spend || 0).toFixed(2))}
          {cell('Position', total ? pos + ' / ' + total : '0')}
        </div>
        <div onClick={() => app.exitInbox('paused')} className="hBd" style={sx('font-size:10.5px;color:var(--fg-faint);border:1px solid var(--border-2);border-radius:8px;padding:6px 12px;cursor:pointer')}>Esc · pause</div>
      </div>
    );
  }

  stage(app, IB, cand) {
    if (!cand) return <div style={{ ...sx('color:var(--fg-faint);font-size:10.5px;font-weight:700;letter-spacing:.14em'), fontFamily: MONO }}>CANDIDATE UNAVAILABLE — REVIEWED ELSEWHERE</div>;
    const media = this.mediaFor(cand);
    const decided = IB.decisions[app.keyStr(IB.keys[IB.ix])];
    const selected = !!(IB.selected || {})[app.keyStr(IB.keys[IB.ix])];
    // marked-for-bulk rides the #5B9DFF channel; the accent stays reserved for actions
    const border = selected ? '#5B9DFF' : decided ? (decided.kind === 'kill' ? 'var(--danger)' : 'var(--ok)') : 'var(--border)';
    // image-first: no prompt text below the stage — the frame gets the full viewport
    const MW = 'min(88vw,1400px)', MH = '78vh';
    return (
      <div style={sx('display:flex;flex-direction:column;align-items:center;gap:12px;max-width:100%;max-height:100%')}>
        <div style={{ ...sx('position:relative;border-radius:12px;overflow:hidden;display:flex;align-items:center;justify-content:center'), maxWidth: MW, maxHeight: MH, background: G, border: '1.5px solid ' + border, boxShadow: selected ? '0 0 0 2px rgba(91,157,255,.25)' : 'none' }}>
          {media
            ? (media.video
              ? <video key={media.url} src={media.url} autoPlay={IB.playing} loop muted playsInline style={{ ...sx('display:block'), maxWidth: MW, maxHeight: MH }} />
              : <img key={media.url} src={media.url} alt="" style={{ ...sx('display:block;object-fit:contain'), maxWidth: MW, maxHeight: MH }} />)
            : <div style={{ ...sx('width:520px;height:300px;display:flex;align-items:center;justify-content:center;color:var(--fg-faint);font-size:10px;font-weight:700;letter-spacing:.14em'), fontFamily: MONO }}>{cand.kind === 'item' ? 'LEGACY ITEM — NO RENDER FILE' : 'NO MEDIA'}</div>}
          {cand.rating > 0 && <div style={{ ...sx('position:absolute;top:10px;right:12px;font-size:12px;color:var(--accent)'), fontFamily: MONO }}>{'★'.repeat(cand.rating)}</div>}
          {/* decision reads as a badge, not just a border tint */}
          {decided && (
            <div style={{ ...sx('position:absolute;top:10px;left:12px;font-size:10px;font-weight:800;color:var(--void);border-radius:6px;padding:2px 8px'), background: decided.kind === 'kill' ? 'var(--danger)' : 'var(--ok)' }}>
              {decided.kind === 'kill' ? 'KILLED ✕' : decided.kind === 'final' ? 'FINAL ✓' : 'KEPT ✓'}
            </div>
          )}
          {!decided && cand.final && <div style={sx('position:absolute;top:10px;left:12px;font-size:10px;font-weight:800;color:var(--void);background:var(--ok);border-radius:6px;padding:2px 8px')}>FINAL</div>}
        </div>
      </div>
    );
  }

  summary(app, IB, sections) {
    const dec = Object.values(IB.decisions);
    const kept = dec.filter(d => d.kind === 'keep' || d.kind === 'final').length;
    const killed = dec.filter(d => d.kind === 'kill').length;
    const btn = (label, onClick, color) => (
      <div onClick={onClick} className="hBd" style={{ ...sx('padding:10px 18px;border-radius:9px;cursor:pointer;font-weight:700;font-size:12px'), border: '1px solid var(--border-2)', color: color || 'var(--fg-soft)' }}>{label}</div>
    );
    return (
      <div style={sx('display:flex;flex-direction:column;align-items:center;gap:22px;text-align:center')}>
        <div style={{ ...sx('font-size:44px;color:var(--accent)'), fontFamily: MONO }}>✓</div>
        <div style={sx('font-size:16px;color:var(--fg);font-weight:700')}>Inbox clear</div>
        <div style={{ ...sx('font-size:12px;color:var(--fg-muted)'), fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
          {kept} kept · {killed} killed · {dec.length} reviewed · <span style={{ color: 'var(--sand)' }}>${Number(IB.spend || 0).toFixed(2)}</span> spend
        </div>
        <div style={sx('display:flex;gap:12px;flex-wrap:wrap;justify-content:center')}>
          {sections.failed.length > 0 && btn(sections.failed.length + ' failed generations', () => { app.exitInbox('completed'); app.go('home'); }, 'var(--danger)')}
          {sections.readyForEdit.length > 0 && btn(sections.readyForEdit.length + ' ready for edit', () => app.exitInbox('completed'), 'var(--ok)')}
          {btn('Generate more', () => { app.exitInbox('completed'); const p = app.state.projects[0]; if (p) app.openProj(p.id, 'generate'); })}
          {btn('Done', () => app.exitInbox('completed'), 'var(--accent)')}
        </div>
      </div>
    );
  }

  sidebar(app, sections) {
    const row = (label, n, color) => (
      <div style={sx('display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--surface-2)')}>
        <span style={{ ...sx('font-size:11px'), color: n ? 'var(--fg-soft)' : 'var(--fg-faint)' }}>{label}</span>
        <span style={{ ...sx('font-size:11px;min-width:22px;text-align:right'), fontFamily: MONO, fontVariantNumeric: 'tabular-nums', color: color && n ? color : 'var(--fg-faint)' }}>{n}</span>
      </div>
    );
    return (
      <div style={sx('flex:none;width:238px;border-left:1px solid var(--border);padding:18px 18px;overflow-y:auto;background:var(--ink)')}>
        <div style={sx('font-size:9px;letter-spacing:.16em;color:var(--fg-faint);text-transform:uppercase;margin-bottom:8px')}>Queues</div>
        {row('New candidates', sections.newGens.length + sections.newItems.length, 'var(--accent)')}
        {row('Failed generations', sections.failed.length, 'var(--danger)')}
        {row('Kept · unassigned', sections.keptUnassigned.length, 'var(--ok)')}
        {row('Ready for edit', sections.readyForEdit.length, 'var(--ok)')}
        {row('Paused sessions', sections.pausedSessions.length, 'var(--fg-soft)')}
      </div>
    );
  }

  hints(app) {
    const hint = (k, l) => (
      <div style={sx('display:flex;align-items:center;gap:6px')}>
        <span style={{ ...sx('font-size:9.5px;border:1px solid var(--border-2);border-radius:4px;padding:1px 6px;color:var(--fg-muted)'), fontFamily: MONO }}>{k}</span>
        <span style={sx('font-size:10px;color:var(--fg-faint)')}>{l}</span>
      </div>
    );
    return (
      <div style={sx('flex:none;display:flex;justify-content:center;gap:14px;flex-wrap:wrap;padding:12px 20px;border-top:1px solid var(--surface-2)')}>
        {hint('K', 'keep')}{hint('X', 'kill')}{hint('1–5', 'rate')}{hint('L', 'final')}{hint('N', 'note→reroll')}{hint('R', 'reroll')}{hint('A', 'route')}{hint('P', 'prompt')}{hint('→', 'skip')}{hint('U', 'undo')}
      </div>
    );
  }

  notePopover(app, IB, cand) {
    return (
      <div style={sx('position:absolute;left:50%;bottom:120px;transform:translateX(-50%);width:560px;padding:14px;border-radius:12px;background:var(--surface-2);border:1px solid var(--accent-60);box-shadow:0 20px 60px rgba(0,0,0,.7);z-index:5')}>
        <div style={sx('font-size:10.5px;font-weight:700;letter-spacing:.12em;color:var(--fg-muted);margin-bottom:8px')}>NOTE → RE-ROLL <span style={sx('font-weight:400;color:var(--fg-faint);letter-spacing:0;margin-left:6px')}>saved on the candidate, then a reroll is queued</span></div>
        <textarea autoFocus value={IB.noteText} onChange={e => app.ibPatch({ noteText: e.target.value })}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); app.ibNote(IB.noteText); }
            else if (e.key === 'Escape') app.ibPatch({ noteOpen: false });
          }}
          style={{ ...sx('width:100%;height:70px;background:var(--ink);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);padding:9px;resize:none;font-size:12px'), fontFamily: MONO }} />
      </div>
    );
  }

  routePopover(app, cand) {
    const opt = (key, label, sub) => (
      <div style={sx('display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px')} className="hBg">
        <span style={{ ...sx('font-size:10px;border:1px solid var(--border-2);border-radius:4px;padding:1px 7px;color:var(--accent)'), fontFamily: MONO }}>{key}</span>
        <span style={sx('font-size:12px;color:var(--fg-soft)')}>{label}</span>
        <span style={sx('font-size:10px;color:var(--fg-faint);margin-left:auto')}>{sub}</span>
      </div>
    );
    return (
      <div style={sx('position:absolute;left:50%;bottom:120px;transform:translateX(-50%);width:420px;padding:12px;border-radius:12px;background:var(--surface-2);border:1px solid var(--border-2);box-shadow:0 20px 60px rgba(0,0,0,.7);z-index:5')}>
        <div style={sx('font-size:10.5px;font-weight:700;letter-spacing:.12em;color:var(--fg-muted);margin-bottom:8px')}>ROUTE / SEND</div>
        {cand && cand.shot && opt('S', 'Keep & select for ' + cand.shot, 'shot')}
        {opt('B', 'Send to project board', 'context/selects')}
        {opt('L', 'Promote to global library', 'reusable asset')}
        <div style={sx('font-size:9.5px;color:var(--fg-faint);margin-top:8px')}>Esc to cancel</div>
      </div>
    );
  }
}
