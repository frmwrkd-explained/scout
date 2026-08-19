# 07 — Output-kind switching — image / video / music / voice / sound design

**Status:** shipped — `OUTPUT_KINDS`, `outputKindOf`, `outputKindForModel` and
`defaultModelForOutputKind` live in `frontend/modelCatalog.js`, derived from `KINDS`;
`Composer.jsx` imports them through `./models` and `ModelPicker` takes a `kinds` array.
Re-verified 2026-08-02.
**Blocked by:** 04

## Problem

The app has seven generation kinds (`frontend/modelCatalog.js:31-38` — `preview`, `render`, `edit`, `video`, `music`, `voice`, `sfx`) and exactly one surface that lets a user choose between more than two of them.

- `frontend/chat/ManualComposer.jsx:43-49` declares `OUTPUT_KINDS`, the five-way folding of those seven (`image` = preview+render+edit; video/music/voice/sfx 1:1). It is module-private.
- `frontend/ProjectGenerate.jsx:838-848` has its own two-way `image | video` segmented switch on `state.media`. Music, voice and sound design are unreachable from the main console.
- `frontend/ShotWorkspace.jsx:357-364` has no kind concept at all — a raw `<select>` over every enabled model.

The five-way selector was never shared because the shared picker cannot express it: `ModelPicker`'s `video` prop is a tri-state boolean (`GenerationControls.jsx:49`, `:54-56` — `g.group.startsWith('VIDEO') === !!video`). `ManualComposer.jsx:21-22` says so in a comment and pays for it with a 32-line re-render of `ModelPicker`'s row body (`:226-235` vs `GenerationControls.jsx:57-66` — same checkmark span, same `rgba(227,255,50,.07)` selected tint, same `toFixed(3)`; only `padding:7px 11px` vs `7px 13px` differs).

Settings resolution is the same story. `modelsForKind()` / `defaultModelFor()` (`ManualComposer.jsx:54-66`) read `settings.modelDefaults` per kind and are correct — and are private to a chat file, so `ProjectGenerate` and `ShotWorkspace` each fall back to `proj.model`.

And the kind currently distorts the settings pane rather than driving it. `ManualComposer.jsx:300` passes `aspects: this.isVisual() ? undefined : ['1:1']` — an audio generation is shown a fake one-item aspect chip and a resolution tier row, because `SchemaForm`'s fallback (`SchemaForm.jsx:255-266`) always renders `FormatControls`. Audio has no aspect. Meanwhile `FormatControls` already supports `showDuration`/`durations` (`GenerationControls.jsx:101-102`, `:131-137`) and **no caller in the repo passes them** — `rg -n --text "showDuration" frontend/` returns only the declaration and its use.

## What to change

1. **Promote the kind vocabulary into the catalog.** Move `OUTPUT_KINDS`, `outputKindOf`, `modelsForKind`, `defaultModelFor` out of `ManualComposer.jsx:43-66` into `frontend/modelCatalog.js`, **derived from `KINDS`** — not restated. One export, e.g. `OUTPUT_KINDS` mapping `key → {label, kinds[]}`, plus `outputKindOfModel(id)` built on the existing `modelKind()` (`:129`). Do not add a second kind list.
2. **`ModelPicker` gains `kinds`.** An optional array of catalog kind keys, filtering `enabledCatalog()` by `g.kind`. `video` stays for back-compat; `kinds` wins when both are passed. Delete `ManualComposer.renderModelPicker()` (`:209-241`) and mount the shared picker with its existing caller-supplies-the-trigger contract.
3. **`<Composer>` owns the selector.** `value.outKind` joins the value object; `outKinds={[...]}` gates which chips render, defaulting to all five. `show.outKind === false` hides the row entirely (ShotWorkspace's bar). ProjectGenerate's `state.media` switch (`:838-848`) becomes `outKinds={['image','video']}` — the same two options, one implementation.
4. **Kind change re-resolves the model.** Switching kind picks `defaultModelFor(settings, kind)`; if the current model already belongs to the new kind, keep it. Mirrors `ManualComposer.setOutKind()` (`:95`).
5. **Kind decides which settings surface renders — spec first.** In `<Composer>`, the settings pane is `SchemaForm` for every kind. Pass `format` only when the kind is visual. For an audio kind pass no `format` at all, so the fallback renders nothing rather than a `['1:1']` aspect chip and a resolution tier; drop `ManualComposer.jsx:300`'s workaround.
6. **Video stops being "just HD."** For `outKind === 'video'` on the fallback path (non-FAL providers, `getModelSchema` returns `fallback:true` by design), pass `showDuration` + a `durations` list. On the FAL path nothing new is needed — duration already arrives as a spec enum through `SchemaForm`'s `Field()` and rides to the provider inside `params`, which `backend/providers.mjs:69-75` merges last and lets override the generic mapping. Duration must travel **only** as a spec param, never as a resurrected top-level payload key: `docs/specs/source-of-truth-reconciliation/issues/03` closed by deleting the half-plumbed top-level `duration`, and reintroducing it would re-open that exact defect.

## Acceptance criteria

- `rg -n --text "OUTPUT_KINDS|modelsForKind|defaultModelFor" frontend/` — declarations appear only in `frontend/modelCatalog.js`; every other hit is an import.
- `rg -n --text "OUTPUT_KINDS = \[|const VARIANTS|renderModelPicker" frontend/chat/ManualComposer.jsx` — zero hits.
- `rg -n --text "kinds" frontend/GenerationControls.jsx` — `ModelPicker` accepts `kinds`; `rg -n --text "'✓'" frontend/` finds the model-row checkmark in `GenerationControls.jsx` only.
- Selecting **Music**, **Voice** or **Sound design** in Manual mode renders **no** ASPECT and no RESOLUTION section. Verify by eye plus `rg -n --text "\['1:1'\]" frontend/` → zero hits.
- Selecting **Video** with a synced FAL spec (`fal-ai/kling-video/v3/pro/image-to-video`) renders duration chips from the spec's own enum, not a hardcoded list. Confirm the spec is real, not fallback: `curl -s '127.0.0.1:5176/api/catalog/model-schema?model=fal-ai/kling-video/v3/pro/image-to-video' | grep -o '"fallback":[a-z]*'` → `false`, and a `duration` field is present.
- ProjectGenerate's IMAGE/VIDEO switch is gone as a bespoke control: `rg -n --text "state.media|media: 'image'" frontend/ProjectGenerate.jsx` → zero hits; the same two options render through `<Composer outKinds>`.
- Switching kind with an incompatible model selected replaces it with that kind's `modelDefaults` entry, or the first enabled model in the kind if unset — no empty picker, no cross-kind model.
- `npm test` green (`node --test tests/*.test.mjs`, currently 194/194 — do not use the bare `tests/` glob, it collects AppleDouble files).

## Notes

- **Not a re-spec of `docs/specs/filmmaker-chat/issues/07`** (audio kinds, `done`) or `19` (manual mode, `done`). Those built the pipeline and the five-way chip row; this ticket makes the chip row shared and lets the kind drive the settings pane instead of distorting it.
- Depends on 04 for the `<Composer>` shell and its `value` shape; the `kinds` prop on `ModelPicker` is the enabling change and can land first if 04 slips.
- The `Chip` used by the kind row is the same atom duplicated at `GenerationControls.jsx:35` (6px radius), `ManualComposer.jsx:68` (7px), and `ProjectGenerate.popChip:1048`. Reconcile radius here only if the primitives ticket has not landed; otherwise compose it. Do not ship two `Chip`s.
- **Out of scope, flag only:** `backend/providers.mjs:129` hardcodes `payload.duration = 5` for every Kie video. Kie is a fallback-schema provider by design (`backend/modelSchemas.mjs:200`), so its duration cannot come from a spec — that is a separate backend ticket, not this one.
- `usesResolutionTier` (`modelCatalog.js:170`) is a per-model regex standing in for a fact the fetched schema already states. Deriving it from the schema belongs to the spec-adoption ticket, not here — but do not add a kind-based branch that entrenches it further.
