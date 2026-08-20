# HANDOVER — Scout, as of 2026-08-19

**M0–M5 are built. `npm test` is green (586 tests, 584 pass, 2 skipped, 0 fail) and
`npm run demonstrate` walks GOAL.md's ten gates against a real running app and prints the
evidence for each one — currently 10 of 10.**

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
npm test                     # 586 tests
npm run demonstrate          # the ten gates, against a throwaway copy of workspace/
npm run server               # express on 5177
npm run dev                  # vite on 5178, proxies /api → 127.0.0.1:5177
```

`npm start` builds and serves the whole app (UI + API) from one process — that is the fastest way
to look at it. `npm run demonstrate --keep` leaves the copied workspace on disk to poke at.

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
| `decay.mjs` | one `staleness()` for every object type. **Never inline a second rule** |
| `territory.mjs` | the sole writer of `finds` / `wins` / `hit_rate` — all computed, never typed |
| `memory.mjs` | identity, goals, playbook, learnings, and **`renderCache()`**, the only producer of the agent's wake-up context |
| `tasks.mjs` | assistants, tasks, atomic claiming, runs, findings |
| `proposals.mjs` | the one DECIDE queue — six card kinds, one accept path each |
| `agentIndex.mjs` | `renderIndex()` — one line per capability, and it drops any route not actually registered |
| `files.mjs` | the read-only file browser, with real path-traversal refusal |
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

1. **Gate 1's last clause is the honest limit.** GOAL.md says the interview should end "…and
   produces a first real finding". Scout does not run agents — that is the design
   (`docs/04_AGENT_CONTRACT.md` §1) — so the app cannot conjure one, and a seeded fake finding would
   make the first thing she ever judged a lie. What the interview does instead: proposes her first
   collection as a card, records the ground she named, hires one assistant in her own language, and
   queues a task per territory. **The finding arrives on the first agent run through any of the
   three doors.** Closing the remaining half means wiring an agent runtime, not more UI.
2. **Nothing runs the agents.** Scout does not own the agent process — that is the design
   (`docs/04_AGENT_CONTRACT.md` §1) — but it means `runs/` is empty on a fresh workspace and
   "what it cost" has no source yet. The three doors (HTTP, `_inbox/`, MCP tool surface) are built;
   the local-CLI spawner from FrameForge is present but not wired to Scout's assistants.
3. **`documentsFor()` still counts quarantined rows**; the route filters them, and `sweepQuarantine()`
   runs at boot so the flag is on disk and `territory.mjs` scores agree. If you add a third consumer,
   call `isQuarantined` from `records.mjs` — do not write a second predicate.
4. **The gallery view resolves media only for values that are already URLs.** `mediaSrc()` in
   `GalleryView.jsx` is the single function to change when a file-serving route lands.
5. **Light mode deviates from `docs/05_UI_SPEC.md` §4 in three tokens** — `--fg-muted`, `--fg-faint`
   and `--warn`, because §4's printed values fail §4's own 4.5:1 rule (`--fg-faint` measured 2.78:1).
   Hue and saturation kept, lightness only. `tests/phase-theme-contrast.test.mjs` asserts every pair
   in both themes.
6. **`GET /api/context` answers MARKDOWN by default** and JSON on `?format=json` or an
   `Accept: application/json` header, because `docs/04_AGENT_CONTRACT.md` §2 writes the route and
   `read .scout/cache/context.md` as the same act. The UI asks for the envelope explicitly.

---

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

**Demonstrate, don't describe.** A task is done when its Demonstrate section can be performed.

---

## 7 · If you are picking this up cold

Run `npm run demonstrate` first. It boots the real app against a copy of the workspace, walks the
ten gates in the order a person meets them, and prints what it saw. In four minutes you will know
more about this codebase than this document can tell you — and if something is broken, it will name
the gate rather than the stack frame.

Then open the app (`npm start`), press `D`, and work the queue with the keyboard. That is the
product.
