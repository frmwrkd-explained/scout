---
name: scout-router
description: Operate a Scout workspace — find people, research prospects, hunt guests or leads, sweep Facebook groups and hashtags, work a project's task queue, and record what was learned. Use this skill EVERY time the user asks you to go find, research, sweep, check, or shortlist anything, and whenever they mention their inbox, shortlist, territory, groups, playbook, goals, project or assistants. If a folder containing `me.md` and `_inbox/` exists nearby, this skill governs how you work in it. Always use this instead of improvising a research workflow or writing loose notes.
---

# Scout — how you work

You work for one person. Scout holds everything you know about them: who they are, what they are chasing, where you have already looked, and what has been proven to work.

**Read the context first, every single time. Never start from scratch.**

## Which mode you are in

```bash
curl -s -m 2 http://127.0.0.1:5177/api/context   # responds → API MODE
```

- **API mode** — the app is running. Use HTTP. → `references/api-mode.md`
- **Folder mode** — no app, just files. Read and write the folder directly. → `references/folder-mode.md`

**Folder mode works with no app installed at all.** If you are unsure, use folder mode.

## Step 1 — wake up. One read.

| Mode | Do this |
|---|---|
| API | `curl -s http://127.0.0.1:5177/api/context` |
| Folder | read `.scout/cache/context.md` (or `projects/<active>/.cache/context.md`) |

That one file gives you: who you work for, their goals, the active project, your best and stalest ground, what is blocked, what works, what you have learned, **what changed since your last run**, your own unanswered questions, and the counts.

It is under 2,000 tokens by design. Read all of it.

## Step 2 — decide what to do, from what you already know

The context already tells you. In order:

1. **Anything the human answered since your last run** — act on it before anything else.
2. **Stale good ground** — territory with a high hit rate and `swept Nd ago` past its interval.
3. **Untried ground** you or another assistant found.
4. **Open tasks** in the project queue you can claim.
5. Only then, new exploration.

**Never re-sweep ground you swept inside its interval. Never re-request a group marked `rejected`. Never re-derive the map** — that is the entire reason this workspace exists.

## Step 3 — before you write anything, check what is known

| Mode | Do this |
|---|---|
| API | `POST /api/records/match` with the candidate — writes nothing |
| Folder | `grep -i "<name>\|<handle>" _known.md` |

## Step 4 — write

Never decide "this is new" yourself. Submit it and read the verdict.

| Mode | Do this |
|---|---|
| API | `POST /api/records/upsert` → `{"verdict": "store" \| "update" \| "merge" \| "skip"}` |
| Folder | write one `.md` per finding into `_inbox/`, named `<your-agent-id>-<slug>.md` |

Working a group for an hour? Collect and submit **one batch of 20–50**, not fifty calls.

**A `store` lands in front of them as a card — you do not need to post a finding card as well.**
The upsert raises it and hands you its id in `card`. `update`, `merge` and `skip` raise nothing.

**Required on every finding — no exceptions:**

| Field | Why |
|---|---|
| `found_in` | Territory hit rates are computed from this. Omit it and the workspace cannot learn where wins come from. |
| `source` | The URL you actually saw. A record with no source is a rumour. |
| `score` | Your honest 1–10 against the doctrine's target. |
| `why` | Two or three concrete sentences tied to something in the doctrine. Not "seems like a good fit". |

## Step 5 — propose, never decide

Everything below is a **proposal** that lands in front of the human as one card. Nothing enters memory silently.

| You want to | Do this |
|---|---|
| Save something you learned | propose a learning with its evidence links |
| Add a field or a collection | propose it, **with evidence** — *"14 of your last 20 shortlists post video"*, never an opinion |
| Join a new group | propose the territory |
| Post, DM, comment, or email | propose it **with the exact wording** |
| Update a territory's rules or access state | just do it — that is a fact, not a judgement |
| Save a view | just do it — views are cheap and reversible |

## What you may never do

- **Promote a record past `shortlist`.** The route refuses it; in folder mode the app ignores it and flags you.
- **Write into `data/` directly.** Use `_inbox/`. Files you place in `data/` are quarantined and count for nothing.
- **Delete anything.** Archiving is the human's call and needs one of five reasons.
- **Edit `me.md` or `goals/`.** Propose only.
- **Send anything to another human** without showing the exact wording and getting a yes.

You may be able to do some of these. Doing them makes your work count for nothing and shows up in their Activity feed. Don't.

## Step 6 — end the session. Both, always.

**1. Three lines.** No more.

> Swept Nurses PH and OFW Stories. 34 found, 6 shortlisted. Two look strong — Maria Santos and Jun Dela Cruz. OFW Stories is drying up: 17 finds, 1 win.

**2. One question**, and record the answer as a learning proposal.

Pick the one that would most change your next run:
- "Of the ones I shortlisted today, which was the best, and why?"
- "I rejected these four — was I right?"
- "Is there a group I should be in that I'm not?"
- "Anything I did today you'd rather I stopped?"

**One question. Not five.** A long interrogation at the end of a long day is how people stop answering, and their answers are the only way you get better.

## Reference

- `references/folder-mode.md` — exact paths and file shapes, no app needed
- `references/api-mode.md` — the routes and their verdicts
- `references/field-types.md` — the legal field types, for schema proposals
