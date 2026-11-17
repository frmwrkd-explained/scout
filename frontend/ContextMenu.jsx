// ContextMenu — THE right-click menu for the app.
//
// Before this file there was none: a repo-wide search for `onContextMenu` / `onAuxClick` returned
// zero hits, so this is the canonical one. Import it; do not hand-roll a second (see CLAUDE.md,
// "Shared UI" — the same control has been re-implemented per-surface more than any other rule
// in this codebase has been broken).
//
// PORTALLED to <body> for the same reason MentionText's and Composer's menus are: the composer's
// glass shell carries `backdrop-filter`, which makes it the containing block for
// `position:fixed`. Rendered in place, a fixed menu lands a few hundred px off target.
//
// Usage:
//   const menu = useContextMenu();
//   <span onContextMenu={menu.open([
//     { label: 'Save to snippets', hint: '⌸', onClick: () => … },
//     { sep: true },
//     { label: 'Delete', danger: true, onClick: … },
//   ])}>…</span>
//   {menu.render()}
//
// `open` also accepts a thunk — `menu.open(() => items)` — for menus whose contents depend on
// what is selected at click time (the composer's "save selection" item does this).
import React, { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { sx } from './sx';
import { MONO } from './tokens';

const WIDTH = 232;
const ROW_H = 27;
const SEP_H = 9;

export function ContextMenu({ at, items, onClose }) {
  // capture-phase so the menu swallows Escape before the app keymap or a parent modal sees it
  React.useEffect(() => {
    if (!at) return;
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    const onScroll = () => onClose();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [at, onClose]);

  if (!at || !items || !items.length) return null;

  // flip/clamp at the viewport edges — a menu opened near the bottom-right must stay on screen
  const h = items.reduce((n, it) => n + (it.sep ? SEP_H : ROW_H), 10);
  const left = Math.max(8, Math.min(at.x, window.innerWidth - WIDTH - 8));
  const top = at.y + h > window.innerHeight - 8 ? Math.max(8, at.y - h) : at.y;

  return createPortal(
    <>
      {/* dismiss catcher — a SIBLING below the menu in z-order, so a click outside closes while a
          row click still lands on the row. Same layering the Generate console's popovers use. */}
      <div
        onMouseDown={onClose}
        onContextMenu={e => { e.preventDefault(); onClose(); }}
        style={sx('position:fixed;inset:0;z-index:120')}
      />
      <div
        role="menu"
        style={{
          ...sx('position:fixed;z-index:121;border-radius:9px;overflow:hidden;padding:5px 0'),
          left, top, width: WIDTH,
          background: 'var(--surface-2)', border: '1px solid var(--border-3)',
          boxShadow: '0 16px 48px rgba(0,0,0,.7)', animation: 'dl-in .12s ease-out',
        }}
      >
        {items.map((it, i) => it.sep ? (
          <div key={'s' + i} style={{ ...sx('margin:4px 0'), height: 1, background: 'var(--line)' }} />
        ) : (
          <button
            key={it.label + i}
            type="button" role="menuitem" disabled={!!it.disabled}
            className={it.disabled ? '' : 'hRow'}
            onMouseDown={e => e.preventDefault()}
            onClick={() => { if (it.disabled) return; onClose(); it.onClick && it.onClick(); }}
            style={{
              ...sx('display:flex;align-items:center;gap:9px;width:100%;box-sizing:border-box;border:none;background:none;text-align:left;padding:7px 12px'),
              cursor: it.disabled ? 'default' : 'pointer',
              fontFamily: 'inherit', fontSize: 'var(--t-small)', lineHeight: 1.4,
              color: it.disabled ? 'var(--fg-faint)' : it.danger ? 'var(--danger)' : 'var(--fg-soft)',
            }}
          >
            <span style={sx('flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{it.label}</span>
            {it.hint ? <span style={{ ...sx('flex:none'), fontSize: 'var(--t-data)', color: 'var(--fg-faint)' }}>{it.hint}</span> : null}
          </button>
        ))}
      </div>
    </>,
    document.body
  );
}

export function useContextMenu() {
  const [state, setState] = useState(null); // { at:{x,y}, items }
  const close = useCallback(() => setState(null), []);
  const open = useCallback(items => e => {
    const list = (typeof items === 'function' ? items() : items).filter(Boolean);
    if (!list.length) return;           // nothing to offer — let the native menu through
    e.preventDefault();
    e.stopPropagation();
    setState({ at: { x: e.clientX, y: e.clientY }, items: list });
  }, []);
  const render = useCallback(() => (
    <ContextMenu at={state && state.at} items={state && state.items} onClose={close} />
  ), [state, close]);
  return { open, close, render };
}

export default ContextMenu;
