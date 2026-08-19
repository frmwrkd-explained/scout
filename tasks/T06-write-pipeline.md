# T06 · The write pipeline — four verbs and near-match
**Milestone:** M2 · **Reads:** `docs/04_AGENT_CONTRACT.md` §3, `docs/01_CANON.md` Law 4–6

## Do
1. `backend/records.mjs` — **the only writer of document files.**
2. `nearMatches(candidate)` — score on handle, source URL, exact name, contained name, trigram overlap. Return id + confidence.
3. `upsertRecord()` returns one of `store · update · merge · skip`. Confidence ≥ 60 merges into the existing record; nothing new is `skip`.
4. `POST /api/records/batch` — 20–50 items in one call, one near-match pass for the batch. Return a tally.
5. `POST /api/records/match` — dry run, writes nothing.
6. Everything an agent writes lands `proposed: true` in the first stage.
7. Every mutation appends to `backend/log.mjs`.

## Demonstrate
Submit the same person three times under different handles and hashtags: `store`, then `update`, then `skip`. One file exists.
