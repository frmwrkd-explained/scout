# Tool manifest — ground truth

This mirrors `backend/userTools.mjs`. The server validates every draft against
these rules and rebuilds the frontmatter from scratch; nothing you write in the
fence reaches disk unchecked. If this file and the server ever disagree, the
server wins and this file is the bug.

## The four fields you supply

| Field | Required | Rule | What it becomes |
|---|---|---|---|
| `id` | yes | `^[a-z][a-z0-9-]{1,39}$` — lowercase, starts with a letter, 2–40 chars | the folder name, the on/off key, the mount dir `skills/tool-<id>` |
| `name` | yes | 1–60 chars | the Tools-hub card title and the Settings row title |
| `capability` | yes | 1–160 chars, one sentence, **no newline** | the agent-facing Index line — the entire trigger surface |
| `instructions` | yes | 1–16384 chars of markdown | the body the agent follows when the tool is enabled |

## Reserved ids — rejected

`style-locks` · `sheet-composer` · `grid-splitter` · `shot-board` ·
`look-extractor` · `control-maps`

These are built-in tools. A user tool sharing an id would resolve against the
same `enabledChatTools` key and silently hijack the built-in's toggle.

An id whose folder already exists is also rejected. There is no overwrite path —
that is deliberate, because a draft is machine-written and a silent overwrite
would destroy a tool the filmmaker had already tuned.

## Fields the server writes, which you must not set

Setting these in a draft is not an error — they are ignored and overwritten.
Do not mention them to the filmmaker.

| Field | Value | Why it is forced |
|---|---|---|
| `directiveTypes` | `['tool.card']` | The only directive a user tool may emit. One static type, one renderer, gated once. |
| `invocation` | `skills/tool-<id>/SKILL.md` | The Index pointer is always the instructions, never an endpoint. The session *can* curl, which is exactly why an author-declared route is dangerous: it would advertise an endpoint nobody verified straight into the agent's Index. Name routes inside the body, where they read as steps rather than as a contract. |
| `source` | `user` | Distinguishes authored tools from built-ins in the switchboard. |
| `user-editable` | `true` | Marks it a user artifact. |
| `updated` | display stamp | Written on save. |

## Writing the capability sentence

It is the only thing the agent sees until the tool fires. Write the *moment*,
not the mechanism.

- **Good** — `Draft a wardrobe continuity note for a shot from what the project already knows.`
- **Bad** — `A tool for wardrobe.` Nothing in that sentence tells the agent when to reach for it.
- **Bad** — `Uses the cast board and shot records to produce formatted markdown.` Describes the implementation; the agent needs the trigger.

The test: read the sentence and ask *"would I recognise the request that should
fire this?"* If not, it will never fire, and the filmmaker will conclude the
tool builder doesn't work.

## The card a tool may render

A tool may emit one directive, and only this shape:

```frameforge
{ "type": "tool.card",
  "tool": "<the tool id>",
  "title": "Wardrobe — SH040",
  "summary": "Continuity holds. One flag: the jacket.",
  "fields": [ { "k": "Scene", "v": "4B" }, { "k": "Flag", "v": "jacket swapped at SH032" } ] }
```

`title`, `summary` and `fields` are all optional. It is display only — there are
no buttons and no actions in a tool card. If a tool's whole value is a button,
it is not a tool yet; say so rather than shipping a card that does nothing.
