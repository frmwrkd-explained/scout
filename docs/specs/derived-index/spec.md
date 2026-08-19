# Derived index — finish `indexer.mjs`

**Status:** open
**Created:** 2026-07-27

Keep markdown as the only source of truth, and stop re-reading the entire corpus on every
request. The mechanism to do this is already in the repo and half-built.

## Why this exists

`backend/indexer.mjs:1` calls itself **"Derived index, integrity report, and revision-based
push"**, and its second line states the architecture correctly:

> *The markdown folder is the source of truth; this module adds three things on top of it.*

That is the right architecture. It is also the architecture this repo already committed to.
The problem is that the module named `indexer` **indexes nothing**.

What it actually has today:

| Piece | Where | What it does |
|---|---|---|
| Recursive `fs.watch` + 400 ms debounce | `indexer.mjs:123-133` | low-latency change signal |
| 30 s reconcile sweep | `indexer.mjs:134`, started at `index.mjs:1321` | backstop for lossy watch events |
| `fingerprint()` — `walkMd` + `statSync` every `.md` | `indexer.mjs:99-108` | mtime + size of every record |
| Revision counter, change ring buffer, SSE bus | `indexer.mjs:16-53` | push clients a "something changed" |
| `domainFor()` route → domain router | `index.mjs:115-127` | 10 domains + `misc` |

So on every watch event, and again every 30 seconds, the process already walks the whole
record tree and stats every file. It then **collapses that into one summed integer**
(`indexer.mjs:105`), compares it to the previous integer, and discards the per-file detail.
`reconcile()` bumps the single domain `['external']` (`indexer.mjs:113`) — the only
`bump(['...'])` literal in `backend/` — which tells every client "refetch everything."

And the refetch is unbounded. There is no cache anywhere in the read path.

**This spec does not add an index layer. It gives the existing one the cache it was clearly
designed to have.** The stat pass is already paid for. Retaining the map instead of summing
it costs zero extra syscalls and yields exact per-file invalidation.

Per `CLAUDE.md` — *"Do not add a second source of truth for anything"* and *"grep for the
concept before implementing it… never add a third"* — a new `cache.mjs` sitting next to
`indexer.mjs` would be precisely the mistake this repo warns about most. Everything below
lands **in `indexer.mjs`**.

## Measured state (2026-07-27)

Live `workspace/` on this machine — 420 `.md` records, 813 files, 333 MB (mostly binary media):

| | |
|---|---:|
| gray-matter parse of all 420 records | **241 ms** |
| …same corpus × 20 (~8,400 records) | **2,463 ms** |
| Cost per record, roughly linear | **~0.29 ms** |
| Read caching anywhere in `backend/` | **none** |
| `readFileSync` / `readdirSync` calls in the read path | **all synchronous** — every one blocks the event loop |

Parsing dominates, not I/O: gray-matter 4.0.3 runs js-yaml over every frontmatter block, and
`readMd` sets `cache: false` (`store.mjs:41-45`). That flag is **correct** — the comment
explains that gray-matter caches an *empty* result on the error path, so a malformed file
would silently parse as an empty record on the next read. Do not remove it. It does mean
there is currently zero read amortisation in the system.

### The four unbounded read paths

**1. `/api/state` (`index.mjs:284-324`; the per-project map at `:291-296`, the payload at `:297-323`)** — the app's primary endpoint. One request calls
`listItems()`, `listAllShots()`, `listAssets('library')`, `getActivity()`, `getHistory()`,
`scanSkillRepos()`, `getLedger()`, `getLedgerRollup()`, `listJobs()`, `listBatches()`,
`listSessions()`, plus `getStory()` per project. `getLedger()` and `getLedgerRollup()`
(`ledger.mjs:46-52`) each independently re-read and re-parse the same `costs.md`.

**2. `search.mjs` `rows()` (`search.mjs:42-115`)** — rebuilds the **entire corpus in memory on every query**:
`listProjects()`, then `getStory()` per project, `listAllShots()`, `listGenerations()` per
project, `listItems()`, and `listAssets()` for the library *and every project scope*. `search()`
calls it unconditionally at `search.mjs:138`. There is no cache and no incremental path.

**3. `listAssets()` (`library.mjs:78-95`)** — per item, `item()` (`library.mjs:61-76`) does a
`statSync`, then `readMeta()` (`library.mjs:22-37`) opens and YAML-parses the `.meta.md`
sidecar. That is a second file read and a second YAML parse **per thumbnail in a gallery**.
Only 17 sidecars exist today, so this is invisible now and will not be at 5,000 assets.

**4. `getShot()` is O(n) and makes `reorderShots()` O(n²).** `getShot(pid, id)`
(`story.mjs:40`) is `listShots(pid).find(...)` — it reads and parses **every shot file in the
project** to return one. `patchShot()` (`story.mjs:64-69`) calls `getShot()` and then
`writeShot()`, which re-reads the same file a third time. `reorderShots()` (`story.mjs:75-94`)
calls `patchShot()` once per shot. A 100-shot reorder is ~10,000 md parses to write 100 files.
This one is a plain lookup bug and needs no cache to fix.

### Two files that should not be markdown records at all

Both store a **growing array inside YAML frontmatter**, so every append is
read → parse → prepend → re-serialise → write the whole thing:

| File | Size now | Shape | Written by |
|---|---:|---|---|
| `workspace/costs.md` | 14,736 B | up to **500** entry objects + rollup | `ledger.mjs:26-44`, on **every paid call** |
| `workspace/activity.md` | 10,800 B | up to **60** event objects | `store.mjs:347-352`, on every mutation |

Every single image generation rewrites a 500-element YAML array. No human edits these, no
agent reads them as prose, and the cap exists only because the write is O(n). They are
append-only event streams wearing a markdown costume. NDJSON gives O(1) appends, no cap, and
stays greppable and portable.

A third area is misfiled rather than slow. `workspace/catalog/` holds nothing the user made:
`fal.md` is **505,243 bytes** of `JSON.stringify`'d fal endpoint list stuffed into a markdown
body (`catalog.mjs:71-72`), and `catalog/schemas/*.md` is the per-model fal spec cache written
by `modelSchemas.mjs:24` and `:175-179`. Together they are **58.5% of all `.md` bytes in the
storage root** (523,828 of 895,428). Both are caches of remote API responses living inside the
user's portable datastore, riding along in every backup, sync and copy of `workspace/`, and both
are re-parsed by `integrityReport()` on every scan.

## What this is *not*

**Not a migration off markdown.** Markdown records stay the source of truth, unchanged, in the
same layout. The portability property — copy `workspace/` to a USB stick, sync it, `git` it,
open a shot in Obsidian, feed it straight to an agent via `contextForAgent()` — is the
product, not an implementation detail. Nothing here weakens it.

**Not SQLite.** See "Deferred: stage 2" below. The seam this spec establishes is what makes
SQLite a later swap rather than a rewrite, but adding it now would be building a mechanism
before the thing it accelerates has been measured.

**Not a new dependency.** `package.json` dependencies stay exactly: `express`, `gray-matter`,
`marked`, `react`, `react-dom`, `sharp`, `three`.

**Not a rewrite of `store.mjs`'s record shape.** `readMd`/`writeMd`, atomic tmp+rename
(`store.mjs:48-62`), and the `revOf` conflict guard (`store.mjs:330-344`) are all correct and
stay as they are. `revOf` is the hard part of using files as a database and it is already
solved here.

## Invariants

These are the rules that make a derived cache safe. A ticket that breaks one is wrong even if
its own acceptance criteria pass.

1. **Markdown is the only source of truth.** The cache must be droppable at any instant —
   mid-request, mid-write, on a corrupt entry — with no behaviour change other than latency.
   If deleting the cache can lose data, the design is wrong.
2. **A cache hit must be indistinguishable from a miss.** Same function, same return shape,
   same ordering. Ticket acceptance criteria prove this by running the same assertion with the
   cache forcibly disabled.
3. **Every entry is keyed on `(absolutePath, mtimeMs, size)` — never on path alone.** This is
   exactly what `fingerprint()` already collects.
4. **Never cache a throw.** Cache successful parses only. A malformed file must keep throwing
   on every read so the quarantine paths (`listProjects` `store.mjs:200-206`, `listItems`
   `store.mjs:268-272`, `integrityReport()` `indexer.mjs:72-90`) keep working. This is the
   *precise* bug that `readMd`'s `cache: false` comment describes — do not reintroduce it one
   layer up.
5. **Secrets never enter the cache or any derived collection.** `settings.md` is deliberately
   not imported by `search.mjs` (its header states the Phase 9 rule). Keep it that way, and do
   not let a generic "cache every `.md`" sweep pull it in.
6. **The cache must reset when the storage root changes.** `helpers.freshRoot()`
   (`tests/helpers.mjs:10-16`) switches roots repeatedly *inside one process*, across 34 test
   files. Keying on absolute path mostly handles this, but derived-collection caches keyed on
   revision do not — `setStorageRoot()` must clear them. Without this, tests bleed state into
   each other and the failures look random.

## Tickets

| # | Title | Blocked by |
|---|---|---|
| [01](issues/01-bench-harness.md) | `scripts/bench-store.mjs` — synthetic corpus + committed baseline | — |
| [02](issues/02-getshot-single-file.md) | `getShot` reads one file — kills the O(n²) reorder | — |
| [03](issues/03-activity-ndjson.md) | `activity.md` → NDJSON append log | — |
| [04](issues/04-costs-ndjson.md) | `costs.md` → NDJSON detail rows + separate rollup | — |
| [05](issues/05-record-cache.md) | Per-file record cache — `fingerprint()` retains the stat map | — |
| [06](issues/06-collection-cache.md) | Derived collections memoised on domain revision | 05 |
| [07](issues/07-search-on-cache.md) | `search.mjs` `rows()` on the cache, haystacks precomputed | 06 |
| [08](issues/08-catalog-out-of-datastore.md) | `workspace/catalog/` out of the datastore into a cache dir | — |

### Suggested order

**Wave 1 — measure, then take the free wins.** 01 first; without a baseline none of the rest
is provable. Then 02, which is a self-contained lookup fix with no cache involved and the worst
asymptotic behaviour in the repo.

**Wave 2 — stop the O(n) writes.** 03 then 04. Same change shape, 04 is the subtler one because
of the rollup. Independent of everything else, so they can run in parallel with Wave 3.

**Wave 3 — the actual cache.** 05, then 06, then 07. One commit each. 05 is the load-bearing
ticket; 06 and 07 are adoption on top of it.

**Anytime.** 08 is hygiene, not performance — it touches one route (`index.mjs:913`) and no hot
path. Land it whenever.

### One inconsistency to fix along the way

The domain vocabulary already has two authors. `domainFor()` (`index.mjs:115-127`) declares ten
domains plus `misc`, but `bump('briefs')` appears **five** times in `backend/` for a domain
`domainFor` never produces (`/api/brief` maps to `projects` there), and `reconcile()` adds
`external`. So thirteen domain strings are in play, defined in three places, with no single list.
Ticket 06 has to unify this to build per-domain revisions — do not paper over it by adding a
fourth.

## Verification

Repo-wide gates for every ticket:

- `node --test tests/*.test.mjs` green, with the storage-root env from `tests/_env.mjs`
  (34 test files, 208 tests as of 2026-07-27 — the count grows, so treat green as the gate, not
  the number). The glob is the safe habit, but the earlier claim here that `node --test tests/`
  with a bare directory argument "fails to resolve on Node 22.22" is **wrong on this machine**:
  it runs fine and exits 0 on the Node actually installed, which is **v20.19.0** (verified
  2026-07-27, ticket 01). There is no pinned Node — no `engines` field, no `.nvmrc`.
- If parse failures appear on files named `._phase*.test.mjs`, that is exFAT AppleDouble junk
  being collected as tests, not a real failure. Sweep and re-run — see `CLAUDE.md`.
- `npm run dev` + `npm run server`, then re-run `scripts/bench-store.mjs` (ticket 01) and confirm
  no metric regressed.
- `rm -rf` any cache introduced here, restart, and confirm the app behaves identically. This is
  invariant 1 and it should be checked by hand at least once per wave.

## Deferred: stage 2 (SQLite) — do not build yet

At roughly 10k+ records, or when ranked full-text and faceted filtering are wanted for real,
the memoised collections stop being enough and `search.mjs`'s hand-rolled scoring
(`search.mjs:143-149`) becomes the limit. The answer then is a SQLite derived index with FTS5.

Recorded now so a future session inherits the decisions instead of relitigating them:

- **Prefer `node:sqlite` (Node core) over `better-sqlite3`.** `better-sqlite3` is a native module
  requiring a rebuild per Electron ABI, and this app ships Electron (`desktop/`,
  `electron-builder`). That is a packaging trap, not a preference.
  **Caveat, corrected 2026-07-27 (ticket 01):** the earlier claim that `node:sqlite` is "present in
  the pinned Node 22" is wrong on both counts. There is no pinned Node (no `engines`, no `.nvmrc`),
  and the Node actually installed here is **v20.19.0**, where `require('node:sqlite')` throws
  `ERR_UNKNOWN_BUILTIN_MODULE` — it landed in Node 22.5. So stage 2 carries a prerequisite this
  repo does not currently meet: either raise and pin the Node floor first, or re-open the
  `better-sqlite3`-vs-core decision. Do not start stage 2 assuming core sqlite is available.
- **The db file is derived, gitignored, never shipped, and `rm`-able.** Same invariants as
  above. It must never be the source of truth, and it must never need syncing — markdown
  text-merges across devices, a SQLite file does not.
- **Binary media stays on disk as files.** 333 MB today and it will be tens of GB. SQLite can
  hold blobs; doing so would destroy the portability story and turn every backup into a
  full-file rewrite.
- **Do not put the db on the storage root if that root is on exFAT.** This repo lives on
  `/Volumes/SSD` (exFAT — the source of the `._*` AppleDouble noise): no journaling, and
  directory listing is a linear scan.
- **The seam is ticket 06.** If derived collections are already funnelled through one
  memoisation point keyed on domain revision, stage 2 replaces that point's implementation and
  nothing above it changes. If they are not, stage 2 is a rewrite. That is the main reason 06
  is worth doing carefully.

The trigger to open this family should be a measurement, not a feeling: p95 on `/api/search`
over ~100 ms, or cold `/api/state` over ~500 ms, on `scripts/bench-store.mjs`'s largest corpus.
