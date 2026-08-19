# T10 · Decay and the hot cache
**Milestone:** M3 · **Reads:** `docs/03_MEMORY.md` §2, §4 — the most important task in the build

## Do
1. `backend/decay.mjs` — **one** `staleness(obj) → 0..1`. `TYPE_WINDOW`: territory 7d · playbook 30d · learning 90d · record 30d; `sweep_interval_days` overrides. Never inline a second staleness rule anywhere.
2. `backend/memory.mjs` `renderCache()` — the **only** producer of the agent's wake-up context. Renders exactly the shape in `03_MEMORY.md` §2.
3. **`CACHE_TOKEN_BUDGET = 2000`, enforced in code.** Over budget → compress in the fixed order (territory beyond top-5/stalest-3/blocked → playbook one-liners → learnings > 60d unverified → "since last run" → goals on track) and **log what was dropped**. A silent truncation is a defect.
4. Playbook claims at `staleness >= 1` are excluded from the cache but stay in their file.
5. Regenerate debounced 2s on any memory write. `v` increments. `GET /api/cache/version` is one cheap call.
6. Project-scoped cache at `projects/<id>/.cache/context.md`.
7. Routes: `GET /api/context`, `GET /api/cache/version`, `POST /api/cache/regenerate`.

## Demonstrate
Seed 5,000 records, 40 territories and 30 playbook claims: the cache renders **under 2,000 tokens** and names what it dropped. Age a claim past its window: it is visibly stale in the UI and absent from the cache, and its file is unchanged.
