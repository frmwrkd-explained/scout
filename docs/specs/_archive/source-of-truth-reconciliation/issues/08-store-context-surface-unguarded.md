# 08 — `store.mjs` has a second, unguarded context-file surface that hard-deletes

**Status:** resolved 2026-08-02. `CONTROL_FILES` now has one declaration, in
`backend/store.mjs` next to `contextDir` and the clean* helpers, and `memory.mjs`
re-exports it — no new import edge, `store <- memory` cycle not deepened. Both
`deleteContextFile` and `contextFilePath` consult it, root-scope only, so a same-named file
inside a board folder stays an ordinary deletable asset. Reachability question answered:
the `replace` argument at the `POST /api/context/:pid/note` route IS user-controlled and
reaches the `fs.rmSync` unmodified, so this was live, not theoretical. Proven by execution
against a temp `FRFG_DATA`, per this ticket's own acceptance note —
`tests/phase-regressions.test.mjs` carries both cases plus the guard's non-over-reach.
**Blocked by:** 05 — resolved, and this is its unfinished other half.

## The conflict

Ticket 05 added `CONTROL_FILES` (`backend/memory.mjs:25`) and guarded the `library.mjs`
path so `_folders.md` cannot be listed, resolved, or deleted as if it were a user asset.

But `backend/store.mjs` implements a **parallel** context-file surface over the same
directory, and it knows nothing about `CONTROL_FILES`:

```
store.mjs:440  export const contextDir = pid => path.join(R(), 'projects', safeScope(pid), 'context');
store.mjs:490  fs.rmSync(path.join(contextDir(pid), cleanFolder(folder), cleanName(name)), { force: true });
store.mjs:493  const p = path.join(contextDir(pid), cleanFolder(folder), cleanName(name));
```

`grep -an "CONTROL_FILES" backend/store.mjs` → no match. Unguarded.

## Why this is worse than what 05 fixed

`library.deleteAsset` moves to staged trash — recoverable. `store.mjs:490` is
`fs.rmSync(..., { force: true })` — **irreversible**. Deleting `_folders.md` silently resets
every folder's asset/reference classification for that project, with no undo.

`deleteContextFile` is live, not dead code: `backend/index.mjs:1017` calls it on the replace
path (`if (replace && replace !== saved.name) deleteContextFile(...)`).

## Reachability

Lower than 05's, but non-zero. The project DELETE route at `index.mjs:988` correctly uses
`stageTrash(..., itemKind: 'context')`. The exposure is the `replace` argument at
`index.mjs:1017` — trace whether it is user-controlled before deciding severity. Do that
first; if it turns out unreachable, close this `[STALE]` with the evidence rather than
adding a guard to the canonical datastore file for nothing.

## The fix — mind the import cycle

The obvious move (import `CONTROL_FILES` into `store.mjs` from `memory.mjs`) **deepens an
existing cycle**: `memory.mjs` already imports `store.mjs`. `DEFAULT_SETTINGS` is a
module-level literal evaluated at init, so a cycle here is a real hazard, not a style point.

Preferred direction: **declare `CONTROL_FILES` in `store.mjs`** — it already owns `paths`,
`safe`/`safeScope` and `contextDir`, so the control-file vocabulary belongs with it — and have
`memory.mjs` re-export it for its existing consumers. That keeps one declaration and adds no
new import edge.

Then guard `deleteContextFile` and `contextFilePath` the same way `library.mjs` does:
control files at the scope root only (`!folder`), never a same-named file inside a board folder.

## Acceptance

- `CONTROL_FILES` has exactly one declaration; `library.mjs` and `store.mjs` both consult it.
- No new import edge into `store.mjs`, and no deepening of the `store ↔ memory` cycle.
- `_folders.md` cannot be reached by `deleteContextFile` / `contextFilePath`.
- Proven by execution against a temp `FRFG_DATA`, not by reading — the file does not exist
  until `writeFolderKind` runs, so a filesystem check alone gives a false "not exposed".
- Full suite passes (81 as of 2026-07-19).
