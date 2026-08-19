# Folder mode — no app required

Everything is plain markdown. You need nothing installed.

## The layout

```
<workspace>/
├── me.md                      who you work for · READ ONLY for you
├── goals/<id>.md              what they're chasing · READ ONLY for you
├── territory/<id>.md          where you can work · you may update facts
├── playbook/<id>.md           what works · propose changes
├── learnings/<id>.md          what's been learned · propose only
├── assistants/<id>.md         you and your colleagues
├── projects/<id>/
│   ├── project.md · brief.md
│   ├── tasks/<id>.md          the work queue — claim from here
│   ├── findings/              your output for this project
│   └── .cache/context.md      the project's wake-up context
├── data/<collection>/         the store · NEVER write here
├── files/                     attachments, named by sha256
├── _inbox/                    ← YOUR DROP FOLDER. Everything you find goes here.
├── _known.md                  flat list of everything known · grep before writing
└── .scout/cache/context.md    the global wake-up context
```

## Reading

1. `.scout/cache/context.md` — or the project one if a project is active. **This is your whole wake-up read.**
2. `_known.md` — grep it before writing anything. Format: `id · name · handle · status · collection`.
3. `territory/<id>.md` — when you need a group's rules or what you already posted there.
4. `playbook/<id>.md` — only the ones the context named.
5. **Never** read `data/` in bulk. **Never** read `projects/*/log/`.

## Writing a finding

One file per finding, into `_inbox/`, named `<your-agent-id>-<slug>.md`. That prefix is what stops two assistants colliding on a filename.

```markdown
---
collection: guest
name: Maria Santos
handle: "@mariacooks"
platform: instagram
found_in: nurses-ph          # REQUIRED — territory id, not a label
source: https://instagram.com/p/xyz    # REQUIRED — what you actually saw
score: 9
tags: [manila, storyteller]
on_camera: true
---

A nurse who started cooking on camera during the pandemic. Tells her own story
rather than reviewing other people's — no brand deals in the last 40 posts.
The comments are people answering her.
```

The watcher picks it up, deduplicates it against everything known, normalises it and logs it. If it merges into an existing record you will see the file appear in `_inbox/_done/`. If it fails, it lands in `_inbox/_failed/` **with the reason written into the file** — read it and fix your next one.

## Proposing

Same folder, `type:` says what it is.

```markdown
---
type: learning
claim: People who post video convert better than photo-only
scope: project
evidence: ["[[data/guests/maria-santos]]", "[[data/guests/jun-dela-cruz]]"]
---
Nine of the last eleven bookings posted video. None of the photo-only ones replied.
```

```markdown
---
type: field-proposal
collection: guest
key: on_camera
field_type: checkbox
why: 14 of the last 20 shortlists post video. Worth filtering on.
---
```

```markdown
---
type: territory-proposal
kind: facebook-group
label: Frat Alumni PH
url: https://facebook.com/groups/...
why: 3 of the hazing candidates came from members of this group.
---
```

```markdown
---
type: outbound
channel: facebook-group
territory: nurses-ph
subject: intro post
---
Exact wording you want posted, verbatim. It will be shown to them as written.
```

## Updating a territory — allowed, these are facts

Edit `territory/<id>.md` directly for: `last_swept`, `access` and `access_changed`, `rules`, and appending to `posted[]`.

Do **not** touch `finds`, `wins` or `hit_rate` — those are computed from records and typing them is meaningless.

## Claiming a task

```yaml
# projects/<p>/tasks/<id>.md
---
status: claimed
assigned: scout-fb        # your agent id
claimed_at: 2026-08-19 09:14
---
```

Write it, then **read the file back**. If `assigned` is someone else's, you lost the race — back off and take another. Set `status: done` when finished, or `status: blocked` with `needs_human: true` and a plain-language question in the body.

## Never

Write into `data/`. Delete anything. Edit `me.md` or `goals/`. Move a record past `shortlist`. Send anything to a human without approval.
