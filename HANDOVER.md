# HANDOVER — Scout, as of 2026-08-19

You are taking over a partially-built app. **M0 is done. M1 is about half done. M2–M5 are untouched.**

This file tells you exactly where things stand, what was decided, and what will bite you. It does not replace the spec — it tells you how the spec has actually been applied so far.

---

## 0 · Read in this order, before writing anything

1. **`GOAL.md`** — the acceptance contract and the ten gates. It wins every conflict.
2. **`CLAUDE.md`** — source-of-truth table, hard rules, ports.
3. **`docs/01_CANON.md`** — the ten laws and the failure each prevents.
4. **`docs/decisions.md`** — ~25 decisions already made. **Do not re-litigate these.** If you disagree with one, say so and change it deliberately; do not quietly do something different.
5. **`docs/FRAMEFORGE_CLAUDE.md`** — the parent repo's agent doc. It documents traps that have already cost days. Where it and `CLAUDE.md` disagree, `CLAUDE.md` wins, but read it.
6. **`design/EXTRACT.md`** — what the design files actually specify: the token block, the component→filename map, the measured layout contract, and four questions with the answers I chose.
7. **`docs/07_BUILD_ORDER.md`** and the `tasks/T*.md` file for whatever you are about to build.

Then `docs/02_DATA_MODEL.md`. Read `03_MEMORY.md` at M3 and `04_AGENT_CONTRACT.md` at M4, properly, not before.

---

## 1 · Where the build actually is

### Done and demonstrated

| | |
|---|---|
| **Phase 0 · design** | All 9 files from Claude Design project `f84bb492` are in `design/`. `design/EXTRACT.md` is the audit. The `:root` block is **27-for-27 identical** to `frontend/styles.css` — the token reconciliation was a genuine no-op. |
| **Phase 0 · fork** | FrameForge copied in; its agent docs preserved as `docs/FRAMEFORGE_*.md`. |
| **M0 · T01 strip** | Frontend 83→27 files, backend 51→25 modules, tests 56→33 files, 38MB of film assets gone. Product identity, ports (**5178** vite / **5177** api), env prefix (`SCOUT_`), and both FrameForge endpoints cut. Server boots, `/api/state` 200, deleted routes 404, `npm run build` clean. |
| **M1 · T02** | `backend/collections.mjs`, `backend/documents.mjs` derived-value half, routes. **Demonstrate section performed in full by curl** — see §5. |
| **M1 · T03** | `backend/documents.mjs`, `backend/views.mjs`, routes. Partially demonstrated — see §2. |

### Half done — read this carefully

**There is a table surface, and it is NOT T04 or T05.** I built `frontend/TableView.jsx`, `Inspector.jsx`, `cells.jsx`, `Freshness.jsx` and `Rail.jsx` out of task order, because the owner asked to see something rather than an empty shell. They work and they are wired to real routes, but they are a *read-only collection table*, not the tasks they resemble:

- **T04 (document surface) is NOT started.** There is no document surface at all. No properties-collapsed-on-open, no `Editor | Raw` toggle, no editable typed rows, no `+ Add property`, no `ConflictNotification`/`DiffView`, no summary block. Clicking a row fills the inspector; it does not open the record. **Read `tasks/T04-document-surface.md` and build it properly.** `cells.jsx` is read-only by design and is the right place to add the editors.
- **T05 (inspector) is NOT complete.** The five sections exist in the right order with counts, and `REFERENCED BY` is visually distinct from `LINKS` as the task requires. But `HISTORY` is a stub (it needs M2's event log) and **`REFERENCED BY` is computed client-side from the currently-loaded rows of the active collection only** — so a guest referenced by a territory, a learning and a project brief will show **nothing**, which is exactly T05's Demonstrate case. That needs a backend route that scans all documents for relation values pointing at this slug. It is the single biggest known-wrong thing in the codebase.

### Not started

**M2** (the four write verbs, near-match dedupe, `_inbox/` watcher, the gate, mandatory reject reasons, event log, Activity) · **M3** (memory, decay, the hot cache) · **M4** (assistants, tasks, three doors, DECIDE) · **M5** (whiteboard, files, light mode, interview, packaging).

**Nothing writes document files yet, on purpose.** `docs/01_CANON.md` and `CLAUDE.md` say only `backend/records.mjs` may, and it arrives at M2. Do not add a temporary writer in the meantime — that is how the dedupe/provenance/gate bypass happens.

---

## 2 · Known debt, stated plainly

Fix or accept these deliberately. None of them is hidden.

1. **~30 tests were failing at handover.** A subagent was mid-repair on `tests/` when this was written. Run `npm test` first and see where it landed. The failures are obsolete tests (deleted features), not product regressions — but *verify* that rather than believing it.
2. **`collections.mjs`, `documents.mjs` and `views.mjs` have no tests.** I demonstrated them by curl, which `docs/07_BUILD_ORDER.md` accepts as the Demonstrate step, but its Definition of Done also says *"it has a test if it is logic"* and this is logic. **Write `tests/phase-collections.test.mjs` before building on top.** The assertion that matters most: **frontmatter wins over the computed cache** (T02 step 5 says assert it).
3. **`REFERENCED BY` is wrong across collections** — see §1.
4. **T03's Demonstrate is not fully performed.** Two saved views returning different rows: yes, visible in the UI. A subtable listing only one guest's messages: the `bind` mechanism is implemented and the route takes `?bind=`, but there is no `message` collection to prove it with. "Delete `.scout/cache/` and everything still resolves": true by construction (every read recomputes) but not demonstrated.
5. **The seeded workspace may be incomplete.** A subagent was building `workspace/` (14 guests, 8 groups, goals, `me.md`, views) from the design's real content. What is on disk right now may be a throwaway 4-record fixture I made to test the wiring, or the real thing, or half of it. **Check `workspace/` and regenerate if it looks thin.** It is gitignored, so it is not in history.
6. **`frontend/api.js` was trimmed to the surviving routes**, and 48 dead methods removed. If you add a route, add the method — and if you delete one, check `api.js`. That check is what caught dictation being stripped by accident.
7. **The router skill is your real API checklist — and 15 of the 19 routes it calls do not exist.** `skills/scout-router/` (supplied by the owner, canonical per `CLAUDE.md`) is written against the *finished* Scout. It is a better route map than anything in the docs, because it is what the agent will actually call. Measured against the current backend:

   | exists | missing |
   |---|---|
   | `/api/collections` `/api/views` `/api/search` | `/api/index` · `/api/records/upsert` · `/api/records/match` · `/api/records/batch` · `/api/records/:id/move` · `/api/tasks/:id/claim` · `/api/territory/:id` · `/api/territory/propose` · `/api/playbook/:id` · `/api/learnings/propose` · `/api/collections/propose` · `/api/fields/propose` · `/api/outbound/propose` · `/api/runs` · `/api/runs/:id/steps` · `/api/cache/version` |

   That list maps cleanly onto the remaining milestones: `records/*` is M2, `territory` `playbook` `learnings` `cache` are M3, `tasks` `runs` `index` and the four `*/propose` endpoints are M4. **Build against this, and the skill starts working without being rewritten.**

   The skill probes `GET /api/context` to decide API mode vs folder mode. That currently 404s (the only `/api/context` route is FrameForge's asset upload), so the skill falls into **folder mode** — reading and writing the workspace directly. That is its designed graceful path and it works today, but it means the gate in `docs/01_CANON.md` Law 4 is **not being enforced against it**, because the gate lives in the route. Closing that is M2's job and is the single most important reason not to ship before then.

8. **`CLAUDE.md` and the code disagreed about where the router skill lives — now reconciled.** `CLAUDE.md` names `skills/scout-router/` canonical; the code had `backend/skills/scout-router/` holding an M0 stub I wrote, which was a straight duplicate of the supplied skill. The stub is deleted, `scout-toolsmith` moved alongside, and `backend/agentHome.mjs`'s `SYSTEM_SKILLS_SRC` now points at the repo root. Moving it out of `backend/` also broke packaging — `build.files[]` shipped `backend/**`, so `skills/**` had to be added or a packaged build would have had no router skill at all. Check that if you ever move it again.
9. **Light mode does not exist.** `docs/05_UI_SPEC.md` §4 gives the light token table but has **no light counterpart for `--accent-05/12/35/60`** — those four are defined in terms of the acid hue and have no equivalent for the deep-olive light accent. You will have to derive them and assert 4.5:1. Flagged as **Q4** in `design/EXTRACT.md` §5. No design file implements light mode either, so there is no reference for how the olive reads against a `--raise` chip or a `--marked` flag.

---

## 3 · Traps that will cost you hours

These are all real and all cost time already.

### The `._*` sidecars will fail your test run
This volume is **exFAT**, so macOS writes a `._X` AppleDouble beside almost every file. `npm test` runs bare `node --test`, whose discovery picks up `._phase-*.test.mjs` as real test files and fails them. **Sweep before every test run:**
```bash
find . -name "._*" -not -path "./node_modules/*" -delete
```
They regenerate within minutes. Deleting is hygiene, not a fix.

### Do not "fix" `npm test`
`"test": "node --test"` with no path argument is deliberate. Node ≥22 resolves a directory argument as a module path and dies with `MODULE_NOT_FOUND` before running anything. That regression has shipped once already.

### BSD `sed` silently ignores `\b`
`sed -i '' 's/\bfoo\b/bar/g'` matches **nothing** on macOS and exits 0. It looks like it worked. Verify every sweep with a follow-up grep. Same shape as the lying-search traps below: the command succeeds, the work does not happen.

### A zero-hit search is a claim, not a fact
`docs/FRAMEFORGE_CLAUDE.md` documents two cases where a lying search cost hours. Two more happened during this work:
- `grep --include=*.mjs` **unquoted in zsh** fails with a glob error that reads like "no matches".
- `docs/FRAMEFORGE_CLAUDE.md` itself cites `frontend/App.jsx` `projectTabs()`. The symbol is `projTabIds()`. The doc is stale; the search was right.

**Run a positive control before believing any negative result.**

### Static imports of deleted modules fail at boot, not at use
Three keeper modules (`search.mjs`, `feedback.mjs`, `distill.mjs`) statically imported from the delete-set. A static import of a missing module throws at *import* time, so any one of them would have taken the whole server down rather than degrading a feature. If you delete a module, grep for its importers **first**.

### Silent breakage in `agentHome.mjs`
`agentHome.mjs` mounts `backend/skills/scout-router/` into **every** session via hardcoded paths. Deleting or renaming that directory does not crash the server — it silently breaks the first session anyone opens. `BUILTIN_PACKS` is deliberately `[]` rather than removed, so every enablement path stays exercised.

### Ports
API **5177**, vite **5178**. The backend does **not** read `SCOUT_API_PORT` — only vite does, to pick its proxy target. Pass the port as argv: `node backend/index.mjs 5177`. The proxy target stays `127.0.0.1`, never `localhost` — the backend binds IPv4 only and macOS resolves `localhost` to `::1`.

---

## 4 · Rules that are enforced, and were nearly broken

- **`writeMd` uses the `{content}` form of `matter.stringify`.** The bare-string form re-parses the body, so a note beginning with a `---` rule loses its first block into frontmatter, silently. Intact in `backend/store.mjs`; do not touch it.
- **`readMd` passes `cache: false`.** gray-matter caches by content and stores an EMPTY result on the error path. Intact.
- **Every write is tmp + rename.** Readers swallow parse errors by design, so a half-written file does not error — it *vanishes*. `views.mjs` and the computed cache follow this too.
- **Only `records.mjs` writes document files.** It does not exist yet. Nothing writes documents. Keep it that way until M2.
- **Never a raw hex in component code.** There were three inherited violations; all three are fixed and `frontend/tokens.js` + `frontend/styles.css` are now the only homes. `tests/phase-design-tokens.test.mjs` fails the suite if they drift. If no token fits, add one to `:root` + `tokens.js` + `docs/DESIGN.md` **in the same commit**.
- **Grep before you build.** `frontend/ui.jsx` is the primitive registry (`Btn Card Eyebrow Empty Input Field Chip InlineEdit`) — import them. `frontend/sx.js` is how the design's inline style strings get ported verbatim; use it rather than retyping values into CSS classes. The parent repo carried three implementations of one composer and it cost weeks.

---

## 5 · What "demonstrated" looked like, so you can match the bar

T02's Demonstrate, performed by curl against a temp root:

```
rollup over 2 findings                       evidence_count: 2   evidence_weight: 5
added a third finding, changed the data      evidence_count: 3   evidence_weight: 10   ← followed
wrote evidence_count: 99 into frontmatter    evidence_count: 99                        ← frontmatter won
                                             evidence_weight: 10                       ← sibling still computed
```

Validation, each returning 400 with a usable message:
- unknown field type → *names the full legal set* (T02 step 3 requires this)
- two `primary: true` fields
- two `gate: true` fields
- a relation whose target is not a collection → *lists the collections that do exist*

**Demonstrate, don't describe.** A task is done when its Demonstrate section can be performed, not when the code merges.

---

## 6 · Decisions already made — do not silently redo

Full reasoning in `docs/decisions.md`. The ones most likely to trip you:

- **The strip went far beyond `tasks/T01`'s named lists.** T01 named 14 frontend and 14 backend modules; the real film domain was 56 frontend files and 26 backend modules. T01's lists were a starting point, not a boundary. **T01 is also self-contradictory as written** — six modules it says to delete are imported by modules it says not to touch.
- **`imageSize.mjs` was kept** though `docs/06_REUSE.md` lists it under Delete. It is 53 lines reading PNG/JPEG headers, nothing film about it, and Scout needs it for the `file` field type and the gallery view.
- **Dictation was kept.** `transcribe()` lived in the mostly-film `groq.mjs` and was nearly stripped. `VoiceInput.jsx` is a `06_REUSE` keeper and `GOAL.md`'s interview is voice-enabled.
- **The four design questions are answered** (`design/EXTRACT.md` §5): rail shell wins over the top-nav shell; `Scout.dc.html`'s full-pane surface is canonical over the slide-over; `config/guest-research.md` is demo data and stages come from the one `gate: true` field; light mode is derived at T16.
- **Properties collapse on open** — the design renders them expanded, `docs/05_UI_SPEC.md` §2.1 quotes that behaviour and says *"Invert it"*. The spec is deliberately overriding the design. This is T04's job and is not done.
- **The asset-kind vocabulary is the folder name** on both sides (`backend/board.mjs` and `frontend/Board.jsx`) now that the film cast/location/wardrobe/prop table is gone. T15 replaces both with Scout's node kinds.
- **Tests were salvaged rather than deleted** where they guarded a surviving rule. Where a test's subject was deleted but its *rule* still matters, there is a **comment in its place** saying what it guarded. See `tests/phase-windows-spawn.test.mjs` and `tests/phase-overwrite-guards.test.mjs`. Follow that convention — a deleted test with no trace is a rule nobody knows they are breaking.

---

## 7 · Suggested order from here

1. **Get the suite green** and write the missing tests for `collections.mjs` / `documents.mjs` / `views.mjs`. Do not build on an unmeasured foundation.
2. **Fix `REFERENCED BY`** with a real backend route. It is T05's Demonstrate case and it currently cannot pass.
3. **T04 — the document surface.** The largest single piece of remaining M1, and the most-used screen in the app. Properties collapsed, summary highest, `Editor|Raw`, typed editors, conflict UX. Port Tesseract's frontmatter-editor *pattern* into React; do not copy the Svelte.
4. **Then M2** — `records.mjs`, the four write verbs, near-match dedupe, `_inbox/`, the gate, mandatory reject reasons, `log.mjs`, Activity. This is where the product's spine is, and `HISTORY` in the inspector unblocks with it.
5. M3 → M4 → M5 per `docs/07_BUILD_ORDER.md`.

**Demonstrate each task's Demonstrate section before moving on.** Record every ambiguity you resolve in `docs/decisions.md`: the question, the choice, the reason. That file is the reason this handover could be written at all.

---

## 8 · Running it

```bash
npm ci
npm test                     # sweep ._* first
npm run server               # express on 5177
npm run dev                  # vite on 5178, proxies /api → 127.0.0.1:5177
```

The design prototypes are the visual truth and render standalone (they pull React from a CDN):

```bash
cd design && python3 -m http.server 5199
```

Then open `Scout.dc.html` (shell + collection table + inspector), `Today.dc.html`, `Decide.dc.html`, `Territory.dc.html`.

Work on `feat/` `fix/` `chore/` branches. The pre-strip baseline is the first commit on `chore/fork-and-strip`, so everything above is reversible.
