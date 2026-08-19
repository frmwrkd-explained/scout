# 07 — Convex: schema, mutations, signature dedupe, http routes

**Status:** resolved
**Blocked by:** None — can start immediately.

In `landingpage/backend/convex/`, matching that deployment's house style: plain
JavaScript (the repo bans TypeScript), and comments that say **why**.

Three tables:

- `reports` — the envelope plus `code`, `signature`, `status`
  (`received|triaged|filed|answered|fixed|triage-failed`), `verdict`, `issueUrl`,
  `occurrences`, timestamps.
- `reportOccurrences` — one row per repeat hit of a known signature. Cheap, and it is
  what turns "twenty testers, one crash" into one issue with a count.
- `reportEvents` — the audit trail: received, deduped, triaged, filed, closed.

`POST /api/report` on the existing `httpRouter`, following the `/api/lead` pattern in
`http.js` (including the per-path OPTIONS handler — Convex matches exact paths).
`GET /api/report/:code` returns status for ticket 10. Both need the same CORS block.

**Dedupe runs before triage, always** (spec §8). A signature match appends an
occurrence, bumps the count, and returns — no model call, no second issue. The
threshold comment on the Issue fires at 5, 25 and 100 only.

## Done when

Two identical reports produce one row with `occurrences: 2` and exactly one triage
call; a novel signature schedules triage; screenshot upload URLs work; `.gitignore`
still covers everything it did.
