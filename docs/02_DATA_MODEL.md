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

**What a person calls it, and how it is recognised.** A collection is a *kind of thing* — Companies,
People, References — and is shown by its `label` with a coloured dot, never as `#id`:

| Key | Meaning |
|---|---|
| `id` | lower-kebab, starts with a letter. The file name, the default folder (`data/<id>/`), and what relations point at. It does not change when the collection is renamed. |
| `label` | the name a person reads. Renaming a collection changes only this. |
| `colour` | one of `red` · `orange` · `amber` · `green` · `teal` · `blue` · `violet` · `pink`, or absent. Absent means "automatic": a stable pick from the `id`. |

A person makes one from the sidebar (`+ New collection` → `POST /api/collections/create { label }`):
`id` is the slug of the name, the query is `path: data/<id>/**`, and it starts with one field, `name`.
An assistant still *proposes* a collection as a card (§6); these routes refuse an agent.

## 2. Field types — the set, and why exactly these

Chosen by looking at what Notion, Airtable, Heptabase and Tesseract actually converged on, then cutting everything that does not earn its place in this app.

| Type | Options | Why it exists here |
|---|---|---|
| `text` | `multiline` | The default. |
| `number` | `display: plain \| bar \| stars \| currency`, `min`, `max`, `precision` | `display` is why we don't need a separate "score" or "rating" type. |
| `select` | `options[] {value, colour}` | Single choice with a colour chip. |
| `multiselect` | same, **optional** | Tags, categories. With no `options[]` it is an **open vocabulary** — the next tag is legal because the person typed it. `select` and `status` still require a fixed set. |
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

**How a view looks is part of the view.** Besides its query (`filter`, `sort`), a view carries
optional display keys. They are written by the view bar and may be written by an agent; both go
through `PUT /api/views/:collection`, which refuses a wrong value by name. `frontend/viewDisplay.js`
is the one reader, so all four layouts agree on what each key means and what it defaults to.

| Key | Values | Meaning | Default |
|---|---|---|---|
| `type` | `table` · `list` · `board` · `gallery` | the layout (`gallery` is labelled Cards) | inferred from the collection's shape |
| `size` | `s` · `m` · `l` · `xl` | how big rows, cards and their text are | `m` (an older `density` is still read) |
| `fields` | `[key, …]` | the properties shown, in order: table columns, list values, card lines | the first six fields |
| `cover` | a `file` field key, or `false` | the picture that leads a row or card | the `primary_media` field |
| `fit` | `contain` · `cover` | whole picture, or fill the frame | `contain` |
| `summary` | `true` · `false` | show the note's first paragraph | on for lists, off elsewhere |
| `wrap` | `true` · `false` | let long values take several lines | `false` |
| `group` | a field key, or `null` | section the rows by that field (a date groups by day) | none; a list with a date field groups by day |
| `widths` | `{ key: px }` | table column widths | sized to content |

`GET /api/views/:collection?counts=1` adds `{ counts: { viewId: n }, total }`, counted in one read
of the store.

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

## 4. Sub-collections (subtables)

A **sub-collection** is a collection whose records each belong to a record of another collection.
People belong to a company; shots belong to a project. It is **a collection with a bound
parameter** — no new concept, no new storage.

Two things say it, and they are the two ends of one edge:

```yaml
# .scout/collections/people.md — the CHILD carries a relation to its parent
fields:
  - { key: name,    type: text, primary: true }
  - { key: company, type: relation, target: company }

# .scout/collections/company.md — the PARENT declares the subtable
subtables:
  - { id: people, label: People, collection: people, bind: { company: $self } }
```

`bind` names the child's relation field; `$self` is the parent record being looked at. A relation
stores the **slug** of the record it points at (`company: acme`), so the question "who is at Acme"
is `GET /api/collections/people/documents?all=1&bind={"company":"acme"}`.

What a person gets from it:

- **On the company's page**, under the note: a *People* section listing every person whose
  `company` is this one, and `+ New in People`, which creates a person with `company` already set.
- **On a person**: the company is a chip that opens it.
- **In the People collection**: Group or Filter by `company` like any other field.
- **In the sidebar**: People sits one step in under Companies. A collection nested under two
  parents is listed under each.

Made from the sidebar (a collection's ⋯ → *Add sub-collection*), through routes only a human may call:

| Route | Body | Does |
|---|---|---|
| `POST /api/collections/:id/subcollections` | `{ label }` | creates the child collection with a relation to `:id`, and adds the subtable |
| | `{ collection }` | nests an existing collection: reuses its relation to `:id` if it has one, else adds one. Doing it twice changes nothing. |
| `DELETE /api/collections/:id/subcollections/:child` | — | removes the subtable entry only. The child, its relation field and every record stay. |
| `PATCH /api/collections/:id/meta` | `{ label?, colour? }` | renames or recolours; nothing else |

A loop is refused (a collection cannot sit inside something it contains). An assistant proposes a
subtable as a card instead (§6) — both paths write the same two things. The shape rules live in
`shared/collectionShape.mjs`, read by the backend, the sidebar and the record page alike.

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

## The whiteboard file

`projects/<id>/board.md` holds `nodes` and `links` in frontmatter and an append-only log in the
body. A node is `{ id, t, x, y, w, h }` plus its kind's keys:

| kind | keys |
|---|---|
| `text` | `text`, `size: s|m|l|xl`, `bold`, `colour`, `fixed` |
| `note` | `text`, `colour` (or a legacy `tone`) |
| `shape` | `shape: rect|round|ellipse|diamond`, `text`, `colour`, `size` |
| `draw` | `points: "x,y x,y …"` (relative to its box), `width: 2|4|8`, `colour` |
| `image`, `frame` | as before |
| a record | `path` |

`colour` is a hue NAME (red, orange, amber, green, teal, blue, violet, pink), never a value.

A link is `{ id, from, to, label?, ends: none|arrow|both, line: solid|dashed, colour? }` between
two node ids; a link whose node is gone is dropped on save. **Links are stored; edges are not** —
edges are derived on every read from the records' relation fields. A drawn link between two
records can be turned into the relation it stands for by a person only
(`POST /api/scout/board/:id/links/:link/realise`): `records.mjs` writes the record, the link is
removed, and the derived edge replaces it. `GET /api/scout/board/:id/describe` returns the board
in words, for an agent.

