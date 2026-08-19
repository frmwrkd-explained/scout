# 21 — Review integration: one triage state across chat and inbox

**What to build:** Chat and the review inbox share one review state. Generation
cards (single and grid) expose keep/reject/rating controls writing the same
reviewState/rating fields the review inbox uses; triage done in the inbox reflects
back onto chat cards live. A batch card offers "review these" which opens the
review inbox scoped to that batch; returning to chat shows the outcome summary
(kept n / rejected m) on the card. The agent is taught (router skill) to consult
review outcomes by id when deciding next steps ("re-render the rejected ones with
the new look") instead of asking the user to restate them.

**Blocked by:** 14 — Generation cards.

**Status:** done

- [x] Keep/reject on a chat card is visible in the review inbox and vice versa, without reload
  — Both surfaces write the SAME record via one route (`api.reviewCandidate` → PATCH
  `/api/generations/:pid/:id/review`, body `{ patch }`) and read it back from the same list
  (`/api/generations/:pid`, mirrored into `/api/state` `projects[].gens`). No parallel chat-side
  state. Live reflection rides the existing generations-domain revision SSE (index.mjs middleware
  bumps on every 2xx `/api/generations*` write → App.connectEvents re-syncs → both re-render).
  Record-level propagation is asserted in `tests/phase-review-integration.test.mjs`; the no-reload
  visual reflection is the pre-existing SSE path (live-only, per ticket-14's card note).
- [x] "Review these" opens the inbox scoped to the batch; the card summarizes the outcome afterwards
  — Grid card `openBatchReview()` builds the batch's done-candidate keys and calls
  `app.openInbox(pid, { keys })` (new additive explicit-keys scope in App.openInbox). The card's
  header shows `kept n / rejected m` computed live from the records.
- [x] The agent can enumerate kept vs rejected generations of a batch via the API in a real session
  — `GET /api/generations/:pid` returns `reviewState`/`rating`/`batchId` per gen; CORE_API_ROUTES
  summary now tells the agent to filter by `batchId` to enumerate kept vs rejected. Enumeration
  asserted hermetically; the "real session" wording is live-only (needs a running agent).
- [x] Ratings set in either surface agree everywhere the generation is shown
  — Chat card `ratePatchFor` sends byte-identical patches to App.ibRate (`{ rating, reviewState }`);
  both read `g.rating` off the same record. Asserted in the test file.
