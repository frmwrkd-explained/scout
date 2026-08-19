# 02 · DATA MODEL — collections, fields, views, subtables

Everything the person and the agent work with is a **collection**. One table component, one document surface, many saved views. This is what makes an undefinable scope tractable: a producer, an HR coordinator and a salesperson get different collections, not different apps.

---

## 1. A collection is a saved query, not a folder

```yaml
# .scout/collections/guest.md  (frontmatter IS the schema)
---
id: guest
label: Guests
icon: user
query:
  tag: guest              # any combination of: tag · path · frontmatter filter
  path: data/guests/**
default_view: needs-review
fields:
  - { key: name,      type: text,   required: true, primary: true }
  - { key: status,    type: status, options: [...], gate: true }
  - { key: handle,    type: text }
  - { key: platform,  type: select, options: [instagram, facebook, tiktok] }
  - { key: found_in,  type: relation, target: group, inverse: finds }
  - { key: score,     type: number, display: bar, min: 1, max: 10 }
  - { key: found,     type: date,   display: freshness }
  - { key: on_camera, type: checkbox }
---
```

A document belongs to a collection if it matches the query. **Documents are never "moved into" a collection** — they match or they don't. A record can belong to several.

## 2. Field types — the set, and why exactly these

Chosen by looking at what Notion, Airtable, Heptabase and Tesseract actually converged on, then cutting everything that does not earn its place in this app.

| Type | Options | Why it exists here |
|---|---|---|
| `text` | `multiline` | The default. |
| `number` | `display: plain \| bar \| stars \| currency`, `min`, `max`, `precision` | `display` is why we don't need a separate "score" or "rating" type. |
| `select` | `options[] {value, colour}` | Single choice with a colour chip. |
| `multiselect` | same | Tags, categories. |
| **`status`** | `options[] {value, colour, group: todo\|active\|done}` | **Not the same as `select`.** The `group` drives board columns, "what's open", and completion counts. Exactly one status field per collection may set `gate: true` — that is the field the promotion gate guards. |
| `date` | `display: absolute \| relative \| freshness`, `time: bool` | `display: freshness` renders the decay bar from Law 3. |
| `checkbox` | — | Yes/no. |
| `url` · `email` · `phone` | — | Typed so they render as actions, not strings. |
| **`relation`** | `target`, `many: bool`, `inverse` | The spine. A chip that opens the other document. `inverse` creates the backlink shown in REFERENCED BY. |
| **`rollup`** | `via` (a relation field), `target_field`, `fn: count\|sum\|avg\|min\|max\|latest` | How territory yield, goal progress and evidence counts are computed **without a second source of truth**. |
| `formula` | `expr` | Sandboxed, pure, no I/O. Escape hatch — prefer a rollup. |
| `file` | `many: bool` | Screenshots, PDFs. Content-addressed by sha256. |
| **`actor`** | `kinds: [human, agent]` | Assignee. **This is the orchestration type** — a task assigned to `scout-fb` is how a person directs a team. |
| `json` | — | Last resort. Renders read-only unless expanded. |

**Automatic fields, on every document, never declared:** `created`, `updated`, `created_by`, `updated_by`, `verified_at`, `proposed`, `quarantined`.

`updated_by` is load-bearing: it is how Law 4 ignores an agent-authored promotion.

**Rules:**
- A collection has exactly one `primary: true` field — the document title.
- At most one `gate: true` status field.
- `rollup` and `formula` are **derived**: computed on read, cached in `.scout/cache/computed.json`, and **never written into frontmatter as authority.** Frontmatter always wins over a computed cache.
- Adding a field never rewrites existing documents. Missing = empty.

## 3. Views

A view is a saved query-plus-presentation, stored **in the vault** (`.scout/views/<collection>.json`) so views travel with the data and an agent can create one.

```json
{ "id":"needs-review", "label":"Needs review", "type":"table",
  "filter":[{"field":"status","op":"is","value":"needs-review"}],
  "sort":[{"field":"score","dir":"desc"}],
  "group": null,
  "fields":["name","status","score","found_in","found","tags"],
  "card": null, "density":"compact" }
```

| View type | For | Notes |
|---|---|---|
| **table** | Dense scanning. The default. | Inline edit, resizable columns, group-by. |
| **board** | Anything with a `status` field. | Columns are the status options, ordered by `group`. Cards carry `card.fields` and, when the collection has one, a **relation-derived activity line** (`last touch 3d ago`) — that's the "kanban with more information" case. |
| **list** | Date-heavy, log-like. | One line per row, grouped by day. |
| **gallery** | Anything with a `file` field. | Screenshot-first review. |

**Default view is chosen by shape, not asked about:**
- has a `status` field with more than 2 options → **board**
- has a `date` field and no status → **list**
- has a `file` field marked `primary_media` → **gallery**
- otherwise → **table**

The person can change it; they should never have to pick one to get started.

## 4. Subtables

A subtable is **a collection with a bound parameter** — no new concept, no new storage.

```yaml
# on the guest collection
subtables:
  - { id: outreach, label: Outreach, collection: message, bind: { guest: $self } }
  - { id: evidence, label: Evidence, collection: finding, bind: { about: $self } }
```

Opening `guests/maria-santos` shows an `Outreach` tab listing every `#message` whose `guest` relation points at her. The subtable is a real view — filterable, addable, with its own default type.

*Why this shape:* a subtable is the inverse side of a relation. Modelling it as anything else would create a second way to express the same edge, and the two would drift.

## 5. On disk

```
<workspace>/
├── .scout/
│   ├── collections/<id>.md      schema (frontmatter)
│   ├── views/<id>.json          saved views
│   ├── cache/context.md         THE HOT CACHE — see 03_MEMORY.md
│   ├── cache/computed.json      rollups/formulas — disposable
│   └── index/                   search index — disposable
├── me.md                        identity · always injected
├── goals/<id>.md
├── territory/<id>.md
├── playbook/<id>.md
├── learnings/<id>.md
├── assistants/<id>.md
├── projects/<id>/
│   ├── project.md · brief.md · learned.md
│   ├── tasks/<id>.md
│   └── log/<date>.md
├── data/<collection>/<slug>.md  the documents
├── files/                       attachments, sha256-named
├── _inbox/                      the agent drop folder
└── _index.md · _known.md        generated, for file-mode agents
```

Everything under `.scout/` is disposable and gitignorable. Everything else is the truth.

## 6. Schema changes are always proposals

An agent may propose a collection, a field, or a view. It lands as a card in DECIDE:

> **New field** · `#guest` → `on_camera` (yes/no)
> *"14 of your last 20 shortlists post video. Worth filtering on."*
> [ Add it ] [ No ]

Approved → written to the collection file. Rejected → recorded with a reason, and the agent is told. **Never silent.** See `04_AGENT_CONTRACT.md` §4.
