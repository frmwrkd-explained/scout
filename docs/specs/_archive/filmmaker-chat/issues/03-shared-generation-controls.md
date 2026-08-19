# 03 — Shared ModelPicker and FormatControls

**What to build:** One shared `ModelPicker` (provider/price-aware popover fed by the
enabled catalog, grouped by kind) and one shared `FormatControls` (aspect chips,
resolution tiers with pixel readout, seed, variant count, duration for video) —
consolidated from the four existing reimplementations in the generate console, the
style lab, the prompt builder, and the tools-suite model catalog card. All four
surfaces adopt the shared components. This is the second prefactor: manual chat mode
(later ticket) mounts these same components.

**Blocked by:** None — can start immediately.

**Status:** done (2026-07-19)

- [x] A shared generation-controls module exports ModelPicker and FormatControls
      → `frontend/GenerationControls.jsx` (also exports `ASPECTS`, `modelName`).
- [x] Generate console and prompt builder use them; their private pickers are deleted
      → `ProjectGenerate.jsx`: `modelPopover()`/`formatPopover()` now render the shared
        components; the hand-rolled row renderers, the local `modelName`, the `modeGroups()`
        helper and the local `ASPECTS` const are gone. `PromptBuilder.jsx`: the `enabledCatalog`
        `<select>` is replaced by a trigger + shared `ModelPicker` popover.
      **DEVIATION** — the ticket also names the *style lab* and the *model-catalog tool*, but
      neither contains a ModelPicker/FormatControls reimplementation to delete:
        · `StyleLab.jsx` imports only `AXES`; its aspect comes from presets, and it has no model
          picker and no aspect/resolution/seed controls. Nothing to consolidate.
        · `ToolsSuite.jsx` `ModelCatalog` is a catalog-*management* card (browse · filter ·
          enable/disable · set per-kind defaults), not a generation picker. Its default `<select>`s
          intentionally surface a currently-selected model even when it is *disabled*
          (`!off.has(m.id) || d[key] === m.id`); a shared enabled-only ModelPicker would drop that,
          changing documented behavior. Left as-is on purpose (see criterion 3).
- [x] Provider badges, cost display, disabled-model filtering, and custom models all behave as before
      → `ModelPicker` is fed by `enabledCatalog(settings)` (disabled filtered, custom included) and
        renders provider label + `$cost` per row, verified in-browser in both surfaces.
- [x] Aspect/resolution changes still produce identical pixel sizes (snap-to-16 logic untouched,
      sourced from the model catalog only)
      → `FormatControls` reads `pixelSize`/`RESOLUTIONS`/`fmtSize` from `frontend/models.js` (the
        facade over the catalog); no math is reimplemented. Verified: 16:9·1K → 1024×576,
        2.39:1·1K → 1024×432.
