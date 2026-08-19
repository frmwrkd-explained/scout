# 04 — Model-spec-driven settings — no hardcoded per-model options

**Status:** PARTIAL — do not close, do not restart. `SchemaForm` is spec-driven and
`Composer` mounts it, so the headline is done. The acceptance criterion
`grep -rn "aspect: '" frontend/` → 0 hits is still NOT met: 10 sites hardcode an aspect
literal (App, AssetBoards, Chat, ProjectGenerate, ShotWorkspace, Story ×3,
chat/shotBoardCard ×2). Re-verified 2026-08-02. That grep is the remaining work.
**Blocked by:** 02 — the shared composer must exist before its settings slot can be made spec-only.

## Problem

The spec pipeline is already built and correct. `backend/modelSchemas.mjs:197` `getModelSchema()` fetches FAL's per-endpoint OpenAPI (`:21`, `:23`), normalizes it to `{name,label,type,options,min,max,step,default}` (`:82-117`), caches it with a 7-day stamp (`:20`), and serves it at `GET /api/catalog/model-schema` (`backend/index.mjs:919`). `frontend/SchemaForm.jsx` renders it with **zero per-model branching** — `Field()` (`:56-173`) switches on `type` only. Video duration already arrives as a `duration` enum; it is not "just HD" anywhere in the schema layer.

The debt is entirely consumer-side, and it is three separate failures:

**1. Only 2 of 6 generation surfaces send `params` at all.** `ProjectGenerate.jsx:1090-1102` and `chat/ManualComposer.jsx:296-302` mount `SchemaForm`. These four send a string literal aspect, no resolution, no params:
- `frontend/Story.jsx:216` — `aspect: '16:9'`
- `frontend/AssetBoards.jsx:313` — `aspect: '1:1'`
- `frontend/App.jsx:2077` — `aspect: '16:9'` on the **video** path (animate-a-still: no duration, no resolution, no params)
- `frontend/ShotWorkspace.jsx:145,150` — plus a local `ASPECTS` at `:16`, byte-identical to `GenerationControls.jsx:24`

**2. The hardcoded aspect path runs in parallel to the spec, unconditionally.** `backend/providers.mjs:56` injects `image_size`/`aspect_ratio` from the hand-authored `FAL_ASPECT` table (`:25-31`) plus `num_images:1` and `output_format:'png'` on **every** FAL call, whether or not the endpoint declares them. `params` merges last (`:70-75`) so the spec wins on collision — but only for keys the spec happens to name.

**3. `SchemaForm` is either/or, and the parent is never told which.** `:255` returns `FormatControls` and bails; `:270` returns spec fields. When a real spec loads the aspect chips **vanish from the UI** while `S.aspect` (default `'16:9'`) is still posted at `ProjectGenerate.jsx:494`. The user ships an aspect they can no longer see. `onSchema` (`SchemaForm.jsx:201`) exists precisely to let a parent stop doing that — `grep -n --text "onSchema" frontend/` returns hits in `SchemaForm.jsx` only. **Zero callers.**

Underneath: `frontend/modelCatalog.js:170` `usesResolutionTier = /nano-banana|seedream/` is a per-model literal standing in for a fact the fetched schema already states. `providers.mjs:59` `if (!isVid(model))` skips the whole size path for video. `providers.mjs:129` hardcodes `payload.duration = 5` for every Kie video. `GenerationControls.jsx:107` defaults `durations = [5]` and no caller in the repo passes `showDuration` — the generic duration control is dead code.

## What to change

1. **Wire `onSchema`.** The shared composer (02) passes it to `SchemaForm`, stores the resolved schema, and when `schema.fallback === false` **stops sending top-level `aspect`/`resolution`** — `params` is then the whole story. `backend/generate.mjs:91` already defaults `aspect='16:9'` and `index.mjs:692` coerces it, so absence is tolerated today; keep it that way.
2. **Make the hardcoded table fallback-only.** In `providers.mjs` `runFal`, apply `FAL_ASPECT`/`pixelSize` only when the caller sent an `aspect` (i.e. the client had no spec). Drop the unconditional `num_images`/`output_format` injection to the same condition.
3. **Delete `usesResolutionTier` (`modelCatalog.js:170`).** Derive tier-vs-pixels from the schema's own fields (an `image_size`/`resolution` enum vs `width`/`height` integers). Grep for stray callers first — `providers.mjs:11,61`.
4. **Un-skip video in the size path** (`providers.mjs:59`) and **remove `payload.duration = 5`** (`:129`); duration comes from `params` or is omitted.
5. **Thread `params` through the four unwired surfaces.** `ShotWorkspace` additionally deletes its local `ASPECTS` (`:16`) and adopts the shared model picker; `Story`/`AssetBoards`/`App` route through the shared composer's payload builder rather than hand-building `api.generate` args.
6. **Fallback contract, stated once:** no spec, still loading with nothing cached, a fetch error, or `fallback:true` (every non-FAL provider — `modelSchemas.mjs:200` returns this by design for kie/higgsfield/arcads/custom) → render `FormatControls` and send `aspect`/`resolution` exactly as today. A **stale** spec (`stale:true`, `offline:true`) is still a spec: render it. `FormatControls` is not deleted; it becomes the generic path it is documented to be.

## Acceptance criteria

- `grep -rn --text "aspect: '" frontend/*.jsx frontend/chat/*.jsx` returns **0** hits (today: 4 — Story.jsx:216, AssetBoards.jsx:313, App.jsx:2077, and the ShotWorkspace pair via `S.aspect`).
- `grep -rn --text "onSchema" frontend/` shows at least one call site outside `SchemaForm.jsx`.
- `grep -n --text "usesResolutionTier" frontend/modelCatalog.js backend/providers.mjs` returns **0**.
- `grep -n --text "duration = 5" backend/providers.mjs` returns **0**.
- `frontend/ShotWorkspace.jsx:16` is gone; `grep -c --text "'2.39:1'" frontend/*.jsx` counts it in `GenerationControls.jsx` only (`lookBuilder.js:62` is the style-name→aspect map, a different concern — leave it).
- Live behaviour, in-browser: pick `fal-ai/kling-video/v3/pro/image-to-video` in the composer → a `duration` chip row with 13 options renders and no ASPECT/RESOLUTION chips are shown. Pick a Kie model → ASPECT + RESOLUTION chips render. Adding a new FAL model to `modelCatalog.js` requires **zero** UI edits to get its real settings.
- `node --test tests/*.test.mjs` green.

## Notes

- Coordinates with `docs/specs/filmmaker-chat/issues/04-fal-model-schema-sync.md` and `05-schema-form-renderer.md` — both `done`, both genuinely done. **This ticket adds no schema-layer code.** Ticket 05's own "Dev-server-unverified" note (`:56-59`) says live spec-driven field rendering was never exercised in a browser because the backend 404'd the route; the in-browser criterion above is the first real confirmation, so budget time for it.
- `ASPECT_WH` (`providers.mjs:32`) has drifted — `16:9 → [1344,768]` is 1.75, not 1.7778, disagreeing with `ASPECT_NUM` (`modelCatalog.js:157`). Real, but a **backend source-of-truth bug, not this ticket.** File it separately.
- The brief's "10 design-reconciliation tickets" are not on `main` — `docs/specs/` holds only `filmmaker-chat/` and `source-of-truth-reconciliation/`. Nothing here depends on them. `Head`/`Chip` are defined locally in `SchemaForm.jsx:37,44` and duplicated in `GenerationControls.jsx:31,35` and `ManualComposer.jsx:68,72`; that is a primitives concern, out of scope here.
- Non-FAL providers stay `fallback:true` forever by design. Do not "fix" that.
