// Ticket 25 — the tool builder surface. Reached from "+ New tool" at the top of the Tools hub.
//
// A FOCUSED chat, not the project chat. Chat.jsx is project-shaped — session sidebar, Production
// Panel, checkpoints, attachments, style locks — and every one of those is wrong here: this is one
// throwaway conversation whose only output is a saved tool. So this surface is deliberately narrow:
// one session, one composer, one rail that shows the tool taking shape.
//
// The session is created with kind:'toolsmith', which is the whole force-load mechanism — the
// backend mounts backend/skills/frameforge-toolsmith into that session's isolated home and gives it
// an Index line (backend/agentHome.prepareAgentHome). The user never toggles a pack on.
//
// FOUR INVARIANTS COPIED FROM Chat.jsx, none optional:
//   1. await streamReady() before posting a turn — runTurn broadcasts turn-started before the POST
//      would resolve, so subscribing late drops the opening events.
//   2. every SSE handler is guarded on the session still being the active one.
//   3. on turn-done / turn-cancelled / error: refetch the transcript, THEN clear `live`. The
//      persisted record is the source of truth; `live` is only the in-flight turn.
//   4. e.stopPropagation() on composer keydown — App.jsx owns global single-letter hotkeys.
import React from 'react';
import { marked } from 'marked';
import { sx } from './sx';
import { api } from './api';
import { renderMessageBody } from './chat/directives';
import { MONO } from './tokens';
import './chat/cards'; // side effect: registers every directive card, including tool.draft / tool.card

const Md = ({ src }) => <div className="mdBody" dangerouslySetInnerHTML={{ __html: marked.parse(String(src || '')) }} />;

// The three openers. Each is a real, buildable tool — never a placeholder — because the first thing
// the filmmaker reads sets their expectation of what a tool IS.
const OPENERS = [
  'Something that checks a shot against continuity before I shoot it',
  'A wardrobe note in the exact format my costume department uses',
  'A check that tells me what is still missing before Tuesday'
];

export default class ToolsmithChat extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      session: null, messages: [], live: null, streaming: false,
      input: '', err: null, tools: []
    };
    this.es = null;
    this._ready = null; this._readyResolve = null; this._streamOpen = false; this._helloSeen = false;
    this.scrollRef = React.createRef();
    this.taRef = React.createRef();
  }

  // NOTE: no session is created on mount. Opening the builder and walking away must leave nothing
  // behind — an eager POST wrote a "New tool" session per visit, and those are standalone chats, so
  // they surfaced in the user's ordinary chat list as identical empty rows. The session is created
  // by the first send instead. (backend/chat.mjs listSessions also filters kind:'toolsmith' out of
  // the chat list, so a session that IS created never pollutes it either — belt and braces.)
  componentDidMount() { this.refreshTools(); }
  componentWillUnmount() { this._dead = true; this.closeStream(); }
  componentDidUpdate(_p, prev) {
    if (prev.messages !== this.state.messages || prev.live !== this.state.live) {
      const el = this.scrollRef.current; if (el) el.scrollTop = el.scrollHeight;
    }
  }

  // ── session ──
  // Created on demand by the first send, never on mount. Returns the id, or null on failure.
  async ensureSession() {
    if (this.state.session) return this.state.session.id;
    if (this._creating) return this._creating;
    this._creating = (async () => {
      try {
        // standalone (project: null) — a tool belongs to the workspace, not to one film
        const s = await api.createChatSession({ project: null, kind: 'toolsmith', title: 'New tool', mode: 'agent' });
        if (this._dead) return null;
        this.setState({ session: s, messages: s.messages || [] });
        this.openStream(s.id);
        return s.id;
      } catch (e) {
        this.setState({ err: 'Could not start the tool builder — ' + e.message, streaming: false, live: null });
        return null;
      } finally {
        this._creating = null;
      }
    })();
    return this._creating;
  }

  activeId() { return this.state.session ? this.state.session.id : null; }

  openStream(id) {
    this._streamOpen = false;
    this._ready = new Promise(res => { this._readyResolve = res; });
    let es;
    try { es = new EventSource(api.chatStreamUrl(id)); }
    catch { this._readyResolve && this._readyResolve(); return; } // no EventSource → turns still post
    this.es = es;
    const active = () => this.activeId() === id;
    const on = (t, fn) => es.addEventListener(t, ev => { let d = {}; try { d = JSON.parse(ev.data); } catch { /* keepalive */ } if (active()) fn(d); });
    const opened = () => { this._streamOpen = true; this._readyResolve && this._readyResolve(); };
    es.addEventListener('hello', () => { opened(); if (this._helloSeen) this.reconcile(id); this._helloSeen = true; });
    es.onopen = opened;
    on('turn-started', d => this.setState(st => ({
      streaming: true,
      live: { userMessage: d.userMessage || null, userText: (d.userMessage && d.userMessage.text) || (st.live && st.live.userText) || '', text: '', directives: [] }
    })));
    on('text-delta', d => this.setState(st => st.live ? { live: { ...st.live, text: st.live.text + (d.text || '') } } : null));
    on('directive', d => this.setState(st => st.live ? { live: { ...st.live, directives: [...st.live.directives, d.directive] } } : null));
    on('turn-done', () => this.onTurnEnd(id));
    on('turn-cancelled', () => this.onTurnEnd(id));
    on('error', d => { this.onTurnEnd(id); this.setState({ err: d.message || 'agent error' }); });
  }

  reconcile(id) {
    api.chatSession(id).then(s => this.setState(st => this.activeId() === id
      ? { session: s, messages: Array.isArray(s.messages) ? s.messages : st.messages } : null)).catch(() => {});
  }

  onTurnEnd(id) {
    api.chatSession(id).then(s => this.setState(st => this.activeId() === id
      ? { session: s, messages: Array.isArray(s.messages) ? s.messages : st.messages, live: null, streaming: false } : null))
      .catch(() => this.setState({ live: null, streaming: false }));
    this.refreshTools();
  }

  closeStream() { if (this.es) { try { this.es.close(); } catch { /* already closed */ } } this.es = null; this._streamOpen = false; }
  streamReady() {
    if (this._streamOpen) return Promise.resolve();
    return Promise.race([this._ready || Promise.resolve(), new Promise(r => setTimeout(r, 1200))]);
  }

  refreshTools() {
    api.userTools().then(r => this.setState({ tools: (r && r.tools) || [] })).catch(() => {});
  }

  // ── turns ──
  async send(text) {
    const body = String(text != null ? text : this.state.input).trim();
    if (!body || this.state.streaming) return;
    this.setState({ input: '', live: { userMessage: null, userText: body, text: '', directives: [] }, streaming: true, err: null });
    if (this.taRef.current) this.taRef.current.style.height = 'auto';
    const id = await this.ensureSession();
    if (!id) return; // ensureSession already surfaced the error and cleared `streaming`
    await this.streamReady(); // subscribe before runTurn broadcasts turn-started
    api.chatTurn(id, body, []).catch(e => {
      this.setState({ streaming: false, live: null, err: 'Send failed — ' + e.message });
    });
  }

  // The most recent tool.draft the agent proposed — the rail mirrors it as the tool takes shape.
  latestDraft() {
    const all = [];
    for (const m of this.state.messages) for (const d of (m.directives || [])) all.push(d);
    for (const d of ((this.state.live && this.state.live.directives) || [])) all.push(d);
    for (let i = all.length - 1; i >= 0; i--) {
      const t = all[i] && (all[i].type || '');
      if (t === 'tool.draft' || t === 'tool-draft') return all[i];
    }
    return null;
  }

  // ── render ──
  render() {
    const { app } = this.props;
    const S = this.state;
    const empty = !S.messages.some(m => m.role !== 'system') && !S.live;

    return (
      <div>
        {/* header — same shape as Tools.jsx wrap(), so the page reads as a Tools sub-surface */}
        <div style={sx('display:flex;align-items:center;gap:12px;padding:11px 28px;border-bottom:1px solid var(--line)')}>
          <span onClick={() => app.go('tools')} className="hFgL" style={sx('font-size:12px;color:var(--fg-faint);cursor:pointer')}>← Tools</span>
          <span style={sx('font-size:12px;font-weight:700')}>New tool</span>
          <span style={{ ...sx('font-size:9px;font-weight:800;letter-spacing:.08em;color:var(--accent);border:1px solid rgba(227,255,50,.4);border-radius:99px;padding:1.5px 8px'), fontFamily: MONO }}>TOOL BUILDER</span>
          {S.session && S.session.executor === 'simulate'
            ? <span style={sx('margin-left:auto;font-size:10px;color:var(--fg-muted)')}>no agent CLI connected — replies are simulated</span>
            : null}
        </div>

        <div style={sx('display:flex;align-items:stretch;min-height:calc(100vh - 150px)')}>
          {/* transcript + composer */}
          <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column')}>
            <div ref={this.scrollRef} className="chatScroll" style={sx('flex:1;overflow:auto;padding:26px 28px 10px')}>
              {empty && (
                <div style={sx('max-width:620px')}>
                  <div style={sx('font-size:15px;font-weight:700;color:var(--fg)')}>What do you want to build?</div>
                  <div style={sx('font-size:11.5px;color:var(--fg-faint);line-height:1.65;margin-top:7px')}>
                    Describe it the way you would to a crew member. Four questions and you'll have a first draft you can save.
                  </div>
                  <div style={sx('display:flex;flex-direction:column;gap:7px;margin-top:18px')}>
                    {OPENERS.map((o, i) => (
                      <span key={i} onClick={() => this.send(o)} className="hCard"
                        style={sx('font-size:11.5px;color:var(--fg-soft);line-height:1.5;border:1px solid var(--border-2);border-radius:9px;background:var(--surface);padding:10px 13px;cursor:pointer')}>
                        {o}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {S.messages.filter(m => m.role !== 'system').map(m => this.renderMessage(m))}
              {S.live && this.renderLive()}
              {S.err && <div style={sx('font-size:11.5px;color:var(--danger);margin:10px 0;line-height:1.5')}>{S.err}</div>}
            </div>

            {this.renderComposer()}
          </div>

          {this.renderRail()}
        </div>
      </div>
    );
  }

  renderMessage(m) {
    const ctx = { app: this.props.app, pid: null, session: this.state.session, message: m };
    const mine = m.role === 'user';
    return (
      <div key={m.id} style={sx('margin:0 0 18px')}>
        <div style={{ ...sx('font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:5px'), fontFamily: MONO, color: mine ? 'var(--fg-faint)' : 'var(--accent)' }}>
          {mine ? 'you' : 'tool builder'}
        </div>
        {mine
          ? <div style={sx('font-size:12.5px;color:var(--fg);line-height:1.6;white-space:pre-wrap')}>{m.text}</div>
          : <div style={sx('font-size:12.5px;color:var(--fg-soft);line-height:1.65')}>{renderMessageBody(m.text, m.directives, ctx, Md)}</div>}
        {m.error ? <div style={sx('font-size:11.5px;color:var(--danger);margin-top:6px')}>⚠ {m.error}</div> : null}
      </div>
    );
  }

  renderLive() {
    const L = this.state.live;
    const ctx = { app: this.props.app, pid: null, session: this.state.session, live: true };
    // De-dupe the live user bubble: runTurn persists the user message BEFORE broadcasting
    // turn-started, so a mid-turn reconnect's reconcile() refetch legitimately already contains it.
    // Without this the prompt renders twice — once from messages, once here. (Chat.jsx does the same.)
    const dup = L.userMessage && this.state.messages.some(m => m.id === L.userMessage.id);
    return (
      <>
        {L.userText && !dup ? (
          <div style={sx('margin:0 0 18px')}>
            <div style={{ ...sx('font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:5px;color:var(--fg-faint)'), fontFamily: MONO }}>you</div>
            <div style={sx('font-size:12.5px;color:var(--fg);line-height:1.6;white-space:pre-wrap')}>{L.userText}</div>
          </div>
        ) : null}
        <div style={sx('margin:0 0 18px')}>
          <div style={{ ...sx('display:flex;align-items:center;gap:7px;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:5px;color:var(--accent)'), fontFamily: MONO }}>
            tool builder
            {!L.text && <span style={sx('width:5px;height:5px;border-radius:99px;background:var(--accent);animation:dl-pulse 1.4s infinite')} />}
          </div>
          <div style={sx('font-size:12.5px;color:var(--fg-soft);line-height:1.65')}>{renderMessageBody(L.text, L.directives, ctx, Md)}</div>
        </div>
      </>
    );
  }

  renderComposer() {
    const S = this.state;
    const busy = S.streaming;
    return (
      <div style={sx('border-top:1px solid var(--line);padding:12px 28px 16px;background:var(--ink)')}>
        <div style={{ ...sx('display:flex;gap:9px;align-items:flex-end;border-radius:11px;background:var(--surface);padding:9px 10px 9px 13px'), border: '1px solid var(--border-2)' }}>
          <textarea ref={this.taRef} value={S.input} rows={1} placeholder={busy ? 'Working…' : 'Describe the tool you want…'}
            onChange={e => {
              this.setState({ input: e.target.value });
              const el = e.target; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 180) + 'px';
            }}
            onKeyDown={e => {
              e.stopPropagation(); // App.jsx owns global single-letter hotkeys
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
            }}
            style={{ ...sx('flex:1;min-width:0;resize:none;background:transparent;border:none;color:var(--fg);line-height:1.55;padding:3px 0;max-height:180px'), fontSize: 12.5, fontFamily: 'inherit' }} />
          {S.streaming ? (
            <span onClick={() => this.activeId() && api.cancelChatTurn(this.activeId()).catch(() => {})} className="hBd"
              style={sx('flex:none;font-size:11px;font-weight:700;border-radius:8px;padding:7px 13px;cursor:pointer;border:1px solid var(--border-2);color:var(--fg-muted)')}>Stop</span>
          ) : (
            <span onClick={() => this.send()} className="hBtnAccent"
              style={{ ...sx('flex:none;font-size:11px;font-weight:700;border-radius:8px;padding:7px 15px;cursor:pointer;background:var(--accent);color:var(--on-accent)'), opacity: S.input.trim() && !busy ? 1 : .45, pointerEvents: S.input.trim() && !busy ? 'auto' : 'none' }}>Send</span>
          )}
        </div>
      </div>
    );
  }

  // The rail: the tool taking shape. Every slot is an em-dash until the agent fills it, so the
  // filmmaker can see the shape of what they're making before it exists.
  renderRail() {
    const draft = this.latestDraft();
    const { tools } = this.state;
    const slot = (k, v) => (
      <div key={k} style={sx('display:flex;flex-direction:column;gap:3px')}>
        <span style={{ ...sx('color:var(--fg-faint);letter-spacing:.08em;text-transform:uppercase'), fontFamily: MONO, fontSize: 9 }}>{k}</span>
        <span style={{ ...sx('font-size:11.5px;line-height:1.5'), color: v ? 'var(--fg-soft)' : 'var(--border-3)' }}>{v || '—'}</span>
      </div>
    );
    return (
      <div style={sx('width:290px;flex:none;border-left:1px solid var(--line);background:var(--ink);padding:20px 18px;display:flex;flex-direction:column;gap:18px')}>
        <div>
          <div style={{ ...sx('font-size:10px;font-weight:800;letter-spacing:.12em;color:var(--fg-faint);margin-bottom:12px'), fontFamily: MONO }}>THE TOOL</div>
          <div style={sx('display:flex;flex-direction:column;gap:12px')}>
            {slot('name', draft && draft.name)}
            {slot('id', draft && draft.id)}
            {slot('capability', draft && (draft.capability || draft.summary))}
          </div>
        </div>

        <div style={sx('border-top:1px solid var(--line);padding-top:16px')}>
          <div style={sx('font-size:11px;color:var(--fg-faint);line-height:1.65')}>
            A tool is instructions the agent follows. It's saved to your workspace as markdown, and it
            stays <b style={sx('color:var(--fg-muted)')}>off</b> until you switch it on in Settings → Chat tools.
          </div>
        </div>

        {tools.length ? (
          <div style={sx('border-top:1px solid var(--line);padding-top:16px')}>
            <div style={{ ...sx('font-size:10px;font-weight:800;letter-spacing:.12em;color:var(--fg-faint);margin-bottom:10px'), fontFamily: MONO }}>YOUR TOOLS · {tools.length}</div>
            <div style={sx('display:flex;flex-direction:column;gap:7px')}>
              {tools.slice(0, 8).map(t => (
                <div key={t.id} style={sx('display:flex;align-items:center;gap:7px')}>
                  <span style={{ width: 5, height: 5, borderRadius: 99, flex: 'none', background: t.enabled ? 'var(--ok)' : 'var(--border-2)' }} />
                  <span style={sx('font-size:11px;color:var(--fg-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{t.name}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }
}
