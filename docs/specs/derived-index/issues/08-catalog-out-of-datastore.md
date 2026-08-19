# 08 — `workspace/catalog/` out of the datastore into a cache dir

**Status:** open
**Blocked by:** None. Independent of every other ticket in this family — land it whenever.

## Problem

`workspace/catalog/` contains nothing the user made. Both of its contents are caches of remote
fal.ai state:

| Path | Bytes | Written by | Source |
|---|---:|---|---|
| `catalog/fal.md` | 505,243 | `catalog.mjs:71-72` | `GET https://api.fal.ai/v1/models` (`catalog.mjs:14`) |
| `catalog/schemas/*.md` (6 files) | 18,585 | `modelSchemas.mjs:175-179`, path at `:24` | per-model fal OpenAPI specs |

Together that is **523,828 of 895,428 total `.md` bytes in the storage root — 58.5%**.

`fal.md` is the worse offender: three frontmatter fields (`provider`, `synced`, `count`) and a
body that is `JSON.stringify(rows, null, 1)` of ~700 model objects. It is markdown in name only.

`workspace/` is the thing this whole app is built to keep portable — copied to a USB stick,
synced, backed up, `git`'d, handed to an agent. Half a megabyte of regenerable third-party JSON
rides along in every one of those operations.

It also gets walked and stat'ed by `fingerprint()` (`indexer.mjs:99-108`) on every sweep, and
gray-matter-parsed by `integrityReport()` (`indexer.mjs:72-90`) every time that runs — to verify
files that are not user records and cannot be meaningfully "recovered" if malformed. Re-syncing
takes seconds.

This is a classification bug, not a performance one. `readFalCatalog()` is reached from exactly
one route (`index.mjs:913`, Settings → Manage models), and `readSchemaCache()`
(`modelSchemas.mjs:164`) is on the generation path but reads one small file at a time.

## What to change

1. **Move the whole `catalog/` tree out of the storage root**, preserving its internal shape
   (`catalog/fal.json`, `catalog/schemas/<safe-id>.json`). Resolve the location the way the app
   already resolves overridable paths — `store.mjs:14-19` is the precedent, where `FRFG_CONFIG`
   and `FRFG_DATA` exist so a packaged Electron build can redirect to a writable per-user
   location. Add `FRFG_CACHE` in the same shape, defaulting to an OS cache dir
   (`~/Library/Caches/frameforge` on darwin, `~/.cache/frameforge` elsewhere) — **not** to a
   sibling of `workspace/`.

   Export the resolver from `store.mjs` next to `getStorageRoot()`. Both `catalog.mjs` and
   `modelSchemas.mjs` import it; neither builds the path itself.

2. **Plain JSON, not markdown.** There is no reason for gray-matter to be in either path. Keep
   the sync metadata as top-level keys — `{ provider, synced, count, models }` for the catalog,
   `{ provider, modelId, synced, fallback, schema }` for each spec. `readFalCatalog()`
   (`catalog.mjs:28-33`) and `readSchemaCache()` (`modelSchemas.mjs:164-173`) already return
   those shapes, so **no caller changes**: the route at `index.mjs:913` destructures
   `{ models, ...meta }` and keeps working.

3. **Memoise the catalog parse in-process**, keyed on mtime, same pattern as ticket 05. Half a
   megabyte of `JSON.parse` on every Manage Models open is worth avoiding. The per-model schemas
   are small; ticket 05's record cache no longer covers them once they stop being `.md`, so give
   them the same tiny mtime memo rather than leaving them uncached.

4. **No migration code — let it re-sync.** If the new cache is absent, return the existing empty
   shapes (`catalog.mjs:32`, and `modelSchemas.mjs`'s fallback path), which is exactly what the
   UI already handles for a never-synced install.

   Then retire the stale tree: rename `workspace/catalog/` to `workspace/catalog.bak/` on first
   read if it exists — **rename, never `rm`**, per this repo's never-destroy convention
   (`store.mjs:238` archive, `story.mjs:71` staged trash, `store.mjs:438` `.bak`). Do it once,
   guarded, not on every read. Surface a line in the Manage Models panel telling the user to
   re-sync.

5. **Confirm `.gitignore` still holds.** `workspace/` and `.env` are ignored today
   (`.gitignore:8-9`) and `CLAUDE.md` requires verifying they have never been in history before
   any push. The new cache dir lives outside the repo entirely, so nothing needs adding — verify
   rather than assume.

6. **Update `CLAUDE.md`.** Add a source-of-truth row for the provider catalog pointing at
   `catalog.mjs` + `modelSchemas.mjs`, noting it is a **mirror of a remote API** and not
   authoritative over `frontend/modelCatalog.js` (which stays the only model catalog for the
   app's own purposes, per the existing row). Add the cache location to "Generated / derived —
   never hand-edit", and write down the rule this ticket establishes:

   > `workspace/` holds what the user made. Caches of external state live outside it and are
   > safe to delete at any time.

## Acceptance criteria

- [ ] `readFalCatalog()` and `readSchemaCache()` return the same shapes as today for a populated
      cache, and the existing empty/fallback shapes when absent. `index.mjs:913` is unmodified.
- [ ] `syncFalCatalog()` and `writeSchemaCache()` write to the cache dir and **nothing** under the
      storage root. Assert by snapshotting the storage root's file list before and after.
- [ ] `FRFG_CACHE` overrides the location; unset falls back to the OS cache dir. Both tested.
- [ ] A fresh install with no cache shows Manage Models in its never-synced state, and syncing
      populates it.
- [ ] An existing `workspace/catalog/` is renamed to `workspace/catalog.bak/` on first read, once,
      and is not re-processed on the second read. Its contents are intact after the rename.
- [ ] `integrityReport().scanned` drops by 7 on the current live workspace (1 catalog + 6 schemas)
      and no longer includes any catalog file.
- [ ] Reading the catalog twice performs one `JSON.parse`.
- [ ] Generation still works end to end with a cold schema cache — `getModelSchema()`
      (`modelSchemas.mjs:197`) fetches, writes to the new location, and the second call reads it.
- [ ] `node --test tests/*.test.mjs` green. `tests/phase-model-schema.test.mjs` is the one that
      will notice — read it before starting, and expect to update whatever it asserts about the
      cache path.

## Notes

- This is hygiene, not speed. It is in this family because it is the same category error as
  tickets 03 and 04 — derived data living in the record store — and all three should be fixed
  with the one rule quoted in step 6.
- The `SchemaForm` contract is unaffected. `CLAUDE.md` says per-model settings are driven by the
  synced fal spec and that a model's resolutions/durations/aspects must never be hardcoded —
  that stays exactly true; only where the spec is *cached* changes.
- Do not fold `frontend/modelCatalog.js` into this. It is the curated app catalog, imported by
  both frontend and backend, and `CLAUDE.md` names it the single source of truth for models,
  providers, aspect→pixels and resolution tiers. This ticket touches the *mirror of fal's list*,
  a different thing with a confusingly similar name.
- `safe()` is used for schema filenames (`modelSchemas.mjs:24`) because model ids contain `/`.
  Keep that when switching to `.json` — `fal-ai/nano-banana-2` → `fal-ai_nano-banana-2.json`.
