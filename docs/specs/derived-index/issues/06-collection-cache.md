# 06 — Derived collections memoised on domain revision

**Status:** open
**Blocked by:** 05 — the per-file cache and the retained `fingerprint()` stat map must exist first.

## Problem

Ticket 05 removes the parse cost of an unchanged record, but every collection still walks the
whole tree on every call: a `readdirSync` per directory, a `statSync` per file, plus the
per-item work each collection layers on top.

`/api/state` (`index.mjs:297-323`) calls eleven of these per request, and `listAssets`
(`library.mjs:78-95`) additionally does a `statSync` **and** a sidecar `readMeta`
(`library.mjs:22-37`, called at `library.mjs:74`) **per item** — so a 2,000-asset library is
4,000+ syscalls per state fetch even with every record cached.

Meanwhile the revision bus already knows exactly which domains changed. `domainFor()`
(`index.mjs:115-127`) maps every mutating route to one of eleven domains, the middleware at
`index.mjs:128-137` bumps it on success, and `changedSince()` (`indexer.mjs:37-46`) already
serves deltas to clients. The server tells the client which domains are stale and then
recomputes everything anyway.

The one gap: `reconcile()` bumps the blanket `bump(['external'])` (`indexer.mjs:113`) for
external edits, because until ticket 05 it had no per-file detail to do better.

**This is the ticket that determines whether a future SQLite swap is a swap or a rewrite.** If
every derived collection goes through one memoisation point keyed on domain revision, stage 2
replaces that point's implementation and nothing above it changes. Build it carefully.

## What to change

1. **Per-domain revision counters in `indexer.mjs`.** Alongside the global `revision`
   (`indexer.mjs:16`), keep `Map<domain, number>`, incremented by `bump()` for each domain it
   receives. Export `revisionFor(domain)`. The global counter and the SSE payload keep their
   current behaviour exactly — `tests/phase4-index-sse.test.mjs` covers it.

2. **One memoisation helper, used by every collection.** Something of the shape
   `memoByDomain(domain, key, compute)` — returns the cached value when `revisionFor(domain)` is
   unchanged since it was stored, otherwise recomputes. **Exactly one implementation.** Per
   `CLAUDE.md`, a second one is how this repo's UI got into its current state; do not let the
   data layer follow.

   Put it in `indexer.mjs`. `store.mjs` already imports from `memory.mjs` in a documented safe
   cycle (`store.mjs:8-10`) — every reference used inside a function, never at module-init time.
   Follow that same discipline for the `store.mjs` ↔ `indexer.mjs` direction and state it in a
   comment.

3. **Adopt it at these call sites**, with the domain each already maps to via `domainFor`:

   | Function | File | Domain | Key |
   |---|---|---|---|
   | `listProjects()` | `store.mjs:193-208` | `projects` | — |
   | `listItems()` | `store.mjs:260-276` | `items` | — |
   | `listShots(pid)` | `story.mjs:27-39` | `shots` | `pid` |
   | `listAllShots()` | `story.mjs:115-119` | `shots` | — |
   | `listGenerations(pid)` | `generate.mjs:59-66` | `generations` | `pid` |
   | `listAssets(scope)` | `library.mjs:78-95` | `assets` | `scope` |

   `getStory(pid)` (`story.mjs:16-21`) is a single-file read and is already covered by ticket 05
   — leave it alone.

4. **`reconcile()` bumps precise domains.** Using the per-file diff from ticket 05 step 7, map
   each changed path to a domain by its position under the storage root — `projects/*/shots/*` →
   `shots`, `projects/*/items/*` → `items`, `projects/*/generations/*` → `generations`,
   `library/**` and `projects/*/context/**` → `assets`, `projects/*/project.md` and `brief.md` →
   `projects`, `settings.md` → `settings`. Anything unrecognised → `misc`, never silently
   dropped.

   **Derive this mapping from one table, and make `domainFor()` read the same vocabulary.**
   Two independent lists of domain names is exactly the "second source of truth" this repo
   forbids. If the cleanest form is a shared constant in `indexer.mjs` that `index.mjs` imports,
   do that and delete the duplicated knowledge from `domainFor`.

   The vocabulary is **already** split three ways and you have to reconcile it here, not defer it:
   `domainFor` declares ten domains plus `misc`; `bump('briefs')` appears five times in
   `backend/` for a domain `domainFor` never produces (it maps `/api/brief` to `projects`); and
   `reconcile()` adds `external`. Decide whether `briefs` is real — if it is, `domainFor` must
   produce it; if it is not, those five call sites should bump `projects`. Do not add a fourth
   list.

   Keep `['external']` as a fallback when the diff is unavailable (first sweep, or watch
   unsupported) so behaviour degrades to today's rather than to nothing.

5. **`setStorageRoot` clears the memo table.** Same reasoning as ticket 05 step 5, and here it is
   not optional: these caches are keyed on domain revision, not on path, so a root switch with an
   unchanged revision counter would serve the previous root's collections straight into the next
   test. This is the single most likely way to break the suite.

6. **Same off switch as ticket 05**, wired to the same flag, so the whole family can be disabled
   in one call for the invariant-2 comparison run.

## Acceptance criteria

- [ ] Two consecutive `listItems()` calls with no mutation between them perform **zero**
      `readdirSync` calls on the second. Verify with a counter.
- [ ] A `POST /api/items/...` between the two calls → the second call re-reads and reflects the
      change.
- [ ] A mutation in one domain does not invalidate another: bump `items`, then assert
      `listAllShots()` still serves from cache while `listItems()` recomputes.
- [ ] Editing a shot `.md` **externally** (write directly to the file, no HTTP) then calling
      `reconcile()` → `listAllShots()` reflects the edit, and the bump names `shots`, not
      `external`.
- [ ] An external edit to a path the mapping does not recognise bumps `misc` and still
      invalidates conservatively — assert nothing goes stale.
- [ ] `listShots(pid)` and `listGenerations(pid)` are keyed per project: mutating project A's
      shots does not force a recompute for project B. Assert with counters.
- [ ] `setStorageRoot()` to a fresh root → `listProjects()` returns the new root's projects, not
      the previous root's, **with the domain revision unchanged**. Construct this case
      deliberately; it is the trap.
- [ ] `/api/state` twice in a row with no mutation: the second response is byte-identical (except
      `revision`) and performs a small bounded number of syscalls rather than one per record.
- [ ] Full suite passes with the cache force-disabled and with it enabled — identical results.
- [ ] `tests/phase4-index-sse.test.mjs` passes untouched: the global revision, the SSE payload
      shape, and `?since=` deltas are unchanged by this ticket.
- [ ] `npm run bench` — warm `/api/state` drops by an order of magnitude at `--tier=large`; cold
      unchanged within the band.
- [ ] `node --test tests/*.test.mjs` green.

## Notes

- **`listAssets` is the one with the sharpest edge.** It reports `mtime` and `size` per item from
  a live `statSync`, so a memoised result can go stale in a way the others cannot — a sidecar
  rewrite changes `meta` without changing the asset file. Make sure `assets` is bumped for
  sidecar writes (`writeMeta`, `library.mjs:39-46`), not only for asset writes. Add a test for
  exactly this: analyse an image, assert the new description appears in the next `listAssets`.
- Do not memoise `scanSkillRepos()` (`store.mjs:377-398`). It walks paths *outside* the storage
  root — `~/.claude/skills` and whatever the user configured — which `fingerprint()` does not
  watch, so there is no correct invalidation signal available. Leave it uncached and say why in a
  comment, or someone will "finish the job" later and ship a bug.
- `getHistory()` (`store.mjs:367-374`) reads one file per day and is naturally bounded. Not worth
  a domain; ticket 05 already covers it.
- Keep the memo values immutable or cloned on the way out, same reasoning as ticket 05 step 2.
  These are arrays that callers sort and spread — `search.mjs` does both.
