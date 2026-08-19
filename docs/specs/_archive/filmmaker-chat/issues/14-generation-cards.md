# 14 — Inline generation cards with live status

**What to build:** When the agent (or manual mode later) starts generations, they
appear as inline cards in the conversation: prompt summary, model, kind, cost, live
status (queued → running → done/failed) driven by the existing SSE/activity flow,
and the finished media rendered through the shared RenderMedia/RenderTile with the
shared lightbox. Batch directives render as a compact grid card (e.g. 9 thumbnails
for a storyboard batch) rather than 9 separate cards. Cards offer: open in
generate/review, save to shot, reroll. The router skill is extended so the agent
emits a generation directive per started batch instead of describing results in
prose.

**Blocked by:** 01 — Shared media components; 12 — Directive protocol.

**Status:** done

- [~] Asking the agent for an image in a real session yields a card that goes queued → running → done and shows the render inline — *plumbing verified hermetically (directive round-trip test + build); the queued→running→done transition rides the existing revision-SSE/app-state refresh (mirrors ProjectGenerate, no new fetch/stream). The end-to-end "real session with a live provider" pass needs a live run.*
- [x] Failed generations show the error on the card with a retry action — `GenerationCard` renders `gen.error` and a Retry chip (`api.rerollCandidate`)
- [x] A multi-variant/batch generation renders as one grid card; each cell opens the shared `RenderLightbox` with ←/→ nav — `GenerationGridCard`
- [x] Card actions (open in review, save to shot, reroll; batch retry-failed) go through existing api wrappers (`saveGenToShot`, `rerollCandidate`, `retryBatch`) and `app.sync()` reflects the canonical records back
- [x] Costs on cards come from the generation records' ledgered `cost` field (single card and summed batch spend), the same numbers `ledger()` logs

**Implementation:** `frontend/chat/generationCards.jsx` (new; registered as CORE directive renderers,
imported for side effect by `frontend/chat/cards.jsx`). Live status reads `projects[].gens` from app
state — the same source ProjectGenerate uses. `backend/agentHome.mjs` `CORE_API_ROUTES` gained
`GET /api/generations/:pid`, `POST /api/batches/estimate`, `POST /api/batches` so the router skill can
start generations/batches and reference them by id. Test: `tests/phase-generation-cards.test.mjs`
(+ `tests/fixtures/stub-claude-generation.mjs`). Router SKILL.md unchanged — generation directives are
core grammar, nothing to edit there.
