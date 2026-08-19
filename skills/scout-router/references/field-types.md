# Field types — the legal set

When proposing a collection or a field, the `type` **must** be one of these. Anything else is rejected with a 400.

| Type | Options | Use it for |
|---|---|---|
| `text` | `multiline` | The default |
| `number` | `display: plain\|bar\|stars\|currency`, `min`, `max`, `precision` | Scores, counts, money. `display` is why there is no separate rating type. |
| `select` | `options[] {value, colour}` | One choice, coloured chip |
| `multiselect` | same | Tags, categories |
| `status` | `options[] {value, colour, group: todo\|active\|done}` | **Not the same as `select`.** The `group` drives board columns and completion counts. One per collection may be the gated field. |
| `date` | `display: absolute\|relative\|freshness`, `time` | `freshness` renders the decay bar |
| `checkbox` | — | Yes/no |
| `url` · `email` · `phone` | — | Render as actions, not strings |
| `relation` | `target`, `many`, `inverse` | A link to another document. `inverse` creates the backlink. |
| `rollup` | `via`, `target_field`, `fn: count\|sum\|avg\|min\|max\|latest` | Aggregate over a relation. **Use this instead of a number you would have to keep updating.** |
| `formula` | `expr` | Pure, no I/O. Prefer a rollup. |
| `file` | `many` | Screenshots, PDFs |
| `actor` | `kinds: [human, agent]` | Assignee — who is doing this |
| `json` | — | Last resort |

Never proposed, always present: `created`, `updated`, `created_by`, `updated_by`, `verified_at`, `proposed`, `quarantined`.

## Rules

- Exactly one field is `primary: true` — the document's title.
- **Prefer a `rollup` over a `number`** whenever the value can be derived. A typed number goes stale; a rollup cannot.
- Never propose changing an existing field's type on live data. Propose a new field instead.
- Every proposal carries a `why` with evidence — *"14 of the last 20 shortlists post video"* — never an opinion.
