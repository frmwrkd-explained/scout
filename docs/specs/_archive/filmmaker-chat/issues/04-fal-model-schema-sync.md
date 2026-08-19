# 04 — FAL per-model spec sync and normalized schema route

**What to build:** Extend the catalog module (which already mirrors the FAL model
*list*) to also fetch each model's input spec from FAL's published per-endpoint
OpenAPI schema, cache it as a record under the workspace catalog directory with a
staleness stamp, and serve it through a new API route as a *normalized* schema:
field name, type, enum options, min/max/step, default, whether it's an image/video
reference input, and a display label. Sync on demand (route) and lazily on first
request per model. Models without a fetchable spec (Kie, Higgsfield, Arcads, custom)
return a minimal schema derived from the hand-authored catalog entry, or a marker
telling the client to fall back to generic format controls. This is the "smart
system" that makes settings UI follow the model spec instead of hand-written
per-model code.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] A route returns a normalized input schema for a FAL model id, fetched live once and cached in the workspace catalog dir — `GET /api/catalog/model-schema?id=<id>` → `backend/modelSchemas.mjs:getModelSchema`; cache at `catalog/schemas/<safe id>.md`
- [x] Enums (e.g. named resolutions), numeric ranges (e.g. duration), defaults, and reference-image inputs are represented distinctly — `normalizeFalOpenapi` / `normalizeField` (type: enum|integer|number|boolean|image|video|audio|string; `options`, `min`/`max`/`step`, `default`, `ref`)
- [x] Unsyncable models return the documented fallback marker without erroring — `fallbackSchema` (`fallback:true`, `source:'catalog'`); non-FAL providers + fetch failures route here, always HTTP 200
- [x] Re-sync refreshes a stale cache; offline serves the cache — `POST /api/catalog/model-schema/sync?id=<id>` forces refresh; 7-day TTL staleness stamp; offline serves stale cache flagged `offline:true`
- [x] A node --test script (temp FRFG_DATA, mocked fetch) covers normalization of at least one image and one video model schema plus the fallback path — `tests/phase-model-schema.test.mjs` (9 tests, `globalThis.fetch` stubbed, never hits network)
