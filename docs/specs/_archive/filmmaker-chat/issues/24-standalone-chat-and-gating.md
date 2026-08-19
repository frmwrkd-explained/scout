# 24 — Standalone chat, navigation, and final gating polish

**What to build:** Chat as a first-class destination. A top-level nav entry opens
standalone chat: sessions not bound to a project, with a "promote to project" flow
(the agent can create a project mid-conversation and the session re-binds to it,
Production Panel appearing once bound). The per-project chat tab (ticket 11) and
standalone surface share all components. Final gating pass: the chat integration
module cleanly hides every chat surface when off; with chat ON but all chat tools
OFF (hackathon demo posture) the experience is coherent — core conversation,
generation cards, Production Panel, storyboard workflow reduced to what core
routes allow — and a settings hint explains what enabling tools adds. Electron
build verified: chat works in the packaged app.

**Blocked by:** 13 — Production Panel; 15 — Chat tools registry; 19 — Manual mode.

**Status:** done — 2026-07-19. Standalone chat destination, promote-to-project bind route, and the
final gating pass shipped. Verified in the browser (nav entry + standalone rail render, no console
errors) and via Electron launch (bundled backend booted, app ran without crashing).

- [x] Standalone chat opens from the top-level nav without a project; promote-to-project binds the session and reveals the panel
      — nav entry `frontend/App.jsx` (renderTop + page route, both gated by `(S.modules||{}).chat !== false`);
      `Chat` mounts with `pid={null}` → Production Panel replaced by the STANDALONE hint rail
      (`frontend/Chat.jsx renderStandaloneRail`), attachments already off, Manual disabled with a hint.
      Promote: `Chat.promoteToProject()` → `api.createProject` + `api.chatBindSession` →
      `POST /api/chat/sessions/:id/bind` (`backend/chat.mjs bindSession`) moves both records into
      `projects/<pid>/chat/`, flips scope, keeps the id; the app then opens the project's Chat tab where
      the Production Panel appears. Agent path added to `CORE_API_ROUTES` (`backend/agentHome.mjs`).
- [x] Chat module OFF hides nav entry, project tab, and gates routes; ON restores everything
      — nav entry + standalone page gated in `App.jsx`; project tab + tab-keyboard (digit 6) gated;
      routes 403 via the existing `/api/chat` entry in `MODULE_ROUTES` (`backend/index.mjs`).
- [x] All-tools-OFF posture is demoable end-to-end without dead ends or references to invisible tools
      — chat ON / all tools OFF: core conversation, generation cards, Production Panel and (project)
      manual mode still work; the Settings → Chat tools hint (ticket 15) explains what enabling adds.
- [x] `npm run app` (Electron) shows a working chat — build green; `electron .` launched, the bundled
      backend answered `/api/state`, and the app ran without crashing. GUI not driven headlessly; the
      chat UI itself was verified against the running dev server instead.
- [x] ISSUES.md updated if any of its items are superseded by this feature — scanned; none of the 30
      items concern the filmmaker-chat surface (item 2 is `npm run dist:mac` packaging, a separate
      concern), so no tags changed.
