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

### Trap, hit and fixed · a NUL byte made `documents.mjs` invisible to grep
**What happened:** `globToRe` used a raw `\x00` as a sentinel to protect `**` from the `*` rule during glob→regex translation. That single control byte made `file` classify the module as `data`, so **grep skipped it entirely — silently, exit 1**. Every `grep -rn … backend/` I ran during the strip had a hole in it and I did not know.
**Caught by:** a zero-hit search on a symbol I could see on the line with `sed`. The positive control returned nothing either, which is the tell — a broken pattern fails one way, an unreadable file fails both.
**Fix:** one-pass replacer, no sentinel. `esc.replace(/\*\*|\*/g, m => m === '**' ? '.*' : '[^/]*')`.
**Why it matters beyond this file:** `docs/FRAMEFORGE_CLAUDE.md` documents this exact bug costing hours in `backend/store.mjs`, and its rule — *never re-introduce a raw control byte; write the escape* — is one I broke within hours of reading it. Grep cannot police this, because grep is what is broken. Every source file is now scanned with a byte-level check instead; all clean.

---

## 2026-08-19 · M1 — REFERENCED BY

### D4 · REFERENCED BY scans frontmatter POINTERS, not only declared `relation` fields
**Q:** T05 §2 says "documents whose **frontmatter relation** points here". A `relation` is a typed field declared in a collection schema. Should the scan therefore consider only fields a collection declares as `type: relation`?

**Choice:** No — scan frontmatter *values* across every document, and mark each hit `declared: true|false` according to whether some collection the source document belongs to declares that key as a relation.

**Why:** T05's own Demonstrate is *"a guest referenced by a territory, a learning and a project brief"*. Territory and learnings are **memory objects** (`territory/<id>.md`, `learnings/<id>.md` — `docs/03_MEMORY.md` §1), not collection documents: they have no schema, so they have no declared relation field and never will. A declared-relations-only scan returns **zero** for that case, so it could not satisfy the task that specifies it. The `declared` flag is what preserves T05's other requirement — that this section be "structured and typed" — without narrowing it to the point of uselessness: the surface renders a typed relation with its `#collection`, and a loose pointer with only its origin, because `#` means "a collection" everywhere else in the app and printing `#territory` would be a lie.

**What keeps it honest:** the match is **exact** against the names a document answers to (its filename slug and its `id:`), never a substring — otherwise every prose field mentioning a slug becomes a false backlink, and a backlink nobody can explain is worse than a missing one. `id`/`slug` are excluded (that is what a document *is*), and so are `created_by`/`updated_by`, which are HISTORY's job (T05 §4) and would otherwise bury three real references under one row per document an agent ever touched.

### D5 · Following a reference had to be able to leave the open collection
**Q:** Once REFERENCED BY crosses collections, clicking an entry selects a path that is not in the loaded rows. What should happen before T04's document surface exists?
**Choice:** Fetch it via `GET /api/document` and show it in the inspector, read with **its own** collection's schema. The centre pane stays on the collection the person was browsing.
**Why:** the alternative is a button that visibly does nothing — the first thing anyone clicks after seeing the section work. Law 8 says nothing is hidden from a human who wants to look, and a reference you cannot follow is a dead end, not a compression. This is deliberately *not* T04: no editing, no `Editor|Raw`, no properties-collapse — just the read.

### Note · the client-side version was not a smaller version of this, it was wrong
The previous `App.referencedBy()` computed backlinks from the rows of the **active collection** only. Every cross-collection reference — which is to say, nearly all of them — returned nothing, and the section rendered a confident `NOTHING POINTS HERE`. In the seeded workspace, opening Maria Santos showed `REFERENCED BY 0` while `data/groups/nurses-ph.md` had `top_finds: [maria-santos, …]` on disk. A section that answers "nothing" when it means "I did not look there" is worse than an absent section.

---

## 2026-08-19 · Two regressions the test repair surfaced

### `syncAssets` silently stopped excluding references — and it was my edit
**What happened:** removing the film asset vocabulary (`shared/assetKinds.mjs`), I replaced `assetKindOf(folder, overrides)` with the raw folder name. That dropped two behaviours, not one: the synonym table (film, correctly gone) **and the asset/reference split** (generic, and it should have stayed). `overrides` was still fetched and then never read, and the comment directly above went on describing an exclusion that no longer happened.
**Fix:** the rule survives without the table. An explicit `context/_folders.md` override decides first; otherwise a file in a folder is an asset with the folder as its kind, and a file at the context root is a reference and is skipped. One rule, no vocabulary, and `overrides` is load-bearing again.
**Why it matters:** the deleted code was film, but the *rule* it enforced was not. When you remove a mechanism, separate what it did from what it was for — the tests were still asserting the rule, which is the only reason this was caught.

### `CORE_API_ROUTES` advertised 17 dead routes to every agent session
`backend/agentHome.mjs` injects a route reference into **every** session. It listed 18 routes of which 17 had been deleted with the film domain — `/api/story/*`, `/api/stylelocks`, `/api/generate`, `/api/batches*`, `/api/manual/*`. An agent following it does not get a warning; it gets a 404 mid-job. Rewritten to the 19 routes that exist, with the M2–M5 capabilities **absent rather than promised**.

### The guard for it was vacuous on the first attempt
The test I wrote searched every `backend/*.mjs` for each advertised path — a corpus that **includes `agentHome.mjs` itself**, so every path matched its own declaration. It passed with a route called `/api/definitely-not-a-route` in the list. Fixed to scan actual `app.<method>('<path>')` registrations, and then *shown to fail* before being accepted.
**The rule:** a guard that has not been observed failing is not a guard. Break the thing it protects, watch it go red, put it back.

---

## 2026-08-19 · Finishing the app — M2 through M5

Context: the owner's report was *"the app is not working, I can't click and can't change anything,
and you took the design but ignored the other layers."* Both halves are accurate diagnoses of a
half-built M1: the shell and the tokens were faithful to the design, and beneath them there was no
write path, no memory, no orchestration and no decision queue. The rail rendered five dead rows.
What follows are the decisions taken while building the rest.

### `docs/08_MODULE_CONTRACTS.md` exists because the build was parallelised
Twelve pieces were built at once against one written contract — every module signature, every route,
and the rule that only the integrator edits `backend/index.mjs`, `frontend/api.js`, `frontend/App.jsx`
and `frontend/Rail.jsx`.
**Why:** this repo's documented failure mode is *three implementations of one thing* (Law 10). The
cheapest defence when several people build simultaneously is a signature written down **before**
anyone starts, plus a single owner for every integration point. A contract file is cheaper than a
reconciliation.

### The Scout memory layer went **into** `backend/memory.mjs`, under a divider
`CLAUDE.md`'s source-of-truth table names `backend/memory.mjs` as the home of memory and the hot
cache. That file already existed holding FrameForge's per-project notes, and six modules plus four
tests import it.
**Decision:** append the Scout layer below a divider rather than rename the file.
**Why:** renaming buys tidiness and costs a six-module edit plus four test edits, on a file whose
importers include `store.mjs` — which imports it back, in a cycle that is only safe because every
reference on both sides is inside a function. The table in `CLAUDE.md` stays true either way; the
rename does not, on its own, make anything work better.

### `_inbox/` failures write the reason **into the file**, not into a log
T07 says move a bad drop to `_failed/` with the reason. It is written as `scout_failed:` at the top
of that file's own frontmatter.
**Why:** the thing that dropped the file is an agent, and the only interface an agent in folder mode
has is the folder. A reason in a log it never reads means it drops the same broken file tomorrow.

### A drop with no `collection:` routes by tag rather than being refused
`inferCollection` takes an explicit `collection:` first, then matches the drop's `tags[]` against
each collection's `query.tag`.
**Why:** `skills/scout-router/references/folder-mode.md` has agents writing `tags: [guest]` and
nothing else. Refusing that would make the door that must *work everywhere* the hardest one to use.

### `documentsFor()` returns `{ collection, documents }` — and I assumed `{ rows }`
The route wrapping it returns `rows` (post-view), the function itself returns `documents` (pre-view).
Two names for two genuinely different things, one shipped bug in `_known.md`, caught by its test.
**Carried forward:** the view-applied set is `rows`; the raw matched set is `documents`. Do not
rename either into the other.

### The exFAT `._*` sidecars are a **product** bug on this volume, not only a test nuisance
`GET /api/assistants` on the real workspace returned `._librarian` as an assistant, with a body of
raw AppleDouble bytes. `HANDOVER.md` documents these files breaking test discovery; they also break
every `readdirSync` in a module that lists data.
**Rule:** any directory listing in a backend module skips names beginning with `.` — the sidecar and
the dotfile are the same fix. `backend/documents.mjs` already did this; the new modules did not.

## 2026-08-19 · T03 — board, list and gallery

### The dispatcher draws the chrome for three renderers; `TableView` still draws its own
**Q:** `TableView.jsx` has module-local `ViewTabs` and `QueryBar`. Where does the strip live now that
four types share it?
**Choice:** `CollectionView.jsx` owns the canonical strip and query bar and renders them for
`board · list · gallery`. Its renderer table carries `chrome: false` on the `table` entry, because
`TableView` still draws its own identical copy.
**Why:** `TableView.jsx` is owned by another agent this session and exports neither component, so the
alternatives were a fifth shared module (a file nobody is expecting) or a circular import. The flag
keeps "adding a view type is a line in the table" true and keeps the duplication down to the one
pre-existing copy, with the reconcile written at the top of `CollectionView.jsx`: delete
`TableView`'s two local components, import these, flip the flag.

### Board columns come from the **gate** status field unless the view says otherwise
**Q:** `02_DATA_MODEL.md` §3 says "columns are the status options" — which status field, when a
collection declares more than one?
**Choice:** `view.group` if it names a status field, else the `gate: true` status field, else the
first status field.
**Why:** the gate field is the one the promotion gate guards, so it is the one a person is actually
dragging cards along. A saved view that groups explicitly still wins, because that is what `group`
is for.

### A status value that is not one of the declared options gets its own column
**Choice:** a trailing `NO STATUS` column, not draggable, never a drop target.
**Why:** Law 8. Dropping those records would hide them, and the bucket a board cannot name is
exactly the schema gap somebody needs to see.

### The activity line is derived from the row, not fetched
**Choice:** counts come from relation fields (`3 groups`) and from `rollup` fields with `fn: count`
(`2 messages`); "last touch" is `verified_at || updated || created`, rendered through `Freshness`.
No line at all when the collection declares no relation.
**Why:** `rows` is what the view hands the renderer, and a second fetch per card would put N
requests behind one board. The rollup path is the one that produces "2 messages" once a `message`
collection exists — the count is already computed on read by `documents.mjs`.

### The board never writes; it calls `onMove(row, toStatus)` and re-reads
**Choice:** no optimistic re-bucketing. The card moves when the rows come back changed.
**Why:** the gate is the only thing allowed to refuse a promotion (Law 4). A card that jumps columns
and then jumps back is the UI telling the person a promotion succeeded before the gate has spoken.

### The gallery renders a named plate when a `file` value is not a URL
**Q:** `file` values are content-addressed under `<workspace>/files/` and no route serves that folder.
**Choice:** `mediaSrc()` resolves `http(s):`, `data:`, `blob:`, `file:` and root-relative values;
anything else renders a `NO PREVIEW` plate carrying the filename.
**Why:** a broken `<img>` says nothing; the filename says which file is missing a route. When
`GET /api/file` lands, `mediaSrc()` is the only thing that changes.

---

## 2026-08-19 · M4 orchestration (`tasks.mjs` · `proposals.mjs` · `agentIndex.mjs`)

### D6 · Write-then-re-read is not a claim protocol, so the claim got a real lock
**Q:** `docs/04_AGENT_CONTRACT.md` §5 says an agent claims by "writing `assigned` + `claimed_at`
atomically, then re-reading". Is that sufficient?
**Choice:** No. The whole read-modify-write happens inside a `mkdir(2)` lock at
`.scout/locks/tasks/<project>__<task>.lock`; the re-read is kept as the contract's verification step.
**Why:** tmp+rename makes each *write* atomic and does nothing for the interleaving that actually
loses tasks — A writes, A re-reads and declares victory, *then* B writes and B re-reads and also
declares victory. Both won, one task. `fs.mkdirSync` without `recursive` is atomic and fails EEXIST,
which is mutual exclusion across processes with no daemon. Locks live under `.scout/` because they
are derived and disposable; a lock older than 2s is treated as a dead holder and removed.
**Observed failing:** with the lock disabled, three racing processes double-claimed 34 of 120 tasks.
With it, 0 double claims and 0 lost over repeated runs. `tests/phase-tasks.test.mjs` races three real
child processes behind a two-phase barrier — a one-phase "starting gun" fires when the last process
was *spawned*, not when it finished importing, so the first to boot ate the whole queue and the
"race" proved nothing.

### D7 · A finding card points at its record with `record`, never `path`
**Q:** A `finding` card carries the record it is about. `path` is the obvious name.
**Choice:** `record`. `path` on any entity in this codebase is that entity's own file.
**Why:** it was `path` for one afternoon, and `getProposal()` overwrote the payload with the card's
own location. Rejecting a finding then called `archiveRecord('proposals/<card>.md')` — it archived
the proposal instead of the guest, and the next read of the card was an ENOENT. Sending `path` on a
finding card is now a 400 that names `record`. (`frontend/DecideCards.jsx` already read `d.record`.)

### D8 · Accepting can be blocked by a missing module; rejecting never can
**Q:** `proposals.mjs` performs effects that live in `records.mjs`, `memory.mjs`, `territory.mjs`,
`collections.mjs`. What happens when one has not landed?
**Choice:** `accept()` resolves the effect (injected dep → canonical module → nothing) and throws
**501 naming the module** if it is absent, leaving the card open. `reject()` degrades to recording
the reason on the card. No fallback writer, ever.
**Why:** an "accepted" card whose effect silently did nothing is the worst outcome in the app — the
human believes they approved something that does not exist. But a human who cannot say *no* because
a module is missing is worse than a rejection that only lands on the card, so rejection is
best-effort and reports which it did (`effect: archived | card-only`).

### D9 · Runs live at `runs/<id>.md`
`docs/02_DATA_MODEL.md` §5's on-disk map predates `listRuns`/`appendRun` and names neither `runs/`
nor `proposals/`. Proposals are fixed by `docs/08` §8; runs are not. One file per entity (Law 6),
at the workspace root next to `assistants/`, because a run is a fact about an assistant and Law 8
says the human can always go and read it.

### D10 · The Index may omit a capability; it may never advertise one
`renderIndex()` filters `INDEX_CAPABILITIES` against the routes that are *actually registered* —
the live Express router when the app is in hand, otherwise a scan of `app.<verb>('<path>')` in
`backend/*.mjs`. Adding a capability is one line in that table and the router skill is untouched
(tested by adding one and diffing `skills/scout-router/`). Consequence worth knowing: a route
registered through a **variable** path is invisible to the scan and gets silently withheld — the
three `*/propose` doors in `proposals.mjs` are written as literals for exactly this reason.

### D11 · The document surface's five ambiguities, decided (T04)
`docs/05_UI_SPEC.md` §2.1 fixes the collapse and the summary; these five it does not.

1. **Raw is read-only.** `Editor | Raw` shows the file, it does not edit it. Only
   `backend/records.mjs` writes a document file (CLAUDE.md), and a raw text box is a second writer
   that bypasses dedupe, provenance and the gate — undetectably. Raw reads `/api/files/read`; until
   that M5 route is mounted it renders a copy built from the read and labels itself `RECONSTRUCTED`
   rather than pretending to be the bytes on disk.
2. **The date editor is a typed ISO field, not `<input type="date">`.** The native picker paints its
   own chrome from `color-scheme`, which this app does not declare — it renders a light widget on the
   dark surface today and the wrong one again when light mode lands (T16). Frontmatter dates are ISO
   strings anyway, and `display: freshness` still renders `Freshness.jsx` beside the field.
3. **`+ Add property` is a hand-off, never a write.** A new field is a schema change
   (`docs/02_DATA_MODEL.md` §6): the row calls `onAddProperty`, and the surface that owns the
   proposal decides. The button is absent when no handler is passed.
4. **Conflict "keep mine" cannot delete.** The write is `PATCH`, so a key only the other writer
   added survives every one of the three answers. "Keep mine" sends every key you can see with your
   value; "merge" sends only the keys you actually changed, on the disk's revision. Both are
   non-destructive by construction (Law 5), so neither needs a confirmation step.
5. **409 is resolved from a re-read, not from the error body.** `patchRecord` 409s with the server's
   current state, but `frontend/api.js`'s error shim keeps only `{ error, code }` and that file is
   the integrator's. `Document.jsx` re-reads the document instead — one extra GET, and strictly more
   truthful: it is the state at resolution time rather than at rejection time.

### D12 · Orchestration: three UI decisions T12 does not settle (Assistants · Hire · Project)

1. **`RUNNING` is `--marked`, not the prototype's `--ok`.** `design/Project.dc.html` and
   `design/Today.dc.html` both draw a sweeping assistant green. `styles.css` `:root` defines
   `--marked` as "this one is in flight", a fifth channel that is neither accent nor status, and an
   in-flight state is not a health verdict. So the three assistant states are `running: --marked`,
   `idle: --ok`, `blocked: --warn`, and the task lanes follow the prototype exactly
   (`open --border-3 · claimed --marked · done --ok · blocked --warn`). The vocabulary is declared
   once, in `frontend/Assistants.jsx`, and imported by `Hire.jsx` and `Project.jsx`.
2. **Add-a-task does not choose who does it.** The prototype's composer has an assignee picker.
   `backend/tasks.mjs saveTask()` refuses `assigned` and `claimed_at` outright — they are written by
   `claimTask()` and by nothing else, which is the only reason three agents can work one queue
   without losing a task. A picker here would be a lie about that guarantee, so the sentence enters
   the queue `open` and the screen says what is true: whoever is free picks it up.
3. **The plain-language "what it is doing right now" is the first paragraph of the file's body.**
   Every assistant and task the workspace ships opens with one paragraph of plain English and then a
   `## Notes` heading. That paragraph *is* the altitude-1 answer, so `firstPara()` reads it rather
   than the UI paraphrasing a status word into a sentence. Everything below the heading is
   altitude 2 and belongs to the document surface. Tasks are titled from `label` first: `getTask()`
   falls `title` back to the id, so an id-shaped title is the absence of one, and `label` is what
   goals, projects and territory already use for the human line.

---

## 2026-08-19 · T16 — the file browser and light mode

### D · Light mode deviates from `05_UI_SPEC.md` §4 in exactly three values
**Q:** §4 prints a light token table *and* the rule "every pair must clear 4.5:1". Three of its values fail that rule. Which wins?
**Choice:** The rule. `--fg-muted #6B7078 → #565A61` (4.33:1 → 6.01:1), `--fg-faint #8B9099 → #676C75` (2.78:1 → 4.58:1), `--warn #9A6800 → #916200` (4.19:1 → 4.61:1). All three measured against `--raise #EFEFEC`, the darkest light ground and therefore the worst case for text. Each keeps §4's hue and saturation and moves only lightness.
**Why:** the table is a proposal and the ratio is the acceptance criterion — `tasks/T16` says *"a test asserts every pair clears 4.5:1"*, and §4 says it too, in the same paragraph as the table. `--fg-faint` at #8B9099 is 2.78:1, which is not a rounding problem: it is unreadable, and `docs/DESIGN.md` calls `--fg-faint` "the floor. Nothing renders text below it." Taking the printed value would have made the floor illegible on every light surface in the app. The retuned ramp also lands on the dark set's own ratio structure (14.9 / 9.2 / 6.0 / 4.6 against dark's 14.2 / 10.5 / 6.5 / 4.5), so the four text steps stay as visibly distinct as they are in dark.

### D · The four light accent-alpha steps are derived from the light accent, at the same four stops
**Q:** §4 gives no light counterpart for `--accent-05/12/35/60` (flagged as Q4 in `design/EXTRACT.md` §5 and as the known trap in `HANDOVER.md` §2.9). What are they?
**Choice:** `rgba(61,74,0,.05 / .12 / .35 / .6)` — the light accent `#3D4A00`'s own rgb at the identical four stops the dark set uses.
**Why:** the alpha steps are not colours, they are *the accent at four strengths* — the dark ones are `rgb(227,255,50)`, the accent's rgb, at four alphas. Deriving light the same way keeps the rule that gives them meaning ("four steps only; anything between them is noise") true in both themes, and keeps the two themes one design instead of two. Composited over `--surface` the `.12` chip bed is `#E8E9E0` and carries `--accent` text at 7.9:1. The `.35`/`.60` steps are **border** steps and are deliberately NOT asserted at 4.5:1 — neither theme's borders clear it against their ground, and asserting it would be asserting something false about the dark set too.

### D · `--void`, `--border-2`, `--accent-hover`, `--accent-deep` and `--sand` also had no light value
**Q:** §4's table is 18 tokens; `:root` is 27.
**Choice:** Derived by preserving each token's *relationship* to its neighbours rather than inventing a value: `--void` sits one step from `--sunk` toward `--ink` (as in dark); `--border-2` sits between `--border` and `--border-3`; `--sand` aliases `--fg-soft` (as in dark); `--accent-hover` moves away from the page ground and `--accent-deep` one step toward it, mirroring `#EEFF66`/`#B8CC28` around the inverted lightness axis.
**Why:** a missing light token is worse than a wrong one — it falls back to the `:root` value and renders a near-black on a near-white page with no warning. `tests/phase-theme-contrast.test.mjs` asserts light declares every name dark declares, so this class of bug cannot come back quietly.

### D · `theme.js` resolves `prefers-color-scheme`; CSS never does
**Q:** Follow the OS with a media query, or with an attribute?
**Choice:** An attribute. `theme.js` stores a *preference* (`system | dark | light`) and always stamps a resolved `data-theme="dark"|"light"` on `<html>`.
**Why:** one selector in the stylesheet instead of a media query and an attribute selector fighting over specificity, and it separates "what did the person choose" from "what is on screen" — which is what lets `system` keep following the OS for the rest of the session while an explicit choice does not. `:root[data-theme]` is (0,2,0) against `:root`'s (0,1,0), so it wins on specificity rather than on source order.

### D · The file browser refuses bad paths rather than sanitising them
**Q:** `tasks/T16` and the module contract say to reuse `store.safe()` for path safety in `backend/files.mjs`.
**Choice:** `safe()` is not used to rewrite segments. `resolveRel()` refuses an absolute path, a `..` segment and a control byte outright, then requires the **realpath** of the result to still be inside `getStorageRoot()`.
**Why:** `safe()` rewrites anything outside `[\w.\-]` to `_`. That is right for names Scout *generates* and wrong for names it *browses* — a folder the person made in Finder called "Guest notes" would be rewritten to "Guest_notes" and 404, and a browser that cannot open the file it just listed is broken. Law 8 covers the files the human dropped in, not only the ones we wrote. `safe()` also leaves `..` completely untouched, so it was never the guard here in the first place; containment is, and realpath is what closes the symlink case `path.resolve` alone would miss. The refusals were **observed failing**: with the containment check disabled, five tests in `tests/phase-files.test.mjs` go red.

### D · `files.mjs` does not spawn — the revealer is injected
**Q:** `POST /api/files/reveal` needs to open Finder, and `backend/index.mjs` (which T16 may not edit) already owns `revealInOS`.
**Choice:** `registerFileRoutes(app, { revealInOS })`. Without it the route answers **501 naming the fix**, never a silent no-op.
**Why:** `revealInOS` is cross-platform, never throws, and is a no-op under `SCOUT_TEST` — a second spawner is a second place for the "execFile with no error callback crashes the server" bug to live, and for a `node --test` run to open real Finder windows. A 501 that names the missing dep is a five-second fix; a reveal button that silently does nothing is an afternoon.

---

## 2026-08-19 · T15 — the whiteboard

### The whiteboard is a NEW module beside FrameForge's board, not an edit of it
**Q:** `backend/board.mjs` and `frontend/Board.jsx` already implement a native canvas. Re-cut them for Scout's node kinds, or write beside them?
**Choice:** New files — `backend/scoutBoard.mjs`, `frontend/Whiteboard.jsx`, `frontend/WhiteboardNodes.jsx` — importing the shared pure geometry (`frontend/boardLayout.js`) rather than copying or mutating it.
**Why:** The FrameForge board and its two test files (`phase-board-layout`, `phase-board-store`, 92 assertions) are still green and still the reference implementation; mutating them mid-build would take the reference away while the replacement is unproven. `boardLayout.js` is imported, not forked, so `tidy`, `alignNodes`, `distributeNodes`, `snapGuides`, `arrowGeom`, `bounds` and `fitView` have ONE implementation across both surfaces — the connector geometry that draws a FrameForge arrow is the geometry that draws a Scout relation.

### Both boards want `projects/<id>/board.md` — the seam is declared, not hoped for
**Q:** T15 §4 says `board.md` per project. `backend/board.mjs` already writes exactly that path.
**Choice:** Keep the path T15 specifies, stamp Scout's document with `kind: whiteboard`, and make the reader DETECT a FrameForge document (it declares `show:`, or holds node kinds that are not Scout's). A foreign document reads as `{ foreign: true }` with no nodes, and **every write against it is refused** with `code: 'foreign'`.
**Why:** Scout's sanitiser drops every FrameForge node kind, so a naive read would show an empty board and the next save would destroy seven asset nodes for real — the exact failure `board.mjs`'s own stale-write guard was written for, in a new costume. Refusing is two dozen lines and it fails loudly. The seam disappears when FrameForge's board surface does.

### Edges are derived through `referencesTo`, not through a new relation walker
**Q:** `deriveEdges` needs "which document points at which, through which field". `documents.mjs` already answers that for REFERENCED BY.
**Choice:** Call `referencesTo(target, { docs, collections })` once per placed document and keep the pairs where BOTH ends are on the board. The edge's label is `r.field` verbatim; `declared` rides along.
**Why:** A second relation scan would be a second answer to "what points at me", and the two would disagree the first time D4's rules changed (exact match against the names a document answers to, `id`/`slug`/provenance keys excluded). It also means a memory object with no schema — a territory, a learning — draws a labelled edge like anything else, dashed instead of solid because no collection declares the field. The inspector's GRAPH preview renders the same objects, from `Whiteboard.jsx`, so the preview cannot drift from the board it opens into.

### `found_in` and `top_finds` are TWO edges, not one
**Q:** A guest's `found_in` and its group's `top_finds` describe the same pair. Collapse them into one line?
**Choice:** No. Two edges, opposite directions, each labelled with its own field.
**Why:** They are two facts, written in two files, and either can be true without the other — a group can list a guest it did not find, and a guest can point at a group that never curated her. Collapsing them would invent a symmetric relation the datastore does not have, and the label would then have to name one field and hide the other.

### The whiteboard document has no `layout` field
**Q:** FrameForge's board persists `layout` and re-applies it. Port that?
**Choice:** No. `PATCHABLE` is `['view', 'nodes']`. Auto-align is a button that returns a new node list and nothing remembers it was pressed.
**Why:** T15 §5 — a stored "current layout" is how an action quietly becomes a mode, and the next render then throws away the card you dragged next to its territory. The alignment lives in the coordinates, where it is editable.

### The camera is saved but is not a revision
`view` is written to disk (a board should reopen where you left it) yet a camera-only write leaves `rev` alone, appends no log line and emits no event. `updated` still moves, because the file really was written. Same rule as `board.mjs`, and the test asserts both halves.

### A `territory` node is a presentation choice; the address is always a path
**Q:** M3 put territory at `territory/<id>.md`, but the seeded workspace's ground is a `#group` record. Which one does a territory node point at?
**Choice:** Either. `document`, `territory` and `goal` all carry a store-relative `path`; the kind only decides what the card shows (a territory card shows the yield that `territory.mjs` computes, a goal card the progress `memory.mjs` computes). Edge derivation reads the frontmatter and does not care which kind rendered it.
**Why:** One addressing scheme. The alternative — a territory node carrying an `id` and a document node carrying a `path` — is two ways to name the same file, and the edge derivation would need to understand both.

## M3 · memory, decay and the hot cache (T09 · T10)

### A win is the collection gate's `done` group, not a hard-coded status list
**Q:** `territoryStats` must decide which records count as `wins`. `refresh.mjs` (folder mode) uses a literal `['won','booked','replied']`.
**Choice:** The gate field's `done` group from `collections.mjs` decides, and `WIN_STATUSES` is only the fallback for a record whose collection declares no gate.
**Why:** The schema already declares what "finished" means, and it is the same declaration the board columns and the promotion gate read. A workspace that renames `won` to `signed` moves its hit rates with no code change; a literal list would silently zero every rate the day someone edited their own collection. The fallback keeps folder mode and API mode agreeing when no schema claims the record.

### Archived records stay in `finds`; quarantined records are in nothing
**Choice:** `data/_archive/**` counts toward `finds` and can never be a `win`. `quarantined: true` is excluded from both.
**Why:** Law 5 — a reject is labelled data, not a deletion, and dropping it from the denominator would make every hit rate jump the moment a human rejected something. Quarantine is the opposite case: docs/08 §3 says a quarantined record is excluded from every count, view, rollup and score until accepted. `records.mjs` owns the DETERMINATION; territory only honours the flag, so there is no second quarantine rule.

### Who counts as an agent, for the two human-owned objects
**Q:** `writeMe` must 403 an agent actor. Nothing in the docs says what an agent IS.
**Choice:** `assistants/<actor>.md` exists → agent · listed in me.md `agents[]` → agent · me.md declares an owner and the actor is not them → agent · **nothing declared yet → human**. `saveGoal` uses the same rule (docs/04 §6 puts `goals/` beside `me.md`).
**Why:** File truth, no heuristic on the name. The last rung is deliberately fail-open: a brand-new workspace has a placeholder `me.md` and no assistants, and a rule that locked the person out of writing their own identity on day one would fail the gate that matters more (GOAL.md §4.1 — productive in 15 minutes). A declared assistant is an agent from its very first run, which is the case that actually happens.

### Every summarising cap names itself, not only the compression ladder
**Q:** `renderCache` caps territory rows, never-tried rows, open questions and since-last-run lines even at level 0, before the budget is under pressure.
**Choice:** Each cap pushes its own line into `dropped[]` at every level, with a count.
**Why:** T10 says a silent truncation is a defect. Recording a drop only once the ladder engages would make the DEFAULT render — the one that runs every day — the silent one. In the 5,000-record demonstrate the ladder never engages (1,486 tokens) and the render still names the 18 territory rows and 1 never-tried row it summarised away.

### `v` moves only on regeneration, and `GET /api/context` serves the generated file
**Q:** A live render and the stored `version.json` gave two answers to "has the context changed?".
**Choice:** `renderCache` stamps the version that is on disk (0 when nothing has been generated); only `regenerateCache` increments it; `readCache` — which the route serves — returns the generated file. Deleting `.scout/cache/` regenerates at v=1, because it is disposable by Law 1.
**Why:** docs/03_MEMORY.md §2 makes the version a contract: an agent polls it to decide whether to re-read. A version that moved on every read would make it re-read always; one that lagged the text would make it never re-read. Same artefact, one number.

### An injected body's headings are demoted, never dropped
**Q:** `me.md` and a project brief carry their own `## Notes` / `## Scope`, which appeared as extra top-level sections inside the context file.
**Choice:** Demote every heading in an injected body to `###`. Nothing is removed.
**Why:** docs/03_MEMORY.md §1 says identity goes in **in full**, and docs/08 §5 fixes exactly eleven top-level headings. An agent splitting the context on `/^## /` would otherwise read the identity as two objects.

### A retired playbook claim prints why it was retired, never the claim
**Choice:** `retired_because` (or `retired_why` / `why`), falling back to a bare `RETIRED`.
**Why:** The line exists to stop the agent re-deriving a belief that was disproved. Printing the belief does the opposite — it reads as a claim with a strikethrough, and strikethrough is not a thing a model reliably obeys.

### Dates are formatted through `decay.dayOf`, never interpolated
**Why:** gray-matter parses an unquoted YAML date into a real `Date`, so `access_changed: 2026-07-30` rendered as `Thu Jul 30 2026 02:00:00 GMT+0200 (Central European Summer Time)` — inside the agent's context file. One formatter, in the module that already owns date parsing, and a test that asserts no `GMT+NNNN` and no `Www Mmm DD YYYY` ever reaches the cache.

### `readEvents` is defaulted, not required
**Q:** index.mjs mounts the memory routes with `{ logEvent }` only.
**Choice:** Both hooks default to `backend/log.mjs`'s real functions; `setScoutMemoryHooks` overrides them, and an explicit `null` switches the reader off.
**Why:** A `null` default would mean SINCE YOUR LAST RUN never renders in the running app — the one section that tells the agent what the human decided while it was away — and it would fail silently, which is the failure mode this milestone exists to prevent.

### `territory.mjs` gets its cache hook wired lazily
**Choice:** `memory.mjs` calls `setTerritoryHooks({ afterWrite })` from an idempotent `ensureWired()`, not at module scope.
**Why:** `store.mjs → memory.mjs → territory.mjs → memory.mjs` is a load-time cycle. Function declarations hoist, but the `const hooks` they close over do not, so wiring at module scope throws a TDZ `ReferenceError` in one of the two import orders and not the other. Lazy wiring cannot deadlock in either.

---

## 2026-08-19 · Integration decisions (the wiring pass)

### Quarantine is honoured in ONE place, and it is the view assembler
`docs/01_CANON.md` Law 4 says a quarantined record is "excluded from every count, view, rollup and
territory score". That exclusion lives in the `/api/collections/:id/documents` route, where every
view is assembled, and the held-apart records are **returned separately** rather than hidden.
**Why:** filtering inside each of the four view types is four chances to forget it, and the rule is
only a guarantee if it cannot be bypassed. Returning them separately rather than dropping them is
Law 8 — concealing a quarantined record leaves the human no way to accept the ones that are fine.

### The demo workspace carries `provenance: pipeline`, and one record deliberately does not
All 21 seeded records read back quarantined at first, because every one is `created_by: scout-fb`
with no provenance — which is the correct rule applied to data that was authored as though it had
come through the pipeline. Stamping them fixed the data, not the rule. `data/guests/ana-villaflor.md`
is left unstamped **on purpose**, so the quarantine state is visible in the UI and provable in
`npm run demonstrate`. It is not an oversight; deleting it would remove the only live example.

### `+ Add property` creates the field; it does not propose it
`docs/02_DATA_MODEL.md` §6 says every schema change is a proposal — that rule is about **agents**.
The human is the disposer, so `frontend/AddField.jsx` writes the field directly through the same
`saveCollection` an approved agent proposal ends in. One schema writer, two doors.
**Why:** a human proposing to herself and then approving her own card is ceremony, not a gate.

### A `.md` path opens the document surface; anything else opens the file browser
`openPath()` routes by extension. A territory, a playbook claim and a guest all open on the same
surface, read straight from their frontmatter, which is why Law 8 costs two clicks everywhere and
not five. A screenshot has no frontmatter to render, so sending it to the document surface would
show an empty editor over a real file.

### The rail's MEMORY group is exactly the four rows T11 names
It briefly had a fifth, "Memory", which opened the same screen as "Playbook" — two doors to one
room, which reads as a bug to anyone who tries both. `me`, the playbook and the learnings share one
surface on purpose (T11 step 1); Playbook is its door.

### The `_inbox/` watcher starts at boot, and an explicit sweep flushes before it answers
`refreshAgentFiles()` was debounced 500ms, so `POST /api/inbox/sweep` reported success over a
`_known.md` that had not been written yet — and the caller's very next move is to grep it. The
watcher still debounces (a batch of fifty drops must not regenerate fifty times); an explicit sweep
writes before returning. **The distinction is correctness, not performance.**

### Two guards were rewritten because they cried wolf on correct code
The date guard flagged `byDate('created')(a, b) || a.id.localeCompare(b.id)` — a correct date sort
whose `localeCompare` is only the id tiebreaker. The theme guard flagged a **comment** explaining
why the file must not ask the OS directly. Both now read the actual expression (and strip comments)
rather than matching anywhere on the line.
**Why:** a guard that fails on correct code gets switched off, and then it guards nothing. Both were
re-broken afterwards and observed going red, per this file's own standing rule.

---

## 2026-08-19 · Door 3, and four things it exposed

### The MCP tool list is GENERATED from `agentIndex.mjs`, never hand-written
`tools/list` is `INDEX_CAPABILITIES.map(...)`. A name collision throws at build rather than silently
dropping a capability, and a capability with no binding becomes a tool that names its own route and
says a binding is missing.
**Why:** T14 says "a new capability is a new Index line, never a router-skill edit". A hand-kept
second list would drift from the Index inside a week, and the drift would be invisible until an
agent called a tool that no longer matched its route.

### `/api/search` was advertising a capability it did not have
Fixed by indexing records and memory in `search.mjs`. Recorded here because the *class* matters more
than the fix: this is the second time in this repo that the agent-facing capability list has
promised routes that did not work (the first was `CORE_API_ROUTES` advertising 17 deleted routes).
**The rule: an Index line is a promise, and the only way to keep it is to call the route and read
the answer.** A status code is not enough — `/api/search` returned `200` with an empty envelope.

### `viewFor()` moved into `documents.mjs` because the quarantine rule was being re-assembled
`documentsFor` + the view + `excludeQuarantined` + `applyView` was written inline in the HTTP route
and again in the MCP tool. Six identical lines in two doors, where forgetting `excludeQuarantined`
in either would let a record an agent wrote around the pipeline count as real.
**A guarantee that has to be re-assembled per caller is not a guarantee.**

### `resolveTarget` is exported now
Door 3 had copied it privately so `move` could take a slug. Two answers to "which file does this id
mean", and the copy would not have learned about `data.id` if that rule ever changed.

### `scripts/**` ships in the packaged app
`electron-builder`'s `files` array did not include it, so a DMG would have had no MCP entry point —
door 3 would exist in the repo and not in the product.

---

## 2026-08-19 · What an adversarial review found after 580 tests were green

Five reviewers, one lens each, then a skeptic instructed to REFUTE every high-severity finding.
Three defects survived, all in the record pipeline, all reproduced. **A green suite is evidence
that what was tested passes, and nothing more.** All three shared one cause: *the fixtures were
easier than production.*

### D1 · a record the pipeline wrote did not match the collection that defines it
`workspace/.scout/collections/guest.md` queries `tag: guest` **and** `path: data/guests/**`.
`upsertRecord` satisfied the path half (via `dirForCollection`) and nothing satisfied the tag half.
Consequences, in order of how bad they are:
- **The gate failed open.** No collection matched → no gate field → an agent PATCHed `status: won`
  to HTTP 200 with `agentPromotion: false`. Law 4 was absent on precisely the records agents create.
- **Dedupe was dead.** The record was not a candidate for the next near-match pass, so the same
  person resubmitted returned `store` again and `writeMd` replaced a human's corrections wholesale,
  reporting success.
- **It was invisible** — no table, no board, no DECIDE queue, absent from the hot cache counts and
  from `_known.md`, so folder-mode agents re-added the same people forever.

`upsertOne` now unions `collection.query.tag` into `fields.tags`, on the store branch **and** the
merge branch, so an already-orphaned record rejoins its collection the next time anything touches it.

**Why every test missed it:** `tests/phase-records.test.mjs`'s fixture declared `path` and no `tag`,
and `intake.mjs` creates interview-born collections path-only. The defect existed *only* on the
shipped schema — the one every gate demonstration runs against. The fixture now carries both halves.

### D2 · `source` was scored as identity, and it is provenance
`URL_KEYS` led with `source`, which scores 90 with no contradiction term, so total disagreement on
both name and handle could not pull it under the 60 merge threshold. `source` is the permalink the
agent actually saw and is **mandatory on every finding**, so everyone who commented on one post
shares it. A four-item batch of four distinct people returned `{store: 1, skip: 3}`.

The skip is unrecoverable by design: nothing is written, and the log line names the record they were
folded into — never the candidate that was lost. `api-mode.md` tells the agent skip means *"already
known — do not try again"*, so it never resubmits them. **A profile url identifies a person; a
permalink identifies a place.** `source` is out of `URL_KEYS`.

### D3 · three implementations of "is this quarantined"
`records.mjs` owns the predicate and `viewFor()` calls it. `territory.mjs`, two readers in
`memory.mjs` and `search.mjs` read the on-disk `quarantined: true` flag — which is only a *cache* of
that rule, written by `sweepQuarantine()` at boot and on the next upsert into that collection.

So for the exact threat Law 4 names — a folder-mode agent writing into `data/` while the app runs —
the view excluded the record and everything else counted it. Twenty rogue files gave
`VIEW total 1, quarantined 20` alongside `territory {finds: 21, wins: 20, hit_rate: 95.2}`, a goal
reported as met, and a hot cache telling every future agent that fabricated ground was its best
territory. All four readers now call the one predicate; the flag is a cache, not the rule.

### Two more the review surfaced, both real
- **`frontend/App.jsx` mounted `Whiteboard` with the wrong prop names.** It passed
  `project`/`onOpenPath`/`onOpen`; the component reads `board`/`onOpenDocument`/`onToast`. So `board`
  was undefined and `boardId()` fell back to `'main'` — **every project shared one board** — no card
  had a way down to its record (Law 8), and the 409 "your move was not saved" toast was a no-op, so
  a rejected drag was discarded in silence.
- **`frontend/Document.jsx` threw away an edit made within 800ms of navigating away.** The load
  effect's cleanup called `clearTimeout` on the autosave without flushing. Change a status cell,
  click Back inside 800ms: the PATCH was never sent, the file kept the old value, and the field had
  already changed on screen. It now flushes on navigate, on unmount and on `beforeunload`.

### `frontend/Freshness.jsx` was a second staleness rule
Hard-coded day buckets that know nothing about `sweep_interval_days`. On `territory/manila-nurses`,
where the human set the interval to 365 days, the meter rendered empty (dead) over an object the API
calls fresh. Law 3 says `decay.mjs` is the one rule; the meter now takes the API's `staleness` and
falls back to the buckets only for a plain `date` field, which has no window of its own.
**A second staleness rule that disagrees with the first is worse than no meter, because the meter is
what the person believes.**

### `skills/scout-router/references/api-mode.md` documented three routes that 404
`POST /api/search`, `POST /api/views`, `POST /api/runs/:id/steps` — and it promised a `409` on task
claim that the route never returns (it answers `200` with `{ won: false }`, so an agent following the
documented back-off would work a task someone else already owned). **This file is copied into every
agent session home, so a wrong line here is wrong in every run.** Corrected, and every route it names
is now probed against a live server.

### The thing to carry forward
Three of these were invisible to 580 passing tests and visible within minutes of *calling the route
and reading the answer*. The rule that would have caught all of them: **a fixture must be at least as
hard as production, and an advertised capability must be exercised, not asserted.**

---

## What the first person to actually use the app found (2026-08-20)

Reported as "I can't open documents, I can't add fields manually, I can't delete, etc." Four of the
five were real, and none of them was in the parts the suite or `demonstrate.mjs` looks at. Every one
was on the door only a **human** goes through.

### The server was stale, and the app said so in a way that read as "unfinished"
The running backend predated half the routes it was being asked for, so `/api/goals`,
`/api/assistants`, `/api/proposals` and `/api/projects` all 404'd and Today rendered
`THE GOALS ROUTE IS NOT UP YET` next to `THE ASSISTANTS ROUTE IS NOT UP YET`. Those strings are the
frontend's honest fallback, and they are correct — but nothing distinguishes *"this route was never
built"* from *"the process you are talking to is older than the code on disk"*, and the person
reading them cannot tell. **Restarting the API fixed every one of them.** Worth remembering before
diagnosing anything else: the backend has no reload, and `npm start` builds the UI but the process
that serves it is whatever was launched.

### `+ Add property` had never once worked
`AddField.jsx` posts `{ ...field, actor }`. `validateField` rejects any key outside the type's
allowlist — deliberately, so a typo cannot sit unnoticed in a schema for weeks — so **every** manual
field add, of every type, 400'd with `"actor" is not an option of type text`. The agent's path
(`proposals.mjs` → `addField(card.collection, card.field)`) always handed over a clean field, so the
capability worked for agents and had never worked for a person.

590 green tests said nothing because the only test of `addField` called the **function**, not the
route. **The route is where the actor is separated from the field** — CLAUDE.md already says a field
a route does not destructure does not exist. It now destructures, and logs a `schema` event with the
actor, which a schema change had never produced.

### Opening a record was a secret
Table, list and gallery have always been `click → select`, `double-click → open`. Both worked.
Nothing anywhere said so, the inspector's path was rendered as dead text while the identical line on
the document surface was a button, and so the whole document surface was unreachable for someone who
did not guess. **A double-click is not an affordance.** Law 8's "two clicks" was being counted from a
gesture nobody could see.

Fixed in one place, not three: `OpenRecord` in `ui.jsx`, reveal-on-hover (`rvH`/`rv`), used by all
three row renderers — and the inspector's path is now the button it always claimed to be. The
double-click still works; it is no longer the only way in.

### There was no way to remove anything
`api.archiveRecord` existed in `frontend/api.js` and **nothing called it**. `POST /api/records/archive`
had been reachable by agents since M2 and by a person never. The document surface now carries
`Archive`, which opens the five-reason strip (`REJECT_REASONS`, imported from `DecideCards.jsx` —
the same list, not a sixth copy) and cannot write without one. It never says *delete*, because
nothing is deleted: the file moves to `data/_archive/<collection>/` carrying `archive_reason`,
`archived_by` and `archived_from`, and the event lands in the log.

### `boot()` moved you to another collection while you were standing in a record
`boot()` ended with `pickCollection(collections[0].id)` unconditionally. It also runs after a schema
change — so adding a property on `#guest` silently switched the app to `#group`, and the document
surface then rendered a guest **through the group schema**: the collapsed row on a person showed
`members` and `swept`. It now keeps the active collection when that collection still exists.
`reload()` already did this correctly, which is what made the difference visible.

### And one more, still carrying the defect the handover says was fixed
`GalleryView` passed `onOpen={onOpen}` into `Cell`, which takes `onFollow`. That is exactly the
one-prop-two-signatures bug the handover records fixing for the table and the list — it was never
fixed in the gallery, so every relation chip on a gallery tile looked clickable and did nothing.

### The thing to carry forward
`npm test` is green, `npm run demonstrate` passes 10 of 10, and four capabilities a person needs did
not work. Both harnesses drive the app the way an **agent** does — through modules and HTTP. Nothing
in either one clicks a button. **A capability that only a human reaches needs a test that goes
through the human's door**, which for a route means the route, with the body the UI actually sends.

---

## The second round of feedback: the editor, the properties, the popup, the table (2026-08-20)

> "I want a full working Markdown editor, so please check Obsidian… properties are super hard to
> read, super cluttered, and not well-organized. Also, the pop-up is super bad, very horrible…
> Make sure the table looks more like a table where I can make the rows smaller or bigger, where I
> can change the view to Kanban, etc., and where I can create sub-views based on filters manually."

Every one of these was already answered somewhere in this repo — in `docs/06_REUSE.md`, in
`backend/views.mjs`, or in a field that had been written and never read. The theme of the whole
round: **the backend was ahead of the UI, and nothing on screen said so.**

### The references, and where they actually are
`docs/06_REUSE.md` names them with URLs, licences and a take-this table. The one that matters here
is **`geckse/tesseract-md-app` (MIT)** — named down to individual component files:
`FrontmatterEditor.svelte`, `PropertyRow.svelte`, `AddPropertyRow.svelte`,
`TypePickerDropdown.svelte`, `TableView`, `TableToolbar`, `SaveViewModal`. Clone it and read it
before touching any of those surfaces. Obsidian is the other reference and it is on this machine:
`/Applications/Obsidian.app/Contents/Resources/obsidian.asar` → `app.css` carries the real
properties metrics (`--metadata-gap: 3px`, `--metadata-label-width: 9em`,
`--metadata-input-height: calc(font-size * 1.75)`), extractable with
`npx @electron/asar extract-file`.

### The properties were fifteen shouted rows, six of them provenance
40px rows, every label in 9px mono ALL CAPS at .16em tracking, a three-letter type word down the
gutter (`TXT STA SEL REL NUM DTE Y/N TAG WHO`), and `created / updated / created_by / provenance /
updated_by / verified_at` interleaved with the person's own nine, printing
`2026-08-15T00:00:00.000Z` at full width.

Fixed by taking all three answers from the references: the type gutter is an **icon** (Tesseract's
`PropertyRow` / `TypePickerDropdown`), the rows are **Obsidian's height**, and the machine fields
are their own collapsed **SYSTEM** group. Labels are sentence case — ALL CAPS is the one eyebrow
above a section, not every row inside it. `cells.jsx dateFieldText` trims a stored ISO instant to
the shape the editor writes, in the one place a field type becomes UI.

### The popup was a dialog for adding one column
520px over a dimmed page: a title, two paragraphs, thirteen full-sentence type buttons wrapped over
four lines, then Add/Cancel. `docs/06_REUSE.md` already pointed at `AddPropertyRow.svelte` for this
and the shape there is a **row in the property list**, with the type behind a small anchored
popover. It is now that, it opens in the slot the property will occupy, and the whole interaction is
type a name and press Enter.

### The table controls existed in the backend and had no UI at all
`views.mjs` has shipped `type` (table · board · list · gallery), `filter` with nine operators,
`sort`, `group`, `fields` and **`density`** since M1, and `PUT /api/views/:collection` writes them
into the vault. `density` had never had a single reader — it has been in `defaultView()` from the
beginning. `api.deleteView` did not even exist on the client, though the route did.

`ViewBar.jsx` is that missing UI, and it writes REAL saved views through the one route, so a view a
person makes is the same object an agent writes and it lands in `.scout/views/<collection>.json`
where the data carries it. Changing the shape or the density therefore SAVES — a collection turned
into a board is a board tomorrow and on the other machine. Storing it as a session preference would
have meant two people looking at one collection and describing different screens to each other.

`saveView` also had to stop re-ordering: it filtered the old entry out and appended, so a view's tab
jumped to the end of the strip every time you changed its shape. The control moved because you used
it. It now replaces in place.

### The editor: eleven dependencies now, and why
CodeMirror 6, chosen by the owner. It is what Obsidian's editor is built on and what the reference
uses for its source mode. Live preview is not a preview pane — the markup stays in the document and
is hidden on every line the cursor is not on, so a heading reads as a heading until you put the
caret in it. `MarkdownEditor.jsx livePreview` is a ViewPlugin doing exactly that over the syntax
tree. The EDIT / DONE toggle is gone: it only existed because the two states were two different
components.

### The three defects the editor exposed on its first open
1. **Opening a record rewrote it.** The editor adopts the text it is handed; that adoption looked
   like a keystroke, the save path PATCHed the body back, and the server took it — `updated`,
   `updated_by` and `verified_at` all rewritten, plus an `update` event with `changed: []`. Merely
   scrolling past a record reassigned it from the assistant that found it to the human who looked
   at it. `updated_by` is the field Law 4 reads to ignore an agent promotion and `decay.mjs` reads
   to decide what is stale, so this is not noise — it tells the agent everything was re-verified
   today. Fixed in **both** halves: the editor annotates an adopted value so it is not reported as
   an edit, and **`patchRecord` now refuses a patch that changes nothing**, because a surface that
   lies about an edit is exactly what the server should survive.
   Guarded in `tests/phase-review-regressions.test.mjs` as D4.
2. **The document surface rendered whatever collection the RAIL had selected.** Open a group while
   `#guest` is active and a Facebook group grew `Score`, `On camera` and `Found in` as editable
   rows — and writing one put a guest's field into a group's frontmatter, which is what happened
   here. `readRecord` had returned the document's own collection all along; the surface ignored it.
   A schema is a property of the record, not of the screen you arrived from.
3. `GalleryView` was still passing `onOpen` where `Cell` takes `onFollow` — the one-prop-two-
   signatures bug the handover records fixing for the table and the list, never fixed in the
   gallery.

### The thing to carry forward
Four features in this round were *already built* and unreachable: archive, view shapes, density,
saved-view filters. The build's failure mode is not missing capability, it is **capability with no
affordance** — and the two look identical from the outside, except that the second one is worse,
because the person concludes the app cannot do it and stops asking.

---

## 2026-09-06 · A checked-in demonstration workspace, and why `npm run demo` refuses

### The gap
`workspace/` is gitignored — a workspace is a user's data and never belongs in this repo — but
`scripts/demonstrate.mjs` copied `workspace/` unconditionally and `HANDOVER.md` told a new person
to run `npm run demonstrate` first and then `npm start` and press `D`. **On a fresh clone both were
impossible:** demonstrate died on the missing folder before printing a single gate, and `npm start`
landed on the first-run interview with nothing in it. GOAL.md gate 10 — *"a second person can run
and extend the app from these docs alone"* — therefore failed on the one thing the docs open with,
and no test could see it, because every test builds its own root in `/tmp`.

### The decision: a fixture in the repo, not a generator
`workspace-demo/` is checked in as plain markdown — Crystal, 22 guests, 8 groups, 7 pieces of
ground, five playbook claims, four learnings, four assistants, a project with tasks, a DECIDE queue
of six kinds, three runs and two days of event log. `demonstrate.mjs` copies `workspace/` when it
exists and `workspace-demo/` when it does not, and **prints which one it used** — "10 of 10" over an
unnamed workspace is a claim nobody can check.

**Why a fixture and not a seed script.** Law 1 says the files are the truth. A generator would make
the truth a program, and the first question anybody asks of demo data — *"what does a real record
look like on disk?"* — would then be answered by reading code instead of by opening a file. It also
makes the fixture editable by the person it is for: `workspace-demo/` opens in Obsidian like any
other vault. The build script that produced it wrote every file through `store.mjs writeMd`, so the
frontmatter is byte-for-byte the shape the pipeline writes, and then it was thrown away.

### `npm run demo` refuses to overwrite `workspace/`
It copies `workspace-demo/` → `workspace/`, sweeps `._*` on the way in, and **stops with one line
and exit 1 if `workspace/` already exists.** Law 5 is not a rule about the app only. A convenience
script that clobbers somebody's real vault to save them one `rm` is the same failure with a
friendlier name, and it is worse than the app doing it, because nobody expects a setup command to
destroy anything. Moving the existing workspace out of the way stays the person's decision.

### Dates are frozen against 2026-09-06, so decay is visible rather than described
The fixture is not "recent data": every date in it was chosen so the intended things read stale on
the day it was written and the rest read fresh. `playbook/two-message-rule` and
`playbook/screenshot-the-post` are past their 30-day window, so they are excluded from the hot cache
and named in `excluded[]` while their files stay untouched. `territory/ofw-stories` is twelve days
unswept against a seven-day interval, so it renders `← STALE`. `territory/manila-nurses` is
`rejected 2026-07-30 · do not re-request`, `territory/health-workers` is `pending since 8d`, and
`territory/frat-alumni-ph` is untried and attributed to the vetter. Both goals have deadlines in the
future so "days left" is positive, and exactly one of them is behind. That is gate 7 demonstrated by
data rather than asserted by a comment — and it is the reason the fixture should be re-dated, not
"refreshed", if it ever stops reading the way it is meant to.

### Two ids, two objects, on purpose
A piece of ground is **both** a `#group` record under `data/groups/` and a memory object at
`territory/<id>.md`, under the same id. The group carries the catalogue — members, platform, and the
hand-counted `finds` / `booked` that `my-best` sorts on (seeding ambiguity 5, above). The territory
carries the live scoreboard, whose `finds` / `wins` / `hit_rate` are rollups `backend/territory.mjs`
computes and nobody types. `guest.found_in` points at the id, so it resolves as a relation chip to
the group **and** scores the territory, with one value and no second source of truth.
`manila-foodies` is deliberately a group with no territory file: 62 finds, 0 booked, dropped as
working ground — it is why `my-best` sorts on `booked` and never on `finds`.

### `guest.found_in` targets `#group`, not `#territory`
`backend/collections.mjs` validates a relation's `target` against the collections that actually
exist on disk, and `addField` re-validates the whole schema. A `found_in` pointing at `territory`
would therefore need a third collection file whose only purpose is to satisfy the validator — and
gate 8, which adds a field to `#guest` through the real route, would 400 without it. Pointing at
`#group` is both true (that is where the person was found) and self-contained.

---

## 2026-09-06 · Finishing pass — what an end-to-end walk found, and the calls taken fixing it

Context: three auditors walked the app the way a person and an agent do — one drove every
route with the bodies the UI sends, one read every core screen against the spec, one read the
memory and utility screens — and 45 findings came back, most reproduced with a curl. The fixes
were built by three parallel implementers under strict file ownership (docs/08 §0's rule). The
decisions each of them took where the docs were silent:

### The DECIDE queue
- **A human answering her own assistant is the evidence.** A `question` card could not be accepted
  at all — the effect wrote an active learning and `saveLearning` refused it for having no
  `evidence[]`, a word that appears nowhere on her screen. The answer now lands with the card's own
  file as its evidence (`[[proposals/<id>]]`, the wikilink convention every other card uses), and the
  hot cache renders it as `question — answer` rather than a bare "Yes." bullet competing for the
  2,000-token budget with claims that carry proof.
- **A blocked task's card is titled the way the screen titles it.** `pullIntoDecide` read the slug
  id and never the `question` the agent was told to send. `humanName(task)` mirrors
  `Assistants.jsx taskTitle()` — `label || (title ≠ id) || id` — so the card and the roster agree.
- **A territory is one shape on the way in and one function on the way out.** `territoryOf()` accepts
  a bare id or `{ id, label, kind, url }`; a card with no resolvable id is a 400, and
  `territory/_object_Object_.md` cannot be written again. A bare id stays a bare id on disk (Law 1 —
  `territory: ofw-uk` is what a person should read).
- **`POST /api/territory/propose` writes nothing.** It made a memory object with `proposed: true`
  and no card, and the cache then listed the unapproved group under NEVER TRIED. It now makes a
  `territory` card through `propose()`; accepting the card is what writes the file, at
  `access: requested`. `why` is mandatory, because a card nobody can judge is a chore.
- **An agent's `store` is a decision.** Forty overnight finds showed `NEEDS YOU: 0`, because only
  proposal cards count. `upsertRecord` now raises a `finding` card when the actor is an agent, the
  verdict is `store`, and no open finding card already points at the record. `update`, `merge` and
  `skip` raise nothing. The Index and the router skill say so, so an agent does not double-post.

### Tasks
- **A task id comes from one function.** `taskIdFrom({ id, title, label })`; a POST naming nothing is
  a 400, and `saveTask` refuses the id `untitled` when the patch names nothing. Two label-only
  POSTs used to become one file with the second label and the first task's territory (Laws 5 and 6).

### Schemas
- **`multiselect` may declare no options — it is then an open vocabulary.** "Seeding ambiguity 1"
  resolved: a tag field whose options must be declared up front is not a tag field. `select` and
  `status` still require a fixed set; declared options are still validated on all three.
- **`addField` validates the incoming field and the invariants, not the neighbours.** A pre-existing
  bad field is returned as `warnings[]` naming it, instead of a 400 naming a field the person never
  touched — which is what made `+ Add property` fail on the shipped #guest for a whole build.
- **A dangling `default_view` is said, not swallowed.** `listViews` returns `warnings[]`, the UI toasts
  it, and the template ships the views its schemas name (`needs-review`, `pipeline`, `my-best`).

### Memory and the cache
- **Worked ground is `joined` OR `finds > 0`; blocked beats worked.** Territory the interview seeds is
  `untried`, and it stayed so after finds and a win, so the agent was told the group it won on had
  never been tried. A rejected group with old finds renders under BLOCKED only.
- **`proposed: true` is invisible to the cache everywhere.** Belt and braces beside the route change.
- **Regenerations are not activity.** SINCE YOUR LAST RUN spent one of its six lines on "regenerated
  the cache", and rendered a card's `why` prose as a tally suffix. `cache` events are excluded before
  the cut; `reason` (a closed vocabulary) is still tallied, `why` (prose) is not.
- **Every memory writer schedules its own regeneration.** The hook used to be wired only when routes
  were registered, so a write from the MCP process never invalidated the cache while
  `cache/version` swore it was fresh. `flushCacheRegen()` exists for a process about to exit.
- **`records.mjs` writes only under `data/`.** `PATCH /api/records` — the door the document surface
  sends every `.md` through — had no scope guard: an agent refused at `PUT /api/me` could rewrite
  `me.md` and a goal's target through it, to HTTP 200. Outside `data/` the route now 403s an agent
  with the memory route's own string and delegates a human's edit to the owning writer.
- **A goal can be created.** `POST /api/goals` (409 on an existing id), and the interview writes the
  first one from the `chasing` answer — number words parsed, a date resolved forward, progress
  counted over the new collection's gate. A goal with a label and no number beats no goal.
- **The Index names the port that is bound.** `selfPort()` fell back to FrameForge's 5176;
  `setSelfPort(server.address().port)` is called from the listen callback and from `demonstrate`.

### The frontend half
- **`frontend/ScoutSettings.jsx`, not `Settings.jsx`.** FrameForge's settings screen was 433 lines
  nothing mounted; the theme radio and the key field were lifted into a Scout-native screen with a
  name that cannot be confused with the deleted one. It also carries the storage root with Reveal
  and the keyboard cheat sheet — the only place the app's keys are written where a person can read them.
- **A toast clears itself unless it is a refusal.** Danger-toned toasts (a gate refusal is the one
  that matters) wait for a click; everything else clears after 8s and on any navigation, so a stale
  confirmation never sits over the next screen.
- **`location.js` and `slashCommands.js` stay** although nothing in the running app imports them:
  a test guards each, and the M0 decision recorded keeping `slashCommands` trimmed. Deleting a
  guarded module is a decision for whoever removes the guard.
- **A blocked task's card id is computed client-side** as `task-<project>-<id>`, mirroring
  `tasks.mjs pullIntoDecide`, rather than adding a lookup route for one click.
- **One "open in the whiteboard" control, not two.** The inspector's path-less "OPEN THE WHITEBOARD"
  link and the GRAPH preview's button did the same job with different results; the button now
  carries the path and places the document and its relations on the board (Law 10).
- **Only a `status` field is a stage.** The collapsed row falls back to a `select` for display, and
  the promote button borrowed that fallback — on `#group` it offered "instagram" as the next stage.
  `nextStage` now requires `type: status`; a collection without one has no promote button.
- **The territory node's HIT RATE is `hit_rate` as computed** (`territory.mjs` gives a percentage);
  the node multiplied it by 100 and printed 2500%.

### The fixture exec bits (a trap, now guarded)
Four stub CLIs under `tests/fixtures/` were committed as `100644`. On a checkout that honours
modes — every Linux clone, most macOS clones off exFAT — seven tests died with `spawn … EACCES`,
which reads like a runner bug. They are `100755` now and `tests/_env.mjs` re-asserts the bit, so a
zip download or a mode-stripping filesystem cannot bring the failure back. The CI workflow runs on
ubuntu for exactly this class of defect.
