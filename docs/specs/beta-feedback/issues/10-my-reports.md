# 10 — My reports: status back to the reporter

**Status:** resolved
**Blocked by:** 06, 07

The part every internal feedback tool forgets, and the reason testers stop reporting.

A **My reports** list in the panel, polled by code from `GET /api/report/:code`:
`triaged` · `issue #41` · `fixed in 0.1.4`. Codes are held in `ui-state.md` (the
existing non-sensitive UI-state store), so the list survives restarts without a new
datastore.

When an Issue closes, the report becomes `fixed` and the app says so the next time it
opens — a small, quiet line, not a modal.

`needs-more-info` surfaces the AI's `missingInfo` as a question the reporter can answer
in place, which appends to the report and re-triages once.

## Done when

A sent report appears immediately as `received`, moves to `triaged` and then `filed`
with a clickable issue link, survives a restart, and a closed issue shows `fixed`.
