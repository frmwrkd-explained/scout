# 03 — `activity.md` → NDJSON append log

**Status:** open
**Blocked by:** None — can start immediately.

## Problem

`store.mjs:347-352`:

```js
export function appendActivity(ev) {
  let data = { events: [] };
  try { data = readMd(paths.activityMd()).data; } catch { /* none */ }
  const events = [{ ts: Date.now(), ...ev }, ...(data.events || [])].slice(0, 60);
  writeMd(paths.activityMd(), { events }, 'Recent activity, newest first…');
}
```

Every mutation in the app reads the file, YAML-parses it, prepends one object, re-serialises
**all 60 events**, and writes the whole thing back. `workspace/activity.md` is 10,800 bytes
today and it is rewritten in full on every project create, every generation, every edit.

No human edits this file and no agent reads it as prose. It is an append-only event stream
stored as a YAML array, and the 60-item cap exists only because the write is O(n) — the UI
choosing to show 60 is a display decision that has leaked into the storage format.

There is a second cost that is easy to miss. `activity.md` is a `.md` file inside the storage
root, so it is collected by `walkMd` and stat'ed by `fingerprint()` (`indexer.mjs:99-108`).
Every rewrite changes its mtime and size, which changes the fingerprint, which makes
`reconcile()` fire `bump(['external'])` (`indexer.mjs:113`) — telling every connected client to
refetch everything. The route that caused the activity entry **already** bumped its own domain
via the middleware at `index.mjs:128-137`. So each mutation currently produces a second,
spurious, whole-app refetch signal a fraction of a second later.

## What to change

1. **New file `workspace/activity.ndjson`** — one JSON object per line, oldest first, appended
   with `fs.appendFileSync`. Not `.md`. The extension matters:
   - `walkMd` (`indexer.mjs:57-68`) collects `.md` only, so the log is correctly excluded from
     `integrityReport()` — it is not a gray-matter record and would otherwise have to be
     special-cased.
   - `fingerprint()` uses the same walk, so appends no longer perturb the fingerprint and the
     spurious `bump(['external'])` described above goes away.

   Keep the writer in `store.mjs` next to the existing one; do not add a new module.

2. **`appendActivity(ev)`** becomes: build `{ ts: Date.now(), ...ev }`, `JSON.stringify`, append
   with a trailing `\n`. `fs.mkdirSync` the parent first (the storage root may not exist on first
   run — `writeMd` currently handles this at `store.mjs:49`).

3. **`getActivity()`** reads the file, splits on `\n`, drops empty lines, `JSON.parse`s each
   inside a `try` (**skip** unparseable lines rather than throwing — a torn final line from a
   crash mid-append must not break `/api/state`), takes the last 60, and **reverses** so the
   return value stays newest-first. The contract at `index.mjs:309` does not change.

4. **Compaction.** Reads are O(file), so the log cannot grow forever. On append, if the file
   exceeds **2000 lines** (check cheaply — track an in-module counter, or `statSync` size against
   a byte threshold), rewrite it to the last 500 lines via tmp+rename, matching the atomic write
   pattern at `store.mjs:55-61`. Amortised O(1) writes, bounded reads.

5. **Migration.** On first `getActivity()` where `activity.ndjson` is absent and `activity.md`
   exists, read the old frontmatter array, write it out as NDJSON oldest-first, and rename
   `activity.md` to `activity.md.bak`. Do not delete it — this repo's convention is that nothing
   is ever destroyed (`store.mjs:238` archive, `story.mjs:71` staged trash, `writeSkillFile`'s
   `.bak` at `store.mjs:438`). Migration must be idempotent and must not run on every read.

6. Add `activity.ndjson` to the paths table at `store.mjs:65-75` rather than building the path
   inline anywhere.

## Acceptance criteria

- [ ] `appendActivity` performs no read of the log in the common case. Verify with a
      `readFileSync` counter: 100 appends → 0 reads (compaction may `statSync`, which is fine).
- [ ] 100 `appendActivity` calls followed by `getActivity()` returns 60 events, newest first,
      and the newest is the 100th appended.
- [ ] Appending 2500 events leaves the file at ≤ 2000 lines and `getActivity()` still returns the
      correct newest 60.
- [ ] A hand-corrupted final line (truncate the file mid-object) does not throw — `getActivity()`
      returns the parseable events and `/api/state` still responds 200.
- [ ] Migration: seed a root with a legacy `activity.md` holding 5 events, call `getActivity()` →
      5 events returned in the same order as before, `activity.ndjson` exists, `activity.md.bak`
      exists, `activity.md` does not. Call it again → no re-migration, no duplicates.
- [ ] `fingerprint()` (`indexer.mjs:99`) returns the same value before and after 10
      `appendActivity` calls, proving the spurious external bump is gone.
- [ ] `npm run bench` shows `appendActivity × 100` dropping substantially; no other metric
      regresses.
- [ ] `node --test tests/*.test.mjs` green. `tests/phase4-index-sse.test.mjs` is the one most
      likely to notice the bump change — read it before starting.

## Notes

- Ordering flips on disk (oldest-first) but **not** in the API. `getActivity()` still returns
  newest-first. Do not push the reversal onto the frontend; that would be an HTTP contract change
  and this ticket is not one.
- The 60-item cap moves from the storage layer to the read layer, where it belongs. If the UI
  later wants 200, that becomes a one-line change instead of a data migration.
- Do not generalise this into a shared "append log" helper yet. Ticket 04 does the same thing to
  `costs.md`; extract the common helper **then**, with two real call sites, rather than guessing
  the abstraction now from one.
