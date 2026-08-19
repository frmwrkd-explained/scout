# 11 — Chat UI shell: sessions, streaming messages, composer

**What to build:** The chat surface itself, mounted as a tab inside a project. A
session sidebar (list, new session, rename, archive, checkpoint/branch access); a
message list that renders streamed text live (subscribing to the session SSE) with
markdown rendering and slots where directive cards will mount (ticket 12); a
composer with multiline input, send/cancel, and the Agent/Manual mode switch
(Agent default — Manual behavior arrives in ticket 19, the switch itself lands
here); and the agent setup state (install/login prompts) when no CLI is present.
Visual language follows the existing app (dark console aesthetic, keyboard-first
where sensible).

**Blocked by:** 08 — Chat session backend; 09 — Streaming agent runner.

**Status:** implemented — `npm run build` green; behavioral criteria await dev-server verification

- [ ] From a project I can create a session, send a message, watch the reply stream token-by-token, and see history restored after reload
- [ ] Session list supports rename, archive, and branching from a checkpoint
- [ ] Cancel visibly stops a streaming turn
- [ ] Mode switch renders (Agent active, Manual present but inert until ticket 19)
- [ ] No agent CLI → the shell shows the setup state with working install/login actions instead of an error

## Implementation notes (ticket 11)

- **New files:** `frontend/Chat.jsx` (the surface), `frontend/chat/directives.jsx` (the
  directive-card mounting seam consumed by ticket 12).
- **Edited:** `frontend/App.jsx` (mount `chat` project tab + key `6` + cheat-sheet row),
  `frontend/styles.css` (append-only chat classes), `frontend/api.js` (untouched — every
  wrapper already existed).
- **Streaming model:** `messages` = persisted transcript (refetched at each turn boundary);
  `live` = the in-flight turn only (streamed text + directives). EventSource on
  `chatStreamUrl`, named-event listeners for turn-started/text-delta/directive/turn-done/
  turn-cancelled/error; auto-reconnect reconciles via a refetch on the second `hello`.
- **Directive seam:** `renderDirective(directive, ctx)` in `frontend/chat/directives.jsx`.
  Ticket 12 calls `registerDirectiveRenderer(type, fn)` — no Chat.jsx edit. `ctx` is
  `{ app, pid, session, message | live }`. Unregistered types render a neutral pending card.
- **Setup state:** when `session.executor === 'simulate'` (no CLI) the shell shows a panel
  wrapping the app's existing `renderAgentWizard()` (install / sign-in / test), not an error.
  Simulated turns still stream normally.
- **Deferred by design:** Production Panel (13), real cards (12), Manual form (19, switch is
  inert here), cost surfacing (22), attachments (18), standalone top-level nav entry (24).
