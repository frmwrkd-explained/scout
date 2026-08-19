# 07 — `search.mjs` `rows()` on the cache, haystacks precomputed

**Status:** open
**Blocked by:** 06 — the memoised collections are what `rows()` will be built on.

## Problem

`search()` (`search.mjs:136-153`) calls `rows()` unconditionally at `search.mjs:138`, and
`rows()` (`search.mjs:42-115`) rebuilds the **entire searchable corpus in memory on every
query**:

- `listProjects()`, plus `getStory()` for every project
- `listAllShots()`
- `listGenerations()` for every project
- `listItems()`
- `listAssets()` for `'library'` **and every project scope** (`search.mjs:99-112`)

Tickets 05 and 06 make the underlying reads cheap, but `rows()` still does its own work on top
on every keystroke: for each record it builds a `location` object, a `fields` object, and
lowercases and joins a `haystack` string (`search.mjs:66`, `:80`, `:93`, `:107`). At
`--tier=large` that is ~25,000 string concatenations and `toLowerCase()` calls per query, all of
it identical to the previous query's.

The scoring loop (`search.mjs:143-149`) then allocates a spread copy of every matching row
before sorting and slicing to a 60-item page (`search.mjs:151`).

## What to change

1. **Memoise `rows()` on the union of the domains it reads** — `projects`, `shots`,
   `generations`, `items`, `assets` — using the ticket 06 helper. Recompute only when one of
   them moves. Do not invent a second memo mechanism.

2. **Build rows per domain, not as one blob.** Five separately-memoised row groups, concatenated
   on read, so that adding one asset does not rebuild every shot and generation row. The
   concatenation is cheap; the row construction is not.

3. **Precompute `haystack` once, at row-build time.** It already is built there — the point is
   that it now survives across queries instead of being rebuilt per keystroke.

4. **Stop copying every match.** `search.mjs:147` pushes `{ ...row, score }` for each match. Sort
   indices or `[row, score]` pairs and only build the response objects for the 60 rows that
   actually get returned (`search.mjs:151` already strips `haystack`/`fields`/`score` at that
   point). At `--tier=large` a broad query matches thousands of rows and allocates a full copy of
   each to return 60.

5. **Do not change the query language, the scoring, the filters, or the response shape.**
   `parseQuery` (`search.mjs:13-30`), `matchFilters` (`search.mjs:117-134`), the `ratingMatch`
   comparators, the `location` objects, and the `{ total, cursor, nextCursor, results }` envelope
   all stay exactly as they are. This ticket is about when work happens, not what it computes.
   `tests/phase9-search.test.mjs` should pass without a single edit — if it needs one, something
   has drifted.

6. **Keep the secret exclusion explicit.** `search.mjs:1-4` records the Phase 9 rule that
   `settings.md` is deliberately never imported or scanned here. Ticket 05 caches it like any
   other file, so the temptation to "just iterate the record cache" to build rows is now real and
   would quietly break the rule. Build rows from the collection functions, never from the record
   cache directly, and restate the rule in a comment at the memo site.

## Acceptance criteria

- [ ] Two identical consecutive queries: the second builds zero rows. Verify by counting
      invocations of the row-construction path.
- [ ] Two *different* queries with no mutation between them: rows are built once total, not once
      per query.
- [ ] Adding one asset rebuilds only the asset row group — assert the shot/generation/item groups
      were not recomputed.
- [ ] A mutation in each of the five domains invalidates the search results correspondingly.
      Five assertions, one per domain: mutate, re-query, confirm the new record is findable.
- [ ] An **external** edit to a shot `.md` followed by `reconcile()` makes the change findable
      via `/api/search` — this exercises the ticket 06 domain mapping end to end.
- [ ] `tests/phase9-search.test.mjs` passes **unmodified**.
- [ ] `settings.md` content is not findable through `/api/search` under any query, including
      searching for a known API key value. Add this assertion explicitly — it is the Phase 9 rule
      and it now has a new way to regress.
- [ ] A query matching 5,000 rows with `limit: 60` allocates ~60 result objects, not 5,000.
      Assert on the response, and check the allocation claim with the bench rather than a unit
      test.
- [ ] `npm run bench --tier=large` — both `search` metrics drop by an order of magnitude warm;
      cold within the band.
- [ ] `node --test tests/*.test.mjs` green.

## Notes

- Confirm before starting whether the frontend calls `/api/search` on every keystroke or debounces.
  Grep the search surface with `-a`/`--text`. If it is live-per-keystroke, this ticket is the
  difference between a usable and an unusable search at scale; if it is debounced, it is still
  worth doing but reprioritise it below 05/06.
- Scoring stays a linear scan over rows. That is correct at this scale and it is deliberately
  **not** what this ticket changes. Ranked full-text is the stage-2 (SQLite FTS5) job described
  in `spec.md` — do not start hand-rolling BM25 here.
- The five row groups map one-to-one onto the domains in `domainFor()` (`index.mjs:115-127`).
  If a sixth searchable record type is ever added, it needs a domain there and a group here —
  note that adjacency in a comment so the two do not drift.
