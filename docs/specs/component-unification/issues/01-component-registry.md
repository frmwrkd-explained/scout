# 01 — docs/COMPONENTS.md — the canonical component registry

**Status:** shipped — `docs/COMPONENTS.md` exists and `CLAUDE.md` links it.
Re-verified 2026-08-02. NOTE: the registry it produced has itself gone stale (it still
describes `chat/ManualComposer.jsx`, which was deleted). Read COMPONENTS.md's own banner.
**Blocked by:** None — can start immediately.

## Problem

`CLAUDE.md:160` says: *"Grep for the concept before implementing it. If a second
implementation already exists, reconcile to the canonical file above — do not add a
third."* The rule is unfollowable as written. "The canonical file above" is the
source-of-truth table at `CLAUDE.md:49-59` — eleven rows, **all data/model/backend
concerns**. Not one row names a UI component. An agent asked to build a composer has
nothing to reconcile *to*.

The result is measurable. `frontend/GenerationControls.jsx` has exported
`ModelPicker` (`:54`), `FormatControls` (`:103`), `ASPECTS` (`:24`) and `modelName`
(`:28`) since filmmaker-chat ticket 03 shipped — and has **three** importers total
(`ProjectGenerate.jsx:47`, `PromptBuilder.jsx:11`, `SchemaForm.jsx:24`). Meanwhile
`ShotWorkspace.jsx:16` carries a byte-identical copy of the `ASPECTS` array, and
`ShotWorkspace.jsx:358-364` and `chat/ManualComposer.jsx:209-241` each hand-roll a
model picker. `ManualComposer.jsx:21-22` documents *why* it forked — `ModelPicker`'s
`video` prop is boolean-only — which is exactly the kind of known-gap note that
belongs in a registry and currently only exists as a code comment nobody greps.

Contrast `RenderMedia.jsx`: 10 importers, near-total adoption. The difference is not
quality. It is that ticket 02 of filmmaker-chat explicitly enumerated its adopters,
and nothing ever did that for `GenerationControls`.

## What to change

Create `docs/COMPONENTS.md`. One row per **component family** — a concept that has or
should have exactly one implementation. Columns:

| Concept | Canonical file + export | Density variants | Adopters | Known rogue impls |

Seed it from the census. Minimum rows, each with a verified `file:line`:

- **Media playback / tile / lightbox** — `frontend/RenderMedia.jsx` `mediaKind`/
  `RenderMedia`/`RenderTile`/`RenderLightbox` (`:27,:38,:86,:118`). 10 adopters.
  Rogue: three private video regexes (`ProjectGenerate.jsx:1297`, `ShotWorkspace.jsx:69`,
  `ReviewInbox.jsx:18`) and `ReviewInbox.jsx:101-102`'s hand-rolled `<video>`/`<img>`.
- **Model picking** — `GenerationControls.jsx:54` `ModelPicker`. 2 adopters.
  Rogue: `ManualComposer.jsx:209-241`, `ShotWorkspace.jsx:358-364`, `App.jsx:1692`.
  Known gap: no `kinds` prop, so audio kinds cannot be expressed.
- **Model label** — `GenerationControls.jsx:28` `modelName`. Rogue: `confirmCard.jsx:27`,
  `ManualComposer.jsx:195`/`:216`, `ShotWorkspace.jsx:361`, `App.jsx:2045`.
- **Aspect vocabulary** — `GenerationControls.jsx:24` `ASPECTS`; pixel math is
  `modelCatalog.js:157` `ASPECT_NUM` + `pixelSize()` (`:161`). Rogue: `ShotWorkspace.jsx:16`.
  Not rogue: `lookBuilder.js:60` `ASPECT_MAP` (axis-name→aspect, different concern).
- **Format / resolution / seed / variants** — `GenerationControls.jsx:103`
  `FormatControls`. Adopters: `ProjectGenerate.jsx:47`, `SchemaForm.jsx:24` (fallback path).
  Rogue variant rows: `ProjectGenerate.jsx:1109`, `ManualComposer.jsx:304`,
  `ShotWorkspace.jsx:369`.
- **Spec-driven model settings** — `frontend/SchemaForm.jsx:203`. 2 adopters
  (`ProjectGenerate.jsx:48`, `ManualComposer.jsx:29`). Note `onSchema` (`:203`) has
  zero callers.
- **Locked-context rail** — `frontend/ProductionPanel.jsx:310-314`. 1 adopter (chat).
- **Composer**, **ResultCard**, **ReviewActions**, **cost formatting**, **generation
  status map** — rows with canonical file `— none yet, see ticket NN`. A registry that
  only lists what exists cannot stop the next fork; the empty rows are the point.

Rules to state in the file header:

1. A row's canonical file is authoritative. Adding a second implementation of a listed
   concept is a defect, not a style choice.
2. A justified fork gets recorded in **Known rogue impls** with the reason and a
   ticket reference — never left as a code comment alone.
3. When you adopt or delete a rogue impl, update its row in the same commit.
4. Counts are `Last reconciled: YYYY-MM-DD` stamped, per the `ISSUES.md` convention
   (`CLAUDE.md:151-158`). Treat a stale stamp as unverified.

Then add one row to the `CLAUDE.md` source-of-truth table (`:49-59`):

```
| UI component families | `docs/COMPONENTS.md` | One row per concept: canonical export, density variants, adopters, known rogue impls. Rule 160 means *this* table for anything under `frontend/`. |
```

## Acceptance criteria

- `docs/COMPONENTS.md` exists and contains ≥ 12 rows.
- Every non-empty canonical cell resolves: `rg -n --text '^export' frontend/<file>`
  shows the named export at the cited line.
- Every cited `file:line` in the Known-rogue column is checked by hand before commit;
  no line number is carried over from this ticket without re-verification.
- `grep -n 'docs/COMPONENTS.md' CLAUDE.md` returns a hit inside the table at `:49-59`.
- `rg -n --text "ASPECTS" frontend/ShotWorkspace.jsx` still returns `:16` — this ticket
  documents the rogue impl, it does not fix it. Fixing is a later ticket.
- The file carries a `Last reconciled: 2026-07-19` line.

## Notes

**Boundary with `reconcile/design-system`.** That branch is real but **unmerged** —
`git ls-tree -r reconcile/design-system --name-only` shows
`docs/specs/design-reconciliation/issues/01-token-layer.md` … `10-design-doc-and-naming.md`
plus `docs/DESIGN.md`, none of which exist on `main`. Two of the five censuses concluded
the spec does not exist because they checked the working tree. `docs/COMPONENTS.md`
covers **feature-level** components; `design-reconciliation/issues/05-ui-primitives.md`
covers **primitives** (Btn/Card/Eyebrow/Empty/Field) and `10-design-doc-and-naming.md`
owns `docs/DESIGN.md`. Two docs, two altitudes — state that split in the header so
nobody merges them. If `reconcile/design-system` lands first, add a "composes primitive"
column rather than restating primitive names.

`Chip` is the one contested atom: defined at `GenerationControls.jsx:35`,
`SchemaForm.jsx:44`, `ManualComposer.jsx:68` (radius 6px/6px/7px), and as a method at
`ProjectGenerate.popChip:1048`. Ticket 05 on that branch does not list it. Give it a row
here with an explicit note that ownership is unresolved — do not let both efforts ship one.

This ticket is documentation only. It changes no `.jsx`. Its value is that every
subsequent ticket in this effort can say "add a row" instead of re-arguing where
canonical lives.
