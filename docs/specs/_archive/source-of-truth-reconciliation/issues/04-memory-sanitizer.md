# 04 — `memory.mjs` pid sanitizer is weaker than `safeScope`

**Status:** resolved
**Blocked by:** None — can start immediately.

## The conflict

Two project-id sanitizers with different semantics:

```
backend/memory.mjs:15  pid => path.join(getStorageRoot(), 'projects', String(pid).replace(/[/\\]/g, ''))   // DENYLIST
backend/store.mjs:78   export function safeScope(s) { return String(s || '').replace(/[^\w-]+/g, ''); }    // ALLOWLIST
```

Divergent outputs:

| pid | memory.mjs | safeScope | effect |
|---|---|---|---|
| `my.project` | `my.project` | `myproject` | different directory |
| `a b` | `a b` | `ab` | different directory |
| `..` | `..` | `` | `path.join(root,'projects','..')` === `root` — traversal |

## Not a live hole — do not panic-fix

Every caller is a route in `registerMemoryRoutes` (`memory.mjs:73-102`) using a `:pid` route
param, and `backend/index.mjs:174` installs `app.param('pid', ...)` validating against
`SLUG = /^[\w-]+$/` (`index.mjs:173`). Hostile pids are rejected with 400 before `memory.mjs`
ever runs. This is **defense-in-depth only**.

## Why it wasn't auto-unified

Blindly replacing the denylist with `safeScope` would change which directory an existing
project resolves to, for any project whose id contains `.` or a space — orphaning real user
data under `workspace/projects/`. That is why this is a ticket and not part of commit `986ee02`.

## The fix

1. First establish whether any live project id is not slug-clean:
   `ls workspace/projects/ | rg -v '^[\w-]+$'`
2. If none (expected), switch `memory.mjs:15` to `safeScope` and delete the local sanitizer.
3. If any exist, a migration is required — do not proceed without one.

## Acceptance

- One project-id sanitizer in the codebase, or a comment on `memory.mjs:15` explaining why
  it must differ.
- The `app.param` SLUG guard stays — it is the real defense.
- 63/63 tests pass.

## Outcome

Step 1 (migration check) came back clean. Live project ids are `fn`, `neon`, `orb`,
`the-last-ferry`, plus three `_archive-<ts>-<slug>` dirs — every one matches `/^[\w-]+$/`,
so `safeScope` relocates nothing. No migration needed.

Done: `backend/memory.mjs:15` now reads

```js
const projDir = pid => path.join(getStorageRoot(), 'projects', safeScope(pid));
```

with `safeScope` imported from `./store.mjs` and the local denylist deleted. There is now
exactly one project-id sanitizer in the codebase.

Worth recording: this was more than cosmetic. `store.mjs:438` `contextDir` already used
`safeScope`, so for any pid containing `.` or a space, `memory.mjs` and `store.mjs` were
resolving to **different directories** — `foldersPath('a.b')` wrote its manifest under
`projects/a.b/context/` while the boards it classified lived in `projects/ab/context/`.
Verified fixed: `foldersPath('a.b')` now lands in `projects/ab/`.

The `app.param('pid')` SLUG guard in `index.mjs` was left untouched, as specified — it
remains the real defense and this change is defense-in-depth only.

Follow-up: none.
