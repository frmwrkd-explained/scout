# 16 — Grid split without leaving the chat

**What to build:** The contact-sheet loop inside the conversation. When a grid
generation (3×3 sheet, 2×2 plate, turnaround) finishes, its card offers "Split";
the agent can also propose a split via directive. Splitting calls the server-side
split route (ticket 06) and the card expands into the split result: per-cell
thumbnails with keep/skip, optional shot assignment per cell (pre-filled when the
agent supplied a shot mapping), and confirm. Confirmed cells become child
generations attached to shots as candidates. The router skill learns the workflow:
generate sheet → split → attach, referencing generations and shots by id.

**Blocked by:** 06 — Server-side grid split; 14 — Generation cards; 15 — Chat tools registry (ships as the grid-splitter registry entry).

**Status:** done

- [x] A finished grid card splits in place; cells preview with keep/skip and shot assignment
      — `frontend/chat/generationCards.jsx` GenerationCard gains a "Split" affordance (still + tool
      enabled) that expands `frontend/chat/splitCard.jsx` `SplitFlow` inline: the uncut sheet is shown
      with a **client-side computed overlay grid** (no dry-run route exists, so preview uses the shared
      `shared/gridsplit.mjs` `detectGrid` over a ~600px canvas downscale, mirroring backend
      `detectFromBuffer`), each cell click-toggles keep/skip, and kept cells get a compact shot selector.
      *(UI is JSX/app-state driven — build-verified; exercise live.)*
- [x] Confirming produces child generation records and shot candidates visible in the shot workspace
      — Confirm calls `api.splitGrid(pid, id, { rows, cols, gutter, skip, shots })`; the route (ticket 06)
      writes the child generations + shot candidates end-to-end, covered by `tests/phase6-gridsplit`.
      The result view lists the returned cells (`RenderTile`) with shot badges + "Open in review".
- [x] Agent-initiated split directives pre-fill rows/cols and shot mapping
      — `SplitCard` registered via `registerToolCard('grid-splitter', …)`; `proposal.split`/`grid`/`show.grid`
      pre-fill `SplitFlow` from `directive.rows/cols/gutter` and its `{ "r-c": shotId }` mapping. Parse
      round-trip + directive→tool routing asserted in `tests/phase-grid-split-chat.test.mjs`.
- [x] With the grid-splitter chat tool disabled, no split affordance appears and the agent isn't told splitting exists
      — the inline "Split" chip is gated on `isToolEnabled(ctx, 'grid-splitter')`; the directive card is
      wrapped by the registry's enable-notice gate (ticket 15); and the tool's Index line is absent when
      off (asserted in `tests/phase-grid-split-chat.test.mjs`). `shared/chatTools.mjs` grid-splitter entry
      refined: real invocation `POST /api/generations/:pid/:id/split-grid` + `proposal.split`/`split`
      directive types.
