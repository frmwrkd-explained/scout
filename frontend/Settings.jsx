// Settings — sectioned layout.
// GENERAL · CLAUDE · PROVIDERS & MODELS · INTEGRATIONS · SHORTCUTS, with a sticky anchor nav.
// Every generation provider gets ONE card: key/CLI + live status + Test + an inline model
// manager (enable/disable per model). FAL additionally mirrors the FULL fal.ai catalog
// locally (Settings → Sync catalog → server → api.fal.ai/v1/models → catalog/fal.md), so any
// of fal's ~700 endpoints can be enabled — enabled extras persist as settings.customModels
// and flow straight into Generate/Prompt Builder via enabledCatalog(). Kie.ai has no public
// model-list API (verified: GET /api/v1/models → 404) and Higgsfield/Arcads are CLI/MCP
// surfaces — those keep the curated list.
import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { MODELS, PROVIDERS, KINDS, providerDef, customModels } from './models';
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

const relTime = iso => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  if (m < 48 * 60) return Math.round(m / 60) + 'h ago';
  return Math.round(m / 1440) + 'd ago';
};

const SECTIONS = [
  ['general', 'General'],
  ['claude', 'Claude'],
  ['providers', 'Providers & models'],
  ['integrations', 'Integrations'],
  ['chat-tools', 'Chat tools'],
  ['shortcuts', 'Shortcuts & snippets']
];

export default class SettingsPage extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      // deep-link target: a chat "enable this tool" notice navigates here with settingsNav set
      nav: (props.app && props.app.state && props.app.state.settingsNav) || 'general',
      falCat: null, falCatBusy: false,     // local mirror of the full fal.ai catalog
      open: {},                            // per-provider model manager expanded?
      q: {}, kindF: {},                    // per-provider search + kind filter
      capture: null,                       // action id currently being rebound
      snipEdit: null                       // snippet editor draft {file?, name, trigger, content}
    };
  }
  componentDidMount() {
    // the settingsNav deep-link is one-shot: consume it so re-opening Settings later lands on General
    if (this.props.app.state.settingsNav) this.props.app.setState({ settingsNav: null });
    api.falCatalog().then(c => this.setState({ falCat: c })).catch(() => { });
    // ticket 25 — the chat-tools switchboard reads the SERVER list, not the static CHAT_TOOLS
    // import, so tools the filmmaker authored get a toggle row too. Fetched once here because
    // Settings deliberately ignores server-pushed state while it is open (App.jsx sync guard).
    api.userTools().then(r => this.setState({ userTools: (r && r.tools) || [] })).catch(() => { });
    // silent probe (no toast) — populates the local-transcriber status line on load; the
    // Test button next to it (app.testKey('local-asr')) re-probes on demand and does toast
    fetch('/api/test/local-asr').then(r => r.json()).then(st => this.setState({ localAsrStatus: st })).catch(() => { });
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
    const A = this.props.app.state, st = A.settings, kt = (A.keyTest || {});
    if (pid === 'groq') return A.groqReady || st.groqApiKey ? ['CONNECTED', 'ok'] : ['NO KEY', 'off'];
    if (pid === 'fal') return A.falReady || st.falApiKey ? ['CONNECTED', 'ok'] : ['NO KEY', 'off'];
    if (pid === 'kie') return (A.kieReady || st.kieApiKey || (A.providers || {}).kie) ? ['CONNECTED', 'ok'] : ['NO KEY', 'off'];
    if (pid === 'higgsfield') return kt.higgsfield?.ok ? ['SIGNED IN', 'ok'] : (A.providers || {}).higgsfield ? ['INSTALLED · TEST TO SIGN IN', 'warn'] : ['NOT FOUND', 'off'];
    if (pid === 'arcads') return kt.arcads?.ok ? ['CONNECTED', 'ok'] : (A.providers || {}).arcads ? ['CLAUDE FOUND · TEST IT', 'warn'] : ['NO CLAUDE', 'off'];
    return ['—', 'off'];
  }
  connected(pid) { return this.connState(pid)[1] !== 'off'; }

  // ── model toggling: curated → disabledModels · custom (synced fal extras) → customModels ──
  toggleCurated(id) {
    const app = this.props.app, st = app.state.settings;
    const off = new Set(st.disabledModels || []);
    const next = off.has(id) ? (st.disabledModels || []).filter(x => x !== id) : [...(st.disabledModels || []), id];
    app.saveSettings({ disabledModels: next });
    app.showToast(id + (off.has(id) ? ' enabled' : ' disabled — hidden from Generate'), off.has(id) ? 'var(--ok)' : 'var(--fg-muted)');
  }
  enableCustom(row) {
    const app = this.props.app, st = app.state.settings;
    const entry = { id: row.id, provider: 'fal', kind: row.kind, label: row.label, note: row.note || row.category || '' };
    app.saveSettings({ customModels: [...(st.customModels || []), entry] });
    app.showToast(row.label + ' enabled — now in Generate + Prompt Builder', 'var(--ok)');
  }
  disableCustom(id) {
    const app = this.props.app, st = app.state.settings;
    app.saveSettings({ customModels: (st.customModels || []).filter(m => m.id !== id) });
    app.showToast(id + ' removed', 'var(--fg-muted)');
  }
  async syncFal() {
    const app = this.props.app;
    if (this.state.falCatBusy) return;
    this.setState({ falCatBusy: true });
    try {
      const r = await api.syncFalCatalog();
      if (r.ok) { this.setState({ falCat: r }); app.showToast('fal.ai catalog synced — ' + r.count + ' endpoints', 'var(--ok)'); }
      else app.showToast('Sync failed — ' + (r.error || ''), 'var(--danger)');
    } catch (e) {
      // an old server process (started before catalog.mjs existed) 404s this route
      app.showToast(/404/.test(e.message)
        ? 'Sync failed — the app server is running old code. Restart the FrameForge server, then try again.'
        : 'Sync failed — ' + e.message, 'var(--danger)');
    }
    this.setState({ falCatBusy: false });
  }

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

  // ── Integrations switchboard ──────────────────────────────────────────────────────────
  // One card per module from shared/integrations.mjs. Turning a module off hides its UI AND
  // makes the server refuse its routes, so nothing disabled can spend money or run in the
  // background. Stored data is never touched — a disabled module's .md files stay readable.
  setModule(id, on) {
    const app = this.props.app;
    const mod = (app.state.integrations || []).find(m => m.id === id);
    // moodanalyze IS the legacy autoAnalyze flag — write that one instead of adding a second
    // switch that could disagree with it.
    if (mod && mod.legacyFlag) return app.saveSettings({ [mod.legacyFlag]: on });
    const cur = (app.state.settings && app.state.settings.enabledModules) || {};
    app.saveSettings({ enabledModules: { ...cur, [id]: on } });
  }

  renderIntegrations() {
    const app = this.props.app;
    const mods = app.state.integrations || [];
    const on = app.state.modules || {};
    if (!mods.length) return <div style={sx('font-size:12px;color:var(--fg-faint)')}>Loading integrations…</div>;
    const groups = [...new Set(mods.map(m => m.group))];
    return (
      <>
        {this.renderRemotionSetup()}
        {groups.map(g => (
          <div key={g}>
            <div style={sx('font-size:10.5px;font-weight:700;letter-spacing:.14em;color:var(--fg-faint);margin:22px 0 10px')}>{g.toUpperCase()}</div>
            <div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(430px,1fr));gap:14px')}>
              {mods.filter(m => m.group === g).map(m => this.moduleCard(m, !!on[m.id]))}
            </div>
          </div>
        ))}
      </>
    );
  }

  moduleCard(m, enabled) {
    const app = this.props.app;
    const st = app.state.settings || {};
    const needsSetup = m.needs && !st[m.needs];
    const meta = (k, v) => v && v.length ? (
      <div style={{ ...sx('display:flex;gap:8px;margin-top:3px'), fontFamily: MONO, fontSize: 9, color: 'var(--fg-faint)' }}>
        <span style={sx('flex:none;width:62px;color:var(--fg-faint)')}>{k}</span>
        <span>{Array.isArray(v) ? v.join(' · ') : v}</span>
      </div>
    ) : null;
    return (
      <div key={m.id} style={{ ...sx('border-radius:10px;background:var(--surface);padding:16px 18px'), border: '1px solid ' + (enabled ? 'var(--border-2)' : 'var(--line)'), opacity: enabled ? 1 : .62 }}>
        <div style={sx('display:flex;align-items:center;gap:10px')}>
          <span style={sx('font-size:13.5px;font-weight:800')}>{m.label}</span>
          {needsSetup && enabled && <span style={sx('font-size:9px;font-weight:800;letter-spacing:.06em;color:var(--warn);border:1px solid var(--border-3);border-radius:99px;padding:1.5px 8px')}>NEEDS SETUP</span>}
          <span onClick={() => this.setModule(m.id, !enabled)} title={enabled ? 'Turn off' : 'Turn on'}
            style={{ ...sx('margin-left:auto;width:38px;height:21px;border-radius:99px;cursor:pointer;flex:none;position:relative;transition:background .15s'), background: enabled ? 'var(--accent)' : 'var(--border-2)' }}>
            <span style={{ ...sx('position:absolute;top:3px;width:15px;height:15px;border-radius:99px;background:var(--on-accent);transition:left .15s'), left: enabled ? 20 : 3 }} />
          </span>
        </div>
        <div style={sx('font-size:11.5px;color:var(--fg-muted);line-height:1.55;margin-top:8px')}>{m.line}</div>
        <div style={sx('border-top:1px solid var(--line);margin-top:10px;padding-top:9px')}>
          {meta('cost', m.cost)}
          {meta('disk', m.disk)}
          {meta('needs', [...(m.npm || []).map(x => 'npm:' + x), ...(m.binaries || []), ...(m.keys || [])])}
        </div>
      </div>
    );
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
  chatEnabled() {
    // the Filmmaker Chat module must be on for its tools to matter; mirror the server's resolution
    const on = this.props.app.state.modules || {};
    return on.chat !== false;
  }
  renderChatTools() {
    const app = this.props.app;
    const st = app.state.settings || {};
    const on = (st.enabledChatTools) || {};
    const chatOn = this.chatEnabled();
    return (
      <>
        {!chatOn && (
          <div style={sx('border:1px dashed var(--border-2);border-radius:10px;background:var(--surface);padding:14px 16px;margin-bottom:16px;font-size:11.5px;color:var(--fg-muted);line-height:1.55')}>
            Filmmaker Chat is turned off. Turn it on under <b>Integrations</b> to use these tools — the toggles below still save, but nothing runs until the chat surface is enabled.
          </div>
        )}
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

  // Remotion is the one module with a real setup step, so it gets a dedicated panel above the
  // grid rather than being crammed into its card.
  renderRemotionSetup() {
    const app = this.props.app;
    const st = app.state.settings || {};
    const S = this.state;
    const probe = S.remProbe;
    return this.card(
      <>
        {label('REMOTION PROJECT')}
        <div style={sx('font-size:11.5px;color:var(--fg-muted);line-height:1.55;margin:-4px 0 10px')}>
          FrameForge renders through <i>your</i> Remotion project and never bundles its own — that is why it adds no install weight. Point it at any folder whose entry calls {mono('registerRoot()')}.
        </div>
        <div style={sx('display:flex;gap:8px;align-items:center')}>
          <input value={S.remPath != null ? S.remPath : (st.remotionProject || '')}
            onChange={e => this.setState({ remPath: e.target.value, remProbe: null })}
            placeholder="/path/to/your/remotion-project" onKeyDown={e => e.stopPropagation()}
            style={{ ...sx('flex:1;box-sizing:border-box;background:var(--ink);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);padding:8px 12px'), fontFamily: MONO, fontSize: 11 }} />
          <span onClick={async () => {
            const p = (S.remPath != null ? S.remPath : (st.remotionProject || '')).trim();
            this.setState({ remBusy: true, remProbe: null });
            try {
              const r = await api.remotionProbe(p);
              this.setState({ remProbe: r, remBusy: false });
              // only commit a path that actually resolves — a half-typed path used to be saved
              // on every keystroke and then failed silently much later
              if (r.ok) { app.saveSettings({ remotionProject: p }); app.showToast('Remotion project connected — ' + r.entry, 'var(--ok)'); }
            } catch (e) { this.setState({ remProbe: { ok: false, reason: e.message }, remBusy: false }); }
          }} className="hBd" style={sx('font-size:10.5px;font-weight:700;border:1px solid var(--border-2);border-radius:8px;padding:8px 14px;cursor:pointer;color:var(--fg-soft);flex:none')}>
            {S.remBusy ? 'Testing…' : 'Test & save'}
          </span>
          <span onClick={async () => {
            const r = await api.remotionSuggest();
            if (!r.found || !r.found.length) return app.showToast('No MotionKit / Remotion checkout found nearby — paste a path instead', 'var(--danger)');
            const pick = r.found[0];
            this.setState({ remPath: pick.path, remProbe: { ok: true, entry: pick.entry, depsInstalled: pick.depsInstalled, reason: pick.depsInstalled ? 'Found ' + pick.label : 'Found ' + pick.label + ", but its dependencies aren't installed — run npm install inside it" } });
            app.saveSettings({ remotionProject: pick.path });
            app.showToast('Connected ' + pick.label + ' — ' + pick.entry, 'var(--ok)');
          }} className="hBd" style={sx('font-size:10.5px;font-weight:700;border:1px solid var(--border-2);border-radius:8px;padding:8px 14px;cursor:pointer;color:var(--fg-soft);flex:none')}>Find MotionKit</span>
        </div>
        {probe && (
          <div style={{ ...sx('margin-top:9px;font-size:11px;line-height:1.5'), color: probe.ok ? (probe.depsInstalled === false ? 'var(--warn)' : 'var(--ok)') : 'var(--danger)' }}>
            {probe.ok ? '✓ ' : '✕ '}{probe.reason}{probe.ok && probe.entry ? ' · ' : ''}{probe.ok && probe.entry ? mono(probe.entry) : null}
          </div>
        )}
        <div style={sx('display:flex;align-items:center;gap:10px;margin-top:12px')}>
          <span onClick={async () => {
            const r = await api.remotionTemplate(false);
            if (r.ok) app.showToast('FrameForgeShots.tsx written — register it in your Root.tsx', 'var(--ok)');
            else if (/already exists/.test(r.error || '') && window.confirm('FrameForgeShots.tsx already exists in the project — overwrite it?')) {
              const r2 = await api.remotionTemplate(true);
              app.showToast(r2.ok ? 'FrameForgeShots.tsx overwritten' : 'Failed — ' + (r2.error || ''), r2.ok ? 'var(--ok)' : 'var(--danger)');
            } else if (!r.ok) app.showToast('Failed — ' + (r.error || ''), 'var(--danger)');
          }} className="hBd" style={sx('font-size:10.5px;font-weight:700;border:1px solid var(--border-2);border-radius:8px;padding:6px 12px;cursor:pointer;color:var(--fg-soft);flex:none')}>Write starter comp</span>
          <span style={sx('font-size:10px;color:var(--fg-faint)')}>copies a minimal {mono('FrameForgeShots.tsx')} that plays each shot's picked frame</span>
        </div>
        <div style={sx('margin-top:12px')}>
          {label('ENTRY POINT OVERRIDE — OPTIONAL')}
          <input value={st.remotionEntry || ''} onChange={e => app.saveSettings({ remotionEntry: e.target.value })}
            placeholder="auto-detected — e.g. src/remotion/index.ts" onKeyDown={e => e.stopPropagation()}
            style={{ ...sx('width:100%;box-sizing:border-box;background:var(--ink);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);padding:8px 12px'), fontFamily: MONO, fontSize: 11 }} />
          {hint(<>Leave empty unless auto-detection fails. Checked in order: {mono('remotion.config.ts')} setEntryPoint() → package.json scripts → conventional layouts.</>)}
        </div>
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

  // ── one model row inside a provider's manager ──
  modelRow(m, i, state) {   // state: 'on' | 'off' | 'avail'  (avail = synced, not yet enabled)
    const app = this.props.app;
    const on = state === 'on';
    return (
      <div key={m.id} className="hRow" style={{ ...sx('display:flex;align-items:center;gap:10px;padding:7px 12px'), borderTop: i ? '1px solid var(--line)' : 'none', opacity: state === 'off' ? .5 : 1 }}>
        {state === 'avail'
          ? <span onClick={() => this.enableCustom(m)} className="hBdAccentChip" style={sx('font-size:9.5px;font-weight:800;color:var(--accent);border:1px solid var(--accent-35);border-radius:99px;padding:2px 9px;cursor:pointer;flex:none')}>＋ ENABLE</span>
          : <span onClick={() => m.custom ? this.disableCustom(m.id) : this.toggleCurated(m.id)} title={on ? 'Enabled — click to hide from Generate' : 'Click to enable'}
            style={{ ...sx('width:26px;height:15px;border-radius:99px;cursor:pointer;flex:none;position:relative;transition:background .15s'), background: on ? 'var(--accent)' : 'var(--border-2)' }}>
            <span style={{ ...sx('position:absolute;top:1.5px;width:12px;height:12px;border-radius:99px;transition:left .15s'), left: on ? 12.5 : 1.5, background: on ? 'var(--on-accent)' : 'var(--fg-faint)' }} />
          </span>}
        <span onClick={() => { navigator.clipboard && navigator.clipboard.writeText(m.id).catch(() => { }); app.showToast(m.id + ' copied', 'var(--accent)'); }}
          title="Click to copy the model id" className="hAccent"
          style={{ ...sx('width:34%;max-width:300px;color:var(--fg-soft);cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:none'), fontFamily: MONO, fontSize: 10 }}>{m.id}</span>
        <span style={sx('font-size:11.5px;font-weight:600;flex:1;min-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{m.label}</span>
        <span style={{ ...sx('font-size:8px;font-weight:800;letter-spacing:.06em;border:1px solid var(--border-2);border-radius:99px;padding:1.5px 7px;color:var(--fg-faint);flex:none;text-transform:uppercase'), fontFamily: MONO }}>{m.kind}</span>
        <span style={sx('font-size:10px;color:var(--fg-faint);width:170px;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{m.note || m.category || ''}</span>
        <span style={{ ...sx('font-size:9.5px;color:var(--fg-muted);width:44px;text-align:right;flex:none'), fontFamily: MONO }}>{m.cost != null ? '$' + m.cost.toFixed(m.cost >= 0.1 ? 2 : 3) : '—'}</span>
      </div>
    );
  }

  // ── the expandable model manager under each generation provider card ──
  modelManager(pid) {
    const app = this.props.app;
    const st = app.state.settings;
    const S = this.state;
    const off = new Set(st.disabledModels || []);
    const curated = MODELS.filter(m => m.provider === pid);
    const customs = customModels(st).filter(m => m.provider === pid);
    const mine = [...curated, ...customs];
    const enabledN = curated.filter(m => !off.has(m.id)).length + customs.length;
    const isOpen = !!S.open[pid];
    const q = (S.q[pid] || '').trim().toLowerCase();
    const kf = S.kindF[pid] || 'all';
    const match = m => (kf === 'all' || m.kind === kf) && (!q || (m.id + ' ' + m.label + ' ' + (m.note || '') + ' ' + (m.category || '')).toLowerCase().includes(q));

    // fal only: the synced full catalog, minus anything already curated/enabled, minus
    // non-generatable kinds (audio/llm/3d → kind null)
    const have = new Set(mine.map(m => m.id));
    const cat = pid === 'fal' ? (S.falCat || { models: [], count: 0, synced: null }) : null;
    const avail = cat ? cat.models.filter(m => m.kind && !have.has(m.id) && m.status !== 'deprecated' && match(m)) : [];
    const mineShown = mine.filter(match);
    const AVAIL_CAP = 150;

    return (
      <div style={sx('margin-top:12px;border-top:1px solid var(--line);padding-top:10px')}>
        <div style={sx('display:flex;align-items:center;gap:10px')}>
          <span style={sx('font-size:10px;font-weight:700;letter-spacing:.12em;color:var(--fg-faint)')}>MODELS</span>
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--accent)' }}>{enabledN}</span>
          <span style={sx('font-size:10px;color:var(--fg-faint)')}>enabled{cat && cat.count ? ' · ' + cat.count + ' in the full fal catalog' : ' · ' + mine.length + ' available'}</span>
          <span onClick={() => this.setState(s => ({ open: { ...s.open, [pid]: !isOpen } }))} className="hAccent"
            style={sx('margin-left:auto;font-size:10.5px;font-weight:700;color:var(--accent);cursor:pointer;white-space:nowrap')}>
            {isOpen ? 'Close ▴' : 'Manage models ▾'}
          </span>
        </div>
        {!isOpen && (
          <div style={sx('display:flex;gap:5px;flex-wrap:wrap;margin-top:8px')}>
            {mine.filter(m => m.custom || !off.has(m.id)).slice(0, 8).map(m => (
              <span key={m.id} title={m.id} style={{ ...sx('font-size:9px;color:var(--fg-muted);border:1px solid var(--border-2);border-radius:6px;padding:2px 7px'), fontFamily: MONO }}>{m.label}</span>
            ))}
            {enabledN > 8 && <span style={{ ...sx('font-size:9px;color:var(--fg-faint);padding:2px 4px'), fontFamily: MONO }}>+{enabledN - 8} more</span>}
            {!enabledN && <span style={sx('font-size:10px;color:var(--fg-faint)')}>none enabled</span>}
          </div>
        )}
        {isOpen && (
          <div style={sx('margin-top:10px')}>
            {pid === 'fal' && (
              <div style={sx('display:flex;align-items:center;gap:10px;border:1px solid var(--accent-12);background:var(--accent-05);border-radius:9px;padding:8px 12px;margin-bottom:10px')}>
                <span style={sx('font-size:10.5px;color:var(--fg-soft)')}>
                  <b>Full fal.ai catalog</b> — {cat.count ? <>{mono(String(cat.count), 'var(--accent)')} endpoints mirrored · synced {relTime(cat.synced)}</> : 'not synced yet — pull every fal endpoint into this list'}
                </span>
                <span onClick={() => this.syncFal()} className="hBdAccent"
                  style={{ ...sx('margin-left:auto;font-size:10.5px;font-weight:700;border:1px solid var(--accent-35);border-radius:8px;padding:5px 13px;cursor:pointer;color:var(--accent);white-space:nowrap'), opacity: S.falCatBusy ? .5 : 1 }}>
                  {S.falCatBusy ? <span style={sx('animation:dl-pulse 1.1s infinite')}>Syncing…</span> : '⟳ Sync catalog'}
                </span>
              </div>
            )}
            <div style={sx('display:flex;align-items:center;gap:8px;margin-bottom:9px;flex-wrap:wrap')}>
              <input value={S.q[pid] || ''} onChange={e => this.setState(s => ({ q: { ...s.q, [pid]: e.target.value } }))} onKeyDown={e => e.stopPropagation()}
                placeholder={'Search ' + (cat && cat.count ? cat.count + ' models…' : 'models…')}
                style={{ ...sx('background:var(--ink);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);padding:6px 11px;width:220px'), fontFamily: MONO, fontSize: 10.5 }} />
              {['all', ...KINDS.map(k => k.key)].map(k => {
                const on = kf === k;
                return <span key={k} onClick={() => this.setState(s => ({ kindF: { ...s.kindF, [pid]: k } }))}
                  style={{ ...sx('padding:3.5px 10px;border-radius:99px;cursor:pointer;font-size:9.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase'), background: on ? 'var(--accent-12)' : 'transparent', color: on ? 'var(--accent)' : 'var(--fg-faint)', border: '1px solid ' + (on ? 'var(--accent-35)' : 'var(--border-2)') }}>{k}</span>;
              })}
              <span style={{ ...sx('margin-left:auto;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9.5 }}>{mineShown.length + avail.length} match</span>
            </div>
            <div style={sx('border:1px solid var(--border);border-radius:10px;background:var(--ink);overflow:hidden;max-height:380px;overflow-y:auto')}>
              {mineShown.map((m, i) => this.modelRow(m, i, m.custom ? 'on' : (off.has(m.id) ? 'off' : 'on')))}
              {avail.length > 0 && (
                <div style={sx('padding:6px 12px;font-size:9px;font-weight:800;letter-spacing:.12em;color:var(--fg-faint);border-top:1px solid var(--line);background:var(--surface)')}>
                  FROM THE SYNCED CATALOG — CLICK ＋ ENABLE TO ADD
                </div>
              )}
              {avail.slice(0, AVAIL_CAP).map((m, i) => this.modelRow(m, i + 1, 'avail'))}
              {avail.length > AVAIL_CAP && <div style={sx('padding:9px 12px;font-size:10px;color:var(--fg-faint);border-top:1px solid var(--line)')}>{avail.length - AVAIL_CAP} more — refine the search to see them.</div>}
              {!mineShown.length && !avail.length && <div style={sx('padding:18px;text-align:center;font-size:11px;color:var(--fg-faint)')}>{pid === 'fal' && !cat.count ? 'Sync the catalog to browse every fal endpoint.' : 'No models match.'}</div>}
            </div>
            {pid !== 'fal' && hint(<>
              {pid === 'kie' && <>Kie.ai has no public model-list API — this is the curated set. Any Kie model slug can still be added by hand in <b>frontend/modelCatalog.js</b>.</>}
              {pid === 'higgsfield' && <>Models the <span style={{ fontFamily: MONO, fontSize: 10 }}>higgsfield</span> CLI exposes — curated to the slugs verified against the CLI.</>}
              {pid === 'arcads' && <>Each entry maps to an Arcads MCP tool reached through your Claude CLI.</>}
            </>)}
          </div>
        )}
      </div>
    );
  }

  // ── defaults card — what Generate reaches for per purpose ──
  defaultsCard() {
    const app = this.props.app;
    const st = app.state.settings;
    const d = st.modelDefaults || {};
    const off = new Set(st.disabledModels || []);
    const pool = [...MODELS.filter(m => !off.has(m.id)), ...customModels(st)];
    const row = (key, labelText, kinds) => {
      const opts = pool.filter(m => kinds.includes(m.kind) || d[key] === m.id);
      return (
        <div key={key} style={sx('display:flex;align-items:center;gap:10px')}>
          <span style={sx('width:60px;font-size:9.5px;font-weight:700;letter-spacing:.1em;color:var(--fg-faint);text-transform:uppercase;flex:none')}>{labelText}</span>
          <select value={d[key] || ''} onChange={e => app.saveSettings({ modelDefaults: { ...d, [key]: e.target.value } })}
            style={{ ...sx('flex:1;min-width:0;background:var(--ink);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);padding:7px 9px'), fontFamily: MONO, fontSize: 10.5 }}>
            <option value="">— none —</option>
            {opts.map(m => <option key={m.id} value={m.id}>{(providerDef(m.provider)?.label || m.provider)} · {m.label}</option>)}
          </select>
        </div>
      );
    };
    return this.card(
      <div style={sx('display:flex;flex-direction:column;gap:9px')}>
        <div style={sx('font-size:10px;font-weight:700;letter-spacing:.14em;color:var(--fg-muted)')}>DEFAULT MODELS — what Generate reaches for per purpose</div>
        {row('preview', 'Preview', ['preview', 'render'])}
        {row('render', 'Render', ['render', 'preview'])}
        {row('edit', 'Edit', ['edit'])}
        {row('video', 'Video', ['video'])}
        {row('music', 'Music', ['music'])}
        {row('voice', 'Voice', ['voice'])}
        {row('sfx', 'Sound FX', ['sfx'])}
        {hint(<>Persisted to {mono('settings.md · modelDefaults')}. Reference-conditioned FAL generations auto-route to the edit default.</>)}
      </div>,
      { border: '1px solid var(--accent-35)' }
    );
  }

  // ── one provider card: header · key/CLI row · model manager ──
  providerCard(pid, title, tagline, keyRow, info, hasModels) {
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
        {hasModels && this.modelManager(pid)}
      </div>
    );
  }

  render() {
    const app = this.props.app;
    const A = app.state;
    const st = A.settings;
    const S = this.state;
    const goSec = id => this.setState({ nav: id });   // tabs — only the active section renders

    const cliRow = (text, dim) => (
      <div style={{ ...sx('flex:1;min-width:0;background:var(--ink);border:1px solid var(--border);border-radius:8px;color:var(--fg-muted);padding:8px 12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 11 }}>{text} <span style={{ color: 'var(--fg-faint)' }}>{dim}</span></div>
    );

    // Groq | Local (Parakeet) transcriber choice — lives inside the Groq provider card since
    // it's the same "transcription" concern. Preferred engine tries first; the server falls
    // back to the other one automatically on failure (see backend/index.mjs /api/groq/transcribe).
    const seg = (on, text, onClick) => (
      <span onClick={onClick} style={{ ...sx('padding:5px 12px;font-size:10.5px;font-weight:700;cursor:pointer;white-space:nowrap'), background: on ? 'var(--accent-12)' : 'transparent', color: on ? 'var(--accent)' : 'var(--fg-faint)' }}>{text}</span>
    );
    const localSt = S.localAsrStatus;      // silent probe, fetched on mount
    const kt = (A.keyTest || {})['local-asr'];  // manual "Test" button result (toasts)
    const liveSt = kt && kt !== 'busy' ? kt : localSt;
    const localBadgeText = kt === 'busy' ? 'Checking…' : (liveSt ? (liveSt.ok ? '✓ found at ' + (liveSt.path || '') : '✕ not found') : 'Checking…');
    const localBadgeColor = kt === 'busy' || !liveSt ? 'var(--fg-faint)' : (liveSt.ok ? 'var(--ok)' : 'var(--danger)');
    const transcriberRow = (
      <div style={sx('display:flex;flex-direction:column;gap:9px;margin-top:11px;padding-top:11px;border-top:1px solid var(--line)')}>
        <div style={sx('display:flex;align-items:center;gap:10px;flex-wrap:wrap')}>
          <span style={sx('font-size:9.5px;font-weight:700;letter-spacing:.1em;color:var(--fg-faint);text-transform:uppercase;flex:none')}>Transcriber</span>
          <div style={sx('display:flex;border:1px solid var(--border-2);border-radius:8px;overflow:hidden;flex:none')}>
            {seg((st.transcriber || 'groq') !== 'local', 'Groq', () => app.saveSettings({ transcriber: 'groq' }))}
            {seg(st.transcriber === 'local', 'Local (Parakeet)', () => app.saveSettings({ transcriber: 'local' }))}
          </div>
          <span style={sx('font-size:10px;color:var(--fg-faint)')}>tries the picked engine first, falls back to the other automatically</span>
        </div>
        <div style={sx('display:flex;align-items:center;gap:10px')}>
          {this.input('localTranscriberCommand', 'parakeet-mlx', false)}
          {app.keyTestBtn('local-asr')}
        </div>
        {hint(<><span style={{ color: localBadgeColor, fontWeight: 700 }}>{localBadgeText}</span> — on-device via NVIDIA Parakeet TDT, no key or per-minute cost. Install with {mono('uv tool install parakeet-mlx')} (also needs {mono('ffmpeg')} on PATH). Apple Silicon only.</>)}
      </div>
    );

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
              {label('AUTO-INITIALIZE — VISION METADATA ON ARRIVAL')}
              <div style={sx('display:flex;align-items:center;gap:10px')}>
                {this.toggle(!!st.autoAnalyze, () => app.saveSettings({ autoAnalyze: !st.autoAnalyze }))}
                <span style={sx('font-size:12px')}>Automatically initialize every new image</span>
              </div>
              {hint(<>New images on any board or in the library — including Finder drops — get description, tags, palette and mood written to their {mono('.meta.md')} sidecar within seconds. Off = use “✦ Initialize” per board.</>)}
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
              {(app.state.modules || {}).manualroundtrip && this.card(<>
                {label('MANUAL ROUND-TRIP — MODEL THAT SORTS YOUR DOWNLOADS')}
                <div style={sx('display:flex;align-items:center;gap:6px;flex-wrap:wrap')}>
                  {[['claude-haiku-4-5-20251001', 'Haiku 4.5'], ['claude-sonnet-5', 'Sonnet 5'], ['claude-opus-4-8', 'Opus 4.8']].map(([id, lbl]) => {
                    const on = (st.manualSortModel || 'claude-sonnet-5') === id;
                    return (
                      <span key={id} onClick={() => app.saveSettings({ manualSortModel: id })} className="hBd"
                        style={{
                          ...sx('padding:5px 12px;border-radius:7px;cursor:pointer;font-size:11px;font-weight:700'),
                          border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border-2)'),
                          color: on ? 'var(--accent)' : 'var(--fg-soft)', fontFamily: MONO
                        }}>{lbl}</span>
                    );
                  })}
                </div>
                {hint(<>When you render in Google Flow or Midjourney and drop the downloads into a project&rsquo;s Inbox, FrameForge matches them back to shots by filename and by the order you handed the prompts out &mdash; both free. Only the leftovers reach a model, and the job is &ldquo;which of these shots is this frame&rdquo;, not direction &mdash; a small model is the right tool. Runs on your {mono(st.agentCommand || 'claude')} subscription, so it costs no provider credit.</>)}
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
          {this.sectionHead('providers', 'Providers & models', 'one card per provider — key, live status, and which models show up in Generate')}
          <div style={sx('margin-bottom:14px')}>{this.defaultsCard()}</div>
          <div style={sx('margin-bottom:14px')}>{this.card(<>
            {label('VISION TIER — HOW REFERENCE IMAGES GET READ')}
            <div style={sx('display:flex;align-items:center;gap:10px;flex-wrap:wrap')}>
              <span style={sx('font-size:9.5px;font-weight:700;letter-spacing:.1em;color:var(--fg-faint);text-transform:uppercase;flex:none;width:52px')}>Model</span>
              <div style={sx('display:flex;border:1px solid var(--border-2);border-radius:8px;overflow:hidden;flex:none')}>
                {seg((st.visionProvider || 'groq') !== 'fal', 'Groq · free', () => app.saveSettings({ visionProvider: 'groq' }))}
                {seg(st.visionProvider === 'fal', 'FAL · Gemini · paid', () => app.saveSettings({ visionProvider: 'fal' }))}
              </div>
              <span style={sx('font-size:10px;color:var(--fg-faint)')}>{st.visionProvider === 'fal' ? 'billed per token — the real cost lands in the ledger' : 'free tier, fast, good enough to catalogue a board'}</span>
            </div>
            <div style={sx('display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:9px')}>
              <span style={sx('font-size:9.5px;font-weight:700;letter-spacing:.1em;color:var(--fg-faint);text-transform:uppercase;flex:none;width:52px')}>Depth</span>
              <div style={sx('display:flex;border:1px solid var(--border-2);border-radius:8px;overflow:hidden;flex:none')}>
                {seg((st.visionDepth || 'quick') !== 'deep', 'Quick', () => app.saveSettings({ visionDepth: 'quick' }))}
                {seg(st.visionDepth === 'deep', 'Deep · reconstruct', () => app.saveSettings({ visionDepth: 'deep' }))}
              </div>
              <span style={sx('font-size:10px;color:var(--fg-faint)')}>{st.visionDepth === 'deep' ? 'also writes a full regeneration prompt into each sidecar' : 'description · tags · palette · mood'}</span>
            </div>
            <div style={sx('display:flex;align-items:center;gap:10px;margin-top:9px')}>
              <span style={sx('font-size:9.5px;font-weight:700;letter-spacing:.1em;color:var(--fg-faint);text-transform:uppercase;flex:none;width:52px')}>Slug</span>
              {this.input('falVisionModel', 'google/gemini-2.5-flash', false)}
            </div>
            {hint(<>These are the <i>defaults</i> — every board keeps a per-image {mono('✦✦ Deep')} button that forces the paid tier for one shot, so bulk sweeps and auto-initialize can’t quietly run up a bill. fal hosts no native Gemini endpoint; the slug is passed straight through {mono('openrouter/router/vision')}, so switching to a newer Gemini is a text edit here, not a release. Deep analysis reverse-engineers camera angle, focal length, lighting direction, wardrobe and grade into a {mono('reconstruct')} prompt dense enough to regenerate the frame.</>)}
          </>)}</div>
          <div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(520px,1fr));gap:14px;align-items:start')}>
            {this.providerCard('fal', 'FAL', 'primary generation + asset CDN',
              <div style={sx('display:flex;align-items:center;gap:10px')}>{this.input('falApiKey', 'fal key (id:secret)', true)}</div>,
              <>Powers Generate and “↗ Send to fal storage”. Sync the catalog below to browse all of fal’s endpoints — not just the curated picks.</>,
              true)}
            {this.providerCard('kie', 'Kie.ai', 'one key · 100+ models via REST',
              <div style={sx('display:flex;align-items:center;gap:10px')}>{this.input('kieApiKey', 'kie.ai api key', true)}</div>,
              <>Prompts go to {mono('api.kie.ai')} and results land in {mono('renders/')} just like FAL. Get a key at {mono('kie.ai')}.</>,
              true)}
            {this.providerCard('higgsfield', 'Higgsfield', 'via its CLI — no API key',
              <div style={sx('display:flex;align-items:center;gap:10px')}>{cliRow(st.higgsfieldCommand || 'higgsfield', '· CLI, signed in on this machine')}</div>,
              <>Install once: {mono('curl -fsSL https://raw.githubusercontent.com/higgsfield-ai/cli/main/install.sh | sh')}, then {mono('higgsfield auth login')}. Test runs {mono('higgsfield account status')}.</>,
              true)}
            {this.providerCard('arcads', 'Arcads', 'via your Claude CLI (MCP) — no API key',
              <div style={sx('display:flex;align-items:center;gap:10px')}>{cliRow('through ' + (st.agentCommand || 'claude'), '· Arcads MCP tool')}</div>,
              <>Arcads has no public REST API — FrameForge asks your connected Claude (see the Claude tab) to call the Arcads MCP tool and hand back the media URL.</>,
              true)}
            {this.providerCard('groq', 'Groq', 'transcription · vision · story breakdown — free tier',
              <>
                <div style={sx('display:flex;align-items:center;gap:10px')}>{this.input('groqApiKey', 'gsk_…', true)}</div>
                {transcriberRow}
              </>,
              <>{mono(st.groqWhisperModel || 'whisper-large-v3-turbo')} transcribes ideas, {mono(st.groqVisionModel || 'llama-4-scout')} writes mood-board metadata, {mono(st.groqTextModel || 'llama-3.3-70b')} breaks stories into shots. This is the <b>free</b> vision tier — fast and fine for cataloguing, but it misses detail. Switch the Vision Tier card above to FAL·Gemini when you need a frame read closely enough to rebuild it.</>,
              false)}
          </div>

          </>}

          {/* ═══ INTEGRATIONS ═══ */}
          {S.nav === 'integrations' && <>
          {this.sectionHead('integrations', 'Integrations', 'turn off what you don\'t use — nothing disabled can spend money or run in the background')}
          {this.renderIntegrations()}
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
