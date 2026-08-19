# 07 — Resizable panels — let the user control the layout

**Status:** open
**Blocked by:** None — can start immediately.

## Problem

Nothing in FrameForge is resizable. Every panel width is a literal inside an `sx()` string:

- `frontend/Chat.jsx:307` — sessions rail, `width:224px;flex:none`
- `frontend/chat/ProductionPanel.jsx:303` — production panel, `width:290px;flex:none`
- `ProductionPanel.jsx:290` — the collapsed rail, `width:38px`

`grep -rn "resize:" frontend/` returns 29 hits and **every one is a `<textarea>`**
(`Screenplay.jsx:335`, `PromptBuilder.jsx:496`, `Chat.jsx:542`, …). The two `ew-resize`
cursors in the repo are a before/after image wipe (`ControlMaps.jsx:253`) and a timeline
scrub lane (`ThreeDStage.jsx:728`). Neither resizes a panel.

The consequence is concrete: on the chat screen the middle column is whatever survives
224 + 290 = 514px of fixed chrome (`Chat.jsx:577` is the three-column flex root). A user
reading a long storyboard thread on a 13" laptop cannot widen it; a user on a 32" display
cannot widen the session title that `Chat.jsx:584` ellipsises at `max-width:340px`.

Collapse already exists for exactly one panel and already persists —
`ProductionPanel.jsx:92-95` writes `prodPanelCollapsed` via `api.saveUiState`, read back at
`:77`. Extend that pattern; do not invent a second one.

## What to change

**1. New component `frontend/PanelSplitter.jsx`.**
Do **not** name it `GridSplitter` — `frontend/GridSplitter.jsx:1` is an unrelated tool that
cuts contact sheets into frames.

Props: `value`, `onChange(px)`, `onCommit(px)`, `min`, `max`, `defaultValue`,
`side` (`'left'|'right'`), `label`, optional `onToggleCollapse`. Renders a 5px `flex:none`
strip, `cursor:col-resize`, `height:100%`, transparent, carrying a 1px `#1B1E24` hairline
(the same border it replaces at `Chat.jsx:307` / `ProductionPanel.jsx:303`) that goes
`#3A3F49` on hover and `#E3FF32` while dragging or focused.

Drag with `onPointerDown` + `setPointerCapture` + `onPointerMove` — copy the pattern already
working at `ThreeDStage.jsx:725-728`; no library, no `window` listeners. `onChange` per move,
`onCommit` once on pointerup. Set `user-select:none` on `document.body` for the drag, clear
it on release.

**2. Keyboard parity — non-negotiable.** `role="separator"`, `tabIndex={0}`,
`aria-orientation="vertical"`, `aria-label={label}`, live `aria-valuenow`/`valuemin`/`valuemax`.
ArrowLeft/ArrowRight ±8px, Shift+Arrow ±32px, `Home` resets to `defaultValue`, `Enter`/`Space`
calls `onToggleCollapse` when provided. Keyboard changes commit immediately. Ticket 02 adds the
global `:focus-visible` ring — add no local `outline:none` here.

**3. Wire the chat screen.** In `Chat.jsx:577`, insert one splitter after `renderSidebar()`
(`:578`) and one before `<ProductionPanel>` (`:623`). Widths move out of the two literals into
`Chat.jsx` state and pass down: sessions rail 180–420 (default 224), production panel 220–520
(default 290). The middle column keeps `flex:1;min-width:0` and gains `min-width:360px`.
`ProductionPanel` takes a `width` prop instead of hardcoding 290; its collapsed 38px rail is
unchanged.

**4. Persist through the existing surface.** Add `chatSidebarW` and `prodPanelW` to `UI_ALLOWED`
at `backend/index.mjs:220`. That array is a strict allowlist — the loop at `:225` silently drops
any key not listed, so skipping this makes the feature look like it works until reload. Commit
via `api.saveUiState` (`frontend/api.js:73`) on `onCommit` only, never per pointermove. Read both
back beside `prodPanelCollapsed` on mount, and clamp on read so a stale `prodPanelW: 900` from a
wide monitor cannot brick a laptop session.

## Acceptance criteria

- [ ] `rg -n "width:224px" frontend/Chat.jsx` and `rg -n "width:290px" frontend/chat/ProductionPanel.jsx` each return **0 hits**; `rg -n "PanelSplitter" frontend/` shows one definition and two uses in `Chat.jsx`.
- [ ] Dragging either splitter resizes live; release, reload the app, return to Chat — the dragged widths are restored.
- [ ] Tab reaches both splitters. With one focused, ArrowLeft/ArrowRight moves the boundary 8px per press and `Home` returns it to 224 / 290. `Enter` on the production splitter collapses to the 38px rail and expands back.
- [ ] Inspector shows `role="separator"` with `aria-valuenow` tracking the live width.
- [ ] Dragging fully left or right cannot take the middle column below 360px or either rail outside its min/max.
- [ ] New `tests/phase-panel-layout.test.mjs`, modelled on the `ui-state` test at `tests/phase6-location.test.mjs:30`, PUTs `{chatSidebarW:300, prodPanelW:340, bogusKey:1}` to `/api/ui-state` and asserts both widths round-trip on GET while `bogusKey` does not.
- [ ] `node --test tests/` green with `FRFG_DATA` pointed at a temp dir — no pre-existing test newly failing.

## Notes

- Independent of the token work (04/05): this touches layout numbers, not colors. The strip and
  hairline can adopt `var(--line)` later with no structural change.
- Scoped to the chat screen's three columns only. Other fixed rails exist —
  `ShotWorkspace.jsx:501` (270px), `ThreeDStage.jsx:641` (300px) and `:812` (248px),
  `Moodboard.jsx:448` (370px), `ReviewInbox.jsx:149` (238px) — but reusing `PanelSplitter` there
  belongs in a follow-up, after the persistence path has proven out.
- `Chat.jsx:577` sizes itself with `height:'calc(100vh - 196px)'`. Leave it alone; this ticket is
  horizontal only.
