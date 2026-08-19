# 05 — `frontend/ui.jsx` — five primitives to stop the drift

**Status:** resolved 2026-07-20. `ui.jsx` exports `Btn` (primary/secondary/ghost/danger, auto
hover-drop when disabled), `Card` (tone/label/right — the CardShell generalization), `Eyebrow`,
`Empty` (mono-uppercase status register), `Input`, `Field`. All six private `CardShell`/`Shell`
copies in `frontend/chat/` were deleted; one canonical `CardShell` in `chat/directives.jsx` wraps
`Card`. `Btn` is adopted across App/Chat/Story/modals.
**Blocked by:** 01 — the `:root` token block must exist first; these primitives are its first consumers.

## Problem

There is no place to make a visual decision once, so every control re-decides at its call site. `padding:8px 16px;border-radius:8px` appears **12** times across `frontend/`, and three of those are byte-identical accent buttons written from scratch three times: `Story.jsx:494`, `RemotionLibrary.jsx:310`, `App.jsx:3043` — all `sx('padding:8px 16px;border-radius:8px;background:#E3FF32;color:#141519;font-weight:700;font-size:12px;cursor:pointer')`.

None of them are buttons. Measured: **2** real `<button>` elements in `frontend/` (`ThreeDStage.jsx:594`, `:838`) against **659** `onClick` handlers on divs and spans. A div gets no `:focus`, no `disabled`, no browser `:active` — which is *why* hover is the app's only state channel. Alongside: **110** inline `outline:none` in `.jsx`, and `grep -c focus frontend/styles.css` returns **0**.

**The drift is worst in the newest code and is compounding now.** `CardShell` is defined **four** times in `frontend/chat/`, bodies byte-identical apart from destructuring order:

| Site | Signature |
|---|---|
| `chat/cards.jsx:25` | `{ label, tone = '#E3FF32', children, right }` |
| `chat/splitCard.jsx:58` | `{ label, tone = '#E3FF32', right, children }` |
| `chat/shotBoardCard.jsx:31` | `{ label, tone = '#E3FF32', children, right }` |
| `chat/generationCards.jsx:146` | `{ label, tone = '#E3FF32', right, children }` |

`cards.jsx:184` exports `StyleLockCard` and `ShotRefCard` but not `CardShell`, so each new card file re-typed it. Two more inline copies of the same container string — `border:1px solid #2A2E36;border-radius:10px;background:#101115;padding:11px 13px;margin:9px 0` — live in `PendingDirectiveCard` (`chat/directives.jsx:121`) and `ToolCardPending` (`chat/toolRegistry.jsx:71`). **Six exact copies in one directory**, plus a seventh near-copy with a dynamic border at `chat/toolCards.jsx:25`.

## What to change

Create `frontend/ui.jsx`. Plain `.jsx` + `sx()`, no new deps. Sizes anchored on **existing majority values** so adoption is mostly a no-op diff.

```jsx
<Btn variant size disabled busy>   // renders <button type="button">
   // primary md: 8px 16px / r8 / 12px / 700 / --accent / --on-accent  ← Story.jsx:494 verbatim
   // ghost   md: 8px 16px / r8 / 12px / 600 / 1px --border / --fg-soft ← RemotionLibrary.jsx:311
   // sizes: sm 5px 12px/r6 · md 8px 16px/r8 · lg 10px 18px/r10 (Chat.jsx:546)
<Card>      // r10 / --surface / 1px --border / padding 11px 13px  ← the CardShell container
<Eyebrow>   // 10px MONO / .08em / uppercase / --fg-muted           ← cards.jsx:30
<Empty>     // inline: r12, padding 18px (App.jsx:2498) · page: r14, padding 44px 20px
            // (ToolsSuite.jsx:194); `action` prop ⇒ dashed border, else solid --border
<Field>/<Input>  // --ink / 1px --border / r8 / 8px 12px / MONO 11px
                 // ← Settings.jsx:158, :307, :350, :603, already identical
```

Rules the primitives must carry:

1. **`<Btn>` renders a real `<button type="button">`** and passes `disabled` through. No `!busy &&` guard in the handler — `disabled` does it. This is what makes ticket 02's hover fix permanent rather than per-call-site.
2. **`busy` implies `disabled`** and drops the `hBtnAmber` class. Kills `App.jsx:2666` (the `btn` factory whose label reads "Working…" at `:2669`) and `Story.jsx:521` ("Breaking down…"), both of which keep `hBtnAmber` while busy and so brighten to `#EEFF66` on hover — brighter than a live button.
3. **No `outline:none` anywhere in `ui.jsx`.** Focus comes from the global `:focus-visible` rule.
4. Every colour, radius and space value references a token from 01. Zero hex literals in `ui.jsx`.

Then **export `CardShell` from `chat/cards.jsx`** as a thin wrapper over `<Card>` (it adds the tone dot + `<Eyebrow>` header). Delete the three duplicates at `generationCards.jsx:146`, `splitCard.jsx:58`, `shotBoardCard.jsx:31` and import instead; normalise on `{ label, tone, right, children }`. Rebuild `directives.jsx:117` and `toolRegistry.jsx:68` on it — they differ only by a pulse on the dot and a trailing status word ("card pending" / "card coming"), both expressible as props.

**Adoption is opportunistic, not a migration.** Convert `App.jsx:2666` (the `btn` factory — one edit, many call sites), the Chat composer (attach `Chat.jsx:507`, Send/Cancel `Chat.jsx:543-546`), and `Story.jsx:492-494`. Everything else converts when a file is touched for other reasons. Do not open a change that rewrites all 12 accent-CTA sites.

## Acceptance criteria

- [ ] `frontend/ui.jsx` exists and exports `Btn`, `Card`, `Eyebrow`, `Empty`, `Field`, `Input`.
- [ ] `grep -c '#[0-9a-fA-F]\{3,8\}' frontend/ui.jsx` → **0**; `grep -c 'outline:none' frontend/ui.jsx` → **0**.
- [ ] `grep -rn 'function CardShell' --include='*.jsx' frontend/` → exactly **1** hit (`chat/cards.jsx`).
- [ ] `grep -rl 'border:1px solid #2A2E36;border-radius:10px;background:#101115;padding:11px 13px;margin:9px 0' --include='*.jsx' frontend/ | wc -l` → **0** (was 6).
- [ ] With the app running, on the Chat screen `document.querySelectorAll('button').length` ≥ **3** (was 0).
- [ ] Tab reaches the Chat Send control, it shows the `:focus-visible` ring, and Enter/Space fires it. Today it is not tab-reachable.
- [ ] With `canSend === false` (`Chat.jsx:478`), Send carries `disabled`, does not go `#EEFF66` on hover, and does not fire on click or Enter.
- [ ] `FRFG_DATA=$(mktemp -d) node --test tests/` → **175 pass, 0 fail**.
- [ ] Screenshot the four chat card types (style-lock, generation, split, shot-board) before and after: no visible change.

## Notes

`sx()` (`frontend/sx.js`) passes values through untouched, so `var(--token)` works inside every existing style string with **zero changes to `sx.js`**. That is what makes this adoptable one line at a time.

Keep the `h*` hover classes for now — `<Btn>` applies `hBtnAmber`/`hBd` only when `!disabled`. Ticket 02 gates the CSS on `:not(:disabled)`; once `<Btn>` is the only producer of those classes, that gate becomes real rather than advisory.

`ThreeDStage.jsx:593` already has a `btn` factory rendering `<button>` with `disabled` and an `opacity:.45` disabled style — read it before writing `<Btn>`; its prop shape is a reasonable starting point.

Two empty states prove the affordance point and are the `<Empty>` test cases: `AssetBoards.jsx:243` is a dashed box that **is** clickable, `Library.jsx:243` is a near-identical dashed box that is **not** — but a paragraph of body text inside it (`Library.jsx:245`) is. `<Empty action={...}>` makes dashed mean "you can act here" for the first time, and puts the click on a real button.

Density is correct and must not change. Every value above is an existing majority — this removes variance, not tightness.
