# 05 — Adopt \<Composer\> in ShotWorkspace (inline density)

**Status:** shipped — `ShotWorkspace.jsx` imports `Composer` and the bespoke docked bar
(raw `<select>` model picker, second `<select>` for aspect, hand-rolled ×N group) is gone;
a comment in the file records the removal. `variants` → 0 hits, `'2.39:1'` → 0 hits.
Re-verified 2026-08-02. The two remaining `<select>`s are the shot-draft form, which this
ticket explicitly allowed to keep them.
**Blocked by:** 03 — `<Composer>` must exist with the `bar` density and a `kinds`-capable `ModelPicker`.

## Problem

`frontend/ShotWorkspace.jsx` imports neither `GenerationControls` nor `SchemaForm` (`:7–13`). It hand-rolls the entire docked bar and is the only composer in the app with no adopted shared control:

- `:16` — `const ASPECTS = ['16:9','2.39:1','9:16','1:1','4:5']` is a **byte-identical copy** of `frontend/GenerationControls.jsx:24`.
- `:357–364` — a native `<select>` + `<optgroup>` over `enabledCatalog(...)`, re-deriving the label via `m.id.split('/').pop()` instead of `modelName`. No cost, no provider, no note.
- `:365–368` — a native `<select>` over the duplicated `ASPECTS`.
- `:369–374` — `[1,2,4]` rendered `×1/×2/×4`, on state key **`variants`**, a third name and a third token order for what `FormatControls` calls `VARIANTS` / `variantCount` / `n×`.
- **No resolution, no seed, no cost.** `seed: null` is hardcoded at `:145` and `:150`; `estCost` is never imported. A take generated here cannot be reproduced or matched against one from Quick Generate, and the user queues up to 3 renders with no price shown.
- **A live defect:** `:149` composes `prompt + ', ' + lock.fragment` (raw comma join) for the single path while `:145` sends `styleLockFragment` for the batch path. Single and batch therefore produce different prompt bytes. `ProjectGenerate.jsx:466–473` and `chat/ManualComposer.jsx:165–169` both use `joinFragment` and document this exact hazard; ShotWorkspace still has it.
- `stC` at `:18` is `{queued, running, failed}` — **`done` is missing**, so `stC[t.status]` on a completed take is `undefined`.

The bar also has genuinely correct local behaviour that must survive: refs seed from the shot's `cast`/`loc` in the constructor (`:26–29`), `generate()` patches the shot (`:153–155`), and `promptBig` grows the prompt `38 → 110px` on focus (`:34`, `:316`).

## What to change

1. Import `Composer` and render it in place of `:309–382`, at `density="bar"` (ticket 03's name for what this ticket's title calls *inline* — one name, not two; use `bar`).
2. Map state onto the ticket-03 nested value shape: `variants` → `value.variantCount`; `aspect` → `value.format.aspect`; add `format.resolution` and `format.seed`, which the bar has never had. Keep `variantOptions={[1,2,4]}`.
3. `show={{ style:false, camera:false, enhance:false, voice:false, outKind:false, maxSpend:false, cost:true, seed:true }}` — cost and seed are additions, not restyling.
4. `refsMode="internal"`, `maxRefs={4}`, seeded from the existing constructor logic. The `+ Ref` picker (`:458–488`) is replaced by `<Composer>`'s.
5. Keep the per-shot look popover (`:336–356`) as an `extras` slot — it writes to the server via `setLook()` (`:59–64`) and is shot-scoped, not project-scoped `StyleLab`. Same for `Full composer →` (`:375–376`).
6. `onSubmit(value)` retains this file's existing `generate()` I/O verbatim: `createBatch` vs `generate`, then `api.patchShot(...)`. `<Composer>` owns no fetching.
7. Delete `ShotWorkspace.jsx:16`. Route the style fragment through `joinFragment` on both paths — kill the `', '` join at `:149`.
8. Add the missing `done` key to `stC` (`:18`), or take the shared `GEN_STATUS` map if the atoms ticket has landed first.

## Acceptance criteria

- `grep -n "2\.39:1" frontend/ShotWorkspace.jsx` → **0 hits**.
- `grep -nE "<select|enabledCatalog|split\('/'\)\.pop" frontend/ShotWorkspace.jsx` → **0 hits** inside the docked bar (the take meta strip at `:441` may keep its own label until the results ticket lands; state which).
- `grep -n "variants" frontend/ShotWorkspace.jsx` → 0 hits; only `variantCount` remains.
- `grep -n "', ' + lock.fragment" frontend/ShotWorkspace.jsx` → 0 hits; `joinFragment` appears instead.
- The bar renders **two rows** (prompt + one wrapping control row) at 1280×800 and at 1024×640. The stage frame (`:413`, `flex:1;min-height:0`) must not lose height versus `main` — measure `getBoundingClientRect().height` on the stage before and after; delta ≤ 4px.
- The keycap legend at `:296–305` still shows `←→ takes · L final · K keep · X kill · R re-roll · F zoom · Esc close`, and each key still fires through `onKey` (`:113–124`) with the capture listener at `:41` intact. Verify by pressing each with the prompt unfocused.
- Typing inside the composer prompt does **not** trigger `k`/`x`/`r` — the existing early-return guard at the top of `onKey` must still hold once the textarea is `<Composer>`-owned.
- A single generate and a `×2` batch from the same bar produce byte-identical composed prompts. Check the two records in `workspace/projects/<pid>/` .
- `node --test tests/*.test.mjs` green.

## Notes

- This is the highest-value adoption in the effort: one file removes a duplicated aspect list, a fourth model chooser, a third batch vocabulary, a prompt-join defect, and a status-map hole.
- Popovers must open **upward** (`bottom:100%`), as `chat/ManualComposer.jsx:221` already does and as the existing look popover does at `:344` (`bottom:28px`). That mechanism exists; ticket 03 shares it.
- Adding resolution and seed changes the payload this surface sends. `backend/generate.mjs` already accepts both — no backend change, but re-check `api.createBatch`'s `baseSeed` (`:146`) versus the single path's `seed`.
- Boundary: the take filmstrip (`:266–294`) and stage action row (`:440–453`) are **not** this ticket. They belong to the `<ResultCard>` / `<ReviewActions>` ticket, which also owns the three video-kind regexes including `isVid()` at `:69`.
- If the low-level primitives ticket (`Btn`/`Chip`/`Eyebrow`) lands first, the Generate button at `:377–380` should compose it rather than re-inline `#E3FF32`.
