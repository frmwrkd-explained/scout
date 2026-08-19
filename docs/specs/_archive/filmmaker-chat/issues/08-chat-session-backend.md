# 08 — Chat session backend: records, routes, streaming channel

**What to build:** A new chat route module (registered like the other route
modules) giving FrameForge durable, resumable chat sessions. Sessions are markdown
records following the store's conventions: a session file (frontmatter: id, project
or standalone scope, title, mode, agent command used, created/updated, checkpoint
list) plus an append-only messages record per session (role, timestamp, text,
directive payloads, attachment refs). Routes: list/create/rename/archive sessions,
fetch a session with messages, post a user turn, create/restore a checkpoint
(branching a session at a turn), and a per-session SSE stream endpoint following
the activity-feed SSE pattern that emits typed events (turn-started, text-delta,
directive, turn-done, error). For this ticket the turn executor is the simulate
path only (scripted echo), so the whole loop is testable without an agent CLI —
the real runner is ticket 09.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Sessions and messages persist as markdown records under the project dir (or workspace-level for standalone) and survive restart — `backend/chat.mjs`; session `<id>.md` + append-only `<id>.messages.md` under `projects/<pid>/chat/` or workspace `chat/`. Test reads the `.messages.md` record directly (restart-equivalent) and asserts both messages persisted.
- [x] Posting a turn in simulate mode streams text-delta events over the session SSE and appends both messages durably — `runTurn()` (chat.mjs); `simulateExecutor` streams word-chunk deltas; `POST /api/chat/sessions/:id/turn` + `GET /api/chat/sessions/:id/stream`.
- [x] Checkpoints record a turn boundary; restoring one starts a branched session containing history up to that point — `createCheckpoint()` / `restoreCheckpoint()` (branches a new session, `branchedFrom` set, source untouched).
- [x] All session routes are exposed through the frontend api wrapper — `frontend/api.js`: `chatSessions/chatSession/createChatSession/patchChatSession/archiveChatSession/chatTurn/chatCheckpoint/restoreChatCheckpoint/chatStreamUrl`.
- [x] node --test coverage under temp FRFG_DATA: create → turn → SSE event order → persistence → checkpoint branch — `tests/phase-chat.test.mjs` (4 tests). Full suite: 81/81 pass.

**Executor boundary (for ticket 09):** `registerExecutor(name, fn)` in `backend/chat.mjs`. An executor is `async ({ session, loc, history, userText, attachments, emit }) => ({ text, directives, cost })`; it calls `emit({ type:'text-delta', text })` / `emit({ type:'directive', directive })` (and may emit pass-through types like `tool-call`). `runTurn` owns persistence + the SSE envelope (`turn-started`/`turn-done`/`error`). This ticket ships only `simulate`; ticket 09 registers a `cli` executor and sets `session.executor`. No gating/integration-switchboard wiring here (ticket 24).
