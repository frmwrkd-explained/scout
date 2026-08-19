<!-- Spec family: board. Created 2026-08-18. Status: SHIPPED.
     Read this as the design record, not as a work queue. Everything below is live:
     frontend/boardLayout.js, backend/board.mjs, backend/boardExport.mjs, shared/assetKinds.mjs,
     frontend/Board.jsx, frontend/BoardNodes.jsx, frontend/BoardInspector.jsx,
     frontend/shotTakes.js, and tests/phase-board-{layout,store,export}.test.mjs. -->

# The Board — a per-project infinite canvas

## The bet

A project already has a shot list, a reel and a set of asset boards. What it has never had is a
place to see all of it **at once, arranged the way the director thinks about it**. The Board is
that: an infinite canvas, one per project, where a shot card is a *live link* to the shot record,
an asset card is the `{ scope, folder, name }` triple every other surface uses, and the arrangement
itself is the information.

## Why not a whiteboard library

| Candidate | Licence | Why not |
|---|---|---|
| **tldraw** | tldraw licence — **paid** to remove the watermark | Forecloses it for an app that is sold. Decided before anything else was evaluated. |
| **Excalidraw** | MIT ✅ | Paints to `<canvas>`. `RenderMedia` — this repo's canonical media component — cannot live inside a canvas scene graph, so a video take becomes a still frame you decode by hand. Its element model (`versionNonce`, `seed`, images in a separate binary blob) is also opaque to the agent this feature is supposed to serve. |
| **Konva / Fabric** | MIT ✅ | Same canvas problem, minus Excalidraw's tooling. |
| **React Flow (@xyflow)** | MIT ✅ | HTML nodes, so `RenderMedia` survives — the only real contender. Rejected on cost/benefit: it donates pan/zoom and marquee (~250 lines) and costs a 130KB dependency plus a node/edge idiom in a repo with four runtime deps, while leaving all four domain features unimplemented. |

Four of the five things the feature had to do — align by scene and shot, toggle the approved plan
against every take, load *this project's* cast and locations, stay legible enough for an agent to
rearrange — are domain logic no library ships. So: HTML nodes, a CSS-transform viewport, and the
document in markdown.

## The invariants

1. **Nothing moves that the user did not move.** Auto-align is a button, never a render-time
   derivation. Same rule as the reel's `layDownShots`, same reason: a derived layout cannot hold a
   deliberate placement.
2. **A shot card stores no picture, title or status** — only `{ shot: 'SH010' }`. It resolves
   through the joiner that already owns that question. Denormalising would make the board a stale
   copy of the shot list the moment anyone re-picks a take.
3. **The board decides, it does not display.** Clicking a take in `show:'all'` sets
   `selectedCandidate`. A version toggle that only showed would make you leave the board to act on
   what it just showed you.
4. **One prompt UI, in the one place it belongs.** The shot dock renders `<Composer>` inside
   `ComposerDock` — a bottom horizontal bar, not a side rail. Both halves of that were violations
   the first time round: a hand-rolled textarea (a sixth prompt UI) inside a hand-rolled 380px rail
   (placement is `ComposerDock`'s, per CLAUDE.md's Shared UI table).
6. **Production assets and mood/references are never one list.** The shelf splits Assets from Refs
   and `syncAssets` pulls production folders only. Root-level context files are references — that
   is where a mood import lands — and mixing them buried the cast under scraped mood the moment a
   project had any.
5. **Frame ownership is per-call.** A frame carrying `scene` or `kind` belongs to a layout and is
   rebuilt or dropped by one; a frame carrying neither is the user's and is never touched. The
   `production` layout composes two layouts at once and passes `owns` so each half leaves the
   other's groups standing.

## Bugs this design already caught

- **Orphaned auto-frames.** By-scene → Shot-strip left two empty labelled boxes floating behind a
  single row. Fixed by the ownership rule above; four tests guard it.
- **The stale-write clobber.** The canvas PATCHes its entire node list. A page open while a
  production align ran elsewhere wrote its stale 36-node list over the newer 41-node one and
  silently deleted seven asset cards. Fixed with a monotonic `rev` and a 409 carrying the live
  document. The first attempt used the `updated` timestamp and **protected nothing**, because
  `store.mjs`'s `stamp()` has minute granularity.
- **Key collisions.** The board's `F` and `G` fired the global feedback panel and the Generate-tab
  jump alongside their own actions. App binds globals on the bubble phase precisely so a focused
  surface can claim a letter first; the board now calls `stopPropagation()` like Story does.
- **A drifted digit map.** The 1–N tab shortcuts listed six tabs while the row rendered seven, so
  Timeline was unreachable by keyboard — and inserting Board shifted every digit onto the wrong
  tab. Both now derive from `App.projectTabs()`.

## Deliberately refused

Connectors with a routing engine (an arrow means "these relate"; if it crosses a card, move the
card), a `density` prop on Composer, rich text, node grouping as a data structure, real
`requestFullscreen` (it would break ⌘-tab and the Electron menu — full screen here is a mode that
gives the canvas the window), and any second source of truth for shot media, asset kinds or the
model catalogue.
