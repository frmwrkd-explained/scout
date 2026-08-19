# FrameForge — Agent Instructions

Local-first React + Express + Electron app with a markdown-file datastore.
**Not part of the MasterMind ecosystem.** Last reconciled against source: 2026-08-02.

> **How to read the numbers in this file.** Line numbers drift and counts grow; symbol
> names and file paths do not. This file was rewritten on 2026-08-02 to cite **files and
> symbols** instead of `file:line` wherever possible, because the previous revision's
> pointers had all slid by 5–70 lines and several described code that had been deleted.
> If you add a claim here, make it one that survives an edit three lines above it.

## Scope override — read first

The user-global `~/.claude/CLAUDE.md` is written for MasterMind (Obsidian + Windmill).
In this project it does **not** apply:

- **Ignore the "use TypeScript" rule.** FrameForge is plain ESM JavaScript by design:
  `.mjs` backend, `.jsx` frontend, `.cjs` Electron main. There are zero `.ts`/`.tsx`
  files. Do not add TypeScript without an explicit request.
- **Ignore all Obsidian frontmatter / wikilink / vault-path rules.** No vault surface here.
- **Ignore the worktree rule.** This IS a git repo, and it has a **private** remote:
  `origin` → `DevFrmwrkd/frameforge`. `gh` works and CI runs (`.github/workflows/`).
  Branch naming (`feat/`, `fix/`, `chore/`) applies. **`workspace/` and `.env` are
  gitignored and have never been in history — verify that stays true before any push.**
- SOPs may be consulted, but **this codebase wins on every conflict**. If a SOP
  disagrees with working code, fix the SOP — never the code.

## ⚠️ Verify a zero-hit search before believing it

This repo has a documented history of agents concluding "that doesn't exist" from a
search that lied to them. **A zero-hit result is a claim to verify, not a fact.** Two real
examples, both of which cost hours:

- **`rg -rn "frameforge-shots" .` returned nothing**, and an agent concluded the feature
  had been deleted. `-r` is ripgrep's `--replace`, which silently ate the `n`. The string
  appears 11 times in `backend/index.mjs` alone. Use `rg -n`.
- **`backend/store.mjs` used to be invisible to `grep` entirely.** It carried a literal
  NUL byte inside a string literal, so grep classified the file as binary and returned
  nothing — silently, exit 1, on the canonical source for settings, path safety and the
  datastore.

**That second trap is fixed as of 2026-08-02** and you no longer need `grep -a` here.
The NUL bytes in `backend/store.mjs` (`revOf`), `shared/redact.mjs` (`signature`) and
`tests/phase-regressions.test.mjs` are now written as the two-character escape `\0`,
which produces a byte-identical runtime string and leaves the file as plain text. Every
file in the repo is now text; `grep -n publicSettings backend/store.mjs` works.

**Do not re-introduce a raw NUL** (or any other raw control byte) into a source file. If
you need one in a string, write the escape. `backend/reel.mjs` never had one, whatever
earlier revisions of this file claimed.

## Source of truth, by domain

| Domain | Canonical file | Notes |
|---|---|---|
| Settings keys, redaction, path safety, datastore | `backend/store.mjs` | `getSettings`, `publicSettings`, `saveSettings`, `SECRET_SETTING_KEYS`, `REDACTED`, `safe`, `safeScope`, `paths`, `revOf` |
| Provider credentials | `.env` → `backend/env.mjs` | Resolvers: `falKey()` (fal.mjs), `groqKey()` (groq.mjs), `kieKey()` (providers.mjs). **Never read `getSettings().<x>ApiKey` directly.** |
| Models, providers, aspect→pixels, resolution tiers, output kinds | `frontend/modelCatalog.js` | Imported by **both** frontend and backend (10 backend files). The only model catalog. Also declares `DEFAULT_PREVIEW_MODEL` (`fal-ai/flux/schnell`) and the `OUTPUT_KINDS` vocabulary — `store.mjs` and `Composer.jsx` import them rather than restating them. |
| Context control files | `backend/store.mjs` `CONTROL_FILES` | `_folders.md` is a control manifest, not a user asset. It lives with `contextDir` and the path helpers that must consult it; `memory.mjs` re-exports it (declaring it there instead would deepen the `store ← memory` cycle). `library.mjs`, `deleteContextFile` and `contextFilePath` all consult it. Root scope only — a same-named file inside a board folder is an ordinary user asset. |
| Design tokens & rules | `frontend/styles.css` `:root` + `docs/DESIGN.md` | `:root` is machine truth; DESIGN.md explains it. `frontend/tokens.js` mirrors it for JS sinks and `tests/phase-design-tokens.test.mjs` fails if they drift. Where prose and `:root` disagree, `:root` wins. |
| The mono face | `frontend/tokens.js` `MONO` | One declaration, imported by every consumer. It used to be retyped in 47 files. Do not re-declare it. |
| Cinematic axis tokens | `frontend/models.js` | A **facade**, not a second catalog: it does `export * from './modelCatalog.js'` and adds the prompt-axis tokens. Frontend imports `./models`; backend imports `./modelCatalog.js` directly (it must stay pure — no JSX, no browser globals). This indirection is deliberate. Do not "collapse" it. |
| HTTP contract | `backend/index.mjs` route handlers | A field the route does not destructure does not exist. |
| Frame ↔ second conversion, fps table, timecode | `shared/timecode.mjs` | THE only place a second becomes a frame. `RATES` carries `dfLegal` — drop-frame is legal at 30000/1001 and 60000/1001 **only**, and the serialisers read that flag rather than deciding. `rateOf()` is idempotent; passing an already-resolved rate must keep working. |
| Shot → media join | `backend/reel.mjs` `resolveShotMedia` | The **one** shot→media joiner (lifted out of `index.mjs`'s old `shotsPayload`). Called from `index.mjs` and twice inside `reel.mjs`. Do not add a second. |
| A shot's authored length | `backend/reel.mjs` `shotSeconds` | THE authored-duration rule, added 2026-08-02. `shot.dur` is optional, arrives from markdown so it can be a string, and 0/negative/garbage means unset → `DEFAULT_SHOT_SECONDS`. It was inlined three times and the third copy (`manifest.mjs`'s `s.dur \|\| 4`) was **not the same function** — `'0'` is a truthy string, so the edit manifest wrote a zero-length clip where the reel cut 4s. All three call sites now import it. **The reel never writes a shot record** — `shot.dur` stays authored intent, `reel.timing[id].frames` is the cut. Order comes from `shot.no`, picture from `shot.selectedCandidate`, so the reel is derived and there is nothing to sync. |
| Groq token pricing | `backend/groq.mjs` `PRICE` | `enhance.mjs` imports `priceFor` from here — keep it that way. |
| Keyboard bindings | `frontend/keymap.js` | User overrides live in `settings.keys`. A rival registry (`frontend/commands.js`) declared its own `k`/`x`/`l`/`r`/`1–5` and was never wired to anything; deleted 2026-08-02. Do not write a second one. |
| **Redaction rules** | `shared/redact.mjs` | The seven ordered rules + the dedupe `signature()`. Pure — no store, no fs, no `Date`. Gated by `tests/phase-feedback-redaction.test.mjs`; if that fails the feature is broken, not the test. **Never write a second redactor.** |
| Bug-capture rings | `frontend/feedbackCapture.js` | console/errors/network/interactions, installed from `main.jsx` before `createRoot`. In-memory, dropped on reload, never auto-sent. |
| **Outbound egress** | `backend/feedback.mjs` | The only call in this repo that sends **user content** to a FrameForge-owned server. (It is not the only call to one: `desktop/updater.cjs` polls the R2 update feed at `package.json` → `build.publish[0].url` with `autoDownload = true`. That fetches release metadata and uploads nothing, so the privacy claim holds — but say it precisely, because "the only call" full stop is false.) Assemble → redact → sign → transmit, redaction last so nothing lands downstream of it. If a second egress point appears anywhere else, the privacy claim in the panel stops being checkable. |
| Asset-kind folder vocabulary | `frontend/AssetBoards.jsx` `ASSET_KIND_FOLDERS` | |
| **Reference scene math** | `backend/video.mjs` | `adaptiveCuts`, `parseSceneScores`, `stepTimes`, `gridFor`, `clampShot`, `clock` — pure, exported, gated by `tests/phase-video-sheet.test.mjs`. A detected scene is a RANGE (`job.shots[i] = {s,e,s0,e0}`), not a frame: that is what makes retrim and the per-scene **contact sheet** possible. **Never reintroduce a fixed `scene` threshold.** ffmpeg's scene score scales with how much light is in the frame, so one global line cannot serve a dark grade and a daylight one: on the Temerario ad the old 0.3/0.4/0.5 tiers found 30 of ~127 cuts, single "scenes" swallowed six unrelated shots, and every sheet and move-read built on them was confident nonsense. `adaptiveCuts` scores every frame and asks whether one SPIKES against its neighbourhood, with the baseline a **trimmed mean of the quiet half** — a plain average lets the frames of a dissolve vouch for each other and the cut is missed entirely. Panels are sampled every Nth FRAME (`stepTimes`), not spread to a fixed count, and inset off both boundaries because ffmpeg reports a cut at the first frame of the NEXT shot. `gridFor` shapes any count because the last row is blank-padded — `tile` is asked for ONE frame, so a half-empty grid is a partial flush that emits nothing. Last trap: `drawbox` knows `iw`/`ih`, `drawtext` does **not** (it knows `w`/`h`), and an `ih` there kills the whole filtergraph so every labelled sheet silently stops building. |
| Camera-move vocabulary | `frontend/cameraMovements.js` | 20 moves, 4 speeds, 3 stabilizations + `assembleMovePrompt`. Pure data, imported by both sides (`backend/vision.mjs`), like `modelCatalog.js`. The Camera Moves tool **reads and writes** through it: the picker goes move → prompt, `analyzeMove` goes contact sheet → move. The analyzer returns **ids only** and the prompt still comes from `assembleMovePrompt`, so both directions emit identical text for the same move — an analyzer that wrote its own prose would be a second voice for the same twenty moves. The schematic lives in `frontend/moveDiagram.jsx` (three surfaces draw it); `CameraMoves.jsx` re-exports it for StyleLab. |
| **Board geometry + auto-align** | `frontend/boardLayout.js` | PURE — imported by **both** sides (`backend/board.mjs`, `backend/boardExport.mjs`, `frontend/Board.jsx`), like `modelCatalog.js`. Owns `GRID`, `CARD`, the four layouts, `arrowGeom`, and the frame-ownership rule (`isAutoFrame`/`isUserFrame`: a frame carrying `scene` or `kind` belongs to a layout and is rebuilt or dropped by one; a frame carrying neither is the user's and is never touched). Auto-align is an **action**, never a render-time derivation — same rule as the reel's `layDownShots`. |
| Board document + operations | `backend/board.mjs` | `projects/<pid>/board.md` — frontmatter record, append-only log body. `cleanNode` is the ONE sanitiser and fails closed (unknown kind → dropped, coordinates → integers). `show` is the version toggle (`'selected'` \| `'all'`). Every route is a thin wrapper so an agent's align and the toolbar button are the same code path. **`rev` is the stale-write token, and it advances only when NODES change** — bumping it on every write (view-only ones included) meant panning invalidated the client's own base and its next drag 409'd against nobody. The camera is not document content. — the canvas PATCHes its whole node list, so a page open while the board changed elsewhere would clobber it (it ate 7 asset nodes once); a mismatched `base` gets a 409 carrying the live document. Do **not** switch that back to `updated`: `stamp()` has minute granularity, so a timestamp guard silently never fires. |
| Asset-kind vocabulary | `shared/assetKinds.mjs` | `ASSET_KIND_FOLDERS`, `assetKindOf`, `folderKind`. Moved out of `AssetBoards.jsx` so `backend/board.mjs` could group a canvas by cast/location/wardrobe/prop without importing a `.jsx` module. **`AssetBoards.jsx` re-exports it and is a facade** — do not re-declare the table there. **Production assets and mood/references are never one list**: the Board's shelf splits them into Assets and Refs, and `syncAssets` pulls production folders only. Anything at the context root is a reference (that is where a mood import lands). |
| A shot's takes, client-side | `frontend/shotTakes.js` | `takesForShot` / `heroTake` — the client mirror of `resolveShotMedia`'s ladder. `ShotWorkspace.takes()` and `Story.jsx` still carry private copies that predate it and already differ; **nothing new should re-derive it**. |
| Project tab row | `frontend/App.jsx` `projectTabs()` | The visible tabs AND the 1–N digit shortcuts read this one list. They had already drifted (the digit map listed six tabs while the row rendered seven, so Timeline was unreachable by keyboard). Do not restate the tab list. |
| **Shared UI components** | see "Shared UI" below | Import them. Do not re-render their markup by hand. |

## Shared UI — check here before you build any interface

**`frontend/Composer.jsx` is THE composer.** One bar, one shell, every surface — chat, the
project generate console, the shot workspace, asset boards and Story all render it. Its
header states the contract: it is controlled and presentational, it owns no fetching and
no submit path, and it has **zero density variants** on purpose. If you are about to add a
`density` prop you are re-introducing the thing it deleted.

> History, so nobody re-derives it: there used to be three structurally separate UIs for
> one operation — `ProjectGenerate.jsx`'s chip-row console, `chat/ManualComposer.jsx`'s
> stacked panel, and `ShotWorkspace.jsx`'s inline bar. **All three are gone.**
> `chat/ManualComposer.jsx` was **deleted**; its `OUTPUT_KINDS` vocabulary moved into
> `frontend/modelCatalog.js`. Docs written before that — including parts of
> `docs/COMPONENTS.md` and every `docs/specs/component-unification/` ticket — still
> describe the old world. `docs/MAP.md` records which of those tickets actually shipped.

**These already exist. Import them.**

| Need | Import | Notes |
|---|---|---|
| UI primitives | `Btn`, `Card`, `Eyebrow`, `Empty`, `Input`, `Field`, `Chip`, `InlineEdit` from `./ui` | Eight exports, all with importers. `Card` is the CardShell generalization. Adoption is partial and uneven — that is the open work, not extraction. |
| The option pill | `Chip` from `./ui` | Was declared module-locally and byte-identically in `GenerationControls.jsx` and `SchemaForm.jsx`, exported from neither — `docs/COMPONENTS.md` calls that the root cause of the worst duplication in the app. One declaration now. Never re-declare it. |
| The mono face | `MONO` from `./tokens` | |
| Show an image/video/audio result | `RenderMedia`, `RenderTile`, `RenderLightbox`, `mediaKind` from `./RenderMedia` | Well adopted (12 files). Follow this example. |
| Review-action chip (keep·kill·re-roll·final…) | `MediaAction` from `./RenderMedia` | THE chip next to any viewed image: glass pill, capitalized label, hotkey in parens, tone = border+text tint (`ok`/`danger`/`accent`/`neutral`), `fill` only for the one primary state action. Only 3 surfaces use it and hand-rolled triads still exist elsewhere — adopt it, never hand-roll a fourth language. |
| Pick a model | `ModelPicker`, `modelName` from `./GenerationControls` | Takes `kinds` (catalog kind keys); the older boolean `video` prop still works. Never derive a label with `.split('/').pop()` — that is `modelName`'s fallback, not a shortcut. |
| Aspect / resolution / seed | `FormatControls`, `ASPECTS` from `./GenerationControls` | One `ASPECTS` declaration only. `FormatControls` supports `showDuration`/`durations` and no caller passes them. |
| Per-model settings | `SchemaForm` from `./SchemaForm` | Driven by the synced fal spec (`backend/modelSchemas.mjs`). **Never hardcode a model's resolutions, durations, or aspect list.** |
| Prompt field with snippets | `SnippetText` from `./SnippetText` | plain textarea — story editor, cards |
| Prompt field with inline @-mentions | `MentionText` from `./MentionText` | the Composer's field: contenteditable, `@key` tokens render as thumbnail pills, keeps `/` snippets + keymap guards. Value contract stays a plain string. |
| Composer placement | `ComposerDock` from `./Composer` | WHERE the unified bar sits: floating near the bottom (`DOCK_BOTTOM`), centered, `DOCK_WIDTH` max. Never hand-roll a wrapper around `<Composer>` — placement is part of "zero variants". |
| @-mention entity pool | `buildEntityPool` / `buildAssetPool` from `./entities` | THE resolver for "what can @ tag". Production entities only, ranked project-scope first, named first, talent → location → prop. **Never build another pool or re-filter/re-sort a copy in a surface.** (`Story.jsx`'s `entityPool()` predates this file and is the one tolerated legacy twin — it also imports `buildEntityPool` for other call sites.) |
| Dictation | `VoiceInput` from `./VoiceInput` | |
| Style / look building | `StyleLab` from `./StyleLab`, `frontend/lookBuilder.js` | StyleLab replaced `StyleStudio`, `StyleLocks` and `StyleLockPicker`; the last two were deleted 2026-08-02. `PromptBuilder.jsx` is a fourth axis picker over the same `AXES` and is **still live** — `Tools.jsx` mounts it. Folding it in is real remaining work. |
| Chat card shell | `CardShell` from `./chat/directives` | All six chat card files import it. The old per-file copies are **gone** — do not re-add one. |
| A per-project canvas | `Board` from `./Board` (+ `BoardNodes.jsx`, `BoardInspector.jsx`) | THE infinite canvas. Native — no canvas library, deliberately: every mature one (tldraw, Excalidraw, Konva, Fabric) paints to `<canvas>`, where a video take is a still frame you decode by hand, so `RenderMedia` could not live inside a card. tldraw is also **licensed** and this app is sold. Nodes are HTML, the viewport is one CSS transform. Do not swap in a library without re-reading that. |
| The board's shot dock | `BoardInspector` from `./BoardInspector` | Opened by a shot card's OPEN chip. A **bottom horizontal dock**, mounted through `ComposerDock` — not a side rail: a 380px rail wrapped a 60-word prompt into a forty-line column, and CLAUDE.md already says placement belongs to `ComposerDock`. Its prompt field and Generate button **are `<Composer>`**; the first version hand-rolled a textarea and a button, i.e. a sixth prompt UI, which is the rule this repo breaks most often. The dock owns only the submit, because the route fork (`variantCount` 1 → `/api/generate`, >1 → `/api/batches`) is real logic Composer deliberately does not carry. |

Still genuinely duplicated, so expect to find copies: result/review action triads
(keep·kill·re-roll, ~13 files), cost badges (six prefixes), and the `Modal`/`Popover`
chrome. If you touch one, export/adopt the canonical one rather than adding another copy.
`docs/COMPONENTS.md` is the full inventory — read its own staleness banner first.

**Before building any UI, grep for the concept.** If a second implementation exists,
reconcile to the canonical one; never add a third.

## Ports — the actual wiring

- **API server: 5176.** `backend/index.mjs` resolves
  `Number(process.argv[2]) || Number(process.env.PORT) || 5176`.
- **Vite dev server: 5175.** `vite.config.mjs` resolves
  `FRFG_DEV_PORT || PORT || 5175`.
- **The backend does NOT read `FRFG_API_PORT`.** Only Vite reads it, and only to pick
  the proxy target. Setting `FRFG_API_PORT` alone will not move the API. Pass the port
  as argv instead: `node backend/index.mjs 5286`.
- **`PORT` is read by both processes** and means different things to each. Never export
  `PORT` into a shell that starts both — Vite and the API will fight over it.
- **The proxy target must stay `127.0.0.1`, never `localhost`.** The backend binds IPv4
  only (`HOST || '127.0.0.1'`, near the bottom of `index.mjs`) and macOS resolves
  `localhost` to `::1`.

```
npm ci          # lockfile IS present (~294KB) — do not use bare `npm install`
npm run dev     # vite on 5175, proxies /api → 127.0.0.1:5176
npm run server  # express on 5176 (second shell)
npm test        # node --test  ·  384 tests
npm run build   # vite build → dist/
npm run app     # build + electron
```

`.claude/launch.json` holds exactly two configs, and you need **both**: `frameforge-ui`
(vite, 5175) and `frameforge-api` (express, 5176). Vite proxies `/api` but does not start
the backend. Do not add per-task launch configs, and never set `PORT` in one.

## Generated / derived — never hand-edit

- `package-lock.json` — regenerate via npm only.
- `dist/`, `release/`, `node_modules/`.
- `workspace/**` — the **live user datastore**. Written by the backend. Contains real
  API keys in cleartext (`workspace/settings.md`). Never hand-edit, never paste contents.
- `workspace/projects/*/context/_folders.md` — control manifest owned by `backend/memory.mjs`.
- `landingpage/assets/island/` — **build output that is committed on purpose**, because
  Vercel runs no build for that site. It is the artifact the public page loads. Rebuild it
  with `npm run landing:build` after any edit under `landingpage/island/`, and never edit
  the bundle by hand.
- `landingpage/island/demo-state.json` — a frozen `GET /api/state` capture. Regenerate
  with `npm run landing:sync`; that script scrubs secrets **and absolute paths** and
  refuses to write if either survives. Do not weaken those guards: this file is published.
- `._*` AppleDouble files — **ignore them as source, but sweep them before `npm test`.**
  A freshly written file gets a `com.apple.provenance` xattr and therefore a `._X` sidecar, and
  `npm test` runs bare `node --test`, whose discovery picks `._phase-*.test.mjs` up as real test
  files and fails them. That is not a cosmetic annoyance, it is three phantom failures on a green
  suite. Sweep, then run:
  `find . -name "._*" -not -path "./node_modules/*" -delete` This repo lives on an **exFAT**
  volume; macOS cannot store extended attributes there, so it writes a `._X` sidecar next
  to almost every file `X`. They regenerate within minutes of deletion, so deleting is
  cosmetic, not a fix. They are gitignored. Never read, edit, or cite one as a source file
  — `._store.mjs` is not `store.mjs`. Sweep only if the noise bothers you:
  `find . -name "._*" -not -path "./node_modules/*" -delete`

## Conventions actually in force

- ESM everywhere (`"type": "module"`). No build step for the backend.
- Directories are `backend/`, `frontend/`, `shared/` (imported by both), `desktop/`
  (Electron `.cjs`), `scripts/` (one-off generators, not app code), `tests/`, `docs/`,
  and `landingpage/` (a **separate** static marketing site — it steals the app's visual
  language and copies its components, it does not import from `frontend/`, with the one
  deliberate exception of `landingpage/island/`).
  **There is no `src/` or `server/`.** Comments referencing those paths are stale — fix
  them when you see them. The one exception is `backend/remotion.mjs`, where `src/`
  refers to the *user's* Remotion project.
- **Secrets live in `.env`**, loaded by `backend/env.mjs` (zero-dep; import it first in
  any entry point, and a missing `.env` is fine). Recognised names: `FAL_KEY`,
  `GROQ_API_KEY`, `KIE_API_KEY`, `FRFG_FEEDBACK_URL` (not a credential — the public
  Convex `.site` URL that collects bug reports; unset means reports queue to
  `workspace/feedback/outbox/` instead of transmitting). **`FAL_API_KEY` is not read
  anywhere** — the FAL SOP is wrong about this. Precedence: shell export → `.env` →
  `workspace/settings.md`. Copy `.env.example` to get started. Keys should NOT be put
  back into `settings.md`.
- Any route returning settings must return `publicSettings()`, never `getSettings()`.
  Redaction uses the `'••••••••'` sentinel and `saveSettings()` drops incoming sentinel
  values. Do not change that to `null`/omitted — it will wipe the user's keys on next save.
- Staged-trash entries use `itemKind`. Bare `kind` means `dir|file` on `paths[]`.
- Tests are plain `node --test` scripts in `tests/` (`phase*.test.mjs`). No test framework.
  They depend on `FRFG_DATA` pointing at a temp dir — code that bypasses `getStorageRoot()`
  will break them. **591 tests across 56 files as of 2026-08-18** (589 pass, 2 skipped — both Windows-only launch paths) — the count grows, so
  treat a green run as the gate, not a specific number.
  **Green on macOS does not mean green on Windows.** 16 tests failed on `windows-latest` for
  months while every Mac run was clean: `path.join` leaking `\` into agent-facing text and into
  the portable datastore, `resolveBin` probing POSIX-only locations, `spawn` refusing npm's
  `.cmd` shims. When you touch path building, binary resolution or process spawning, ask what
  the other platform does — CI answers it on every push, and a red Windows leg blocks the
  `publish` job for **every** platform, macOS included.
  `npm test` runs bare `node --test` (Node's own discovery). **Do not "fix" it to
  `node --test tests/`** — Node ≥ 22 resolves a directory argument as a module path and
  dies with `MODULE_NOT_FOUND` before running anything. That exact regression shipped
  once and hid behind a workflow that spelled the command differently.

## Agent skills

### Map of content

**`docs/MAP.md` is the index of all docs** — spec families, their live statuses, and what
is archived. Read it instead of walking `docs/` yourself. Completed spec families live in
`docs/specs/_archive/` and are not work queues.

### Issue tracker

Local markdown — specs and tickets live in `docs/specs/`, tracked in git. There **is** a
GitHub remote and `gh` works, but **the tracker is still files, not GitHub Issues**: do
not open `gh issue` threads. The remote is for backup, CI and sharing.
See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context — one `CONTEXT.md` and one `docs/adr/` at the repo root, both created
lazily, neither existing yet. See `docs/agents/domain.md`.

### The workflow

`/wayfinder` (chart a big foggy effort as decision tickets) → `/to-spec` (synthesise a
spec) → `/to-tickets` (slice it) → `/implement` (one ticket per session) →
`/code-review`. Supporting: `/research`, `/prototype`, `/grilling`, `/tdd`.

`/code-review` is Claude Code's **built-in** skill. This skill set deliberately ships no
second one — there is exactly one review command.

## Before you start — checklist

1. Read this file and the file you're changing. **Do not start from `ISSUES.md` alone.**
2. **`ISSUES.md` is a reading list, not a work queue.** Every item carries a status tag —
   `[DONE]`, `[OPEN]` or `[STALE]` — and the file carries a reconciliation date. Trust a
   tag only as far as that date: re-verify before acting, and fix a stale tag in the same
   change. Never mark `[DONE]` you have not personally confirmed — a wrong `[DONE]` causes
   someone to re-implement working code.
3. **A ticket's `Status:` line is a claim too.** Every `docs/specs/component-unification/`
   ticket said `open` for weeks after its work shipped, and one names an acceptance file
   (`tests/canon-allowlist.json`) that has never existed. Check the acceptance criteria
   against source before you start implementing.
4. Grep for the concept before implementing it. If a second implementation already
   exists, reconcile to the canonical file above — do not add a third. For UI, read
   "Shared UI" above first; that rule has been violated more than any other in this repo.
5. Ports, model ids, prices, defaults: change the canonical file only, then grep for
   stray literals of the old value.

## Hard rules

- Do not add a second source of truth for anything in the table above.
- Do not introduce TypeScript, a test framework, or a new env-var scheme unasked.
- Do not "fix" `127.0.0.1` to `localhost`.
- Do not put a raw NUL or other control byte in a source file — write the escape.
- Do not commit or paste `workspace/settings.md` — it holds live credentials.
- Do not relax the scrubbers in `landingpage/tools/sync-demo.mjs`; that fixture is
  published to a public CDN.
- If two files disagree, say so and fix the non-canonical one. Never silently pick a side.
