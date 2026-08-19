// The Board's node renderers. One component per node kind, all of them PRESENTATIONAL: they take
// a node, some resolved data and callbacks, and render. None of them fetches, and none of them
// writes — the Board owns every mutation, which is what keeps a 200-node canvas to one save path.
//
// ── EVERY PICTURE GOES THROUGH RenderMedia ─────────────────────────────────────────────────────
// Not an <img>. RenderMedia is this repo's canonical media component (CLAUDE.md, "Shared UI") and
// it is what gives a card hover-to-play video, the right object-fit and the audio fallback for
// free. It is also the single reason this board is HTML rather than a <canvas> library: inside a
// canvas scene graph a video take is a still frame you have to hand-decode.
import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { RenderMedia } from './RenderMedia';
import { TEXT_SIZES } from './boardLayout';

const TONE = { accent: 'var(--accent)', ok: 'var(--ok)', warn: 'var(--warn)', danger: 'var(--danger)', neutral: 'var(--border-3)' };

// Selection is one visual language across every kind: an accent ring OUTSIDE the box (box-shadow,
// not border) so selecting never changes a node's layout size by a pixel.
export const ring = on => (on ? { boxShadow: '0 0 0 2px var(--accent), 0 8px 28px rgba(0,0,0,.5)' } : {});

// ── asset ──────────────────────────────────────────────────────────────────────────────────────
export function AssetNode({ node, url, kind, selected, onOpen }) {
  return (
    <div className="rvH" style={{ ...sx('width:100%;height:100%;border-radius:10px;overflow:hidden;position:relative;box-sizing:border-box'), background: 'var(--sunk)', border: '1px solid var(--border)', ...ring(selected) }}>
      <RenderMedia src={url} kind={kind} fit="cover" hoverPlay alt={node.name} style={sx('width:100%;height:100%;display:block')} />
      <div className="rv" style={sx('position:absolute;left:0;right:0;bottom:0;padding:14px 9px 7px;background:linear-gradient(0deg,rgba(6,7,10,.9),transparent);pointer-events:none')}>
        <div style={{ fontFamily: MONO, fontSize: 9, color: 'rgba(255,255,255,.86)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</div>
      </div>
      {onOpen && <span className="rv" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onOpen(node); }}
        style={{ ...sx('position:absolute;top:7px;right:7px;border-radius:5px;padding:3px 8px;cursor:pointer;backdrop-filter:blur(6px)'), fontSize: 9.5, fontWeight: 700, color: 'var(--accent)', background: 'rgba(6,7,10,.78)', border: '1px solid var(--accent-35)' }}>VIEW</span>}
    </div>
  );
}

// ── text ───────────────────────────────────────────────────────────────────────────────────────
// A heading, not a box: no bed, no border. That is what lets a board read as a document with
// sections rather than as a wall of equal-weight rectangles.
export const TEXT_TONES = { fg: 'var(--fg)', muted: 'var(--fg-muted)', accent: 'var(--accent)', ok: 'var(--ok)', warn: 'var(--warn)', danger: 'var(--danger)' };

export function TextNode({ node, selected, editing, onEdit, onChange, onCommit }) {
  const size = TEXT_SIZES[node.size] || TEXT_SIZES.lg;
  const colour = TEXT_TONES[node.tone] || TEXT_TONES.fg;
  const align = node.align || 'left';
  // Shared between the editor and the rendered form so the text does not visibly jump position the
  // moment you double-click it — the thing that makes in-place editing feel like a modal dialog.
  const shape = {
    fontSize: size, fontWeight: node.size === 'sm' ? 600 : 700, lineHeight: 1.25,
    letterSpacing: node.size === 'xl' || node.size === 'lg' ? '-0.02em' : 0,
    textAlign: align, color: colour
  };
  if (editing) {
    return (
      <textarea autoFocus value={node.text || ''} onPointerDown={e => e.stopPropagation()}
        onChange={e => onChange(e.target.value)} onBlur={onCommit}
        onKeyDown={e => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); e.target.blur(); } e.stopPropagation(); }}
        style={{ ...sx('width:100%;height:100%;resize:none;border-radius:6px;padding:4px 6px;box-sizing:border-box;outline:none;font-family:inherit'), ...shape, background: 'var(--surface-2)', border: '1px solid var(--accent-35)' }} />
    );
  }
  return (
    <div onDoubleClick={onEdit}
      style={{
        ...sx('width:100%;height:100%;display:flex;border-radius:6px;padding:4px 6px;box-sizing:border-box;overflow:hidden;white-space:pre-wrap;word-break:break-word'),
        ...shape,
        alignItems: 'center',
        justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
        color: node.text ? colour : 'var(--fg-faint)',
        ...ring(selected)
      }}>
      {node.text || 'Double-click to write'}
    </div>
  );
}

// ── note ───────────────────────────────────────────────────────────────────────────────────────
export function NoteNode({ node, selected, editing, onEdit, onChange, onCommit }) {
  const tone = TONE[node.tone] || TONE.accent;
  const bed = { background: 'var(--raise)', border: '1px solid ' + tone, borderLeft: '3px solid ' + tone };
  if (editing) {
    return (
      <textarea autoFocus value={node.text || ''} onPointerDown={e => e.stopPropagation()}
        onChange={e => onChange(e.target.value)} onBlur={onCommit}
        onKeyDown={e => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); e.target.blur(); } e.stopPropagation(); }}
        style={{ ...sx('width:100%;height:100%;resize:none;border-radius:9px;padding:11px 12px;box-sizing:border-box;outline:none;font-size:12.5px;line-height:1.5'), color: 'var(--fg)', ...bed }} />
    );
  }
  return (
    <div onDoubleClick={onEdit}
      style={{ ...sx('width:100%;height:100%;border-radius:9px;padding:11px 12px;box-sizing:border-box;overflow:hidden;font-size:12.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word'), color: node.text ? 'var(--fg)' : 'var(--fg-faint)', ...bed, ...ring(selected) }}>
      {node.text || 'Double-click to write'}
    </div>
  );
}

// ── the lock pip ───────────────────────────────────────────────────────────────────────────────
// A locked node cannot be dragged or resized, which is what a frame you have finished arranging
// wants. The pip is the only affordance: it shows on hover and stays visible while locked, so a
// card that refuses to move always says why.
export function LockPip({ locked, onToggle }) {
  return (
    <span className={locked ? '' : 'rv'} onPointerDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); onToggle(); }} title={locked ? 'Unlock' : 'Lock in place'}
      style={{
        ...sx('position:absolute;top:6px;left:6px;width:20px;height:20px;border-radius:5px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:4;font-size:10px;backdrop-filter:blur(6px)'),
        background: 'rgba(6,7,10,.72)', border: '1px solid ' + (locked ? 'var(--accent-35)' : 'var(--border-2)'),
        color: locked ? 'var(--accent)' : 'var(--fg-faint)'
      }}>{locked ? '🔒' : '🔓'}</span>
  );
}

// ── frame ──────────────────────────────────────────────────────────────────────────────────────
// Drawn behind everything (the Board renders frames first — array order IS z-order in the
// document). Its title bar is the only hit target: a frame you could grab anywhere would swallow
// every click meant for the cards inside it.
export function FrameNode({ node, selected, editing, onEdit, onChange, onCommit, onGrab }) {
  return (
    <div style={{ ...sx('width:100%;height:100%;border-radius:14px;box-sizing:border-box;pointer-events:none'), background: 'var(--surface)', border: '1px solid ' + (selected ? 'var(--accent)' : 'var(--border)'), ...(selected ? { boxShadow: '0 0 0 1px var(--accent-35)' } : {}) }}>
      <div onPointerDown={onGrab} onDoubleClick={onEdit}
        style={sx('display:inline-flex;align-items:center;gap:8px;padding:12px 18px 0;pointer-events:auto;cursor:move')}>
        {editing
          ? <input autoFocus value={node.label || ''} onPointerDown={e => e.stopPropagation()}
            onChange={e => onChange(e.target.value)} onBlur={onCommit}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); e.stopPropagation(); }}
            style={{ ...sx('border-radius:5px;padding:2px 7px;outline:none;width:220px'), fontFamily: MONO, fontSize: 11.5, fontWeight: 700, letterSpacing: '.1em', color: 'var(--fg)', background: 'var(--surface-2)', border: '1px solid var(--accent-35)' }} />
          : <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 700, letterSpacing: '.12em', color: 'var(--fg-muted)' }}>{node.label || 'FRAME'}</span>}
      </div>
    </div>
  );
}
