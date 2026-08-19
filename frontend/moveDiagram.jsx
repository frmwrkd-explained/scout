// The per-movement schematic — camera glyph plus an accent motion arrow.
//
// Its own module because THREE surfaces draw it: the Camera Moves picker, StyleLab's CAMERA
// tab, and the move analyzer. It used to live in CameraMoves.jsx, which was fine until the
// analyzer needed it too — CameraMoves imports the analyzer, so the analyzer importing back
// for the glyph made a cycle. CameraMoves.jsx re-exports it, so StyleLab's existing import
// keeps working; that facade is the same shape as models.js over modelCatalog.js.
import React from 'react';
import { sx } from './sx';

const AMBER = 'var(--accent)';
export function Diagram({ type }) {
  const cam = <g>
    <rect x="50" y="34" width="20" height="13" rx="2.5" fill="none" stroke="var(--fg-faint)" strokeWidth="1.5" />
    <path d="M70 37 L78 33 L78 48 L70 44 Z" fill="none" stroke="var(--fg-faint)" strokeWidth="1.5" />
  </g>;
  const A = { stroke: AMBER, strokeWidth: 1.8, fill: 'none', markerEnd: 'url(#mvArrow)' };
  const dot = <circle cx="104" cy="40" r="4" fill="none" stroke="var(--border-3)" strokeWidth="1.5" />;
  const arrows = {
    'static': <g><path d="M42 28 L38 28 L38 52 L42 52" stroke="var(--border-3)" strokeWidth="1.5" fill="none" /><path d="M84 28 L88 28 L88 52 L84 52" stroke="var(--border-3)" strokeWidth="1.5" fill="none" /></g>,
    'pan-left': <path d="M76 22 A 26 26 0 0 0 40 24" {...A} />,
    'pan-right': <path d="M44 22 A 26 26 0 0 1 80 24" {...A} />,
    'tilt-up': <path d="M90 52 A 22 22 0 0 0 88 26" {...A} />,
    'tilt-down': <path d="M88 26 A 22 22 0 0 0 90 52" {...A} />,
    'zoom-in': <g><path d="M82 30 L98 36" {...A} /><path d="M82 50 L98 44" {...A} /></g>,
    'zoom-out': <g><path d="M98 36 L82 30" {...A} /><path d="M98 44 L82 50" {...A} /></g>,
    'roll-cw': <path d="M60 18 A 22 22 0 1 1 38 40" {...A} />,
    'roll-ccw': <path d="M60 18 A 22 22 0 1 0 82 40" {...A} />,
    'track-left': <path d="M64 62 L28 62" {...A} />,
    'track-right': <path d="M56 62 L92 62" {...A} />,
    'arc-cw': <g>{dot}<path d="M60 60 A 30 22 0 0 0 104 62" {...A} /></g>,
    'arc-ccw': <g>{dot}<path d="M104 62 A 30 22 0 0 0 60 60" {...A} /></g>,
    'up': <path d="M32 58 L32 24" {...A} />,
    'down': <path d="M32 24 L32 58" {...A} />,
    'push-in': <g>{dot}<path d="M60 62 L94 62" {...A} /></g>,
    'pull-out': <g>{dot}<path d="M94 62 L60 62" {...A} /></g>,
    'dolly-zoom': <g>{dot}<path d="M58 58 L86 58" {...A} /><path d="M92 66 L64 66" {...A} /></g>
  };
  return (
    <svg viewBox="0 0 120 76" style={sx('width:100%;height:52px;display:block')}>
      <defs>
        <marker id="mvArrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0 0 L8 4 L0 8 Z" fill={AMBER} />
        </marker>
      </defs>
      {cam}
      {arrows[type] || null}
    </svg>
  );
}
