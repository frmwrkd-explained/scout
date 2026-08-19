# 04 — Contrast — lighten fg-faint, retire border-as-text, set a 9px floor

**Status:** resolved 2026-07-20 — `--fg-faint` is now `#7B8797` (5.3:1 on ink, 4.5:1 on raise) — this line said `#828C77`, a value that appears nowhere in the repo; `frontend/styles.css` `:root` and `frontend/tokens.js` both say `#7B8797`; all `#626B78`/`#5A6472`/`#4A525E`-family text literals migrated to `var(--fg-faint)` in the token sweep.
**Blocked by:** 01 — the `:root` token block and `frontend/tokens.js` must exist first.

## Problem

Live measurement against the running app: **41 of 91 visible text elements fail WCAG AA**. Four causes; one token accounts for 33.

1. **`fg-faint` `#626B78` is too dark.** Declared as a text token at `frontend/styles.css:6`, used **674 times across 43 files** (`grep -rao "626B78" frontend/ shared/ | wc -l`). It measures **3.58:1 on ink `#0D0E11`**, **3.06:1 on raise `#1C1F26`**. The 3:1 large-text relief needs ≥18.66px; the largest on-screen `#626B78` is 11.5px, the smallest 7.5px (`frontend/ToolsSuite.jsx:148`).

2. **`#3A3F49` is a declared *border* token used as text.** `styles.css:3` lists it under `border:`; `styles.css:25` and `styles.css:47` use it correctly as `border-color`. But **34 declarations across 15 files** set it as `color:` — message timestamps (`Chat.jsx:411`), the composer keybinding hint (`Chat.jsx:495`), empty states (`PromptBuilder.jsx:491`, `RemotionLibrary.jsx:655`). At **1.83:1** it is below the point where text is reliably perceived as text.

3. **`#5A6472` is an undeclared near-twin of `fg-faint`** — 16 uses in four files (`ReviewInbox.jsx` ×8, `ShotWorkspace.jsx` ×5, `Settings.jsx` ×2, `Tools.jsx:196`). Absent from the `styles.css:1-8` table. 3.23:1.

4. **A 7.5–8.5px floor.** 63 declarations sit below 9px (`grep -rahoE "font-size:[78](\.5)?px|fontSize: ?[78](\.5)?[,} ]" frontend/ | wc -l`), 11 of them in `CallSheet.jsx`.

The two defects stack. `PromptBuilder.jsx:583` and `StyleLab.jsx:593` both render *"renders this look on a neutral subject · costs a generation"* at `fontSize: 8.5, color:'#3A3F49'` — a cost warning at 1.83:1. `Settings.jsx:582` renders the app's onboarding contract, *"Everything saves live to settings.md — no save button"*, at 9.5px/`#626B78`.

## What to change

**Do not use `#7C8695`.** It measures 5.24:1 on ink but **4.48:1 on raise** — misses AA on the surface the chat and card stacks use. Use `#7B8797`: **5.29:1 on ink, 4.52:1 on raise**.

1. Set `--fg-faint:#7B8797` in ticket 01's `:root` block and `FG_FAINT='#7B8797'` in `frontend/tokens.js`. Update the comment table at `styles.css:6`.
2. Sweep `#626B78 → #7B8797` across `frontend/` and `shared/`. Mechanical, case-insensitive, no other edits in the commit.
3. Sweep `#5A6472 → #7B8797`. It carries no distinct meaning.
4. Retire `#3A3F49` as text: every `color:'#3A3F49'` / `color:#3A3F49` becomes `#7B8797`. **Exception:** `Screenplay.jsx:271` is a `cursor:not-allowed` disabled control — WCAG exempts disabled state; leave it. Leave all `border-color:#3A3F49` alone (`styles.css:25`, `:47`). Fix the one-off typo `#3A3F48` at `ThreeDStage.jsx:665` in the same pass.
5. **Promote meaning-carrying strings to `--fg-muted` `#9AA3AF`** (7.56:1) rather than leaving them faint. Faint is decoration and repeated metadata; anything that teaches the user something is muted. Minimum set:
   - `Settings.jsx:582` — the settings.md / no-save-button line.
   - `Chat.jsx:495` — `Enter to send · Shift+Enter for a newline` / `⌘Enter to generate`.
   - `PromptBuilder.jsx:583` and `StyleLab.jsx:593` — the cost warning.
   - `PromptBuilder.jsx:491` — `Describe your subject above to build the prompt live.`
   - `Tools.jsx:196` — `frozen local-canvas utilities — kept working, not part of the core loop`.
   - `ReviewInbox.jsx:89` and `:103` — the two empty/failure explanations.
6. **9px floor.** Raise every `7.5` / `8` / `8.5` font-size to `9` — 52 sites. Allowlist `CallSheet.jsx` (11 sites) and `Screenplay.jsx`: print surfaces with their own scale, matching the lint allowlist from ticket 01. Density is not the target; the sub-9px half-pixels are, and 8.5→9 is invisible at this scale.

## Acceptance criteria

- [ ] `grep -rao "626B78\|5A6472" frontend/ shared/ | wc -l` returns **0** (was 674 and 16).
- [ ] `grep -rnaoE "[^-]color: ?'?#3A3F49" frontend/` returns exactly **one** line, `frontend/Screenplay.jsx:271` (was 34).
- [ ] `grep -na "3A3F49" frontend/styles.css` still returns 3 lines (the `:3` comment plus `:25` and `:47` `border-color`).
- [ ] `grep -ra "3A3F48" frontend/ | wc -l` returns **0**.
- [ ] `grep -rahoE "font-size:[78](\.5)?px|fontSize: ?[78](\.5)?[,} ]" frontend/ --exclude=CallSheet.jsx --exclude=Screenplay.jsx | wc -l` returns **0** (was 52).
- [ ] With `npm run dev` + `npm run server` up, re-run the audit's console contrast sweep over Chat, Story, Settings, Project Generate and Review Inbox. **Fewer than 5 of ~91 visible text elements fail AA**, and **zero** failures resolve to `#7B8797` or `#9AA3AF`. Paste before/after counts under `## Comments`.
- [ ] In devtools, `getComputedStyle($0).color` on the `Settings.jsx:582` line returns `rgb(154, 163, 175)`.
- [ ] `node --test tests/` stays green (139 passing, `FRFG_DATA` pointed at a temp dir).

## Notes

- `#7B8797` sits clearly below `fg-muted #9AA3AF` (7.56:1), so the four-level ramp — `fg` / `fg-soft` / `fg-muted` / `fg-faint` — survives. Nothing collapses.
- Three `sed`-scale sweeps plus eight hand-picked promotions. Land the sweeps as separate commits from the promotions so a regression bisects cleanly.
- `#3A3F49`-as-text concentrates in `PromptBuilder.jsx` (8) and `StyleLab.jsx` (3).
- Ratios are computed against `#0D0E11` (ink) and `#1C1F26` (raise), the two backgrounds faint text lands on; `#101115` and `#14161B` sit between them and are covered.
- `CallSheet.jsx`'s three `color:#3A3F49` sites are in-app chrome and are swept normally; only its font sizes are allowlisted. Its print-surface palette needs its own pass — out of scope here.
