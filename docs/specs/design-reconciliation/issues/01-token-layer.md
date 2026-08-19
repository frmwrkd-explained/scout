# 01 — Token layer — `:root` custom properties + `tokens.js`

**Status:** resolved 2026-07-20 — full `:root` token set shipped with the "location scout" palette (`frontend/styles.css`), `frontend/tokens.js` mirror for JS sinks, parity guard `tests/phase-design-tokens.test.mjs`, and all frontend literals migrated to `var(--x)`.
**Blocked by:** None — can start immediately.

## Problem

There is nowhere in FrameForge a design decision can be made once.

`frontend/styles.css:1-7` opens with a design-system header closing "Anything not in this table does not ship." It lists ~17 values. The frontend ships **3828 hex literals across 66 distinct colors** (`grep -hoa '#[0-9A-Fa-f]\{6\}' frontend/*.jsx frontend/*.js frontend/*.css frontend/chat/*.jsx | tr a-f A-F | sort -u | wc -l`). The header is a comment, so nothing enforces it, and it cites `docs/DESIGN.md` as binding — **that file does not exist**. `frontend/Story.jsx:906` cites it too, inside render code, as live authority.

With no module to import, values are re-declared by hand:

- `const MONO = "'Spline Sans Mono',monospace"` in **41 files** (`App.jsx:49`, `Chat.jsx:31`, `Story.jsx:13`, `chat/cards.jsx:19` … `chat/toolRegistry.jsx:26`).
- **27 color constants across 14 files**, two names for one value: `ACCENT` (`ThreeDStage.jsx:41`, `VoiceInput.jsx:12`) vs `AMBER` (`StyleLocks.jsx:8`, `StyleLab.jsx:35`, `PromptBuilder.jsx:18`, `CallSheet.jsx:8`, +8) — all `#E3FF32`. Likewise `RED` (`VoiceInput.jsx:11`, `CallSheet.jsx:10`) vs `DANGER` (`StyleLocks.jsx:10`, `StyleLab.jsx:37`) — both `#F05B54`.
- The batch-status map is duplicated **and divergent**: `App.jsx:2313` has 7 keys; `App.jsx:2922` has 4 and disagrees — `queued` is `#626B78` there, `#E3FF32` at :2313. One word, two colors, one file.

Near-twins have accumulated behind the duplication: `#3A3F49` (95) vs `#3A3F48` (1) and `#3A404A` (1); `#14161B` (44) vs `#14161A` (1) and `#13151B` (1, `styles.css:47`); `#0B0C0E` (15) vs `#0B0C0F` (9); `#16181D` (38) vs `#16181C` (1); `#22252C` (168) vs `#22262E` (2). The accent runs **23 distinct alpha levels** (`.03 … .75`) plus a terminal `0` in the `dl-ring` keyframe.

The unlock: `frontend/sx.js` splits on `:` and passes the right-hand side through **untouched**, so `sx('color:var(--fg-faint)')` works today with zero changes to `sx.js`.

## What to change

**1. `frontend/styles.css` — replace the prose header (lines 1-7) with a `:root` block, one declaration per line.** No value invented; each is an existing literal unless marked:

- surfaces: `--ink #0D0E11` · `--surface #101115` · `--surface-2 #14161B` · `--raise #1C1F26` · `--sunk #0A0B0E` · `--void #0B0C0E`
- lines: `--line #1B1E24` · `--border #22252C` · `--border-2 #2A2E36` · `--border-3 #3A3F49`
- text: `--fg #ECEEF2` · `--fg-soft #C9CFD8` · `--fg-muted #9AA3AF` · `--fg-faint #7B8797` **(changed from `#626B78`)**
- signals: `--accent #E3FF32` · `--accent-hover #EEFF66` · `--on-accent #141519` · `--ok #3FCF8E` · `--warn #F0A34A` · `--danger #F05B54`
- accent alphas, four buckets replacing 23: `--accent-a1 rgba(227,255,50,.06)` (was .03–.08) · `--accent-a2 rgba(227,255,50,.15)` (.10–.22) · `--accent-a3 rgba(227,255,50,.3)` (.25–.35) · `--accent-a4 rgba(227,255,50,.6)` (.4–.75)
- `--mono "'Spline Sans Mono',monospace"`

`--fg-faint` carries the corrected value from day one: `#7B8797` measures 5.29:1 on ink and 4.52:1 on raise, clearing AA on both; `#626B78` measures 3.58:1 / 3.06:1 and none of its 674 uses reach the 18.66px AA-Large exemption. **`styles.css` contains zero rule-level `#626B78`** (the sole occurrence is the header comment being deleted), so declaring the new value here changes nothing on screen. Sweeping the 674 `.jsx` literals is the contrast ticket's job.

**2. Rewrite `styles.css` body (lines 8-101) onto the vars.** Every 6-digit hex becomes `var(--x)` — `html,body` (:8), `a`/`a:hover` (:10-11), the 24 `.h*:hover` rules, `.ctxTile`, `.mTile`, `.mdBody`, `.chatCaret` (:98). Keep every `!important`. `.mdBody code` (:83) takes `var(--mono)`. Fold three orphans: `#272B33` (`.hBgEsc:hover`, :45) → `var(--raise)`, `#2E333C` (`.mTile:hover`, :64) → `var(--border-3)`, `#13151B` (`.hCard:hover`, :47) → `var(--surface-2)`. `--accent-a4` is set to `.6` precisely so `.hBdAmber` (:26) is unchanged. Non-accent `rgba()` scrims and shadows (`rgba(5,6,8,.88)`, `rgba(0,0,0,.55)`, the danger/ok tints) stay literal — out of scope.

**3. Create `frontend/tokens.js`** — plain ESM, one exported `T` object plus named exports, mirroring the `:root` names in camelCase (`T.accent`, `T.fgFaint`, `T.mono`, `T.accentA1`). For sinks where `var()` cannot resolve: `ThreeDStage.jsx` Three.js materials, the `stC[status]` lookups, the 199 `showToast(msg,'#…')` call sites. Also export one `STATUS` map reconciling `App.jsx:2313` and `:2922` — union of both key sets, one color per state: `draft/cancelled → fgFaint`, `queued → fgMuted`, `running → accent`, `paused → warn`, `done → ok`, `failed → danger`. Both sites import it; `queued` stops being two colors.

**4. Repoint the 68 local redeclarations.** Delete all 41 `const MONO` and all 27 `ACCENT/AMBER/GREEN/RED/DANGER` lines; import from `./tokens.js` (`../tokens.js` under `chat/`). Alias at the import to keep diffs to one line: `import { accent as AMBER } from '../tokens.js'`. Call sites untouched.

**5. Delete the `docs/DESIGN.md` citations** at `styles.css:1` and `Story.jsx:906`; point both at `frontend/styles.css` `:root`. Add the token layer to the source-of-truth table in `CLAUDE.md`.

**6. Collapse the 7 near-twins** listed above to their canonical token — 16 sites total.

## Acceptance criteria

- `grep -a 'const MONO' frontend/*.jsx frontend/*.js frontend/chat/*.jsx` returns nothing (was 41).
- `grep -an '^const \(ACCENT\|AMBER\|GREEN\|RED\|DANGER\) *=' frontend/*.jsx frontend/chat/*.jsx` returns nothing (was 27).
- `grep -an '#[0-9A-Fa-f]\{6\}\|rgba(227,255,50' frontend/styles.css | grep -v ': *--'` returns nothing — every color literal in the file sits on a `--token` declaration line.
- `grep -ac 'stC = {' frontend/App.jsx` returns `0`; both former sites import `STATUS` from `tokens.js`.
- `grep -ran 'DESIGN.md' frontend/ docs/` returns nothing (was 2).
- `#3A3F48`, `#3A404A`, `#14161A`, `#13151B`, `#0B0C0F`, `#16181C`, `#22262E` each return 0 hits across `frontend/`.
- `node --test tests/` passes (27 files, 139 tests, `FRFG_DATA` on a temp dir).
- `npm run dev` + `npm run server`: the app renders unchanged except three named folds — escape-button hover (`#272B33` → `#1C1F26`), mood-tile hover border (`#2E333C` → `#3A3F49`), card hover bg (`#13151B` → `#14161B`). No other pixel moves; `#626B78` is untouched by this ticket.

## Notes

No `sx.js` change is needed and none should be made — it already passes `var(--x)` through verbatim. That is why this migration is cheap.

Scope: this ticket establishes the layer and migrates `styles.css` + the 68 constant declarations. It deliberately does **not** touch the ~3800 inline hex literals in `.jsx`, nor the 23→4 accent-alpha collapse outside `styles.css` — those are per-surface migrations for later tickets, mechanical once the names exist. `#5A6472` (16 uses) is left alone; it needs a contrast call, not a rename.

`ThreeDStage.jsx:44` `PROP_COLOR = 0x8E97A5` is a Three.js numeric with no CSS equivalent and no second use. Leave it local.

Naming: `AMBER` is the incumbent (12 sites vs 2 for `ACCENT`) but the color is chartreuse. `tokens.js` exports `accent`; aliasing at the import keeps this diff small, and a later ticket can rename call sites.
