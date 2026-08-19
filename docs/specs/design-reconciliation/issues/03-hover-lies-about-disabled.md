# 03 — Stop hover from reporting the opposite of the truth

**Status:** resolved (short-term pass). The long-term `:not()` gate remains, blocked on 02 Part B.
**Blocked by:** None — can start immediately. The long-term half of "What to change" lands after 02.

> Citations re-measured 2026-07-19 against `reconcile/design-system`. Seven `.jsx` line
> numbers below were stale and have been corrected in place; `styles.css:28` and the
> `styles.css:20-36` range were verified accurate.

## Problem

`frontend/styles.css:28` declares:

```css
.hBtnAmber:hover{background:#EEFF66!important}
```

`!important` outranks the inline `style` React writes, so the moment a primary CTA goes busy or
unsendable its dimmed background is discarded on hover and the element lights up **brighter than
its own live state** (`#EEFF66` vs the resting `#E3FF32`). The UI signals "this click will work"
exactly when it won't. Verified sites:

- `frontend/Chat.jsx:592` — Send. `canSend` (`Chat.jsx:522`) false ⇒ inline `background:'#1C1F26'`,
  `color:'#626B78'`; `send()` is declared at `Chat.jsx:227`. Hover paints `#EEFF66`. Click is a no-op.
- `frontend/Story.jsx:521` — while `S.busy` the label reads `Breaking down…` on
  `rgba(227,255,50,.25)`; hover makes the working button brighter than a live one.
- `frontend/App.jsx:2684` — the shared `btn(labelText, onClick, primary, busy)` helper. `busy` ⇒
  `rgba(227,255,50,.25)`, hover ⇒ solid `#EEFF66`, label still says `Working…`.
- Empty-input variant (`#2A2E36` / `#626B78`): `App.jsx:1267`, `App.jsx:1661`,
  `AssetBoards.jsx:190`, `References.jsx:179`.
- Opacity variant: `RemotionLibrary.jsx:331` (`opacity: S.rendering ? 0.6 : 1`) **and its sibling
  `RemotionLibrary.jsx:332`**, which carries `hBd` on the same `S.rendering` condition;
  `StyleLocks.jsx:210` (`opacity: S.saving ? .6 : 1`). The `!important` background wins, the opacity
  survives, so these read as *semi-transparent neon* — worse than no fix.

59 `hBtnAmber` uses across 28 `.jsx` files. Two correct precedents to model:
`chat/generationCards.jsx:174` (`ActionChip` sets `pointerEvents:'none'` + `opacity:0.5` when
disabled, so hover never fires) and its duplicate `chat/splitCard.jsx:73`. `ProjectGenerate.jsx:994`
was a *partial* precedent: `className={blocked ? '' : 'hBtnAmber'}` covered `blocked`, but the
`S.busy` branch (`ProjectGenerate.jsx:991`) still carried the class and still lit up. Folded into
this pass as a tenth site — the condition is now `(blocked || S.busy)`.

## What to change

**Short term — make the class conditional at every site that has a disabled/busy branch.**
Where the inline style already forks on a condition, fork the className on the same condition:

```jsx
// Chat.jsx:592 — before
<div onClick={() => this.send()} className="hBtnAmber" style={{ ..., background: canSend ? '#E3FF32' : '#1C1F26', ... }}>
// after
<div onClick={() => this.send()} className={canSend ? 'hBtnAmber' : ''} style={{ ..., cursor: canSend ? 'pointer' : 'not-allowed', ... }}>
```

Eleven elements across ten sites: `Chat.jsx:592` (`canSend`), `Story.jsx:521` (`!S.busy`),
`App.jsx:2684` (`!busy`), `App.jsx:1267`, `App.jsx:1661`, `AssetBoards.jsx:190`,
`References.jsx:179`, `RemotionLibrary.jsx:331` **and `:332`**, `StyleLocks.jsx:210`,
`ProjectGenerate.jsx:994`. At each, also swap the `cursor:pointer` baked into
the `sx()` string for `cursor:not-allowed` in the disabled branch — right now every one of these
keeps `cursor:pointer` while inert, a second lie told by the same element.

Reuse the dim values already inline. Do not introduce a "disabled amber" colour.

**Long term — after 02 converts these to real `<button>` elements**, gate the hover rule so no
per-site className logic is needed:

```css
.hBtnAmber:not(:disabled):not([aria-disabled='true']):hover{background:#EEFF66!important}
```

Apply the same gate to the sibling hover classes at `styles.css:20-36` (`.hBd`, `.hAmber`, `.hRow`,
`.hBdRed`, …) — the bug is structural to the family, not to `hBtnAmber` alone; 8 lines in
`frontend/**/*.jsx` already pair an `h*` hover class with an `opacity` dim.

## Acceptance criteria

- This grep returns **0 lines** (currently 7 — the single-line offenders):
  `grep -an 'className="hBtnAmber"' frontend/*.jsx frontend/chat/*.jsx | grep -c "#2A2E36\|#1C1F26\|227,255,50,.25\|opacity:"`
- The two multi-line sites, `Story.jsx:521` and `App.jsx:2684`, carry a conditional `className`
  expression rather than a literal `"hBtnAmber"` / unconditional `primary ? 'hBtnAmber' : 'hBd'`.
- Manual, in the running app (`npm run dev` + `npm run server`): with an empty composer, hovering
  Send produces **no** background change; type one character and hover then lightens to `#EEFF66`.
- Manual: trigger "Break into shots" in Story; hovering while it reads `Breaking down…` leaves the
  background at `rgba(227,255,50,.25)`.
- All eleven changed elements render `cursor:not-allowed` in their disabled branch (inspect in devtools).
- `node --test tests/` stays green (139 passing; `FRFG_DATA` must point at a temp dir).

## Notes

`!important` is load-bearing — it exists to beat the inline `style` React writes every render. Do
not remove it in the short-term pass; that kills hover on the 50 healthy sites. Only the long-term
`:not()` gate is safe, and only once real `<button>`/`aria-disabled` exists from 02.

Guard-only fixes are not sufficient. Several sites already have a `!busy &&` guard in `onClick`
(`Chat.jsx:310`, `PromptBuilder.jsx:615`, `StyleLab.jsx:628`, `VideoImport.jsx:157`,
`chat/shotBoardCard.jsx:275`) and still light up on hover — the click being inert is precisely what
the hover conceals.

No new tokens, no new colours, no CSS framework. A className ternary and one selector.
