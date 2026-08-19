# Decisions

One entry per ambiguous choice made during the build: the question, the choice, and the reason. Newest first.

---

## 2026-08-19 · Phase 0 — source materials

### Fresh git history, not FrameForge's
**Q:** `tasks/T01` says copy FrameForge in. Copy its `.git` too?
**Choice:** No. `.git` (313MB) excluded; Scout gets its own history.
**Why:** FrameForge's history carries `origin → DevFrmwrkd/frameforge`, a private remote for a different product. Inheriting it means Scout's first push targets FrameForge, and the global git-hygiene rules exist because exactly that kind of entanglement cost days on `frmwrkd-studio`. The provenance is documented in `CLAUDE.md` and `docs/06_REUSE.md`; it does not need to be in the object store.

### Three more exclusions beyond T01's list
**Q:** T01 names `workspace/ .env node_modules/ dist/ release/ landingpage/`. What about the rest?
**Choice:** Also excluded `.env.bak.*`, `.wrangler/`, `frameforge-redesign DESIGN EXMPLE/`, and `._*` sidecars.
**Why:** All four are gitignored in FrameForge for stated reasons. `.env.bak.*` is the key-rotation script's output and held live FAL/Groq keys — `.env` alone does not match it, which is why FrameForge ignores the whole family. `.wrangler/` holds real dev bug-report screenshots. The redesign bundle is a design reference, and Scout has its own in `design/`. Everything else was copied verbatim and gets stripped in Phase 2, not pre-judged here.

### FrameForge's agent docs preserved, not overwritten
**Q:** The copy overwrote Scout's `CLAUDE.md` and `README.md` with FrameForge's.
**Choice:** Restored Scout's; moved FrameForge's to `docs/FRAMEFORGE_CLAUDE.md`, `docs/FRAMEFORGE_README.md`, `docs/FRAMEFORGE_ISSUES.md`.
**Why:** Scout's `CLAUDE.md` is the build contract and must win. But FrameForge's documents traps that have already cost days (the lying `rg -r` search, the NUL byte that made `store.mjs` invisible to grep, the `._*` sidecars that fail `npm test`, the `127.0.0.1` rule) and `START.md` requires reading it. Deleting it would delete the warnings.

### Phase 0c produced no change
**Q:** Which tokens does the design add or conflict on?
**Choice:** None. 27 of 27 identical, byte-for-byte, across all eight screens.
**Why:** Recorded because "no diff" is the finding, not a skipped step. There is no reconciliation commit because there is nothing to reconcile — the design was built on FrameForge's `:root`, as `README.md` claimed. Evidence and method are in `design/EXTRACT.md` §1.

### D1 · Properties collapse — the spec overrides the design
**Q:** `Scout.dc.html` renders properties expanded above the summary. `docs/05_UI_SPEC.md` §2.1 requires them collapsed.
**Choice:** Spec wins. Properties collapse on open, with a summary row carrying gate status, primary number and freshness.
**Why:** Not a real ambiguity — §2.1 quotes the design's own behaviour ("nine property rows before a single human sentence") and says *"Invert it"*. It is a deliberate override, not an oversight, and Law 2 is the reason. The design's body-collapse and its `WRITTEN BY …` provenance line are kept as drawn.

### D2 · The design's inspector is already correct
**Q:** Does the inspector need changes for T05?
**Choice:** No. Port as drawn.
**Why:** It already has the five sections in the spec's order, one expanded at a time, a count on every header that has one, and `REFERENCED BY` styled distinctly from `LINKS`.

### D3 · `Review Deck` is `Decide` filtered, not a second screen
**Q:** Two decision-card screens are drawn. Build both?
**Choice:** One component, `DecideCard.jsx`. `Review Deck` is `Decide` scoped to one collection and one card kind.
**Why:** Same keys, same reason grid, same footer counters, same altitude ladder; `Review Deck` has one card kind where `Decide` has five. Law 10 — a second implementation is a bug.

---

## 2026-08-19 · M0 — the strip

### The owner said "just do it all" — the four Phase-1 questions are now my calls
**Q:** `PLAN.md` §6 raised Q1–Q4 and asked for sanction on S1/S6.
**Choice:** Answered them myself and proceeded. Q1 → re-host the four top-nav screens in the 210px rail shell. Q2 → `Scout.dc.html`'s full-pane document surface is canonical; the 576px slide-over is a presentation mode of the same component. Q3 → `config/guest-research.md` is demo data; stages are the options of the one `gate: true` status field. Q4 → light mode is derived at T16 with a 4.5:1 test, including the four accent alpha steps §4 omits. S1/S6 → sanctioned.
**Why:** The questions were real but none of them blocked work, and each had an obviously better answer. Recording them here so the calls are visible and reversible rather than buried.

### The frontend strip is much larger than T01's 14 names
**Q:** T01 step 3 names 14 film components. Deleting only those leaves the app film-shaped.
**Choice:** Deleted the whole film domain: 83 frontend files → 27.
**Why:** M0's exit criterion is *"`npm start` opens an **empty** Scout window"*. `App.jsx` transitively reached 75 of 83 files, so nothing became deletable until the film surfaces went. Beyond T01's 14, this also removed the generation surfaces (`ProjectGenerate`, `GenerationControls`, `SchemaForm`, `ShotWorkspace`, `Story`, `AssetBoards`, `References`, `ReviewInbox`, `ManualInbox`, `ManualHandoff`, `Tools`, `ToolsSuite`, `ToolsmithChat`, `ControlMaps`, `SheetComposer`, `Scrub`, `PromptBuilder`, `Library`, `Chat`, `chat/*`, `moveDiagram`) and the film data helpers (`cameraMovements`, `cinematicOptions`, `lookBuilder`, `models`, `modelCatalog`, `shotTakes`, `shotTypes`, `shotGenerate`, `sequence`, `reelClock`, `entities`, `handoffCompose`, `activityKinds`). T01's list was a starting point, not a boundary.

### `App.jsx` was replaced, not edited
**Q:** 3,602 lines, and every line of it is the film app's shell.
**Choice:** Replaced with a ~120-line Scout shell — rail, centre, inspector, status footer, all empty.
**Why:** There was nothing to salvage: its state, tabs, routing and panels are all film. The measurements come from `design/Scout.dc.html` (210px rail, 302px inspector, 38px footer) and are cited in the file header so nobody re-derives them from a screenshot. The old file is in git at the pre-strip baseline commit. Rail groups render with **zero items rather than placeholder rows** — a fake count is a lie the next person has to disprove.

### Four helpers judged individually rather than by name
- `location.js` **KEPT** — generic URL-hash navigation model, nothing film about it.
- `screenshot.js` **KEPT** — the bug-report capture path behind `feedback.mjs`, which `docs/06_REUSE.md` says to take.
- `slashCommands.js` **KEPT, trimmed** — level 1 is snippets and survives; the level-2 model-catalog and camera-move branches go.
- `activityKinds.js` **DELETED** — it classifies *generation* events. Scout's Activity is the event log (`backend/log.mjs`, M2), a different thing with a different vocabulary.
- `entities.js` **DELETED** — the @-mention pool over film production entities (talent/location/prop). Scout's pool is over records and arrives at M4.

### Three dependencies dropped
`three` (the 3D stage), `marked` (only `App.jsx` used it) and `sharp` (only `boardExport`, `gridsplit`, `reelPack`). Dropping `sharp` also removes the `sharp:mac:both` install dance and the `asarUnpack` entry, and is why the FrameForge CI matrix no longer applies.

### S8 · both FrameForge endpoints cut
**Q:** A packaged Scout would auto-update into FrameForge and validate licences against FrameForge's server.
**Choice:** Removed `build.publish` from `package.json` entirely; `desktop/updater.cjs` already bails when `!app.isPackaged` and its try/catch absorbs a missing `app-update.yml`. Renamed the R2 bucket in `release-upload.mjs` to `scout-releases`.
**Why:** Better to have no update feed than the wrong one. Auto-update returns when Scout has a feed of its own. (`backend/licence.mjs`'s `API_BASE` default is the remaining half and is handled in the backend strip.)

### FrameForge's CI and spec docs removed; its agent docs kept
Deleted `.github/workflows/` (both workflows publish to FrameForge's R2 with FrameForge's Apple secrets, and `build.yml` exists to prove a `sharp` matrix that Scout no longer has), plus `docs/COMPONENTS.md`, `docs/MAP.md`, `docs/RELEASE.md`, `docs/specs/`, `docs/agents/` — all indexes of film work. Kept `docs/FRAMEFORGE_{CLAUDE,README,ISSUES}.md`: those carry the traps. CI returns when Scout has a remote.

### `window.frameforge` → `window.scout`
The Electron preload bridge, and with it `screenshot.js`'s three call sites and the `frameforge:voice-toggle` window event. Renaming the bridge without the consumers would have silently disabled desktop screenshot capture — `isDesktopCapture()` would just start returning false.

### Trap · BSD `sed` ignores `\b`
`sed -i '' 's/\bframeforge\b/scout/g'` matched **nothing** on macOS and reported success. It was caught only because a follow-up grep still found `frameforge:voice-toggle`. Same shape as the repo's documented lying-search traps: the command succeeded, the work did not happen. Verify every sweep with a grep afterwards.

### 38MB of film thumbnails deleted
`public/axis-options` (37MB) and `public/preset-previews` were the cinematic-axis preview images for StyleLab and PromptBuilder. Both are gone, so `public/` is gone.
