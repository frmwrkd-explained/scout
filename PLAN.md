# PLAN.md — M0 and M1

Covers **M0 · Spine** and **M1 · Data** only, per `START.md` Phase 1. Nothing past `T05` is planned here.

Written after Phase 0. Every number below was measured on this working copy, not recalled.

---

## 0 · Where things stand

| Phase | State |
|---|---|
| **0a · design** | Done. All 9 files in `design/`, audit in `design/EXTRACT.md`. |
| **0b · code spine** | Done. FrameForge copied in; exclusions and the `CLAUDE.md` collision recorded in `docs/decisions.md`. |
| **0c · tokens** | Done, and it was a no-op. 27 of 27 tokens identical. No commit to `styles.css` / `tokens.js` / `docs/DESIGN.md` because there is nothing to reconcile. |
| **baseline** | `npm ci` clean. `npm test` → **593 tests, 591 pass, 2 skipped, 0 fail**, 40s. This is the "before" number the strip is measured against. |

The two skips are FrameForge's Windows-only launch paths and are expected.

---

## 1 · M0 — the strip

`T01` is one task but not one edit. Executed in this order, because each step's output is what makes the next step's damage visible.

| # | Step | Touches | Why here |
|---|---|---|---|
| 1.1 | Sweep `._*`, confirm baseline green | — | The trap is live on this volume (§4.1). Establish it before changing anything. |
| 1.2 | **Decouple the six** — excise the named symbols listed in §3.1 from `search.mjs`, `feedback.mjs`, `board.mjs` | 3 files, ~8 call sites | The delete in 1.3 is impossible until these are gone. Doing it first means 1.3 is a pure `rm`. |
| 1.3 | Delete the film backend | 13 files, ~3,700 lines | `screenplay.mjs` is not among them — it does not exist (§3.2). |
| 1.4 | Extract `assetUrl` out of `Moodboard.jsx` into `frontend/assets.js`, repoint its 7 importers | 8 files | Otherwise 1.5 breaks `entities.js`, `Library.jsx`, `AssetBoards.jsx` and six more (§3.4). |
| 1.5 | Delete the film frontend | 14 files, ~6,800 lines | Includes cutting the `SequenceEditor` branch out of `Composer.jsx` (§3.5). |
| 1.6 | Unmount what is gone from `App.jsx` (3,602 lines) and `Tools.jsx` / `ToolsSuite.jsx` | 3 files | `App.jsx` mounts `Timeline`, `StyleLab`, `Moodboard`, `RemotionLibrary`; the tab row is `projTabIds()`, not `projectTabs()` (§3.7). Tab list and digit-shortcut list are one list — FrameForge's own comment records them drifting apart once. |
| 1.7 | Ring-2 verdicts — delete the 14 unreachable film modules, keep the 9 the keep-set needs | 14 files | §3.6. Neither T01 list names these. |
| 1.8 | Rename: `FrameForge` → `Scout` (240 hits / 75 files), `FRFG_` → `SCOUT_` (78 hits / 29 files, 22 distinct vars) | wide, mechanical | `SCOUT_DATA` is the one that matters — `tests/_env.mjs` and every test depend on it. |
| 1.9 | **Repoint the two live FrameForge endpoints** | `package.json`, `backend/licence.mjs` | §3.8. A rename does not move a URL. |
| 1.10 | Ports 5175/5176 → **5178/5177** | `vite.config.mjs`, `backend/index.mjs`, `.claude/launch.json` | Proxy target stays `127.0.0.1`. |
| 1.11 | Delete orphaned tests, re-run | ~11 test files by name, more by import | Green is the gate, not a count. |
| 1.12 | `npm start` → empty Scout window, tokens intact | — | The M0 exit criterion. |

**Exit:** `npm ci && npm test` green with the film modules gone; `npm start` opens an empty Scout window. Both shown before M1 starts.

I will not refactor anything in M0. `App.jsx` at 3,602 lines will still be 3,602 lines minus deletions, and that is correct — T01 removes, it does not improve.

---

## 2 · M1 — the data layer

Backend and its `curl`-driven tests first, UI second, one task at a time. No batching.

### T02 · Collections and field types
- **New:** `backend/collections.mjs` — `FIELD_TYPES`, the 16 types from `docs/02_DATA_MODEL.md` §2 and **nowhere else**. Read/write `.scout/collections/<id>.md`. Validation: exactly one `primary`, at most one `gate: true` status field, relation targets resolve, options well-formed, unknown type → 400 naming the legal set.
- **New:** `backend/computed.mjs` — `rollup` / `formula` evaluated on read into `.scout/cache/computed.json`.
- **Touches:** `backend/index.mjs` (4 routes), `backend/store.mjs` (`.scout/` paths only — no change to `readMd`/`writeMd`).
- **Tests:** field-type completeness; the three validation rejections; **frontmatter beats the computed cache**; delete `.scout/cache/` and everything still resolves.
- **Demonstrate:** build the `guest` collection from the doc via `curl`; add a rollup counting findings; change the underlying data and watch it follow; write a conflicting value into frontmatter and watch frontmatter win.

### T03 · Documents, queries, saved views
- **New:** `backend/documents.mjs` — resolve a collection `query` (tag · path · frontmatter filter) to a document set. A document matches many collections and is never moved into one.
- **New:** `backend/views.mjs` — CRUD over `.scout/views/<collection>.json`; default view **inferred from shape** (status→board, date→list, primary media→gallery, else table).
- Subtables are a collection plus a bound parameter. One mechanism, no second storage.
- **Demonstrate:** two saved views over one collection return different rows; a subtable on a guest lists only her messages; delete `.scout/cache/` and everything still resolves.

### T04 · The document surface
First UI task. Built against T02/T03's routes, which exist by then.
- **New:** `DocumentSurface.jsx`, `PropertyRows.jsx`, `cells/` (one per field type), `Freshness.jsx`, `Meter.jsx`, `ConflictNotification.jsx`, `DiffView.jsx`.
- Properties **collapsed on open** (`docs/05_UI_SPEC.md` §2.1 — decision D1), summary highest, body at altitude 2, preference remembered per collection.
- **Demonstrate:** open a record — one human sentence is the first thing visible; expand properties; edit a select, a relation and a date; change the file on disk while it is open and resolve the conflict.

### T05 · The inspector
- **New:** `Inspector.jsx` — five sections in order, one expanded at a time, count on every collapsed header. `REFERENCED BY` (typed, shows the pointing field name) must not look like `LINKS` (prose, in/out kept apart). The design already does this correctly (decision D2).
- **Demonstrate:** a guest referenced by a territory, a learning and a project brief shows three entries with their field names.

**M1 exit:** a human hand-creates a collection, adds 10 records, saves two views, and opens a record's `.md` in Finder.

---

## 3 · Where I think the spec is wrong

`START.md` asks me to say this now rather than build around it. Seven items; **S1 is the one that blocks M0.**

### S1 · T01's keep-list and delete-list contradict each other

T01 step 4 says *"Keep and do not touch"* a named set. T01 steps 2–3 say delete another set. **Six modules are in both**, because the keepers import them:

| Doomed module | Imported by a "do not touch" keeper | Symbol | Uses |
|---|---|---|---|
| `story.mjs` | `search.mjs` | `listAllShots`, `getStory` | 2 + 2 |
| `story.mjs` | `board.mjs` | `listShots` | 3 |
| `video.mjs` | `feedback.mjs` | `videoToolsStatus` | 2 |
| `imageSize.mjs` | `board.mjs` | `imageSize` | 3 |
| `boardExport.mjs` | `board.mjs` | `exportBoardPng` (dynamic, one route) | 1 |
| `reel.mjs` | `boardExport.mjs` | `resolveShotMedia` | 3 |

T01 cannot be executed as literally written. Every coupling is small and named, so the fix is cheap — but it is an **edit to a "do not touch" file**, and I want that sanctioned rather than assumed.

**Proposed:** step 1.2 above. Drop the shot branch from `search.mjs`, the `videoToolsStatus` field from `feedback.mjs`'s envelope, and the shot-node path plus the PNG-export route from `board.mjs`. Scout's whiteboard node kinds (`docs/05_UI_SPEC.md` §5) contain no shot, so nothing Scout needs is lost.

### S2 · `backend/screenplay.mjs` does not exist

T01 step 2 lists it. Verified absent with a positive control — no backend file matches `/screen/i`, while `frontend/Screenplay.jsx` has 8 hits. Harmless, but it means the list was written from memory.

### S3 · `imageSize.mjs` is not film code and should be kept

53 lines that read width/height out of PNG/JPEG headers. Nothing film-specific. Scout needs it for the `file` field type (`docs/02_DATA_MODEL.md` §2), the `gallery` view, and the whiteboard's `image` node. **Proposed: move it from T01's delete list to the keep list.** This also removes one of S1's six conflicts outright.

### S4 · `Moodboard.jsx` is two things in one file

It exports the film mosaic UI (`Mosaic`, `Lightbox`, `BoardControls`, `AssetList`, `BulkBar`, …) used by 3 files — **and** `assetUrl`, used by 7, including `entities.js`, `Library.jsx`, `AssetBoards.jsx` and `Story.jsx`. Deleting the file wholesale breaks 10 importers, several of which Scout keeps. **Proposed: extract `assetUrl` into `frontend/assets.js` first (step 1.4), then delete.**

### S5 · `SequenceEditor` is imported by `Composer.jsx`

`docs/06_REUSE.md` calls `Composer` the component registry's centrepiece and T01 says do not touch it, but it imports `SequenceEditor` at line 53 and mounts it at line 1201. Same class of problem as S1, in the one file the reuse map is most protective of. **Proposed: cut the branch, leave everything else in `Composer.jsx` untouched.**

### S6 · Neither T01 list covers 23 of the 51 backend modules

Reachability from the keep-set: 29 of 51 modules are pulled in. Of those, **9 are named in neither list** (`generate`, `providers`, `batches`, `probe`, `library`, `launch`, `trash`, `userTools`, `licenceToken`), and **14 more are unreachable and also unnamed** (`actions`, `catalog`, `control`, `distill`, `enhance`, `env`, `groq`, `index`, `manifest`, `manual`, `modelSchemas`, `seed`, `snippetSeeds`, `vision`).

`env.mjs` and `index.mjs` are obviously keepers — the presence of those two in the "unreachable" set is just an artefact of `index.mjs` being the entry point rather than a dependency. The rest are the **image-generation layer**: Scout does not generate images, so most should go. **Proposed: I bring a per-module verdict table to step 1.7 for approval rather than deciding 23 modules silently.** The risk of guessing here is deleting something `agentRunner` / `jobs` / `sessions` need at M4.

### S7 · `docs/FRAMEFORGE_CLAUDE.md` cites a symbol that no longer exists

It names `frontend/App.jsx` `projectTabs()` as the canonical tab row. The symbol is `projTabIds()`. That file's own preamble warns its pointers drift; this is one. Not a Scout defect — recorded because I am told to trust that file and it is wrong here.

### S8 · Two live FrameForge endpoints survive a rename

Renaming product strings does not move a URL, and both of these are baked in with defaults:

- `package.json` → `build.publish[0].url` → `https://pub-04eb7fb87e564f54b1ffd045b6f5ddfb.r2.dev`. A packaged Scout with `autoDownload = true` would **auto-update itself into FrameForge**.
- `backend/licence.mjs` → `API_BASE` defaults to `https://agreeable-gnat-469.convex.site` — FrameForge's licence server.

`FRFG_FEEDBACK_URL` is fine: no default, and unset means reports queue locally.

**Proposed: step 1.9 blanks both to unset-or-Scout-owned before any packaging.** Flagging now because M0 ends at `npm start` and it would be easy to carry these to M5 unnoticed.

---

## 4 · Traps I am carrying forward

### 4.1 The `._*` sidecars are live here
This volume is exFAT, so macOS writes a `._X` sidecar beside almost every file. `npm test` runs bare `node --test`, whose discovery picks up `._phase-*.test.mjs` as real tests and fails them. I have already hit this once during Phase 0. **Sweep before every test run:**
```bash
find . -name "._*" -not -path "./node_modules/*" -delete
```
They regenerate within minutes; deleting is hygiene, not a fix. They must be gitignored — FrameForge's `.gitignore` came across with the copy and already has `._*`.

### 4.2 Do not "fix" `npm test`
`"test": "node --test"` with no path is deliberate. Node ≥22 resolves a directory argument as a module path and dies with `MODULE_NOT_FOUND` before running anything. That regression has shipped once already.

### 4.3 A zero-hit search is a claim
Used a positive control on every negative result in Phase 0. It caught two: `--include=*.mjs` unquoted in zsh (glob error, not "no matches"), and `projectTabs` genuinely absent rather than mis-grepped (S7).

### 4.4 The four store rules
`writeMd` uses `{content}`; `readMd` passes `cache:false`; every write is tmp+rename; only `records.mjs` writes documents. The first three are inherited working code in `backend/store.mjs` and M0 does not touch them. The fourth is a rule about a file that does not exist yet — `records.mjs` arrives at M2, and until then **nothing writes documents**, which I will keep true rather than adding a temporary writer in T02/T03 and removing it later.

---

## 5 · The port-don't-write register

From `docs/06_REUSE.md`. Re-implementing any of these is a defect. **Relevant to M0–M1 only**; the M2–M5 rows are listed so nothing gets written early by accident.

| From | What | Lands in | When |
|---|---|---|---|
| FrameForge `backend/store.mjs` | datastore, atomic writes, path safety, storage-root pointer | unchanged, in place | M0 — inherited |
| FrameForge `backend/indexer.mjs` · `search.mjs` | incremental index + search | in place, minus the shot branch (S1) | M0 |
| FrameForge `frontend/ui.jsx` | `Btn` `Card` `Eyebrow` `Empty` `Input` `Field` `Chip` `InlineEdit` | in place — **the registry** | M1, imported by every new surface |
| FrameForge `frontend/sx.js` | CSS-string → React style | in place — **the porting mechanism** for the design's inline styles | M1 |
| FrameForge `frontend/styles.css` `:root` · `tokens.js` · `docs/DESIGN.md` | the design system, verbatim | in place, unchanged (Phase 0c) | M0 |
| FrameForge `Composer.jsx` · `ComposerDock` · `Markdown` · `SnippetText` · `MentionText` · `VoiceInput` | the component registry | in place, minus the `SequenceEditor` branch (S5) | M1 |
| FrameForge `desktop/` · `updater.cjs` | Electron shell, packaging | in place, endpoints repointed (S8) | M0 |
| **Tesseract MD** | frontmatter property editor — typed rows above the body, `+ Add property` | `frontend/PropertyRows.jsx` — **pattern ported to React, not the Svelte file** | T04 |
| **Tesseract MD** | the 11 typed cell editors | `frontend/cells/` | T04 |
| **Tesseract MD** | relations as chips + picker | `frontend/cells/RelationCell.jsx` | T04 |
| **Tesseract MD** | table views, saved in-vault | `backend/views.mjs` + `frontend/TableView.jsx` | T03/T04 |
| **Tesseract MD** | **conflict UX — day one** | `frontend/ConflictNotification.jsx` + `DiffView.jsx` | T04 |
| **Tesseract MD** | backlinks split in two — *Links* vs *Referenced by* | `frontend/Inspector.jsx` | T05 |
| FrameForge `agentHome.mjs` | Index generator, isolated agent home | in place | M4 — not touched in M0/M1 |
| FrameForge `Board*` · `boardLayout.js` | the whiteboard | in place | M5 / T15 |
| Hermes `skillSuggestions` · `requests` · `budgets` · `/intake` | proposal state machine, gate, cost pre-flight, interview | M2 / M4 / M5 | read, never copied wholesale |
| Tencent | L0–L3 layering, batched `store/update/merge/skip`, async write queue | design only, M3 | **decay is inverted — Law 3** |

---

## 6 · Open questions

Full statements in `design/EXTRACT.md` §5. Each has an assumption I will proceed on if you would rather not answer — none of them block M0, and only **Q3** touches M1.

| # | Question | Blocks |
|---|---|---|
| **Q1** | `Territory`, `Pipeline`, `Record Detail`, `Review Deck` are drawn in a 48px-top-nav shell; `docs/05_UI_SPEC.md` §1 specifies the 210px rail. Re-host all four in the rail? | M3/M4 |
| **Q2** | `Record Detail` (576px slide-over) and `Scout` (full-pane) are two presentations of one record. Which is canonical? | T04 |
| **Q3** | `Pipeline` sources stages from `config/guest-research.md`; `docs/02_DATA_MODEL.md` §2 says stages are the options of the one `gate: true` status field. Is `config/guest-research.md` demo data? | **T02/T03** |
| **Q4** | Light mode is undesigned, and §4's table has no light counterpart for `--accent-05/12/35/60`. | M5 |

And the one from §3 that needs a yes rather than an assumption:

| **S1 + S6** | Sanction for editing three "do not touch" files (`search.mjs`, `feedback.mjs`, `board.mjs`) to make the delete possible, and for bringing you a 23-module verdict table at step 1.7 instead of guessing. | **M0** |

---

## 7 · What I am not doing

- Not refactoring during M0. T01 removes.
- Not building `records.mjs` early. The four write verbs are M2; until then nothing writes documents (§4.4).
- Not building any M1 screen before its route exists and answers `curl`.
- Not implementing light mode, the whiteboard, GOALS, MEMORY, WHAT THEY KNOW or FILES. All M3–M5.
- Not touching `frontend/styles.css` `:root`. Phase 0c proved there is nothing to change, and a hue change needs the owner.
