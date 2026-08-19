# 09 — Migrate the feature-atoms to canonical exports

**Status:** PARTIAL — two of its named atoms landed on 2026-08-02 and the rest have not.
Done: `Chip` is exported from `frontend/ui.jsx` and both former module-local copies
(GenerationControls, SchemaForm) import it; `MONO` is imported from `frontend/tokens.js`
in every consumer (was 47 local declarations + 3 inline literals, now zero).
Not done: `Switch`, `Select`, `TextArea`, `NumberInput`, `ProgressBar`, `ErrorText`,
`Cost`, `SliderRow`, `fmtBytes` — none exist. Re-verified 2026-08-02.
**Blocked by:** 01 (design tokens), 02 (variant vocabulary), 04 (`ModelPicker` gains `kinds`)

## Problem

`frontend/GenerationControls.jsx` exports exactly four symbols — `ASPECTS:24`, `modelName:28`, `ModelPicker:54`, `FormatControls:103` — and they are half-adopted. The uncovered call sites are re-implementations, not variations:

- **Model picking.** `enabledCatalog()` is called outside the canonical component at three sites: `ShotWorkspace.jsx:359` (native `<select>` + `<optgroup>`, no cost, no provider label), `chat/ManualComposer.jsx:56` (feeds a hand-rolled popover whose rows at `:226–235` are near-verbatim `GenerationControls.jsx:57–66`, differing only in `padding:7px 11px` vs `7px 13px`), and `App.jsx:1692` (project-settings model list). Adopters today: `ProjectGenerate.jsx:47`, `PromptBuilder.jsx:11`.
- **Model labelling.** `modelName` is re-derived inline as `String(x).split('/').pop()` at `ShotWorkspace.jsx:361`, `ShotWorkspace.jsx:441`, `ProjectGenerate.jsx:504,773,1289`, `App.jsx:2078,2933`, `chat/ManualComposer.jsx:195`. `chat/confirmCard.jsx:27` declares a same-named local with different null semantics.
- **Aspect list.** `ShotWorkspace.jsx:16` is a byte-identical copy of `GenerationControls.jsx:24`, consumed at `:367`. `lookBuilder.js:62–63` also contains `'2.39:1'` but is the style-name→aspect mapping table — a different concern, **not** in scope.
- **Batch.** `[1,2,4]` / `[1,2,4,8]` literals at `ProjectGenerate.jsx:1111`, `ShotWorkspace.jsx:370`, `chat/ManualComposer.jsx:51`, while `FormatControls` already parameterises this as `variantOptions` (`GenerationControls.jsx:106`).
- **Cost.** Six render sites, four prefixes (`$`, `~$`, `est $`, `≈ $`), and the precision rule `toFixed(n >= 1 ? 2 : 3)` written twice verbatim: `ProjectGenerate.jsx:952` and `chat/ManualComposer.jsx:318`. Also `GenerationControls.jsx:64`, `ManualComposer.jsx:217,233`, `generationCards.jsx:56–58`, `confirmCard.jsx:140,143`, `ShotWorkspace.jsx:441`, `ReviewInbox.jsx:79`.

The brief's larger counts (23 aspect files, 12 batch files) count pass-through payload fields. Only the sites listed above **declare a competing implementation**; that is what this ticket migrates.

## What to change

1. **`fmtCost(n, { prefix = '$', est = false })` → `frontend/modelCatalog.js`**, beside `estCost`/`fmtSize`. One precision rule: `toFixed(n >= 1 ? 2 : 3)`. Not in `GenerationControls.jsx` — the backend imports `modelCatalog.js` and must stay JSX-free, so the formatter lives where the price does. Migrate all six render sites plus `generationCards.jsx:56–58` (which is the only one correctly distinguishing ledgered cost from estimate — preserve that behaviour, express it through `fmtCost`).
2. **`ShotWorkspace.jsx:16` deleted**; import `ASPECTS` from `./GenerationControls`.
3. **`ShotWorkspace.jsx:358–364` and `chat/ManualComposer.jsx:209–241` replaced by `<ModelPicker>`**, using the `kinds` prop from ticket 04. `ManualComposer`'s `modelsForKind`/`defaultModelFor` (`:54–66`) move into `GenerationControls.jsx` as the picker's own kind logic. `App.jsx:1692` stays hand-rolled for now — it is a settings surface, not a composer; note it as out of scope in the file, do not migrate it silently.
4. **Every inline `.split('/').pop()` over a model id replaced by `modelName`.** Delete `confirmCard.jsx:27`'s local shadow. `Story.jsx:99` splits a *folder* path — leave it.
5. **Batch chip rows migrated to `FormatControls showVariants`** with `variantOptions` supplied per surface (`[1,2,4,8]` in ProjectGenerate, `[1,2,4]` elsewhere) and the label from ticket 02. `ProjectGenerate`'s ⌥-digit binding (`:635–648`) and `maxSpend` stay in ProjectGenerate — only the chip row moves. `ShotWorkspace.jsx:37,142,145` renames `variants` → `variantCount`.

## Acceptance criteria

Each command must return the stated count. Run from repo root.

```
# 1 — only the canonical component reads the catalog for a picker
rg -n --text 'enabledCatalog\s*\(' frontend/ --glob '!frontend/modelCatalog.js' \
  | grep -v '^frontend/GenerationControls.jsx' | grep -v '^frontend/App.jsx' | grep -v '//'
→ 0 lines   (was 2: ShotWorkspace.jsx:359, chat/ManualComposer.jsx:56)

# 2 — one aspect list outside the mapping table
rg -c --text "'2\.39:1'" frontend/ShotWorkspace.jsx   → no match (was 1)
rg -l --text "\['16:9', '2\.39:1'" frontend/          → GenerationControls.jsx only

# 3 — no inline model-id label derivation
rg -n --text "\.split\('/'\)\.pop\(\)" frontend/ | grep -v Story.jsx | grep -v SchemaForm.jsx
→ 1 line (GenerationControls.jsx:28, the definition)

# 4 — no bare variant literals
rg -n --text '\[\s*1,\s*2,\s*4' frontend/ | grep -v '^frontend/GenerationControls.jsx'
→ 0 lines   (was 3)

# 5 — one precision rule
rg -n --text 'toFixed\(.*>=\s*1\s*\?' frontend/ | grep -v modelCatalog.js  → 0 lines
rg -n --text "'~?\\\$' *\+" frontend/ | grep -v modelCatalog.js            → 0 lines

# 6 — the suite is still green
node --test tests/*.test.mjs   → 0 fail
```

Visible behaviour: the ShotWorkspace model control shows provider label and per-model cost (it shows neither today, `:358–364`); the ManualComposer picker is pixel-identical to ProjectGenerate's rows.

## Notes

- **Boundary with `reconcile/design-system` ticket 05 (`05-ui-primitives.md`, unmerged).** That ticket owns `Btn`/`Card`/`Eyebrow`/`Empty`/`Field` — the *atoms inside* these controls. This ticket owns the *feature* atoms: which component renders a model list, an aspect list, a variant row, a price. Where they touch: `Chip` (defined 3× — `GenerationControls.jsx:35` at 6px, `ManualComposer.jsx:68` at 7px, `ProjectGenerate.popChip:1048`) and `Head`/eyebrow (defined 4× — `GenerationControls.jsx:31`, `SchemaForm.jsx:38`, `ManualComposer.jsx:72`, `ProjectGenerate.popHead:1046`). **`Chip` is not in ticket 05's list.** Decide before either ships: either ticket 05 grows a 6th primitive, or `GenerationControls.jsx` exports `Chip` and ticket 05 consumes it. Do not let both author one.
- Ticket 01 must land first. Migrating these call sites on `main` bakes in hex literals (`#E3FF32`, `#9AA3AF`, `#626B78` appear in every cost span above) that 01 then has to unpick.
- `SchemaForm.jsx:24` already imports `FormatControls` as its fallback path — do not "migrate" it; it is the intended relationship (`SchemaForm.jsx:255` returns `FormatControls` when no real spec resolves).
- `docs/specs/` on `main` contains only `filmmaker-chat/` and `source-of-truth-reconciliation/`. The design tickets referenced above live on the unmerged `reconcile/design-system` branch — verify before citing.
- Backend-side aspect drift (`backend/providers.mjs:32`, `'16:9':[1344,768]` = 1.75, not 1.778) is a **separate** source-of-truth ticket. Do not fold it in here.
