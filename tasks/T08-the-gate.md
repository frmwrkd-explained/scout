# T08 · The gate, quarantine and reject reasons
**Milestone:** M2 · **Reads:** `docs/01_CANON.md` Law 4–5, `docs/04_AGENT_CONTRACT.md` §6

## Do
1. `POST /api/records/:id/move` with `actor: agent` and a stage past `shortlist` → **403**, logged.
2. On read, a document whose gate status is past `shortlist` **and** whose `updated_by` is an agent → the stage is ignored, the record is flagged, and the attempt appears in Activity.
3. A document created directly under `data/` by an agent (not via the pipeline) → `quarantined: true`. Visible and marked, but excluded from every count, view, rollup and territory score until a human accepts it.
4. `POST /api/records/:id/archive` requires `reason` ∈ `off-target · bad-data · duplicate · wrong-tone · already-contacted`. No reason → 400.
5. Never delete a file. Archive moves it to `data/_archive/` with the reason and full history.

## Demonstrate
Each of the four refusals, each visible in Activity. Archive a record and find its file, its reason and its history.
