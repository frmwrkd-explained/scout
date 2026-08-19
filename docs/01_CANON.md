# 01 · CANON — the laws, and why each one exists

These are not preferences. Each exists because a specific failure mode killed a specific system. Where a task document and this file disagree, **this file wins** (and `GOAL.md` wins over both).

---

## Law 1 — Files are the truth. Everything else is disposable.

Every record, memory, schema and view is a plain `.md` file with YAML frontmatter. The search index, the caches, the derived counts — all rebuildable from the files in minutes, and deletable without loss.

*Why:* the person must be able to open the folder in Finder, in Obsidian, in anything, and read what the agent saved. The moment truth lives in a database, "what did the agent actually store" becomes unanswerable and trust dies.

## Law 2 — Three altitudes. Every surface opens at the first.

| | Content | Cost |
|---|---|---|
| **1 · DECISION** | One line, and a yes/no | Free — the default state |
| **2 · BECAUSE** | Two or three sentences of reasoning | One click |
| **3 · EVIDENCE** | The document, raw log, source page, the `.md` file | Two clicks |

*Why:* the operators are non-technical and will use this for hours. Volume is the product; comprehension is the constraint. A screen that opens at altitude 2 is a bug, not a styling choice. **This includes record properties: when a document opens, the property table is collapsed** — the human reads the human part first.

## Law 3 — Everything shows its age, and stale things recede.

Every memory object carries `verified_at`. `backend/decay.mjs` turns that into a staleness score, rendered on every surface as a form (a bar that empties, a dot that hollows) and not only as a colour.

*Why:* this work is date-sensitive. A researcher wants what is live today. Tencent's memory model — which we borrow heavily from — has no decay at all, so its memory only grows. That is the one place it is wrong for us. **Memory must rot on purpose, visibly**, or the agent keeps working a hashtag that died in June.

## Law 4 — Agents propose, humans dispose. The gate is in the pipeline, never in a prompt.

An agent may write into `_inbox/` and may move a record as far as `shortlist`. Anything beyond that is refused by the route, and anything written directly into `data/` is quarantined on read and flagged.

*Why:* a prompt is a request; a pipeline is a rule. When the agent runs inside someone else's app we cannot constrain its tools, so the guarantee has to live at the border. **You cannot prevent the write. You can make it have no effect and be visible.**

## Law 5 — Never delete. Archive with a reason.

Rejection requires one of a fixed set of reasons. Archived records keep their file, their reason and their history.

*Why:* the rejects are the only labelled data the system ever gets. Every territory score, every playbook claim and every improvement to the agent is computed from them. Deleting a record deletes the lesson.

## Law 6 — One file per entity. Never a list file.

*Why:* several agents and a human write concurrently. One file per entity means two writers almost never touch the same bytes, git merges cleanly, and a corrupted file costs one record instead of a table.

## Law 7 — The agent never re-derives what it already knew.

On wake, an agent performs **one read** — the hot cache — and gets identity, goals, active project, best and stalest territory, playbook titles and what changed since last run. The cache has a **hard token budget** (default 2000) enforced in code.

*Why:* this is the entire reason the product exists. Without it, an agent asked to find guests in Philippine Facebook groups rediscovers the same nine groups every single morning and burns the day. The cap matters as much as the cache: an uncapped context file becomes the overwhelm it was built to prevent.

## Law 8 — Nothing is hidden from a human who wants to look.

Every record links to its `.md` path. Every screen has a route to the file browser. Every agent action is in the event log. "Reveal in Finder" exists.

*Why:* we compress aggressively (Law 2), and compression without a way down becomes concealment. The two must ship together.

## Law 9 — The workspace is built *with* the person, not shipped *to* them.

The agent interviews them, proposes collections, fields and views, and they approve on a card. Their dashboard grows as their work changes.

*Why:* the scope of this product is genuinely undefinable — a producer, an HR coordinator and a salesperson need different objects. Any fixed schema is wrong for two of the three. **Agent-built schemas are not a nice-to-have; they are how the product covers its own scope.**

## Law 10 — Reuse components. A second implementation is a bug.

Before building any UI, grep for the concept. `frontend/ui.jsx` is the registry.

*Why:* the parent codebase carried three structurally separate implementations of one composer before they were collapsed. That cost weeks. The cheapest time to prevent it is now.

---

## The one-line version

**Plain files are the memory · every surface opens at a decision · memory decays on purpose · the agent proposes and the human disposes · nothing is ever deleted and nothing is ever hidden.**
