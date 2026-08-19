# T07 · The `_inbox/` watcher — door 2
**Milestone:** M2 · **Reads:** `docs/04_AGENT_CONTRACT.md` §1

## Do
1. Watch `_inbox/`. A `.md` landing there is a **proposal in file form** — parse it and call the same `upsertRecord`. No second code path.
2. Normalise loose frontmatter to the collection's schema; unknown keys go to `extra` rather than being dropped.
3. On success move the source file to `_inbox/_done/<date>/`. On failure move to `_inbox/_failed/` **with the reason written into the file**, so the agent can read why.
4. Generate `_known.md` (`id · name · handle · status`, flat and greppable) and `_index.md` on every store change, debounced. These are how a folder-mode agent dedupes and orients without any network.
5. `_inbox/README.md` — the drop instructions and the frontmatter shape, sitting where they are needed.

## Demonstrate
Drop a hand-written `.md` into `_inbox/`: it appears in the app deduped and logged. Drop a malformed one: it lands in `_failed/` with a readable reason.
