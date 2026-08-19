// Ticket 25 — the two directive cards the tool builder needs.
//
//   tool.draft — the payoff beat. The toolsmith proposes a tool; this card shows it IN FULL and
//                puts a Create button under it. The preview is the review step, which is the whole
//                reason the agent doesn't just POST it itself (it has curl and could).
//   tool.card  — ONE generic renderer shared by every authored tool, forever.
//
// WHY ONE STATIC TYPE, NOT A TYPE PER TOOL. shared/chatTools.mjs builds CHAT_TOOL_BY_DIRECTIVE in an
// IIFE at module load and toolRegistry.jsx iterates it once at import — so a directive type invented
// at runtime gets no registered renderer and falls through to directives.jsx's PendingDirectiveCard,
// which is UNGATED. That would render a disabled tool's card. Forcing every authored tool onto one
// static type (backend/userTools.mjs USER_TOOL_DIRECTIVE) closes that hole at any tool count: the
// renderer below does its own live enablement check, mirroring toolRegistry.isToolEnabled exactly.
import React from 'react';
import { sx } from '../sx';
import { api } from '../api';
import { registerDirectiveRenderer, CardShell as Shell } from './directives';
import { isToolEnabled } from './toolRegistry';
import { MONO } from '../tokens';

const str = v => (v == null ? '' : String(v));

// ── tool.draft ── the proposal, with the body shown whole and a Create button ──
class ToolDraftCard extends React.Component {
  state = { busy: false, created: null, err: null };

  draft() {
    const d = this.props.directive || {};
    return {
      id: str(d.id || d.toolId || d.ref).trim().toLowerCase(),
      name: str(d.name || d.title).trim(),
      capability: str(d.capability || d.summary || d.description).trim(),
      instructions: str(d.instructions || d.body || d.content)
    };
  }

  create() {
    const { app } = this.props.ctx || {};
    const draft = this.draft();
    this.setState({ busy: true, err: null });
    api.createUserTool(draft)
      .then(r => {
        const tool = (r && r.tool) || draft;
        this.setState({ busy: false, created: tool });
        app?.showToast?.('“' + tool.name + '” created — switch it on in Settings → Chat tools', 'var(--ok)');
        app?.reloadUserTools?.();
      })
      .catch(e => {
        const msg = e && e.message ? e.message : 'could not create the tool';
        this.setState({ busy: false, err: msg });
        // Hand the failure back to the agent in-band so it can repair the offending field and
        // re-propose, instead of the filmmaker having to relay a validation error by hand.
        const sid = (this.props.ctx || {}).session?.id;
        if (sid) api.chatSystemEvent(sid, 'Tool creation rejected: ' + msg).catch(() => {});
      });
  }

  render() {
    const { app } = this.props.ctx || {};
    const d = this.draft();
    const { busy, created, err } = this.state;
    const rows = d.instructions ? d.instructions.split('\n').length : 0;

    return (
      <Shell label="new tool" dashed={!created} tone={created ? 'var(--ok)' : 'var(--accent)'}
        right={d.id ? <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>{d.id}</span> : null}>
        <div style={sx('font-size:13.5px;font-weight:800;color:var(--fg)')}>{d.name || 'Untitled tool'}</div>
        {d.capability ? <div style={sx('font-size:11.5px;color:var(--fg-muted);line-height:1.55;margin-top:5px')}>{d.capability}</div> : null}

        {d.instructions ? (
          <>
            <div style={{ ...sx('display:flex;align-items:center;gap:7px;margin-top:11px'), fontFamily: MONO, fontSize: 9, color: 'var(--fg-faint)' }}>
              <span style={sx('letter-spacing:.08em;text-transform:uppercase')}>instructions</span>
              <span>{rows} line{rows === 1 ? '' : 's'}</span>
            </div>
            {/* never truncated — the preview IS the gate */}
            <pre style={{ ...sx('margin:6px 0 0;padding:10px 12px;background:var(--void);border:1px solid var(--line);border-radius:8px;max-height:260px;overflow:auto;font-size:11px;line-height:1.6;color:var(--fg-soft);white-space:pre-wrap;word-break:break-word'), fontFamily: MONO }}>{d.instructions}</pre>
          </>
        ) : null}

        {created ? (
          <div style={sx('display:flex;align-items:center;gap:9px;margin-top:11px;flex-wrap:wrap')}>
            <span style={sx('font-size:10.5px;font-weight:700;color:var(--ok);border:1px solid rgba(63,207,142,.4);border-radius:7px;padding:5px 11px')}>✓ saved to your workspace</span>
            <span onClick={() => app?.go?.('settings', { settingsNav: 'chat-tools' })} className="hBd"
              style={sx('font-size:10.5px;font-weight:700;border-radius:7px;padding:5px 12px;cursor:pointer;border:1px solid var(--border-2);color:var(--fg-soft)')}>
              Switch it on →
            </span>
            <span style={sx('font-size:10px;color:var(--fg-faint)')}>off until you do</span>
          </div>
        ) : (
          <div style={sx('display:flex;align-items:center;gap:9px;margin-top:11px;flex-wrap:wrap')}>
            <span onClick={() => !busy && this.create()} className="hBtnAccent"
              style={{ ...sx('font-size:10.5px;font-weight:700;border-radius:7px;padding:6px 14px;cursor:pointer;background:var(--accent);color:var(--on-accent)'), opacity: busy ? .6 : 1, pointerEvents: busy ? 'none' : 'auto' }}>
              {busy ? 'Creating…' : 'Create tool'}
            </span>
            <span style={sx('font-size:10px;color:var(--fg-faint)')}>saves to your workspace · stays off until you enable it</span>
          </div>
        )}
        {err ? <div style={sx('font-size:11px;color:var(--danger);margin-top:8px;line-height:1.5')}>{err}</div> : null}
      </Shell>
    );
  }
}

// ── tool.card ── the one card every authored tool renders through ──
// Enablement resolution is IMPORTED, not restated: this file used to carry a byte-copy of
// toolRegistry's oracle, which would now be a copy missing the per-project layer. One oracle.
const toolEnabled = (ctx, id) => isToolEnabled(ctx, id);

function UserToolCard({ directive, ctx }) {
  const id = str(directive.tool || directive.toolId || directive.ref).trim();
  const app = (ctx || {}).app;

  if (id && !toolEnabled(ctx, id)) {
    return (
      <div className="chatDirective chatToolDisabled" style={sx('border:1px dashed var(--border-2);border-radius:10px;background:var(--surface);padding:11px 13px;margin:9px 0')}>
        <div style={sx('display:flex;align-items:center;gap:8px')}>
          <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>{id}</span>
          <span style={sx('margin-left:auto;font-size:9px;font-weight:800;letter-spacing:.06em;color:var(--fg-faint);border:1px solid var(--border-2);border-radius:99px;padding:1.5px 8px')}>DISABLED</span>
        </div>
        <div style={sx('font-size:11.5px;color:var(--fg-muted);margin-top:7px;line-height:1.5')}>One of your tools tried to show a card, but the tool is switched off.</div>
        <span onClick={() => app?.go?.('settings', { settingsNav: 'chat-tools' })} className="hBdAccentChip"
          style={sx('display:inline-block;margin-top:10px;font-size:10.5px;font-weight:700;color:var(--accent);border:1px solid rgba(227,255,50,.4);border-radius:7px;padding:5px 12px;cursor:pointer')}>
          Enable this tool
        </span>
      </div>
    );
  }

  const fields = Array.isArray(directive.fields) ? directive.fields.filter(f => f && (f.k || f.key)) : [];
  const title = str(directive.title);
  const summary = str(directive.summary || directive.text);
  return (
    <Shell label={id || 'tool'} right={<span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>yours</span>}>
      {title ? <div style={sx('font-size:13px;font-weight:700;color:var(--fg)')}>{title}</div> : null}
      {summary ? <div style={sx('font-size:11.5px;color:var(--fg-soft);line-height:1.55;margin-top:5px')}>{summary}</div> : null}
      {fields.length ? (
        <div style={sx('display:flex;flex-direction:column;gap:4px;margin-top:9px;border-top:1px solid var(--line);padding-top:9px')}>
          {fields.slice(0, 12).map((f, i) => (
            <div key={i} style={sx('display:flex;gap:10px;align-items:baseline')}>
              <span style={{ ...sx('flex:none;width:96px;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9 }}>{str(f.k || f.key)}</span>
              <span style={sx('font-size:11.5px;color:var(--fg-soft);line-height:1.5;min-width:0')}>{str(f.v !== undefined ? f.v : f.value)}</span>
            </div>
          ))}
        </div>
      ) : null}
      {!title && !summary && !fields.length
        ? <div style={sx('font-size:11.5px;color:var(--fg-faint)')}>This tool rendered an empty card.</div>
        : null}
    </Shell>
  );
}

for (const t of ['tool.draft', 'tool-draft', 'toolDraft'])
  registerDirectiveRenderer(t, (directive, ctx) => <ToolDraftCard directive={directive} ctx={ctx || {}} />);

// The single type every user tool may emit. Registered ONCE, statically — see the note at the top.
registerDirectiveRenderer('tool.card', (directive, ctx) => <UserToolCard directive={directive} ctx={ctx || {}} />);

export { ToolDraftCard, UserToolCard };
