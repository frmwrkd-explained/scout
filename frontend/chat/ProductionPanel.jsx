// Production Panel (ticket 13) — the always-visible right-hand rail beside the chat that shows the
// project's creative context AS VISUALS, rendered by the UI from stored data. The LLM never rewrites
// this surface; it is a read-through of canonical records plus a few lock actions that call EXISTING
// routes only.
//
// Sections (top → bottom):
//   · Project understanding — brief + memory hot-cache, collapsed preview with expand
//   · Locked style          — the active style lock's ref image + name + axis summary, swap/clear
//                             from existing style locks, and "lock this look" from extracted looks
//   · Cast                  — context-board Cast entries with their reference/turnaround images
//   · Locations             — context-board Locations entries
//   · Look sheets           — extracted looks (tier fragment + palette), lockable as a style
//
// Data sources, all existing:
//   brief      → props.pdef.brief (round-tripped through /api/state)
//   memory     → GET /api/memory/:pid            (api.getMemory)
//   styleLocks → props.styleLocks (app.state, GET /api/stylelocks) · ref img GET /api/stylelocks/:id/ref
//   looks      → GET /api/looks                  (api.looks)
//   cast/loc   → props.pdef.context.items filtered by the canonical ASSET_KIND_FOLDERS vocabulary
//
// On a lock change from the panel we (1) persist via app.setDefaultStyleLock (patchProject styleLock
// + sync) and (2) post a compact system event carrying the id only to the ACTIVE session, so the
// agent's next turn stays current without a token-heavy restatement (it re-reads the actual lock via
// the Index / locksForProject). All imagery renders through the shared RenderMedia components.
import React from 'react';
import { sx } from '../sx';
import { api } from '../api';
import { RenderMedia, RenderLightbox } from '../RenderMedia';
import { ASSET_KIND_FOLDERS } from '../AssetBoards';
import { entityKey } from '../entities';
import { CHAT_TOOLS, resolveToolEnabled } from '../../shared/chatTools.mjs';
import { MONO } from '../tokens';

const CAST_RE = ASSET_KIND_FOLDERS.find(k => k.id === 'cast').match;
const LOC_RE = ASSET_KIND_FOLDERS.find(k => k.id === 'locations').match;

// A look record's source is "<scope>/[folder/]name" (scope is 'library' or a project id) — resolve it
// back to a servable url through the same routes the boards use. Best-effort: a malformed source just
// renders without a thumbnail rather than throwing.
function lookSrc(source) {
  const parts = String(source || '').split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const scope = parts[0], name = parts[parts.length - 1], folder = parts.slice(1, -1).join('/');
  return scope === 'library' ? api.libraryUrl(name, folder) : api.contextUrl(scope, name, folder);
}

// The style lock's "axis summary": the 8-axis token picks the lock was built from, flattened to chips.
// A legacy/hand-written lock has no picks — fall back to a short slice of its composed fragment.
function axisChips(lock) {
  const out = [];
  const picks = lock && lock.picks && typeof lock.picks === 'object' ? lock.picks : {};
  for (const names of Object.values(picks)) {
    if (Array.isArray(names)) for (const n of names) if (n) out.push(String(n));
  }
  return out.slice(0, 10);
}

// Collapsible section header (ticket 08 — the QUEUE-dock precedent: a collapsed summary with the
// detail one click away). The caret + label row toggles; the count is mono + tabular-nums so stacked
// section counts align. Per-section actions only show while the section is open — a collapsed
// section offers exactly one affordance: expand.
const SectionHead = ({ label, count, action, open, onToggle }) => (
  <div style={sx('display:flex;align-items:center;gap:8px;margin:2px 0 8px')}>
    <span onClick={onToggle} role="button" tabIndex={0} aria-expanded={!!open} className="hFg"
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle && onToggle(); } }}
      style={sx('display:inline-flex;align-items:center;gap:7px;min-width:0;cursor:pointer')}>
      <span aria-hidden style={{ ...sx('font-size:8px;color:var(--fg-faint);flex:none;line-height:1'), transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 120ms ease' }}>▾</span>
      <span style={sx('font-size:10px;font-weight:700;letter-spacing:.13em;color:var(--fg-faint)')}>{label}</span>
      {count != null && <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--border-3)', fontVariantNumeric: 'tabular-nums' }}>{count}</span>}
    </span>
    {action && open ? <span style={sx('margin-left:auto')}>{action}</span> : null}
  </div>
);

// The collapsed-state one-liner + the empty-state voice — short mono uppercase status lines, per the
// design system's system/empty-state register (not friendly sentence-case filler).
const StatusLine = ({ children }) => (
  <div style={{ ...sx('font-size:9.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--fg-faint);line-height:1.7'), fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>{children}</div>
);

// The rail's toggle switch (handover: TOOLS section, 20×11 track with a 9px knob). Accent track when
// on, --border when off — a switch is state, so it never borrows the accent for its off face.
const Toggle = ({ on, onClick, title }) => (
  <span role="switch" aria-checked={!!on} tabIndex={0} onClick={onClick} title={title}
    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick && onClick(); } }}
    style={{ ...sx('position:relative;width:20px;height:11px;border-radius:99px;flex:none;cursor:pointer'),
      background: on ? 'var(--accent-35)' : 'var(--border)', transition: 'background 120ms ease' }}>
    <span aria-hidden style={{ ...sx('position:absolute;top:1px;width:9px;height:9px;border-radius:99px'),
      left: on ? 10 : 1, background: on ? 'var(--accent)' : 'var(--fg-faint)', transition: 'left 120ms ease' }} />
  </span>
);

export default class ProductionPanel extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      collapsed: false,
      sections: {}, // per-section disclosure — sparse map, id -> false means collapsed (default open)
      looks: [], memory: { body: '', updated: '' },
      understandingOpen: false, swapOpen: false,
      userTools: [], toolBusy: null,
      lightbox: null, busy: false
    };
  }

  componentDidMount() {
    // remembered collapse state (existing ui-state wrappers; merge PUT so we never clobber siblings)
    api.uiState().then(ui => {
      if (!ui) return;
      const patch = {};
      if (typeof ui.prodPanelCollapsed === 'boolean') patch.collapsed = ui.prodPanelCollapsed;
      if (ui.prodSections && typeof ui.prodSections === 'object') patch.sections = ui.prodSections;
      if (Object.keys(patch).length) this.setState(patch);
    }).catch(() => {});
    if (!(this.props.styleLocks || []).length) this.props.app.reloadStyleLocks?.();
    this.loadLooks();
    this.loadMemory();
    this.loadUserTools();
  }
  componentDidUpdate(prev) {
    if (prev.pid !== this.props.pid) { this.loadMemory(); this.loadLooks(); }
  }

  loadLooks() { api.looks().then(looks => this.setState({ looks: Array.isArray(looks) ? looks : [] })).catch(() => {}); }
  // The filmmaker's own authored tools (backend/userTools.mjs) toggle from the same rail as the
  // built-ins — one TOOLS list, not two. They live outside project.md, so they need their own fetch.
  loadUserTools() { api.userTools().then(r => this.setState({ userTools: (r && r.tools) || [] })).catch(() => {}); }
  loadMemory() {
    if (!this.props.pid) return;
    api.getMemory(this.props.pid).then(memory => this.setState({ memory: memory || { body: '', updated: '' } })).catch(() => {});
  }

  toggleCollapse() {
    const collapsed = !this.state.collapsed;
    this.setState({ collapsed });
    api.saveUiState({ prodPanelCollapsed: collapsed }).catch(() => {});
  }

  // per-section disclosure (ticket 08) — persisted alongside the panel collapse, same merge-PUT seam.
  // Default CLOSED: the rail's first impression is a stack of one-line summaries, and you open the
  // section you need. (Previously default-open, which made the rail a wall of content on arrival.)
  secOpen(id) { return this.state.sections[id] === true; }
  toggleSection(id) {
    const sections = { ...this.state.sections, [id]: !this.secOpen(id) };
    this.setState({ sections });
    api.saveUiState({ prodSections: sections }).catch(() => {});
  }

  // notify the ACTIVE session with ids only — compact, no restated content (ticket 13 contract)
  notify(text) {
    const id = this.props.activeId;
    if (!id) return;
    api.chatSystemEvent(id, text).catch(() => {}); // broadcast → Chat reconciles the transcript
  }

  async lockStyle(id) {
    const { app, pid } = this.props;
    if (!pid) return;
    this.setState({ busy: true, swapOpen: false });
    try {
      app.setDefaultStyleLock(pid, id || ''); // patchProject styleLock + sync + session apply
      this.notify(id ? 'style-lock changed: ' + id : 'style-lock cleared');
      app.reloadStyleLocks?.();
    } finally { this.setState({ busy: false }); }
  }

  // "lock this look": mint a style lock from the look's reusable fragment (existing import route),
  // then set it as the project default. Uses the tier2 (numeric) fragment when present, else tier1.
  async lockFromLook(look) {
    const { app, pid } = this.props;
    if (!pid || !look) return;
    const prompt = String(look.tier1 || look.tier2 || '').trim();
    if (!prompt) { app.showToast?.('This look has no reusable fragment to lock', 'var(--danger)'); return; }
    this.setState({ busy: true });
    try {
      const rec = await api.importStyleLock({ name: 'Look ' + String(look.id || '').replace(/^look-/, ''), prompt });
      app.setDefaultStyleLock(pid, rec.id);
      this.notify('style-lock changed: ' + rec.id);
      app.reloadStyleLocks?.();
      app.showToast?.('Locked look as a style', 'var(--ok)');
    } catch (e) { app.showToast?.('Could not lock look — ' + (e.message || ''), 'var(--danger)'); }
    finally { this.setState({ busy: false }); }
  }

  openAssets() { this.props.app.setState({ projTab: 'assets' }); }

  // ── section renderers ──
  renderUnderstanding() {
    const brief = String(this.props.pdef?.brief || '').trim();
    const memory = String(this.state.memory.body || '').trim();
    const { understandingOpen } = this.state;
    const has = brief || memory;
    // A tight teaser, not a wall of prose — two lines per block; Expand shows everything.
    const clip = s => s.length > 130 ? s.slice(0, 130).trimEnd() + '…' : s;
    const open = this.secOpen('understanding');
    return (
      <div style={sx('margin-bottom:16px')}>
        <SectionHead label="PROJECT UNDERSTANDING" open={open} onToggle={() => this.toggleSection('understanding')}
          action={has ? (
          <span onClick={() => this.setState(s => ({ understandingOpen: !s.understandingOpen }))} className="hFg"
            style={sx('font-size:10px;color:var(--fg-muted);cursor:pointer')}>{understandingOpen ? 'Collapse' : 'Expand'}</span>
        ) : null} />
        {!open && <StatusLine>{has ? [brief && 'BRIEF', memory && 'MEMORY'].filter(Boolean).join(' + ') + ' ON FILE' : 'EMPTY'}</StatusLine>}
        {open && !has && <StatusLine>NO BRIEF OR MEMORY YET — THE AGENT STARTS BLANK</StatusLine>}
        {open && brief ? (
          <div style={sx('margin-bottom:8px')}>
            <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.08em', color: 'var(--fg-faint)', marginBottom: 3 }}>BRIEF</div>
            <div style={{ ...sx('font-size:11.5px;color:var(--fg-soft);line-height:1.55;white-space:pre-wrap;word-break:break-word'), maxHeight: understandingOpen ? 'none' : 40, overflow: 'hidden' }}>
              {understandingOpen ? brief : clip(brief)}
            </div>
          </div>
        ) : null}
        {open && memory ? (
          <div>
            <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.08em', color: 'var(--fg-faint)', marginBottom: 3 }}>MEMORY · HOT CACHE</div>
            <div style={{ ...sx('font-size:11.5px;color:var(--fg-soft);line-height:1.55;white-space:pre-wrap;word-break:break-word'), maxHeight: understandingOpen ? 'none' : 40, overflow: 'hidden' }}>
              {understandingOpen ? memory : clip(memory)}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  renderLockedStyle() {
    const { pdef, styleLocks, pid } = this.props;
    const locks = styleLocks || [];
    const lockId = pdef?.styleLock || '';
    const lock = lockId ? locks.find(l => l.id === lockId) : null;
    const { swapOpen, busy } = this.state;
    const chips = lock ? axisChips(lock) : [];
    const open = this.secOpen('style');
    if (!open) return (
      <div style={sx('margin-bottom:16px')}>
        <SectionHead label="LOCKED STYLE" open={false} onToggle={() => this.toggleSection('style')} />
        <StatusLine>{lock ? 'LOCKED · ' + (lock.name || lock.id) : 'NO STYLE LOCKED'}</StatusLine>
      </div>
    );
    return (
      <div style={sx('margin-bottom:16px')}>
        <SectionHead label="LOCKED STYLE" open onToggle={() => this.toggleSection('style')} action={pid ? (
          <span onClick={() => this.setState(s => ({ swapOpen: !s.swapOpen }))} className="hFg"
            style={sx('font-size:10px;color:var(--accent);cursor:pointer')}>{swapOpen ? 'Close' : 'Swap'}</span>
        ) : null} />
        {lock ? (
          <div style={sx('border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--surface)')}>
            {lock.refImage
              ? <RenderMedia src={api.styleLockRefUrl(lock.id)} kind="image" fit="cover" style={sx('width:100%;height:84px;display:block')} />
              : <div style={sx('height:56px;display:flex;align-items:center;justify-content:center;color:var(--border-3);font-size:18px')}>✦</div>}
            <div style={sx('padding:8px 10px')}>
              <div style={sx('font-size:12px;font-weight:700;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{lock.name || lock.id}</div>
              <div style={sx('display:flex;flex-wrap:wrap;gap:4px;margin-top:6px')}>
                {chips.length ? chips.map((c, i) => (
                  <span key={i} style={sx('font-size:9.5px;color:var(--fg-muted);background:var(--raise);border:1px solid var(--border-2);border-radius:5px;padding:2px 6px')}>{c}</span>
                )) : <span style={sx('font-size:10.5px;color:var(--fg-faint);line-height:1.5')}>{String(lock.fragment || '').slice(0, 120) || 'No axis detail'}</span>}
              </div>
            </div>
          </div>
        ) : (
          <div style={sx('border:1px dashed var(--border-2);border-radius:10px;padding:14px;text-align:center')}>
            <div style={sx('margin-bottom:8px')}><StatusLine>NO STYLE LOCKED YET</StatusLine></div>
            <span onClick={() => (pid ? this.props.app.openStyleLockPicker(pid) : null)} className="hBtnAccent"
              style={sx('font-size:11px;font-weight:700;color:var(--on-accent);background:var(--accent);border-radius:7px;padding:5px 12px;cursor:pointer;display:inline-block')}>Open style lab</span>
          </div>
        )}
        {swapOpen && (
          <div style={sx('margin-top:8px;border:1px solid var(--border);border-radius:9px;background:var(--ink);padding:6px')}>
            {locks.length === 0 && <div style={sx('font-size:10.5px;color:var(--fg-faint);padding:6px')}>No saved styles — build one in the style lab.</div>}
            {locks.map(l => (
              <div key={l.id} onClick={() => !busy && this.lockStyle(l.id)} className="hBg"
                style={{ ...sx('display:flex;align-items:center;gap:8px;padding:5px 7px;border-radius:7px;cursor:pointer'), opacity: busy ? 0.5 : 1 }}>
                {l.refImage
                  ? <img src={api.styleLockRefUrl(l.id)} alt="" style={sx('width:26px;height:26px;border-radius:5px;object-fit:cover;flex:none')} />
                  : <span style={sx('width:26px;height:26px;border-radius:5px;background:var(--raise);display:flex;align-items:center;justify-content:center;color:var(--border-3);font-size:12px;flex:none')}>✦</span>}
                <span style={sx('font-size:11.5px;color:var(--fg-soft);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{l.name || l.id}</span>
                {l.id === lockId && <span style={sx('font-size:9px;color:var(--accent)')}>active</span>}
              </div>
            ))}
            {lockId && <div onClick={() => !busy && this.lockStyle('')} className="hBdRed"
              style={sx('font-size:10.5px;color:var(--danger);text-align:center;padding:6px;cursor:pointer;border-top:1px solid var(--border);margin-top:4px')}>Clear lock</div>}
          </div>
        )}
      </div>
    );
  }

  renderBoard(label, items) {
    const { pid } = this.props;
    const secId = label.toLowerCase();
    const open = this.secOpen(secId);
    if (!open) return (
      <div style={sx('margin-bottom:16px')}>
        <SectionHead label={label} count={items.length} open={false} onToggle={() => this.toggleSection(secId)} />
        <StatusLine>{items.length ? items.length + ' ON THE BOARD' : 'NONE YET'}</StatusLine>
      </div>
    );
    return (
      <div style={sx('margin-bottom:16px')}>
        <SectionHead label={label} count={items.length} open onToggle={() => this.toggleSection(secId)}
          action={<span onClick={() => this.openAssets()} className="hFg" style={sx('font-size:10px;color:var(--fg-muted);cursor:pointer')}>Board</span>} />
        {items.length === 0 ? (
          <StatusLine>NO {label} YET — ADD REFERENCES IN ASSETS</StatusLine>
        ) : (
          // Masonry columns, NOT a square grid: each reference keeps its own aspect ratio (a
          // portrait turnaround stays portrait), and three columns keep the tiles small — these
          // are context cues, not a gallery. Click still opens the full-size lightbox.
          <div style={sx('column-count:3;column-gap:6px')}>
            {items.slice(0, 9).map((c, i) => {
              const src = api.contextUrl(pid, c.name, c.folder);
              const key = entityKey(c.name);
              return (
                <div key={c.folder + '/' + c.name + i} onClick={() => this.setState({ lightbox: { src, kind: c.type, name: c.name } })}
                  title={'@' + key + ' — click to view, drag into the chat bar to mention'} className="hBd"
                  draggable onDragStart={e => e.dataTransfer.setData('text/plain', '@' + key + ' ')}
                  style={sx('break-inside:avoid;margin-bottom:6px;border:1px solid var(--border);border-radius:7px;overflow:hidden;cursor:pointer;background:var(--sunk)')}>
                  <RenderMedia src={src} kind={c.type} fit={null} hoverPlay style={sx('width:100%;height:auto;display:block')} />
                  {/* the @key IS the identity you type — shown so mentioning never needs a hover */}
                  <div style={{ ...sx('padding:3px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'), fontFamily: MONO, fontSize: 8.5, color: 'var(--fg-muted)' }}>@{key}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  renderLookSheets() {
    const { looks, busy } = this.state;
    const open = this.secOpen('looks');
    if (!open) return (
      <div style={sx('margin-bottom:4px')}>
        <SectionHead label="LOOK SHEETS" count={looks.length} open={false} onToggle={() => this.toggleSection('looks')} />
        <StatusLine>{looks.length ? looks.length + ' EXTRACTED' : 'NONE YET'}</StatusLine>
      </div>
    );
    return (
      <div style={sx('margin-bottom:4px')}>
        <SectionHead label="LOOK SHEETS" count={looks.length} open onToggle={() => this.toggleSection('looks')} />
        {looks.length === 0 ? (
          <StatusLine>NO LOOKS YET — EXTRACT ONE FROM ANY REFERENCE</StatusLine>
        ) : looks.slice(0, 6).map(look => {
          const src = lookSrc(look.source);
          const palette = Array.isArray(look.palette) ? look.palette.slice(0, 6) : [];
          return (
            <div key={look.id} style={sx('border:1px solid var(--border);border-radius:9px;overflow:hidden;background:var(--surface);margin-bottom:7px')}>
              <div style={sx('display:flex;gap:8px;padding:7px')}>
                {src ? <RenderMedia src={src} kind="image" fit="cover" style={sx('width:44px;height:44px;border-radius:6px;flex:none')} /> : null}
                <div style={sx('flex:1;min-width:0')}>
                  <div style={sx('font-size:10.5px;color:var(--fg-soft);line-height:1.45;overflow:hidden')}>{String(look.tier1 || look.tier2 || '').slice(0, 92) || look.id}</div>
                  {palette.length ? (
                    <div style={sx('display:flex;gap:3px;margin-top:5px')}>
                      {palette.map((c, i) => <span key={i} title={c} style={{ ...sx('width:12px;height:12px;border-radius:3px;flex:none'), background: c, border: '1px solid rgba(255,255,255,.12)' }} />)}
                    </div>
                  ) : null}
                </div>
              </div>
              {this.props.pid && (
                <div onClick={() => !busy && this.lockFromLook(look)} className="hBg"
                  style={{ ...sx('font-size:10px;font-weight:700;letter-spacing:.06em;color:var(--accent);text-align:center;padding:5px;cursor:pointer;border-top:1px solid var(--border)'), opacity: busy ? 0.5 : 1 }}>Lock this look</div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // ── TOOLS (handover: the context rail's bottom section) ──
  // Enablement is PER PROJECT and this rail is where it happens — Settings holds only the global
  // default a project inherits before it has an opinion of its own. A tool that is off is absent
  // from the agent's Index entirely, so this list is the honest picture of what the agent can reach
  // in THIS project.
  tools() {
    const built = CHAT_TOOLS.map(t => ({ id: t.id, name: t.name, capability: t.capability, enabledByDefault: t.enabledByDefault, source: 'system' }));
    const seen = new Set(built.map(t => t.id));
    const mine = (this.state.userTools || []).filter(t => t && !seen.has(t.id))
      .map(t => ({ id: t.id, name: t.name || t.id, capability: t.capability || '', enabledByDefault: false, source: 'user' }));
    const project = (this.props.pdef && this.props.pdef.enabledTools) || {};
    const global = (this.props.app.state.settings || {}).enabledChatTools || {};
    return [...built, ...mine].map(t => ({
      ...t,
      enabled: resolveToolEnabled(t.id, { project, global, tool: t }),
      // 'project' = pinned here; 'global' = still inheriting. The rail says which, because otherwise
      // a user cannot tell why a tool they turned on in Settings is off in this project.
      scope: Object.prototype.hasOwnProperty.call(project, t.id) ? 'project' : 'global'
    }));
  }

  // enabled === null clears the project's opinion so the tool inherits the global default again.
  setTool(id, enabled) {
    const pid = this.props.pid;
    if (!pid) return;
    this.setState({ toolBusy: id });
    api.toggleProjectTool(pid, id, enabled)
      .then(() => this.props.app.sync?.())
      .catch(e => this.props.app.showToast?.('Could not change tool — ' + (e.message || ''), 'var(--danger)'))
      .finally(() => this.setState({ toolBusy: null }));
  }

  renderTools() {
    const tools = this.tools();
    const on = tools.filter(t => t.enabled).length;
    const open = this.secOpen('tools');
    if (!open) return (
      <div style={sx('margin-bottom:4px')}>
        <SectionHead label="TOOLS" count={on + '/' + tools.length} open={false} onToggle={() => this.toggleSection('tools')} />
        <StatusLine>{on ? on + ' ENABLED FOR THIS PROJECT' : 'NONE ENABLED'}</StatusLine>
      </div>
    );
    return (
      <div style={sx('margin-bottom:4px')}>
        <SectionHead label="TOOLS" count={on + '/' + tools.length} open onToggle={() => this.toggleSection('tools')}
          action={<span onClick={() => this.props.app.go?.('settings', { settingsNav: 'chat-tools' })} className="hFg"
            title="Global defaults — what a NEW project inherits" style={sx('font-size:10px;color:var(--fg-muted);cursor:pointer')}>Defaults</span>} />
        <div style={sx('display:flex;flex-direction:column;gap:5px')}>
          {tools.map(t => {
            const busy = this.state.toolBusy === t.id;
            return (
              <div key={t.id} style={{ ...sx('display:flex;align-items:center;gap:7px'), opacity: busy ? 0.5 : 1 }}>
                <Toggle on={t.enabled} title={(t.enabled ? 'Disable' : 'Enable') + ' ' + t.name + ' for this project'}
                  onClick={() => !busy && this.setTool(t.id, !t.enabled)} />
                <span title={t.capability} style={{ ...sx('font-size:10.5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), color: t.enabled ? 'var(--fg-soft)' : 'var(--fg-faint)' }}>{t.name}</span>
                {t.source === 'user' ? <span style={{ fontFamily: MONO, fontSize: 8, color: 'var(--border-3)', flex: 'none' }}>yours</span> : null}
                {t.scope === 'project' ? (
                  <span onClick={() => !busy && this.setTool(t.id, null)} className="hFg" title="Set for this project — click to inherit the global default again"
                    style={{ ...sx('margin-left:auto;flex:none;cursor:pointer'), fontFamily: MONO, fontSize: 8, letterSpacing: '.1em', color: 'var(--accent)' }}>SET</span>
                ) : (
                  <span title="Inheriting the global default (Settings → Chat tools)"
                    style={{ ...sx('margin-left:auto;flex:none'), fontFamily: MONO, fontSize: 8, letterSpacing: '.1em', color: 'var(--border-3)' }}>INH</span>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ ...sx('margin-top:8px;line-height:1.6'), fontFamily: MONO, fontSize: 8, letterSpacing: '.06em', color: 'var(--border-3)' }}>
          PER PROJECT · A DISABLED TOOL IS ABSENT FROM THE AGENT'S INDEX · TAKES EFFECT NEXT SESSION
        </div>
      </div>
    );
  }

  render() {
    const { pdef } = this.props;
    const { collapsed, lightbox } = this.state;
    if (collapsed) {
      return (
        <div style={sx('width:38px;flex:none;border-left:1px solid var(--line);background:var(--ink);display:flex;flex-direction:column;align-items:center;padding-top:12px;gap:10px')}>
          <span onClick={() => this.toggleCollapse()} className="hFg" title="Expand production panel"
            style={sx('font-size:13px;color:var(--fg-muted);cursor:pointer')}>◀</span>
          <span style={{ writingMode: 'vertical-rl', fontSize: 10, fontWeight: 700, letterSpacing: '.16em', color: 'var(--fg-faint)', cursor: 'pointer' }}
            onClick={() => this.toggleCollapse()}>PRODUCTION</span>
        </div>
      );
    }
    const ctx = (pdef && pdef.context && pdef.context.items) || [];
    const media = ctx.filter(c => c.type === 'image' || c.type === 'video');
    const cast = media.filter(c => CAST_RE.test(c.folder || ''));
    const locations = media.filter(c => LOC_RE.test(c.folder || ''));
    return (
      <div style={{ ...sx('flex:none;background:var(--ink);display:flex;flex-direction:column'), width: this.props.width || 290 }}>
        <div style={sx('display:flex;align-items:center;gap:8px;padding:12px 12px 8px;border-bottom:1px solid var(--line)')}>
          <span style={sx('font-size:11px;font-weight:700;letter-spacing:.14em;color:var(--fg)')}>PRODUCTION</span>
          <span onClick={() => this.toggleCollapse()} className="hFg" title="Collapse"
            style={sx('margin-left:auto;font-size:13px;color:var(--fg-faint);cursor:pointer')}>▶</span>
        </div>
        <div className="chatScroll" style={sx('flex:1;padding:12px 12px 16px;overflow-y:auto')}>
          {this.renderUnderstanding()}
          {this.renderLockedStyle()}
          {this.renderBoard('CAST', cast)}
          {this.renderBoard('LOCATIONS', locations)}
          {this.renderLookSheets()}
          {/* TOOLS closes the rail, per the handover's context rail (it sits under LEARNINGS at the
              bottom). It is the LAST section because it is configuration, not creative context. */}
          <div style={sx('border-top:1px solid var(--line);margin:12px 0 0;padding-top:12px')}>
            {this.renderTools()}
          </div>
        </div>
        {lightbox && (
          <RenderLightbox src={lightbox.src} kind={lightbox.kind} keyboard
            onClose={() => this.setState({ lightbox: null })}
            caption={<div style={sx('font-size:12px;color:var(--fg-soft)')}>{lightbox.name}</div>}
            actions={<div onClick={() => { this.setState({ lightbox: null }); this.openAssets(); }} className="hBtnAccent"
              style={sx('font-size:12px;font-weight:700;color:var(--on-accent);background:var(--accent);border-radius:8px;padding:7px 16px;cursor:pointer')}>Open in Assets</div>}
            mediaStyle={sx('max-width:82vw;max-height:74vh;border-radius:10px')} />
        )}
      </div>
    );
  }
}
