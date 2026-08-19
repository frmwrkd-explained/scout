# 01 — Shared RenderMedia / RenderTile / RenderLightbox

**What to build:** One shared trio of media components — `RenderMedia` (image-vs-video
branch, hover-play for video, object-fit modes, poster handling), `RenderTile`
(selectable thumbnail card with status/rating overlay slots), and `RenderLightbox`
(zoom, keyboard nav, drag-out payload slot) — generalized from the moodboard's
existing mosaic/lightbox primitives. Adopt them in the generate console (thumbnail
tiles, big preview, and its lightbox) so the console's three hand-rolled render
paths become one. This is a prefactor: after this ticket, any surface that shows a
generated image or video imports these components, and the user updates one main
component instead of five scattered ones.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] A shared media component module exists exporting RenderMedia, RenderTile, RenderLightbox — `frontend/RenderMedia.jsx`
- [x] Video files hover-play in tiles and play with controls in the lightbox; images zoom — image zoom dev-server-verified (56/56 tiles loaded, double-click → lightbox); video paths code-verified (hover-play via `RenderMedia hoverPlay`, lightbox video keeps `controls`) — no video generations in the live project to drive
- [x] The generate console's thumbnail grid, large preview, and lightbox all use the shared components with no behavior regression (drag-to-shot payload still works) — dev-server-verified: tiles render with overlays, select drives the iterate bar, double-click zoom, prev/next/Escape; `startDrag` DND payload code-verified
- [x] The moodboard mosaic/lightbox either delegates to or is the basis of the shared components — no duplicate branch logic remains between them — Mosaic, AssetList, and the Lightbox stage now route their image/video branch through `RenderMedia`
- [x] Existing keyboard shortcuts and review interactions on the generate console still work — dev-server-verified (arrow nav in lightbox, Escape close; capture-phase `onKey` untouched, `RenderLightbox` runs `keyboard={false}`)

**Notes:** RenderMedia's kind branching is a single decision point (`mediaKind` + one `if (k === 'video')`) so ticket 07's audio branch is one more `if`. RenderLightbox has opt-in built-in keyboard nav (`keyboard` prop) for future consumers; the generate console keeps its own keymap. `npm run build` passes.
