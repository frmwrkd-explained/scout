# 04 · AGENT CONTRACT — doors, tools, agent-built schemas, the gate

The agent layer is **separate and swappable**. Scout does not own the agent process — it may be Devin, Claude Code, goose, a Buzz agent, or a person dragging a file in by hand. The contract is the same for all of them.

---

## 1. Three doors, one pipeline

| Door | Who uses it | Mechanism |
|---|---|---|
| **HTTP** | agents Scout spawns locally | `curl` the API on `127.0.0.1:5177` |
| **Files** | agents inside Devin / Buzz / anything with folder access | drop `.md` into `_inbox/` |
| **MCP** | hosts that speak it | the same tool surface |

All three call the same `upsertRecord`. `_inbox/` is untrusted input, `data/` is the store, **the watcher is the border.** Write folder mode first — it works everywhere.

Scout can *open* door 1 for you — `backend/dispatch.mjs` spawns whichever agent CLI is connected in Settings, hands it the brief below, and records the run (`POST /api/assistants/:id/run`, or the one button on TODAY). That is convenience, not ownership: **it is optional, the app is fully usable without it, and a process Scout spawned has exactly the same standing as one it did not.** The gate refuses it, quarantine catches it, and the log names it. Nothing in this contract changes because of who started the process.

## 2. Wake-up

```bash
curl -s http://127.0.0.1:5177/api/context            # or: read .scout/cache/context.md
```

**One read.** Identity, goals, project, territory, playbook titles, learnings, what changed since last run, open questions, counts. Under 2000 tokens, always.

Then, and only when needed:
- `GET /api/playbook/:id` — a playbook body
- `GET /api/territory/:id` — a territory's rules and post history
- `POST /api/search` — records
- `_known.md` — flat, greppable `id · name · handle · status`, for dedupe without an API

**Never read `data/` in bulk. Never read the log.**

## 3. Writing

```bash
curl -s -X POST .../api/records/upsert -d '{ "collection":"guest", "name":"...", "found_in":"nurses-ph", ... }'
```

Response is the verdict — `store` · `update` · `merge` · `skip`. Working a group for an hour? **One batch of 20–50**, not fifty calls. `POST /api/records/match` checks without writing.

Required on every finding: `found_in` (territory scores are computed from it — omit it and the app cannot learn), `source` (the URL actually seen), `score` with a one-line `why` tied to the doctrine.

## 4. Agent-built schemas — the tools

The scope of this product is undefinable, so the agent builds the person's database with them. **Every schema change is a proposal.**

| Tool | Effect |
|---|---|
| `collection.propose(id, label, query, fields[])` | A new collection → card in DECIDE |
| `field.propose(collection, key, type, options, why)` | A new field → card. `why` is mandatory and shown to the human. |
| `field.retire(collection, key, why)` | Hides a field; never drops data |
| `view.create(collection, view)` | Views are cheap and reversible — **allowed without approval**, and announced in Activity |
| `subtable.propose(collection, id, target, bind)` | A bound child collection |
| `schema.infer(sample_paths[])` | Reads sample documents, returns a proposed field set for review |

Rules:
- **Views: free. Fields and collections: approval.** Adding a column changes what everyone sees forever; saving a view does not.
- A proposal must carry evidence — *"14 of your last 20 shortlists post video"* — not an opinion.
- Field types come from `docs/02_DATA_MODEL.md` §2 and nowhere else. An agent proposing a type outside that set gets a 400 naming the legal set.
- Never change a field's type on live data. Propose a new field and a migration the human confirms.

## 5. Orchestration

**Assistants** — `assistants/<id>.md`: name, one-sentence job, scope (which collections and territory it may touch), schedule, model, parent. Sub-agents declare `parent:`.

**Tasks** — `projects/<p>/tasks/<id>.md`, the coordination mechanism:

```yaml
---
id: sweep-nurses-ph
status: open           # open | claimed | done | blocked
assigned:              # actor — an agent id or a person
claimed_at:
needs_human: false
---
```

An agent **claims** by writing `assigned` + `claimed_at` atomically, then re-reading. If someone got there first, it backs off and takes another. One file per task means two agents claiming *different* tasks never touch the same bytes. Findings are written as `findings/<agent>-<slug>.md`, so parallel agents can never collide on a filename.

`needs_human: true` pulls the task straight into the DECIDE queue.

## 6. What the agent may never do

- **Promote past `shortlist`.** The route returns 403; a stage written directly into a file with `updated_by: <agent>` is **ignored on read and flagged in Activity**.
- **Write into `data/` directly.** Such files are **quarantined**: visible, marked, and excluded from every count, view and score until a human accepts them.
- **Delete anything.** Archive with a reason; the reason is mandatory.
- **Edit `me.md` or `goals/`.** Propose only.
- **Send anything to another human** — a DM, comment, email, follow, or a post in a group — without showing the exact wording and getting a yes.
- **Spend money** without a confirmed card.

You cannot prevent an agent with folder access from writing. You can make the write have no effect and be visible. That is the design.

## 7. Ending a session — both, always

1. **Three lines.** What you searched, what you found, what needs them.
2. **One question**, then record the answer:
   ```bash
   curl -X POST .../api/learnings/propose -d '{"claim":"...","evidence":[...],"scope":"project"}'
   ```
   One question. Not five. This is the only mechanism by which the agent gets better — and a five-question interrogation at the end of a long day is how people stop answering.

## 8. The Index

`GET /api/index` renders the capability list an agent reads: API base, the collections and their fields, the enabled tools, the current project, and a pointer to the route reference. **Adding a capability is a new Index line, never an edit to the router skill.**
