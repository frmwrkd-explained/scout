# T03 · Documents, queries and saved views
**Milestone:** M1 · **Reads:** `docs/02_DATA_MODEL.md` §1, §3, §5

## Do
1. `backend/documents.mjs` — resolve a collection's `query` (tag · path · frontmatter filter) to a document set. A document may match several collections; it is never "moved into" one.
2. `backend/views.mjs` — CRUD over `.scout/views/<collection>.json`. Filter, sort, group, visible fields, card fields, density.
3. **Default view inferred from shape**, per the doc: status→board, date→list, primary media→gallery, else table. Never ask a new user to pick.
4. Subtables: a collection plus a bound parameter (`bind: { guest: $self }`). One mechanism, no second storage.
5. Routes: `GET /api/collections/:id/documents?view=`, `GET/POST/PUT /api/views`.

## Demonstrate
Two saved views over one collection return different rows. A subtable on a guest lists only that guest's messages. Delete `.scout/cache/` — everything still resolves.
