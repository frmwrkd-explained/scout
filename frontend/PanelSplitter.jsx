// PanelSplitter — the draggable edge of a side panel, and the width it remembers.
//
// The left rail was 210px and the details panel 302px, both fixed. A long collection name, a
// prompt, a wide picture: none of them could be given more room, and a small laptop could not give
// any back. Both panels now carry this edge.
//
// The width is a PER-MACHINE working preference (localStorage), not vault data: how wide somebody
// keeps a sidebar on a 13-inch laptop says nothing about the workspace, and must not follow the
// folder onto a 32-inch monitor or into an agent's view of it.
//
// Drag the edge · double-click to return to the default · arrow keys when focused (16px a press).

import React from 'react';

const read = (key, fallback) => {
  try {
    const n = Number(window.localStorage.getItem(key));
    return Number.isFinite(n) && n > 0 ? n : fallback;
  } catch { return fallback; }
};
const write = (key, value) => { try { window.localStorage.setItem(key, String(Math.round(value))); } catch { /* private mode */ } };

// → [width, setWidth, reset]. `setWidth` clamps to [min, max] and persists.
export function usePanelWidth(key, initial, { min, max }) {
  const clamp = React.useCallback(n => Math.max(min, Math.min(max, n)), [min, max]);
  const [width, setRaw] = React.useState(() => clamp(read(key, initial)));
  const setWidth = React.useCallback(n => { const next = clamp(n); setRaw(next); write(key, next); }, [key, clamp]);
  const reset = React.useCallback(() => setWidth(initial), [setWidth, initial]);
  return [width, setWidth, reset];
}

// A remembered on/off, for a panel that can be folded away.
export function usePanelFlag(key, initial = false) {
  const [on, setRaw] = React.useState(() => { try { const v = window.localStorage.getItem(key); return v == null ? initial : v === '1'; } catch { return initial; } });
  const set = React.useCallback(next => setRaw(prev => {
    const value = typeof next === 'function' ? next(prev) : next;
    try { window.localStorage.setItem(key, value ? '1' : '0'); } catch { /* private mode */ }
    return value;
  }), [key]);
  return [on, set];
}

// `edge` is the side of the PANEL this handle sits on: a left rail is resized from its 'right'
// edge, a right-hand panel from its 'left'. The panel must be `position: relative`.
export default function PanelSplitter({ edge = 'right', width, onResize, onReset, label = 'Resize panel' }) {
  const [dragging, setDragging] = React.useState(false);
  const sign = edge === 'right' ? 1 : -1;

  const down = e => {
    if (e.button !== 0) return;
    e.preventDefault();
    const from = e.clientX, start = width;
    setDragging(true);
    const move = ev => onResize(start + sign * (ev.clientX - from));
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = ''; document.body.style.userSelect = '';
    };
    // The cursor and the selection lock live on <body> for the drag, so the pointer does not
    // flicker to a text caret or select half the page when it runs ahead of the edge.
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const key = e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    onResize(width + sign * (e.key === 'ArrowRight' ? 16 : -16));
  };

  return (
    <div role="separator" aria-orientation="vertical" aria-label={label} aria-valuenow={Math.round(width)} tabIndex={0}
      className={'panelSplit panelSplit-' + edge + (dragging ? ' on' : '')}
      title="Drag to resize. Double-click to reset."
      onPointerDown={down} onDoubleClick={onReset} onKeyDown={key} />
  );
}
