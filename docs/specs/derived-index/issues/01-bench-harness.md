# 01 — `scripts/bench-store.mjs` — synthetic corpus + committed baseline

**Status:** resolved
**Blocked by:** None — can start immediately, and everything else in this family should be measured against it.

## Problem

There is no way to prove any of this family worked. `package.json` "scripts" is `dev`, `build`,
`server`, `start`, `app`, `dist:mac`, `dist:win`, `dist:linux` — nothing measures anything.

The live `workspace/` is 420 records, which is small enough that every read path looks fine.
The spec's measurements were taken by hand with an ad-hoc script; that is not repeatable and it
does not exist in the repo. Optimising without a committed baseline means the next session
cannot tell an improvement from a regression, and "max speed" becomes a matter of opinion.

The corpus also has to be **synthetic**. Benching against `workspace/` is not reproducible
(it is gitignored, it is different on every machine, and it holds live API keys), and 420
records does not exercise the behaviour that matters.

## What to change

1. New file `scripts/bench-store.mjs`. Zero deps, plain ESM, `node:fs`/`node:path`/`node:perf_hooks`
   only — same shape as the existing one-offs in `scripts/`. `scripts/` is excluded from the
   electron-builder `files` list, so this ships nothing to users.

2. **Generate a synthetic root, never touch `workspace/`.** `fs.mkdtempSync` under `os.tmpdir()`,
   set `FRFG_DATA` and `FRFG_CONFIG` to point at it **before** importing anything from
   `backend/` — `store.mjs:18-19` captures `CONFIG_MD`/`DEFAULT_ROOT` at module load, so a later
   assignment is silently ignored. `tests/_env.mjs` documents this exact ordering trap; follow it.
   Remove the temp root on exit.

3. Seed at three sizes so the growth curve is visible, not just one point:

   | tier | projects | shots/project | generations/project | items/project | library assets |
   |---|---:|---:|---:|---:|---:|
   | `small` | 3 | 20 | 40 | 20 | 50 |
   | `medium` | 10 | 60 | 200 | 60 | 500 |
   | `large` | 25 | 120 | 600 | 150 | 2000 |

   `large` is ~25k records. Reuse the seeding shapes from `tests/helpers.mjs`
   (`seedProject`/`seedShot`/`seedGen`/`seedItem`) rather than inventing new frontmatter — copy
   the shapes, do not import the test helper, since it pulls in `backend/index.mjs`. Every asset
   gets a `.meta.md` sidecar, because the sidecar read is half the cost of `listAssets`
   (`library.mjs:74`).

4. Measure, each as a **cold** run (fresh process state) and a **warm** run (same call again),
   median of 5, reporting both:

   - `listProjects()`, `listItems()`, `listAllShots()`, `listAssets('library')`
   - `getShot(pid, id)` — single lookup
   - `reorderShots(pid, order)` — full reverse of one project's shots
   - `search('drone')` — free text
   - `search('p:<pid> rating:>=4')` — filtered
   - the `/api/state` payload assembly (call the same functions the handler at `index.mjs:284-324`
     calls — that is the per-project map at `:291-296` **and** the payload at `:297-323`; the
     original pointer here said `:297-323` alone, which silently drops the per-project
     `listAssets`/`listGenerations`/`getStory` fan-out that is most of the cost. Do **not** boot the
     HTTP server — `FRFG_NO_LISTEN` exists but an in-process express round trip adds noise)
   - `appendActivity()` × 100 and `ledger()` × 100 — these are write paths and the whole point
     of tickets 03/04

   Cold vs warm is what makes tickets 05-07 legible: today they are identical, and afterwards
   warm should collapse while cold stays flat.

5. Output a table to stdout plus `--json` for machine use. `--tier=small|medium|large` selects
   one; default runs all three.

6. Baseline: `node scripts/bench-store.mjs --write-baseline` emits
   `scripts/bench-baseline.json` (`{ node, tier, metric → medianMs }`), committed. A plain run
   compares against it:
   - every metric within **+15%** of baseline → print the table with deltas, **exit 0**
   - any metric worse than +15% → print the offenders, **exit 1**
   - `--write-baseline` overwrites unconditionally; unlike the design lint ratchet this one has
     to be allowed to move in both directions, because tickets 03/04 change what is being
     measured. State that in a comment so nobody "fixes" it into a one-way ratchet.

7. `package.json`: add `"bench": "node scripts/bench-store.mjs"`. Do not wire it into `build`,
   `start`, or the test run.

## Acceptance criteria

- [x] `npm run bench` completes on a clean checkout and prints a three-tier table with cold and
      warm columns.
- [x] `scripts/bench-baseline.json` is committed and a plain `npm run bench` on that same commit
      exits 0.
- [x] `workspace/` is untouched — verify by capturing `find workspace -newer` before/after, or by
      running with `workspace/` chmod'd read-only. The bench must not read, write, or stat it.
- [x] The temp root is removed on exit, including on `SIGINT` and on a thrown error.
- [x] `--tier=large` reports a `reorderShots` figure — **655 ms**, the slowest *single-project*
      operation in the suite by a wide margin (`getShot` 14 ms; `listAllShots` 134 ms for the whole
      25-project corpus). That is ticket 02's target and it is visible here.
      **Correction:** this criterion originally read "the slowest metric in the suite by a wide
      margin". Measured, it is **fifth** — `searchFiltered` 1089 ms, `searchText` 1077 ms,
      `apiState` 1025 ms and `ledger100` 665 ms are all higher, because those scan the entire
      corpus while `reorderShots` touches one project. The O(n²) signature is real and is the point;
      the "slowest overall" framing was not, and ticket 02 must not be judged against it.
- [x] Artificially slow one read path (add a `for` spin to `library.mjs item()`) → `npm run bench`
      exits 1 and names `listAssets`. Revert → exits 0.
- [x] `node --test tests/*.test.mjs` still passes — this script is not imported by the app and
      must not change runtime behaviour.
- [x] Running the bench twice in a row produces medians within 15% of each other on an idle
      machine. If it does not, the sample count is too low — raise it before committing a baseline.
      Needed both levers: `SAMPLES` 5 → 9, **and** round-robin sample ordering (see Comments).

## Notes

- Cold/warm is the single most important column pair in this family. Without it, ticket 05 looks
  like it did nothing (cold is unchanged by design) and ticket 02 looks like a rounding error at
  `small`.
- Resist adding a CI gate. There is no CI here, and a wall-clock benchmark that fails on a busy
  laptop gets ignored within a week. This is a tool you run deliberately before and after a
  ticket, and the committed baseline is the record of where `main` stood.
- The 15% band is a guess and deliberately loose. Tighten it once there is a feel for the noise
  on the machine this actually runs on.
- Do **not** import `tests/helpers.mjs`. It imports `backend/index.mjs`, which builds the whole
  express app and pulls in every route module — that would make the benchmark measure module
  load as much as the store.

## Comments

**Resolved 2026-07-27.** `scripts/bench-store.mjs` + `scripts/bench-baseline.json` +
`"bench": "node scripts/bench-store.mjs"`. Nothing in `backend/` or `frontend/` changed, so the
app's runtime behaviour is untouched: `node --test tests/*.test.mjs` is **208/208 green across 34
test files**, identical before and after.

### How cold/warm is implemented

"Cold (fresh process state)" is taken literally, because after ticket 05 a process-lifetime cache
makes it the only honest reading. The parent seeds the three tier roots once, then **self-spawns**
`--child --root=… --metric=…`; each child imports `backend/` fresh, runs the metric once (cold)
then again (warm), and prints one JSON line. Medians are over 9 such children per metric per tier.

Storage-root isolation follows the `tests/_env.mjs` ordering trap — `FRFG_CONFIG`/`FRFG_DATA` are
set before the backend is loaded, which in a single file means `await import()` rather than a static
import (static imports hoist above all top-level code). `tests/helpers.mjs` is deliberately **not**
imported, per the ticket; its seeding shapes are copied instead.

### Baseline — node v20.19.0, 9 samples, median ms

| metric | small cold/warm | medium cold/warm | large cold/warm |
|---|---:|---:|---:|
| listProjects      | 2.85 / 1.05 | 4.32 / 1.49 | 6.72 / 3.34 |
| listItems         | 8.27 / 4.10 | 32.9 / 24.2 | 159 / 136 |
| listAllShots      | 9.29 / 4.94 | 35.5 / 24.7 | 134 / 109 |
| listAssets        | 7.65 / 3.89 | 31.2 / 21.9 | 100 / 74.4 |
| getShot           | 5.03 / 1.98 | 9.75 / 3.95 | 14.2 / 6.30 |
| reorderShots      | 56.6 / 29.1 | 205 / 172 | 655 / 616 |
| searchText        | 27.7 / 14.7 | 176 / 153 | 1077 / 1039 |
| searchFiltered    | 27.2 / 14.6 | 178 / 152 | 1089 / 1049 |
| apiState          | 45.0 / 27.8 | 181 / 152 | 1025 / 968 |
| appendActivity100 | 89.4 / 74.1 | 89.7 / 70.4 | 90.1 / 71.0 |
| ledger100         | 663 / 610 | 664 / 613 | 665 / 611 |

A full three-tier run is ~3 min; `--tier=small` is ~25 s.

### Four things the measurements contradict

1. **`reorderShots` is not the slowest metric at `large`** — it is fifth (655 ms), behind
   `searchFiltered` 1089, `searchText` 1077, `apiState` 1025 and `ledger100` 665. It *is* the
   slowest single-project operation by a wide margin, which is the real O(n²) signal. Acceptance
   criterion corrected above.
2. **Cold and warm are already ~2× apart, with no cache anywhere.** The spec says "today they are
   identical"; they are not. The gap is V8 lazy-compile on the first call, and it shrinks as the
   corpus grows (2.0× at `small`, 1.05× at `large`) because real work amortises it. Ticket 05 must
   therefore beat *this* warm column, not a flat one — a modest warm improvement at `small` is JIT,
   not the cache.
3. **`appendActivity100` and `ledger100` are completely flat across all three tiers** (~90 ms and
   ~665 ms). They are O(cap), not O(corpus): the 60-event and 500-row caps make the cost
   independent of how much else exists. `ledger100` is the single most expensive metric at `small`
   and `medium` — 665 ms for 100 paid calls, i.e. **~6.6 ms of YAML re-serialisation per image
   generated**, at any corpus size. That is tickets 03/04's target, quantified.
4. **`node --test tests/`** (bare directory) runs fine here, exit 0 — the spec claimed it fails.
   Node is **v20.19.0**, not 22.22, and is not pinned. Both corrected in `spec.md`, along with the
   stage-2 note that `node:sqlite` does **not** exist on this Node.

### Two deliberate deviations, both stated in the output

- **`SAMPLES` is 9, not 5**, and sampling is **round-robin** (every metric once per pass) rather
  than metric-major. At 5 with metric-major ordering the ticket's own run-to-run criterion failed
  outright — `small/listProjects` swung +56%, `small/appendActivity100` +41% — because sampling one
  metric 5× back to back concentrates any transient machine load into that metric, where a median
  cannot rescue it. Round-robin spreads a spike across one sample of every metric, which is exactly
  what a median discards. Criterion 8 explicitly authorises raising the sample count. Two
  consecutive runs after the change: max delta +12%, both exit 0.
- **`MIN_ABS_MS = 3`** — a regression must exceed both +15% *and* 3 ms absolute. Every cold sample
  is the first call in a brand-new process, carrying lazy-compile and first-touch page-cache cost;
  on a 3 ms metric that jitter alone is worth ±50%. The tier ladder is what preserves the gate: a
  real regression in `listProjects`/`listItems` shows up at `medium`/`large` where the numbers are
  large enough to mean something. Verified by the ticket's own probe — a `for` spin in
  `library.mjs item()` exits 1 naming `small/listAssets` (+111% cold, +182% warm) plus its three
  downstream consumers; reverting exits 0.

### Verified, not assumed

- `workspace/` untouched: hash over `stat` (mtime+size+name) of all 895 files identical before and
  after; no `config.md` appeared at the repo root, confirming `FRFG_CONFIG` is honoured and
  `setStorageRoot()` cannot reach the user's real pointer.
- Temp root removed on clean exit, on `SIGINT`, and on a thrown error (tested with an injected
  throw in a throwaway copy of the script). While fixing this I found the `SIGINT` handler was
  deferred ~36 s, because the parent sits inside blocking `spawnSync` and cannot run a JS signal
  handler until the loop yields; a real Ctrl-C also kills the child, so `sampleChild` now treats a
  signalled child as an interrupt and exits immediately.

### Seeding decisions the ticket did not specify

- `settings.md` is seeded with `skillRepos: []`. The default (`store.mjs:85-87`) points at
  `~/.claude/skills`, so `scanSkillRepos()` and `agentHome`'s pack scan would otherwise walk the
  real user home — not synthetic, and different on every machine.
- `activity.md` is pre-seeded at its 60-event cap and `costs.md` at its 500-row cap plus a rollup,
  so the write metrics measure steady state from sample 1 instead of drifting up toward it.
- `FRFG_TEST=1`, matching the tests. It gates only `startGeneration`'s queue runner and the agent
  CLI spawn, neither of which is on a measured path.

### Noted, not fixed (out of scope)

`providersStatus()` → `providerReady()` → `resolveBin()` (`backend/jobs.mjs:77-102`) runs
`spawnSync('which', …)` **twice per call with no memoisation**, and it sits inside every
`/api/state`. It is kept in the `apiState` metric because the ticket says to call what the route
calls, but it contributes a machine-dependent constant that does not scale with corpus size — a few
ms, i.e. noticeable at `small`, irrelevant at `large`. Worth a separate ticket; it is not a
markdown read path and nothing in this family touches it.
