# Scout — Master Goal & Build Charter

> This is the source of truth. Where any other document, spec, or design file disagrees with this one, **this one wins**. Read it first, then `CLAUDE.md`, then `docs/01_CANON.md`.

---

## 1. The goal in one paragraph

Give every non-technical team member a desktop app where they **orchestrate a small team of AI agents** that work all day on their behalf, and where they **curate the memory those agents run on**. The agent knows who they are, what they are chasing, where it has already looked, and what has been proven to work — so it never has to be re-explained. The human's whole job in the app is to **decide**, in seconds, and to **correct the memory** when it is wrong. Everything is plain markdown on disk, so nothing is ever locked in and anyone can open the folder and read what the agent saved.

## 2. Why this exists

The team's work is genuinely undefinable — a producer hunting podcast guests, an HR coordinator scanning Facebook communities, a salesperson working shops in Cebu, a coordinator chasing suppliers. No fixed CRM fits all of it. What they share is the shape: **an agent does high-volume work, a human judges it, and the judgement has to make the agent better next time.** Today that loop does not exist, so every agent run starts from zero and every good insight dies in a chat window.

## 3. The end state (a day in the life)

- She opens Scout at 9am. **Three lines** tell her what the assistants did overnight.
- **Six things need her.** She presses one key and works through them — a found guest, a draft post the agent wants to publish, a request to join a new group, a memory update the agent wants to save.
- One assistant is blocked and asks a question in plain language. She answers in a word.
- She presses one button. The assistants go back out.
- Two weeks later the agent is measurably better at her job, because every rejection carried a reason and every proven claim carries its evidence.

## 4. Definition of Production-Ready (the gates)

Done when **all** of these are demonstrated, not merely coded:

1. **A fresh person is productive in 15 minutes.** The agent interviews them, builds their workspace with them, and produces a first real finding before the session ends.
2. **The agent never re-derives what it already knew.** Two consecutive runs, one week apart, and the second one starts from the cache — proven by the run log showing no re-discovery of known territory.
3. **Nothing enters the record store without passing the pipeline.** Proven by dropping a raw file into `_inbox/` and watching it get deduped, normalised and logged.
4. **The gate holds.** An agent attempting to promote past `shortlist`, or writing directly into `data/`, is refused or quarantined and the attempt is visible in Activity.
5. **Rejection reasons are mandatory and they move the numbers.** Rejecting for `off-target` visibly changes a source's score.
6. **The human is never overwhelmed.** Every screen opens at altitude 1. No screen shows more than one decision at a time.
7. **Memory decays.** A playbook claim not re-verified inside its window is visibly stale and drops out of the agent's cache.
8. **The agent can build the database.** It proposes a collection, its fields and a view; the human approves on one card; the table exists.
9. **Nothing is hidden.** From any record, the raw `.md` file is reachable in two clicks, and the folder opens in Finder.
10. **It is operable by someone else.** A second person can run and extend the app from these docs alone.

## 5. Core capabilities

- **Orchestration** — several named assistants, each with a job, a scope and a schedule. Sub-agents allowed.
- **Memory that compounds** — identity, goals, territory, playbook, learnings, with a hot cache the agent reads on wake.
- **Decision-first UI** — one card, two keys, mandatory reasons.
- **Agent-built databases** — collections, fields and views proposed by the agent, approved by the human.
- **Total transparency** — every screen has a path to the raw markdown.
- **Local-first** — plain files, the user's machine, their own agent runtime.

## 6. Non-negotiable principles (locked — do not re-litigate)

- **Files are the truth.** The index is derived and disposable. No database.
- **Three altitudes.** Decision → Because → Evidence. Every surface opens at the first.
- **Everything shows its age.** Memory decays on purpose and shows it.
- **Agents propose, humans dispose.** The gate lives in the pipeline, never in a prompt.
- **Never delete.** Archive with a reason; rejects are the training data.
- **One file per entity.** Never a list file.
- **The agent never re-derives what it already knew.** The cache is a contract.
- **Nothing is hidden from the human who wants to look.**
- **The workspace is built *with* the person, not shipped *to* them.**
- **Reuse components.** A second implementation of anything is a bug.

## 7. Scope & non-goals

**In scope:** the desktop app, the markdown datastore, the memory system, the agent contract and its three doors, the decision UI, agent-built collections, the whiteboard, light/dark.

**Out of scope for v1:** hosting agents ourselves, multi-user real-time collaboration, a mobile app, semantic/vector search, anything requiring a server.

## 8. People

- **The operator (a team member)** — non-technical. Decides, corrects memory, launches assistants. Never configures anything before getting value.
- **The owner (Theo)** — sets up the first workspaces, watches cost and output, extends the kits.

## 9. Milestones

- **M0 — Spine.** FrameForge forked, film modules stripped, markdown store + HTTP API + tests green. App boots empty.
- **M1 — Data.** Collections, field types, views, the document surface, the inspector. A human can create and edit records by hand.
- **M2 — Pipeline.** The four write verbs, near-match dedupe, `_inbox/` watcher, the gate, mandatory reject reasons, Activity.
- **M3 — Memory.** `me`, goals, territory, playbook, learnings, decay, and the hot cache with its token budget.
- **M4 — Orchestration.** Assistants, sub-agents, tasks with claiming, the three doors, agent-proposed schemas.
- **M5 — Finish.** Whiteboard, file browser, light/dark, onboarding interview, packaging.

Each milestone ends by demonstrating its exit criterion, not by merging.

## 10. Risks to defend against actively

- **Context bloat** → the hot cache has a hard token cap, enforced in code and tested.
- **Memory rot** → decay is a first-class field and a visible state.
- **Overwhelm** → altitude 1 is the default everywhere; a screen that opens deeper is a bug.
- **Agent damage** → the gate and quarantine, plus never-delete.
- **Second implementations** → `CLAUDE.md` holds the source-of-truth table; grep before building.
