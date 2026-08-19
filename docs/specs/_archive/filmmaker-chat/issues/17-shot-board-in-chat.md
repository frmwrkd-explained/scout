# 17 — Shot breakdown and shot board inside the chat

**What to build:** Story development as a conversation. The agent asks about the
story (or ingests an attached script/treatment), runs the existing story-breakdown
route, and the resulting shot list appears as an inline shot-board card: rows with
shot number, title, type, duration, status, assigned cast/loc/look chips, and the
selected candidate thumbnail via the shared media components. The card supports
inline edits (reorder, retitle, retype, status) through existing shot routes and
opens the full shot workspace on demand. Breakdown proposals are staged — the user
confirms before shots are written — and subsequent agent refinements patch shots by
id rather than regenerating the list.

**Blocked by:** 12 — Directive protocol; 15 — Chat tools registry (ships as the shot-board registry entry).

**Status:** done

- [x] "Break my story into shots" in a real session yields a staged breakdown card; confirming writes the shots — confirm-write path (`proposal.breakdown` round-trip → POST /api/story/:pid/shots per shot) verified hermetically (`tests/phase-shot-board.test.mjs`); the "real session" rendering is **live-only** (React card, build-verified)
- [x] The shot-board card mirrors canonical shot records live, including cast/loc/look chips and candidate thumbs — card fetches via `api.story` and resolves the candidate thumb from canonical app state (never directive prose); the visual mirror is **live-only** (React, build-verified)
- [x] Inline edits persist through existing shot routes; the story tab reflects them — retitle/status/type via `api.patchShot`, reorder via `api.reorderShots`; persistence verified hermetically
- [x] Agent refinement ("make shot 30 a close-up") patches the single shot by id — documented in `CORE_API_ROUTES` (PATCH /api/story/:pid/shots/:id); the agent-side drive is **live-only**
- [x] Disabled tool → no breakdown offer, no card — every shot-board directive type (incl. `proposal.breakdown`) is owned by the `shot-board` registry entry (defaults OFF) so the registry shows the enable-notice when disabled; verified in `tests/phase-shot-board.test.mjs`

**Implemented (2026-07-19):** new `frontend/chat/shotBoardCard.jsx` (live `ShotBoardCard` + staged
`BreakdownProposalCard`, registered once via `registerToolCard('shot-board', …)`), imported for side
effect from `frontend/chat/cards.jsx`. Refined the `shot-board` entry in `shared/chatTools.mjs`
(capability/invocation/directiveTypes — added `show.shots` + `proposal.breakdown`). Added the
breakdown + single-shot-patch lines to `backend/agentHome.mjs` `CORE_API_ROUTES`. Tests in
`tests/phase-shot-board.test.mjs`. Full suite green (157), `npm run build` green.
