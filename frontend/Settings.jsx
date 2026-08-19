// Settings — sectioned layout.
// GENERAL · CLAUDE · PROVIDERS & MODELS · SHORTCUTS, with a sticky anchor nav.
import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { KEY_ACTIONS, FIXED_KEYS, RESERVED, resolveKeys, keyLabel } from './keymap';
import { CHAT_TOOLS } from '../shared/chatTools.mjs';
import { MONO } from './tokens';

// Card label register (DESIGN.md "Labels"): uppercase, tracked, --fg-muted — the section eyebrow
// above a card's controls. --fg-faint stays the de-emphasis tier (hints, dim meta), not labels.
const label = t => <div style={sx('font-size:10.5px;font-weight:700;letter-spacing:.14em;color:var(--fg-muted);margin-bottom:9px')}>{t}</div>;
const hint = kids => <div style={sx('font-size:10.5px;color:var(--fg-faint);margin-top:7px;line-height:1.55')}>{kids}</div>;
const mono = (t, c) => <span style={{ fontFamily: MONO, fontSize: 10, color: c || 'inherit' }}>{t}</span>;

const badge = (text, tone) => {   // tone: ok | warn | off
  // Status is a separate channel (DESIGN.md): warn is --warn, never the accent — the accent means
  // "click this" and a status pill is not clickable.
  const c = tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : 'var(--fg-faint)';
  const b = tone === 'ok' ? 'rgba(63,207,142,.4)' : tone === 'warn' ? 'var(--border-3)' : 'var(--border-2)';
  return <span style={{ ...sx('font-size:9px;font-weight:800;letter-spacing:.08em;border-radius:99px;padding:2.5px 9px;flex:none;white-space:nowrap'), color: c, border: '1px solid ' + b }}>{text}</span>;
};

const SECTIONS = [
  ['general', 'General'],
  ['claude', 'Claude'],
  ['providers', 'Providers & models'],
  ['chat-tools', 'Chat tools'],
  ['shortcuts', 'Shortcuts & snippets']
];

export default class SettingsPage extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      // deep-link target: a chat "enable this tool" notice navigates here with settingsNav set
      nav: (props.app && props.app.state && props.app.state.settingsNav) || 'general',
      open: {},                            // per-provider model manager expanded?
      capture: null,                       // action id currently being rebound
      snipEdit: null                       // snippet editor draft {file?, name, trigger, content}
    };
  }
  componentDidMount() {
    // the settingsNav deep-link is one-shot: consume it so re-opening Settings later lands on General
    if (this.props.app.state.settingsNav) this.props.app.setState({ settingsNav: null });
    // ticket 25 — the chat-tools switchboard reads the SERVER list, not the static CHAT_TOOLS
    // import, so tools the filmmaker authored get a toggle row too. Fetched once here because
    // Settings deliberately ignores server-pushed state while it is open (App.jsx sync guard).
    api.userTools().then(r => this.setState({ userTools: (r && r.tools) || [] })).catch(() => { });
    this.props.app.reloadSnippets();
    // key capture runs in the CAPTURE phase so the app-level keymap (bubble phase on
    // window) never reacts to the key being bound
    this._cap = e => {
      if (!this.state.capture) return;
      e.preventDefault(); e.stopPropagation();
      const app = this.props.app, id = this.state.capture;
      if (e.key === 'Escape') { this.setState({ capture: null }); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;           // wait for a plain key
      if (['Shift', 'CapsLock', 'Fn', 'Meta', 'Control', 'Alt'].includes(e.key)) return;
      const key = e.key === ' ' ? ' ' : e.key.toLowerCase();
      if (RESERVED.has(key) || key.length > 1) { app.showToast(keyLabel(key) + ' is reserved — pick a letter, digit or symbol', 'var(--danger)'); return; }
      const K = resolveKeys(app.state.settings);
      const clash = KEY_ACTIONS.find(a => a.id !== id && K[a.id] === key);
      if (clash) { app.showToast(keyLabel(key) + ' is already "' + clash.label + '" — unbind or pick another', 'var(--danger)'); return; }
      app.saveSettings({ keys: { ...(app.state.settings.keys || {}), [id]: key } });
      app.showToast(keyLabel(key) + ' → ' + KEY_ACTIONS.find(a => a.id === id).label, 'var(--ok)');
      this.setState({ capture: null });
    };
    window.addEventListener('keydown', this._cap, true);
  }
  componentWillUnmount() { window.removeEventListener('keydown', this._cap, true); }

  async saveSnippet() {
    const app = this.props.app, d = this.state.snipEdit;
    if (!d || !d.name.trim() || !d.content.trim()) { app.showToast('Snippet needs a name and content', 'var(--danger)'); return; }
    try {
      if (d.file) await api.patchSnippet(d.file, { name: d.name, trigger: d.trigger, content: d.content });
      else await api.saveSnippet(d.name, d.trigger, d.content);
      app.reloadSnippets();
      app.showToast('Snippet saved — type /' + (d.trigger || d.name.replace(/ +/g, '-').toLowerCase()) + ' anywhere', 'var(--ok)');
      this.setState({ snipEdit: null });
    } catch (e) { app.showToast('Save failed — ' + e.message, 'var(--danger)'); }
  }

  // ── provider readiness (mirrors the logic previously inlined per row) ──
  connState(pid) {
    const A = this.props.app.state, st = A.settings;
    if (pid === 'groq') return A.groqReady || st.groqApiKey ? ['CONNECTED', 'ok'] : ['NO KEY', 'off'];
    return ['—', 'off'];
  }
  connected(pid) { return this.connState(pid)[1] !== 'off'; }

  // ── shared row pieces ──
  input(key, placeholder, password) {
    const app = this.props.app;
    return (
      <input value={app.state.settings[key] || ''} onChange={e => app.saveSettings({ [key]: e.target.value.trim() })}
        type={password ? 'password' : 'text'} placeholder={placeholder} onKeyDown={e => e.stopPropagation()}
        style={{ ...sx('flex:1;min-width:0;background:var(--ink);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);padding:8px 12px'), fontFamily: MONO, fontSize: 11 }} />
    );
  }
  toggle(on, onClick) {
    return (
      <div onClick={onClick} style={{ ...sx('width:34px;height:19px;border-radius:99px;position:relative;transition:background .15s;cursor:pointer;flex:none'), background: on ? 'var(--accent)' : 'var(--border-2)' }}>
        <div style={{ ...sx('position:absolute;top:2px;width:15px;height:15px;border-radius:99px;transition:left .15s'), left: on ? 17 : 2, background: on ? 'var(--on-accent)' : 'var(--fg)' }} />
      </div>
    );
  }
  card(kids, style) {
    // r10 — the app's one card radius (frontend/ui.jsx Card / chat CardShell); 12 is the media-tile step
    return <div style={{ ...sx('border:1px solid var(--border);border-radius:10px;background:var(--surface);padding:16px 18px'), ...style }}>{kids}</div>;
  }

  // ── Chat tools switchboard (ticket 15) ────────────────────────────────────────────────
  // GLOBAL DEFAULTS ONLY. A tool is enabled PER PROJECT, from the chat's Production rail → TOOLS
  // (frontend/chat/ProductionPanel.renderTools), which writes that project's project.md. What this
  // page sets is the default a project inherits while it has no opinion of its own — plus the only
  // layer a standalone, project-less chat ever resolves against.
  //
  // Persist in settings.enabledChatTools (the key agentHome.listChatTools reads as its fallback
  // layer) — a sparse map, so every tool stays OFF until explicitly turned on (hackathon compliance).
  // Separate from the Filmmaker Chat module toggle: the module gates the whole surface, these gate
  // individual capabilities within it.
  setChatTool(id, on) {
    const app = this.props.app;
    const cur = (app.state.settings && app.state.settings.enabledChatTools) || {};
    app.saveSettings({ enabledChatTools: { ...cur, [id]: on } });
  }
  renderChatTools() {
    const app = this.props.app;
    const st = app.state.settings || {};
    const on = (st.enabledChatTools) || {};
    return (
      <>
        <div style={sx('border:1px solid var(--accent-35);border-radius:10px;background:var(--accent-05);padding:12px 16px;margin-bottom:16px;font-size:11.5px;color:var(--fg-soft);line-height:1.6')}>
          These are <b>global defaults</b>, not the switches you use day to day. Tools are enabled
          <b> per project</b> — open a project’s <b>Agent</b> tab and use the Production rail’s <b>TOOLS</b> section.
          A project inherits what you set here until you set it there.
        </div>
        <div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(430px,1fr));gap:14px')}>
          {[...CHAT_TOOLS, ...(this.state.userTools || [])].map(t => {
            const enabled = Object.prototype.hasOwnProperty.call(on, t.id) ? !!on[t.id] : false;
            return (
              <div key={t.id} style={{ ...sx('border-radius:10px;background:var(--surface);padding:16px 18px'), border: '1px solid ' + (enabled ? 'var(--border-2)' : 'var(--line)'), opacity: enabled ? 1 : .72 }}>
                <div style={sx('display:flex;align-items:center;gap:10px')}>
                  <span style={sx('font-size:13.5px;font-weight:800')}>{t.name}</span>
                  {t.source === 'user' && <span style={{ ...sx('font-size:9px;color:var(--fg-faint);border:1px solid var(--border-2);border-radius:99px;padding:1.5px 8px;flex:none'), fontFamily: MONO }}>built by you</span>}
                  <span onClick={() => this.setChatTool(t.id, !enabled)} title={enabled ? 'Turn off' : 'Turn on'}
                    style={{ ...sx('margin-left:auto;width:38px;height:21px;border-radius:99px;cursor:pointer;flex:none;position:relative;transition:background .15s'), background: enabled ? 'var(--accent)' : 'var(--border-2)' }}>
                    <span style={{ ...sx('position:absolute;top:3px;width:15px;height:15px;border-radius:99px;background:var(--on-accent);transition:left .15s'), left: enabled ? 20 : 3 }} />
                  </span>
                </div>
                <div style={sx('font-size:11.5px;color:var(--fg-muted);line-height:1.55;margin-top:8px')}>{t.capability}</div>
                <div style={{ ...sx('display:flex;gap:8px;margin-top:9px;border-top:1px solid var(--line);padding-top:9px'), fontFamily: MONO, fontSize: 9, color: 'var(--fg-faint)' }}>
                  <span style={sx('flex:none;width:62px;color:var(--fg-faint)')}>directives</span>
                  <span style={sx('overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{(t.directiveTypes || []).join(' · ') || '—'}</span>
                </div>
              </div>
            );
          })}
        </div>
        {hint('Each tool defaults OFF. A project that has not set a tool itself inherits the value here; enabling one adds its capability to the next chat session’s Index and lets its cards render inline, disabling hides it from the agent and turns its cards into an enable-notice. Per-project overrides live in the Agent tab’s Production rail → TOOLS.')}
      </>
    );
  }

  sectionHead(id, title, sub) {
    return (
      <div id={'set-' + id} style={sx('display:flex;align-items:baseline;gap:14px;margin:0 0 16px')}>
        <span style={sx('font-size:13px;font-weight:800;letter-spacing:.14em;color:var(--fg)')}>{title.toUpperCase()}</span>
        {sub && <span style={sx('font-size:10.5px;color:var(--fg-faint)')}>{sub}</span>}
        <span style={sx('flex:1;height:1px;background:var(--line);align-self:center')} />
      </div>
    );
  }

  // ── one provider card: header · key/CLI row ──
  providerCard(pid, title, tagline, keyRow, info) {
    const [stText, tone] = this.connState(pid);
    return (
      <div key={pid} style={{ ...sx('border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:15px 18px;display:flex;flex-direction:column'), gridColumn: this.state.open[pid] ? '1 / -1' : 'auto', borderColor: tone === 'ok' ? 'rgba(63,207,142,.28)' : 'var(--border)' }}>
        <div style={sx('display:flex;align-items:center;gap:10px;margin-bottom:10px')}>
          <span style={sx('font-size:13px;font-weight:800')}>{title}</span>
          <span style={sx('font-size:10px;color:var(--fg-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{tagline}</span>
          <span style={sx('margin-left:auto;flex:none')}>{badge(stText, tone)}</span>
          {this.props.app.keyTestBtn(pid)}
        </div>
        {keyRow}
        {info && hint(info)}
      </div>
    );
  }

  render() {
    const app = this.props.app;
    const A = app.state;
    const st = A.settings;
    const S = this.state;
    const goSec = id => this.setState({ nav: id });   // tabs — only the active section renders

    return (
      <div style={sx('padding:24px 32px 90px;display:grid;grid-template-columns:180px minmax(0,1fr);gap:0 42px;align-items:start')}>
        {/* sticky anchor nav */}
        <div style={sx('position:sticky;top:24px')}>
          <div style={sx('font-weight:800;font-size:16px;margin-bottom:16px')}>Settings</div>
          {SECTIONS.map(([id, l]) => (
            <div key={id} onClick={() => goSec(id)} className="hFg"
              style={{ ...sx('font-size:11.5px;padding:6px 10px;border-radius:7px;cursor:pointer;margin-bottom:2px'), color: S.nav === id ? 'var(--fg)' : 'var(--fg-faint)', background: S.nav === id ? 'var(--surface-2)' : 'transparent', borderLeft: '2px solid ' + (S.nav === id ? 'var(--accent)' : 'transparent'), fontWeight: S.nav === id ? 700 : 400 }}>{l}</div>
          ))}
          <div style={sx('font-size:9.5px;color:var(--fg-faint);margin-top:16px;padding:0 10px;line-height:1.6')}>Everything saves live to {mono('settings.md')} — no save button.</div>
        </div>

        <div style={sx('min-width:0')}>
          {/* ═══ GENERAL ═══ */}
          {S.nav === 'general' && <>
          {this.sectionHead('general', 'General', 'storage · budget · behavior')}
          <div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(430px,1fr));gap:14px')}>
            {this.card(<>
              {label('STORAGE ROOT')}
              <div style={sx('display:flex;align-items:center;gap:10px')}>
                <div style={{ ...sx('flex:1;min-width:0;padding:9px 13px;border:1px solid var(--border);border-radius:8px;background:var(--ink);color:var(--fg-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 11 }}>{A.storageRoot}</div>
                <div onClick={async () => { const b = await api.browse(A.storageRoot); app.setState({ browser: b }); }} className="hBd" style={sx('padding:8px 14px;border:1px solid var(--border-2);border-radius:8px;font-size:12px;color:var(--fg-soft);font-weight:600;cursor:pointer;flex:none')}>Change…</div>
              </div>
              {hint(<>Everything — metadata, prompts, generations, the model catalog mirror — lives here as plain {mono('.md')} files. 100% portable.</>)}
            </>)}
            {this.card(<>
              {label('MONTHLY BUDGET')}
              <div style={sx('display:flex;align-items:center;gap:10px')}>
                <span style={{ fontFamily: MONO, color: 'var(--accent)', fontSize: 14 }}>$</span>
                <input value={st.budget} onChange={e => app.saveSettings({ budget: Math.max(1, +e.target.value || 60) })} type="number" onKeyDown={e => e.stopPropagation()}
                  style={{ ...sx('width:90px;background:var(--ink);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);padding:8px 12px'), fontFamily: MONO, fontSize: 13 }} />
                <span style={sx('font-size:11px;color:var(--fg-faint)')}>drives the pace indicator in the top bar</span>
              </div>
            </>)}
            {this.card(<>
              {label('REVIEW MODE')}
              <div style={sx('display:flex;align-items:center;gap:10px')}>
                {this.toggle(!!st.showHints, () => app.saveSettings({ showHints: !st.showHints }))}
                <span style={sx('font-size:12px')}>Show keyboard hints in review mode</span>
              </div>
            </>)}
          </div>

          </>}

          {/* ═══ CLAUDE ═══ */}
          {S.nav === 'claude' && <>
          {this.sectionHead('claude', 'Claude', 're-rolls · skill enhancement · Arcads driver')}
          <div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(520px,1fr));gap:14px;align-items:start')}>
            <div style={sx('display:flex;flex-direction:column;gap:14px')}>
              {app.renderAgentWizard()}
              {this.card(<>
                {label('CHAT MEMORY — DISTILL LEARNINGS ON SESSION CLOSE')}
                <div style={sx('display:flex;align-items:center;gap:10px')}>
                  {this.toggle(st.chatAutoDistill !== false, () => app.saveSettings({ chatAutoDistill: st.chatAutoDistill === false }))}
                  <span style={sx('font-size:12px')}>Auto-distill durable learnings into project memory</span>
                </div>
                {hint(<>Every filmmaker chat opens with the project brief and memory hot-cache already in context. When a session closes or goes idle, a cheap pass extracts locked directions, decisions and your corrections into the project&rsquo;s {mono('memory.md')} &mdash; deduplicated against what&rsquo;s already there. Off = only the manual &ldquo;save learnings&rdquo; action writes memory.</>)}
              </>)}
            </div>
            <div>
              {label('SKILL REPOSITORIES')}
              <div style={sx('display:flex;flex-direction:column;gap:6px')}>
                {A.skillRepos.map((r, i) => (
                  <div key={i} style={sx('padding:10px 13px;border:1px solid var(--border);border-radius:8px;background:var(--surface)')}>
                    <div style={sx('display:flex;align-items:center;gap:9px')}>
                      <span style={sx('font-size:12.5px;font-weight:600')}>{r.name}</span>
                      {r.exists ? badge(r.skills.length + ' SKILL' + (r.skills.length === 1 ? '' : 'S') + ' LOADED', 'ok') : badge('MISSING', 'off')}
                      <span onClick={() => {
                        app.saveSettings({ skillRepos: (st.skillRepos || []).filter(x => x.name !== r.name) });
                        app.showToast('Repository "' + r.name + '" removed — skills on disk untouched', 'var(--accent)');
                        setTimeout(() => app.sync(), 500);
                      }} className="hFgL" style={sx('margin-left:auto;font-size:11px;color:var(--fg-faint);cursor:pointer')}>✕</span>
                    </div>
                    <div style={sx('display:flex;flex-direction:column;gap:2px;margin-top:5px')}>
                      {r.paths.map((p, k) => <span key={k} style={{ ...sx('color:var(--fg-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 10 }}>{p}</span>)}
                    </div>
                    {r.skills.length > 0 && (
                      <div style={sx('display:flex;gap:5px;flex-wrap:wrap;margin-top:8px')}>
                        {r.skills.map((s, j) => <span key={j} title={s.description} onClick={() => { app.go('skills'); app.openSkill(s); }} className="hBdAccentChip" style={{ ...sx('font-size:9.5px;color:var(--fg-muted);border:1px solid var(--border-2);border-radius:6px;padding:2px 7px;cursor:pointer'), fontFamily: MONO }}>{s.name} · {s.files.length}f</span>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div style={sx('display:flex;align-items:center;gap:8px;margin-top:8px')}>
                <input value={A.repoName || ''} onChange={e => app.setState({ repoName: e.target.value })}
                  placeholder="repo name" onKeyDown={e => e.stopPropagation()}
                  style={sx('width:130px;background:var(--surface);border:1px solid var(--border-2);border-radius:7px;color:var(--fg);font-size:11px;padding:7px 10px')} />
                <input value={A.repoPath || ''} onChange={e => app.setState({ repoPath: e.target.value })}
                  placeholder="/path/to/skills (a folder with SKILL.md)" onKeyDown={e => e.stopPropagation()}
                  style={{ ...sx('flex:1;min-width:0;background:var(--surface);border:1px solid var(--border-2);border-radius:7px;color:var(--fg);padding:7px 10px'), fontFamily: MONO, fontSize: 10.5 }} />
                <div onClick={() => {
                  const name = (A.repoName || '').trim(), p = (A.repoPath || '').trim();
                  if (!name || !p) { app.showToast('Name and path required', 'var(--danger)'); return; }
                  app.saveSettings({ skillRepos: [...(st.skillRepos || []), { name, paths: [p] }] });
                  app.setState({ repoName: '', repoPath: '' });
                  app.showToast('Repository "' + name + '" added — scanning', 'var(--ok)');
                  setTimeout(() => app.sync(), 500);
                }} className="hBdAccent" style={sx('padding:7px 13px;border:1px solid var(--accent-35);border-radius:7px;font-size:11px;font-weight:600;color:var(--accent);cursor:pointer;flex:none')}>+ Add</div>
                <div onClick={() => { app.sync(); app.showToast('Skill repositories rescanned', 'var(--accent)'); }} className="hBd" style={sx('padding:7px 13px;border:1px solid var(--border-2);border-radius:7px;font-size:11px;color:var(--fg-soft);font-weight:600;cursor:pointer;flex:none')}>Rescan</div>
              </div>
              {hint(<>Real Claude skills ({mono('SKILL.md')} folders), injected into every background agent run. Fresh installs point at {mono('~/.claude/skills')} automatically.</>)}
            </div>
          </div>

          </>}

          {/* ═══ PROVIDERS & MODELS ═══ */}
          {S.nav === 'providers' && <>
          {this.sectionHead('providers', 'Providers & models', 'one card per provider — key and live status')}
          <div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(520px,1fr));gap:14px;align-items:start')}>
            {this.providerCard('groq', 'Groq', 'session distillation — free tier',
              <>
                <div style={sx('display:flex;align-items:center;gap:10px')}>{this.input('groqApiKey', 'gsk_…', true)}</div>
              </>,
              <>{mono(st.groqTextModel || 'llama-3.3-70b-versatile')} turns a closed chat session into durable learnings — locked directions, decisions and corrections distilled into the project&rsquo;s memory. Free tier.</>)}
          </div>

          </>}

          {/* ═══ CHAT TOOLS ═══ */}
          {S.nav === 'chat-tools' && <>
          {this.sectionHead('chat-tools', 'Chat tools', 'the tools the chat agent can use — all off by default; each becomes an Index line when on')}
          {this.renderChatTools()}
          </>}

          {/* ═══ SHORTCUTS ═══ */}
          {S.nav === 'shortcuts' && (() => {
            const K = resolveKeys(st);
            const overridden = st.keys && Object.keys(st.keys).length > 0;
            const groups = [...new Set(KEY_ACTIONS.map(a => a.ctx))];
            const snips = app.state.snippets || [];
            const d = S.snipEdit;
            const inp = (v, on, ph, monoFont) => (
              <input value={v} onChange={on} placeholder={ph} onKeyDown={e => e.stopPropagation()}
                style={{ ...sx('flex:1;min-width:0;background:var(--ink);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);padding:8px 12px'), fontFamily: monoFont ? MONO : 'inherit', fontSize: monoFont ? 11 : 12 }} />
            );
            return <>
            {this.sectionHead('shortcuts', 'Shortcuts & snippets', 'click a key to rebind · snippets expand with / in any smart text field')}
            {this.card(<>
              <div style={sx('display:flex;align-items:baseline;gap:12px;margin-bottom:12px')}>
                {label('KEYBOARD MAP')}
                {overridden && <span onClick={() => { app.saveSettings({ keys: {} }); app.showToast('Shortcuts reset to defaults', 'var(--fg-muted)'); }}
                  className="hFgL" style={sx('margin-left:auto;font-size:10px;color:var(--fg-faint);cursor:pointer;font-weight:700;letter-spacing:.08em')}>RESET TO DEFAULTS</span>}
              </div>
              <div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px 28px')}>
                {groups.map(g => (
                  <div key={g}>
                    <div style={{ ...sx('font-size:9px;font-weight:800;letter-spacing:.14em;color:var(--fg-faint);margin-bottom:8px'), fontFamily: MONO }}>{g.toUpperCase()}</div>
                    {KEY_ACTIONS.filter(a => a.ctx === g).map(a => {
                      const capturing = S.capture === a.id, custom = st.keys && st.keys[a.id] && st.keys[a.id] !== a.def;
                      return (
                        <div key={a.id} style={sx('display:flex;align-items:center;gap:10px;padding:3.5px 0;font-size:11.5px;color:var(--fg-muted)')}>
                          <span onClick={() => this.setState({ capture: capturing ? null : a.id })}
                            className="hBd" style={{
                              ...sx('min-width:46px;text-align:center;flex:none;border-radius:6px;padding:3px 8px;cursor:pointer;font-weight:700'),
                              fontFamily: MONO, fontSize: 10.5,
                              color: capturing ? 'var(--on-accent)' : custom ? 'var(--accent)' : 'var(--fg)',
                              background: capturing ? 'var(--accent)' : 'var(--ink)',
                              border: '1px solid ' + (capturing ? 'var(--accent)' : custom ? 'var(--accent-35)' : 'var(--border-2)')
                            }}>{capturing ? 'press…' : keyLabel(K[a.id])}</span>
                          <span>{a.label}</span>
                          {custom && !capturing && <span style={{ ...sx('font-size:9px;color:var(--fg-faint)'), fontFamily: MONO }}>was {keyLabel(a.def)}</span>}
                        </div>
                      );
                    })}
                  </div>
                ))}
                <div>
                  <div style={{ ...sx('font-size:9px;font-weight:800;letter-spacing:.14em;color:var(--fg-faint);margin-bottom:8px'), fontFamily: MONO }}>FIXED</div>
                  {FIXED_KEYS.map(([k2, d2], i) => (
                    <div key={i} style={sx('display:flex;align-items:center;gap:10px;padding:3.5px 0;font-size:11.5px;color:var(--fg-faint)')}>
                      <span style={{ ...sx('min-width:46px;text-align:center;flex:none'), fontFamily: MONO, fontSize: 10.5, color: 'var(--fg-muted)' }}>{k2}</span><span>{d2}</span>
                    </div>
                  ))}
                </div>
              </div>
              {hint('Click a key chip, then press the new key. Esc cancels. Letters, digits and symbols work; Esc, Enter, Tab, arrows and 1–5 stay reserved.')}
            </>)}

            <div style={sx('height:14px')} />
            {this.card(<>
              <div style={sx('display:flex;align-items:baseline;gap:12px;margin-bottom:12px')}>
                {label('QUICK SNIPPETS')}
                {/* margin-left:auto moved onto the first of the pair so the two controls
                    right-align as one cluster instead of splitting across the row */}
                <span onClick={async () => {
                  const r = await api.seedSnippets().catch(() => null);
                  if (!r) return app.showToast('Could not install the starter pack', 'var(--danger)');
                  app.reloadSnippets();
                  if (r.added) app.showToast('Starter pack installed — ' + r.added + ' snippets added', 'var(--accent)');
                  else app.showToast('Starter snippets already installed', 'var(--fg-muted)');
                }}
                  className="hBd" style={sx('margin-left:auto;font-size:10px;font-weight:700;border:1px solid var(--border-2);border-radius:8px;padding:5px 11px;cursor:pointer;color:var(--fg-muted)')}>↻ STARTER PACK</span>
                <span onClick={() => this.setState({ snipEdit: { name: '', trigger: '', content: '' } })}
                  className="hBd" style={sx('font-size:10px;font-weight:700;border:1px solid var(--border-2);border-radius:8px;padding:5px 11px;cursor:pointer;color:var(--fg-soft)')}>+ NEW SNIPPET</span>
              </div>
              {snips.length === 0 && !d && <div style={sx('font-size:11.5px;color:var(--fg-faint)')}>No snippets yet. Hit <span style={{ color: 'var(--fg-soft)' }}>↻ STARTER PACK</span> for a curated set of re-roll notes, look fragments, camera moves, continuity anchors and negative guardrails — or write your own. Either way they expand anywhere by typing <span style={{ fontFamily: MONO, color: 'var(--accent)' }}>/trigger</span> in re-roll notes, the prompt builder, shot prompts or context notes.</div>}
              {snips.map(sn => (
                <div key={sn.file} style={sx('display:flex;align-items:baseline;gap:12px;padding:7px 0;border-bottom:1px solid var(--surface-2);font-size:11.5px')}>
                  <span style={{ ...sx('flex:none;min-width:90px'), fontFamily: MONO, fontSize: 10.5, color: 'var(--accent)' }}>/{sn.trigger}</span>
                  <span style={sx('flex:none;color:var(--fg);font-weight:600')}>{sn.name}</span>
                  <span style={sx('flex:1;color:var(--fg-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{sn.content}</span>
                  <span onClick={() => this.setState({ snipEdit: { file: sn.file, name: sn.name, trigger: sn.trigger, content: sn.content } })} className="hFgL" style={sx('flex:none;color:var(--fg-muted);cursor:pointer')}>edit</span>
                  <span onClick={async () => { await api.deleteSnippet(sn.file).catch(() => { }); app.reloadSnippets(); app.showToast('Snippet /' + sn.trigger + ' deleted', 'var(--fg-muted)'); }}
                    className="hFgL" style={sx('flex:none;color:var(--danger);cursor:pointer')}>delete</span>
                </div>
              ))}
              {d && (
                <div style={sx('margin-top:12px;border:1px solid var(--accent-35);border-radius:10px;padding:12px;background:var(--ink)')}>
                  <div style={sx('display:flex;gap:10px;margin-bottom:8px')}>
                    {inp(d.name, e => this.setState({ snipEdit: { ...d, name: e.target.value } }), 'name (e.g. Lock camera)')}
                    {inp(d.trigger, e => this.setState({ snipEdit: { ...d, trigger: e.target.value.toLowerCase().replace(/[^\w-]+/g, '') } }), 'trigger (e.g. lock)', true)}
                  </div>
                  <textarea value={d.content} onChange={e => this.setState({ snipEdit: { ...d, content: e.target.value } })}
                    onKeyDown={e => e.stopPropagation()} placeholder="The text that gets inserted." rows={3}
                    style={sx('width:100%;box-sizing:border-box;resize:vertical;background:var(--surface);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);font-size:12px;line-height:1.55;padding:9px 11px')} />
                  <div style={sx('display:flex;gap:8px;justify-content:flex-end;margin-top:8px;font-size:11px')}>
                    <span onClick={() => this.setState({ snipEdit: null })} className="hFgL" style={sx('color:var(--fg-faint);cursor:pointer;padding:4px 9px')}>Cancel</span>
                    <span onClick={() => this.saveSnippet()} style={sx('background:var(--accent);color:var(--on-accent);font-weight:800;border-radius:8px;padding:4px 13px;cursor:pointer')}>Save snippet</span>
                  </div>
                </div>
              )}
              {hint(<>Stored as portable markdown in {mono('snippets/*.md')} under your storage root — same convention as prompts and looks.</>)}
            </>)}
            </>;
          })()}
        </div>
      </div>
    );
  }
}
