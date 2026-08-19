# 10 — Write docs/DESIGN.md and close the dangling authority

**Status:** resolved 2026-07-20. Parts A+B: `docs/DESIGN.md` written (rewritten for the
"location scout" direction); dangling citations retired; `CLAUDE.md` table updated. Parts C+D:
hover classes renamed `h*Amber`→`h*Accent` across styles.css and all call sites; `showToast`
call sites now pass `var(--ok)`/`var(--danger)`/token colors instead of raw hex.
**Blocked by:** 01

## Problem

`frontend/styles.css:1` opens `/* ── FrameForge design system (see docs/DESIGN.md — binding) ──` and closes at line 7 with `Anything not in this table does not ship.` The table declares ~17 colors. **`docs/DESIGN.md` has never existed** — `ls docs/DESIGN.md` → `No such file or directory`. `frontend/Story.jsx:906` cites it a second time, inside render code, as live authority: `// graphite neutrals + one accent-family tint only (docs/DESIGN.md — no blue/purple/teal)`. Those two are the only references in the repo.

A binding pointer to nothing taught every reader the header block is decorative — which is how 3499 hex literals and ~60 distinct colors landed behind a 17-color declaration without anyone treating it as a violation.

Two naming faults make the same surface un-findable:

1. **The accent is named "Amber" and is not amber.** `#E3FF32` is acid yellow-green. 151 occurrences across 33 files use `hAmber` (55), `hBtnAmber` (60), `hBdAmber` (15), `hBdAmberChip` (15), `hBgAmber` (6), declared at `frontend/styles.css:21–36`. `rg -i --text accent frontend/` returns 80 hits across 18 files today and **not one is a hover class** — they are `accent-color:` on inputs, model-catalog strings, and prose. No single grep finds the accent surface.

2. **`showToast(text, dot, undoFn)` (`frontend/App.jsx:301`) takes an arbitrary color string** and paints it raw at `App.jsx:2970` (`background: t.dot`). Of 367 call sites, ~201 pass a raw hex — **7 distinct values**: `#F05B54` (89), `#3FCF8E` (54), `#E3FF32` (40), `#626B78` (5), `#9AA3AF` (8), `#C9CFD8` (2), `#FF7A7A` (1). Another 34 pass per-file `AMBER`/`GREEN`/`RED`/`DANGER` constants — **25 declarations across 13 files** (`StyleLab.jsx:35–37`, `ControlMaps.jsx:10–12`, `CallSheet.jsx:8–10`, and 10 more files). This is the largest single hole through which undeclared color enters. `Chat.jsx:284` fires `#FF7A7A` — a color used **exactly once in the frontend** — from `.catch(e => showToast(e.message, '#FF7A7A'))`, while `Chat.jsx:292` fires `#F05B54` from a structurally identical catch eight lines below. Two reds, same semantic, same file.

Prior art exists and is correct: `App.jsx:50` declares `const DOTC = { amber:'#E3FF32', green:'#3FCF8E', grey:'#626B78', red:'#F05B54' }` and the activity feed passes *names*, resolving at render (`App.jsx:1362`, `App.jsx:1769`). Toasts bypass it.

## What to change

**A. Write `docs/DESIGN.md`.** Short enough to stay true. Required sections:
- The token table — every `--fg-*`, `--bg-*`, `--line-*`, `--accent-*`, `--ok/--warn/--danger` name introduced by 01, with hex and its one legal use. State that `#626B78` is retired as text (3.58:1 on ink) in favour of `#7B8797` (5.29:1).
- **Accent budget:** the accent marks *one* thing per view — primary action or current selection. Static section labels are not accent (`Story.jsx:509`, `AssetBoards.jsx:336`, `References.jsx:99`, `App.jsx:2181`).
- **Semantic color is not accent:** ok/warn/danger are a separate axis and never borrow `--accent`.
- **State reads as form, not only color:** pill/chip/stripe, so status survives a greyscale screenshot.
- **Interactive things look interactive**, each with a visible `:focus-visible` ring. The stylesheet currently has zero `:focus` rules. No new `outline:none` without a replacement ring.
- The closed scale ladders: type sizes, radii, spacing.
- "How to add a token": edit `styles.css` `:root` and this file in the same commit, never a raw hex in a `.jsx`.

**B. Repoint the two citations.** `styles.css:1` keeps `binding`, now pointing at a file that exists. `Story.jsx:906` drops the parenthetical authority claim to a plain `see docs/DESIGN.md`.

**C. Rename the hover classes** in `styles.css:21–36` and all 33 consuming files: `hAmber→hAccent`, `hBtnAmber→hBtnAccent`, `hBdAmber→hBdAccent`, `hBdAmberChip→hBdAccentChip`, `hBgAmber→hBgAccent`. Replace longest-name-first (`hBdAmberChip` before `hBdAmber`) or the chip class gets mangled.

**D. Change the toast signature** to `showToast(message, intent, undoFn)` with `intent ∈ 'info'|'ok'|'warn'|'danger'` (default `'info'`). Resolve to a color at `App.jsx:2970` through a `DOTC`-style map reading the 01 tokens. Migrate: `#F05B54`/`RED`/`DANGER`/`#FF7A7A`→`danger`, `#3FCF8E`/`GREEN`→`ok`, `#E3FF32`/`AMBER`→`info`, `#9AA3AF`/`#626B78`/`#C9CFD8`→`info`. Ternaries like `r.ok ? '#3FCF8E' : '#F05B54'` become `r.ok ? 'ok' : 'danger'`. Nothing maps to `warn` today — declare it anyway; it is the missing rung.

Fall back to `info` on an unrecognised intent rather than painting the string, so a missed call site degrades instead of reintroducing a raw color.

## Acceptance criteria

- `ls docs/DESIGN.md` succeeds. Every hex in it appears in `styles.css` `:root`: `rg -o '#[0-9A-Fa-f]{6}' docs/DESIGN.md | sort -u` is a subset of the same extraction over the `:root` block.
- `rg -n --text 'docs/DESIGN.md' frontend/` still returns exactly two hits (`styles.css:1`, `Story.jsx:906`), now pointing at a real file.
- `rg -o --text 'hAmber|hBtnAmber|hBdAmberChip|hBdAmber|hBgAmber' frontend/ | wc -l` → **0** (was 151 across 33 files).
- `rg -o --text 'hAccent|hBtnAccent|hBdAccentChip|hBdAccent|hBgAccent' frontend/ | wc -l` → **151**.
- `rg -o --text "showToast\([^)]*'#[0-9A-Fa-f]{3,8}'" frontend/ | wc -l` → **0** (was 201).
- `rg --text 'FF7A7A' frontend/ | wc -l` → **0**.
- `rg -il --text accent frontend/ | wc -l` ≥ 33 (was 18) — grepping the accent now finds the hover surface.
- `node --test tests/` with `FRFG_DATA` on a temp dir — **175 passing**, no regressions.
- Visual: with the backend stopped, click "Save learnings" (`Chat.jsx:589`) to fire the `Chat.jsx:284` error path; then run it against a live backend for the success path (`Chat.jsx:283`). Both dots match every other error/success toast in the app.

## Notes

- Do **not** collapse the 25 per-file `const AMBER/GREEN/RED/DANGER` declarations here — they belong to the dedup pass. This ticket only stops them reaching `showToast`.
- `DOTC` (`App.jsx:50`) keeps its `amber|green|grey|red` keys: that vocabulary comes from stored event records, so renaming is a data migration and out of scope. Note the divergence in `docs/DESIGN.md` so the next reader does not "fix" it.
- Add a `CLAUDE.md` source-of-truth row in the same commit: **Design tokens, accent budget, focus rules → `docs/DESIGN.md` + `frontend/styles.css` `:root`**.
