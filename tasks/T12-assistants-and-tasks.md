# T12 · Assistants, sub-agents and the task queue
**Milestone:** M4 · **Reads:** `docs/04_AGENT_CONTRACT.md` §5

## Do
1. `assistants/<id>.md` — name, one-sentence job, scope (which collections and territory it may touch), schedule, model, `parent` for sub-agents.
2. `projects/<p>/tasks/<id>.md` — `status: open|claimed|done|blocked`, `assigned` (an **actor**: agent id or person), `claimed_at`, `needs_human`.
3. **Claiming:** write `assigned` + `claimed_at` atomically, then re-read. If someone else won, back off and take another. One file per task means two agents claiming different tasks never touch the same bytes.
4. Findings are written as `findings/<agent>-<slug>.md` — parallel agents can never collide on a filename.
5. `needs_human: true` pulls the task into the DECIDE queue.
6. **ASSISTANTS screen** — each assistant as a thing she owns: what it is doing right now in plain language, what it did last, what it cost. Creating one must feel like hiring, not configuring. Show a parent with two sub-agents, one running, one idle, one blocked.
7. **PROJECT screen** — the goal and its number, who is on it, the task queue, findings count, what needs her, and add-a-task in plain language.

## Demonstrate
Three agents claim from one queue concurrently for five minutes with no lost or double-claimed task. The PROJECT screen reads like standing over a team.
