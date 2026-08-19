# 22 — Cost surfacing in the chat

**What to build:** Spend is always visible while directing. Each generation card
shows its cost (already on cards from ticket 14); the session header aggregates
total generation spend for the session, and a pre-flight estimate appears on batch
directives before confirmation ("9 storyboard frames on <preview model> ≈ $x —
proceed?") using the catalog cost data and the existing batch-estimate route where
applicable. The router skill instructs the agent to route batches ≥ a threshold
through a confirm-with-estimate directive rather than firing immediately. Session
spend also lands in the existing cost ledger attributed to the session.

**Blocked by:** 14 — Generation cards.

**Status:** done

- [x] Session header shows running generation spend for the session, matching the ledger
      — `Chat.sessionSpend()` sums the ledgered `cost` of this session's finished generations
      (records tagged with `sessionId`), rendered as a chip in the session header (hidden at $0).
- [x] Batch directives above the threshold render an estimate + confirm card before anything runs
      — `confirm.batch` directive → `frontend/chat/confirmCard.jsx`: estimate via
      `POST /api/batches/estimate` (catalog `estCost` fallback), Proceed fires `api.createBatch`
      (with the session id) and swaps in place to the live ticket-14 batch grid card.
- [x] Declining a confirm card runs nothing and tells the agent so
      — Decline appends a compact `Declined: …` system event (`api.chatSystemEvent`) and queues nothing.
- [x] Costs page can attribute spend to chat sessions
      — the ledger `ref` now carries ` · chat:<sessionId>` (`generate.mjs ledgerRef`); it renders in
      the Costs ledger row as-is, and `App.projSpend` strips the suffix so per-project totals are intact.

Attribution field: generation records + batch records gain a `sessionId` (null outside chat). Set
from manual mode (`ManualComposer` → `api.generate`/`api.createBatch`), the confirm-card Proceed
(client-side), or any agent call that passes `sessionId` (documented on the `/api/generate` +
`/api/batches` core-API routes). `run()` writes it into the ledger `ref` via `ledgerRef()`.

Live-only note: the confirm-card estimate/Proceed/Decline UI and the session-spend chip are exercised
in the running app; automated coverage (`tests/phase22-cost-surfacing.test.mjs`) asserts the
backend seams they drive — `sessionId` on records + ledger ref, the batch-attribution round-trip, and
the decline system-event/no-queue behavior.
