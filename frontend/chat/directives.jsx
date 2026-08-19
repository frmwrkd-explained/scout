// Directive-card mounting seam (ticket 11 → consumed by ticket 12).
//
// A "directive" is the parsed payload the agent emits inside a `frameforge` fenced block. The chat
// backend (backend/chat.mjs) re-broadcasts each one as a `directive` SSE event mid-turn and persists
// the full set on the assistant message's `directives[]`. Ticket 11 renders EVERY directive as a
// neutral "pending" placeholder card. Ticket 12 lands the real cards (generation / shot-list /
// grid-split / style) WITHOUT touching Chat.jsx: it calls registerDirectiveRenderer(type, fn) once
// per card type (e.g. in its own module, imported for its side effect). Any type without a
// registered renderer keeps degrading to the placeholder below — never a throw, never a blank.
//
// The single seam ticket 12 consumes:
//   registerDirectiveRenderer(type, (directive, ctx) => ReactNode)
//     · `type`      — matched against directiveType(directive) (see below)
//     · `directive` — the raw parsed object the agent emitted
//     · `ctx`       — { app, pid, session, message, live } supplied by Chat.jsx at render time, so a
//                     card can fetch canonical records (ctx.app / api) and act on them. The LLM never
//                     restates stored data — a card renders from refs by fetching, per the spec.
//
// Keep this module free of Chat.jsx internals so the registry can be imported from anywhere.
import React from 'react';
import { sx } from '../sx';
import { Card, Eyebrow } from '../ui';
import { MONO } from '../tokens';


// ── the ONE chat card shell (ticket 05 adoption) ──
// The four per-file `CardShell` copies (cards.jsx, generationCards.jsx, shotBoardCard.jsx,
// splitCard.jsx) and the two `Shell` copies (confirmCard.jsx, toolCards.jsx) now live here, built on
// ui.jsx's Card — which was written as this component's generalization (r10 / --surface / --border-2 /
// 11px 13px). The `margin:9px 0` is chat-list stacking and stays here, not in Card. `dashed` carries
// toolCards' staged-proposal look, tokenised to --accent-35 (was a raw rgba of the same value).
// The right slot gets tabular-nums so the costs/ids/counts that live there keep column alignment.
export function CardShell({ label, tone = 'var(--accent)', dashed = false, right, children, className = '', style }) {
  return (
    <Card className={('chatDirective chatCard ' + className).trim()}
      style={{ margin: '9px 0', ...(dashed ? { border: '1px dashed var(--accent-35)' } : null), ...style }}>
      <div style={sx('display:flex;align-items:center;gap:8px;margin-bottom:8px')}>
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: 99, background: tone, flex: 'none' }} />
        <Eyebrow>{label}</Eyebrow>
        {right ? <span style={{ ...sx('margin-left:auto'), fontVariantNumeric: 'tabular-nums' }}>{right}</span> : null}
      </div>
      {children}
    </Card>
  );
}

const renderers = new Map(); // type -> (directive, ctx) => ReactNode

export function registerDirectiveRenderer(type, fn) { renderers.set(String(type), fn); }
export function hasDirectiveRenderer(type) { return renderers.has(String(type)); }

// A directive's discriminator. The spec ships four envelope categories (show / proposal / progress /
// confirm) plus a concrete `type` registered per tool or pack; we key on `type` first and fall back
// to the envelope so a partially-specified directive still routes to something.
export function directiveType(d) {
  if (!d || typeof d !== 'object') return null;
  return d.type || d.kind || d.category || d.envelope || null;
}

// The one call Chat.jsx (and any future surface) uses to turn a directive into a card. Ticket 12's
// registered renderers win; everything else falls through to the neutral placeholder.
export function renderDirective(directive, ctx) {
  if (!directive || typeof directive !== 'object') return null;
  const type = directiveType(directive);
  const fn = type && renderers.get(String(type));
  if (fn) {
    try { return fn(directive, ctx || {}); }
    catch { /* a broken card must not break the transcript — show the placeholder instead */ }
  }
  return <PendingDirectiveCard directive={directive} type={type} />;
}

// ── inline placement (ticket 12) ──
//
// The backend rewrites each `frameforge` fence into a stable marker ⟦frameforge:N⟧ inside the
// assistant prose (backend/agentRunner.mjs parseDirectives). N indexes the message's directives[].
// splitDirectiveMarkers() turns the prose into an ordered run of text/card segments so a card renders
// exactly where its fence sat — not appended at the end.
const MARKER_RE = /⟦frameforge:(\d+)⟧/g;
export function splitDirectiveMarkers(text) {
  const s = String(text || '');
  const out = [];
  let last = 0, m;
  MARKER_RE.lastIndex = 0;
  while ((m = MARKER_RE.exec(s))) {
    if (m.index > last) out.push({ t: 'text', text: s.slice(last, m.index) });
    out.push({ t: 'card', index: Number(m[1]) });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: 'text', text: s.slice(last) });
  return out;
}

// Render one assistant message body: prose segments (via the caller's Markdown component) interleaved
// with directive cards at their marker positions. Falls back to "prose then cards appended" for
// messages with directives but no markers (older records, or the live in-flight reply whose raw text
// still carries fences). Any directive not referenced by a marker is appended so nothing is dropped.
export function renderMessageBody(text, directives, ctx, Md) {
  const list = Array.isArray(directives) ? directives : [];
  const segs = splitDirectiveMarkers(text);
  const hasMarkers = segs.some(s => s.t === 'card');
  if (!hasMarkers) {
    const nodes = [];
    if (text) nodes.push(<Md key="md" src={text} />);
    list.forEach((d, i) => nodes.push(<div key={'d' + i}>{renderDirective(d, ctx)}</div>));
    return nodes;
  }
  const used = new Set();
  const nodes = [];
  segs.forEach((seg, i) => {
    if (seg.t === 'text') { if (seg.text.trim()) nodes.push(<Md key={'t' + i} src={seg.text} />); return; }
    used.add(seg.index);
    const d = list[seg.index];
    if (d) nodes.push(<div key={'c' + i}>{renderDirective(d, ctx)}</div>);
  });
  list.forEach((d, i) => { if (!used.has(i)) nodes.push(<div key={'x' + i}>{renderDirective(d, ctx)}</div>); });
  return nodes;
}

// Malformed directive (a fence whose JSON did not parse). Degrade to the raw text the agent wrote,
// plus a subtle warning — never a crash, never a silent drop.
function MalformedDirectiveCard({ directive }) {
  const raw = String(directive.raw || directive.text || '').trim();
  return (
    <div className="chatDirective chatDirectiveWarn" style={sx('border:1px solid rgba(240,91,84,.35);border-radius:10px;background:rgba(240,91,84,.06);padding:10px 13px;margin:9px 0')}>
      <div style={sx('display:flex;align-items:center;gap:8px')}>
        <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--danger)' }}>unreadable directive</span>
        <span style={sx('margin-left:auto;font-size:9.5px;color:var(--fg-muted)')}>shown as text</span>
      </div>
      {raw ? <pre style={{ ...sx('margin:7px 0 0;padding:8px 10px;background:var(--void);border-radius:7px;overflow:auto;font-size:11px;color:var(--fg-soft);white-space:pre-wrap;word-break:break-word'), fontFamily: MONO }}>{raw}</pre> : null}
    </div>
  );
}
registerDirectiveRenderer('malformed', directive => <MalformedDirectiveCard directive={directive} />);

// Neutral placeholder — deliberately plain. It only names the directive and shows any obvious
// summary field so a streamed reply reads coherently before the rich card exists. Ticket 12 replaces
// it per type via registerDirectiveRenderer.
function PendingDirectiveCard({ directive, type }) {
  const label = type || 'directive';
  const summary = directive.title || directive.summary || directive.label || directive.caption || directive.text || '';
  return (
    <div className="chatDirective" style={sx('border:1px solid var(--border-2);border-radius:10px;background:var(--surface);padding:11px 13px;margin:9px 0')}>
      <div style={sx('display:flex;align-items:center;gap:8px')}>
        <span style={sx('width:6px;height:6px;border-radius:99px;background:var(--accent);flex:none;animation:dl-pulse 1.4s infinite')} />
        <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>{label}</span>
        <span style={sx('margin-left:auto;font-size:9.5px;color:var(--fg-faint)')}>card pending</span>
      </div>
      {summary ? <div style={sx('font-size:12px;color:var(--fg-soft);margin-top:6px;line-height:1.5')}>{String(summary).slice(0, 260)}</div> : null}
    </div>
  );
}
