# 20 — Project understanding on open, learnings on close

**What to build:** Sessions start smart and end smarter. Session start injects the
project brief and the memory hot-cache into the agent's context (the existing
memory pattern) — visible to the user as the Production Panel's "project
understanding" section, so what the agent knows is inspectable. Session end
(explicit close or idle threshold) runs a cheap distillation turn that extracts
durable learnings — creative decisions, locked directions, corrections the user
made — and appends them to project memory through the existing memory append
route, deduplicating against what's already there. The next new session in that
project demonstrates continuity without the user re-explaining. A settings toggle
disables auto-distillation; a manual "save learnings now" action exists in the
session menu.

**Blocked by:** 10 — Router skill; 11 — Chat UI shell.

**Status:** done

- [x] A new session's first reply demonstrates knowledge of brief + memory without the user pasting context — `chat.mjs` `projectUnderstanding()` builds a `<frameforge-project-understanding>` block (brief + memory hot-cache) and `runTurn()` passes it to the executor as `ctx.projectContext` on the first turn. Verified in tests that the assembled context contains the brief + memory (capture-executor stub) and equals `projectUnderstanding()`. NOTE: the "first *reply* demonstrates knowledge" end-to-end depends on a live Claude subscription; the real-CLI wiring is a one-line edit in `agentRunner.mjs` (see report — outside my file scope, reported not made). The `simulate` executor already acknowledges the injected context so it's demoable keyless.
- [x] Closing a session appends concise learnings to project memory — `POST /api/chat/sessions/:id/close` (distill.mjs) runs the distiller when `chatAutoDistill` is on and appends via `appendLearnings()`. Inspectable through `GET /api/chat/sessions/:id/understanding` and the existing `GET /api/memory/:pid` route.
- [x] Re-running distillation does not duplicate existing memory entries — `memory.mjs` `appendLearnings()` dedupes on normalized-equality + Jaccard ≥ 0.85 (case/punctuation/stamp-insensitive). Tested with punctuation/case variants → 0 added.
- [x] Auto-distill can be toggled off; manual save-learnings works regardless — `chatAutoDistill` setting gates close + idle sweep; `POST .../distill` always runs (force). Settings toggle added to `frontend/Settings.jsx` Claude section. Tested.
- [x] node --test coverage for the distillation append/dedupe path with a stubbed agent — `tests/phase-memory-distill.test.mjs` (6 tests, distiller stubbed via `setDistiller`, no network). All green.
