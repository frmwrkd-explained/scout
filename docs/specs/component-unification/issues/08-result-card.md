# 08 — Canonical `<ResultCard>` + `<ReviewActions>`

**Status:** OPEN — genuinely not started. There is no `frontend/ResultCard.jsx` and no
`resultStatus`; the review-chip triads are still hand-rolled across surfaces while
`MediaAction` (`RenderMedia.jsx`) has only 3 adopters. Re-verified 2026-08-02.
**Blocked by:** 01 (tokens — see Notes)

## Problem

Five surfaces render a finished generation and let the user decide on it. Each re-invents the
status chrome, the verb set, the keybindings, and the media-kind test.

| Surface | file:line |
|---|---|
| Quick Generate results grid | `frontend/ProjectGenerate.jsx:1150–1308`, preview `:1311–1399`, zoom `:758–801` |
| Shot take strip + stage | `frontend/ShotWorkspace.jsx:266–294`, `:405–455` |
| Review Inbox | `frontend/ReviewInbox.jsx:88–115` |
| Chat generation cards (single/batch) | `frontend/chat/generationCards.jsx:107–145`, `:194–402` |
| App.jsx review verbs (host) | `frontend/App.jsx:946–1015`, keymap `:1109–1146` |

Duplication measured (not the brief's loose 32-file grep): **5 files issue review writes**,
**7 files read decision state**. The verb→API mapping is written four times —
`ProjectGenerate.jsx:542–564`, `ShotWorkspace.jsx:126–186`, `App.jsx:946–1015`,
`generationCards.jsx:71–83` — and they disagree (`ShotWorkspace:173` always uses
`api.saveGenToShot`; `generationCards:253` never does; `ProjectGenerate:548` branches on
`g.shot`).

Three media-kind oracles exist while `RenderMedia.jsx:27` exports `mediaKind()` and its own
comment (`:22–24`) says "Keep this the SINGLE kind oracle": `ProjectGenerate.jsx:351,760,1297,1313`
use `/\.mp4$/` — **no `i` flag**, so a `.MP4`, `.mov` or `.webm` result renders as a broken
`<img>`; `ShotWorkspace.jsx:69` uses `/\.(mp4|mov|webm)$/i`; `ReviewInbox.jsx:18` uses
`/\.mp4$/i` and does not import `RenderMedia` at all.

## What to change

**1. `frontend/ResultCard.jsx`** — one component, three densities mapped onto the existing
geometries (nothing becomes more spacious): `strip` (118×66, ShotWorkspace filmstrip),
`grid` (180px min in ProjectGenerate, 120px in chat's narrower column — same component),
`stage` (full-viewport, ReviewInbox + ShotWorkspace stage).

```jsx
<ResultCard gen shot density="strip|grid|stage" selected marked
            actions={[…]} onAction={(verb, gen) => …} slots={{ overlay, footer }} />
```

Built on `RenderTile`/`RenderMedia`/`RenderLightbox` (`RenderMedia.jsx:38,86,118`) — they already
take slots and have 11 importers. `ResultCard` supplies the *status chrome* those slots currently
receive hand-rolled from five places. It owns no I/O.

**2. `resultStatus(gen, shot)` → `{ key, label, tone }`** — one function replacing
`ProjectGenerate.reviewBadge:75–80`, `ShotWorkspace.takes().kept/hero:80`,
`ReviewInbox:106–111`, `generationCards:109–110`. Keys:
`pending|queued|running|failed|needs-review|kept|selected|final|killed`.

**3. `frontend/ReviewActions.jsx`** — one verb vocabulary, one keymap:
`KEEP · KILL · FINAL · REROLL · RATE(n) · USE_AS_REF · ZOOM · ROUTE · NOTE · REVEAL · DELETE`.
Labels are fixed by the verb, not the surface. Every binding resolves through `keymap.js` +
`settings.keys` — `ProjectGenerate.jsx:710–716` and `ShotWorkspace.jsx:119–123` currently hardcode
`k`/`x`/`r`/`l`/`f` and ignore user overrides entirely, while `App.jsx:1134–1142` and ReviewInbox
honour them. Same letters, three capture-phase listeners.

**4. Delete the three regexes**; every surface calls `mediaKind()`.

## Divergences in MEANING — each needs a decision, not a rename

1. **`FINAL` means two different things.** `ProjectGenerate.jsx:77` reads `g.final`.
   `ShotWorkspace.jsx:80` defines `hero: sh.selectedCandidate === g.id` and labels it `FINAL`
   at `:286` and `FINAL ✓` at `:426`. Because `backend/generate.mjs:339` auto-promotes the
   *first kept* take to `selectedCandidate` when the shot has none, **the same take reads
   `KEPT ✓` in the results grid and `FINAL ✓` in the shot workspace at the same moment.**
   Proposed: name the third state `SELECTED` (`shot.selectedCandidate === gen.id && !gen.final`),
   reserve `FINAL ✓` for the explicit `gen.final` flag. Tones already exist: `#E3FF32` / `#3FCF8E`.
2. **Killed is destructive in one surface only.** `ShotWorkspace.takes():78` `continue`s on
   `reviewState === 'killed'` — the take vanishes from the strip with no undo. Everywhere else
   killed is a reversible, filterable badge (`ProjectGenerate:1197`; `generationCards:73`
   re-click un-decides). Decide: does the strip show killed takes dimmed, or keep hiding them?
3. **Rating silently implies keep.** `App.ibRate:974` and `generationCards.ratePatchFor:80–83`
   both send `reviewState: cur === 'new' ? 'kept' : cur`. `ProjectGenerate` cannot set a rating
   at all yet *filters* on one (`:1199`) — a filter over a value its own surface can never write.
4. **ReviewInbox badges session state, not record state.** `:91` reads `IB.decisions[key]`;
   only `cand.final` (`:111`) reads through to the record. A candidate killed in chat shows no
   badge in the inbox until re-decided there.
5. **`reviewState: 'pending'`** (`backend/generate.mjs:114`) is handled by no frontend surface —
   every `'new'` filter also requires `status === 'done'`. Fourth value, dead in the UI.
6. **Cost formatting drifts.** Only `generationCards.costLabel:55–59` distinguishes a ledgered
   cost from a `~$… est`; `ProjectGenerate:1291`, `ShotWorkspace:441`, `ReviewInbox:79` print
   `$0.000` for an unfinished generation.
7. **`Kill` vs `Reject`** — identical write, three labels. `keymap.js:20` says `kill`; retire `Reject`.

## Acceptance criteria

- `rg -n --text "\\\\.mp4\\\$" frontend/` → **0 hits** outside `RenderMedia.jsx`. (Baseline: 6.)
- `rg -n --text "reviewBadge|selectedCandidate === (g|gen)\.id|IB\.decisions\[" frontend/`
  → hits only in `ResultCard.jsx`/`resultStatus`. (Baseline: `ProjectGenerate:76`,
  `ShotWorkspace:80`, `ReviewInbox:91`.)
- `rg -n --text "'kept'|'killed'" frontend/ --files-with-matches` → at most
  `ResultCard.jsx`, `ReviewActions.jsx`, `App.jsx`. (Baseline: 7 files.)
- `rg -n --text "Reject" frontend/` → 0 hits.
- No literal `'k'`/`'x'`/`'r'`/`'l'` compared against `e.key` in `ProjectGenerate.jsx` or
  `ShotWorkspace.jsx`; both route through `keymap.js`.
- Behaviour: keep a take from the shot strip, then open the same generation in the results grid —
  **both read the same label.** Today one reads `FINAL ✓` and the other `KEPT ✓`.
- Behaviour: generate a `.webm` or `.mov` and confirm it plays in the results grid (today: broken image).
- `node --test tests/*.test.mjs` green. (Note: bare `node --test tests/` collects 19 AppleDouble
  phantoms and is red on a fresh checkout — use the glob.)

## Notes

- **Boundary with ticket 01 (tokens).** `<ResultCard>` must not hardcode `#3FCF8E`/`#F05B54`/
  `#E3FF32`; `resultStatus` returns a token name. That is the only reason this is blocked by 01 —
  building it first means minting hex literals in a new file that 01 then has to unpick.
- **Boundary with the primitives ticket.** The chip renderers
  (`ProjectGenerate:1153,1231,1314,762`, `generationCards:173`, `ShotWorkspace:445–449`) belong to
  the primitive layer. The *verb set and its meaning* belong here. `ReviewActions` composes `Btn`
  if it exists; it does not define one.
- **Boundary with ticket 07 (composer).** Re-roll is a review verb that emits a generation.
  `ReviewActions` fires `REROLL` and the surface calls the API — no composer coupling.
- **Not on `main`:** `docs/specs/design-reconciliation/` does not exist in this working tree
  (`docs/specs/` holds `filmmaker-chat/` and `source-of-truth-reconciliation/` only). If the
  primitives ticket is on an unmerged branch, sequence against it explicitly rather than assuming.
- After migration: ReviewInbox = `stage`, reads record state instead of `IB.decisions`;
  ShotWorkspace = `strip`+`stage`, stops hiding killed takes; ProjectGenerate = `grid`, gains
  `RATE` (closing the filter-without-writer gap at `:1199`) and `FINAL`; chat cards = `grid`,
  gain `FINAL`. `Open in review` / `Review these` stay navigation, not review.
