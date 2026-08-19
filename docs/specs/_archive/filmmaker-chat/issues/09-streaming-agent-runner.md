# 09 — Streaming agent runner with resume and CLI fallback

**What to build:** Upgrade the agent runner (currently one-shot `-p` spawn in the
jobs module) into the chat turn executor. For Claude Code: spawn with streaming
JSON output and partial messages, parse the stream into the typed events of ticket
08, and resume the same underlying CLI session id turn-over-turn so conversation
state lives in the CLI, not in re-sent transcripts. For CLIs without resume/stream
(Codex, Gemini via the existing agentCommand setting): degrade to one-shot per turn
with a compact transcript tail prefixed to the prompt, still emitting the same
event types (whole-message instead of deltas). Simulate mode (ticket 08) remains
when no CLI is installed, and the existing agent status/install/login routes power
a setup state. Tool permissions are scoped per session (allowed-tools flags), and a
running turn can be cancelled.

**Blocked by:** 08 — Chat session backend.

**Status:** done

- [x] With Claude Code installed, a multi-turn conversation streams token deltas and retains context across turns via CLI-side resume
      — `backend/agentRunner.mjs` spawns `claude --output-format stream-json --include-partial-messages --verbose -p`, parses NDJSON into `text-delta`/`tool-call`/`tool-result`/`directive` events, captures the CLI `session_id` and passes `--resume <id>` on the next turn (persisted on the session record by `chat.mjs runTurn`). Verified end-to-end against a stub (`tests/fixtures/stub-claude.mjs`): turn 1 streams ≥2 deltas + persists `cliSessionId`, turn 2 proves the resume id reached the CLI. `claude` 2.1.205 IS on PATH, but the automated suite exercises the stub (no paid round-trip); the stream shape matches the CLI's documented stream-json interface.
- [x] With a non-resuming agentCommand, turns still work one-shot with transcript-tail context and identical event types — `runOneShot` prefixes `transcriptTail(history)` to `-p`, emits the whole reply as one `text-delta` + `turn-done`. Verified with `tests/fixtures/stub-agent.mjs`.
- [x] Cancel stops the spawned process and emits a terminal event; the partial message is persisted and marked cancelled — `POST /api/chat/sessions/:id/cancel` → `cancelTurn()` aborts an `AbortController`; the executor SIGTERM→SIGKILLs its child, returns the partial; `runTurn` persists it with `cancelled: true` and broadcasts `turn-cancelled`. Verified (mid-stream cancel).
- [x] No CLI installed → session opens in setup/simulate state, surfacing install/login actions instead of failing — `createSession` picks `simulate` when `findAgent()` is null; the mid-session safety net in `cliExecutor` emits a `setup` event and returns a helpful message rather than throwing. The existing `/api/agent/status|install|login` routes still power the wizard.
- [x] Runner is faked behind a stub command in tests; node --test covers stream parsing, fallback prompting, and cancel — `tests/phase-agent-runner.test.mjs` (11 subtests: pure helpers + 3 integration flows). Full suite green (92 pass).
