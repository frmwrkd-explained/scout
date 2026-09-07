# API mode — the app is running

Base: `http://127.0.0.1:5177`

## Read

| Route | Returns |
|---|---|
| `GET /api/context` | **Your whole wake-up read.** Under 2,000 tokens. |
| `GET /api/cache/version` | One integer. Cheap. If unchanged since your last run, your cached context is still valid. |
| `GET /api/index` | Capabilities: collections, their fields, enabled tools, active project |
| `GET /api/territory/:id` | A group's rules, access state, post history |
| `GET /api/playbook/:id` | One playbook body — only the ones the context named |
| `GET /api/search?q=` | Records and memory. Free text plus typed filters — `collection:guest status:shortlist`, `type:territory`, `tag:manila`. Never list `data/` in bulk. |

## Write

```bash
curl -s -X POST http://127.0.0.1:5177/api/records/upsert \
  -H 'content-type: application/json' \
  -d '{"collection":"guest","name":"Maria Santos","handle":"@mariacooks",
       "platform":"instagram","found_in":"nurses-ph","score":9,
       "source":"https://instagram.com/p/xyz",
       "why":"Nurse turned cook. Tells her own story, no brand deals in 40 posts."}'
```

**Read the verdict.** It comes back as `verdict`, alongside `id`, `path` and `confidence`:

```json
{ "verdict": "store", "id": "maria-santos", "path": "data/guests/maria-santos.md", "confidence": 0 }
```

| `verdict` | Meaning |
|---|---|
| `store` | genuinely new, a record was created |
| `update` | merged into an existing record — the id is in the response |
| `merge` | two records were the same person and were combined |
| `skip` | already known, nothing new. **Do not try again.** |

**A `store` lands in front of them as a card. You do not need to post a finding card as well** —
`POST /api/records/upsert` raises it for you and returns its id in `card`. Proposing a second one
puts the same person in their queue twice. `update`, `merge` and `skip` raise nothing.

| Route | Use |
|---|---|
| `POST /api/records/batch` | 20–50 findings in one call. Use this when sweeping. Answers `{tally, results:[{verdict, …}]}`. |
| `POST /api/records/match` | Dry run — would this be a duplicate? Writes nothing. Answers `{matches:[…]}`. |
| `POST /api/records/:id/move` | Only as far as `shortlist`. Anything further returns **403**. |

## Propose

| Route | For |
|---|---|
| `POST /api/learnings/propose` | `{claim, evidence[], scope}` |
| `POST /api/collections/propose` | a new collection |
| `POST /api/fields/propose` | `{collection, key, type, options, why}` — `why` is mandatory and shown to them |
| `POST /api/territory/propose` | `{id, label, kind, url, why}` — `why` is mandatory. Nothing is written to `territory/`; it becomes a card, and accepting it means you may **ask** to join |
| `POST /api/outbound/propose` | `{channel, territory, body}` — the exact wording |
| `PUT /api/views/:collection` | **allowed without approval.** Views are cheap and reversible. |

## Facts you may write directly

| Route | For |
|---|---|
| `PATCH /api/territory/:id` | `last_swept`, `access`, `access_changed`, `rules`, `posted[]` |
| `POST /api/tasks/:id/claim` | answers `{won: true}` with **200** when you got it, and `{won: false, reason, assigned}` with **409** when somebody beat you. A 409 here is not an error to retry — **back off and take another task.** |
| `POST /api/runs` | your own activity, so they can see what you did without asking |

Never `PATCH` `finds`, `wins` or `hit_rate` — they are computed from records.
