// The chat-tools registry — card side (ticket 15).
//
// ONE registry, keyed by tool id, is the single source both the session Index (backend, via
// shared/chatTools.mjs → backend/agentHome.registerChatTool) and the card renderer read. This module
// is the CARD half: it takes the shared tool declaration (shared/chatTools.mjs) and, for every
// directive type a tool declares, installs a GUARDED directive renderer that:
//
//   · tool DISABLED           → an "enable this tool" notice card (link/hint to Settings → Chat tools)
//   · tool ENABLED, has card  → the real card (registered via registerToolCard by cards.jsx / tickets
//                               16 + 17), rendered from the directive's refs
//   · tool ENABLED, no card   → a neutral "tool enabled, card coming" placeholder (an entry may ship
//                               before its card exists)
//
// Adding a tool = one entry in shared/chatTools.mjs + one registerToolCard() call. No edit here, no
// edit to directives.jsx, no router-skill edit. Unregistered directive types are untouched — they
// keep degrading to directives.jsx's neutral placeholder.
//
// Enablement is read LIVE from settings (ctx.app.state.settings.enabledChatTools) at render time, so
// flipping a Settings toggle re-renders the transcript's cards without any refetch. Default OFF for
// every tool (hackathon compliance) — a tool is enabled only when its key is explicitly true.
import React from 'react';
import { CHAT_TOOLS, CHAT_TOOL_BY_DIRECTIVE, resolveToolEnabled } from '../../shared/chatTools.mjs';
import { registerDirectiveRenderer } from './directives';
import { sx } from '../sx';
import { api } from '../api';
import { MONO } from '../tokens';


// card renderers keyed by tool id — filled by cards.jsx (style-locks, the demonstration) and by the
// grid-splitter / shot-board tickets. (directive, ctx) => ReactNode.
const cardRenderers = new Map();
export function registerToolCard(toolId, fn) { cardRenderers.set(String(toolId), fn); }
export function hasToolCard(toolId) { return cardRenderers.has(String(toolId)); }

// The registry, exposed as data for Settings → Chat tools (display name + capability + enabled).
export const CHAT_TOOL_REGISTRY = CHAT_TOOLS;

// The project whose tool map applies to this render. ctx.pid is supplied by Chat.jsx on every card
// context, so no prop plumbing is needed; a standalone chat has none and resolves globally.
export function projectToolMap(ctx) {
  const pid = ctx && ctx.pid;
  if (!pid) return null;
  const projects = (ctx.app && ctx.app.state && ctx.app.state.projects) || [];
  const p = projects.find(x => x && x.id === pid);
  return (p && p.enabledTools && typeof p.enabledTools === 'object') ? p.enabledTools : null;
}

// Resolve a tool's on/off state from live app state — project map first, then the global default.
// Both layers come straight from /api/state (project.md frontmatter rides listProjects() unfiltered),
// so flipping a toggle re-renders the transcript's cards on the next sync with no refetch here.
// The RULE itself lives in shared/chatTools.mjs so this and the backend can never disagree.
export function isToolEnabled(ctx, toolId) {
  const settings = (ctx && ctx.app && ctx.app.state && ctx.app.state.settings) || {};
  return resolveToolEnabled(toolId, {
    project: projectToolMap(ctx),
    global: settings.enabledChatTools || {}
  });
}

// ── the enable-notice card ── shown in place of a real card when the owning tool is disabled ──
// Enablement is per project and lives in the chat's TOOLS rail, so the notice turns the tool on FOR
// THIS PROJECT in one click rather than deep-linking to a global settings page (which is the wrong
// scope: enabling there would arm the tool for every project in the install). A standalone chat has
// no project to write to, so there the only layer — and the only link — is the global default.
function EnableToolNotice({ tool, ctx }) {
  const app = ctx && ctx.app;
  const pid = ctx && ctx.pid;
  const enableHere = () => {
    if (!pid) return;
    api.toggleProjectTool(pid, tool.id, true)
      .then(() => { app?.sync?.(); app?.showToast?.(tool.name + ' enabled for this project', 'var(--accent)'); })
      .catch(e => app?.showToast?.('Could not enable — ' + (e.message || ''), 'var(--danger)'));
  };
  const goSettings = () => {
    try { app && app.go && app.go('settings', { settingsNav: 'chat-tools' }); } catch { /* nav is best-effort */ }
  };
  return (
    <div className="chatDirective chatToolDisabled" style={sx('border:1px dashed var(--border-2);border-radius:10px;background:var(--surface);padding:11px 13px;margin:9px 0')}>
      <div style={sx('display:flex;align-items:center;gap:8px')}>
        <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>{tool.name}</span>
        <span style={sx('margin-left:auto;font-size:9px;font-weight:800;letter-spacing:.06em;color:var(--fg-faint);border:1px solid var(--border-2);border-radius:99px;padding:1.5px 8px')}>DISABLED</span>
      </div>
      <div style={sx('font-size:11.5px;color:var(--fg-muted);margin-top:7px;line-height:1.5')}>{tool.capability}</div>
      <div style={sx('display:flex;align-items:center;gap:9px;margin-top:10px')}>
        <span onClick={pid ? enableHere : goSettings} className="hBdAccentChip"
          style={sx('font-size:10.5px;font-weight:700;color:var(--accent);border:1px solid var(--accent-35);border-radius:7px;padding:5px 12px;cursor:pointer')}>
          {pid ? 'Enable for this project' : 'Enable this tool'}
        </span>
        <span style={sx('font-size:10px;color:var(--fg-faint)')}>
          {pid ? 'Production rail → TOOLS · takes effect next session' : 'Settings → Chat tools · standalone chats use the global default'}
        </span>
      </div>
    </div>
  );
}

// ── enabled-but-no-card placeholder ── an entry can ship before its card lands (ticket 16/17) ──
function ToolCardPending({ tool, directive }) {
  const summary = (directive && (directive.title || directive.summary || directive.label || directive.caption)) || '';
  return (
    <div className="chatDirective" style={sx('border:1px solid var(--border-2);border-radius:10px;background:var(--surface);padding:11px 13px;margin:9px 0')}>
      <div style={sx('display:flex;align-items:center;gap:8px')}>
        <span style={sx('width:6px;height:6px;border-radius:99px;background:var(--accent);flex:none;animation:dl-pulse 1.4s infinite')} />
        <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>{tool.name}</span>
        <span style={sx('margin-left:auto;font-size:9.5px;color:var(--fg-faint)')}>card coming</span>
      </div>
      {summary ? <div style={sx('font-size:12px;color:var(--fg-soft);margin-top:6px;line-height:1.5')}>{String(summary).slice(0, 260)}</div> : null}
    </div>
  );
}

// Install one guarded renderer per directive type any tool declares. Enablement + card lookup happen
// at RENDER time (not now), so registerToolCard() calls that run after this import still take effect.
for (const [type, tool] of CHAT_TOOL_BY_DIRECTIVE) {
  registerDirectiveRenderer(type, (directive, ctx) => {
    if (!isToolEnabled(ctx, tool.id)) return <EnableToolNotice tool={tool} ctx={ctx || {}} />;
    const card = cardRenderers.get(tool.id);
    if (card) return card(directive, ctx || {});
    return <ToolCardPending tool={tool} directive={directive} />;
  });
}
