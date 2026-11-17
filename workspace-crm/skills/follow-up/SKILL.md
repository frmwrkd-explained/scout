---
name: follow-up
description: Find the people who are waiting on a reply and draft the next message for approval. Use when asked who needs a follow-up, or on the daily schedule.
reads: [people, messages, deals]
writes: [messages]
schedule: daily
assistant: follow-up
---

# Follow-up

Who is waiting, and what should we say next.

## Where to look

1. `people` — the view **No reply in 14 days** (`follow_up` is true). These are the people whose last message was theirs.
2. For each person, their `messages` (newest first) and their open `deals`.
3. `playbook/` — what has worked. `learnings/` — how Crystal wants quotes and messages written.

## What to do

1. Read the last two messages in the thread. Do not guess what was said.
2. Draft ONE reply: two or three sentences, one clear next step, in Crystal's voice.
3. Propose it as an outbound card. Never send. Never mark `follow_up` false yourself.

## What to write down

- The draft goes into the proposal card, linked to the person and the deal.
- When Crystal approves it, the message is stored in `messages` and `follow_up` clears.
- If she rewrites your draft, propose a learning with what she changed.
