# T09 · Memory — identity, goals, territory, playbook, learnings
**Milestone:** M3 · **Reads:** `docs/03_MEMORY.md` §1, §3, §5

## Do
1. `me.md` — human-owned. Agents may only propose; the route refuses an agent write.
2. `goals/<id>.md` — statement, target number, deadline, project, assistants. Progress is a **rollup**, never typed.
3. `territory/<id>.md` — the full shape in the doc, including `access`, `access_changed`, `last_swept`, `sweep_interval_days`, `rules`, `posted[]`. `finds`/`wins`/`hit_rate` are rollups over records whose `found_in` points here; `backend/territory.mjs` is their **sole writer**.
4. `playbook/<id>.md` — every claim carries evidence links. A claim with no evidence is refused on write.
5. `learnings/<id>.md` — `claim · scope · evidence[] · confidence · status · verified_at`. Agents **propose**; approval happens on a DECIDE card.
6. Graduation: a `scope: project` learning that holds in a second project is proposed for promotion to global.

## Demonstrate
A record moved to `won` raises its territory's hit rate with no manual edit. A playbook claim submitted without evidence is refused.
