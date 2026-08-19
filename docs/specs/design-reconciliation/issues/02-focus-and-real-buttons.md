# 02 — Keyboard operability: focus ring and real `<button>` elements

**Status:** resolved 2026-07-20 — Part A landed 2026-07-19; Part B done in the polish pass: ~40
div-as-button targets across App.jsx/Chat.jsx/Story.jsx + modals now render real `<button>`s via
`Btn` (incl. `secondary`/`danger` variants). Remaining div-buttons are segmented
controls/chips/text-links, deliberately out of Btn's register.
**Blocked by:** —

> Part A landed 2026-07-19. Citations verified accurate: 110 `outline:none` across 25
> files, 0 `:focus` rules, and `styles.css:13` as the insertion point. All 110 were
> `;outline:none` (85 followed by `'`, 25 by `;`), so a single substitution removed them
> without touching the two `outline:1px dashed` drag affordances.

## Problem

The app cannot be operated without a mouse.

`frontend/styles.css` is 101 lines and contains **zero `:focus` rules** — `grep -c ":focus" frontend/styles.css` returns 0. Every interactive state it defines is `:hover` (lines 20–49). Against that, **110 `outline:none` declarations** sit in `sx()` strings across **25 frontend files** (`App.jsx` ×17, `PromptBuilder.jsx` ×11, `Settings.jsx` ×10, `ShotWorkspace.jsx` ×9, `Moodboard.jsx` ×7 …). Tabbing through Settings — 8 `<input>`s that all render as the same `#2A2E36`-bordered rectangle — produces no visible change at all.

Underneath that: **597 `onClick` handlers on `<div>`/`<span>`, against exactly 2 real `<button>` elements in the repo** (`frontend/ThreeDStage.jsx:594`, `:838`). `grep -c "<button"` returns 0 for `App.jsx`, `Chat.jsx`, and `Story.jsx`. Measured live: 173 `cursor:pointer` elements, 0 keyboard-reachable, 1 tab stop on the main screen (the search input, `App.jsx:1315`), 0 elements carrying any `role`/`aria-*`.

A `div` cannot carry the states this app needs:

- **No focus** — not focusable without `tabIndex`, so no ring can ever apply.
- **No `disabled`** — busy state is faked with inline `background`, which loses to `.hBtnAmber:hover{…!important}` (`styles.css:28`). `Chat.jsx:546` renders Send at `#1C1F26` when `canSend` is false and it still flashes `#EEFF66` on hover; `App.jsx:2667` and `Story.jsx:521` do the same to a control literally reading "Working…".
- **No `:active`, no Space/Enter activation** — so hover became the only state channel the app has.

## What to change

**Part A — the ring (lands independently, no dependency on 05).**

1. Add to `frontend/styles.css` after line 13, above the keyframes:
   ```css
   :focus-visible{outline:2px solid #E3FF32;outline-offset:2px}
   :focus:not(:focus-visible){outline:none}
   @media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
   ```
   `#E3FF32` on `#0D0E11` measures 17.2:1. Do **not** add `border-radius:inherit` — inputs run 6/7/8/10px radii and it lands inconsistently.
2. Delete all 110 `outline:none` from `sx()` strings. `:focus-visible` is what keeps mouse clicks ring-free, which is the only reason they were added. Leave the two conditional `outline:1px dashed #E3FF32` drag styles (`Chat.jsx:502`, `:524`) — those are drop affordances, not focus suppression.

**Part B — first migration wave (after 05).** Replace the div-as-button at these sites with `<Btn>` (renders `<button type="button">`, takes a real `disabled`):

| Site | Control |
|---|---|
| `App.jsx:1296` | FRAMEFORGE home |
| `App.jsx:1333`, `:1337` | INBOX pill, month-spend pill |
| `App.jsx:1342`, `:1343`, `:1344`, `:1347` | Library / Tools / Skills / Settings nav |
| `App.jsx:1892` | project tab strip (6 tabs) |
| `App.jsx:2667` | agent-wizard `btn()` helper (every wizard action) |
| `Chat.jsx:310`, `:614` | ＋ New session (sidebar, empty state) |
| `Chat.jsx:544`, `:546` | Cancel, Send |
| `Story.jsx:521` | story breakdown CTA |

On the tab strip add `role="tablist"` to the parent of `App.jsx:1892` and `aria-selected` per tab; on the nav group add `aria-current="page"`. Active state is currently encoded only in colour and `boxShadow:inset 0 -2px 0 #E3FF32`.

Reset the UA button styles once inside `<Btn>` (`background:none;border:none;font:inherit;color:inherit;padding:0`) so migrated call sites keep their exact current pixels. Migration must be visually a no-op.

Where `busy` gates the click — `App.jsx:2667` is `onClick={() => !busy && onClick()}` — pass `disabled={busy}` and drop the hover class while busy: `className={busy ? '' : 'hBtnAmber'}`. Once the wave lands, narrow `styles.css:28` to `.hBtnAmber:not(:disabled):hover`.

**Do not** attempt all 597 handlers. This ticket is the ring plus the ~20 controls above.

## Acceptance criteria

- `find frontend -name '*.jsx' -not -name '._*' -print0 | xargs -0 grep -ao "outline:none" | wc -l`
  returns **0**. (Scoped to `.jsx`: `styles.css` legitimately retains one `outline:none`, the
  `:focus:not(:focus-visible)` rule itself. The original repo-wide form of this grep would count
  that deliberate rule as a failure.)
- `grep -c ":focus-visible" frontend/styles.css` returns ≥ 1.
- `grep -c "<button" frontend/App.jsx frontend/Chat.jsx frontend/Story.jsx` returns ≥ 1 for each (today: 0, 0, 0).
- Tabbing from a fresh load reaches, in order: search input → each of the four nav items → the six tab strip items, each showing a visible `#E3FF32` ring. Today only the search input is reachable.
- Send with an empty composer and no completed attachments is `disabled` and does **not** turn `#EEFF66` on hover.
- Space and Enter activate every control in the Part B table.
- `node --test tests/` stays green with `FRFG_DATA` pointed at a temp dir.

## Notes

- `App.jsx:1052` guards the global keydown handler with `tag === 'INPUT' || 'TEXTAREA' || 'SELECT' || isContentEditable`. **`BUTTON` is not in that list**, so once the tab strip is real buttons, pressing `1`–`6` with a tab focused fires both the button and the digit shortcut at `App.jsx:1148`. Resolve it here: add `BUTTON` to the `typing` guard. Do not leave it for the implementer to discover.
- `styles.css:18` documents the `!important` hover block as deliberate ("exactly like the design tool did"). Part B is what makes narrowing it safe; don't rewrite the block wholesale.
- Land Part A as its own commit so the ring ships while `<Btn>` is still being written.
- **Part A does not move the tab-stop count.** Measured after Part A at 1600×1000: still 1 real
  tab stop, still 0 `role`/`aria-*`, `cursor:pointer` unchanged. That is correct and expected —
  the ring is what makes focus *visible*; Part B is what makes things *focusable*. Do not read
  the unchanged count as Part A having failed. What did move: inline `outline:none` in the live
  DOM 110 → **0**, `:focus` rules in the stylesheet 0 → **2**.
