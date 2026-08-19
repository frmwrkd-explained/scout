# 13 — Production Panel: visual context locks beside the chat

**What to build:** The always-visible right-hand panel that shows the project's
creative context as visuals, rendered by the UI from stored data — the LLM never
rewrites it. Sections: Project understanding (brief + memory hot-cache, collapsed
preview with expand); Locked style (the active style lock's ref image + name + axis
summary, with actions to swap/lock from existing style locks and extracted looks);
Cast (context-board Cast entries with their reference/turnaround images); Locations
(context-board Locations entries); Look sheets (extracted looks / dedicated look
images). Panel actions call existing routes only (style locks, looks, context
boards, memory). When a lock changes, the active session receives a compact system
event carrying ids only, so the agent's world stays current without token-heavy
restatement. All imagery renders through the shared media components.

**Blocked by:** 11 — Chat UI shell. (Uses components from 01.)

**Status:** implemented (pending live browser verification — see note)

- [x] Panel shows brief/memory, locked style, cast, locations, and look sheets for the open project, live-updating on changes
- [x] Locking a different style from the panel updates the panel, persists, and notifies the active session with ids only
- [x] Cast/location entries display their reference images via the shared media components and open their canonical records on click
- [x] Empty states guide the user (no style locked yet → link to style lab / lock-from-chat)
- [x] Panel is collapsible and remembers its state in ui-state

## Implementation notes (2026-07-19)

- New component `frontend/chat/ProductionPanel.jsx`, mounted right of the chat column in
  `frontend/Chat.jsx` (the seam ticket 11 left open).
- Sections + exact data sources:
  - Project understanding — `props.pdef.brief` (via `/api/state`) + `GET /api/memory/:pid`
    (`api.getMemory`), collapsed preview with Expand.
  - Locked style — active id from `props.pdef.styleLock`; list/ref from `GET /api/stylelocks`
    (`app.state.styleLocks`) + `GET /api/stylelocks/:id/ref`. Swap → `app.setDefaultStyleLock`
    (which does `PATCH /api/projects/:pid` styleLock + sync). "Lock this look" →
    `POST /api/stylelocks/import-item` then `setDefaultStyleLock`.
  - Cast / Locations — `props.pdef.context.items` filtered by the canonical
    `ASSET_KIND_FOLDERS` vocabulary (imported from `AssetBoards.jsx`); imagery via
    `RenderMedia`; click opens a `RenderLightbox` with an "Open in Assets" jump.
  - Look sheets — `GET /api/looks` (`api.looks`); tier fragment + palette swatches.
- Lock-change system event: `POST /api/chat/sessions/:id/system-event` (new, additive in
  `backend/chat.mjs` via `appendSystemEvent`) appends `{ role:'system', text:'style-lock
  changed: <id>' }` to the ACTIVE session and broadcasts `system-event` on the session SSE
  channel; `Chat.jsx` reconciles the transcript on that event and renders system rows as a
  compact centered chip. Ids only — the agent re-reads the real lock via
  `agentHome.locksForProject` in the Index next turn.
- Collapsed state persisted in ui-state under the new `prodPanelCollapsed` key (added to
  `UI_ALLOWED` in `backend/index.mjs`); merge-PUT so App's own ui-state writes don't clobber it.
- Verification: full suite `node --test tests/phase*.test.mjs` green (128 tests, incl. a new
  system-event test in `tests/phase-chat.test.mjs`). `npm run build` currently fails ONLY on a
  concurrent agent's untracked `frontend/chat/toolRegistry.js` (JSX in a `.js` file, ticket 15) —
  both files I authored parse clean under esbuild. Live browser check of the panel is therefore
  dev-server-unverified until that file lands with a `.jsx` extension.
