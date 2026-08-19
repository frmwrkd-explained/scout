# 02 — `getShot` reads one file — kills the O(n²) reorder

**Status:** open
**Blocked by:** None. Land [01](01-bench-harness.md) first if you want the before/after number, but this ticket does not depend on it.

## Problem

`story.mjs:40`:

```js
export function getShot(pid, id) { return listShots(pid).find(s => s.id === id) || null; }
```

`listShots(pid)` (`story.mjs:27-39`) reads and gray-matter-parses **every** `.md` in the
project's `shots/` directory. So fetching one shot parses all of them.

It compounds three ways:

1. **`patchShot` parses the target file three times.** `patchShot` (`story.mjs:64-69`) calls
   `getShot` (→ full directory scan), then `writeShot` (`story.mjs:44-63`), which opens the same
   file again at `story.mjs:48` to merge previous frontmatter.

2. **`reorderShots` is O(n²).** `story.mjs:75-94` calls `listShots` once, then calls `patchShot`
   for each id — and each of those runs another full `listShots`. For n shots that is n+1
   directory scans of n files each. A 100-shot reorder is ~10,000 md parses to write 100 files.
   At the spec's measured ~0.29 ms per record that is roughly **3 seconds of pure YAML parsing**
   for a drag-and-drop.

3. **`duplicateShot`** (`story.mjs:95-104`) calls `getShot` then `listShots` — two full scans
   where one would do.

The file already knows how to address a single shot: `shotMd(pid, id)` at `story.mjs:13`.
`getShot` just doesn't use it.

This needs no cache and no new infrastructure. It is a lookup written as a scan.

## What to change

1. **`getShot` reads its own file.** Build the path with the existing `shotMd(pid, id)` helper,
   `fs.existsSync` guard, `readMd`, and return the same shape `listShots` produces —
   `{ ...data, proj: pid, log: content.trim() }`. Return `null` on a missing file *and* on a
   parse error, matching today's behaviour (`listShots` swallows unreadable shots at
   `story.mjs:35`, so a malformed shot currently makes `getShot` return `null` via `.find`
   missing it — preserve exactly that).

   **The id must go through `safe()`**, which `shotMd` already does. Do not build the path by
   hand; that is how a path-traversal regression gets introduced (see `store.mjs:76-80` for why
   this matters).

2. **`writeShot` accepts the already-read record.** Add an optional parameter so `patchShot` can
   hand over the frontmatter it just read instead of making `writeShot` re-open the file at
   `story.mjs:48`. Keep the no-argument path working unchanged — `writeShot` is called directly
   from `replaceShots` (`story.mjs:113`) and from routes.

3. **`reorderShots` reuses its own `listShots` result.** It already has every shot in `byId`
   (`story.mjs:77`). Write each changed shot directly rather than routing through `patchShot`,
   or pass the known record through the parameter added in step 2. Either way the function must
   end at **one** directory scan plus one write per changed shot.

   Preserve the current semantics exactly: shots the client didn't mention keep their relative
   order at the end (`story.mjs:88-92`), unchanged `no` values skip the write
   (`story.mjs:84-85`, `:90`), and the return value is a fresh `listShots(pid)`.

4. **`duplicateShot`** uses the single-file `getShot` and keeps its one `listShots` call for the
   max-`no` computation.

## Acceptance criteria

- [ ] `getShot(pid, id)` opens exactly one file. Verify by monkey-patching `fs.readFileSync` in a
      test to count calls: seed 20 shots, call `getShot` once, assert the count is 1.
- [ ] `reorderShots` on a 20-shot project performs at most 21 record reads total (1 scan + at most
      1 re-read per written shot), down from ~420. Same `readFileSync` counter technique.
- [ ] `getShot` returns `null` for an id that does not exist, and `null` for a shot whose file is
      malformed — same as today.
- [ ] `getShot(pid, '../../settings')` does not escape the shots directory. Add this test; it
      passes today only because `shotMd` applies `safe()`, and the whole point of this ticket is
      that a path is now being built where one wasn't.
- [ ] Reordering preserves ids and only rewrites `no` — the existing compat rule at
      `story.mjs:74` ("ids stay stable"). The existing shot-board tests must pass untouched:
      `tests/phase-shot-board.test.mjs`, `tests/phase-storyboard-workflow.test.mjs`.
- [ ] A shot with an unchanged `no` is not rewritten — assert its file mtime is unchanged after a
      reorder that doesn't move it.
- [ ] `npm run bench --tier=large` shows `reorderShots` dropping by at least an order of
      magnitude; every other metric within the baseline band.
- [ ] `node --test tests/*.test.mjs` green.

## Notes

- This is the highest-impact single change in the family and it touches one file. It is
  deliberately first after the harness.
- `getShot` is also called from routes in `index.mjs` and from `generate.mjs`/`batches.mjs`
  paths — grep with `-a`/`--text` before assuming the call sites, since `store.mjs` is invisible
  to plain `grep` (`CLAUDE.md`). The signature does not change, so no call site needs editing;
  this is a note for verification, not for edits.
- Do not "fix" `listShots` to cache. That is ticket 05/06's job and doing it here would create
  the second implementation this repo keeps warning about. This ticket is purely about not
  calling `listShots` when a single file is wanted.
- The same shape exists in `store.mjs` and was already fixed there — `getItem(pid, id)`
  (`store.mjs:281-289`) reads exactly one file and its comment explains why the global scan was
  removed. `getShot` is the one that never got the same treatment. Follow `getItem`'s pattern.
