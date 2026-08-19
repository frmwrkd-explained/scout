# 05 — `_folders.md` control file may be exposed as a user asset

**Status:** resolved
**Blocked by:** None — but verify the premise first.

## The claim

`workspace/projects/*/context/_folders.md` is a control manifest owned by
`backend/memory.mjs` (`memory.mjs:7`, `memory.mjs:17` `foldersPath`) — a per-folder map
`{ folderName: 'asset' | 'reference' }`. It is not user content.

The audit reported that `library.mjs` `listAssets` may enumerate it as if it were a user
asset, making it renameable/deletable through the assets UI. Deleting it silently resets
every folder classification in the project.

## Verify before fixing

**This premise was not independently confirmed** during the cleanup pass. Establish first:

1. Does `listAssets` actually surface files from `context/`, or only from asset scopes?
2. Can `assetPath()` resolve a path that lands on `_folders.md`?

If neither holds, close this ticket as `[STALE]` with the evidence. Do not implement a
filter for a code path that cannot be reached.

## If confirmed

Export a `CONTROL_FILES` set from `memory.mjs`, filter it in `library.mjs` `listAssets`, and
guard `assetPath()` so delete/rename/move cannot target it. Import the same constant wherever
`store.mjs` needs it rather than re-listing the filenames.

## Acceptance

- Either a filter with a test, or a `[STALE]` closure with evidence.
- If fixed, exactly one declaration of the control-file set.
- 63/63 tests pass.

## Outcome

**NOT stale — premise confirmed empirically, not just by reading.**

Both verification questions answered yes:

1. `library.mjs` `scopeDir(scope)` returns `contextDir(scope)` for any non-`library` scope,
   and `memory.mjs` `foldersPath` writes `_folders.md` at the root of exactly that directory.
   `listAssets` filters only dotfiles (`startsWith('.')`) and `.meta.md` sidecars — there is
   no extension whitelist and no underscore rule, so `_folders.md` fell straight through as a
   `type: 'note'` item.
2. `assetPath()` resolved it too.

Reproduced against a temp `FRFG_DATA` root: after `writeFolderKind('demo','moodboard','asset')`,
`listAssets('demo').items` was `["_folders.md"]` and `assetPath('demo','_folders.md','')`
returned a live path. Deleting through the UI would have staged the manifest to trash and
silently reset every folder classification in the project.

### Fix

- `memory.mjs` — which owns the file — exports the single declaration:
  `export const CONTROL_FILES = new Set(['_folders.md'])`.
- `library.mjs` imports it (no second list of filenames) behind one predicate,
  `isControlFile(folder, name)`, scoped to `!folder` so the guard applies only at the scope
  root. A user file genuinely named `_folders.md` inside a board folder stays a normal asset.
- Applied at three points: `listAssets` (root-level branch), `assetPath` (returns `null`, which
  makes `renameAsset`/`moveAsset`/`copyAsset` all throw "asset not found" for free), and
  `deleteAsset` (guarded explicitly — it builds its own path rather than going through
  `assetPath`, so it would otherwise have bypassed the guard).

Post-fix verification: `items: []`, `assetPath: null`, delete/rename/move each refused, and
`readFolderKinds` still returned `{"moodboard":"asset"}` afterwards.

### Follow-up

`store.mjs` has its own parallel context-asset surface (`listContext`/delete/rename around
lines 438–510) that does **not** consult `CONTROL_FILES` and may expose the same file through
a different route. Out of scope for this ticket's file ownership — worth a separate ticket.

No regression test was added: `tests/` was outside this change's file ownership. The guard is
verified by the reproduction above; a test belongs in the follow-up ticket.
