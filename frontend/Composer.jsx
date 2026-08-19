// frontend/Composer.jsx — THE composer. One bar, one shell, every surface.
//
// Replaces three structurally separate UIs for one operation ("generate media with a model,
// prompt, refs, format, batch"): ProjectGenerate.jsx's chip-row console, chat/ManualComposer.jsx's
// stacked panel, and ShotWorkspace.jsx's inline bar. Source of truth is the Claude Design handover
// ("Director Chat · handover" + "Story Page"); docs/COMPONENTS.md §3.1 is the inventory entry.
//
// ZERO VARIANTS. The handover is explicit — "Chat, generate page, shot page: same bar, same chips,
// zero variants" — and its definition of done is that a cropped screenshot of any composer cannot
// be attributed to a surface. This SUPERSEDES docs/specs/component-unification/issues/02, which
// specified one component with three densities (console|panel|bar). If you are about to add a
// `density` prop, read the handover first: you are re-introducing the thing this deleted.
//
// CONTROLLED AND PRESENTATIONAL. It owns no fetching, no persistence, and no submit path — it
// reads `value` and calls `onChange` with the FULL merged object (same contract as FormatControls
// and SchemaForm, deliberately). Submitting stays with the surface, because the two wire routes are
// NOT interchangeable and the choice between them is real logic:
//
//   variantCount === 1  → POST /api/generate  (backend/index.mjs:685)
//   variantCount  >  1  → POST /api/batches   (backend/index.mjs:252)
//
// `variantCount` is not a field on /api/generate at all. A composer that "just posts" would
// silently collapse every batch to 1×. Extracting that fork into frontend/generate.js is its own
// ticket (docs/COMPONENTS.md §3.1, proposed 03a) and is NOT done here.
//
// REUSE LEDGER — everything below is imported, not re-rendered:
//   Btn                      ./ui                    the Generate button
//   ModelPicker              ./GenerationControls    the grouped model list in the TECH popover
//   modelName                ./GenerationControls    model id → human label (never .split('/').pop())
//   SchemaForm               ./SchemaForm            per-model fields, from the synced fal spec
//   SnippetText              ./SnippetText           the prompt field (/ snippets, keymap guards)
//   VoiceInput               ./VoiceInput            dictation
//   estCost, modelById       ./models                pricing + catalog facts
//   MONO                     ./tokens                the mono face (five files re-declare it; this
//                                                    one imports it — do not add a sixth copy)
//   .glass/.glassPop/.glassPill/.dlTick, .hBd/.hRow/.hFg/.hBtnAccent   styles.css
//
// NOT hardcoded here, on purpose: any model's resolutions, durations, aspects or params. Those come
// from api.modelSchema(id) via SchemaForm. `fallback:true` means "no synced spec — render the
// generic FormatControls", not an error (frontend/api.js:202-203).
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { sx } from './sx';
import { Btn } from './ui';
import { ModelPicker, modelName } from './GenerationControls';
import SchemaForm from './SchemaForm';
import MentionText from './MentionText';
import VoiceInput from './VoiceInput';
import { estimateCost, OUTPUT_KINDS, outputKindForModel, defaultModelForOutputKind, aspectLabel, AXES } from './models';
import { CAMERA_MOVEMENTS, MOVE_SPEEDS, MOVE_STABILIZATIONS } from './cameraMovements';
import { buildAssetPool } from './entities';
import { durationField, durationChoices, durationParam, blankScene, compileScene, totalFrames, nearestChoice, QUICK_ANGLES, QUICK_MOVES } from './sequence';   // DEV-133
import SequenceEditor from './SequenceEditor';   // DEV-133 — the scene builder's UI
import { rateOf, secs, DEFAULT_RATE } from '../shared/timecode.mjs';
import { api } from './api';   // styleLockRefUrl — the look-chip swatch (DEV-129)
import { useContextMenu } from './ContextMenu';
import SaveSnippetDialog from './SaveSnippet';
import { MONO } from './tokens';

// ── ComposerDock ─────────────────────────────────────────────────────────────────────────────
// WHERE the bar sits, unified. The bar being one component is only half of "zero variants" —
// if every surface hand-rolls its own wrapper, one page docks it at the top, another glues it
// to the bottom edge, and a cropped screenshot attributes the composer to a surface again.
// One recipe: floating near the bottom (BOTTOM px off the edge — low, but breathing), centered,
// max DOCK_WIDTH wide, never full-bleed.
//   position 'fixed'    — pages where the document itself scrolls (Generate). NOT sticky:
//                         sticky re-lays-out when the bar's own height changes (opening the
//                         ref strip, growing the prompt), which read on screen as the bar
//                         jumping. Fixed pins the bottom edge; growth goes upward. The page
//                         must reserve tail padding so the gallery can scroll clear of it.
//   position 'absolute' — panes that scroll internally (Chat) — parent must be position:relative
export const DOCK_BOTTOM = 76;
export const DOCK_WIDTH = 760;
export function ComposerDock({ position = 'fixed', bottom = DOCK_BOTTOM, maxWidth = DOCK_WIDTH, style, children }) {
  if (position === 'absolute') {
    return (
      <div style={{ ...sx('position:absolute;left:0;right:0;display:flex;justify-content:center;padding:0 16px;z-index:40'), bottom, ...style }}>
        <div style={{ ...sx('width:100%'), maxWidth }}>{children}</div>
      </div>
    );
  }
  return (
    <div style={{ ...sx('position:fixed;left:0;right:0;display:flex;justify-content:center;padding:0 16px;z-index:40;pointer-events:none'), bottom, ...style }}>
      <div style={{ ...sx('width:100%;pointer-events:auto'), maxWidth }}>{children}</div>
    </div>
  );
}

// ── Cost ─────────────────────────────────────────────────────────────────────────────────────
// The money readout. Six different prefixes exist across the app today ($, ~$, ~$…est, est $, ≈ $,
// ≈) at 36 sites, and Chat.jsx:40 renders 2dp where ProjectGenerate renders 3 — so the same $0.003
// generation reads "$0.00" in chat and "$0.003" in the console. This is the one spelling.
// DESIGN.md: figures are --fg-soft in the MONO face; the face reads as "figure", not the hue.
export function Cost({ value, prefix = '≈', breakdown = null, style }) {
  const n = Number(value || 0);
  return (
    <span
      title={breakdown || undefined}
      style={{ ...sx('flex:none;white-space:nowrap;display:inline-flex;flex-direction:column;align-items:flex-end'), fontFamily: MONO, fontVariantNumeric: 'tabular-nums', ...style }}
    >
      <span style={{ fontSize: 10, color: 'var(--fg-faint)' }}>
        {prefix}<b style={{ color: 'var(--sand)', fontSize: 12.5, fontWeight: 700 }}>${n.toFixed(3)}</b>
      </span>
      {/* video is billed per second — show the arithmetic rather than a number the user has to
          trust. Hidden entirely for per-generation models, where there is nothing to explain. */}
      {breakdown ? <span style={{ fontSize: 8.5, color: 'var(--border-3)', marginTop: 1 }}>{breakdown}</span> : null}
    </span>
  );
}

// ── SegmentedControl ─────────────────────────────────────────────────────────────────────────
// AGENT⇄MANUAL here; the handover also uses this exact form for LIST⇄ACTION, IMAGE⇄VIDEO and the
// Story page's List⇄Board. Exported so those surfaces import it instead of retyping the track —
// docs/COMPONENTS.md §2.9 counts 15 hand-rolled copies, the container string byte-identical 5×,
// and none of them keyboard-operable.
//
// Active treatment is the --fg bed (design states 1 and 4), NOT the accent fill the design shows
// in states 2 and 5. The design is internally inconsistent on this point; DESIGN.md rule 4 is not
// ("Selected/active is state, not action … never the solid accent fill"), and the screen's one
// solid accent belongs to Generate. Flagged in the handover checkpoint rather than decided quietly.
export function SegmentedControl({ options, value, onChange, size = 'md', style }) {
  const pad = size === 'sm' ? '2px 9px' : '3px 10px';
  return (
    <span role="radiogroup" style={{ ...sx('flex:none;display:inline-flex;padding:2px;border-radius:8px;gap:2px;border:1px solid var(--border-2)'), background: 'rgba(10,11,14,.7)', ...style }}>
      {options.map(o => {
        const on = value === o.id;
        const off = !!o.disabled;
        return (
          <button
            key={o.id} type="button" role="radio" aria-checked={on} aria-disabled={off}
            title={o.title || ''} disabled={off}
            onClick={() => !on && !off && onChange(o.id)}
            className={on || off ? '' : 'hFg'}
            style={{
              ...sx('border:none;border-radius:6px'), padding: pad,
              cursor: off ? 'not-allowed' : 'pointer',
              fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: '.1em',
              background: on ? 'var(--fg)' : 'transparent',
              color: on ? 'var(--on-accent)' : off ? 'var(--border-3)' : 'var(--fg-faint)',
            }}
          >{o.label}</button>
        );
      })}
    </span>
  );
}

// ── BarChip ──────────────────────────────────────────────────────────────────────────────────
// The pill that sits in the bar's control row and opens a popover (tech, fragments). A genuinely
// new form — the app's existing `Chip` (GenerationControls.jsx:37 == SchemaForm.jsx:47, byte
// identical, neither exported) is the 6px-radius *option* chip used INSIDE popovers, a different
// control. This is the 999px trigger pill. Do not merge them.
export function BarChip({ label, icon, on = false, onClick, title }) {
  return (
    <button
      type="button" onClick={onClick} title={title || String(label ?? '')} className={on ? '' : 'hBd'}
      style={{
        ...sx('flex:none;white-space:nowrap;display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:4px 12px;cursor:pointer;max-width:100%'),
        border: '1px solid ' + (on ? 'var(--accent-35)' : 'var(--border)'),
        background: on ? 'var(--accent-05)' : 'transparent',
      }}
    >
      {icon ? <span style={{ ...sx('flex:none'), fontSize: 9.5, color: 'var(--accent)' }}>{icon}</span> : null}
      {/* backstop for the pathological label (a long custom model id): the chip ellipsises rather
          than pushing the row wider than the bar. `title` still carries the full text. */}
      <span style={{ ...sx('overflow:hidden;text-overflow:ellipsis'), fontFamily: MONO, fontSize: 10, color: on ? 'var(--accent)' : 'var(--fg-muted)' }}>{label}</span>
    </button>
  );
}

// ── ContextPill ──────────────────────────────────────────────────────────────────────────────
// The removable pills that float ABOVE the bar (genre · Noir, style · Harbor Night, cam · low
// wide). The handover's central idea: prompt fragments live as pills, never injected into the
// visible text. Rendered only when set — an empty pill row renders nothing at all.
//
// `tone: 'accent'` is for a pill the user set deliberately (the style lock); inherited/ambient
// context stays neutral. Accent text means interactive, which these are (click to open, × to
// remove) — consistent with DESIGN.md rule 2.
export function ContextPill({ label, tone = 'neutral', thumb, onClick, onRemove, title }) {
  const accent = tone === 'accent';
  return (
    <span
      className="glassPill" title={title || ''}
      style={{
        ...sx('display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:3px 9px 3px 4px'),
        border: '1px solid ' + (accent ? 'var(--accent-35)' : 'rgba(58,63,73,.7)'),
        cursor: onClick ? 'pointer' : 'default',
      }}
      onClick={onClick}
    >
      {/* thumb: false suppresses the swatch (a text-only pill, e.g. an option toggle);
          undefined keeps the neutral placeholder dot the design shows for unset context */}
      {thumb !== false && <span style={{ ...sx('flex:none;border-radius:99px'), width: 16, height: 16, background: thumb ? 'center/cover no-repeat url(' + JSON.stringify(thumb) + ')' : 'var(--raise)' }} />}
      <span style={{ fontFamily: MONO, fontSize: 9.5, color: accent ? 'var(--accent)' : 'var(--fg-soft)' }}>{label}</span>
      {onRemove ? (
        <button
          type="button" aria-label={'Remove ' + label} className="hFg"
          onClick={e => { e.stopPropagation(); onRemove(); }}
          style={{ ...sx('border:none;background:none;cursor:pointer;padding:0;line-height:1'), fontSize: 10, color: 'var(--fg-faint)' }}
        >×</button>
      ) : null}
    </span>
  );
}

// ── Popover ──────────────────────────────────────────────────────────────────────────────────
// Anchored above the bar (it is docked at the bottom of its surface, so popovers open upward).
// Owns its own dismissal — document-level pointerdown with a containment check, plus Escape.
// docs/COMPONENTS.md §2.2 counts 14 hand-rolled popovers with three incompatible dismiss
// strategies and 8 with none at all; this is the one implementation for the composer's own chips.
// PORTALLED TO document.body, position:fixed, measured at render. All three parts are required and
// each fixes a different real failure seen on screen:
//
//   1. absolute      → clipped to a sliver by the Story table's `overflow:hidden` (rounded corners)
//   2. fixed alone   → still wrong inside the Shot Workspace: `position:fixed` resolves against the
//                      nearest TRANSFORMED ancestor, not the viewport, and the workspace overlay is
//                      transformed. Measured left=583 rendered at left=964.
//   3. + portal      → escapes both. The panel is a child of <body>, so no ancestor's overflow,
//                      transform or stacking context can touch it.
//
// This is the FIRST React portal in frontend/ (docs/COMPONENTS.md §2.2 counted zero, and named that
// as the root cause of the app's z-index arms race). Any future Modal/Popover primitive should be
// built on this, not on another round of z-index escalation.
// DEV-134 — `resizeKey` opts a popover into a user-draggable width, remembered across sessions in
// localStorage under that key. The settings popover is a form whose density varies wildly by model
// (a synced spec can be 15 fields), and 400px was a hardcoded guess for all of them. Deliberately
// NOT settings.md: this is per-screen furniture, not project data, and round-tripping it through
// the API would put a debounced PUT behind a drag handle.
const POP_MIN = 300, POP_MAX = 900;
function storedWidth(key, fallback) {
  if (!key) return fallback;
  const n = Number(localStorage.getItem('frfg.pop.' + key));
  return n >= POP_MIN && n <= POP_MAX ? n : fallback;
}
function Popover({ open, onClose, width = 400, align = 'left', resizeKey = null, children }) {
  const ref = useRef(null);
  const anchor = useRef(null);
  const [, force] = useState(0);
  const [w, setW] = useState(() => storedWidth(resizeKey, width));
  // a caller changing its default width (or a different resizeKey) re-reads the stored value
  useEffect(() => { setW(storedWidth(resizeKey, width)); }, [resizeKey, width]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = e => {
      if (ref.current && ref.current.contains(e.target)) return;
      if (anchor.current && anchor.current.parentNode && anchor.current.parentNode.contains(e.target)) return;
      onClose();
    };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    const reflow = () => force(n => n + 1);
    // capture so the app's global keymap does not eat Escape first
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', reflow);
    window.addEventListener('scroll', reflow, true);
    reflow(); // measure once the anchor is in the DOM
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', reflow);
      window.removeEventListener('scroll', reflow, true);
    };
  }, [open, onClose]);

  if (!open) return <span ref={anchor} style={{ display: 'none' }} />;

  const host = anchor.current && anchor.current.parentNode;
  const r = host && host.getBoundingClientRect ? host.getBoundingClientRect() : null;
  // open upward when there is room above (the bar is docked at the bottom), else downward
  const openUp = !r || r.top > 320;
  const pos = r
    ? {
      left: align === 'right' ? Math.max(8, r.right - w) : Math.min(Math.max(8, r.left), window.innerWidth - w - 8),
      ...(openUp ? { bottom: Math.max(8, window.innerHeight - r.top + 9) } : { top: r.bottom + 9 }),
      maxHeight: openUp ? r.top - 20 : window.innerHeight - r.bottom - 20,
    }
    : { left: 8, bottom: 8 };

  return (
    <>
      <span ref={anchor} style={{ display: 'none' }} />
      {createPortal(
        <div
          ref={ref} className="glassPop"
          style={{ ...sx('position:fixed;z-index:80;overflow-y:auto'), width: w, ...pos, animation: 'dl-in .18s ease-out' }}
        >
          {children}
          {/* Drag handle on the edge that grows into free space: a right-aligned popover has its
              right edge pinned to the anchor, so it must be widened from the LEFT. 6px hit strip,
              invisible until hovered — a settings panel should not advertise its own furniture. */}
          {resizeKey && (
            <div
              onPointerDown={e => {
                e.preventDefault(); e.stopPropagation();
                const x0 = e.clientX, w0 = w, dir = align === 'right' ? -1 : 1;
                const move = ev => setW(Math.max(POP_MIN, Math.min(POP_MAX, w0 + dir * (ev.clientX - x0))));
                const up = ev => {
                  const final = Math.max(POP_MIN, Math.min(POP_MAX, w0 + dir * (ev.clientX - x0)));
                  try { localStorage.setItem('frfg.pop.' + resizeKey, String(Math.round(final))); } catch { /* private mode */ }
                  window.removeEventListener('pointermove', move);
                  window.removeEventListener('pointerup', up);
                };
                window.addEventListener('pointermove', move);
                window.addEventListener('pointerup', up);
              }}
              onDoubleClick={e => {
                // double-click the handle = back to the caller's default, the standard escape hatch
                e.stopPropagation();
                setW(width);
                try { localStorage.removeItem('frfg.pop.' + resizeKey); } catch { /* private mode */ }
              }}
              title="Drag to resize · double-click to reset"
              style={{
                ...sx('position:absolute;top:0;bottom:0;width:6px;cursor:ew-resize;z-index:1'),
                [align === 'right' ? 'left' : 'right']: 0
              }} />
          )}
        </div>,
        document.body
      )}
    </>
  );
}

// ── EntityPicker ─────────────────────────────────────────────────────────────────────────────
// The "＋ Add more" popup off the @-mention menu: EVERY taggable image, Project ⇄ Global toggle,
// search, click to tag. A popup, not a page-jump — leaving the composer to fetch a reference is
// exactly the page-hopping this composer exists to end. Portalled + fixed for the same
// backdrop-filter reason as every other composer popover.
export function EntityPicker({ app, pid, onPick, onClose }) {
  const [scope, setScope] = useState('project'); // 'project' | 'global'
  const [q, setQ] = useState('');
  const pool = buildAssetPool(app, pid);
  const query = q.trim().toLowerCase();
  const shown = pool
    .filter(e => (scope === 'project' ? e.scope === pid : e.scope === 'library'))
    .filter(e => !query || (e.label + ' ' + e.key + ' ' + (e.kind || '')).toLowerCase().includes(query))
    .slice(0, 60);
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return createPortal(
    <div onClick={onClose} style={{ ...sx('position:fixed;inset:0;z-index:95;display:flex;align-items:center;justify-content:center'), background: 'rgba(5,6,8,.55)' }}>
      <div onClick={e => e.stopPropagation()} className="glassPop" style={{ ...sx('display:flex;flex-direction:column'), width: 560, maxHeight: '70vh', animation: 'dl-in .14s ease-out' }}>
        <div style={sx('display:flex;align-items:center;gap:10px;padding:12px 14px 10px')}>
          <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--fg-faint)' }}>TAG AN ASSET</span>
          <SegmentedControl
            size="sm"
            options={[{ id: 'project', label: 'PROJECT' }, { id: 'global', label: 'GLOBAL' }]}
            value={scope} onChange={setScope}
          />
          <input
            autoFocus value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.stopPropagation()}
            placeholder="search…"
            style={{ ...sx('flex:1;min-width:0;background:var(--ink);border:1px solid var(--border-2);border-radius:7px;color:var(--fg);padding:5px 10px'), fontFamily: MONO, fontSize: 10.5 }}
          />
          <button type="button" onClick={onClose} className="hFg"
            style={{ ...sx('border:none;background:none;cursor:pointer;padding:0'), fontSize: 12, color: 'var(--fg-faint)' }}>✕</button>
        </div>
        <div style={sx('flex:1;overflow-y:auto;padding:0 14px 14px')}>
          {/* min-width:0 on every tile is load-bearing: a grid item's min-width is auto, so one
              long nowrap filename label ("lego ninjago summer 2025 …") widens its whole column
              and blows the grid out of the panel. With it, columns stay fixed and labels
              ellipsize inside them. */}
          {shown.length ? (
            <div style={sx('display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px')}>
              {shown.map(e => (
                <div key={e.scope + e.key} onClick={() => onPick(e)} title={(e.label !== e.key ? e.label + ' — ' : '') + '@' + e.key + (e.kind ? ' · ' + e.kind : '')}
                  className="hBd" style={sx('cursor:pointer;min-width:0')}>
                  <div style={{
                    ...sx('border-radius:7px;border:1px solid var(--border-2)'), aspectRatio: '1',
                    background: e.thumb ? 'center/cover no-repeat url(' + JSON.stringify(e.thumb) + ')' : 'var(--raise)',
                  }} />
                  <div style={{ ...sx('margin-top:3px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 8.5, color: e.kind ? 'var(--fg-soft)' : 'var(--fg-faint)' }}>{e.label}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ ...sx('padding:30px 0;text-align:center;letter-spacing:.1em'), fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>
              {scope === 'project' ? 'NOTHING IN THIS PROJECT YET — ADD MEDIA IN ASSETS' : 'THE LIBRARY IS EMPTY'}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── EditableFrag ─────────────────────────────────────────────────────────────────────────────
// One provenance segment in PROMPT · FULL. When the surface supplies onEdit, clicking the text
// opens it for editing in place — this is what makes FULL a working surface rather than a
// read-only receipt. Commit on Enter/blur, Escape reverts. The section's origin tag stays put.
function EditableFrag({ text, tag, onEdit, onContextMenu }) {
  const [draft, setDraft] = useState(null); // null = viewing
  const commit = () => { if (draft != null && draft !== text) onEdit(draft); setDraft(null); };
  if (draft != null) {
    return (
      <span style={sx('display:block;margin-top:6px')}>
        <textarea
          autoFocus value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); setDraft(null); }
          }}
          onBlur={commit}
          rows={Math.max(2, Math.ceil(draft.length / 70))}
          style={{
            ...sx('width:100%;box-sizing:border-box;background:var(--ink);border:1px solid var(--accent-35);border-radius:6px;color:var(--fg);padding:6px 8px;resize:vertical'),
            fontFamily: MONO, fontSize: 9.5, lineHeight: 1.7,
          }}
        />
      </span>
    );
  }
  return (
    <>
      {' '}
      <span
        className={onEdit ? 'hFg' : ''}
        title={onEdit ? 'Click to edit · right-click to save this section' : 'Right-click to save this section'}
        onClick={onEdit ? () => setDraft(text) : undefined}
        onContextMenu={onContextMenu}
        style={{ color: 'var(--fg-muted)', cursor: onEdit ? 'text' : 'default', borderBottom: onEdit ? '1px dashed var(--border-3)' : 'none' }}
      >{text || (onEdit ? '— empty, click to write —' : '')}</span>
      {tag ? <> <span style={{ color: 'var(--border-3)' }}>[{tag}]</span></> : null}
    </>
  );
}

// ── SegmentRow ───────────────────────────────────────────────────────────────────────────────
// One labelled row of PROMPT · SEGMENTS. Same data as EditableFrag renders inline in FULL — the
// difference is purely layout: FULL reads the prompt as one running sentence, SEGMENTS breaks it
// into the blocks it was assembled from, so a style or camera clause can be read, rewritten and
// saved on its own. The label column follows PromptBuilder's SECTIONS view (PromptBuilder.jsx:306)
// so the two segmented surfaces read alike.
//
// `onSave` is what makes a segment portable: it hands this row's text to the snippet dialog.
function SegmentRow({ label, text, onEdit, onSave, onContextMenu, dim = false }) {
  const [draft, setDraft] = useState(null);
  const commit = () => { if (draft != null && draft !== text) onEdit(draft); setDraft(null); };
  const editing = draft != null;
  return (
    <div
      onContextMenu={onContextMenu} className="rvH"
      style={sx('display:flex;gap:12px;padding:7px 0;border-bottom:1px dashed var(--line);align-items:flex-start')}
    >
      <span style={{
        ...sx('flex:none;width:104px;padding-top:2px;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'),
        fontFamily: MONO, fontSize: 8.5, letterSpacing: '.12em',
        color: text ? 'var(--fg-muted)' : 'var(--fg-faint)',
      }} title={label}>{label}</span>

      <div style={sx('flex:1;min-width:0')}>
        {editing ? (
          <textarea
            autoFocus value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
              if (e.key === 'Escape') { e.preventDefault(); setDraft(null); }
            }}
            onBlur={commit}
            rows={Math.max(2, Math.ceil(draft.length / 62))}
            style={{
              ...sx('width:100%;box-sizing:border-box;background:var(--ink);border:1px solid var(--accent-35);border-radius:6px;color:var(--fg);padding:5px 8px;resize:vertical'),
              fontFamily: MONO, fontSize: 9.5, lineHeight: 1.7,
            }}
          />
        ) : (
          <span
            className={onEdit ? 'hFg' : ''}
            onClick={onEdit ? () => setDraft(text) : undefined}
            title={onEdit ? 'Click to edit this block' : undefined}
            style={{
              ...sx('display:block;line-height:1.7'), fontFamily: MONO, fontSize: 9.5,
              color: dim ? 'var(--fg-faint)' : 'var(--fg-soft)',
              cursor: onEdit ? 'text' : 'default',
            }}
          >{text || <span style={{ color: 'var(--border-3)' }}>{onEdit ? '— empty, click to write —' : '—'}</span>}</span>
        )}
      </div>

      {/* hover-only — a SAVE per row read as a button wall. Idle rows show nothing; the
          right-click menu remains the always-available route. */}
      {onSave && !editing ? (
        <button
          type="button" onClick={onSave} className="hFg rv" title={'Save "' + label + '" to snippets'}
          style={{
            ...sx('flex:none;border:none;background:none;cursor:pointer;padding:1px 2px;line-height:1.4'),
            fontFamily: MONO, fontSize: 8.5, letterSpacing: '.1em', color: 'var(--border-3)',
          }}
        >⌸ SAVE</button>
      ) : null}
    </div>
  );
}

const PopHead = ({ children, right }) => (
  <div style={sx('display:flex;align-items:center;padding:11px 13px 7px')}>
    <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--fg-faint)' }}>{children}</span>
    {right != null ? <span style={{ ...sx('margin-left:auto'), fontFamily: MONO, fontSize: 8.5, color: 'var(--border-3)' }}>{right}</span> : null}
  </div>
);

// ── the tech summary, e.g. "Nano Banana 2 · 16:9 · 1K" ───────────────────────────────────────
// In the handover this reads the VIDEO form for a video model ("kling-2.5 · 6s · 1080p"). Duration
// and resolution are read from `params` — i.e. from the model's own synced fal schema via
// SchemaForm — never from a hardcoded per-model table. ProjectGenerate.jsx:464-471 records why a
// hardcoded duration picker was deleted ("a lie the UI told the user"): no route destructures
// `duration`. Via `params` it reaches the provider verbatim (backend/providers.mjs:70-76), which
// is exactly what the handover's "fields ← fal schema" note asks for.
function techSummary(value) {
  const v = value || {};
  const p = v.params || {};
  const parts = [modelName(v.model) || 'no model'];
  const dur = p.duration ?? p.duration_seconds;
  if (dur != null && dur !== '') parts.push(String(dur).replace(/s?$/, 's'));
  else {
    // a model whose schema declares aspect_ratio defaults it to 'auto'; showing "auto" in the bar
    // is useless — fall back to the composer's own aspect, which is what actually ships.
    const ar = p.aspect_ratio || p.aspectRatio;
    // `image_size` is an aspect in FAL's vocabulary, not a size — it belongs in THIS slot, and it
    // outranks v.aspect because it is what SchemaForm actually put on the payload.
    parts.push((ar && ar !== 'auto' ? ar : null) || aspectLabel(p.image_size || p.imageSize) || v.aspect || '16:9');
  }
  // resolution only — never image_size, which already spoke above. Printing both produced
  // "16:9 · landscape_4_3": the same fact twice, in two vocabularies, disagreeing.
  const res = p.resolution || v.resolution;
  if (res && typeof res === 'string' && res !== 'auto') parts.push(res);
  return parts.join(' · ');
}

// ── TechPopoverBody / TechSettings ───────────────────────────────────────────────────────────
// THE settings surface. The handover is explicit that exactly two popovers exist and "no third
// popover, no settings page, no per-model UI" — so this is exported rather than kept private, and
// the Story list's SETTINGS cell opens this same body instead of growing its own picker.
//
// `shot` is optional. When present (the Story row), the popover gains a SHOT section for the two
// fields that belong to the shot record rather than to a generation — type and duration. Model,
// aspect, resolution and every per-model param below it still come from the synced fal spec via
// SchemaForm. Nothing here is hardcoded per model.
export function TechPopoverBody({ settings, value, onChange, shot = null, onShotChange = null, shotTypes = [] }) {
  const v = value || {};
  const set = patch => onChange && onChange({ ...v, ...patch });
  // The OUTPUT filter is DERIVED from the selected model, never stored separately — two sources of
  // truth for "what am I making" is exactly how a UI ends up claiming Video while a still model is
  // armed. Picking a model moves the filter; picking a filter picks that kind's default model.
  const out = v.model ? outputKindForModel(v.model) : (v.outputKind || 'image');
  const kinds = (OUTPUT_KINDS.find(o => o.key === out) || OUTPUT_KINDS[0]).kinds;
  const pickKind = key => {
    const next = defaultModelForOutputKind(settings, key);
    // params are per-model and never portable across kinds — reset with the model, as the model
    // picker itself does
    set({ outputKind: key, model: next, params: {} });
  };
  return (
    <>
      <PopHead right="fields ← fal schema">TECH</PopHead>

      <div style={sx('padding:0 13px 10px')}>
        <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '.12em', color: 'var(--fg-faint)', marginBottom: 6 }}>OUTPUT</div>
        <div style={sx('display:flex;gap:5px;flex-wrap:wrap')}>
          {OUTPUT_KINDS.map(o => {
            const on = out === o.key;
            const has = !!defaultModelForOutputKind(settings, o.key);
            return (
              <span
                key={o.key}
                onClick={() => has && !on && pickKind(o.key)}
                title={has ? o.label : 'No enabled ' + o.label.toLowerCase() + ' model — enable one in Settings'}
                className={on || !has ? '' : 'hBd'}
                style={{
                  ...sx('border-radius:6px;padding:4px 10px'), fontFamily: MONO, fontSize: 10,
                  cursor: has ? (on ? 'default' : 'pointer') : 'not-allowed',
                  color: on ? 'var(--fg)' : has ? 'var(--fg-muted)' : 'var(--border-3)',
                  background: on ? 'var(--raise)' : 'transparent',
                  border: '1px solid ' + (on ? 'var(--border-3)' : 'var(--border-2)'),
                  fontWeight: on ? 700 : 400, opacity: has ? 1 : .55,
                }}>{o.label}</span>
            );
          })}
        </div>
      </div>

      {shot && (
        <div style={sx('padding:0 13px 11px;border-bottom:1px solid var(--line)')}>
          <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '.12em', color: 'var(--fg-faint)', marginBottom: 6 }}>SHOT — TYPE · DURATION</div>
          <div style={sx('display:flex;gap:5px;flex-wrap:wrap;align-items:center')}>
            {shotTypes.map(t => {
              const on = (shot.type || '') === t;
              return (
                <span key={t} onClick={() => onShotChange && onShotChange({ type: t })} className={on ? '' : 'hBd'}
                  style={{
                    ...sx('border-radius:6px;padding:4px 10px;cursor:pointer'), fontFamily: MONO, fontSize: 10,
                    color: on ? 'var(--fg)' : 'var(--fg-muted)', background: on ? 'var(--raise)' : 'transparent',
                    border: '1px solid ' + (on ? 'var(--border-3)' : 'var(--border-2)'), fontWeight: on ? 700 : 400,
                  }}>{t}</span>
              );
            })}
            <input
              type="number" min={1} max={60} value={shot.dur ?? ''}
              onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
              onChange={e => {
                const n = e.target.value === '' ? '' : Math.max(1, Math.min(60, Number(e.target.value) || 1));
                onShotChange && onShotChange({ dur: n === '' ? null : n });
              }}
              style={{ ...sx('background:var(--ink);border:1px solid var(--border-2);border-radius:6px;color:var(--fg);padding:4px 8px;width:58px;margin-left:auto'), fontFamily: MONO, fontSize: 10, fontVariantNumeric: 'tabular-nums' }}
            />
            <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>sec</span>
          </div>
        </div>
      )}

      {/* picking a model IS picking the type — video={null} renders every catalog group
          (IMAGE · PREVIEW / RENDER / EDIT, VIDEO, AUDIO · MUSIC / VOICE / SOUND FX) */}
      <ModelPicker
        settings={settings}
        value={v.model || ''}
        kinds={kinds}
        maxHeight={shot ? 180 : 230}
        onChange={id => set({ model: id, outputKind: outputKindForModel(id), params: {} })}
      />
      <div style={sx('border-top:1px solid var(--line)')}>
        <SchemaForm
          modelId={v.model}
          value={v.params || {}}
          onChange={params => set({ params })}
          format={{
            value: { aspect: v.aspect, resolution: v.resolution, seed: v.seed, variantCount: v.variantCount },
            onChange: next => set(next),
            showSeed: true,
            showVariants: true,
          }}
        />
      </div>
    </>
  );
}

// The anchored trigger + popover as one unit, for surfaces that just want "a settings chip here".
export function TechSettings({ label, settings, value, onChange, shot, onShotChange, shotTypes, width = 400, align = 'left' }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={sx('position:relative')} onClick={e => e.stopPropagation()}>
      <span
        onClick={() => setOpen(o => !o)} className="hFg" title="Settings"
        style={{ ...sx('cursor:pointer;display:inline-block'), fontFamily: MONO, fontSize: 10.5, color: open ? 'var(--fg)' : 'var(--fg-muted)', fontVariantNumeric: 'tabular-nums' }}
      >{label}</span>
      <Popover open={open} onClose={() => setOpen(false)} width={width} align={align}>
        <TechPopoverBody settings={settings} value={value} onChange={onChange} shot={shot} onShotChange={onShotChange} shotTypes={shotTypes} />
      </Popover>
    </span>
  );
}


// ── FragmentsPopoverBody ─────────────────────────────────────────────────────────────────────
// THE ✦ fragments surface, shared. It is a component, not a render prop, precisely so that every
// surface shows the SAME thing — a per-surface `renderFragments` callback is how three different
// fragment panels grow again, which is the whole problem this composer exists to end.
//
// PROMPT PIECES ONLY: style, camera movement, speed, execution. References are attachments and
// live behind "+ Ref" in the bar; they are not fragments and must not be dumped in here.
//
// STYLE shows FAVOURITES ONLY. A project accumulates dozens of saved looks and listing them all
// turns the popover into a wall — the composer's job is fast recall of the handful you actually
// shoot with. Everything else is one click away in the tools that already exist: "Browse all"
// opens the style-lock picker, "New style" opens the prompt builder. No third style UI.
//
// Props:
//   app, pid       for the fallback StyleLab overlay (openStyleLockPicker)
//   onOpenStyleLab (tab) => void — optional. A surface that mounts its OWN StyleLab passes this so
//                  Apply lands on its composer state instead of App's global one. tab is
//                  'styles' (saved library) | 'style' (axis builder) | 'camera'.
//   looks          all style locks (favourites are filtered here, not by the caller)
//   activeLookId   the shot's own look, '' / null = project default
//   projectLock    the project's lock, shown as the default row's label
//   onLook         (id) => void — '' selects the project default
//   move/speed/stab + onMove/onSpeed/onStab   camera movement fragment
// CAMERA and ANGLE show a QUICK SET, not the catalog. The full CAMERA_MOVEMENTS list is 20 chips
// and rendering it here is exactly the wall the handover's "do not overwhelm" rule bans — the design
// frame shows five presets. The quick sets are what a director reaches for constantly; the whole
// library is one click away ("Browse all" inline, "Camera library" for the real tool).
//
// Both lists live in frontend/sequence.js and are imported, not declared here: the shot list offers
// the same pickers per shot, and two copies of "what counts as quick" drift within a week.
//
// DEV-129 — CAMERA ANGLE. Angles are NOT a new catalog: they are the `framing` axis that already
// lives in the 8-axis system (frontend/models.js AXES), already sits in lookBuilder's
// CAMERA_AXIS_KEYS, already carries a prompt fragment and a one-line description per token, and
// already has all twelve thumbnails checked in under public/axis-options/framing--*.jpg. The gap
// was only that the composer's ✦ panel never surfaced it — you had to open StyleLab's CAMERA tab
// to reach an angle. Adding a CAMERA_ANGLES file would have been a second source of truth for the
// same twelve tokens; this reads the canonical one.
const ANGLE_AXIS = () => AXES.find(a => a.key === 'framing') || { tokens: [] };

export function FragmentsPopoverBody({
  app, pid, looks = [], activeLookId, projectLock = null, onLook,
  move = null, speed = 'normal', stab = 'smooth', onMove, onSpeed, onStab,
  angle = null, onAngle = null, video = false,
  onOpenStyleLab = null,
}) {
  // DEV-127 — one door to StyleLab, never a navigation. Prefer the surface's own overlay (its
  // Apply writes straight onto that composer's style/camera state); otherwise use App's global
  // mount, which is the same component.
  const openLab = tab => {
    if (onOpenStyleLab) return onOpenStyleLab(tab);
    if (app && app.openStyleLockPicker) return app.openStyleLockPicker(pid, tab);
  };
  const [allLooks, setAllLooks] = useState(false);
  const [allCams, setAllCams] = useState(false);
  const [allAngles, setAllAngles] = useState(false);
  // DEV-129 mode-aware collapse: a still frame has no motion, and cameraFragment() already drops
  // the movement half for image models (lookBuilder.js:154-157) — so on an image model the whole
  // section was UI for something the prompt would discard. Collapsed by default there, open for
  // video, and expandable either way because a user may be about to switch models.
  const [moveOpen, setMoveOpen] = useState(!!video);
  useEffect(() => { setMoveOpen(!!video); }, [video]);
  const favs = looks.filter(l => l.fav);
  const FALLBACK = 4;
  // a look saved from a whole generation prompt carries that prompt as its NAME — chip it at a
  // few words, the full text lives in the tooltip. A row of 60-char prose chips is a wall.
  const short = n => { const s = String(n || '').trim(); return s.length > 26 ? s.slice(0, 25).trimEnd() + '…' : s; };
  // With favourites, show only those. With none marked yet, show the first few rather than an
  // empty panel — but say so in the heading instead of calling them favourites, which they aren't.
  const shown = allLooks ? looks : (favs.length ? favs : looks.slice(0, FALLBACK));
  const withActive = shown.some(l => l.id === activeLookId) || !activeLookId
    ? shown
    : [...shown, looks.find(l => l.id === activeLookId)].filter(Boolean);

  const head = t => <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '.12em', color: 'var(--fg-faint)', margin: '10px 0 6px' }}>{t}</div>;
  const chip = (key, label, on, onClick, title) => (
    <span key={key} onClick={onClick} title={title || ''} className={on ? '' : 'hBd'}
      style={{
        ...sx('border-radius:6px;padding:4px 10px;cursor:pointer'), fontFamily: MONO, fontSize: 10,
        color: on ? 'var(--fg)' : 'var(--fg-muted)', background: on ? 'var(--raise)' : 'transparent',
        border: '1px solid ' + (on ? 'var(--border-3)' : 'var(--border-2)'), fontWeight: on ? 700 : 400,
      }}>{label}</span>
  );
  const link = (label, onClick) => (
    <span onClick={onClick} className="hAccent"
      style={{ ...sx('cursor:pointer'), fontFamily: MONO, fontSize: 9, color: 'var(--accent)' }}>{label}</span>
  );

  return (
    <div style={sx('padding:0 13px 13px')}>
      {head(allLooks
        ? 'STYLE — ALL ' + looks.length + ' SAVED LOOKS'
        : favs.length
          ? 'STYLE — FAVOURITES'
          : 'STYLE — ★ A LOOK TO PIN IT HERE')}
      <div style={sx('display:flex;gap:5px;flex-wrap:wrap')}>
        {/* DEV-129 — a look chip carries its saved preview as a 14px swatch. Tiny on purpose: it is
            a recognition cue beside the name, not a gallery. A look with no saved preview keeps the
            ✦ it always had, so nothing gains an empty box. */}
        {withActive.map(l => {
          const on = activeLookId === l.id;
          return (
            <span key={l.id} onClick={() => onLook && onLook(l.id)}
              title={(l.name || '') + (l.fragment ? ' — ' + l.fragment : '')} className={on ? '' : 'hBd'}
              style={{
                ...sx('display:inline-flex;align-items:center;gap:5px;border-radius:6px;padding:3px 9px 3px 4px;cursor:pointer'),
                fontFamily: MONO, fontSize: 10,
                color: on ? 'var(--fg)' : 'var(--fg-muted)', background: on ? 'var(--raise)' : 'transparent',
                border: '1px solid ' + (on ? 'var(--border-3)' : 'var(--border-2)'), fontWeight: on ? 700 : 400
              }}>
              {l.refImage
                ? <img src={api.styleLockRefUrl(l.id)} alt="" loading="lazy"
                  style={sx('width:14px;height:14px;border-radius:3px;object-fit:cover;display:block;flex:none')} />
                : <span style={{ ...sx('width:14px;text-align:center;flex:none'), color: 'var(--accent)' }}>✦</span>}
              {short(l.name)}
            </span>
          );
        })}
        {chip('__default', projectLock ? 'project · ' + short(projectLock.name) : 'project default', !activeLookId, () => onLook && onLook(''))}
      </div>
      <div style={sx('display:flex;gap:12px;margin-top:8px;flex-wrap:wrap')}>
        {!allLooks && looks.length > shown.length && link('Browse all ' + looks.length + ' →', () => setAllLooks(true))}
        {allLooks && favs.length > 0 && link('← favourites only', () => setAllLooks(false))}
        {/* DEV-127. Both links open StyleLab as an OVERLAY; neither navigates. "New style" used to
            call app.openPromptBuilder(), which does `go('tools', …)` — from inside the composer dock
            that reads as "nothing opened", because the whole project surface underneath it was
            replaced. StyleLab is one component with three tabs, so "manage" and "new" are the same
            overlay pointed at a different tab (`styles` = the saved library, `style` = the axis
            builder). A surface that owns its own StyleLab passes onOpenStyleLab so Apply lands on
            ITS composer state; everything else falls back to App's global overlay mount. */}
        {(app || onOpenStyleLab) && link('Manage style locks →', () => openLab('styles'))}
        {(app || onOpenStyleLab) && link('New style →', () => openLab('style'))}
      </div>

      {/* DEV-129 — CAMERA ANGLE, from the canonical `framing` axis. Picture tiles, not text chips:
          an angle is a thing you recognise faster than you read, and the thumbnails already exist.
          Only rendered when the surface wires onAngle, so a composer that has no camera state
          (plain chat) is unchanged. */}
      {onAngle && (() => {
        const tokens = ANGLE_AXIS().tokens || [];
        const list = allAngles ? tokens : tokens.filter(t => QUICK_ANGLES.includes(t.t) || t.t === angle);
        return (
          <>
            {head(allAngles ? 'CAMERA ANGLE — ALL ' + tokens.length : 'CAMERA ANGLE')}
            <div style={sx('display:flex;gap:6px;flex-wrap:wrap')}>
              {list.map(t => {
                const on = angle === t.t;
                return (
                  <span key={t.t} onClick={() => onAngle(on ? null : t.t)} title={t.d || t.f} className={on ? '' : 'hBd'}
                    style={{
                      ...sx('display:flex;flex-direction:column;gap:3px;border-radius:7px;padding:3px;cursor:pointer;width:62px'),
                      border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border-2)'),
                      background: on ? 'var(--accent-05)' : 'transparent'
                    }}>
                    {t.img
                      ? <img src={t.img} alt="" loading="lazy" style={sx('width:100%;height:34px;object-fit:cover;border-radius:4px;display:block')} />
                      : <span style={sx('height:34px;border-radius:4px;background:var(--sunk)')} />}
                    <span style={{ fontFamily: MONO, fontSize: 7.5, lineHeight: 1.25, color: on ? 'var(--accent)' : 'var(--fg-muted)', textAlign: 'center' }}>{t.t}</span>
                  </span>
                );
              })}
            </div>
            <div style={sx('display:flex;gap:12px;margin-top:8px;flex-wrap:wrap')}>
              {!allAngles && tokens.length > list.length && link('Browse all ' + tokens.length + ' →', () => setAllAngles(true))}
              {allAngles && link('← quick set', () => setAllAngles(false))}
              {angle && link('clear angle', () => onAngle(null))}
            </div>
          </>
        );
      })()}

      {/* DEV-129 — the movement section is collapsible and starts closed on an image model, where
          lookBuilder drops the movement fragment anyway. The header is the toggle. */}
      <div onClick={() => setMoveOpen(o => !o)} className="hFg" style={sx('cursor:pointer')}>
        {head((moveOpen ? '▾ ' : '▸ ') + (allCams ? 'CAMERA MOVEMENT — ALL ' + CAMERA_MOVEMENTS.length : 'CAMERA MOVEMENT')
          + (video ? '' : ' — VIDEO ONLY') + (!moveOpen && move ? ' · ' + move : ''))}
      </div>
      {moveOpen && <div style={sx('display:flex;gap:5px;flex-wrap:wrap')}>
        {(allCams
          ? CAMERA_MOVEMENTS
          : CAMERA_MOVEMENTS.filter(m => QUICK_MOVES.includes(m.id) || m.id === move)
        ).map(m => chip(m.id, m.name, move === m.id, () => onMove && onMove(move === m.id ? null : m.id), m.description))}
      </div>}
      {moveOpen && <div style={sx('display:flex;gap:12px;margin-top:8px;flex-wrap:wrap')}>
        {!allCams && link('Browse all ' + CAMERA_MOVEMENTS.length + ' →', () => setAllCams(true))}
        {allCams && link('← quick set', () => setAllCams(false))}
        {app && link('Camera library →', () => app.go && app.go('tools', { toolsSel: 'moves' }))}
      </div>}

      {moveOpen && move && (
        <>
          {head('SPEED')}
          <div style={sx('display:flex;gap:5px;flex-wrap:wrap')}>
            {MOVE_SPEEDS.map(sp => chip(sp.id, sp.label, speed === sp.id, () => onSpeed && onSpeed(sp.id), sp.phrase))}
          </div>
          {head('EXECUTION')}
          <div style={sx('display:flex;gap:5px;flex-wrap:wrap')}>
            {MOVE_STABILIZATIONS.map(st => chip(st.id, st.label, stab === st.id, () => onStab && onStab(st.id), st.phrase))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Composer ─────────────────────────────────────────────────────────────────────────────────
// Props:
//   app            god-class — settings (for ModelPicker), snippets (for SnippetText), showToast
//   value          { prompt, model, aspect, resolution, seed, variantCount, params, refs }
//   onChange       (nextValue) => void — receives the FULL merged object
//   mode           'agent' | 'manual'
//   onMode         (mode) => void — omit to hide the AGENT⇄MANUAL toggle entirely
//   pills          [{ id, label, tone, thumb, title, onClick, onRemove }] — the row ABOVE the bar
//   fragments      { label, count } | null — the ✦ chip's summary ("style · cam · 2 refs")
//   renderFragments () => ReactNode — body of the ✦ popover. Supplied by the surface for now:
//                  style locks / camera library / ref registry are plumbed differently per surface
//                  and unifying that plumbing is step 2-4 work, not step 1.
//   composedPrompt string — what actually ships, for PROMPT · FULL. Compose it with
//                  joinFragments() from lookBuilder.js — NOT with string concat. ShotWorkspace's
//                  `prompt + ', ' + fragment` is the live double-comma bug (docs/COMPONENTS.md §3.1)
//   provenance     [{ text, tag }] — the dimmed fragment trail under FULL, with [style · x] tags
//   busy           bool — swaps Generate for the pulsing Generating… and runs the tick line
//   blockReason    string | null — why Generate is disabled (e.g. "needs a reference frame")
//   onSubmit       () => void
//   submitLabel    default 'Generate'; the chat agent bar passes 'Send'
//   placeholder    default matches the handover copy
//
//   entities       [{ key, label, thumb, kind }] — the @-mention pool (see entities.js). Typing
//                  @ in the prompt opens autocomplete over these, and any `@key` token in the
//                  value renders as an inline thumbnail pill (MentionText). The earlier
//                  chips-below-the-prompt compromise was rejected by the user; inline is the spec.
//
//   mentions       [{ id, label, thumb, onRemove }] — ATTACHED REFERENCES (generation frames),
//                  rendered as a chip row under the prompt. Distinct from @-mentions: these are
//                  attachments with a remove affordance, not prompt text.
//
//   attachments    [{ key, name, kind, status, ref }] — the pending upload tray (Chat.jsx's
//                  existing mechanism; status ∈ uploading|done|error)
//   onAttach       () => void — open the file picker. Omit to hide the paperclip entirely
//   onRemoveAttachment (key) => void
//   onDropFiles    (FileList) => void — enables the drop target
//   attachHint     copy under the paperclip
//   submitOnEnter  Enter submits (agent chat) vs ⌘⏎ only (generation). Shift+Enter always newlines
//   allowEmptyPrompt  attachment-only submit is legal — Chat.jsx:560 permits it today
//   onCancel       () => void — renders Cancel in place of Generate while busy
export default function Composer({
  app,
  value,
  onChange,
  mode = 'manual',
  onMode = null,
  modeDisabled = null,
  pills = [],
  entities = [],
  pid = null,
  mentions = [],
  fragments = null,
  renderFragments = null,
  fragmentProps = null,
  composedPrompt = '',
  provenance = [],
  busy = false,
  blockReason = null,
  onSubmit,
  submitLabel = 'Generate',
  placeholder = 'Describe your scene — use @ for cast & locations',
  showTech = true,
  attachments = [],
  onAttach = null,
  onRemoveAttachment = null,
  onDropFiles = null,
  attachHint = null,
  submitOnEnter = false,
  allowEmptyPrompt = false,
  onCancel = null,
  style,
}) {
  const [pop, setPop] = useState(null);     // 'tech' | 'fragments' | null
  // PROMPT · CLEAN → FULL → SEGMENTS, cycled by the one button. CLEAN is what you typed; FULL is
  // what ships, read as one running prompt; SEGMENTS is that same thing broken into the blocks it
  // was assembled from, each one separately editable and separately savable.
  const [view, setView] = useState('clean');
  const full = view !== 'clean';
  const segmented = view === 'segments';

  // the save-to-snippets dialog: { text, name } | null. Opened from the right-click menu on the
  // prompt field or on a segment, and from a segment row's ⌸ SAVE.
  const [snippetDraft, setSnippetDraft] = useState(null);
  const menu = useContextMenu();
  const [dragOver, setDragOver] = useState(false);
  const [picker, setPicker] = useState(false); // the ＋ Add more asset-picker popup
  // assets tagged via the picker that are NOT production entities — appended to the resolve pool
  // so their @key pillifies in this composer session too
  const [extraEnts, setExtraEnts] = useState([]);
  const ta = useRef(null);
  const allEntities = extraEnts.length ? [...entities, ...extraEnts.filter(x => !entities.some(e => e.key === x.key))] : entities;

  const v = value || {};
  const set = patch => onChange && onChange({ ...v, ...patch });
  const settings = (app && app.state && app.state.settings) || {};

  // ── DEV-133 · SCENE MODE ───────────────────────────────────────────────────────────────────
  // A structured way to write ONE prompt — segments with timecodes, plus the scene blocks a long
  // video prompt is built from. See frontend/sequence.js for what the clock is (prompt text) and
  // what it is not (the model's duration parameter).
  //
  // It is NOT gated on the model declaring a duration field any more. It used to be, back when the
  // feature was a duration picker; the gate meant the whole authoring surface vanished on any model
  // whose fal spec had not been synced, which is most of them. The rule the gate protected — never
  // offer a duration the model did not declare — still holds in full: `durationParam` below is the
  // only thing that sends one, and it sends nothing when there is no field.
  const [schema, setSchema] = useState(null);
  useEffect(() => {
    let live = true;
    if (!v.model) { setSchema(null); return undefined; }
    api.modelSchema(v.model).then(s => { if (live) setSchema(s); }).catch(() => { if (live) setSchema(null); });
    return () => { live = false; };
  }, [v.model]);
  const durField = durationField(schema);
  const totals = durationChoices(durField);
  // The authoring rate. 24 deliberately, and not read from the project's reel: the reel's rate is a
  // TIMELINE fact (what the animatic cuts and exports at), while this is the grid a prompt's beats
  // are written on, and every video endpoint in the catalogue generates at 24. Resolved through
  // rateOf rather than written as a number so the frame maths stays on shared/timecode.mjs.
  const rate = rateOf(DEFAULT_RATE);
  // Offered on any model that makes a moving picture. A still has no segments to time.
  const canSequence = !v.model || outputKindForModel(v.model) === 'video';
  // The scene STRUCTURE is local, not part of `value`. Every surface whitelists the value fields it
  // persists (ProjectGenerate, ShotWorkspace and Chat alike), so a new key would be silently dropped
  // by all three — and widening three whitelists for an editing aid is the wrong trade. What matters
  // downstream is the COMPILED prompt and the duration param, and those go through the ordinary
  // value contract, so submit, cost and guards are unaffected.
  const [seq, setSeq] = useState(null);
  const inSequence = !!seq && canSequence;

  // The scene editor is a PROMPT BUILDER: it writes the compiled prompt and (when the model has a
  // duration field) the nearest legal duration straight back through the ordinary value contract,
  // so submitting needs no new path.
  const writeSeq = next => {
    setSeq(next);
    // The authored clock is prompt text and may be any length. The PARAMETER still has to be one of
    // the model's own values, so it snaps to the nearest — and the editor shows that gap until the
    // user closes it with "fit".
    const legal = nearestChoice(totals, secs(totalFrames(next.segments), rate));
    set({
      prompt: compileScene(next, rate),
      params: { ...(v.params || {}), ...((legal != null && durationParam(durField, legal)) || {}) }
    });
  };
  const startSequence = () => {
    const seconds = totals.length ? totals[Math.min(1, totals.length - 1)] : 12;
    writeSeq(blankScene({ seconds, count: 3, rate, context: String(v.prompt || '').trim() }));
  };
  const endSequence = () => setSeq(null);
  const snippets = (app && app.state && app.state.snippets) || [];

  // duration comes from the model's OWN synced schema (params.duration), never a hardcoded table.
  const durParam = (v.params || {}).duration ?? (v.params || {}).duration_seconds;
  const est = estimateCost(v.model, { duration: durParam, variantCount: v.variantCount });
  const cost = est.total;
  const costBreakdown = est.perSecond
    ? est.seconds + 's × $' + est.rate.toFixed(3) + '/s' + (est.variantCount > 1 ? ' × ' + est.variantCount : '')
    : (est.variantCount > 1 ? '$' + est.per.toFixed(3) + ' × ' + est.variantCount : null);
  const hasText = String(v.prompt || '').trim().length > 0;
  const hasReadyAttachment = attachments.some(a => a.status === 'done');
  const canSubmit = !busy && !blockReason && (hasText || (allowEmptyPrompt && hasReadyAttachment));

  // ── save-to-snippets ───────────────────────────────────────────────────────────────────────
  // Any text on this bar can become a reusable /snippet without leaving it. The dialog owns the
  // POST and the app.state.snippets refresh (SaveSnippet.jsx); everything here just chooses what
  // text to hand it and what to call it by default.
  const askSave = (text, name) => setSnippetDraft({ text: String(text || '').trim(), name });
  const copy = text => {
    navigator.clipboard && navigator.clipboard.writeText(String(text || '')).catch(() => { });
    app && app.showToast && app.showToast('Copied', 'var(--accent)');
  };
  // first few words, title-cased — a name you'd have typed anyway, pre-filled
  const nameFrom = (text, fallback) => {
    const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 4).join(' ');
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : fallback;
  };
  // the prompt field's own menu — "save what I highlighted" when there IS a selection, otherwise
  // the whole prompt. Built as a thunk so the selection is read at right-click time, not render.
  const promptMenu = menu.open(() => {
    const sel = String((window.getSelection && window.getSelection().toString()) || '').trim();
    const whole = String(v.prompt || '').trim();
    return [
      sel && { label: 'Save selection to snippets', hint: '⌸', onClick: () => askSave(sel, nameFrom(sel, 'Snippet')) },
      whole && { label: 'Save prompt to snippets', hint: '⌸', onClick: () => askSave(whole, nameFrom(whole, 'Prompt')) },
      (sel || whole) && { sep: true },
      sel && { label: 'Copy selection', onClick: () => copy(sel) },
      whole && { label: 'Copy prompt', onClick: () => copy(whole) },
      composedPrompt && { label: 'Copy full composed prompt', onClick: () => copy(composedPrompt) },
    ];
  });
  // one provenance segment's menu — the style block, the camera clause, whatever a surface adds
  const segMenu = f => menu.open(() => [
    f.text && { label: 'Save block to snippets', hint: '⌸', onClick: () => askSave(f.text, nameFrom(f.tag, 'Block')) },
    f.text && { label: 'Copy block', onClick: () => copy(f.text) },
    f.onEdit && { sep: true },
    f.onEdit && f.text && { label: 'Clear this block', danger: true, onClick: () => f.onEdit('') },
  ]);

  // stopPropagation keeps the app's global keymap out of the field — 31 hand-written copies of
  // this guard exist app-wide and the two sites that forgot it are live bugs (COMPONENTS.md §1.2).
  //
  // Enter semantics deliberately differ and BOTH are preserved from the surfaces being replaced:
  //   submitOnEnter  — Chat.jsx:623, bare Enter sends, Shift+Enter newlines
  //   otherwise      — ⌘⏎ / Ctrl+⏎ only, so a multi-line generation prompt is typable
  //
  // Chat.jsx:623 calls send() with NO canSend check — the gate is send()'s own guards, so Enter on
  // an empty box is a silent no-op and Enter mid-upload raises a toast. Gating Enter on canSubmit
  // here would swallow that toast, so submitOnEnter fires onSubmit unconditionally and lets the
  // surface's own guards speak. Do not "tidy" this into the canSubmit check.
  const onKeyDown = e => {
    e.stopPropagation();
    // DEV-126 — COMPOSER-LOCAL SHORTCUTS. They must be modifier combos: the app's rebindable keymap
    // is single-letter and bails on modifiers (keymap.js RESERVED / App.onKey), and this field is a
    // text input, so a bare letter here is a letter. Each one opens a panel that is otherwise a
    // mouse trip to a chip. Listed in the ? cheat sheet.
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
      const k = (e.key || '').toLowerCase();
      if (k === 'j') { e.preventDefault(); setPop(p => (p === 'tech' ? null : 'tech')); return; }        // settings
      if (k === 'l' && fragments) { e.preventDefault(); setPop(p => (p === 'fragments' ? null : 'fragments')); return; }  // look/camera
      if (k === 'u' && onAttach) { e.preventDefault(); onAttach(); return; }                              // reference
    }
    if (e.key === 'Escape') { e.target.blur(); return; }
    if (e.key !== 'Enter') return;
    if (e.metaKey || e.ctrlKey) { e.preventDefault(); if (canSubmit) onSubmit && onSubmit(); return; }
    if (submitOnEnter && !e.shiftKey) { e.preventDefault(); onSubmit && onSubmit(); }
  };

  const dropProps = onDropFiles ? {
    onDragOver: e => {
      // only claim FILE drags — a text drag must fall through to the contenteditable natively
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      e.preventDefault(); e.stopPropagation(); if (!dragOver) setDragOver(true);
    },
    onDragLeave: e => { e.preventDefault(); if (e.currentTarget === e.target) setDragOver(false); },
    onDrop: e => {
      setDragOver(false);
      // A text drag (an @mention dragged off the production rail) is NOT ours — leave the event
      // alone so the browser's native drop-into-contenteditable inserts the token into the field.
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault(); e.stopPropagation();
      onDropFiles(e.dataTransfer.files);
    },
  } : {};

  // DEV-128 — THE ACTIVE-SELECTION STRIP. Derived HERE, from the fragmentProps the surface already
  // passes, so every surface that mounts a composer gets it without a wrapper — which is the point:
  // a per-surface summary row would be exactly the "variant" this component exists to prevent.
  //
  // It answers "what is riding on this prompt that I cannot see in the field" — the look, the camera
  // angle, the movement. Those are prompt fragments composed in at generate time, so with the
  // segments view collapsed they were invisible until the image came back wrong. Each pill opens
  // the picker that owns it. Nothing set → nothing rendered, no empty chrome.
  const fp = fragmentProps || {};
  const autoPills = [];
  if (fragments) {
    const openFrag = () => setPop(p => (p === 'fragments' ? null : 'fragments'));
    const look = (fp.looks || []).find(l => l.id === fp.activeLookId);
    if (look) {
      autoPills.push({
        id: '__look', label: look.name, tone: 'accent', title: look.fragment || look.name,
        thumb: look.refImage ? api.styleLockRefUrl(look.id) : undefined,
        onClick: openFrag, onRemove: fp.onLook ? () => fp.onLook('') : undefined
      });
    } else if (fp.projectLock) {
      autoPills.push({ id: '__look', label: fp.projectLock.name, tone: 'neutral', title: 'Project style lock — ' + (fp.projectLock.fragment || ''), onClick: openFrag });
    }
    if (fp.angle) {
      const tok = (AXES.find(a => a.key === 'framing') || { tokens: [] }).tokens.find(t => t.t === fp.angle);
      autoPills.push({
        id: '__angle', label: fp.angle, tone: 'neutral', title: (tok && (tok.d || tok.f)) || fp.angle,
        thumb: tok && tok.img, onClick: openFrag, onRemove: fp.onAngle ? () => fp.onAngle(null) : undefined
      });
    }
    if (fp.move) {
      const m = CAMERA_MOVEMENTS.find(x => x.id === fp.move);
      autoPills.push({
        id: '__move', label: (m && m.name) || fp.move, tone: 'neutral',
        title: (m && m.description) || 'camera movement',
        onClick: openFrag, onRemove: fp.onMove ? () => fp.onMove(null) : undefined
      });
    }
  }
  // surface-supplied pills keep their place after the derived ones
  const allPills = [...autoPills, ...pills];

  return (
    <div style={{ ...sx('position:relative'), ...style }}>
      {/* context pills — above the bar, only when set */}
      {allPills.length > 0 && (
        <div style={sx('display:flex;gap:7px;margin-bottom:9px;justify-content:center;flex-wrap:wrap')}>
          {allPills.map(p => <ContextPill key={p.id} {...p} />)}
        </div>
      )}

      <div
        className="glass" {...dropProps}
        style={{
          ...sx('position:relative;overflow:hidden'), padding: '14px 16px 12px',
          ...(dragOver ? sx('outline:1px dashed var(--accent);outline-offset:4px') : null),
        }}
      >
        {busy && <span className="dlTick" />}

        {/* pending attachment tray — uploads in flight, ready refs, failures */}
        {attachments.length > 0 && (
          <div style={sx('display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px')}>
            {attachments.map(a => (
              <span
                key={a.key} title={a.name}
                style={{
                  ...sx('display:inline-flex;align-items:center;gap:6px;border-radius:7px;padding:3px 8px'),
                  border: '1px solid ' + (a.status === 'error' ? 'var(--danger)' : 'var(--border-2)'),
                  background: 'var(--sunk)', maxWidth: 200,
                }}
              >
                <span style={{ ...sx('flex:none;border-radius:99px'), width: 5, height: 5, background: a.status === 'done' ? 'var(--ok)' : a.status === 'error' ? 'var(--danger)' : 'var(--marked)', animation: a.status === 'uploading' ? 'dl-pulse 1.4s infinite' : 'none' }} />
                <span style={{ ...sx('overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-soft)' }}>{a.name}</span>
                {onRemoveAttachment ? (
                  <button type="button" aria-label={'Remove ' + a.name} className="hFg" onClick={() => onRemoveAttachment(a.key)}
                    style={{ ...sx('border:none;background:none;cursor:pointer;padding:0;line-height:1'), fontSize: 10, color: 'var(--fg-faint)' }}>×</button>
                ) : null}
              </span>
            ))}
          </div>
        )}

        {/* prompt row — the field, plus the CLEAN/FULL/SEGMENTS toggle */}
        {/* DEV-133 — the sequence editor replaces the single prompt field. It COMPILES into that
            field (see writeSeq), so everything downstream — cost, guards, /api/generate — is
            unchanged; this is a different way to write one prompt, not a second send path. */}
        {inSequence && (
          <SequenceEditor scene={seq} onChange={writeSeq} onExit={endSequence} rate={rate} durationChoices={totals} />
        )}

        <div style={{ ...sx('display:flex;align-items:flex-start;gap:10px'), display: inSequence ? 'none' : 'flex' }}>
          <div style={sx('flex:1;min-width:0')} onContextMenu={promptMenu}>
            <MentionText
              ref={ta}
              value={v.prompt || ''}
              onChange={e => set({ prompt: e.target.value })}
              onKeyDown={onKeyDown}
              snippets={snippets}
              // DEV-126 — the nested / command tree. The composer supplies the CONTEXT (catalog,
              // looks) and the setters; slashCommands.js owns the tree shape and the ranking. Each
              // group only appears when its setter exists, so a surface with no camera state simply
              // has no /camera — the menu never advertises something it cannot do.
              commands={{
                settings,
                looks: fp.looks || [],
                fp,
                // scope /model to the current output kind. NB: `kinds` belongs to TechPopoverBody,
                // not to this scope — derive it from the composer's own model instead.
                video: outputKindForModel(v.model) === 'video' ? true : null,
                // `text` is the prompt with the /command stripped — merged into the SAME set() as
                // the model so neither write clobbers the other (see slashCommands.js)
                onModel: (id, text) => set({
                  model: id, outputKind: outputKindForModel(id), params: {},
                  ...(typeof text === 'string' ? { prompt: text } : null)
                })
              }}
              entities={allEntities}
              onBrowse={app && pid ? () => setPicker(true) : null}
              placeholder={placeholder}
              disabled={busy}
              wrapStyle={sx('width:100%')}
              style={{
                color: busy ? 'var(--fg-muted)' : 'var(--fg)', opacity: busy ? .8 : 1,
              }}
            />
          </div>
          {/* a REAL dropdown, not a 3-state cycle — cycling made the third view undiscoverable
              (user: "how do people know"). The ▾ promises a menu; now it opens one. */}
          <span style={sx('position:relative;flex:none')}>
            <button
              type="button"
              onClick={() => setPop(p => (p === 'view' ? null : 'view'))}
              className="hFg"
              title="Prompt view — clean · full · segments · shot list"
              style={{
                ...sx('border-radius:5px;padding:2px 7px;cursor:pointer;background:none'),
                border: '1px solid ' + (full ? 'var(--border-2)' : 'var(--border)'), fontFamily: MONO, fontSize: 8.5,
                letterSpacing: '.1em', color: full ? 'var(--fg-muted)' : 'var(--fg-faint)',
              }}
            >PROMPT · {view.toUpperCase()} ▾</button>
            <Popover open={pop === 'view'} onClose={() => setPop(null)} width={300} align="right">
              <PopHead>PROMPT VIEW</PopHead>
              <div style={sx('padding:0 6px 8px')}>
                {[
                  ['clean', 'CLEAN', 'Only what you typed'],
                  ['full', 'FULL', 'What actually ships — fragments run inline'],
                  ['segments', 'SEGMENTS', 'Every block on its own row — edit · add · save'],
                ].map(([id, label, desc]) => (
                  <div key={id} onClick={() => { setView(id); setPop(null); }} className="hRow"
                    style={sx('display:flex;align-items:baseline;gap:9px;padding:7px 8px;border-radius:7px;cursor:pointer')}>
                    <span style={{ ...sx('flex:none;width:12px'), fontFamily: MONO, fontSize: 10, color: 'var(--accent)' }}>{view === id ? '✓' : ''}</span>
                    <span style={{ ...sx('flex:none'), fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: '.1em', color: view === id ? 'var(--fg)' : 'var(--fg-soft)' }}>{label}</span>
                    <span style={sx('font-size:10.5px;color:var(--fg-faint)')}>{desc}</span>
                  </div>
                ))}
                {/* DEV-133 — SCENE sits with the prompt views because that is what it is: a fourth
                    way to write the one prompt. Offered on any moving-picture model; a still has no
                    segments to time. It is NOT gated on a synced duration field — the clock it
                    writes is prompt text, and gating on the schema hid the surface everywhere the
                    spec had not been synced. */}
                {canSequence && (
                  <div onClick={() => { if (inSequence) endSequence(); else startSequence(); setPop(null); }} className="hRow"
                    style={sx('display:flex;align-items:baseline;gap:9px;padding:7px 8px;border-radius:7px;cursor:pointer;border-top:1px solid var(--line);margin-top:4px')}>
                    <span style={{ ...sx('flex:none;width:12px'), fontFamily: MONO, fontSize: 10, color: 'var(--accent)' }}>{inSequence ? '✓' : ''}</span>
                    <span style={{ ...sx('flex:none'), fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: '.1em', color: inSequence ? 'var(--fg)' : 'var(--fg-soft)' }}>SCENE</span>
                    <span style={sx('font-size:10.5px;color:var(--fg-faint)')}>Shot by shot — timing, angle, camera move</span>
                  </div>
                )}
              </div>
            </Popover>
          </span>
        </div>

        {/* resolved @refs — a chip row under the prompt, not inline pills. See the header note. */}
        {mentions.length > 0 && (
          <div style={sx('display:flex;flex-wrap:wrap;gap:5px;margin-top:8px')}>
            {mentions.map(m => (
              <span key={m.id}
                style={{
                  ...sx('display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:1px 8px 1px 2px'),
                  border: '1px solid var(--border-2)', background: 'rgba(28,31,38,.8)',
                }}
              >
                <span style={{ ...sx('flex:none;border-radius:99px'), width: 15, height: 15, background: m.thumb ? 'center/cover no-repeat url(' + JSON.stringify(m.thumb) + ')' : 'var(--raise)' }} />
                <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--fg)' }}>{m.label}</span>
                {m.onRemove ? (
                  <button type="button" aria-label={'Remove ' + m.label} className="hFg" onClick={m.onRemove}
                    style={{ ...sx('border:none;background:none;cursor:pointer;padding:0;line-height:1'), fontSize: 10, color: 'var(--fg-faint)' }}>×</button>
                ) : null}
              </span>
            ))}
          </div>
        )}

        {/* FULL — the composed prompt, with injected fragments dimmed, tagged by origin, and —
            when the surface wires onEdit — editable section by section, in place. With provenance
            present, the base line is what the user typed and each fragment renders as its own
            segment; composedPrompt alone is the fallback for surfaces that haven't split yet. */}
        {full && (
          <div style={{ ...sx('margin-top:10px;padding:9px 12px;border-radius:8px;border:1px solid var(--line)'), background: 'rgba(10,11,14,.55)' }}>
            {segmented ? (
              /* SEGMENTS — the same fragments FULL runs together, broken into the blocks they were
                 assembled from. A style or camera block can be read, rewritten and saved to
                 snippets on its own, which is the whole point of splitting the view. */
              <div>
                <SegmentRow
                  label="Prompt"
                  text={String(v.prompt || '')}
                  onEdit={busy ? null : next => set({ prompt: next })}
                  onSave={String(v.prompt || '').trim()
                    ? () => askSave(v.prompt, nameFrom(v.prompt, 'Prompt')) : null}
                  onContextMenu={promptMenu}
                />
                {provenance.map((f, i) => (
                  <SegmentRow
                    key={f.tag || i}
                    label={f.tag || 'block ' + (i + 1)}
                    text={f.text}
                    onEdit={f.onEdit}
                    onSave={f.text ? () => askSave(f.text, nameFrom(f.tag, 'Block')) : null}
                    onContextMenu={segMenu(f)}
                    dim
                  />
                ))}
                {/* every known slot is VISIBLE, filled or not — an empty style/camera row with
                    ＋ ADD is how you discover segments exist and where new ones come from.
                    Both routes into the same place: the ✦ FRAGMENTS popover. */}
                {fragments && (() => {
                  const tags = provenance.map(f => String(f.tag || '').toLowerCase());
                  const missing = [
                    !tags.some(t => t.startsWith('style')) && 'Style',
                    !tags.some(t => t.startsWith('cam')) && 'Camera',
                  ].filter(Boolean);
                  return missing.map(slot => (
                    <div key={slot} onClick={() => setPop('fragments')} className="hRow"
                      title={'Add a ' + slot.toLowerCase() + ' block from ✦ fragments'}
                      style={sx('display:flex;gap:12px;padding:7px 0;border-bottom:1px dashed var(--line);align-items:center;cursor:pointer')}>
                      <span style={{ ...sx('flex:none;width:104px;text-transform:uppercase'), fontFamily: MONO, fontSize: 8.5, letterSpacing: '.12em', color: 'var(--border-3)' }}>{slot}</span>
                      <span style={{ ...sx('flex:1'), fontFamily: MONO, fontSize: 9.5, color: 'var(--border-3)' }}>— empty —</span>
                      <span style={{ ...sx('flex:none;border-radius:5px;padding:1px 7px'), border: '1px dashed var(--border-2)', fontFamily: MONO, fontSize: 8.5, letterSpacing: '.1em', color: 'var(--fg-faint)' }}>＋ ADD</span>
                    </div>
                  ));
                })()}
              </div>
            ) : (
              <div style={{ fontFamily: MONO, fontSize: 9.5, lineHeight: 1.8, color: 'var(--fg-faint)' }}>
                <span onContextMenu={promptMenu}>
                  {(provenance.length ? String(v.prompt || '') : (composedPrompt || String(v.prompt || ''))) ||
                    <span style={{ color: 'var(--border-3)' }}>nothing composed yet</span>}
                </span>
                {provenance.map((f, i) => (
                  <EditableFrag key={f.tag || i} text={f.text} tag={f.tag} onEdit={f.onEdit} onContextMenu={segMenu(f)} />
                ))}
              </div>
            )}
            <div style={{ fontFamily: MONO, fontSize: 8.5, color: 'var(--border-3)', marginTop: 5 }}>
              {segmented
                ? 'CLICK A BLOCK TO EDIT · RIGHT-CLICK TO SAVE OR CLEAR'
                : 'FRAGMENTS INJECTED FROM LOCKS — THE MODEL NEVER REWRITES THEM'
                + (provenance.some(f => f.onEdit) ? ' · CLICK A SECTION TO EDIT IT' : '')}
            </div>
          </div>
        )}

        {/* control row
            The glass shell clips (`overflow:hidden`, so the dlTick stays inside the radius), so a
            row that overflows does not scroll or wrap — it AMPUTATES, silently, from the right,
            which is exactly where Generate lives. In the 600px chat column the chips alone are
            469px against 406px of room, and the button lost 45px of itself; picking a longer
            `image_size` ate the cost badge too. Nothing in the row could yield: every BarChip is
            `flex:none;white-space:nowrap` and this group defaulted to `min-width:auto`.
            So: the chip group is the compressible part (it shrinks, then wraps its chips onto a
            second line), and cost + Generate are not. The bar gets taller instead of eating its
            own action.
            The row itself stays `nowrap` ON PURPOSE. A wrapping row breaks lines BEFORE it shrinks
            anything — it would drop Generate to a line of its own, left-aligned, while the chip
            group sat there at full width. Shrinking is what we want; wrapping happens one level
            down, inside the group. */}
        <div style={sx('display:flex;align-items:center;gap:8px;margin-top:12px')}>
          {/* shrink-but-never-grow: `flex-grow:1` here would eat the whole line and push Generate
              off the end even when it had room to sit alongside. */}
          <span style={{ ...sx('display:flex;align-items:center;flex-wrap:wrap;gap:8px;flex:0 1 auto;min-width:0'), opacity: busy ? .6 : 1 }}>
            {onMode && (
              <SegmentedControl
                options={[
                  { id: 'agent', label: 'AGENT', title: 'The agent routes and configures' },
                  { id: 'manual', label: 'MANUAL', title: modeDisabled || 'You pick the model and settings', disabled: !!modeDisabled },
                ]}
                value={mode}
                onChange={onMode}
              />
            )}

            {onAttach && (
              <button
                type="button" onClick={onAttach} className="hBd" title={attachHint || 'Attach references — drag-drop works too'}
                style={{
                  ...sx('flex:none;display:inline-flex;align-items:center;border-radius:999px;padding:4px 11px;cursor:pointer;background:none'),
                  border: '1px dashed var(--border-2)', color: 'var(--fg-faint)',
                  fontFamily: MONO, fontSize: 9.5,
                }}
              >+ Ref</button>
            )}

            {showTech && <span style={sx('position:relative')}>
              <BarChip
                label={techSummary(v)}
                on={pop === 'tech'}
                onClick={() => setPop(p => (p === 'tech' ? null : 'tech'))}
                title="Model · resolution · duration — tech settings"
              />
              {/* resizeKey — the settings panel is the one popover whose content density varies by
                  model (a synced spec can run 15 fields), so its width is the user's call (DEV-134) */}
              <Popover open={pop === 'tech'} onClose={() => setPop(null)} width={400} resizeKey="tech">
                <TechPopoverBody settings={settings} value={v} onChange={set} />
              </Popover>
            </span>}

            {fragments && (
              <span style={sx('position:relative')}>
                <BarChip
                  label={fragments.label}
                  icon="✦"
                  on
                  onClick={() => setPop(p => (p === 'fragments' ? null : 'fragments'))}
                  title="Prompt fragments — style, camera, references"
                />
                <Popover open={pop === 'fragments'} onClose={() => setPop(null)} width={480}>
                  <PopHead>✦ FRAGMENTS — PROMPT PIECES, NOT TECH</PopHead>
                  {fragmentProps
                    ? <FragmentsPopoverBody app={app} {...fragmentProps} />
                    : renderFragments
                      ? <div style={sx('padding:0 13px 13px')}>{renderFragments()}</div>
                      : <div style={{ ...sx('padding:0 13px 13px'), fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)', lineHeight: 1.7 }}>
                          Style, camera and references are set from this project's locks.
                        </div>}
                </Popover>
              </span>
            )}

            {app ? <VoiceInput app={app} size={26} disabled={busy} onText={t => set({ prompt: (v.prompt ? v.prompt + ' ' : '') + t })} /> : null}
          </span>

          {showTech ? <Cost value={cost} breakdown={costBreakdown} style={sx('margin-left:auto')} /> : <span style={sx('margin-left:auto')} />}

          {/* while busy the surface may offer a cancel (chat streaming) — otherwise the button
              holds the pulsing Generating… state. Never both. */}
          {busy && onCancel ? (
            <Btn variant="danger" size="lg" onClick={onCancel} style={{ flex: 'none' }}>
              <span style={{ ...sx('border-radius:2px'), width: 9, height: 9, background: 'var(--danger)' }} /> Cancel
            </Btn>
          ) : (
            <Btn
              variant="primary" size="lg"
              busy={busy}
              disabled={!canSubmit}
              onClick={() => canSubmit && onSubmit && onSubmit()}
              title={blockReason || (canSubmit ? (submitOnEnter ? '↵' : '⌘⏎') : 'Write a prompt first')}
              style={{ flex: 'none' }}
            >
              {busy ? (
                <>
                  <span style={{ ...sx('border-radius:99px'), width: 6, height: 6, background: 'var(--accent)', animation: 'dl-pulse 1.4s infinite' }} />
                  Generating…
                </>
              ) : submitLabel}
            </Btn>
          )}
        </div>

        {/* a blocked Generate says WHY, rather than just going dead */}
        {blockReason && !busy ? (
          <div style={{ fontFamily: MONO, fontSize: 8.5, color: 'var(--warn)', marginTop: 7, letterSpacing: '.06em' }}>
            {String(blockReason).toUpperCase()}
          </div>
        ) : null}
      </div>

      {/* ＋ Add more — tag any project or library image without leaving the composer */}
      {picker && app && pid && (
        <EntityPicker
          app={app} pid={pid}
          onClose={() => setPicker(false)}
          onPick={ent => {
            setPicker(false);
            if (!entities.some(e => e.key === ent.key)) setExtraEnts(x => [...x.filter(e => e.key !== ent.key), ent]);
            // insert the mention where the user was typing; the pill resolves via allEntities
            if (ta.current && ta.current.insertAtCaret) ta.current.insertAtCaret('@' + ent.key + ' ');
            else set({ prompt: (v.prompt ? v.prompt + ' ' : '') + '@' + ent.key + ' ' });
          }}
        />
      )}

      {/* right-click menu + save-to-snippets, both portalled to <body> — the glass shell's
          backdrop-filter would otherwise capture their fixed positioning */}
      {menu.render()}
      {snippetDraft && app && (
        <SaveSnippetDialog
          app={app}
          text={snippetDraft.text}
          suggestName={snippetDraft.name}
          onClose={() => setSnippetDraft(null)}
        />
      )}
    </div>
  );
}
