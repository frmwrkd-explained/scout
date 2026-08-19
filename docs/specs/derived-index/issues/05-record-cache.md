# 05 — Per-file record cache, validated by stat

**Status:** open
**Blocked by:** None. Land [01](01-bench-harness.md) first or the effect is unmeasurable (cold is unchanged by design; the whole win shows up in the warm column).

## Problem

`readMd` (`store.mjs:40-47`) opens and gray-matter-parses a file on **every** call, and
deliberately disables gray-matter's own cache:

```js
const { data, content } = matter(fs.readFileSync(file, 'utf8'), { cache: false });
```

The comment at `store.mjs:41-44` is right and must stay: gray-matter's content-keyed cache
stores an **empty** result on the error path, so a malformed file that threw once would parse as
an empty record on the next read of identical content — silently losing the record and hiding
the corruption from `integrityReport()`.

The consequence is that there is currently no read amortisation anywhere in the backend. At the
measured ~0.29 ms per record, `/api/state` and every `/api/search` re-pay the full parse cost
for records that have not changed since the last request.

Meanwhile `fingerprint()` (`indexer.mjs:99-108`) **already stats every `.md` in the tree**, on
every debounced watch event and again every 30 seconds — and then collapses the result into one
summed integer at `indexer.mjs:105` and discards it. The exact information needed to invalidate
a per-file cache is already being collected and thrown away.

## What to change

1. **Cache `readMd`, validated by `statSync` on every read.** In `store.mjs`, next to `readMd`:
   a module-level `Map` from absolute path → `{ key, data, content }`, where
   `key = mtimeMs + ':' + size`. On each call, `statSync` the file; on key match return the
   cached entry, otherwise parse and store.

   A `statSync` is one syscall — roughly two orders of magnitude cheaper than a read plus a YAML
   parse — and it makes the cache **always correct without any invalidation messaging**. Do not
   be tempted to skip the stat and rely on `fs.watch` instead: `indexer.mjs:8-10` states plainly
   that watch is lossy, so a dropped event would serve stale records until the next 30 s sweep.

2. **Return copies, not references.** Callers spread the result (`{ ...data }` at
   `store.mjs:202`, `:270`, `:287`) but not universally, and `getSettings` (`store.mjs:162`)
   merges into it. A caller that mutates a cached object would corrupt every later reader.
   Return a structured clone (or shallow-clone `data` and hand back `content` as the immutable
   string it is) and say why in a comment.

3. **Never cache a throw.** Invariant 4. A file that fails to parse must fail again on the next
   read, or the quarantine paths (`store.mjs:200-206`, `:268-272`, `indexer.mjs:78-88`) stop
   reporting it. Cache successful parses only.

4. **`writeMd` evicts its own path.** `store.mjs:48-62`. This is not optional and it is not
   belt-and-braces — see the mtime-resolution note below.

5. **`setStorageRoot` clears the whole cache.** `store.mjs:30-37`. `helpers.freshRoot()`
   (`tests/helpers.mjs:10-16`) switches roots repeatedly inside a single process across 37 test
   files. Absolute-path keys mostly save you here, but `mkdtemp` paths are only mostly unique and
   the failure mode is random cross-test bleed that costs hours to diagnose. Clear it.

6. **Bound it.** A plain `Map` over a 25k-record corpus holds every parsed record forever. Cap at
   ~5,000 entries with simple insertion-order eviction (`Map` preserves it — delete the first key
   when over). No LRU library, no new dependency. Log nothing.

7. **`fingerprint()` retains the map.** In `indexer.mjs`, build
   `Map<absPath, mtimeMs + ':' + size>` and derive the existing summed return value from it, so
   `reconcile()`'s contract (`indexer.mjs:111-116`) and the `String(h) + ':' + count` shape are
   unchanged. Diff the map against the previous one to get **exactly which files changed**.
   Same syscalls as today, strictly more information.

   Use the diff to evict those paths from the record cache proactively, and expose it — ticket
   06 needs it to bump precise domains instead of the blanket `bump(['external'])` at
   `indexer.mjs:113`.

8. **Expose an off switch for tests:** an exported `setRecordCacheEnabled(false)` (or an env
   flag read at call time, not module load). Invariant 2 says a hit must be indistinguishable
   from a miss, and the only way to prove that is to run the same assertions both ways.

## Acceptance criteria

- [ ] Reading the same unchanged file 100 times performs 100 `statSync` calls and **1**
      `readFileSync`. Verify with counters.
- [ ] Touch the file (rewrite with different content) → the next read reflects the new content.
- [ ] Rewrite a file to **the same byte length within the same second** via `writeMd` → the next
      read reflects the new content. This is the eviction in step 4 doing its job; without it
      this test fails on exFAT.
- [ ] A malformed `.md` throws on every read, not just the first. `integrityReport()` reports it
      on two consecutive calls.
- [ ] Mutating the object returned by `readMd` does not affect the next read's return value.
- [ ] `setStorageRoot()` to a fresh root → a file at the same relative path in the new root
      returns the new root's content.
- [ ] With `setRecordCacheEnabled(false)`, the full test suite passes identically. Run it both
      ways in CI-less form: `node --test tests/*.test.mjs` twice.
- [ ] `fingerprint()` returns the same string as on current `main` for an identical tree — this
      is a refactor of its internals, not a contract change. Assert against a hardcoded value
      computed from a fixed fixture.
- [ ] Cache capped: read 6,000 distinct files, assert the map size stays ≤ 5,000 and the most
      recently read file is still cached.
- [ ] `npm run bench` — **warm** metrics for `listItems`, `listAllShots`, `listAssets` and
      `/api/state` drop sharply; **cold** metrics unchanged within the baseline band. If cold
      moved, something is wrong.
- [ ] `node --test tests/*.test.mjs` green.

## Notes

- **mtime resolution is the sharp edge.** exFAT stores modification times at **2-second**
  granularity, and this repo lives on `/Volumes/SSD` which is exFAT (`CLAUDE.md`). Two writes
  inside the same tick that produce the same file size are indistinguishable by `(mtime, size)`.
  Step 4's explicit eviction covers every write the app makes. An *external* editor rewriting a
  file to exactly the same size within the same tick would still be missed — but note that
  `fingerprint()` has this identical blind spot **today**, so this is a pre-existing limitation
  of the design, not a regression this ticket introduces. Document it in a comment; do not try to
  solve it with content hashing, which would cost more than the cache saves.
- `settings.md` will be cached like anything else. That is acceptable — `getSettings()` already
  holds the full cleartext object in memory on every call, and `publicSettings()`
  (`store.mjs:178-182`) is what guards the wire. But the cache must never be exposed through a
  route, a debug endpoint, or a log line. If you add any introspection for step 6's eviction,
  make it return sizes and paths, never values.
- Do not touch `revOf` (`store.mjs:330-335`). It hashes `data` and `content` for the conflict
  guard and is unrelated to cache keying. It also contains the literal NUL byte that makes this
  file invisible to plain `grep` — use `grep -a` / `rg --text` throughout this ticket.
- Resist caching at the `listX()` level here. That is ticket 06 and it needs domain revisions to
  be correct. This ticket is purely per-file.
