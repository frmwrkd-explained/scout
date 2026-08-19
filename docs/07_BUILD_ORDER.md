# 07 · BUILD ORDER

Build milestone by milestone. **Demonstrate the exit criterion before moving on** — merging is not finishing.

| M | What | Exit criterion |
|---|---|---|
| **M0 · Spine** | Fork FrameForge, strip the film modules, keep store/tests/tokens/Electron. `npm start` boots an empty app. | The test suite is green with the film modules gone. |
| **M1 · Data** | `collections.mjs` (field types), `views.mjs`, the table + document surface, the inspector with REFERENCED BY, properties collapsed on open. | A human hand-creates a collection, adds 10 records, saves two views, and opens a record's `.md` in Finder. |
| **M2 · Pipeline** | The four write verbs, near-match dedupe, `_inbox/` watcher, the gate + quarantine, mandatory reject reasons, the event log, Activity. | A file dropped in `_inbox/` is deduped and logged; an agent-authored promotion past `shortlist` is refused **and** visible. |
| **M3 · Memory** | `me`, goals, territory, playbook, learnings, `decay.mjs`, and `renderCache()` with its token budget. MEMORY / GOALS / WHAT THEY KNOW screens. | The cache renders under 2000 tokens with 5,000 records present, and a playbook claim past its window is visibly stale and absent from the cache. |
| **M4 · Orchestration** | Assistants + sub-agents, tasks with claiming, the three doors, agent-proposed collections/fields/views, DECIDE handling every card type. | Three agents work one project concurrently without collision; an agent proposes a field and the human approves it on a card. |
| **M5 · Finish** | Whiteboard, file browser, light/dark, the first-run interview, packaging + updater. | A new person is productive in 15 minutes, in light mode, and can find the raw markdown unaided. |

## Order inside a milestone

Backend and its tests first, driven by `curl`. UI second. **A screen built before its route is a screen built against a guess.**

## Definition of done for any task

1. The behaviour is demonstrated, not described.
2. It has a test if it is logic, and a screenshot if it is a surface.
3. `CLAUDE.md`'s source-of-truth table still names exactly one home for it.
4. Any ambiguity resolved along the way is recorded in `docs/decisions.md`.
