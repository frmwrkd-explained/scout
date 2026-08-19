# T01 · Fork FrameForge and strip the film domain
**Milestone:** M0 · **Reads:** `docs/06_REUSE.md`

## Do
1. Copy `/Volumes/SSD/New Coding Projects/FAL HACKATON` into this repo. Do **not** copy `workspace/`, `.env`, `node_modules/`, `dist/`, `release/`, `landingpage/`.
2. Delete the film backend: `video · remotion · reel · reelRender · reelExport · reelPack · threed · gridsplit · stylelocks · fal · localAsr · imageSize · boardExport · story · screenplay`.
3. Delete the film frontend: `Timeline · Screenplay · StyleLab · CameraMoves · FilmEmulation · LutApplier · ThreeDStage · MoveAnalyzer · Moodboard · RemotionLibrary · SequenceEditor · GridSplitter · VideoImport · CallSheet`.
4. Keep and do not touch: `store.mjs`, `memory.mjs`, `indexer.mjs`, `search.mjs`, `agentHome.mjs`, `agentRunner.mjs`, `agentProviders.mjs`, `jobs.mjs`, `sessions.mjs`, `chat.mjs`, `ledger.mjs`, `licence.mjs`, `feedback.mjs`, `Board*`, `boardLayout.js`, `ui.jsx`, `Composer.jsx`, `Markdown.jsx`, `SnippetText`, `MentionText`, `VoiceInput`, `styles.css`, `tokens.js`, `desktop/`.
5. Rename product strings FrameForge → Scout. Env prefix `FRFG_` → `SCOUT_`.
6. Delete every now-orphaned test; keep the rest green.

## Do not
Refactor anything. This task removes; it does not improve.

## Demonstrate
`npm ci && npm test` green. `npm start` opens an empty Scout window with the tokens intact.
