# FrameForge — known issues, bugs, and improvement ideas

**Status is PER ITEM. Nothing here is fixed unless it is marked `[DONE]`.**
**Last reconciled against source: 2026-08-02.**

This file is a reading list of *claims*, not a work queue. Each claim keeps its original
wording and number so cross-references stay valid; the status tag and the `→` note after
it are the current truth. Tags:

- **`[DONE]`** — verified implemented, with a pointer to the code.
- **`[OPEN]`** — verified still true.
- **`[STALE]`** — the claim itself was wrong, or is no longer meaningful; the note says why.

If you change code that resolves or invalidates an item, retag it in the same commit and
move the reconciliation date. If you cannot verify an item with high confidence, leave it
`[OPEN]` — a wrong `[DONE]` causes duplicate implementations, which is the expensive
failure mode.

> **2026-08-02 — why the pointers changed shape.** The previous revision cited `file:line`
> throughout and **every line number had drifted** (App.jsx 3,073 → 3,491; index.mjs
> 1,331 → 1,403; "33 test files" → 45). Line numbers are now used only where they earn
> their keep; everything else names a file and a symbol, which survives an edit three
> lines above it.

## Build / setup

1. **[DONE] No lockfile** — `package-lock.json` was stripped for the rewrite. Run `npm install` to regenerate it before the first start.
   → `package-lock.json` exists (294 KB). Use **`npm ci`**, not `npm install` — the
   lockfile is authoritative and `npm install` will silently drift it.
2. **[OPEN] Electron packaging untested** — `desktop/main.cjs` was renamed from `electron/`; paths in `package.json` build config should be smoke-tested with `npm run dist:mac` before any demo.
   → Config is wired (`package.json` `"main": "desktop/main.cjs"`, same under `build.mac`,
   plus the `dist:*` scripts) and `.github/workflows/build.yml` packages all four targets on
   real runners. No evidence a packaged build has been *run*. `docs/RELEASE.md` documents two
   blockers that bite locally (exFAT output dir, `PYTHON_PATH`). Still unverified.
3. **[DONE] Vite dev port is hardcoded** — `vite.config.mjs` proxies `/api` to `localhost:5176` and the dev server runs on `5175`. These are brittle if a user already has something on those ports.
   → Both are env-overridable: `vite.config.mjs` reads `FRFG_DEV_PORT || PORT || 5175` and
   `FRFG_API_PORT || 5176`. **Correction to the claim:** the proxy targets `127.0.0.1`, not
   `localhost`, and that is deliberate — the backend binds IPv4 only and macOS resolves
   `localhost` to `::1`. Do not "fix" it. Note the backend itself does *not* read
   `FRFG_API_PORT`; pass the port as argv (`node backend/index.mjs 5286`).

## Architecture / maintainability

4. **[OPEN] `frontend/App.jsx` is a monolith** — ~2,800 lines in one class component. State, routing, data fetching, and UI rendering are all tangled. It should be split into route-level pages, a small context/store, and focused hooks.
   → **3,491 lines today.** Was 3,073 at the last reconciliation, ~2,800 when the claim was
   written. It has grown every time anyone has looked.
5. **[OPEN] `backend/index.mjs` is one giant router** — ~1,100 lines define all API routes. Extract domain routers (projects, generations, assets, story, etc.) into separate modules.
   → **1,403 lines today**, up from 1,331. The extraction pattern already exists and works —
   `registerReelRoutes`, `registerManualRoutes`, `registerStyleLockRoutes` — so this is
   continuing an established move, not inventing one.
6. **[OPEN] Backend imports `frontend/modelCatalog.js`** — `backend/providers.mjs` and `backend/generate.mjs` reach across the stack. The catalog should live in `backend/` or a shared `lib/` package, not inside the React source tree.
   → Still true and wider than the claim: **ten backend files** reference it, seven of them
   as real imports (`index.mjs`, `providers.mjs`, `generate.mjs`, `stylelocks.mjs`,
   `batches.mjs`, `store.mjs`, `modelSchemas.mjs`). `shared/` now exists (5 files) and is the
   obvious destination. Note `frontend/modelCatalog.js` is nonetheless the single canonical
   catalog — a move must relocate it, never fork it, and `frontend/models.js` is a deliberate
   facade over it that must keep working.
7. **[OPEN] No typed API contract** — `frontend/api.js` is a hand-written list of `fetch` calls. A generated or shared schema (OpenAPI/Zod) would catch mismatches early.
   → Still hand-written. It does propagate the server's `error` message and `code`
   discriminator, but there is no schema.
8. **[OPEN] Settings are unversioned** — `settings.md` is read/written as a flat object. Adding a new key without a default silently breaks older storage roots.
   → **Correction to the rationale:** the stated failure mode does not occur. `getSettings()`
   spreads `DEFAULT_SETTINGS` under the stored data, so a new key with a default is always
   present. What remains true is the headline: there is no version field and no migration
   framework — only one ad-hoc migration hardcoded inline (`needsRepoMigration`, the
   `skillRepos` v1 array-of-strings form). A second such migration will not scale.

## Security / reliability

9. **[DONE] API keys are stored in plain markdown** — `settings.md` keeps `groqKey`, `falKey`, and provider tokens in cleartext inside the workspace. At minimum, move secrets to a keychain / OS credential store and never return them in `/api/state`.
   → Resolved for the primary path. Secrets live in `.env`, loaded by `backend/env.mjs`
   (recognised: `FAL_KEY`, `GROQ_API_KEY`, `KIE_API_KEY`; see `.env.example`). Precedence is
   shell export → `.env` → `settings.md`. **Correction to the claim:** the setting keys are
   `falApiKey` / `groqApiKey` / `kieApiKey` — `falKey()` and `groqKey()` are the *resolver
   functions*, not storage keys. `settings.md` remains a legacy fallback and can still hold
   cleartext on an old storage root; keys should not be put back there.
10. **[DONE] `/api/state` returns sensitive settings** — `getSettings()` is sent to the browser. The local-only Host/Origin guard helps, but it is still the wrong surface for secrets.
    → `/api/state` returns `publicSettings()`, as does `GET /api/settings`.
    `publicSettings()` swaps every key in `SECRET_SETTING_KEYS` for the `'••••••••'`
    sentinel and `saveSettings()` drops incoming sentinels. Do not change the sentinel to
    `null`/omitted — that wipes the user's keys on the next save.
11. **[OPEN] `agentEnv()` may leak environment variables** — `backend/jobs.mjs` forwards `process.env` to spawned `claude` and provider CLIs. Explicitly whitelist only what each child process needs.
    → Still a full `{ ...process.env }` copy with a small *denylist* (`agentEnv()` in
    `backend/jobs.mjs`), scrubbing `CLAUDE*` / `CLAUDECODE` / `ANTHROPIC_BASE_URL` /
    `BAGGAGE` / `AI_AGENT`. The denylist exists for auth reasons, not leak reasons. The
    requested allowlist does not exist.
12. **[OPEN] No CORS policy** — `backend/index.mjs` blocks non-local Host/Origin, but there is no explicit CORS setup. Test carefully if the LAN flag (`FRFG_ALLOW_LAN`) is ever enabled.
    → Unchanged. `ALLOW_LAN` is `FRFG_ALLOW_LAN === '1' || HOST === '0.0.0.0'` and it returns
    `next()` before the guard runs; no `cors` middleware anywhere.
13. **[OPEN] Path traversal defenses are scattered** — `safeScope`/`safe` exist but are not consistently applied everywhere (e.g., context file uploads, prompt snippet names, skill repo paths). Audit all user-controlled filesystem paths.
    → Still true. A full audit of every user-controlled path has not been done, so this stays
    OPEN by default. The one known instance that WAS tracked
    (`docs/specs/_archive/source-of-truth-reconciliation/issues/08` — `deleteContextFile`
    hard-deleting a control file named by an unvalidated request field) is **fixed**
    2026-08-02 and gated by `tests/phase-regressions.test.mjs`. That was one path; the
    audit of the rest has still not been done.
14. **[OPEN] Error handling is inconsistent** — many routes `catch (e) { res.status(400).json({ error: e.message }) }` and drop the stack. Some catch blocks are empty (`catch { /* ... */ }`), hiding parse or disk errors.
    → Still true. Partially mitigated on the client side only: routes emit a `code`
    discriminator that `frontend/api.js` preserves. Server-side stack loss is unchanged.
    (The four empty catches in `jobs.mjs`/`remotion.mjs` are *not* examples of the problem —
    each wraps a `child.kill()` on a possibly-already-dead process, which is correct.)

## Bugs / correctness

15. **[OPEN] `writeMd` is not fsync'd** — the atomic write (`tmp + rename`) is good, but without `fsync` a crash at the wrong moment can still leave an empty or partial file.
    → Confirmed: no `fsync`/`fdatasync` call anywhere in `backend/` or `shared/`.
16. **[OPEN] `getStorageRoot()` re-reads `config.md` on every call** — not a bug, but a hot path that should cache the resolved root and only invalidate on explicit change.
    → Confirmed: a fresh `readFileSync` + `matter()` per call, no cache. Called on
    essentially every request path (via `R()` in `store.mjs`).
17. **[OPEN] Large raw bodies** — `/api/groq/transcribe` accepts `*/*` up to 80 MB and `/api/library/upload` up to 200 MB. There is no streaming/sha check and no virus/content scanning.
    → Confirmed and **understated**: `backend/index.mjs` registers `80mb`
    (`/api/groq/transcribe`), `200mb` (`/api/library/upload`), `200mb`
    (`/api/context/:pid/upload`), **`500mb`** (the manual routes' raw parser — not in the
    original claim) and **`2gb`** (`/api/video-import/:pid/upload`).
18. **[OPEN] Tests are hermetic but fragile** — they rely on `FRFG_DATA` pointing to a temp directory. Any code that bypasses `getStorageRoot()` or uses a hardcoded relative path will break under `node --test`.
    → Structurally unchanged (`tests/_env.mjs`, 45 test files). This is a standing constraint
    rather than a fixable defect — treat it as a rule, not a task.
19. **[DONE] Remotion handoff is runtime-coupled** — `backend/remotion.mjs` searches for `src/index.ts` / `src/Root.tsx` inside the user's Remotion project. It will fail if the project uses a different entry layout, and there is no user-facing error message for that case.
    → Both halves addressed. `ENTRY_CANDIDATES` covers `remotion.config.ts`
    `setEntryPoint()`, `package.json` scripts, then `src/index.ts(x)`,
    `src/remotion/index.ts(x)`, `remotion/index.ts(x)`, and Settings can pin an explicit
    entry. The user-facing error exists, with route-level variants carrying
    `code: 'no-entry'`. Residual scope: no *auto-detection* beyond that fixed list.
20. **[DONE] `frameforge-shots.json` import in template string** — the Remotion starter comp does `import shotsData from '../frameforge-shots.json'`. If the file is missing at Remotion build time, the user's project fails to compile.
    → Fixed on both axes. `backend/index.mjs` computes the specifier per layout
    (`./frameforge-shots.json` at the project root, `../` when the comp lands in `src/`), and
    seeds an empty `{ exportedAt, project, story, shots: [] }` payload when no handoff has run
    yet — so the user's Remotion project builds either way.
    ⚠︎ This item was once mis-tagged `[STALE]` because "`frameforge-shots` does not appear
    anywhere in the repo". That was wrong — it appears 11 times in `backend/index.mjs`. The
    error came from `rg -rn "frameforge-shots"`, where ripgrep's `-r` is `--replace` and
    silently consumed the `n`. Sanity-check a zero-hit result before concluding absence.

## UX / features

21. **[OPEN] No global error boundary** — a crash in `App.jsx` kills the whole UI. Add an `ErrorBoundary` around the router and around the video/lightbox players.
    → **Half done, and the half that is done is the root half.** `ErrorBoundary` is defined
    in `frontend/main.jsx` and wraps `<App />`. That is the only boundary in the codebase —
    there are no nested boundaries around the video or lightbox players, so a player crash
    still unmounts the whole tree. The nested half stays OPEN.
22. **[DONE] Keyboard shortcuts are undocumented in-app** — the README mentions the `i` inbox key, but there is no in-app cheat sheet or command palette.
    → Both exist: a command palette on ⌘K/Ctrl-K (`frontend/Palette.jsx`) and a cheat-sheet
    overlay (`cheatOpen` in `App.jsx`). **Correction to the previous note**, which said
    "commands live in one registry, `frontend/commands.js`": they never did. The Palette
    builds its own list inline and `App.jsx` hardcodes the keys; `commands.js` was an unwired
    third registry and was deleted 2026-08-02. Bindings are `frontend/keymap.js`, with a
    rebinding UI in `Settings.jsx`.
23. **[OPEN] Review inbox does not debounce rapid keypresses** — holding `k`/`x`/`→` can queue many network requests.
    → **Partly wrong as stated, still true in part.** `ibDecide()` (`frontend/App.jsx`) is
    purely local — it batches decisions into React state and issues no per-keypress request,
    so held `k`/`x` no longer floods the network. But `ibRate()` fires
    `api.reviewCandidate()` per keypress per target, so held `1`–`5` still does. Unthrottled.
24. **[DONE] No offline indicator** — if the backend stops, the React app silently breaks. Surface a reconnect banner.
    → `App.jsx`'s `sync()` sets `offline` on a failed sync and retries every 3s; the banner
    renders "Backend unreachable — retrying…".
25. **[OPEN] Batch generation UI is bare** — batch progress, cost estimation, and partial results are present in the API but not surfaced clearly in the main UI.
    → Not verified as fixed. Left OPEN deliberately: assessing "surfaced clearly" needs a UI
    pass, not a grep. Do not mark DONE without actually running the batch flow.
26. **[OPEN] Mood board filtering does not persist** — keyword/tag/kind state lives only in React state. Persist it to `ui-state.md`.
    → Confirmed still true. Filter state is component-local in both consumers
    (`Library.jsx`, `AssetBoards.jsx` — `S.tag/S.q/S.kind/S.fav`). The `ui-state.md`
    mechanism it should use already exists and works (`GET/PUT /api/ui-state`) — it is used
    for last location only.

## Tooling / testing

27. **[OPEN] No lint or format config** — there is no `.eslintrc`, `.prettierrc`, or `biome.json`. Add one to keep the new codebase consistent.
    → Confirmed: no lint, format, or editorconfig file at the repo root. Note `CLAUDE.md`
    forbids introducing new tooling unasked, so this needs an explicit decision.
28. **[STALE] No TypeScript** — the whole project is plain JS/JSX. The Remotion template string even contains TypeScript types that are never checked.
    → Not a defect. Plain ESM JavaScript is a deliberate, documented decision — see
    `CLAUDE.md`, "Scope override". Adding TS is a product decision, not a cleanup. The
    sub-claim about unchecked TS in the Remotion template still stands as written:
    `REMOTION_TEMPLATE` emits a `.tsx` file whose types nothing typechecks. That is inherent
    to handing a template to an external Remotion project and is not a defect here.
29. **[OPEN] Tests are mostly backend** — there is no frontend unit or e2e coverage. Add at least a Playwright or Vitest smoke test for the critical `home → project → shot` flow.
    → Confirmed: all 45 test files in `tests/` are backend `node --test` scripts (the suite
    reports **374 tests**). Note `CLAUDE.md` forbids introducing a test framework unasked, so
    this needs an explicit decision before anyone acts on it.
30. **[OPEN] Bundle size unknown** — `vite build` will produce `dist/`, but there is no bundle analyzer or CI step to catch regressions.
    → **Correction to the previous note**, which said "the repo has no remote, so there is no
    CI to hang a check on". Both halves were wrong: the repo has a private remote, and
    `.github/workflows/build.yml` + `release.yml` both run. There *is* somewhere to hang a
    check. Still true: `vite.config.mjs` has only `build: { outDir: 'dist' }`, no analyzer and
    no size gate. For scale, the current build is **1.43 MB** for the main chunk plus
    **699 KB** for the split `ThreeDStage` chunk, and vite warns on both.

## Added 2026-08-02

31. **[OPEN] `frontend/Scrub.jsx` is extracted but unadopted** — a pointer-capture scrub
    track, correct and well documented, with **zero importers**. Its own header says it was
    "exported rather than inlined so `ThreeDStage.jsx`'s lane and `App.jsx`'s transport rail
    can migrate onto it: three scrubbers become one." That migration never happened, so the
    app still has three hand-rolled scrubbers plus one unused correct one.
    → Deliberately **not deleted**, unlike the three dead files removed the same day: those
    were superseded, this one is pending. Either adopt it in `Timeline.jsx` / `ThreeDStage.jsx`
    or decide against it — leaving it in limbo is the worst of the three options.
32. **[OPEN] `frontend/PromptBuilder.jsx` is a fourth axis picker** — `StyleLab.jsx`'s header
    listed PromptBuilder among the surfaces it replaced, but `Tools.jsx` still mounts it as
    the `builder` tool, so both render the same `AXES` with different preset rails. The header
    has been corrected; the duplication has not.
33. **[OPEN] `landingpage/versions/` holds six superseded page versions** — six full HTML
    builds plus ~1,900 lines of `support.js`. They are **deliberately live**: `all.html` links
    every one of them and `.vercelignore` pointedly does not exclude them. Not dead code, but
    worth an explicit keep/drop decision rather than inertia.
34. **[OPEN] `scripts/` carries committed generator scratch** — `.aspect-scene.png`,
    `.character-ref.json`, `.wyrmfall.json`, `character-ref.jpg`. Only `bench-store.mjs` (via
    `npm run bench`, with `bench-baseline.json` as its committed baseline) and
    `release-upload.mjs` (via `npm run release:upload` and `release.yml`) are wired to
    anything. The `axis-prompts*`, `gen-aspect`, `gen-axis-images` and `wyrmfall-*` scripts are
    one-off generators kept for re-runs — legitimate — but the dot-file artefacts beside them
    are not.
