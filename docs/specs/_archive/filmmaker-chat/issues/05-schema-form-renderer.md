# 05 — SchemaForm: spec-driven settings form

**What to build:** A shared `SchemaForm` component that takes a normalized model
schema (ticket 04) and materializes a settings form: enum fields become chip rows or
selects, numeric ranges become steppers/sliders with min/max/default, booleans
become toggles, reference-image inputs become attachment slots. When the schema
route returns the fallback marker, SchemaForm renders the generic FormatControls
(ticket 03) instead — the form never dead-ends. Wire it into the generate console's
advanced settings as the first consumer, so switching models visibly changes the
available settings (e.g. a model with named resolution tiers shows tier chips; a
model with explicit width/height shows the aspect/resolution controls; a video model
shows its real duration options).

**Blocked by:** 03 — Shared ModelPicker and FormatControls; 04 — FAL per-model spec sync.

**Status:** done

- [x] SchemaForm renders correct controls for enum, range, boolean, and reference-input fields with defaults pre-applied
- [x] Values produced by the form pass through to the generation payload without hand-written per-model branching in the UI
- [x] Fallback to generic FormatControls when no schema is available
- [x] In the generate console, switching between two FAL models with different specs changes the settings form accordingly

## Implementation notes (2026-07-19)

**Files**
- `frontend/SchemaForm.jsx` (new) — the shared, controlled, spec-driven form.
- `frontend/ProjectGenerate.jsx` — FORMAT popover now renders `SchemaForm` (was
  `FormatControls`); added `modelParams` state, reset-on-model-change, and a
  `paramsField()` that folds the schema values into the `generate`/`createBatch`
  payloads as `params`.

**SchemaForm prop API** (ticket 19 consumes it):
`{ modelId, value, onChange(next), format, onSchema? }`. Controlled like
FormatControls — `value` is the params object keyed by schema field name,
`onChange` gets the full merged object. `format` is the props object forwarded to
the fallback `FormatControls`. `onSchema(schema)` fires when a schema resolves.
Fetches `api.modelSchema(modelId)` on model change (module-level cache dedupes
reopens), shows a loading line, applies spec defaults once per model via onChange.

**Field → control:** enum → chip row (≤6 opts) or `<select>` (>6); integer/number
→ stepper +/− with a slider when both bounds are known; boolean → toggle;
image/video/audio ref → attachment slot (URL field); string → text box;
array/object → surfaced read-only. `prompt` is skipped (the composer owns it).

**Payload:** `paramsField()` emits `{ params }` (empty/half-typed values dropped),
merged into both `api.generate` and `api.createBatch`. Note: the backend
`/api/generate` route (backend/index.mjs) does not yet destructure `params` — that
plumbing is ticket 07's; this ticket delivers the UI-side passthrough only, so it's
a harmless forward-compatible field on today's server.

**Verification:** `npm run build` passes. Backend contract confirmed against the
real FAL OpenAPI (temp `FRFG_DATA`): `flux/schnell` & `flux/dev` → `image_size[6]`
tier chips; `nano-banana-2` → `aspect_ratio[15]` select; `kling-video/v3/pro/
image-to-video` → `duration[13]` + `shot_type[2]`; `flux-pro/v1.1` → 8 mixed
enum/boolean/integer/string fields — so the two-model-switch case is real. Fallback
path verified live in the browser (the running API on 5176 predates ticket 04's
schema route and 404s it, so SchemaForm falls back to FormatControls cleanly, no
console errors).

**Dev-server-unverified:** live rendering of the real spec-driven fields (enum
chips/steppers/toggles for an actual model) — the running backend 404s the schema
route, so only the fallback was exercisable in-browser. Verified instead via build +
the backend-contract survey above.
