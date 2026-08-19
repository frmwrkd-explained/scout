# 03 — Extract <Composer> from ProjectGenerate as canonical

**Status:** shipped — `frontend/Composer.jsx` is the app's one composer, imported by
Chat, ProjectGenerate, ShotWorkspace, Story, AssetBoards, App and chat/shotBoardCard.
ProjectGenerate's `renderPillRow`/`popoverShell`/`popHead`/`popChip`/`popInput`/
`generateButton` are all gone. Re-verified 2026-08-02.
One acceptance criterion is NOT met and was never met: `wc -l ProjectGenerate.jsx` is
1312, not the "< 1100" this ticket asked for. The extraction happened; the slimming did
not go as far as planned. Not a reason to redo the ticket.
**Blocked by:** 02 — the prop contract must be settled before the extraction target exists.

## Problem

`frontend/ProjectGenerate.jsx` is 1402 lines, of which roughly 330 are the composer:
`renderComposer()` (`:811–940`), `renderPillRow()` (`:946–978`), `generateButton()` (`:985–999`),
`pill()`/`popoverShell()` (`:1014–1045`), the popover atoms `popHead`/`popChip`/`popInput`
(`:1046–1062`), and the four popover bodies (`:1068–1148`).

It is the only surface already importing the shared controls — `ModelPicker`, `FormatControls`,
`ASPECTS`, `modelName` (`:47`) and `SchemaForm` (`:48`) — and the only one whose payload builders
send `params` (`paramsField()` `:226–234`, consumed at `:493` and `:501`). It is therefore the
incumbent, and every behaviour ticket 02 names as "genuine, keep" already lives here:
`billModel()` (`:219–222`), `needsRefFrame()`/`blockReason()` (`:245–257`), the `CONFIRM_SPEND`
arming (`:55`, `:444–452`), and the `joinFragment` composition (`:404–417`).

While it stays inline, tickets 04+ have nothing to migrate `ManualComposer` and `ShotWorkspace`
onto. This ticket creates the target and nothing else.

## What to change

Create `frontend/Composer.jsx`, default-exporting `Composer` at `density="full"`, and reduce
`ProjectGenerate.renderComposer()` to one `<Composer …/>` element.

**Moves into Composer** — media switch (`:838–848`), prompt block (`SnippetText` + `VoiceInput`,
`:851–880`), reference row + pool strip + drag well (`:822–831`, `:887–935`), the whole pill row
and all four popovers, the cost readout (`:969–974`), `generateButton()`, plus `paramsField()`,
`needsRefFrame()`, `blockReason()`, `billModel()` and the `isFal`/`isLookEmpty` helpers they need.
The `ModelPicker` / `FormatControls` / `SchemaForm` / `ASPECTS` imports move with them.

**Stays in ProjectGenerate** — `submit()`/`go()`/`queueBatch()` (Composer owns zero I/O, per 02 §7),
`armSpend`/`disarmSpend`, `composed()`/`suffix()`, `syncLock()`, the `StyleLab` overlay (`:743–749`),
`enhance()`/`undoEnhance()`, `loadGhost()`, `onKey()` and the entire results/preview/zoom half.

**State shape.** Adopt 02's nested value. `aspect`, `resolution`, `seed` collapse into
`S.format = { aspect, resolution, seed }`, which is what `FormatControls` already wants — this
deletes the adapter at `:1097–1100`. Update the three readers: `queueBatch()` `:466–467`,
`go()` `:487–488`, and the FORMAT pill's `set` predicate `:963`.

**Three seams that must be props, not internal state, or behaviour changes:**

1. `popover` stays owned by ProjectGenerate and is passed as `popover` + `onPopoverChange`.
   `onKey()` `:668–672` reads `this.state.popover` to make Esc close a popover instead of firing
   the review keymap, and `applyStudio`/`s`/`c` (`:713–714`) clear it. Making it Composer-internal
   silently breaks all three.
2. `disarmSpend()` fires today on prompt edit (`:872`), pill toggle (`:1023`), batch chip (`:1113`)
   and `applyStudio` (`:757`). Reproduce by calling it once from ProjectGenerate's `onChange` and
   `onPopoverChange` handlers — do not scatter a callback through Composer.
3. Style and camera are pills whose bodies live in an App-level overlay. Pass
   `onOpenStyle` / `onOpenCamera` and the already-computed `styleLabel`/`cameraLabel` strings;
   Composer must not import `lookBuilder` or `StyleLab`.

`refsOpen` and `dragOver` are read nowhere outside the composer — move them into Composer's own
state. The ITERATE ghost band (`:867–873`) and the enhance/undo row (`:852–858`) render through the
`extras` slot, since 02 scopes both as surface-specific.

## Acceptance criteria

- `frontend/Composer.jsx` exists and `grep -c "api\." frontend/Composer.jsx` → `0`.
- `grep -nE "renderPillRow|popoverShell|popHead|popChip|popInput|generateButton" frontend/ProjectGenerate.jsx`
  → no hits.
- `grep -nE "ModelPicker|FormatControls|SchemaForm" frontend/ProjectGenerate.jsx` → no hits;
  the same grep against `frontend/Composer.jsx` finds all three.
- `wc -l frontend/ProjectGenerate.jsx` < 1100.
- `grep -n "S.aspect\|state.aspect\|S.resolution\|S.seed" frontend/ProjectGenerate.jsx` → no hits
  (all reads now go through `S.format`).
- `node --test tests/*.test.mjs` is green (the bare-`tests/` form collects AppleDouble junk).
- `git diff --stat package.json package-lock.json` is empty — no new dependency, no build change.
- Behaviour parity, checked by hand on `npm run dev` + `npm run server`: IMAGE/VIDEO switch
  re-routes the model list and cost; `⌘⏎` and the button queue identically; `⌥2/⌥4/⌥8` set the
  batch and toast the estimate; a >$1.00 estimate arms the button red and commits on the second
  press; a pill→pill click costs one click; Esc closes an open popover without firing the review
  keymap; dragging a result onto the composer paints the neon well and attaches it; an
  image-to-video model with no ref shows the `⚠` line and flattens Generate.
- A single generate and a 4× batch from identical settings still produce byte-identical composed
  prompts (`styleLockFragment: ''` on both paths — `:473`, `:497`).

## Notes

Pure refactor. If any pixel or keystroke changes, the ticket is wrong — the Generate page is the
reference implementation every other surface will be measured against in 04+.

`Chip` and `Head` are deliberately **not** deduplicated here. `popChip` (`:1048`, radius 6px) and
`popHead` (`:1046`) move into `Composer.jsx` as-is; collapsing them against
`GenerationControls.jsx:31/35`, `SchemaForm.jsx:38/44` and `ManualComposer.jsx:68/72` is the
primitives ticket's job. Note that the primitives ticket cited in the brief
(`docs/specs/design-reconciliation/`) is **not on `main`** — `docs/specs/` holds only
`filmmaker-chat/` and `source-of-truth-reconciliation/`. Do not import from `frontend/ui.jsx`; it
does not exist yet. Hex literals stay literal in this ticket and get tokenised when that layer lands.

`ShotWorkspace.jsx` and `chat/ManualComposer.jsx` are untouched. They still hold their own
`ASPECTS` (`ShotWorkspace.jsx:16`), their own model pickers and their own variant vocabulary until
their migration tickets.
