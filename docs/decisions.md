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

### The backend strip — 51 modules → 25
**Q:** T01 named 14 backend modules. What about the other 37?
**Choice:** Audited all of them. **DELETE 25**: the 13 T01 named (minus `imageSize`, kept — see below) plus `batches` `catalog` `control` `enhance` `generate` `manifest` `manual` `modelSchemas` `probe` `providers` `vision` `seed` `snippetSeeds`. **KEEP** `actions` `distill` `launch` `library` `licenceToken` `trash` `userTools` alongside the T01 keep-set. **REDUCE** `groq.mjs` to its key resolver.
**Why:** The deleted set is the image/video generation layer — Scout generates nothing. The keeps are generic infrastructure Scout still needs: an append-only action journal, a staged trash (Law 5 — never delete), a file library, cross-platform process launching, user-authored agent tools, and Ed25519 licence tokens. `distill.mjs` turns a closed session into durable learnings, which is `docs/03_MEMORY.md`'s learnings pipeline arriving early — keeping it was not a close call.

### Three boot-crash landmines, found before they fired
`search.mjs`, `feedback.mjs` and `distill.mjs` are all in the keep-set and all statically imported from the delete-set — `listGenerations`/`listAllShots`/`getStory`, `providersStatus`/`videoToolsStatus`, and `groqKey`. A static import of a deleted module fails at **import time**, so any of the three would have taken the whole server down at boot, not degraded a feature. All three were cut in the same pass as the deletion. This is why the strip order in `PLAN.md` put decoupling before deleting.

### `groq.mjs` reduced rather than deleted
`distill.mjs` needs `groqKey()`. Rather than move it into `env.mjs`, the file survives as a 5-line module holding just the resolver, keeping the parent repo's documented convention that a provider's key resolver lives beside that provider's code. When M3 decides what Scout actually distils with, that is the one place to repoint.

### `backend/skills/` — the silent-breakage risk
`agentHome.mjs` mounts `skills/scout-router` into **every** session and hardcodes four paths into that directory. Deleting it would not crash the server; it would silently break the first session anyone opened.
**Choice:** Deleted the two film workflow packs (`storyboard-workflow`, `manual-roundtrip`) and emptied `BUILTIN_PACKS` to `[]` rather than removing it. Rewrote `scout-router/SKILL.md` and `scout-toolsmith/SKILL.md` as honest M0 stubs.
**Why:** The mounting mechanism is sound and M4 needs it; only the content was film. An empty `BUILTIN_PACKS` keeps every enablement path exercised. The router stub deliberately contains **no route list** — `docs/04_AGENT_CONTRACT.md` §8 says adding a capability is a new Index line, never a router-skill edit, and a route list here would be the second source of truth that rule exists to prevent.

### `store.mjs` settings defaults de-filmed
Removed `enabledModules`, `autoAnalyze`, the vision/transcription block, the Remotion project pointer, `falApiKey`/`kieApiKey`/`higgsfieldCommand`, `disabledModels`/`customModels`/`modelDefaults` and the manual-round-trip trio. `SECRET_SETTING_KEYS` drops to `['groqApiKey']`. The four hard rules in this file — `writeMd`'s `{content}` form, `readMd`'s `cache: false`, tmp+rename, and `safe`/`safeScope` — were not touched and are visibly intact.

### S8 · the licence server, the other half
`backend/licence.mjs` defaulted `API_BASE` to FrameForge's Convex deployment. Now defaults to empty, and `post()` short-circuits with `reason: 'no-licence-server'` **explicitly** rather than letting `fetch('')` throw into the catch — same outcome, but the reason string says what actually happened. `isEnforced()` still governs enforcement.

### Redaction keeps a superset of secrets
`knownSecrets()` still lists `FAL_KEY` and `KIE_API_KEY` even though both providers are gone. A superset costs nothing, someone forking from FrameForge may still have them exported, and redaction is the one place to prefer over-reaching to under-reaching.

### Test triage — 56 files → 34, two salvaged rather than deleted
Deleted 22 test files whose subject no longer exists. **Salvaged two** that T01's "delete every now-orphaned test" would have thrown away:
- `phase-board-layout.test.mjs` — 51 tests, of which only the last four were the asset-kind vocabulary. The rest guard `boardLayout.js`, which Scout keeps.
- `phase-windows-spawn.test.mjs` — only two of thirteen were film (video/remotion win32 branches). The structural ones ("no backend module spawns a resolved binary without `planLaunch`") fail on *any* host if someone adds a raw spawn back, and apply to whatever Scout spawns next.

In both files the removed block is replaced by a comment saying what it guarded and why the rule still holds. A deleted test with no trace is a rule nobody knows they are breaking.

### Dictation was nearly stripped by accident
**Q:** Deleting `backend/groq.mjs`'s film functions also removed `transcribe()` and its route. `frontend/VoiceInput.jsx` — a `docs/06_REUSE.md` keeper — calls it.
**Choice:** Restored `transcribe()` and `POST /api/groq/transcribe`.
**Why:** Dictation is not film. `GOAL.md`'s first-run interview is voice-enabled and `docs/06_REUSE.md` names `VoiceInput` as a take, so the route is a Scout capability that happened to live in a mostly-film file. Caught only by cross-checking every `api.js` method against the surviving routes — the mic button would otherwise have shipped 404ing, which is worse than either keeping or removing it. FrameForge's second engine (local Parakeet, `localAsr.mjs`) did go, so there is one engine and a plain error rather than a fallback ladder.

### `frontend/api.js` trimmed to the surviving routes
48 of 95 client methods pointed at routes that no longer exist (`reel*`, `remotion*`, `videoImport*`, `control*`, `falCatalog`, `modelSchema`, …). Removed, and every remaining method's path was verified against a live backend module. A client method for a deleted route is a 404 waiting for a caller, and it is also a lie about what the app can do.

---

## 2026-08-19 · Seeding the example workspace — seven ambiguities the spec has

Found by writing 30 real records against `docs/02_DATA_MODEL.md` rather than reading it. Several are spec bugs, not judgement calls; they are listed here so the owner can fix the doc rather than have every future agent rediscover them.

### 1 · `multiselect` silently requires a non-empty `options[]`
§2's field table does not say so, but `backend/collections.mjs` rejects a bare `tags: multiselect`. **Choice:** enumerated the 16 tag values actually used across the seed guests. **Either the doc should state the requirement, or the validator should allow an open vocabulary for `multiselect`** — a tag field whose options must be declared up front is not really a tag field.

### 2 · The design's three sample datasets contradict each other
`Scout.dc.html`'s structured `from:` (guest→group) disagrees with `Territory.dc.html`'s prose "LAST THREE FINDS" for the same people — Rowena Cruz is `solo-parents` in one and under OFW Stories in the other; Kaye Ilagan likewise. **Choice:** the structured field is authoritative, the prose is flavour. Worth knowing before anyone treats the mockups as a fixture.

### 3 · No screen's status vocabulary matches any other
`Scout.dc.html` uses `needs review / shortlisted / contacted / gone cold / rejected`; `Pipeline.dc.html` uses `inbox / shortlist / contacted / replied / won`. Neither has both `replied` and `gone cold`. **Choice:** modelled "gone cold" as *old* `contacted` rather than a status of its own — the `gone-cold` saved view is a `contacted` filter sorted oldest-first. **Why:** staleness is already a first-class idea (Law 3, `verified_at`, the freshness meter). Making it a status too would give one fact two homes that could disagree, and Law 5 reserves `archived` for a deliberate reason, which mere ageing is not.

### 4 · `Today.dc.html`'s goal arithmetic is stale
It hardcodes "9 DAYS LEFT" for *Book 8 guests by 30 September* while its own `dateOf()` fixes today at 2026-08-19 — which is 42 days, not 9. **Choice:** used the correct count. A mockup's stale number must not become seed data.

### 5 · `group` has no computed yield, so "my best" had no field to sort on
`docs/03_MEMORY.md` §3 gives `territory/<id>.md` a `yield` / `hit_rate`, and `CLAUDE.md` names `backend/territory.mjs` its sole writer — but that is M3, and a `group` collection today has only raw `finds` and `booked`. **Choice:** sorted `my-best` by `booked` desc. Sorting by `finds` would put Manila Foodies (62 finds, **0** bookings) first, which is precisely backwards — and that record is in the seed set specifically so the mistake is visible.

### 6 · §3 shows one view object, not the file that holds several
The multi-view wrapper is unspecified. **Choice:** a bare JSON array, confirmed against `backend/views.mjs` (`Array.isArray(parsed) ? parsed : (parsed.views || [])`, so both work). §3 should show the file, not just a view.

### 7 · `group.platform` had no options list
Unlike `guest.platform`, which §1 spells out. **Choice:** `[facebook, instagram, tiktok, reddit]`, since `Territory.dc.html`'s ground list includes hashtags and subreddits even though all eight seeded groups are Facebook.

### And the gate holds in the data
Every `contacted` / `replied` / `won` record carries `updated_by: crystal`. Nothing agent-authored sits past `shortlist`. Verified programmatically, because seed data that modelled a Law 4 violation would teach the wrong shape to everything built on top of it.
