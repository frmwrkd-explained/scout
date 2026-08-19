// The concrete directive cards (ticket 12). Imported for its side effects by Chat.jsx: each
// registerDirectiveRenderer() call binds a directive `type` to a card component. Anything without a
// registered renderer keeps degrading to the neutral placeholder in ./directives.jsx.
//
// THE CONTRACT: a directive carries ids, never restated prose (router SKILL.md rule 2). Every card
// FETCHES the canonical record by id and renders that — the agent's message is only a pointer. The
// id lives on `directive.ref` (the router grammar's field; may be a single id or an array), with
// `.id` accepted as an alias.
import React from 'react';
import { sx } from '../sx';
import { api } from '../api';
import RenderMedia from '../RenderMedia';
import { registerDirectiveRenderer, CardShell } from './directives';
import { registerToolCard } from './toolRegistry';
import { MONO } from '../tokens';
import './generationCards'; // side effect: registers the core generation + batch-grid directive cards (ticket 14)
import './confirmCard';     // side effect: registers the core confirm.batch pre-flight estimate card (ticket 22)
import './toolCards';       // side effect: registers tool.draft (the builder's proposal) + tool.card (ticket 25)
import './splitCard';       // side effect: registers the grid-splitter tool card (ticket 16)
import './shotBoardCard'; // side effect: registers the shot-board tool card — live board + staged breakdown proposal (ticket 17)

const refId = d => {
  const r = d && (d.ref !== undefined ? d.ref : (d.id !== undefined ? d.id : (d.shot !== undefined ? d.shot : d.style)));
  return Array.isArray(r) ? (r[0] != null ? String(r[0]) : null) : (r != null ? String(r) : null);
};

// ── style-lock card ── name · ref image · axis summary · "set as project style" ──
class StyleLockCard extends React.Component {
  state = { lock: null, loading: true, err: null, setting: false };
  componentDidMount() {
    const id = refId(this.props.directive);
    if (!id) { this.setState({ loading: false, err: 'no style id' }); return; }
    // No single-record route exists; the list route IS the canonical read. Find by id.
    api.styleLocks()
      .then(list => {
        const lock = (Array.isArray(list) ? list : []).find(l => String(l.id) === id) || null;
        this.setState({ lock, loading: false, err: lock ? null : 'style not found' });
      })
      .catch(e => this.setState({ loading: false, err: e.message }));
  }
  currentStyleId() {
    const { app, pid } = this.props.ctx || {};
    try { return (app?.state?.projects || []).find(p => p.id === pid)?.styleLock || null; } catch { return null; }
  }
  setAsProjectStyle() {
    const { app, pid } = this.props.ctx || {};
    const id = refId(this.props.directive);
    if (!pid || !id) return;
    this.setState({ setting: true });
    api.patchProject(pid, { styleLock: id })
      .then(() => { app?.sync?.(); app?.reloadStyleLocks?.(); app?.showToast?.('Project style set — ' + (this.state.lock?.name || id), 'var(--ok)'); this.forceUpdate(); })
      .catch(e => app?.showToast?.('Could not set style — ' + e.message, 'var(--danger)'))
      .finally(() => this.setState({ setting: false }));
  }
  render() {
    const { lock, loading, err, setting } = this.state;
    const { pid } = this.props.ctx || {};
    const id = refId(this.props.directive);
    if (loading) return <CardShell label="style lock"><span style={sx('font-size:11.5px;color:var(--fg-muted)')}>Loading style…</span></CardShell>;
    if (err || !lock) return <CardShell label="style lock" tone="var(--danger)"><span style={sx('font-size:11.5px;color:var(--fg-muted)')}>{err || 'style unavailable'}{id ? ' (' + id + ')' : ''}</span></CardShell>;

    const picks = lock.picks && typeof lock.picks === 'object' ? lock.picks : {};
    const tokens = Object.values(picks).flat().map(String).filter(Boolean).slice(0, 10);
    const isCurrent = this.currentStyleId() === lock.id;
    const meta = [lock.model, lock.aspect].filter(Boolean).join(' · ');
    return (
      <CardShell label="style lock" right={<span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>{lock.id}</span>}>
        <div style={sx('display:flex;gap:12px')}>
          {lock.refImage ? (
            <div style={sx('flex:none;width:96px;border-radius:8px;overflow:hidden;background:var(--sunk)')}>
              <RenderMedia src={api.styleLockRefUrl(lock.id)} kind="image" fit="cover"
                style={{ ...sx('width:100%;display:block'), aspectRatio: '16/9' }} />
            </div>
          ) : null}
          <div style={sx('flex:1;min-width:0')}>
            <div style={sx('font-size:13px;font-weight:700;color:var(--fg)')}>{lock.name || 'Untitled style'}</div>
            {meta ? <div style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)', marginTop: 2 }}>{meta}</div> : null}
            {tokens.length ? (
              <div style={sx('display:flex;flex-wrap:wrap;gap:4px;margin-top:7px')}>
                {tokens.map((t, i) => <span key={i} style={sx('font-size:10px;color:var(--fg-soft);border:1px solid var(--border-2);border-radius:6px;padding:2px 7px;background:var(--surface-2)')}>{t}</span>)}
              </div>
            ) : (lock.fragment ? <div style={sx('font-size:11px;color:var(--fg-muted);margin-top:7px;line-height:1.5')}>{String(lock.fragment).slice(0, 160)}</div> : null)}
          </div>
        </div>
        <div style={sx('display:flex;align-items:center;gap:9px;margin-top:10px')}>
          {isCurrent ? (
            <span style={sx('font-size:10.5px;font-weight:700;color:var(--ok);border:1px solid rgba(63,207,142,.4);border-radius:7px;padding:5px 11px')}>✓ current project style</span>
          ) : (
            <span onClick={() => !setting && this.setAsProjectStyle()} className="hBtnAccent"
              style={{ ...sx('font-size:10.5px;font-weight:700;border-radius:7px;padding:5px 12px;cursor:pointer'), background: pid ? 'var(--accent)' : 'var(--raise)', color: pid ? 'var(--on-accent)' : 'var(--fg-faint)', pointerEvents: pid && !setting ? 'auto' : 'none' }}>
              {setting ? 'Setting…' : 'Set as project style'}
            </span>
          )}
          {!pid ? <span style={sx('font-size:10px;color:var(--fg-faint)')}>open a project to apply</span> : null}
        </div>
      </CardShell>
    );
  }
}

// ── shot-ref card ── shot number/title/status · "open in shot workspace" ──
const STATUS_TONE = { todo: 'var(--accent)', wip: '#5B9DFF', 'in-progress': '#5B9DFF', done: 'var(--ok)', final: 'var(--ok)', blocked: 'var(--danger)' };
class ShotRefCard extends React.Component {
  state = { shot: null, loading: true, err: null };
  pid() { return this.props.directive.project || this.props.directive.pid || (this.props.ctx || {}).pid || null; }
  componentDidMount() {
    const id = refId(this.props.directive);
    const pid = this.pid();
    if (!id || !pid) { this.setState({ loading: false, err: !pid ? 'no project context' : 'no shot id' }); return; }
    api.story(pid)
      .then(s => {
        const shots = (s && Array.isArray(s.shots)) ? s.shots : [];
        const shot = shots.find(x => String(x.id) === id || String(x.id).toLowerCase() === id.toLowerCase()) || null;
        this.setState({ shot, loading: false, err: shot ? null : 'shot not found' });
      })
      .catch(e => this.setState({ loading: false, err: e.message }));
  }
  open() {
    const { app } = this.props.ctx || {};
    const pid = this.pid();
    if (!app || !pid) return;
    // Shots live in the project's Story tab (the shot workspace opens from there). Navigate to it.
    app.openProj?.(pid, 'story');
  }
  render() {
    const { shot, loading, err } = this.state;
    const id = refId(this.props.directive);
    const pid = this.pid();
    if (loading) return <CardShell label="shot"><span style={sx('font-size:11.5px;color:var(--fg-muted)')}>Loading shot…</span></CardShell>;
    if (err || !shot) return <CardShell label="shot" tone="var(--danger)"><span style={sx('font-size:11.5px;color:var(--fg-muted)')}>{err || 'shot unavailable'}{id ? ' (' + id + ')' : ''}</span></CardShell>;

    const num = shot.no != null ? ('Shot ' + shot.no) : shot.id;
    const status = String(shot.status || 'todo');
    const tone = STATUS_TONE[status.toLowerCase()] || 'var(--fg-muted)';
    return (
      <CardShell label="shot" right={<span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>{shot.id}</span>}>
        <div style={sx('display:flex;align-items:center;gap:10px')}>
          <div style={sx('flex:1;min-width:0')}>
            <div style={sx('display:flex;align-items:baseline;gap:8px')}>
              <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--accent)', flex: 'none' }}>{num}</span>
              <span style={sx('font-size:13px;font-weight:700;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{shot.title || 'Untitled shot'}</span>
            </div>
            <div style={sx('display:flex;align-items:center;gap:7px;margin-top:5px')}>
              <span style={{ ...sx('font-size:9.5px;font-weight:700;border-radius:5px;padding:2px 7px'), color: tone, border: '1px solid ' + tone + '55' }}>{status}</span>
              {shot.type ? <span style={sx('font-size:10px;color:var(--fg-faint)')}>{shot.type}{shot.dur ? ' · ' + shot.dur + 's' : ''}</span> : null}
            </div>
          </div>
          <span onClick={() => this.open()} className="hBd"
            style={{ ...sx('flex:none;font-size:10.5px;font-weight:700;border-radius:7px;padding:6px 12px;cursor:pointer;border:1px solid var(--border-2);color:var(--fg-soft)'), pointerEvents: pid ? 'auto' : 'none', opacity: pid ? 1 : 0.5 }}>
            Open in shot workspace →
          </span>
        </div>
      </CardShell>
    );
  }
}

// The style-lock card goes through the chat-tools REGISTRY (ticket 15), not registerDirectiveRenderer
// directly: registerToolCard binds it to the `style-locks` tool id, whose directive types are declared
// once in shared/chatTools.mjs. The registry installs the guarded renderer for those types — so when
// the style-locks tool is disabled (the default), a style directive shows the enable-notice instead of
// this card, and enabling the tool renders it. This is the demonstration that adding a tool is one
// registry entry + one card.
registerToolCard('style-locks', (directive, ctx) => <StyleLockCard directive={directive} ctx={ctx} />);

// The shot-REF card is a core "point at an existing shot" card (shots are core project data, not one
// of the gated chat tools), so it registers directly under the router grammar's `show.shot` types and
// its aliases. (The richer shot-BOARD tool card — a whole breakdown list — arrives via ticket 17 and
// registers through the registry under the `shot-board` id.)
for (const t of ['show.shot', 'shot.ref', 'shot-ref', 'shotref', 'shot'])
  registerDirectiveRenderer(t, (directive, ctx) => <ShotRefCard directive={directive} ctx={ctx} />);

export { StyleLockCard, ShotRefCard };
