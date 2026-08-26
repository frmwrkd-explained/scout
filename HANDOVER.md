# HANDOVER — Scout, as of 2026-08-26

**M0–M5 are built. `npm test` is green (625 tests, 623 pass, 2 skipped, 0 fail) and
`npm run demonstrate` walks GOAL.md's ten gates against a real running app and prints the
evidence for each one — currently 10 of 10, including gate 1's last clause: a first real
finding arrives before the session ends.**

This file tells you where things stand, what was decided, and what will bite you. It does not
replace the spec — it tells you how the spec has actually been applied.

---

## 0 · Read in this order, before writing anything

1. **`GOAL.md`** — the acceptance contract and the ten gates. It wins every conflict.
2. **`CLAUDE.md`** — source-of-truth table, hard rules, ports.
3. **`docs/01_CANON.md`** — the ten laws and the failure each prevents.
4. **`docs/08_MODULE_CONTRACTS.md`** — every module signature and every route, written *before*
   the code so twelve pieces could be built at once without inventing two of anything.
5. **`docs/decisions.md`** — every ambiguity resolved, with the reason. **Do not re-litigate these.**
6. `docs/FRAMEFORGE_CLAUDE.md` — the parent repo's agent doc. It documents traps that have already
   cost days. Where it and `CLAUDE.md` disagree, `CLAUDE.md` wins, but read it.
7. `design/EXTRACT.md` — what the design files actually specify: the token block, the
   component→filename map, the measured layout contract.

Then `docs/02_DATA_MODEL.md`, `03_MEMORY.md`, `04_AGENT_CONTRACT.md`, `05_UI_SPEC.md` as needed.

---

## 1 · Running it

```bash
npm ci
find . -name "._*" -not -path "./node_modules/*" -delete   # ALWAYS, see §3
npm test                     # 625 tests
npm run demonstrate          # the ten gates, against a throwaway copy of workspace/
npm run server               # express on 5177
npm run dev                  # vite on 5178, proxies /api → 127.0.0.1:5177
```

`npm start` builds and serves the whole app (UI + API) from one process — that is the fastest way
to look at it. `npm run demonstrate --keep` leaves the copied workspace on disk to poke at.

**To watch an assistant actually go out without spending anything**, point `agentCommand` at the
test stub and press the button:

```yaml
# <storage root>/settings.md
agentCommand: <repo>/tests/fixtures/stub-sortie.mjs
```

It reads its brief, finds the API base and its own actor id in it, and writes a finding through
door 1 — the same gated, deduped, logged pipeline `_inbox/` and MCP go through.

---

## 2 · What is where

### The backend, in the order a request meets it

| Module | Owns |
|---|---|
| `store.mjs` | `readMd` / `writeMd` / `paths` / path safety / **`day` `dayMs` `byDate`** (see §4) |
| `collections.mjs` | the ONLY definition of a field type; schema validation |
| `documents.mjs` | resolving a collection's query to a document set; rollups and formulas |
| `views.mjs` | saved views, and inferring the default type from the collection's shape |
| **`records.mjs`** | **the only writer of files under `data/`** — the four verbs, near-match, the gate, quarantine, archive |
| `log.mjs` | the append-only event log, one file per day. Every mutation lands here |
| `inbox.mjs` | door 2 — the `_inbox/` watcher, `_known.md`, `_index.md` |
| **`dispatch.mjs`** | **the one button** — sends an assistant out through the connected CLI, records the run. Composes `agentRunner`/`agentHome`/`tasks`; spawns nothing itself |
| `decay.mjs` | one `staleness()` for every object type. **Never inline a second rule** |
| `territory.mjs` | the sole writer of `finds` / `wins` / `hit_rate` — all computed, never typed |
| `memory.mjs` | identity, goals, playbook, learnings, and **`renderCache()`**, the only producer of the agent's wake-up context |
| `tasks.mjs` | assistants, tasks, atomic claiming, runs, findings |
| `proposals.mjs` | the one DECIDE queue — six card kinds, one accept path each |
| `agentIndex.mjs` | `renderIndex()` — one line per capability, and it drops any route not actually registered |
| `files.mjs` | the read-only file browser, with real path-traversal refusal — and `rawFile`, the bytes an `<img>` needs |
| `scoutBoard.mjs` | the whiteboard's store; **edges are derived from real relations, never stored** |
| `intake.mjs` | the first-run interview — seven questions, and the workspace they build |
| `mcp.mjs` | door 3, the MCP tool surface — **generated from `agentIndex.mjs`**, so a new capability becomes a tool with no edit here |
| `search.mjs` | free text + typed filters over records AND memory (`scoutRows`) |
| `index.mjs` | **wiring only.** Every module mounts through `registerXRoutes(app, deps)` |

### The frontend

`App.jsx` is a screen router and the shared data loader — nothing else. Every screen owns its own
behaviour, and `App.jsx` never renders a screen's internals.

`Rail.jsx` is the app's **only** navigation, and every row in it is live. `ui.jsx` is the primitive
registry; `cells.jsx` is the typed-field registry (a read `Cell` table and an `Editor` table, 16
types each); `Freshness.jsx` is the one decay renderer; `PropertyRows.jsx` is rendered by **both**
the document surface and the inspector, so there is one typed-row implementation.

Screens: `Interview · Today · Decide (+DecideCards) · Project · CollectionView
(table/board/list/gallery) · Document (+Conflict, +AddField) · Goals · Territory · Memory ·
WhatTheyKnow · Assistants · Hire · Files · Whiteboard · Activity`.

### Three doors, one pipeline — and it is tested as one thing
HTTP, `_inbox/` and MCP all call the same `upsertRecord`. `tests/phase-mcp.test.mjs` runs one
finding through all three into three fresh roots and asserts the resulting `.md` is **byte-identical**,
and asserts the MCP gate refusal is **string-equal** to the HTTP one. Add a fourth door and add it
to that test, or the rule quietly becomes three-quarters true.

Run door 3 with `node scripts/scout-mcp.mjs` (stdout is JSON-RPC frames only; every diagnostic goes
to stderr — one stray `console.log` on stdout corrupts the stream).

### One prop name, one meaning
`onOpen(row)` opens a record; **`onFollow(collection, id)` follows a relation chip.** They were one
prop called `onOpen` carrying two different signatures, and the row handler won — which made every
relation chip in the app look clickable and do nothing. If you add a surface that renders `Cell`,
give it `onFollow`.

---

## 3 · Traps that will cost you hours

### The `._*` sidecars will fail your test run
This volume is **exFAT**, so macOS writes a `._X` AppleDouble beside almost every file. They are
not cosmetic:
- `npm test` runs bare `node --test`, whose discovery picks up `._phase-*.test.mjs` and fails them.
- **They also reach production data.** `GET /api/assistants` once returned `._librarian` as a real
  assistant with a body of raw AppleDouble bytes. Every `readdirSync` in a module that lists data
  must skip names beginning with `.`.

```bash
find . -name "._*" -not -path "./node_modules/*" -delete
```

### `config.md` outranks `SCOUT_DATA`, and it is invisible
`getStorageRoot()` reads the `config.md` **pointer** first. It is the one file that lives outside
the storage root, it is written whenever the app runs, and a stray copy in the checkout silently
redirects the entire app — including tests that set only `SCOUT_DATA`. That turned five tests red
for an afternoon. It is now gitignored, and every test claims **both** env vars.

### A frontmatter date is two different types
gray-matter parses a **bare** YAML date (`created: 2026-08-17`) into a JavaScript `Date` and a
**quoted** one into a string. Two live bugs came from this, both of which read correctly in review:
`String(created).localeCompare(...)` sorted the DECIDE queue **by weekday name**, and the hot cache
printed `rejected Thu Jul 30 2026 02:00:00 GMT+0200 (Central European Summer Time)` into the file
an agent reads on wake. **Use `day()` to render one and `byDate()` to sort. Never `String()` a
frontmatter date.** `tests/phase-frontmatter-dates.test.mjs` fails the suite if you do.

### `documentsFor()` returns `documents`; the route returns `rows`
The raw matched set is `documents`; the view-applied set is `rows`. Two names for two genuinely
different things. Assuming the wrong one shipped an empty `_known.md`.

### Do not "fix" `npm test`
`"test": "node --test"` with no path argument is deliberate. Node ≥22 resolves a directory argument
as a module path and dies with `MODULE_NOT_FOUND` before running anything.

### A zero-hit search is a claim, not a fact
`grep --include=*.mjs` unquoted in zsh fails with a glob error that reads like "no matches". A raw
control byte makes a file **binary** to grep, which then returns nothing, silently, exit 1 — that
cost hours here twice. Run a positive control before believing any negative result.

### Static imports of deleted modules fail at boot, not at use
If you delete a module, grep for its importers **first**. A missing static import takes the whole
server down rather than degrading one feature.

### `vite build` does not compile a component nothing imports
Several components "passed a build" while being entirely unreferenced. To check one file for real:
```bash
./node_modules/.bin/esbuild frontend/X.jsx --bundle --format=esm --platform=browser --jsx=automatic --outfile=/dev/null
```

### The references are real repos and they are worth cloning
`docs/06_REUSE.md` names four sources with URLs and licences. **`geckse/tesseract-md-app` (MIT)** is
the one that answers most UI questions — it names individual component files for the property
editor, the typed cells, the table toolbar and the saved-view modal. Clone it and read it before
rebuilding any of those. Obsidian is the other reference and it is installed:

```bash
npx @electron/asar extract-file /Applications/Obsidian.app/Contents/Resources/obsidian.asar app.css
```

`app.css` carries the real properties metrics (`--metadata-gap: 3px`, `--metadata-label-width: 9em`).
Guessing at them from a screenshot is how the property rows ended up at 40px.

### Capability with no affordance is worse than a missing capability
The pattern behind almost every complaint so far. `views.mjs` has shipped view types, nine filter
operators, grouping and `density` since M1 and none of it had a control; `api.archiveRecord` sat in
`api.js` uncalled since M2; `density` had never had a reader at all. From outside, "the app cannot
do this" and "the app can do this and never says so" look identical — except the second is worse,
because the person stops asking. **When you add a route, add the affordance in the same commit, or
write down where it is going to live.**

### A surface that echoes its own state will rewrite every file you open
A live-preview editor adopts the text it is handed. That adoption looked like a keystroke, the save
path sent it back, and the server took it: `updated`, `updated_by` and `verified_at` rewritten on
every record merely OPENED, with an `update` event carrying `changed: []`. `updated_by` is what Law
4 reads to ignore an agent-authored promotion and what decay reads to judge staleness, so a day of
that tells the agent everything was re-verified by a person who only scrolled past it.

Two defences, both wanted: the editor marks an adopted value so it is not reported as an edit, and
**`patchRecord` refuses a patch that changes nothing** (`tests/phase-review-regressions.test.mjs`
D4). If you add a third door onto a record, assume it will echo, and let the server be the one that
does not care.

### A formatter that speaks one of the two shapes its own file produces
`normRun()` in `Today.jsx` converts every timestamp to epoch milliseconds the moment it arrives.
`clock()`, ten lines away in the same file, did `Date.parse(String(ts))` — `NaN` for a number. The
OVERNIGHT panel header rendered the literal string `null → NOW / 4 RUNS`, and the overnight sentence
silently dropped its window. Both were correct alone, wrong together, and had been since M5 —
invisible for exactly as long as `runs` was always empty, which was until `dispatch.mjs` landed.

Wiring a producer is when every consumer that has never seen real data gets tested for the first
time. Expect a defect per consumer, and look at the screen rather than the suite.

### Frontend logic had no door until now
This repo has ~20 `.jsx` files exporting pure functions — `Today.overnightLines`,
`Assistants.costToday`, `GalleryView.mediaSrc` — and `node --test` could not import any of them. So
none of it was tested, and the defects that reached people lived exactly there. `helpers.loadJsx()`
compiles ONE module (React stays external) into `node_modules/.cache/` and imports it;
`tests/phase-today.test.mjs` is the first user. Use it for pure exported logic, not for rendering —
a component that needs a DOM to be tested is telling you its logic wants to be a function.

Two traps it already cost: `new URL(import.meta.url).pathname` percent-encodes the spaces in this
repo's path and esbuild reports it as "could not resolve" (use `fileURLToPath`); and the output must
live INSIDE the repo or the compiled module cannot resolve `react`.

### A green suite proves nothing about the doors only a human uses
Both harnesses drive the app the way an AGENT does — `npm test` calls modules and routes,
`npm run demonstrate` calls routes. Neither clicks anything. On 2026-08-20 the first person to use
the app found four broken capabilities with all 590 tests green and 10 of 10 gates demonstrated:
`+ Add property` had **never** worked (the route was handed `{...field, actor}` and the schema
validator rejects unknown keys), nothing in the app called `api.archiveRecord` though it had sat in
`api.js` since M2, opening a record was double-click-only with no affordance anywhere, and `boot()`
switched you to `collections[0]` after a schema change so a guest rendered through the group schema.
See `docs/decisions.md` "What the first person to actually use the app found".

The pattern in all four: **the agent's path was exercised and the human's was not.** When a
capability has two doors, test the route with the body the UI actually sends — not the function the
route calls.

### A fixture that is easier than production tests the easy case
Three serious defects survived 580 passing tests, all because `tests/phase-records.test.mjs`
declared its collection as `query: { path: … }` with **no tag**, while the shipped `guest`
collection declares both. `upsertRecord` never stamped the tag, so a record it had just written did
not match the collection that defines it — invisible, undedupable, and **ungated**: an agent PATCHed
`status: won` to HTTP 200. See `docs/decisions.md` "What an adversarial review found". The fixture
now carries both halves, and `tests/phase-review-regressions.test.mjs` guards all three (each guard
was reverted and observed going red).

### `/api/search` used to lie to agents
`search.mjs` was inherited from FrameForge, where it indexed projects, triage items and library
assets — and **not Scout's records**. Meanwhile `GET /api/index` advertised it to every agent as
*"find records. Never list data/ in bulk."* An agent that followed the Index searched for a guest,
got nothing, and had exactly one way left to find her: bulk-read `data/`. That is Law 7 broken by an
over-promise, and an over-promise is worse than a gap — a gap is obvious, a lie costs a whole run.
`scoutRows()` now indexes every document and memory object, with typed filters
(`collection:guest status:shortlist`, `type:territory`, `tag:manila`). **Whenever you add an Index
line, call the route and look at what comes back.**

### Ports
API **5177**, vite **5178**. The backend does **not** read `SCOUT_API_PORT` — only vite does, to
pick its proxy target. Pass the port as argv. The proxy target stays `127.0.0.1`, never `localhost`.

---

## 4 · Rules that are enforced, and were nearly broken

- **`writeMd` uses the `{content}` form of `matter.stringify`.** The bare-string form re-parses the
  body, so a note beginning with a `---` rule loses its first block into frontmatter, silently.
- **`readMd` passes `cache: false`.** gray-matter caches by content and stores an EMPTY result on
  the error path.
- **Every write is tmp + rename.** Readers swallow parse errors by design, so a half-written file
  does not error — it *vanishes*.
- **Only `records.mjs` writes document files.** Dedupe, provenance and the gate all live there.
- **The gate is enforced twice** — on write (403) and again on read (an agent-authored stage past
  `shortlist` is ignored, flagged, and logged). You cannot prevent an agent with folder access from
  writing; you can make the write have no effect and be visible.
- **Quarantine is honoured in ONE place** — the `/api/collections/:id/documents` route, where every
  view is assembled. Putting it inside each view type would be four chances to forget it.
- **Archive requires a reason**, and `move → archived` requires one too, or Law 5 has a side entrance.
- **The hot cache has a hard token cap** (2000). Over budget, it compresses in the fixed order and
  **names what it dropped**. A silent truncation is a defect.
- **Never a raw hex in component code.** `styles.css` `:root` + `tokens.js` are the only homes.
- **A guard that has not been observed failing is not a guard.** Every guard added in this pass was
  broken deliberately, watched go red, and put back.

---

## 5 · Known gaps, stated plainly

1. **The scheduler only understands four schedules, and it is off by default.**
   `continuous · daily · weekly · manual` (`tasks.normalizeSchedule`) — anything else is `manual`,
   because guessing at a schedule spawns a CLI and spends her money. The seeded workspace ships four
   assistants saying "every 6 hours" and "Sundays at 7am", and every one of them reads
   `· YOU SEND IT` on the card. `autoRun` is off until she turns it on in Settings, for the same
   reason. If you widen the vocabulary, widen `SCHEDULE_OPTIONS` with it — HIRE offers exactly those
   four, and a value the app cannot offer is a value nobody typed on purpose.
   It also only runs while Scout is running: `daily` in practice means "the first time she opens it
   after 6am", which is as close to overnight as an app that is not a daemon can get.
2. **A run is one shot, not a session.** `sendOut` hands the assistant one brief and reads one
   reply. It cannot answer a mid-run question, so an assistant that gets stuck marks its task
   `blocked` (which does reach DECIDE) and comes home. Multi-turn runs would go through
   `chat.mjs`'s session machinery, which already exists and is not wired to assistants.
3. **The provider table has two entries, and T14 step 5 names four.**
   `agentProviders.mjs` carries `claude` and `codex` plus a generic `-p <prompt>` fallback; T14 also
   names Devin CLI and goose. They are absent on purpose: an entry is an argv shape, and an argv
   shape nobody has run is a capability advertised and not delivered — the failure this repo has
   already paid for twice (see §3, and `CORE_API_ROUTES advertised 17 dead routes`). Adding one is
   a table entry plus a run you watched finish.
   And **`codex`'s sandbox is not tested against door 1**: `promptArgs` runs
   `codex exec --sandbox read-only`, and a read-only sandbox may refuse the localhost HTTP the brief
   tells the assistant to use. `claude` is the path with a demonstration behind it. Before promising
   somebody a second provider, send one out and read the run record.
4. **`documentsFor()` still counts quarantined rows**; the route filters them, and
   `sweepQuarantine()` runs at boot so the flag is on disk and `territory.mjs` scores agree. If you
   add a third consumer, call `isQuarantined` from `records.mjs` — do not write a second predicate.
5. **Light mode deviates from `docs/05_UI_SPEC.md` §4 in three tokens** — `--fg-muted`, `--fg-faint`
   and `--warn`, because §4's printed values fail §4's own 4.5:1 rule (`--fg-faint` measured 2.78:1).
   Hue and saturation kept, lightness only. `tests/phase-theme-contrast.test.mjs` asserts every pair
   in both themes.
6. **`GET /api/context` answers MARKDOWN by default** and JSON on `?format=json` or an
   `Accept: application/json` header, because `docs/04_AGENT_CONTRACT.md` §2 writes the route and
   `read .scout/cache/context.md` as the same act. The UI asks for the envelope explicitly.

### Closed since the last handover

- **Gate 1's last clause.** "…and produces a first real finding before the session ends" is now
  demonstrated end to end: she approves her collection on one card, presses one button, and a
  record lands in her table through the pipeline. `npm run demonstrate` shows `0 → 1 in #carer`.
  The stand-in CLI is `tests/fixtures/stub-sortie.mjs` and the demonstration names it — what is
  proven is the WIRING; the judgement is whatever CLI she connects.
- **"Nothing runs the agents."** `dispatch.mjs` is the local-CLI door. It is optional by
  construction: with no CLI connected the route answers 503 `{ setup: true }`, records no run, and
  every screen says where to fix it.
- **Gallery media.** `GET /api/files/raw` serves the bytes, and `GalleryView.mediaSrc()` — the one
  function the old comment said would change when the route landed — now routes every `file` value
  through it. The file browser previews images, video, audio and PDFs for the same reason.
- **`schedule:` means something.** It had been written, offered on HIRE and printed on the card
  since M4 with nothing acting on it. See gap 1 for what it now does and does not promise.

## 6 · What "demonstrated" looks like

```
$ npm run demonstrate

GATE 4  The gate holds
   ✓ an agent promoting past shortlist is refused   HTTP 403 · an agent may not promote past "shortlist"
   ✓ the human may make the same move               HTTP 200
   ✓ a file written straight into data/ is quarantined   held apart: ["ana-villaflor","rogue"]
   ✓ and excluded from the view and the count
   ✓ while never being deleted
   ✓ the refusal is visible in Activity             scout-fb → {"from":"needs-review","to":"won","max":"shortlist"}
   ✓ so is the quarantine
```

`workspace/data/guests/ana-villaflor.md` is **deliberately** left without `provenance: pipeline` so
the quarantine state is visible in the UI and provable in the demonstration. It is not a mistake.

Gate 1 ends with the clause this project could not demonstrate until the runner was wired:

```
GATE 1  A fresh person is productive in 15 minutes
   ✓ she approves her collection on one card and the table exists   #carer
   ✓ she presses one button and the assistant goes out              run scout-2026-…
   ✓ and a first real finding is in her table before the session ends   0 → 1 in #carer · done
   ✓ what the run reports is COUNTED from the log, never taken from the agent's word
                                                       it claimed 40; the log says 1
```

The stand-in CLI is `tests/fixtures/stub-sortie.mjs`, and the demonstration NAMES it. What is being
proven is the wiring — that a process Scout spawned reads its brief, finds the API, signs as itself
and lands a gated record. The judgement is whatever CLI she connects.

**Demonstrate, don't describe.** A task is done when its Demonstrate section can be performed.

---

## 7 · If you are picking this up cold

Run `npm run demonstrate` first. It boots the real app against a copy of the workspace, walks the
ten gates in the order a person meets them, and prints what it saw. In four minutes you will know
more about this codebase than this document can tell you — and if something is broken, it will name
the gate rather than the stack frame.

Then open the app (`npm start`), press `D`, and work the queue with the keyboard. That is the
product. Then press **Send them out** and watch what comes back — point `agentCommand` at the stub
first (§1) if you would rather not spend anything to see it.
