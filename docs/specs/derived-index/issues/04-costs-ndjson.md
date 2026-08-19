# 04 — `costs.md` → NDJSON detail rows + separate rollup

**Status:** open
**Blocked by:** None, but land [03](03-activity-ndjson.md) first — same change shape, and the shared append-log helper should be extracted here with two real call sites rather than guessed at in 03.

## Problem

Same anti-pattern as ticket 03, on a hotter path and with an extra correctness constraint.

`ledger.mjs:26-44` runs on **every paid external call** — every image, every video, every
vision analysis, every Groq enhance. Each call reads `costs.md`, YAML-parses it, prepends one
row, re-serialises **up to 500 row objects plus the entire monthly rollup**, and writes it back.
`workspace/costs.md` is 14,736 bytes today.

So generating one image rewrites a 500-element YAML array. A batch of 20 rewrites it 20 times.

`/api/state` then reads the same file **twice**: `getLedger()` (`ledger.mjs:46-48`) and
`getLedgerRollup()` (`ledger.mjs:50-52`) are called back to back at `index.mjs:314-315`, and
each independently opens and parses `costs.md` in full.

The 500-row cap is a workaround for the O(n) write, and `ledger.mjs:22-25` documents the bug it
caused: monthly totals had to be rescued with a permanent `rollup` because the detail rows get
trimmed. Fix the write and the cap stops being load-bearing.

`costs.md` also perturbs `fingerprint()` on every paid call, firing a spurious
`bump(['external'])` full-app refetch — see ticket 03's problem statement for why.

## What to change

The rollup and the detail rows have opposite access patterns, so they stop sharing a file.

1. **`workspace/costs.ndjson`** — detail rows, one JSON object per line, oldest first, appended
   with `fs.appendFileSync`. Same row shape as today: `{ ts, at, service, op, model, units, cost, ref }`.
   Not `.md`, for the `walkMd`/`fingerprint` reasons in ticket 03.

2. **`workspace/costs.md` keeps the rollup only** — frontmatter `{ rollup }`, no `entries`. It is
   still rewritten on every call, but it is now bounded by the number of months the user has been
   active (a dozen keys a year), not by 500 row objects. Keep it as `.md`: it is small, it is
   genuinely useful to read by hand, and it is the permanent record.

3. **Extract the append-log helper.** With 03 landed there are two call sites, so now pull the
   shared mechanics out — append one JSON line, read-and-parse-skipping-bad-lines, compact to
   the last N when over a threshold, migrate a legacy frontmatter array. Put it in `store.mjs`
   alongside the other datastore primitives; do **not** create a new module, and do not let this
   become a second source of truth for path construction — paths stay in the `paths` table at
   `store.mjs:65-75`.

4. **`ledger()`** appends the row, then updates only `costs.md`'s rollup. The rollup arithmetic
   at `ledger.mjs:34-40` is correct — keep it exactly, including the `byService`/`byOp`
   accumulation and `monthKey`.

5. **`getLedger()`** reads the NDJSON, skips unparseable lines, returns the last 500
   **reversed** (newest first) so the `/api/state` contract is unchanged. **`getLedgerRollup()`**
   reads `costs.md` only.

6. **Compaction threshold higher than activity's.** Cost history has real value — it is the
   user's spend record. Compact at **20,000 lines** down to 10,000, and when compacting, write
   the trimmed lines to `workspace/costs-archive-<YYYY>.ndjson` rather than dropping them.
   Nothing is ever destroyed in this repo.

7. **Migration.** On first read where `costs.ndjson` is absent and `costs.md` has an `entries`
   array: write the entries out as NDJSON oldest-first, rewrite `costs.md` with the rollup alone,
   leave `costs.md.bak`. Idempotent, and it must not run on every read.

   **The rollup must survive migration untouched.** It is the only permanent record of spend past
   the old 500-row cap; recomputing it from the surviving detail rows would silently undercount.
   Copy it, never recompute it.

## Acceptance criteria

- [ ] `ledger()` performs no read of the detail log. Verify with a `readFileSync` counter: 100
      `ledger()` calls → the only reads are of `costs.md` for the rollup (100), never of
      `costs.ndjson`.
- [ ] 600 `ledger()` calls → `getLedger()` returns 500 rows newest-first, and the newest is the
      600th. `getLedgerRollup()` reports `count: 600` and a `total` equal to the sum of all 600
      costs — **not** the surviving 500. This is the regression `ledger.mjs:22-25` exists to
      prevent; assert it explicitly.
- [ ] Rows spanning two months land in the right `monthKey` buckets with correct `byService` and
      `byOp` breakdowns.
- [ ] Migration: seed a root with a legacy `costs.md` holding 5 entries and a rollup of
      `{ '2026-07': { total: 99, count: 900, … } }`. Read → 5 entries returned newest-first, the
      rollup still reports `total: 99, count: 900` (**not** recomputed from the 5 rows),
      `costs.ndjson` exists, `costs.md.bak` exists. Read again → no duplicates.
- [ ] A torn final line does not throw; `/api/state` still responds 200.
- [ ] Compaction at 20,000 lines leaves 10,000 and writes the remainder to
      `costs-archive-<YYYY>.ndjson`. No rows are lost — assert `archived + remaining == 20000`.
- [ ] `fingerprint()` is unchanged across 10 `ledger()` calls **except** for `costs.md`'s rollup
      write. (It will still move, because the rollup file legitimately changes. Note the residual
      bump in a comment — eliminating it entirely would mean moving the rollup out of `.md` too,
      which is not worth it for one small file.)
- [ ] `npm run bench` shows `ledger × 100` dropping substantially; no other metric regresses.
- [ ] `node --test tests/*.test.mjs` green — `tests/phase22-cost-surfacing.test.mjs` and
      `tests/phase3-durability.test.mjs` are the ones that will notice. Read both before starting.

## Notes

- `op` and `service` are unvalidated free text and `ledger.mjs:12-15` explicitly warns against
  writing an exhaustive switch over `op` without a default branch. That warning applies to the
  rollup code you are moving — carry the comment with it.
- The budget check in Settings reads the rollup, not the detail rows, so raising or removing the
  detail cap cannot affect budget math. Confirm this before changing the cap; grep with
  `-a`/`--text`.
- Keeping the rollup in `.md` and the detail in `.ndjson` is a deliberate split, not an
  inconsistency: one is a small permanent record a human might read, the other is a machine log.
  Say so in a header comment so the next agent doesn't "unify" them back into one file.
