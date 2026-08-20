// frontend/ui.jsx — five shared primitives (ticket 05:
// docs/specs/design-reconciliation/issues/05-ui-primitives.md).
//
// There is nowhere else in the app a visual decision gets made once — every control re-decides
// padding/radius/color at its call site (the ticket counts three byte-identical accent buttons and
// six copies of one card container across frontend/chat/). Every value below is an EXISTING
// majority pulled from real call sites (cited inline), not invented, so adopting a primitive at a
// call site should be a visual no-op. Adoption is opportunistic — this file only adds the
// primitives, it does not migrate any call site (that is ticket 02 Part B).
//
// Tokens: the full "location scout" layer (surfaces, lines, text, accent steps, status) exists in
// styles.css :root and everything below styles through var(--x) — no hex literals. If you need a
// color that isn't a token, the design has a gap: add a token deliberately (:root + tokens.js +
// docs/DESIGN.md, same commit), never a literal here.
import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';


// ── Btn ──────────────────────────────────────────────────────────────────────────────────────
// Renders a real <button type="button"> — the two real buttons in frontend/ today are both in
// ThreeDStage.jsx (:593 has a `btn` factory worth reading: disabled + opacity treatment, a
// reasonable starting point). Everything else is a div/span with onClick, which is why hover is
// the app's only state channel and why 110 inline `outline:none` had to exist. No outline:none
// lives here — the global :focus-visible ring (styles.css) is the only focus treatment.
//
// UA reset so a migrated call site is pixel-identical to the div it replaces.
const BTN_RESET = sx('background:none;border:none;font:inherit;color:inherit;padding:0;margin:0;display:inline-flex;align-items:center;gap:7px;white-space:nowrap');

const BTN_SIZES = {
  // sm 5px 12px / r7 / 11px — Story.jsx:515,589,615,630,642 (5 identical sites). The ticket's own
  // text cites "r6" for this size; r6 does not occur anywhere in frontend/ for this padding — the
  // real majority is r7, corrected here.
  sm: sx('padding:5px 12px;border-radius:7px;font-size:11px'),
  // md 8px 16px / r8 / 12px — Story.jsx:494 (primary), RemotionLibrary.jsx:311 (ghost).
  md: sx('padding:8px 16px;border-radius:8px;font-size:12px'),
  // lg 10px 18px / r8 / 12.5px — Chat.jsx:592 measured r10, but DESIGN.md's radius language caps
  // controls at 6–8px (10–12 is the media-tile step); lg snaps to the button step.
  lg: sx('padding:10px 18px;border-radius:8px;font-size:12.5px'),
};

function btnColorStyle(variant, isDisabled, busy) {
  if (variant === 'primary') {
    // Chat.jsx's Send button is the literal source for the plain-disabled look
    // (background:var(--raise);color:var(--fg-faint) when canSend is false) — reproduced verbatim so that
    // migration is a no-op. Busy gets its own, distinct, accent-tinted look — Story.jsx's
    // "breaking down…" state (background:var(--accent-12);color:var(--accent)) — because busy
    // means "in progress", not "unavailable", and the two states are already visually distinct at
    // their real call sites.
    if (busy) return { background: 'var(--accent-12)', color: 'var(--accent)', border: 'none', fontWeight: 700, cursor: 'not-allowed' };
    if (isDisabled) return { background: 'var(--raise)', color: 'var(--fg-faint)', border: 'none', fontWeight: 700, cursor: 'not-allowed' };
    return { background: 'var(--accent)', color: 'var(--on-accent)', border: 'none', fontWeight: 700, cursor: 'pointer' };
  }
  if (variant === 'secondary') {
    // Outlined-primary — DESIGN.md's second emphasis tier: accent text on a transparent bed with an
    // --accent-35 border (the hBdAccent treatment, e.g. Settings "+ Add" at Settings.jsx:681).
    // Never a solid fill — the one solid accent per screen belongs to `primary`.
    if (busy) return { background: 'var(--accent-05)', color: 'var(--accent)', border: '1px solid var(--accent-12)', fontWeight: 700, cursor: 'not-allowed' };
    if (isDisabled) return { background: 'transparent', color: 'var(--fg-faint)', border: '1px solid var(--border-2)', fontWeight: 700, cursor: 'not-allowed', opacity: .5 };
    return { background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent-35)', fontWeight: 700, cursor: 'pointer' };
  }
  if (variant === 'danger') {
    // Destructive — outlined, never solid (DESIGN.md: status never impersonates the accent, and a
    // solid red slab would out-shout the screen's one primary action). Matches the hBdRed language.
    if (isDisabled || busy) return { background: 'transparent', color: 'var(--fg-faint)', border: '1px solid var(--border-2)', fontWeight: 700, cursor: 'not-allowed', opacity: .5 };
    return { background: 'transparent', color: 'var(--danger)', border: '1px solid var(--border-2)', fontWeight: 700, cursor: 'pointer' };
  }
  // ghost (alias: 'neutral') — RemotionLibrary.jsx:311 et al: 1px border, --fg-soft text, 600 weight.
  if (isDisabled) return { background: 'transparent', color: 'var(--fg-faint)', border: '1px solid var(--border-2)', fontWeight: 600, cursor: 'not-allowed', opacity: .5 };
  return { background: 'transparent', color: 'var(--fg-soft)', border: '1px solid var(--border-2)', fontWeight: 600, cursor: 'pointer' };
}

// hover class per variant — dropped entirely while disabled/busy so a dead control never lights up.
const BTN_HOVER = { primary: 'hBtnAccent', secondary: 'hBdAccent', danger: 'hBdRed', ghost: 'hBd', neutral: 'hBd' };

export function Btn({
  variant = 'ghost', // 'primary' | 'secondary' | 'ghost' (alias 'neutral') | 'danger'
  size = 'md', // 'sm' | 'md' | 'lg'
  busy = false,
  disabled = false,
  className = '',
  style,
  type = 'button',
  children,
  ...rest
}) {
  // busy implies disabled — no `!busy &&` guard needed in the caller's onClick, `disabled` on a
  // real <button> already blocks click and keyboard activation (Enter/Space).
  const isDisabled = !!(disabled || busy);
  // The hover class is dropped whenever the button is inactive, for either reason — this is what
  // stops a dead button from lighting up brighter than a live one (ticket 03's fix, made
  // structural instead of per-call-site: `className={busy ? '' : 'hBtnAccent'}` is now automatic).
  const hoverClass = isDisabled ? '' : (BTN_HOVER[variant] || 'hBd');
  return (
    <button
      type={type}
      disabled={isDisabled}
      className={[hoverClass, className].filter(Boolean).join(' ')}
      style={{ ...BTN_RESET, ...(BTN_SIZES[size] || BTN_SIZES.md), ...btnColorStyle(variant, isDisabled, busy), ...style }}
      {...rest}
    >
      {children}
    </button>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────────────────────
// The chat CardShell container, generalised — chat/cards.jsx:29 (`CardShell`), byte-identical
// (aside from destructuring order) in splitCard.jsx:58, shotBoardCard.jsx:31, generationCards.jsx:146.
// r10 / surface / 1px border / padding 11px 13px. No margin baked in on purpose — CardShell's own
// `margin:9px 0` is chat-list stacking, not part of the box's own definition, and stays with
// CardShell when it's rebuilt on top of <Card> (this ticket's body, out of scope for ui.jsx itself).
const CARD_BASE = sx('border-radius:10px;padding:11px 13px');

// Named tones for the header status dot — the vocabulary CardShell call sites actually use
// (chat/cards.jsx passes var(--accent) by default and var(--danger) on error). A raw CSS color
// string also works, so `tone={STATUS_TONE[status]}` keeps working unchanged.
const CARD_TONES = {
  accent: 'var(--accent)', ok: 'var(--ok)', warn: 'var(--warn)', danger: 'var(--danger)',
  sand: 'var(--sand)', muted: 'var(--fg-muted)',
};

// Props (all additive — a bare <Card> renders exactly as before):
//   tone   named tone above or any CSS color — colors the header dot; default 'accent'
//   label  eyebrow text; providing it (or `right`) turns on the CardShell-style header row
//   right  right-aligned header slot (badges, actions)
export function Card({ tone, label, right, className = '', style, children, ...rest }) {
  const hasHead = label != null || right != null;
  const dot = CARD_TONES[tone] || tone || 'var(--accent)';
  return (
    <div className={className} style={{ ...CARD_BASE, background: 'var(--surface)', border: '1px solid var(--border-2)', ...style }} {...rest}>
      {hasHead && (
        <div style={sx('display:flex;align-items:center;gap:8px;margin-bottom:8px')}>
          <span style={{ ...sx('flex:none;border-radius:99px'), width: 6, height: 6, background: dot }} />
          {label != null && <Eyebrow>{label}</Eyebrow>}
          {right != null && <span style={sx('margin-left:auto')}>{right}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

// ── Eyebrow ──────────────────────────────────────────────────────────────────────────────────
// The card-header label span — chat/cards.jsx:32. 10px MONO, .08em tracking, uppercase, muted.
const EYEBROW_STYLE = { fontFamily: MONO, fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--fg-muted)' };

export function Eyebrow({ className = '', style, children, ...rest }) {
  return (
    <span className={className} style={{ ...EYEBROW_STYLE, ...style }} {...rest}>
      {children}
    </span>
  );
}

// ── Empty ────────────────────────────────────────────────────────────────────────────────────
// Two sizes drawn from real empty states:
//   inline — r12, padding 18px      — App.jsx:2522 (ticket cited :2498; content matches exactly
//                                      at the new line, the file has drifted since the ticket)
//   page   — r14, padding 44px 20px — ToolsSuite.jsx:194
//
// `action` flips the affordance from "read" to "act": dashed border + a real clickable <Btn>
// wrapping the content, vs. solid border + a plain <div> when there is nothing to click. Today
// that distinction doesn't exist — AssetBoards.jsx:243 (dashed, the whole box is clickable) and
// Library.jsx:243/245 (dashed, the box itself is NOT clickable — only a paragraph inside it is)
// look identical and mean opposite things. `action` makes "dashed ⇒ you can act here" true.
const EMPTY_SIZE = {
  inline: sx('border-radius:12px;padding:18px;text-align:center'),
  page: sx('border-radius:14px;padding:44px 20px;text-align:center'),
};

export function Empty({ size = 'inline', title, body, action, className = '', style, children, ...rest }) {
  const sizeStyle = EMPTY_SIZE[size] || EMPTY_SIZE.inline;
  const content = children != null ? children : (
    <>
      {/* DESIGN.md: system/empty states speak in short mono uppercase status lines
          ("NO SHOTS — IMPORT A SCRIPT OR ADD ONE"), not friendly sentence-case filler.
          text-transform does the shouting, so sentence-case call sites need no change. */}
      {title != null ? <div style={{ ...sx('font-size:10.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--fg-muted)'), fontFamily: MONO }}>{title}</div> : null}
      {body != null ? <div style={sx('font-size:11.5px;color:var(--fg-faint);margin-top:6px;line-height:1.55')}>{body}</div> : null}
    </>
  );
  if (action) {
    const a = typeof action === 'function' ? { onClick: action } : action;
    return (
      <Btn
        variant="ghost"
        onClick={a.onClick}
        disabled={a.disabled}
        busy={a.busy}
        aria-label={a.label}
        className={className}
        style={{ ...sizeStyle, border: '1px dashed var(--border-2)', display: 'block', width: '100%', boxSizing: 'border-box', ...style }}
        {...rest}
      >
        {content}
      </Btn>
    );
  }
  return (
    <div className={className} style={{ ...sizeStyle, border: '1px solid var(--border-2)', ...style }} {...rest}>
      {content}
    </div>
  );
}

// ── Field / Input ───────────────────────────────────────────────────────────────────────────
// The Settings.jsx input, identical at :158, :307, :350, :603 — ink background (a well, one step
// below the card it sits on), --border-2 (the input border token), r8, 8px 12px padding, MONO 11px
// with tabular-nums so seeds/costs/counts align when they stack.
const INPUT_STYLE = sx('background:var(--ink);border:1px solid var(--border-2);border-radius:8px;padding:8px 12px');

export function Input({ className = '', style, ...rest }) {
  return (
    <input
      className={className}
      style={{ ...INPUT_STYLE, color: 'var(--fg)', fontFamily: MONO, fontSize: 11, fontVariantNumeric: 'tabular-nums', ...style }}
      {...rest}
    />
  );
}

// Field — Settings.jsx's `label()` (:18) and `hint()` (:19) helpers, generalised: an uppercase
// caption above arbitrary content (typically an <Input>), with an optional hint line below.
const FIELD_LABEL_STYLE = sx('font-size:10.5px;font-weight:700;letter-spacing:.14em;color:var(--fg-faint);margin-bottom:9px');
const FIELD_HINT_STYLE = sx('font-size:10.5px;color:var(--fg-faint);margin-top:7px;line-height:1.55');

export function Field({ label, hint, className, style, children, ...rest }) {
  return (
    <div className={className} style={style} {...rest}>
      {label != null ? <div style={FIELD_LABEL_STYLE}>{label}</div> : null}
      {children}
      {hint != null ? <div style={FIELD_HINT_STYLE}>{hint}</div> : null}
    </div>
  );
}

// ── Chip ─────────────────────────────────────────────────────────────────────────────────────
// The selectable option pill. "Selected" is STATE, not the primary action, so this is DESIGN.md's
// neutral raised chip exactly: --raise bed, --fg text, --border-3 edge. Never the solid accent
// fill, and never the flat var(--fg) white it once was.
//
// It lived module-locally and byte-identically in BOTH GenerationControls.jsx and SchemaForm.jsx,
// exported from neither — which docs/COMPONENTS.md §1.1 names as the root cause of the worst
// duplication in the app, because a surface that wanted this chip had no way to import it and
// retyped it instead. One declaration now, here with the other primitives. Import it.
export function Chip({ label, on, onClick, title, style, ...rest }) {
  return (
    <span onClick={onClick} title={title || ''} className={on ? '' : 'hBd'}
      style={{
        ...sx('font-size:10px;border-radius:6px;padding:4px 10px;cursor:pointer'),
        fontFamily: MONO, fontVariantNumeric: 'tabular-nums',
        color: on ? 'var(--fg)' : 'var(--fg-muted)',
        background: on ? 'var(--raise)' : 'transparent',
        border: '1px solid ' + (on ? 'var(--border-3)' : 'var(--border-2)'),
        fontWeight: on ? 700 : 400,
        ...style,
      }}
      {...rest}>{label}</span>
  );
}

// ── InlineEdit ───────────────────────────────────────────────────────────────────────────────
// Click-to-edit text that renders as plain text until you click it, then becomes an input in the
// same box with no layout shift. Used for a shot's title and action line in the story list.
//
// Commits on Enter and on blur; Escape reverts. onCommit only fires when the value actually
// CHANGED, so clicking a cell and clicking away does not write a no-op patch (every write here
// costs a file rewrite and a log line in the shot's markdown).
//
// stopPropagation on both keydown and click: these live inside a row whose own onClick opens the
// shot workspace and whose parent binds J/K/Enter as list navigation. Without it, typing "k" in a
// title would jump the selection.
// `renderValue` lets a caller keep rich read-mode display (e.g. @mention highlighting) without
// giving up single-click-to-edit. Without it, callers wrap InlineEdit in their own click handler
// and the field then needs TWO clicks to open — one for the wrapper, one for InlineEdit itself.
export function InlineEdit({
  value, onCommit, placeholder = '', multiline = false, renderValue = null,
  style, inputStyle, className = '', title, ...rest
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value == null ? '' : String(value));
  const ref = React.useRef(null);

  React.useEffect(() => { if (!editing) setDraft(value == null ? '' : String(value)); }, [value, editing]);
  React.useEffect(() => { if (editing && ref.current) { ref.current.focus(); ref.current.select?.(); } }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next !== String(value == null ? '' : value).trim()) onCommit && onCommit(next);
  };
  const cancel = () => { setDraft(value == null ? '' : String(value)); setEditing(false); };

  if (!editing) {
    const empty = !String(value || '').trim();
    return (
      <span
        className={className}
        title={title || 'Click to edit'}
        onClick={e => { e.stopPropagation(); setEditing(true); }}
        style={{ ...sx('cursor:text;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), ...(empty ? { color: 'var(--fg-faint)', fontStyle: 'italic' } : null), ...style }}
        {...rest}
      >{empty ? placeholder : (renderValue ? renderValue(value) : value)}</span>
    );
  }
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <Tag
      ref={ref}
      value={draft}
      placeholder={placeholder}
      onChange={e => setDraft(e.target.value)}
      onClick={e => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Enter' && !(multiline && e.shiftKey)) { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      }}
      style={{
        ...sx('width:100%;box-sizing:border-box;background:var(--ink);border:1px solid var(--accent-35);border-radius:6px;padding:2px 6px;margin:-3px 0'),
        color: 'var(--fg)', font: 'inherit', resize: multiline ? 'vertical' : 'none',
        ...style, ...inputStyle,
      }}
    />
  );
}


// ── OpenRecord ───────────────────────────────────────────────────────────────────────────────
// The affordance that says a row can be OPENED.
//
// Every row renderer (table, list, gallery) has always had `onClick → select` and
// `onDoubleClick → open`. Both worked; neither was visible. A double-click is not an affordance,
// it is a secret, and the first thing a person reported about this app was "I can't open
// documents" — the surface offered no way to find out that it could. Law 8 says nothing is hidden
// from the human who wants to look, and an invisible gesture hides the whole document surface.
//
// It lives here, not in the three renderers, for the reason CLAUDE.md gives: a second
// implementation of one control is a bug. Three copies of a hover chip would drift within a week.
//
// Reveal-on-hover (`rvH`/`rv` from styles.css) keeps the table as dense as §6 requires — the
// chrome only appears when someone reaches for the row. The parent row must carry `className="rvH"`.
// `stopPropagation` matters: without it the click also runs the row's select handler, and the two
// fight over the same event.
export function OpenRecord({ onOpen, label = 'Open', title = 'Open this record — or double-click the row', className = '', style, ...rest }) {
  if (!onOpen) return null;
  return (
    <button type="button" title={title} className={'rv hAccent ' + className}
      onClick={e => { e.stopPropagation(); onOpen(); }}
      onDoubleClick={e => e.stopPropagation()}
      style={{
        ...sx('flex:none;display:inline-flex;align-items:center;gap:4px;padding:1px 6px;border-radius:5px;cursor:pointer;background:var(--surface-2);font-size:9px;font-weight:700;letter-spacing:.1em'),
        fontFamily: MONO, border: '1px solid var(--border-2)', color: 'var(--fg-muted)',
        ...style,
      }}
      {...rest}
    >{label.toUpperCase()}<span aria-hidden="true" style={sx('font-size:8.5px')}>↗</span></button>
  );
}
