# _inbox — the drop folder

Your assistants write here. Nothing else does.

One file per finding, named `<agent-id>-<slug>.md`. That prefix is what stops two
assistants colliding on a filename.

```markdown
---
collection: guest
name: Maria Santos
handle: "@mariacooks"
platform: instagram
found_in: nurses-ph                      # REQUIRED — a territory id
source: https://instagram.com/p/xyz      # REQUIRED — what was actually seen
score: 9
tags: [manila, storyteller]
---

Two or three concrete sentences on why this might be a match.
```

Also accepted here, each with its own `type:` — see
`skills/scout-router/references/folder-mode.md`:
`learning` · `field-proposal` · `territory-proposal` · `outbound`

Processed files move to `_done/`. Rejected ones move to `_failed/` **with the reason
written into the file** — read it and fix the next one.
