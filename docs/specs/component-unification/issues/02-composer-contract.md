# 02 — The `<Composer>` contract — one component, three densities

**Status:** SUPERSEDED — do not implement. `frontend/Composer.jsx` exists and its header
says so explicitly: the shipped design is ZERO variants, not "one component, three
densities (console|panel|bar)". There is no `DENSITIES` export and there must not be one.
Re-verified 2026-08-02. Kept for the prop-contract reasoning only.
**Blocked by:** None — can start immediately. Ships a doc + a stub; no surface migrates here.

## Problem

One operation — *generate media with a model, prompt, refs, format, batch* — has three
implementations that share no code and no vocabulary:

| | `ProjectGenerate.jsx` | `chat/ManualComposer.jsx` | `ShotWorkspace.jsx` |
|---|---|---|---|
| batch state key | `variantCount` | `variantCount` (`:84`) | **`variants`** (`:37`) |
| batch label | `'BATCH'` (`:964`) | `VARIANTS` (`:51`) | unlabelled `×n` (`:370`) |
| batch options | `[1,2,4,8]` (`:1111`) | `[1,2,4]` (`:51`) | `[1,2,4]` (`:370`) |
| model UI | shared `ModelPicker` (`:47`) | hand-rolled popover (`:209-241`) | native `<select>` (`:358-364`) |
| aspect source | `ASPECTS` imported | via `SchemaForm`→`FormatControls` | **local copy** `ShotWorkspace.jsx:16` |
| resolution / seed | yes / yes | yes / yes | **neither** |
| cost | `$0.000` + spend arming | `est $x.xx` | **none** |
| style join | `joinFragment` | `joinFragment` (`:169`) | **`prompt + ', ' + fragment`** (`:149`) |

`frontend/ShotWorkspace.jsx:16` is a byte-identical copy of `frontend/GenerationControls.jsx:24`.
`paramsField()` is duplicated verbatim (`ProjectGenerate.jsx:226-234` ≡ `ManualComposer.jsx:132-140`),
as is `needsRefFrame()` (`:245-248` ≡ `:145-149`). Three composers, two state shapes (flat vs
nested `format`), and a live join-grammar defect in the third.

## What to change

Write **`docs/COMPONENTS.md`** (does not exist yet) with a `## <Composer>` section, and add
**`frontend/Composer.jsx`** as a stub that exports the signature and throws on render.
No surface migrates in this ticket.

**Densities — named, and all three stay dense.** Never propose more spacing.

| density | consumer | shape | hard constraint |
|---|---|---|---|
| `full` | ProjectGenerate | prompt + horizontal pill row → popovers | — |
| `panel` | ManualComposer | vertical labelled sections, inline | — |
| `bar` | ShotWorkspace | one wrapping row, popovers open **upward** | must stay ≤2 rows; `:309` is `flex:none` above a `flex:1` stage — growth shrinks the image under review |

`bar` is `full` with `show.style/camera/seed/maxSpend = false` and `bottom:100%` popovers —
the mechanism already exists at `ManualComposer.jsx:221`.

**Vocabulary — decided once, no per-surface variance:**
- The word is **VARIANTS**. `BATCH` is a lie at 1×. Delete `'BATCH'` (`ProjectGenerate.jsx:964`).
- The state key is **`variantCount`**. `ShotWorkspace`'s `variants` is renamed.
- Chip label renders `n + '×'` (`4×`), matching `GenerationControls.jsx:144`. `ShotWorkspace`'s
  `×n` order is dropped.
- Options come from one `variantOptions` prop; the literal `[1,2,4]` disappears from both files.

**Value shape — adopt ManualComposer's nested `format`** (`ManualComposer.jsx:86`), because it
already matches `FormatControls`' contract; ProjectGenerate's flat shape needs an adapter at
`:1097-1100` today. Document:

```
value = { outKind, model, prompt, refs[], format:{aspect,resolution,seed,duration},
          variantCount, maxSpend, modelParams, style, camera }
```

**Props to document:** `density`, `value`, `onChange(next)`, `onSubmit(value)`, `settings`,
`outKinds[]`, `defaultModel`, `variantOptions`, `show{}`, `refsMode:'internal'|'external'`,
`refPool`, `getExternalRefs`, `maxRefs`, `locks[]`, `onToggleLock`, `targetShot`,
`onTargetShotChange`, `busy`, `submitLabel`, `extras`.

**Moves inside the component** (record in COMPONENTS.md as owned, not passed): `paramsField`,
`needsRefFrame`/`blockReason`, `joinFragment` composition, `ASPECTS`, `Chip`, `Head`.

**Stays surface-specific — document why, so nobody "unifies" it later:**
1. `bar`'s one-row constraint and `promptBig` focus-grow (`ShotWorkspace.jsx:316`).
2. ManualComposer's 5 output kinds incl. audio (`:43-49`) — needs a `kinds` array on
   `ModelPicker`; the existing `video` boolean (`GenerationControls.jsx:54`) cannot express it.
3. `refsMode="external"` for chat — the attachment tray is Chat's, not the composer's.
4. ShotWorkspace seeding refs from `sh.cast`/`sh.loc` (`:27-30`) and patching the shot (`:153-155`).
5. ProjectGenerate's spend arming — ship as `confirmAbove`, default off.
6. **Zero I/O.** `<Composer>` emits `onSubmit(value)`; the surface owns the API call. Same
   discipline `GenerationControls.jsx:6-10` already states, and the reason those two are reusable.

## Acceptance criteria

- [ ] `docs/COMPONENTS.md` exists and contains a `## <Composer>` heading, the density table
      (`full` / `panel` / `bar`), the full prop list above, and a "stays surface-specific" list
      with a file:line for each of the 6 items.
- [ ] `frontend/Composer.jsx` exists, exports `Composer` and `DENSITIES = ['full','panel','bar']`,
      and its render throws `new Error('Composer: contract stub — see docs/COMPONENTS.md')`.
- [ ] `grep -c "BATCH" docs/COMPONENTS.md` → the word appears only in the rejected-vocabulary note.
- [ ] `grep -n "variants\b" docs/COMPONENTS.md` → zero hits outside the rename note; the
      documented key is `variantCount` everywhere.
- [ ] `node --test tests/*.test.mjs` still green (194/194). The stub has no importer, so nothing
      can regress; run it anyway to prove the file parses under the app's import graph.
- [ ] No surface file is modified. `git diff --name-only` lists exactly two paths.

## Notes

- **Sequencing vs `reconcile/design-system`.** That branch exists but is **not merged into `main`**
  (`git branch -a`). Its `issues/05-ui-primitives.md` owns `Btn/Card/Eyebrow/Empty/Field`.
  `<Composer>`'s Generate button should *be* `<Btn variant="primary">` and its eyebrows *be*
  `<Eyebrow>` — collapsing the four `Head` definitions (`GenerationControls.jsx:31`,
  `SchemaForm.jsx:38`, `ManualComposer.jsx:72`, `ProjectGenerate.popHead:1046`). **`Chip` is the
  one overlap ticket 05 does not cover** and this effort needs 3× over. Decide here: `Chip` is a
  primitive and belongs in ticket 05's `frontend/ui.jsx`. Say so in COMPONENTS.md so both tickets
  do not ship one.
- Because 05 is unmerged, this contract must be written in terms of primitive *names*, not hex
  literals — otherwise the implementation ticket hardcodes colors that ticket 01's token layer
  then has to unpick.
- `ShotWorkspace.jsx:149`'s `', '` join is a real defect already documented as avoided in the
  other two composers. It is not fixed here, but the contract must state that composition is the
  component's job so the fix lands once.
- Prerequisite for the *implementation* ticket, not this one: `ModelPicker` gains `kinds`.
  Without it ManualComposer cannot migrate, and any migration ticket written before it is
  unimplementable.
