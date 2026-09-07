# 08 · MODULE CONTRACTS — the signatures every module agrees on

Written at the start of the M2–M5 build so several people can work in parallel without
inventing two of anything. **If you need a signature that is not here, add it here first.**

`GOAL.md` > `docs/01_CANON.md` > `CLAUDE.md` > this file.

---

## 0 · Rules for everyone working from this file

- **Create the files you own. Do not edit `backend/index.mjs`, `frontend/api.js`,
  `frontend/App.jsx` or `frontend/Rail.jsx`** — those are integration points owned by one person.
  Export your routes as a `registerXRoutes(app, deps)` function and they will be mounted.
- **Only `backend/records.mjs` writes files under `data/`.** Everything else calls it.
- **Never a raw hex in component code.** `frontend/styles.css` `:root` + `frontend/tokens.js`.
- **Import `frontend/ui.jsx` primitives** (`Btn Card Eyebrow Empty Input Field Chip InlineEdit`)
  and `frontend/cells.jsx`. A second implementation of a chip is a bug.
- **Sweep `._*` before every test run:** `find . -name "._*" -not -path "./node_modules/*" -delete`
- Tests: `node --test tests/<your file>.test.mjs`. Use `tests/helpers.mjs` for a temp root.

---

## 1 · `backend/log.mjs` — the event log (M2)

Append-only, one file per day at `<root>/log/<YYYY-MM-DD>.md`. Every mutation lands here.
Line format — greppable by a human, parseable by us:

```
- 2026-08-19T09:04:12.331Z · scout-fb · store · data/guests/maria-santos.md · {"confidence":0}
```

```js
export function logEvent({ type, actor, target, detail })   // → the event object
export function readEvents({ limit = 200, since = null, target = null, type = null })  // newest first
export function eventsFor(targetPath, limit = 50)           // HISTORY in the inspector
export const EVENT_TYPES  // 'store' 'update' 'merge' 'skip' 'move' 'archive' 'refused'
                          // 'quarantine' 'accept' 'propose' 'decide' 'cache' 'claim' 'inbox' 'schema'
```

`actor` is an actor id: `crystal` (a human) or `scout-fb` (an agent). Never blank.

## 2 · `backend/decay.mjs` — one staleness rule for the whole app (M3)

```js
export const TYPE_WINDOW = { territory: 7, playbook: 30, learning: 90, record: 30 };
export function ageDays(obj, now = Date.now())    // from verified_at || updated || created
export function staleness(obj, now = Date.now())  // 0..1, clamped. sweep_interval_days overrides
export function isStale(obj, now = Date.now())    // staleness >= 1
```
`obj` is frontmatter (`{ type, verified_at, updated, sweep_interval_days, deadline }`).
**Never inline a second staleness rule anywhere.** The frontend gets staleness from the API.

## 3 · `backend/records.mjs` — the four write verbs (M2)

The **only** writer of files under `data/`.

```js
export const ARCHIVE_REASONS = ['off-target','bad-data','duplicate','wrong-tone','already-contacted'];
export const AGENT_MAX_STAGE = 'shortlist';   // index into the gate field's options

export function nearMatches(candidate, { collection })
// → [{ id, path, title, confidence, why }]  confidence 0..100, sorted desc.
// Scores: same handle 95 · same PROFILE url 90 · exact name 85 · contained name 65 · trigram overlap.
// `source` is NOT scored. It is the permalink the agent actually saw, it is mandatory on every
// finding, and two people in one comment thread legitimately share it — scored as identity it
// discarded three of every four findings from a single page as `skip`.

export function upsertRecord(input, { actor = 'crystal', via = 'api' })
// input: { collection, id?, name, ...fields, body? }
// → { verdict: 'store'|'update'|'merge'|'skip', id, path, matched?, confidence?, changed?: [keys] }
// confidence >= 60 merges into the existing record. Nothing new to add → 'skip'.
// An agent actor lands `proposed: true` and may never write a gate stage past AGENT_MAX_STAGE.
// Appends to log.mjs. Throws RecordError (with .status) on refusal.
// An agent `store` also raises a `kind: 'finding'` DECIDE card (proposals.propose) unless an OPEN
// finding card already points at that record; its id comes back as `card`. update/merge/skip raise
// nothing. Every write verb schedules memory.scheduleCacheRegen() — in whatever process wrote.

export function batchUpsert(items, { actor, via })
// → { tally: { store, update, merge, skip }, results: [...] }   ONE near-match pass for the batch.

export function moveRecord(path, { to, actor, reason })
// → { path, from, to }. Agent + stage past AGENT_MAX_STAGE → throws RecordError(403), logged 'refused'.

export function archiveRecord(path, { reason, actor })
// reason ∈ ARCHIVE_REASONS or throws RecordError(400). Moves the file to data/_archive/<collection>/
// keeping frontmatter, appending the reason and history. NEVER deletes.

export async function patchRecord(path, patch, { actor, rev })   // the document surface's save
// → { path, rev, data, content }. 409 RecordError when `rev` is stale (conflict UX).
// ASYNC because it writes `data/` and DELEGATES everything else: me.md → memory.writeMe,
// goals/<id>.md → saveGoal, playbook/<id>.md → savePlaybook, learnings/<id>.md → saveLearning,
// territory/<id>.md → territory.saveTerritory (lazy import, so the memory ↔ records edge stays off
// the load path). The rev check happens here for every path; the delegate carries the agent
// refusal (the SAME 403 string as the memory route), the rollup stripping and its own log line.
// A patch that changes nothing is still not a write.
export const RECORD_ROOT = 'data/'; export function isRecordPath(relPath)
// `archiveRecord` and `acceptRecord` refuse a path outside RECORD_ROOT with 403, logged `refused`:
// archiving MOVES a file, and pointed at me.md it would move identity out of the workspace.

export function readRecord(path)   // → { path, data, content, rev, flags }
// flags: { quarantined, agentPromotion, staleness }  — see §4.

export class RecordError extends Error { status }
export function registerRecordRoutes(app, deps)
```

### The gate, enforced twice (Law 4, T08)
1. **On write** — `moveRecord`/`upsertRecord` with an agent actor and a stage past `shortlist`
   → `403`, logged as `refused`.
2. **On read** — `readRecord` sees a gate value past `shortlist` whose `updated_by` is an agent
   → the stage is **ignored** (reported as the last legal stage), `flags.agentPromotion = true`,
   and a `refused` event is logged once.
3. **Quarantine** — a file under `data/` whose frontmatter has no `created_by`, or that was written
   by an agent without passing through `upsertRecord` (no `provenance: pipeline`), reads back with
   `quarantined: true`, and is excluded from every count, view, rollup and territory score until
   `POST /api/records/accept`.

### Routes (mounted by index.mjs from `registerRecordRoutes`)
```
POST   /api/records/upsert     POST /api/records/batch     POST /api/records/match
POST   /api/records/move       POST /api/records/archive   POST /api/records/accept
PATCH  /api/records            GET  /api/records/history?path=
GET    /api/activity?limit=    (the event log, newest first)
```
Every route takes `actor` in the body. Missing actor → `crystal` for UI calls, and the agent
doors always send theirs.

## 4 · `backend/territory.mjs` — sole writer of `finds` / `wins` / `hit_rate` (M3)

```js
export function listTerritories()   // → [{ id, path, data, stats, staleness }]
export function getTerritory(id)
export function saveTerritory(id, patch, { actor })  // strips finds/wins/hit_rate from patch
export function territoryStats(id)  // { finds, wins, hit_rate } rolled up over records' found_in
export function registerTerritoryRoutes(app, deps)

// added while building M3 — additive, no signature above changed
export function statsIndex(docs = null)      // ONE walk → Map<id, {finds,wins,hit_rate}>; listTerritories uses it
export async function proposeTerritory(input, { actor })  // makes a kind:'territory' DECIDE card and writes NOTHING. `why` mandatory. Accepting the card is what writes the file, at access 'requested'
export function setTerritoryHooks({ logEvent, afterWrite })
export const COMPUTED_KEYS = ['finds','wins','hit_rate'];  // what saveTerritory strips
export const WIN_STATUSES  // the fallback when a record's collection declares no gate field
export function isRecord(doc); export function sweepPriority(t)  // staleness × hit_rate
```
`listTerritories({ docs, now })` and `getTerritory(id, { docs, now })` take an optional shared
document walk — 40 territories must cost one walk, not forty.
**A win is the collection gate's `done` group**, falling back to `WIN_STATUSES` when the record's
collection declares no gate. Archived records stay in `finds` (Law 5) and can never be `wins`;
quarantined records are in neither.
Routes: `GET /api/territory`, `GET /api/territory/:id`, `PATCH /api/territory/:id`,
`POST /api/territory/propose`.
`finds`/`wins`/`hit_rate` are **computed on read** and never trusted from frontmatter.

## 5 · `backend/memory.mjs` — the memory layer and the hot cache (M3)

**This file already exists** and holds FrameForge's per-project notes. Add the Scout memory layer
**below a clear divider**; do not rename the file (six modules and four tests import it).

```js
export const CACHE_TOKEN_BUDGET = 2000;     // ≈8000 chars. Enforced in code, gated by a test.
export function readMe(); export function writeMe(body, data, { actor })  // agent actor → 403
export function listGoals(); export function getGoal(id); export function saveGoal(id, patch, { actor })
export function listPlaybook(); export function getPlaybook(id)
export function savePlaybook(id, patch, { actor })   // a claim with no evidence[] → 400
export function listLearnings(); export function saveLearning(id, patch, { actor })
export function renderCache({ project = null } = {})
// → { text, tokens, version, dropped: [reasons] }
// THE ONLY producer of the agent's wake-up context. Shape is docs/03_MEMORY.md §2, verbatim
// headings: WHO I WORK FOR · GOALS · PROJECT · BEST GROUND · BLOCKED · NEVER TRIED ·
//           WHAT WORKS · LEARNED · SINCE YOUR LAST RUN · OPEN QUESTIONS FROM YOU · COUNTS
// Over budget → compress in this fixed order and record each drop in `dropped`:
//   1 territory beyond top-5 / stalest-3 / all blocked
//   2 playbook one-liners → titles only
//   3 learnings > 60d unverified
//   4 "since your last run" → counts only
//   5 goals → the behind ones only
// Playbook claims at staleness >= 1 are excluded from the cache but stay in their file.
export function cacheVersion()          // cheap { v, generated }
export function regenerateCache(opts)   // writes .scout/cache/context.md, debounced 2s on writes
export function registerScoutMemoryRoutes(app, deps)

// added while building M3 — additive, no signature above changed
export function readCache({ project })  // what GET /api/context serves: the GENERATED file, so the
                                        // text an agent reads and the `v` it polls are one artefact
export function scheduleCacheRegen({ project })   // the debounce; cancelCacheRegen() drops it
export function flushCacheRegen()          // cancel the 2s debounce and regenerate NOW; true if it ran. For a process about to exit (the MCP door)
export function isAgentActor(actor)     // the rule writeMe/saveGoal refuse on — see below
export function graduationCandidates()  // project learnings that hold in a SECOND project
export function estimateTokens(text)    // chars / 4
export function setScoutMemoryHooks({ logEvent, readEvents, lastRunAt })
export const CACHE_CHAR_BUDGET = 8000; export const CACHE_DEBOUNCE_MS = 2000;
export const scoutPaths       // me · goals · playbook · learnings · brief · cache · cacheVersion
```
`renderCache` also returns `excluded[]` (the stale playbook claims it left out) and `chars`.
**Every summarising cap names itself in `dropped`, at every level** — not only once the ladder
engages, or the DEFAULT render would be the silent one.
`v` moves ONLY on regeneration, never on a read, so an agent that sees the same integer is right
to keep what it cached. `GET /api/context?format=md` returns the file itself for
`curl .../api/context`; the default stays JSON because `frontend/api.js` reads `.json()`.

**Who is an agent** (`me.md` and `goals/` are human-owned, docs/04 §6 — something has to decide):
`assistants/<actor>.md` exists → agent · listed in me.md `agents[]` → agent · me.md declares an
owner (`owner` | `created_by` | `name`) and the actor is not them → agent · nothing declared yet →
human. The last rung is deliberately fail-OPEN: a fresh workspace has a placeholder `me.md`, and a
rule that locks the person out of writing their own identity fails GOAL.md §4.1.

`deps` for `registerScoutMemoryRoutes` / `registerTerritoryRoutes` default to `backend/log.mjs`'s
real `logEvent` / `readEvents`. index.mjs passes `{ logEvent }`; **`readEvents` is what renders
SINCE YOUR LAST RUN**, and it is defaulted rather than required so the section is never silently
empty.
Routes: `GET /api/context`, `GET /api/cache/version`, `POST /api/cache/regenerate`,
`GET/PUT /api/me`, `GET /api/goals`, `POST /api/goals` (409 on an existing id), `PATCH /api/goals/:id`,
`GET /api/playbook`, `GET /api/playbook/:id`, `PATCH /api/playbook/:id`,
`GET /api/learnings`, `POST /api/learnings/propose`.

> ~~`GET /api/context` currently 404s~~ — landed at M3. `PATCH /api/learnings/:id` exists too
> (`frontend/api.js` calls it). `POST /api/learnings/propose` slugifies the claim into the id.

## 6 · `backend/inbox.mjs` — door 2 (M2)

```js
export function processInboxFile(absPath)   // parse → upsertRecord → move to _done/ or _failed/
export function sweepInbox()                // one pass over _inbox/*.md
export function startInboxWatch()           // fs.watch + 400ms debounce; safe to call twice
export function writeKnown()                // _known.md — flat `id · name · handle · status`
export function writeIndexFile()            // _index.md — collections, counts, paths
export function registerInboxRoutes(app, deps)
```
No second write path: it calls `upsertRecord`. Failures move the file to `_inbox/_failed/`
**with the reason written into its frontmatter** so the agent can read why.

## 7 · `backend/tasks.mjs` — assistants, tasks, claiming, runs (M4)

```js
export function listAssistants(); export function getAssistant(id)
export function saveAssistant(id, patch, { actor })
export function listTasks({ project = null, status = null })
export function taskIdFrom({ id, title, label })   // the ONE place a task id is derived; nothing → refused
export function humanName(task)                    // label || (title ≠ id) || id — what the screen shows
export function saveTask(project, id, patch, { actor })
export function claimTask(project, id, { actor })    // atomic write-then-reread; → { won: bool }
export function listRuns({ assistant = null, limit = 20 }); export function appendRun(run)
export function registerTaskRoutes(app, deps)
```
Routes: `GET /api/assistants`, `PATCH /api/assistants/:id`, `GET /api/tasks`,
`POST /api/tasks`, `PATCH /api/tasks/:id`, `POST /api/tasks/:id/claim`,
`GET /api/runs`, `POST /api/runs`.

## 7b · `backend/dispatch.mjs` — the one button (M4 / T14 step 1)

*"She presses one button. The assistants go back out."* — GOAL.md §3.

The local-CLI door, and nothing else. It composes what already exists rather than reimplementing
any of it: `agentRunner.cliExecutor` owns the OS process and the provider argv, `agentHome`
owns the isolated home and the mounted router skill, `tasks.mjs` owns the run store,
`agentIndex.mjs` owns what an agent may do, and `records.mjs` remains the only writer of
documents. A spawned assistant writes over HTTP like any other agent — **spawning it ourselves
buys it no privilege**, and `tests/phase-dispatch.test.mjs` demonstrates the gate refusing one.

```js
export function buildBrief(assistant, { tasks, apiBase, project })   // pure
export function sendOut(id, { project, actor, agentCommand, deps })  // → { run, done, brief }
export function sendOutAll({ project, actor, deps })                 // → { started[], skipped[] }
export function countWork(actorId, since, until)                     // → { found, merged, … }
export function stopRun(runId); export function stopAll()
export function registerDispatchRoutes(app, deps)
```
Routes: `POST /api/assistants/:id/run`, `POST /api/assistants/run`, `GET /api/runs/:id`,
`POST /api/runs/:id/stop`.

Three properties are load-bearing:

- **It answers before the work is finished.** `sendOut` returns as soon as the run RECORD exists
  and hands back `done` for a caller that wants to wait. A sweep is minutes long; a request that
  waits it out dies to a proxy timeout and leaves an assistant marked `running` for ever.
- **What a run reports is COUNTED, never claimed.** `countWork` reads the event log, filtered to
  that actor and that run's window. An agent saying "found 40" is a claim; forty `store` events
  carrying its signature are a fact. Same rule `territory.mjs` already lives by.
- **No CLI is not a failure.** `sendOut` pre-checks `resolveBin` and throws 503 `{ setup: true }`
  **without recording a run** — a run that never started is not a run, and doors 2 and 3 need no
  local CLI at all. Every screen states this rather than looking broken.

`GET /api/index` deliberately does **not** advertise these. They are the human's door; the agent
contract (04 §5) does not give an agent the power to dispatch another agent, and the Index may
omit what exists but must never advertise what does not.

## 8 · `backend/proposals.mjs` — the DECIDE queue (M4)

Every approval in the app flows through one queue. Cards live at `proposals/<id>.md`.

```js
export const CARD_KINDS = ['finding','outbound','territory','learning','schema','question'];
export const REJECT_REASONS = ['off-target','bad-data','duplicate','wrong-tone','already-contacted'];
export function listProposals({ status = 'open' })  // → cards, oldest first, one at a time
export function propose(card, { actor })            // agents only ever propose
export function territoryOf(value)  // 'ofw-uk' | { id, label, kind, url } → { id, … } | null
export function accept(id, { actor })               // performs the card's effect, see the table
export function reject(id, { reason, actor })       // reason mandatory, one of REJECT_REASONS
export function registerProposalRoutes(app, deps)
```
| kind | accepting means |
|---|---|
| `finding` | `moveRecord(path, { to: 'shortlist' })` |
| `outbound` | the exact wording is approved for sending (`approved_at` stamped) |
| `territory` | the agent may request to join — territory `access: requested` |
| `learning` | `saveLearning(id, { status: 'active' })` — it enters memory and the cache |
| `schema` | `saveCollection` / `addField` — the collection or field is created |
| `question` | the answer is written into `learnings/` or `me.md` |
Rejecting always records the reason, logs it, and tells the agent. **Never silent.**

## 9 · `backend/agentIndex.mjs` — the Index (M4)

```js
export function renderIndex()   // API base, collections + fields, enabled tools, current project,
                                // pointer to the route reference. ONE line per capability.
export function registerIndexRoutes(app, deps)   // GET /api/index
```
**Adding a capability is a new Index line, never a router-skill edit.**

---

## 10 · Frontend contracts

### Screens and their route key
`App.jsx` holds one `screen` state key. Every screen is a component that takes props and
renders inside `<main>`. Screen keys: `today · decide · project · collection · document ·
goals · territory · playbook · memory · knows · assistants · assistant · files · board`.

### `frontend/api.js` additions (owned by the integrator — call them, do not add them)
```js
api.activity(limit) · api.history(path)
api.upsert(body) · api.match(body) · api.moveRecord(body) · api.archive(body)
api.acceptRecord(body) · api.patchRecord(path, patch, rev)
api.context() · api.cacheVersion() · api.regenerate()
api.me() · api.saveMe(body) · api.goals() · api.saveGoal(id, patch)
api.territory() · api.saveTerritory(id, patch)
api.playbook() · api.playbookOne(id) · api.savePlaybook(id, patch)
api.learnings() · api.proposals() · api.acceptProposal(id) · api.rejectProposal(id, reason)
api.assistants() · api.tasks(q) · api.saveTask(body) · api.claimTask(id) · api.runs()
api.files(dir) · api.fileRead(path) · api.reveal(path)
api.board(id) · api.saveBoard(id, body)
```

### The look
`design/*.html` are the visual truth and `design/EXTRACT.md` §3.2 the measured layout: 210px rail,
302px inspector, 38px footer. Import `sx()` and keep the design's declaration strings verbatim.
Every figure is mono with tabular numerals. Empty states are short mono uppercase.

### Altitude 1 (Law 2)
Every screen opens at a decision. Reasoning is one click. The document, the raw log and the
`.md` file are two. **A screen that opens at altitude 2 is a bug.**
