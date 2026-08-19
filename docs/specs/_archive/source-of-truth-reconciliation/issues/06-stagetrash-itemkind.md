# 06 — Three `stageTrash` producers pass `kind` instead of `itemKind`

**Status:** resolved
**Blocked by:** None — can start immediately.

## The conflict

`trash.mjs` uses two different fields, by design:

- `kind` on `paths[]` entries means `dir` | `file` — `trash.mjs:34`
- `itemKind` on the staged entry means the domain type (`prompt`, `snippet`, `look`, …)

Most producers do this correctly (`index.mjs:578, 619, 655, 988, 1008` all pass `itemKind`).
Three pass a domain value under the `kind` key instead:

```
backend/stylelocks.mjs:151   { label: 'style lock ' + id, kind: 'style-lock' }
backend/remotion.mjs:403     { label: 'remotion preset ' + f, kind: 'remotion-preset' }
backend/story.mjs:69         { label: 'shot ' + id + ...,   kind: 'shot', pid, itemId: id }
```

## Correction to the original audit

The audit framed this as "`kind` vs `itemKind` conflict". It is not — the two fields are
distinct and both legitimate. `CLAUDE.md` already documents that. The actual defect is these
three call sites using the wrong key, which means style locks, remotion presets, and shots
land in the trash with no `itemKind` and a `kind` that collides with the `dir|file` vocabulary.

## The fix

Rename `kind:` → `itemKind:` at those three sites. Optionally normalize defensively in
`stageTrash()` so a stray `kind` on the entry (not on `paths[]`) is migrated rather than
silently accepted.

Check the restore path before changing anything — if anything reads `entry.kind` expecting
the domain value, it must change in the same commit.

## Acceptance

- All `stageTrash` producers pass `itemKind`.
- Restore/purge still work for style locks, remotion presets, and shots.
- 63/63 tests pass.

## Outcome

### Restore-path audit (done first, before any edit)

Traced every reader of `entry.kind` and `entry.itemKind`:

- `restoreTrash()` reads only `e.id` and `e.paths[].relativePath`. It never reads `kind` or
  `itemKind`. `purgeTrash()` / `purgeAllTrash()` read only `e.id`. Restore and purge are driven
  entirely by `paths[]`, so **no restore logic depended on the domain value** — the rename is
  behaviour-preserving for recovery.
- `paths[].kind` (`dir`|`file`, set at `trash.mjs:34`) is written but never read anywhere in the
  repo. It is informational only.
- The only consumer of the domain value is the frontend: `frontend/App.jsx:2379` renders
  `{(e.itemKind || 'file')}`. Before this fix, style locks, remotion presets, and shots displayed
  as "file" in the Trash page because their domain value was parked under the wrong key. The
  frontend already reads the correct field, so **no frontend change was needed**.

Net: the defect was cosmetic-plus-vocabulary (a stray entry-level `kind` shadowing the
`dir|file` word), not a broken restore. Fixed anyway, since the collision was a live trap.

### Changes

1. Renamed `kind:` → `itemKind:` at the three producers:
   - `backend/stylelocks.mjs:151` — `itemKind: 'style-lock'`
   - `backend/remotion.mjs:403` — `itemKind: 'remotion-preset'`
   - `backend/story.mjs:69` — `itemKind: 'shot'` (`pid` / `itemId` left untouched)
2. Added defensive normalization in `stageTrash()` (`backend/trash.mjs`). `meta` is now
   destructured as `const { kind: strayKind, ...rest } = meta` before the spread, and a stray
   entry-level `kind` is migrated to `itemKind` only when `itemKind` is not already set.

**Why the normalization is safe:** `paths[]` is constructed inside `stageTrash` from `fs.statSync`
and never sourced from `meta`, so an entry-level `kind` can never collide with the `dir|file`
discriminator. Previously `...meta` merely added `kind` as a sibling of `paths` — silently
accepted, and the exact trap that produced this ticket. Migrating instead of accepting means the
`kind` word now has exactly one meaning on a manifest entry, and any future caller that repeats
the mistake is corrected rather than left broken.

### Verification

Temp-root harness confirmed: `itemKind` set correctly; entry-level `kind` absent after staging;
`paths[0].kind` still `'file'`; `restoreTrash` round-trips both a correct and a legacy-style entry
back to their original locations.

### Follow-up

- The suite now has 84 tests, not 63 — other in-flight work added `phase-chat`, `phase-model-schema`
  and `phase6-gridsplit`. The "63/63" line above is stale as written.
- No test covers trash `itemKind` or the restore round-trip. Worth adding to a `phase*` test.
- Three `._*` AppleDouble files in `tests/` are picked up by `node --test` and fail as junk
  "tests". `CLAUDE.md` documents these as delete-on-sight; they are outside this ticket's
  ownership and were left in place.
