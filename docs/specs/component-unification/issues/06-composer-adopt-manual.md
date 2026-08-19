# 06 — Adopt `<Composer>` in chat ManualComposer (panel density)

**Status:** shipped, by deletion — `frontend/chat/ManualComposer.jsx` no longer exists.
Chat renders the shared `Composer`; the file's `OUTPUT_KINDS` vocabulary moved into
`frontend/modelCatalog.js` (see `modelCatalog.js`'s own comment on the move).
Re-verified 2026-08-02. NOTE: this ticket's acceptance list names
`tests/canon-allowlist.json`, which has never existed in this repo — an acceptance
criterion nobody could ever have satisfied.
**Blocked by:** 03

## Problem

`frontend/chat/ManualComposer.jsx` is 327 lines, and roughly a third of them re-render
things the app already owns exactly once:

- **Model picker, hand-rolled.** `renderModelPicker()` `:209–241`. Rows at `:226–235` are a
  near-verbatim copy of `GenerationControls.jsx:57–66` — same `hRow` class, same
  `rgba(227,255,50,.07)` selected wash, same 10px check span, same 11.5/9px label+provider
  stack, same `toFixed(3)` cost. The only differences are `padding:7px 11px` vs `7px 13px`
  and a flat list instead of grouped. Its own header comment `:21–22` states the reason:
  `ModelPicker`'s `video` prop (`GenerationControls.jsx:50`) is tri-state boolean and
  cannot express `['preview','render','edit']` or the audio kinds. That was a real gap;
  ticket 03 closes it with a `kinds` prop.
- **VARIANTS, third vocabulary.** `const VARIANTS = [1,2,4]` `:51`, rendered `:304–310`,
  while `FormatControls` already ships the identical chip row behind `showVariants` with a
  parameterised `variantOptions` (`GenerationControls.jsx:99–100, 140–147`).
- **`Chip` and `Head`, fourth and third definitions.** `:68–74`, drifted to
  `font-size:10.5px` / `border-radius:7px` against `GenerationControls.jsx:31–38`'s
  `10px` / `6px`.
- **`paramsField()` `:132–140`** — byte-equivalent to `ProjectGenerate.jsx:226–234`.
- **`needsRefFrame()` `:145–149`** — byte-equivalent to `ProjectGenerate.jsx:245–248`.
- **`modelName` re-derived inline** at `:195` (`String(model).split('/').pop()`), duplicating
  the export at `GenerationControls.jsx:28`.

It is a partial adopter today: `SchemaForm` is imported at `:29` and mounted at `:297–301`,
which is why aspect/resolution/seed are already correct here. Everything around SchemaForm
is the duplication.

## What to change

Replace the composer body with `<Composer density="panel">` from ticket 03. Keep this file
as the chat's thin adapter — it keeps its state, its locks, and all of its I/O.

**Keep, do not migrate:**

- **`OUTPUT_KINDS` `:43–49` and the OUTPUT chip row `:278–281`.** Five output purposes
  (image/video/music/voice/sfx) is genuine chat-specific function. Ticket 07 generalises
  it; until then it stays local and feeds `Composer` via `kinds={outputKindOf(S.outKind).kinds}`.
- **`renderLocks()` `:243–268`** — pass as `locks={[…]}` / `onToggleLock` into `Composer`'s
  context rail slot (03 §5). This is the app's only working locked-context rail; it must
  render identically after the swap.
- **`refsMode="external"`** — refs come from Chat's attachment tray via
  `getAttachmentRefs()` (`:123`, mounted `Chat.jsx:561`). `Composer` must not grow a second tray.
- **`submit()` `:156–207` in full.** `Composer` emits `onSubmit(value)` and owns zero I/O.
  `sessionId` (`:182`, `:189`) and the `api.chatManualTurn` follow-up (`:198`) are unique to
  this surface and stay here.
- **The upward popover.** `:221` opens the model list with `bottom:100%;margin-bottom:6px`
  because the composer is docked to the bottom of the thread. `density="panel"` must open
  upward, or `Composer` must take a `popoverDirection` prop.

**Delete and route through `Composer`:** `renderModelPicker()`, `VARIANTS` + its chip row,
`Chip`, `Head`, `paramsField()`, `needsRefFrame()`, `blockReason()`, `modelsForKind()`,
`defaultModelFor()`, the cost readout `:318`, the Generate button `:319–322`, and the direct
`SchemaForm` mount (`Composer` mounts it). Import `modelName` from `../GenerationControls`
for the turn label at `:195`.

Keep the state key `variantCount` (`:85`) — it is already the canonical name; `ShotWorkspace`'s
`variants` is the stray, handled in its own ticket.

## Acceptance criteria

- `rg -n --text "enabledCatalog|providerDef|estCost" frontend/chat/ManualComposer.jsx` → **0 hits**
  (was 3 imports at `:33`, used at `:56`, `:217`, `:231`, `:233`, `:273`).
- `rg -n --text "const VARIANTS|const Chip =|const Head =|paramsField|needsRefFrame|split\('/'\)\.pop" frontend/chat/ManualComposer.jsx` → **0 hits**.
- `rg -n --text "SchemaForm" frontend/chat/ManualComposer.jsx` → **0 hits**; `rg -n --text "Composer" frontend/chat/ManualComposer.jsx` shows the import.
- `rg -c --text "OUTPUT_KINDS" frontend/chat/ManualComposer.jsx` → **≥ 2** (the const and the row survive).
- File is **≤ 200 lines** (from 327).
- `tests/canon-allowlist.json` loses its four `frontend/chat/ManualComposer.jsx` entries
  (`model-picker`, `model-label`, `batch-count`, `cost-display`) and the canon test stays green —
  the ratchet's second assertion fails if a stale entry is left behind.
- `node --test tests/*.test.mjs` → all pass.
- Visible, in `npm run dev` + `npm run server` (5175 / 5176): flip the chat's Agent⇄Manual
  switch; pick OUTPUT → **Music** and confirm the model list contains only music models and
  **opens upward**; pick OUTPUT → **Video** with an `image-to-video` model and no attachment
  and confirm the block hint from `:152` still reads "This model animates a still — attach a
  reference frame first"; set VARIANTS 2×, submit, and confirm a `Manual · … · 2×` turn card
  appears in the transcript.
- Locks rail: with a project style lock set, the `LOCKS APPLIED` pills render as before and
  toggling `style` off still produces an unjoined prompt (`:168–169`).

## Notes

- Blocked by 03 for two reasons, not one: `<Composer>` itself, **and** the `kinds` prop on
  `ModelPicker`. If 03 lands `<Composer>` without `kinds`, this ticket is unimplementable —
  verify `GenerationControls.jsx:54`'s signature before starting.
- Ticket 07 generalises the OUTPUT row into `Composer`'s `outKinds` prop. Deliberate overlap:
  06 proves `density="panel"` against a real surface; 07 then lifts the row without touching
  layout. Do not pre-empt 07 by moving `OUTPUT_KINDS` here.
- The census draft called this density `stacked`; the effort's ticket names it `panel`. Whichever
  03 ships is canonical — grep `density=` before writing the prop.
- Low-level primitives (`Btn`/`Eyebrow`/`Chip`) are **not** this ticket. The
  `design-reconciliation` spec is not on `main` (`docs/specs/` holds only `filmmaker-chat` and
  `source-of-truth-reconciliation`), so `Composer` owns its own `Chip`/`Head` for now and hands
  them over if that layer later lands. Do not author a parallel primitives module here.
- `filmmaker-chat/issues/19-manual-mode.md` specced this file. It is `done` and stays done —
  this ticket changes how the form is built, not what it does. Behaviour parity is the bar.
