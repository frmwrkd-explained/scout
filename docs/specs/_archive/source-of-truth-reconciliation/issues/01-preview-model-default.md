# 01 — Two app-wide preview-model defaults, and the documented one is unreachable

**Status:** resolved
**Blocked by:** None — can start immediately.

## The conflict

Two files each declare the app-wide default preview model, with different values:

- `frontend/modelCatalog.js:98` — `export const DEFAULT_PREVIEW_MODEL = 'fal-ai/nano-banana-2';`
  Its own comment at line 96 says: *"The app-wide fallback when neither the project nor
  settings.modelDefaults names a preview model."*
- `backend/store.mjs:149` — `DEFAULT_SETTINGS.modelDefaults.preview = 'fal-ai/flux/schnell'`

## Why it matters

`DEFAULT_PREVIEW_MODEL` is **dead code**. Every consumer reads it as a fallback:

- `backend/stylelocks.mjs:212` — `body.model || settings.modelDefaults?.preview || DEFAULT_PREVIEW_MODEL`
- `frontend/Story.jsx:207` — same chain

But `settings.modelDefaults.preview` comes from `DEFAULT_SETTINGS`, so it is **always**
populated with `fal-ai/flux/schnell`. The `|| DEFAULT_PREVIEW_MODEL` arm can never execute
for any user who has ever loaded settings. The constant documents a behavior the app does
not have.

Cost delta, per `frontend/modelCatalog.js:49-50`:

| model | cost | note |
|---|---|---|
| `fal-ai/flux/schnell` | $0.003 | "fastest" |
| `fal-ai/nano-banana-2` | $0.015 | "fast Gemini" |

**5× per preview generation**, and the docs and the code disagree on which the user gets.

## The decision

Which is the intended default? This is a product call — cheapest-and-fastest vs. better
quality — not a mechanical fix. Pick one, then make it true in exactly one place.

## Acceptance

- Exactly one file declares the default preview model; the other refers to it.
- If `DEFAULT_PREVIEW_MODEL` survives, it must be reachable — or its comment must stop
  claiming it is the app-wide fallback.
- `rg -n --text "flux/schnell|nano-banana-2|DEFAULT_PREVIEW_MODEL" backend frontend` shows
  no stray literal of the losing value.
- `CLAUDE.md` source-of-truth table names the winner.
- 63/63 tests pass.

## Outcome

**Winner: `fal-ai/flux/schnell`.** It is what was already in force at runtime (via
`DEFAULT_SETTINGS.modelDefaults.preview`), it is the catalog row labelled "fastest", and at
$0.003 vs $0.015 it is 5x cheaper — the right trade for a *preview* kind. **Zero behavior
change**; this only collapses two declarations into one.

What changed:

- `frontend/modelCatalog.js` — `DEFAULT_PREVIEW_MODEL` is now `'fal-ai/flux/schnell'`. Its
  comment no longer claims to be the app-wide fallback (it isn't, and can't be, while
  `DEFAULT_SETTINGS` always populates `modelDefaults.preview`). It now describes what it
  actually is: the single declaration, reached in practice through
  `settings.modelDefaults.preview`, with the `|| DEFAULT_PREVIEW_MODEL` arm in consumers
  (`backend/stylelocks.mjs:212`, `frontend/Story.jsx:207`) surviving as a last-resort guard
  for a settings object that omits `modelDefaults`.
- `backend/store.mjs` — imports `DEFAULT_PREVIEW_MODEL` from `../frontend/modelCatalog.js`
  and uses it for `DEFAULT_SETTINGS.modelDefaults.preview` in place of the string literal.

Import safety was verified before adding it: `modelCatalog.js` has **zero** imports and no
browser globals (`window`/`document`/`localStorage`/`navigator`), so there is no cycle and
no hazard evaluating it at module-init time — which matters here because `DEFAULT_SETTINGS`
is a module-level object literal, not lazily built. `providers.mjs`, `generate.mjs` and
`index.mjs` already import the same module from the backend.

Stray-literal sweep — `rg -n --text "flux/schnell|nano-banana-2" backend frontend` leaves
only catalog rows (`modelCatalog.js:49,50,57`) and the **edit** default
(`store.mjs:153`, `generate.mjs:212` → `'fal-ai/nano-banana-2/edit'`), which is a different
concept and was left alone.

Follow-up (not done — outside file ownership): the `CLAUDE.md` source-of-truth table should
name `frontend/modelCatalog.js` as canonical for the default preview model.
