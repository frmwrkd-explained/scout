# 12 — Directive protocol and the chat card framework

**What to build:** The structured channel that lets the agent place rich, canonical
content in the conversation without restating it. One convention: the agent emits
fenced directive blocks (a single `frameforge` JSON fence, taught by the router
skill) containing typed refs — e.g. generation ids, shot ids, style-lock ids, a
proposal payload. The backend detects directives in the stream, persists them as
typed message parts, and re-emits them as directive events. The frontend gains a
card registry: directive type → card component. Cards fetch and render the
canonical record (they never trust prose). Ship the first two cards: a style-lock
card (name, ref image, axis summary, "set as project style" action) and a shot-ref
card (shot number/title/status, open-in-shot-workspace action). Malformed
directives degrade to visible raw text, never a crash.

**Blocked by:** 10 — Router skill; 11 — Chat UI shell.

**Status:** done — 2026-07-19

- [x] An agent reply containing a directive fence renders a card in place of the fence, streamed text around it intact
      — `backend/agentRunner.mjs` `parseDirectives()` rewrites each fence to a positional marker
      `⟦frameforge:N⟧`; `frontend/chat/directives.jsx` `renderMessageBody()` splits the persisted prose on
      the marker and interleaves cards inline (used by `frontend/Chat.jsx` `renderMessage`).
- [x] Cards render from fetched canonical records; directives carry ids, not content — both cards read
      `directive.ref` (id) and fetch: style via `api.styleLocks()`, shot via `api.story(pid)`. See
      `frontend/chat/cards.jsx`.
- [x] Style-lock card and shot-ref card work end-to-end including their actions — style: "set as project
      style" → `api.patchProject(pid,{styleLock})`; shot: "open in shot workspace" → `app.openProj(pid,'story')`.
- [x] The router skill documents the directive grammar (`backend/skills/frameforge-router/SKILL.md`,
      the `frameforge` fence + show/proposal/progress/confirm categories — wired, not edited).
      ~~a real session produces a valid directive when asked to show a style~~ — LIVE-RUN ONLY: verified
      instead with a stub CLI scripting a `show.style` fence (`tests/fixtures/stub-claude-directive.mjs`),
      which drives the same detection/SSE/persistence path a real Claude turn would.
- [x] Malformed directive JSON renders as plain text with a subtle warning (`malformed` directive +
      `MalformedDirectiveCard`); `tests/phase-directive-protocol.test.mjs` covers detection/parsing/
      persistence — well-formed, malformed, multiple fences, and fence-across-stream-chunk-boundaries.
