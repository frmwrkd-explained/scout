# T02 · Collections and field types
**Milestone:** M1 · **Reads:** `docs/02_DATA_MODEL.md` §1–2

## Do
1. `backend/collections.mjs` — the **only** definition of a field type. Export `FIELD_TYPES` exactly as the doc lists: `text · number · select · multiselect · status · date · checkbox · url · email · phone · relation · rollup · formula · file · actor · json`.
2. Read/write collection schemas at `.scout/collections/<id>.md` (frontmatter is the schema).
3. Validate on write: one `primary`, at most one `gate: true` status field, relation targets exist, options well-formed. Reject an unknown type with a 400 **naming the legal set**.
4. Auto fields on every document: `created · updated · created_by · updated_by · verified_at · proposed · quarantined`.
5. `rollup` and `formula` evaluate on read into `.scout/cache/computed.json`. **Frontmatter always wins over the computed cache** — assert it in a test.
6. Routes: `GET/POST/PATCH /api/collections`, `POST /api/collections/:id/fields`.

## Demonstrate
Create the `guest` collection from the doc via curl. Add a `rollup` counting related findings; change the underlying data; the rollup follows. Write a conflicting value into frontmatter; frontmatter wins.
