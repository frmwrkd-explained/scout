# 03 — Video `duration` is collected by the UI and silently dropped

**Status:** resolved
**Blocked by:** None — can start immediately.

## The conflict

`frontend/ProjectGenerate.jsx:88` keeps `duration: 8` in state and renders a duration
control. `backend/providers.mjs:107` hardcodes `payload.duration = 5` for Kie. No backend
route destructures `duration` at all.

So the UI offers a choice, shows 8s, and the user gets 5s.

## This one is already documented, honestly

The codebase is self-aware here. `ProjectGenerate.jsx:450-452`:

> *"Mirrors go()'s duration passenger exactly. Both are inert today — the batch and generate
> paths must stay in lockstep so a later 'plumb duration through' lands half-done and
> produces 8s batches of 4s singles."*

That comment is the reason this is a ticket and not a bug fix: whoever wrote it deliberately
kept the two inert paths symmetrical so a future implementation wouldn't land half-done.
**Respect that.** Either plumb both paths or remove both controls.

## The decision

Two valid resolutions:

1. **Plumb it.** `index.mjs` route destructure → `generate.mjs` signature →
   `providers.mjs:107` `duration || 5`. Must also reconcile the `DURATIONS` list against what
   each video model actually accepts — a model given an unsupported duration may hard-fail.
2. **Remove it.** Delete the picker, the FORMAT-pill segment, and the inert state field.
   Honest and much cheaper.

Do not leave the UI asserting a value the backend discards.

## Acceptance

- UI and backend agree on video duration, or the UI stops offering it.
- If plumbed: the batch path and the single-generate path change together.
- 63/63 tests pass.

## Outcome

Took resolution 2 — **removed**. The control was inert, and plumbing it would have required a
per-model duration range that the catalog does not declare: the only video model documenting one is
`kie/kling-2.6` at "5-10s" (`frontend/modelCatalog.js:71`), which means the shipped `DURATIONS` list
already contained an invalid value (4s) for it. Plumbing as-is would have converted a silent no-op
into live generation failures. Removing an inert picker is not removing a feature; it is removing a
claim the UI could not honour.

Changed in `frontend/ProjectGenerate.jsx` only:

- Deleted the `DURATIONS = [4, 6, 8, 10]` constant and the DURATION chip row in `formatPopover()`.
- Deleted the `duration: 8` state field.
- Deleted the duration passenger from **both** send paths — `queueBatch()` and `go()` — in the same
  change, honouring the lockstep the old comment was protecting.
- Dropped the `· Ns` segment from the FORMAT pill's value text and removed `duration` from that
  pill's "holds a non-default value" test.
- Replaced the stale comments at the old ~450 and ~481 sites with a note recording why this was
  removed and what re-adding requires; also corrected four prose comments and one mode-switch
  tooltip that still advertised a duration control.

`backend/providers.mjs:107` (`payload.duration = 5`) was left untouched — it is outside this
ticket's ownership and is the actual working behaviour. The UI and backend now agree: the backend
decides duration, and the UI no longer claims otherwise.

### Follow-up for whoever re-adds this

Re-adding duration is a catalog change first, not a UI change. Order: declare per-model duration
ranges in `frontend/modelCatalog.js` → destructure `duration` in the `index.mjs` generate and batch
routes → thread through `generate.mjs` → clamp per model in `providers.mjs` (`duration || 5`) →
only then restore the picker, driven off the catalog ranges rather than a hardcoded list. Land both
send paths together.
