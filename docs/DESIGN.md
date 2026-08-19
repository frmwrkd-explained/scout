# FrameForge design system

**Binding.** `frontend/styles.css` `:root` is the machine-readable copy; this file explains
it. Where they disagree, `:root` wins and this file is the bug. `frontend/tokens.js`
mirrors `:root` for JS sinks (Three.js, canvas) — `tests/phase-design-tokens.test.mjs`
fails the suite if the two drift.

**The palette is the brand and does not change without an explicit request.** A 2026-07-20
session swapped it for a sage/olive direction without being asked; it was reverted the same
day. Improve the *craft* (spacing, hierarchy, consistency, components) freely; the hues are
the owner's call.

## What this app is

A dense, professional shot-list tool for filmmakers. It is **scanned and operated**, not
read top to bottom.

**Density is a choice, not a defect.** The tight padding, the 9–13px type, the packed
grids are correct and deliberate. Do not make this app more spacious. When something feels
wrong, the bug is almost always *inconsistency*, not tightness.

## Tokens

Defined in `frontend/styles.css` `:root`. Available to `sx()` strings and inline styles as
`var(--x)`. Available to JS sinks that cannot resolve CSS (Three.js materials, canvas) via
`frontend/tokens.js` `TOKENS`. **Never write a raw hex in component code** — if no token
fits, add one deliberately (`:root` + `tokens.js` + this file, same commit).

### Surfaces

| Token | Value | Use |
|---|---|---|
| `--ink` | `#0D0E11` | page ground |
| `--surface` | `#101115` | panels |
| `--surface-2` | `#14161B` | raised panels, card hover |
| `--raise` | `#1C1F26` | chips, row hover, the "lifted" bed |
| `--sunk` | `#0A0B0E` | wells, code blocks |
| `--void` | `#0B0C0E` | deepest recess |

Hierarchy is expressed by **nested surface steps** (ink → surface → raise), not by borders
alone.

### Lines

`--line #1B1E24` (hairline) · `--border #22252C` (default) · `--border-2 #2A2E36` (input) ·
`--border-3 #3A3F49` (hover, emphasis)

### Text

| Token | Value | On ink | Use |
|---|---|---|---|
| `--fg` | `#ECEEF2` | 16.8:1 | primary |
| `--fg-soft` | `#C9CFD8` | 11.6:1 | body, figures |
| `--fg-muted` | `#9AA3AF` | 6.9:1 | labels, secondary |
| `--fg-faint` | `#7B8797` | 5.3:1 | de-emphasised — AA on ink **and** on raise |

`--fg-faint` is the floor. Nothing renders text below it (the old `#626B78` and
border-as-text uses were swept to it).

### Accent — acid green, three steps

| Token | Value | Use |
|---|---|---|
| `--accent` | `#E3FF32` | the "click this" color — 17.2:1 as text on ink, 16.2:1 as a fill under `--on-accent` |
| `--accent-hover` | `#EEFF66` | hover step |
| `--accent-deep` | `#B8CC28` | pressed / active edge, gradient depth |
| `--on-accent` | `#141519` | text on solid accent |

Four accent alpha steps, and only four: `--accent-05` (row tint) · `--accent-12` (chips,
active rows) · `--accent-35` (outlined-primary borders) · `--accent-60` (strong edge).
Anything between these is noise, not a decision.

### Supporting registers

- `--sand` (currently aliasing `--fg-soft #C9CFD8`) — the register for money totals and
  editorial eyebrows. Its own token so the role can be re-tinted later without a sweep.
  **Never interactive.**
- Status — a separate channel from the accent: `--ok #3FCF8E` · `--warn #F0B23A` ·
  `--danger #F05B54`. Status never counts against the accent budget; the accent never
  announces status.
- `--marked #5B9DFF` — the **marked/running** blue (marked ≠ selected, running ≠ done).
  **Promoted from a literal to a token on 2026-07-20**, which is what this entry always
  said to do once its uses grew: they reached 17 raw `#5B9DFF` literals across
  `RenderMedia` (`markedColor` default), `ShotWorkspace` (`stC.running`),
  `chat/generationCards`, and `ProjectGenerate`'s marked band, before the composer added
  more. Named `--marked`, **not** the `--busy` this entry originally proposed: the channel
  carries ProjectGenerate's marked-selection band as well as running state, and `--busy`
  would misname half of its call sites. No further blues.

## The accent spend rule

`--accent` means one thing: **"click this."**

1. **Exactly one solid accent fill per screen.** That fill is the primary action.
   Everything else wanting emphasis takes the outlined treatment: `--accent-35` border,
   accent text, transparent background (`hBdAccent`).
2. **Accent text means interactive.** A static uppercase label is `--fg-muted`. 700/800
   weight + uppercase + `.12–.2em` tracking already encodes "label"; color adds nothing.
3. **Status is not accent. Figures are not accent.** Cost numerals are `--fg-soft` in the
   MONO face; totals may take `--sand`. The *face* is what reads as "figure", not the hue.
4. **Selected/active is state, not action:** neutral raised chip — `--raise` bed, `--fg`
   text, `--border-3` edge — never the solid accent fill.

### Encode state in form, not only in color

A pill, a chip, a severity stripe, a caret. The month-spend readout carries a 3px stripe
(`--ok`/`--warn`) so budget state is legible without parsing the number. Reuse these
forms; do not invent parallel mechanisms.

## Type — three registers

| Register | Face | Treatment |
|---|---|---|
| UI / prose | `Schibsted Grotesk` | 11–13px, weight 400–600 |
| Labels | `Schibsted Grotesk` | 9–11px, 700/800, uppercase, `.12–.2em` tracking, `--fg-muted` |
| Data | `Spline Sans Mono` (`--mono`) | figures, ids, seeds, filenames, model ids, shot numbers, durations, costs — 10–12px, weight 500/600 |

The mono face is a **semantic register, not decoration**: if a value could appear in a
column or a log, it is mono. Reach for `font-variant-numeric: tabular-nums` wherever
digits stack.

Display moments (empty states, project headers) may use Schibsted Grotesk at 18–24px
weight 500 — the one place type gets room. System/empty states speak in short mono
uppercase status lines (`NO SHOTS — IMPORT A SCRIPT OR ADD ONE`), not friendly
sentence-case filler.

## Radius, spacing, motion

- **Radius language:** 10–12px media tiles · 6–8px cards and inputs · pill (9999px)
  status chips only. Do not introduce new radii; when touching old 4/5/7px corners,
  snap them to the nearest step.
- **Spacing:** 8px base grid; inside dense rows 4px is legal. Siblings get `gap`, not
  per-child margins.
- **Motion ceiling:** 120–150ms controls, 200–250ms panels/overlays, plain `ease` or the
  house cubic-bezier(.2,.8,.2,1) for media tiles. Hover feedback is text color, border
  color, or background — **no lifts or scales in dense grids** (the moodboard masonry
  tile is the one sanctioned lift). `prefers-reduced-motion` collapses everything —
  already global in styles.css.
- Ambient flourishes (grain, gradient glows behind previews) stay **behind** content and
  never carry information.

## Interaction

- **Everything interactive is reachable.** Global `:focus-visible` ring: 2px `--accent`,
  2px offset. Never add `outline:none`. Buttons are real `<button>`s — use `Btn` from
  `frontend/ui.jsx` (primary / secondary / ghost / danger), which also drops its hover
  class automatically when disabled or busy.
- **Hover must not contradict state.** The `.h*:hover` classes use `!important` to beat
  inline styles — so a disabled control keeps its hover unless you drop the class:
  `className={busy ? '' : 'hBtnAccent'}`, paired with `cursor:not-allowed`. `Btn` does
  this structurally. A button reading "Working…" that lights up brighter than a live one
  is the UI lying.
- **Reveal-on-hover** for chrome that matters only once reached for: `.rvH`/`.rv`,
  `.hDel`. Reuse these; do not invent a third mechanism.
- Hover classes are named for **role**, not hue: `hAccent`, `hBdAccent`, `hBtnAccent`,
  `hBgAccent`.

## Progressive disclosure

Surface the summary; put the detail one click away.

- Field descriptions live on the label (dotted underline, full text on hover/focus), not
  permanently under every control.
- The model settings form shows required, output-shaping, and user-changed fields; the
  rest waits behind one `ADVANCED` disclosure with a count.
- The QUEUE dock and the Production Panel sections are the precedent: a collapsed line
  carrying a mono summary plus a state dot/count, expanding on click.
- Each screen keeps **one focal object** (the active shot, the running render); density
  everywhere else.

## Anti-generic guardrails

- Do not flatten distinct surfaces into a generic card grid. The shot list, the boards,
  the chat, and the moodboard have different structures *on purpose*.
- Do not add a second accent hue. Emphasis comes from the accent steps, form, or surface
  nesting — never a new color.
- Do not lighten the app or widen its spacing to feel "modern". Density is the brand.
- Do not change the palette. Craft changes are welcome; hue changes require the owner.

## Changing this file

Change `:root` first, then `tokens.js`, then this file — same commit. The parity test
enforces the first two. Do not add a second source of truth for any value here;
`CLAUDE.md`'s source-of-truth table names this layer.
