// Feedback — the capture surface.  docs/specs/beta-feedback/spec.md §5
//
// Named "feedback", not "report a bug", because two of its three kinds are not bugs: a thing that
// confused you and a thing you want are the reports people skip when the button says "bug".
//
// Four steps in one dock, not a wizard: capture · describe · REVIEW · sent. The review step is
// the deliverable. Anyone can build a form with a screenshot on it; what makes this safe to ship
// in an app holding live API keys is that the user sees the exact bytes before they go, and Send
// stays disabled until they have.
//
// Primitives come from ./ui (Btn, Card, Field, Input, Eyebrow, Empty). Three of those had zero
// importers app-wide before this file; adoption, not extraction, was the open work (docs/COMPONENTS.md).

import React from 'react';
import { Btn, Card, Field, Input, Eyebrow, Empty } from './ui';
import { snapshot, takeStash, note } from './feedbackCapture.js';
import { capture as grabScreen, flatten, isDesktopCapture } from './screenshot.js';
import SnippetText from './SnippetText.jsx';

const KINDS = [
  { id: 'bug', label: 'Something broke', hint: 'it errored, hung, or did the wrong thing' },
  { id: 'confusing', label: 'Something confused me', hint: 'it works, but I could not tell how' },
  { id: 'idea', label: 'I want something', hint: 'a feature or a change' }
];

const SEVERITIES = [
  { id: 'blocks-me', label: 'Blocks me' },
  { id: 'annoying', label: 'Annoying' },
  { id: 'cosmetic', label: 'Cosmetic' }
];

// The evidence sections, in the order they appear in the review step. `always` marks the two the
// user cannot drop: without the app facts and their own words there is no report to file, and a
// toggle that produces an unusable report is a trap rather than a choice.
const SECTIONS = [
  { id: 'words', label: 'What you wrote', always: true, describe: () => 'title, description, and your email if you gave one' },
  { id: 'app', label: 'App + machine', always: true, describe: e => `${e.app.app} · ${e.app.platform} ${e.app.arch} · which integrations are on, which providers are configured (never the keys)` },
  { id: 'screenshot', label: 'Screenshot', describe: (e, s) => (s ? 'the window as you saw it, with your annotations flattened in' : 'none captured') },
  { id: 'errors', label: 'Errors', describe: e => count(e.client && e.client.errors) + ' — messages and stack traces' },
  { id: 'console', label: 'Console', describe: e => count(e.client && e.client.console) + ' from the browser log' },
  { id: 'network', label: 'API calls', describe: e => count(e.client && e.client.network) + ' — method, path, status, timing. No request or response bodies' },
  { id: 'interactions', label: 'What you clicked', describe: e => count(e.client && e.client.interactions) + ' — button names and page changes. Never anything you typed' },
  { id: 'serverLog', label: 'Server log', describe: e => count(e.server && e.server.log) + ' lines from Scout\'s own engine' },
  { id: 'serverApi', label: 'Server-side calls', describe: e => count(e.server && e.server.api) + ' as the engine saw them' },
  { id: 'failures', label: 'Recent failures', describe: e => count(e.server && e.server.failures) + ' from the job queue' }
];

const count = a => (a ? a.length : 0) + (a && a.length === 1 ? ' entry' : ' entries');

const mono = { fontFamily: 'var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace)' };

const MINE = 'ff:feedback:mine';

// Reporter-facing wording for every state the pipeline can be in. Deliberately plain: "triaged"
// and "filed" are our words, not theirs.
const STATUS = {
  checking:    { label: 'checking…',      dot: 'var(--fg-faint)' },
  offline:     { label: 'offline',        dot: 'var(--fg-faint)' },
  'local-only':{ label: 'on this machine',dot: 'var(--warn)' },
  unknown:     { label: 'not found',      dot: 'var(--fg-faint)' },
  received:    { label: 'received',       dot: 'var(--accent)' },
  triaged:     { label: 'read + sorted',  dot: 'var(--accent)' },
  filed:       { label: 'tracked',        dot: 'var(--ok)' },
  answered:    { label: 'answered',       dot: 'var(--warn)' },
  duplicate:   { label: 'already known',  dot: 'var(--fg-muted)' },
  fixed:       { label: 'fixed',          dot: 'var(--ok)' },
  'triage-failed': { label: 'tracked',    dot: 'var(--ok)' }
};

export default class Feedback extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      step: 'capture',
      kind: 'bug', title: '', body: '', severity: 'annoying',
      email: props.email || '',
      shot: null, shotVia: null, marks: [], tool: 'box', drawing: null,
      include: {},            // sectionId → false; absent means included
      preview: null,          // the redacted envelope, exactly as it will be sent
      previewErr: null,
      reviewed: false,
      sending: false, result: null, error: null,
      stash: null
    };
    this.canvasRef = React.createRef();
    // Marks are stored as fractions so they survive the image being scaled, but they have to be
    // DRAWN in pixels — an arrowhead inside a percentage viewBox stretches with the aspect ratio
    // and stops looking like an arrow.
    this.boxRef = React.createRef();
    this.state.box = { w: 0, h: 0 };
  }

  measureBox = () => {
    const el = this.boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (Math.round(r.width) !== this.state.box.w || Math.round(r.height) !== this.state.box.h) {
      this.setState({ box: { w: Math.round(r.width), h: Math.round(r.height) } });
    }
  };

  componentDidMount() {
    this.loadMine();
    // A crash report from the boundary card: the rings were stashed before the reload, so use
    // those instead of the ones from the fresh page, which contain nothing but the reload.
    const stash = takeStash();
    if (stash) {
      const err = (stash.errors || []).filter(e => e.kind !== 'resource').slice(-1)[0];
      this.setState({
        stash,
        // Pre-fill from the crash. The tester can rewrite it; what matters is that a report is
        // one sentence away rather than a blank page after something already went wrong.
        title: err ? String(err.message || '').slice(0, 120) : '',
        body: err ? 'The UI crashed. I was: ' : '',
        severity: 'blocks-me'
      });
    }
    // Auto-capture ONLY on the desktop path, where it is instant, silent and scoped to our own
    // window. In the browser it would fire a screen-share permission prompt the moment the panel
    // opens — an alarming thing to do to someone who came here to complain about a button.
    if (isDesktopCapture()) this.grab();
    this._esc = e => {
      if (e.key === 'Escape' && !this.state.drawing) { e.stopPropagation(); this.props.onClose(); }
    };
    window.addEventListener('keydown', this._esc, true);
    window.addEventListener('resize', this.measureBox);
  }

  componentDidUpdate() { this.measureBox(); }

  componentWillUnmount() {
    window.removeEventListener('keydown', this._esc, true);
    window.removeEventListener('resize', this.measureBox);
  }

  // ── my reports (spec §12) ─────────────────────────────────────────────────────────────────
  //
  // The part every internal feedback tool forgets, and the reason testers stop filing: they never
  // learn whether it mattered. Codes live in localStorage rather than the datastore — they are a
  // per-machine receipt, not project data, and they must survive a storage-root change.

  loadMine() {
    let codes = [];
    try { codes = JSON.parse(localStorage.getItem(MINE) || '[]').slice(-12); } catch { /* first run */ }
    if (!codes.length) return;
    this.setState({ mine: codes.map(c => ({ code: c, status: 'checking' })) });
    Promise.all(codes.map(code =>
      fetch('/api/feedback/report/' + encodeURIComponent(code))
        .then(r => (r.ok ? r.json() : { code, status: 'unknown' }))
        // Offline is not the same as "we lost it", and saying so would be the one thing that
        // makes someone stop reporting.
        .catch(() => ({ code, status: 'offline' }))
    )).then(mine => this.setState({ mine: mine.reverse() }));
  }

  remember(code) {
    try {
      const prev = JSON.parse(localStorage.getItem(MINE) || '[]');
      localStorage.setItem(MINE, JSON.stringify([...prev, code].slice(-30)));
    } catch { /* private mode — the code is still shown on screen and copyable */ }
  }

  // ── screenshot ────────────────────────────────────────────────────────────────────────────

  async grab(rect) {
    // Hide the panel for the shot itself — a screenshot of the bug report covering the bug is a
    // remarkably common and entirely self-inflicted failure.
    this.setState({ capturing: true });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const got = await grabScreen(rect);
    this.setState({ capturing: false, shot: got && got.dataUrl, shotVia: got && got.via, marks: [] });
  }

  // Marks are stored as fractions of the image box so they survive it being scaled to fit.
  onDrawStart = e => {
    if (!this.state.shot) return;
    const box = e.currentTarget.getBoundingClientRect();
    this.setState({ drawing: { kind: this.state.tool, x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height, w: 0, h: 0 } });
  };
  onDrawMove = e => {
    if (!this.state.drawing) return;
    const box = e.currentTarget.getBoundingClientRect();
    const d = this.state.drawing;
    this.setState({ drawing: { ...d, w: (e.clientX - box.left) / box.width - d.x, h: (e.clientY - box.top) / box.height - d.y } });
  };
  onDrawEnd = () => {
    const d = this.state.drawing;
    if (!d) return;
    // A click with no drag is not a mark; without this every stray click leaves an invisible
    // zero-size artifact in the list and the Undo button appears to do nothing.
    const real = Math.abs(d.w) > 0.01 || Math.abs(d.h) > 0.01;
    this.setState({ drawing: null, marks: real ? [...this.state.marks, normaliseMark(d)] : this.state.marks });
  };

  // ── review ────────────────────────────────────────────────────────────────────────────────

  // Build the payload the way the server will, then ask the server to redact and return it. The
  // preview is not assembled by different code from the send — it IS the send, minus transmission
  // (backend/feedback.mjs `buildEnvelope`). Anything less and the review step is decoration.
  async review() {
    this.setState({ step: 'review', preview: null, previewErr: null });
    try {
      const res = await fetch('/api/feedback/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.payload())
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).error) || 'preview failed (' + res.status + ')');
      const preview = await res.json();
      this.setState({ preview, reviewed: true });
    } catch (e) {
      // No preview means no informed consent, so this blocks sending rather than degrading to
      // "trust us". It is also, itself, a bug worth reporting — hence the plain wording.
      this.setState({ previewErr: e.message || 'could not build the preview' });
    }
  }

  payload() {
    const s = this.state;
    const client = s.stash || snapshot();
    return {
      kind: s.kind, title: s.title.trim(), body: s.body.trim(), severity: s.severity,
      email: s.email.trim() || null,
      where: this.props.where || {},
      client, include: s.include
    };
  }

  async send() {
    this.setState({ sending: true, error: null });
    try {
      let shot = null;
      if (this.state.shot && this.state.include.screenshot !== false) {
        shot = await flatten(this.state.shot, this.state.marks);
      }
      const res = await fetch('/api/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...this.payload(), screenshot: shot })
      });
      const j = await res.json();
      if (!res.ok || (!j.ok && j.error)) throw new Error(j.error || 'send failed (' + res.status + ')');
      note('report', 'sent ' + j.code);
      this.remember(j.code);
      this.setState({ sending: false, result: j, step: 'sent' });
      if (this.props.onSent) this.props.onSent(j);
    } catch (e) {
      this.setState({ sending: false, error: e.message || 'could not send' });
    }
  }

  // ── render ────────────────────────────────────────────────────────────────────────────────

  render() {
    const S = this.state;
    // The panel is hidden while the shot is being taken; see grab().
    if (S.capturing) return null;

    return (
      <div onClick={this.props.onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(6,7,9,.72)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div onClick={e => e.stopPropagation()}
          style={{ width: 'min(860px, 100%)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', background: 'var(--surface-2)', border: '1px solid var(--border-3)', borderRadius: 14, overflow: 'hidden' }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--border-2)' }}>
            <Eyebrow>Feedback</Eyebrow>
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              {S.step === 'sent' ? 'Sent — thank you' : S.step === 'review' ? 'What gets sent' : 'Send feedback'}
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              {S.step === 'review' && <Btn size="sm" onClick={() => this.setState({ step: 'capture' })}>Back</Btn>}
              <Btn size="sm" onClick={this.props.onClose} aria-label="Close">Close</Btn>
            </div>
          </div>

          <div style={{ overflow: 'auto', padding: 18, display: 'grid', gap: 14 }}>
            {S.step === 'sent' ? this.renderSent() : S.step === 'review' ? this.renderReview() : this.renderCompose()}
          </div>

          {S.step !== 'sent' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderTop: '1px solid var(--border-2)' }}>
              <div style={{ fontSize: 10.5, color: 'var(--fg-faint)', lineHeight: 1.5, flex: 1 }}>
                Nothing is collected in the background. Nothing leaves this machine until you press Send.
              </div>
              {S.error && <div style={{ fontSize: 11, color: 'var(--danger)' }}>{S.error}</div>}
              {S.step === 'review'
                ? <Btn variant="primary" busy={S.sending} disabled={!S.preview} onClick={() => this.send()}>
                    {S.sending ? 'Sending…' : 'Send report'}
                  </Btn>
                : <Btn variant="secondary" disabled={!S.title.trim() && !S.body.trim()} onClick={() => this.review()}>
                    Review what gets sent →
                  </Btn>}
            </div>
          )}
        </div>
      </div>
    );
  }

  renderCompose() {
    const S = this.state;
    return (
      <>
        {S.stash && (
          <Card tone="danger" label="Recovered from the crash">
            <div style={{ fontSize: 11.5, color: 'var(--fg-soft)', lineHeight: 1.55 }}>
              The error and the log from just before the UI crashed are attached. You do not have to
              describe what broke — just what you were doing.
            </div>
          </Card>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          {KINDS.map(k => (
            <Btn key={k.id} variant={S.kind === k.id ? 'secondary' : 'ghost'} onClick={() => this.setState({ kind: k.id })}
              style={{ flex: 1, flexDirection: 'column', alignItems: 'flex-start', gap: 3, padding: '9px 12px', textAlign: 'left' }}>
              <span style={{ fontSize: 12 }}>{k.label}</span>
              <span style={{ fontSize: 10, color: 'var(--fg-faint)', fontWeight: 500 }}>{k.hint}</span>
            </Btn>
          ))}
        </div>

        <Field label="ONE LINE">
          <Input value={S.title} onChange={e => this.setState({ title: e.target.value })}
            onKeyDown={e => e.stopPropagation()} style={{ width: '100%', boxSizing: 'border-box', fontSize: 12 }}
            placeholder={S.kind === 'idea' ? 'What do you want it to do?' : 'What went wrong?'} />
        </Field>

        <Field label="WHAT HAPPENED" hint="What you were doing, what you expected, what you got instead. The evidence is attached automatically — you do not need to describe the error.">
          {/* SnippetText hands back a DOM-shaped { target: { value } }, not a bare string, and it
              spreads style straight onto a bare <textarea> — so the tokens have to be passed in.
              Same declaration as the review-note field at App.jsx:3056. */}
          <SnippetText value={S.body} onChange={e => this.setState({ body: e.target.value })}
            snippets={this.props.snippets || []} onKeyDown={e => e.stopPropagation()}
            placeholder="I clicked reroll on shot 12 and… · / for snippets"
            style={{ width: '100%', boxSizing: 'border-box', height: 96, resize: 'vertical', background: 'var(--ink)', border: '1px solid var(--border-2)', borderRadius: 8, color: 'var(--fg)', fontSize: 13, padding: '10px 12px', lineHeight: 1.55 }} />
        </Field>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <Field label="HOW BAD" style={{ flex: '1 1 240px' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {SEVERITIES.map(s => (
                <Btn key={s.id} size="sm" variant={S.severity === s.id ? 'secondary' : 'ghost'}
                  onClick={() => this.setState({ severity: s.id })} style={{ flex: 1 }}>{s.label}</Btn>
              ))}
            </div>
          </Field>
          <Field label="EMAIL — OPTIONAL" hint="Only so we can tell you when it is fixed, or ask a question if the report is not enough." style={{ flex: '1 1 240px' }}>
            <Input type="email" value={S.email} onChange={e => this.setState({ email: e.target.value })}
              onKeyDown={e => e.stopPropagation()} placeholder="you@example.com" style={{ width: '100%', boxSizing: 'border-box' }} />
          </Field>
        </div>

        {this.renderShot()}
        {this.renderMine()}
      </>
    );
  }

  renderMine() {
    const mine = this.state.mine || [];
    if (!mine.length) return null;
    return (
      <Card label={'Your reports · ' + mine.length}>
        <div style={{ display: 'grid', gap: 7 }}>
          {mine.map(r => {
            const s = STATUS[r.status] || STATUS.unknown;
            return (
              <div key={r.code} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5 }}>
                <span style={{ ...mono, color: 'var(--fg-muted)', flex: 'none' }}>{r.code}</span>
                <span style={{ flex: 'none', width: 6, height: 6, borderRadius: 99, background: s.dot }} />
                <span style={{ color: 'var(--fg-soft)', flex: 'none' }}>{s.label}</span>
                <span style={{ color: 'var(--fg-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                  {r.headline || ''}
                  {r.occurrences > 1 ? ` · ${r.occurrences} people hit this` : ''}
                  {r.mergedInto ? ` · merged into ${r.mergedInto}` : ''}
                </span>
                {r.issueUrl && <a href={r.issueUrl} target="_blank" rel="noreferrer" style={{ ...mono, fontSize: 10, color: 'var(--accent)', flex: 'none' }}>issue ↗</a>}
              </div>
            );
          })}
        </div>
        {/* The AI asking a question is the one bit of the verdict a reporter should see —
            everything else in it is written to be blunt, and blunt is not what someone who
            took the time to help should read about their own report. */}
        {mine.filter(r => r.needsInfo && r.needsInfo.length).map(r => (
          <div key={r.code + '-q'} style={{ marginTop: 10, padding: '9px 11px', borderRadius: 8, background: 'var(--ink)', border: '1px solid var(--border-2)' }}>
            <div style={{ fontSize: 11, color: 'var(--fg-soft)', fontWeight: 600 }}>{r.code} — we need a bit more to act on this:</div>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 11, color: 'var(--fg-faint)', lineHeight: 1.6 }}>
              {r.needsInfo.map((q, i) => <li key={i}>{q}</li>)}
            </ul>
          </div>
        ))}
      </Card>
    );
  }

  renderShot() {
    const S = this.state;
    if (!S.shot) {
      return (
        <Empty
          title="No screenshot"
          body={isDesktopCapture() ? 'The capture did not return an image. You can send without one.' : 'In the browser this needs a screen-share prompt. In the desktop app it is automatic.'}
          action={{ onClick: () => this.grab(), label: 'Take a screenshot' }}
        />
      );
    }
    const live = S.drawing ? [...S.marks, normaliseMark(S.drawing)] : S.marks;
    const box = S.box;
    return (
      <Card label="Screenshot" right={
        <span style={{ display: 'flex', gap: 6 }}>
          {['box', 'arrow', 'blur'].map(t => (
            <Btn key={t} size="sm" variant={S.tool === t ? 'secondary' : 'ghost'} onClick={() => this.setState({ tool: t })}>{t}</Btn>
          ))}
          <Btn size="sm" disabled={!S.marks.length} onClick={() => this.setState({ marks: S.marks.slice(0, -1) })}>Undo</Btn>
          <Btn size="sm" onClick={() => this.grab()}>Retake</Btn>
        </span>
      }>
        <div ref={this.boxRef} style={{ position: 'relative', userSelect: 'none', cursor: 'crosshair', lineHeight: 0 }}
          onMouseDown={this.onDrawStart} onMouseMove={this.onDrawMove} onMouseUp={this.onDrawEnd} onMouseLeave={this.onDrawEnd}>
          <img src={S.shot} alt="Screenshot of the app" onLoad={this.measureBox}
            style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border-2)', display: 'block' }} draggable={false} />

          {/* Blur stays a div — backdrop-filter is the only thing that previews an actual blur,
              and SVG has no equivalent. */}
          {live.filter(m => m.kind === 'blur').map((m, i) => (
            <div key={'b' + i} style={{
              position: 'absolute', left: pct(m.x), top: pct(m.y), width: pct(m.w), height: pct(m.h),
              pointerEvents: 'none', backdropFilter: 'blur(8px)', background: 'rgba(11,12,14,.25)',
              border: '1px solid var(--border-3)'
            }} />
          ))}

          {/* Boxes and arrows are drawn as real geometry in pixel space. The previous version gave
              an arrow a div with only a bottom border, which drew an L down one edge of its
              bounding box rather than a line from A to B — and a leftward or upward drag produced
              a negative width, which CSS cannot render at all. */}
          {box.w > 0 && (
            <svg width={box.w} height={box.h} viewBox={`0 0 ${box.w} ${box.h}`}
              style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', overflow: 'visible' }}>
              {live.filter(m => m.kind !== 'blur').map((m, i) => {
                const x = m.x * box.w, y = m.y * box.h, w = m.w * box.w, h = m.h * box.h;
                if (m.kind === 'box') {
                  return <rect key={'k' + i} x={x} y={y} width={Math.abs(w)} height={Math.abs(h)} rx="4"
                    fill="none" stroke="var(--accent)" strokeWidth="2" />;
                }
                // Arrow: x,y is where the drag STARTED and w,h is the delta, so the head lands
                // under the cursor. normaliseMark leaves arrows un-normalised for exactly this —
                // direction is the whole meaning of an arrow.
                const x2 = x + w, y2 = y + h;
                const a = Math.atan2(h, w);
                const head = Math.max(9, Math.min(18, Math.hypot(w, h) * 0.28));
                const pts = [
                  [x2, y2],
                  [x2 - head * Math.cos(a - 0.42), y2 - head * Math.sin(a - 0.42)],
                  [x2 - head * Math.cos(a + 0.42), y2 - head * Math.sin(a + 0.42)]
                ].map(p => p.map(n => n.toFixed(1)).join(',')).join(' ');
                return (
                  <g key={'k' + i}>
                    {/* stop the shaft short of the head so the point stays sharp */}
                    <line x1={x} y1={y} x2={x2 - Math.cos(a) * head * 0.8} y2={y2 - Math.sin(a) * head * 0.8}
                      stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
                    <polygon points={pts} fill="var(--accent)" />
                  </g>
                );
              })}
            </svg>
          )}
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--fg-faint)', marginTop: 7, lineHeight: 1.5 }}>
          Drag to mark. <b>blur</b> permanently destroys those pixels before the image is sent — use it on
          anything private that ended up in the shot.
          {S.shotVia === 'desktop' ? ' Captured from the Scout window only.' : ''}
        </div>
      </Card>
    );
  }

  renderReview() {
    const S = this.state;
    if (S.previewErr) {
      return (
        <Card tone="danger" label="Cannot show what would be sent">
          <div style={{ fontSize: 12, color: 'var(--fg-soft)', lineHeight: 1.6 }}>
            {S.previewErr}
            <br /><br />
            Sending is blocked, because you should not have to take our word for what is in the payload.
            This is itself a bug in Scout.
          </div>
        </Card>
      );
    }
    if (!S.preview) return <Empty title="Building the payload" body="Redacting…" />;

    const e = S.preview;
    const hits = (e.redaction && e.redaction.hits) || {};
    const total = Object.values(hits).reduce((a, b) => a + b, 0);

    return (
      <>
        <Card tone={total ? 'ok' : 'muted'} label="Redaction">
          <div style={{ fontSize: 12, color: 'var(--fg-soft)', lineHeight: 1.6 }}>
            {total
              ? <><b>{total}</b> value{total === 1 ? '' : 's'} removed before this leaves your machine — {Object.entries(hits).map(([k, v]) => hitLabel(k, v)).join(', ')}.</>
              : 'Nothing needed removing — no keys, signed links or personal paths were found in this report.'}
          </div>
        </Card>

        {SECTIONS.map(sec => {
          const on = S.include[sec.id] !== false;
          const has = sectionPresent(sec.id, e, S.shot);
          return (
            <div key={sec.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '9px 2px', borderBottom: '1px solid var(--border-1, var(--border-2))', opacity: has ? 1 : .45 }}>
              <input type="checkbox" checked={on && has} disabled={sec.always || !has}
                onChange={ev => this.setState({ include: { ...S.include, [sec.id]: ev.target.checked } })}
                style={{ marginTop: 2, accentColor: 'var(--accent)' }} aria-label={'Include ' + sec.label} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  {sec.label}
                  {sec.always && <span style={{ ...mono, fontSize: 9.5, color: 'var(--fg-faint)', marginLeft: 8, letterSpacing: '.08em' }}>REQUIRED</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg-faint)', marginTop: 3, lineHeight: 1.5 }}>
                  {has ? sec.describe(e, S.shot) : 'nothing captured'}
                </div>
              </div>
            </div>
          );
        })}

        <details style={{ marginTop: 4 }}>
          <summary style={{ cursor: 'pointer', fontSize: 11.5, color: 'var(--fg-muted)' }}>
            Show the exact payload ({Math.round(JSON.stringify(e).length / 1024)} KB)
          </summary>
          <pre style={{ ...mono, marginTop: 8, padding: 12, background: 'var(--ink)', border: '1px solid var(--border-2)', borderRadius: 8, fontSize: 10.5, lineHeight: 1.5, maxHeight: 340, overflow: 'auto' }}>
            {JSON.stringify(stripDropped(e, S.include), null, 2)}
          </pre>
        </details>
      </>
    );
  }

  renderSent() {
    const r = this.state.result || {};
    return (
      <>
        <Card tone={r.queued ? 'warn' : 'ok'} label={r.queued ? 'Saved on this machine' : 'Received'}>
          <div style={{ ...mono, fontSize: 20, letterSpacing: '.06em', color: 'var(--accent)' }}>{r.code}</div>
          <div style={{ fontSize: 12, color: 'var(--fg-soft)', lineHeight: 1.6, marginTop: 8 }}>
            {r.queued
              ? <>Could not reach us just now, so the report is queued on your machine and goes out automatically next time Scout starts. {r.note ? <span style={{ color: 'var(--fg-faint)' }}>({r.note})</span> : null}</>
              : r.duplicateOf
                ? <>Someone has already reported this one — your report was added to it, which tells us it is hitting more than one person.</>
                : <>It will be read, classified and turned into a tracked issue automatically. If the description is not enough, we will ask.</>}
          </div>
        </Card>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn onClick={() => navigator.clipboard && navigator.clipboard.writeText(r.code)}>Copy {r.code}</Btn>
          <Btn variant="primary" onClick={this.props.onClose} style={{ marginLeft: 'auto' }}>Back to work</Btn>
        </div>
      </>
    );
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────

// [singular, plural]. This line is read by someone deciding whether to trust the app with their
// data; "1 key-shaped strings" is a small thing that makes the whole claim look unattended.
const LABELS = {
  'exact-secret': ['API key', 'API keys'],
  'key-shape': ['key-shaped string', 'key-shaped strings'],
  'signed-url': ['signed link', 'signed links'],
  'data-url': ['embedded image', 'embedded images'],
  'home-path': ['personal path', 'personal paths'],
  email: ['email address', 'email addresses'],
  'high-entropy': ['unrecognised token', 'unrecognised tokens'],
  oversize: ['oversized value', 'oversized values']
};
const hitLabel = (rule, n) => {
  const pair = LABELS[rule];
  return n + ' ' + (pair ? pair[n === 1 ? 0 : 1] : rule);
};

// Drags go in any direction; a negative width is correct geometry and useless for rendering.
function normaliseMark(d) {
  return d.kind === 'arrow'
    ? d   // an arrow's direction IS its meaning — normalising it would point it the wrong way
    : { ...d, x: Math.min(d.x, d.x + d.w), y: Math.min(d.y, d.y + d.h), w: Math.abs(d.w), h: Math.abs(d.h) };
}

const pct = n => (n * 100) + '%';

function sectionPresent(id, e, shot) {
  if (id === 'words' || id === 'app') return true;
  if (id === 'screenshot') return !!shot;
  if (id === 'serverLog') return !!(e.server && e.server.log && e.server.log.length);
  if (id === 'serverApi') return !!(e.server && e.server.api && e.server.api.length);
  if (id === 'failures') return !!(e.server && e.server.failures && e.server.failures.length);
  return !!(e.client && e.client[id] && e.client[id].length);
}

// The raw view honours the toggles too. A payload dump that still shows a section the user just
// switched off is the exact opposite of what this screen is for.
function stripDropped(envelope, include) {
  const out = JSON.parse(JSON.stringify(envelope));
  for (const [id, on] of Object.entries(include)) {
    if (on !== false) continue;
    if (out.client && out.client[id]) delete out.client[id];
    if (id === 'serverLog' && out.server) delete out.server.log;
    if (id === 'serverApi' && out.server) delete out.server.api;
    if (id === 'failures' && out.server) delete out.server.failures;
  }
  return out;
}
