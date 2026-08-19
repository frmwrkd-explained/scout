# T15 · Whiteboard
**Milestone:** M5 · **Reads:** `docs/05_UI_SPEC.md` §5

## Do
1. Port FrameForge's `Board.jsx` / `BoardNodes.jsx` / `BoardInspector.jsx` / `boardLayout.js` in structure. It is native — HTML nodes on one CSS transform, no canvas library — which is why a live document can render inside a card. Do not swap in a library.
2. Node kinds: `document · collection-view · territory · goal · note · image · frame`.
3. **Edges derive from real relations.** Placing two related documents draws the edge and labels it with the field name. No hand-drawn edges that mean nothing.
4. `board.md` per project: frontmatter record, append-only log body. `rev` advances **only when nodes change** — panning is not document content.
5. Auto-align is an **action**, never a render-time derivation.
6. The inspector's GRAPH section opens **into** this. There is no second graph feature.

## Demonstrate
Drop a guest, its territory and the project brief on a board: the two relation edges draw themselves, labelled.
