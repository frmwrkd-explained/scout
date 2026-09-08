# Scout — agent instructions

Local-first desktop app: **React + Express + Electron over a plain-markdown datastore.**
Plain ESM JavaScript by design — `.mjs` backend, `.jsx` frontend, `.cjs` Electron. No TypeScript unless explicitly requested.

**Read `GOAL.md` first.** It is the acceptance contract and it wins every conflict.

## Where this code comes from

Scout is a **fork of FrameForge** (`/Volumes/SSD/New Coding Projects/FAL HACKATON`) with the film domain removed. Do not re-invent the spine — port it. See `docs/06_REUSE.md` for the file-by-file map. The design system (`frontend/styles.css` `:root`, `frontend/tokens.js`, `docs/DESIGN.md`) is inherited **verbatim**; hue changes require the owner.

FrameForge's own `CLAUDE.md`, `README.md` and `ISSUES.md` are preserved as `docs/FRAMEFORGE_*.md`. They document traps that have already cost days — read `docs/FRAMEFORGE_CLAUDE.md` before touching ported code. Where it and this file disagree, **this file wins**.

## Source of truth, by domain

| Domain | Canonical file | Notes |
|---|---|---|
| Datastore, paths, atomic writes, path safety | `backend/store.mjs` | `readMd`, `writeMd`, `paths`, `safe`, `safeScope`, `slugify` |
| Collection schemas + field types | `backend/collections.mjs` | The ONLY place a field type is defined. See `docs/02_DATA_MODEL.md`. |
| The four write verbs + near-match | `backend/records.mjs` | `upsertRecord`, `nearMatches`. **The only writer of document files.** |
| Actor identity — is this a person or an agent | `backend/actors.mjs` | `isAgentActor` (the border rule), `isAgentForOwnedMemory` (`me.md` + `goals/`), `actorRegistry`, `DEFAULT_ACTOR`. The ONLY answer to the question; `records.mjs` and `memory.mjs` re-export, never redefine. |
| Views (table/board/list/gallery) | `backend/views.mjs` | Saved in-vault so views travel and an agent can create one |
| Memory + the hot cache | `backend/memory.mjs` | `renderCache` is the ONLY producer of the agent's wake-up context |
| Decay | `backend/decay.mjs` | One function decides staleness for every object type. Never inline a second rule. |
| Territory scoring | `backend/territory.mjs` | Sole writer of `yield` / `hit_rate` — never set by hand |
| The agent's view of the app | `backend/agentIndex.mjs` | Adding a capability is a new Index line, never a router-skill edit |
| Sending an assistant out (the local-CLI door) | `backend/dispatch.mjs` | `sendOut` / `sendOutAll` / `stopRun`. Composes `agentRunner` + `agentHome` + `tasks`; it spawns nothing itself and writes no document. A run's figures are **counted from the log**, never taken from the agent's reply. |
| Serving a file's bytes | `backend/files.mjs` `rawFile` | `GET /api/files/raw`. Media types are an allowlist served inline; everything else is an attachment, because the UI and the API share an origin. |
| HTTP contract | `backend/index.mjs` route handlers | A field a route does not destructure does not exist |
| The router skill | `skills/scout-router/` | **Canonical source.** The app copies it fresh into every agent session home on each run, so a tamper never persists. Edit it here, never in a mounted copy. |
| The hub link (OpsGraph) | `backend/hub.mjs` + `backend/hubBundle.mjs` | The push is numbers Scout **already counted**, never one an agent typed. `renderCache` prefixes the hub bundle and **trims it first** under the cap. Scout never writes into `hubFolder`. |
| Event log | `backend/log.mjs` | Append-only, one file per day. Every mutation lands here. |
| Design tokens | `frontend/styles.css` `:root` | Machine truth. Light/dark are two token sets, one contract. |
| UI primitives | `frontend/ui.jsx` | Import them. Never re-render their markup by hand. |

## Hard rules, enforced in code and gated by tests

- **`writeMd` uses the `{content}` form of `matter.stringify`, never the bare-string form.** The string form re-parses the body, so a note beginning with a `---` rule loses its first block into frontmatter, silently.
- **`readMd` passes `cache: false`.** gray-matter caches by content and stores an EMPTY result on the error path — one malformed file would then parse as empty forever.
- **Every write is tmp + rename.** Readers swallow parse errors by design, so a half-written file does not error — it *vanishes*.
- **Only `records.mjs` writes document files.** Dedupe, provenance and the gate all live there; a second writer bypasses all three undetectably.
- **Agents may not promote past `shortlist`.** Enforced in the route (403) and again on read (an agent-authored later stage is ignored and flagged).
- **Archive requires a reason.** No reason → 400.
- **The hot cache has a hard token cap** (`MEMORY.CACHE_TOKEN_BUDGET`, default 2000). Exceeding it is a test failure, not a warning.
- **Never delete a user file.** Archive.
- **Never write a raw hex in component code.** If no token fits, add one deliberately to `:root` + `tokens.js` + `docs/DESIGN.md` in the same commit.

## Ports

- API **5177** — `Number(process.argv[2]) || process.env.PORT || 5177`
- Vite dev **5178** — proxies `/api` → `127.0.0.1:5177`
- The backend does **not** read `SCOUT_API_PORT`; only Vite does, to pick its proxy target.
- Proxy target stays `127.0.0.1`, never `localhost` — the backend binds IPv4 only.

## Before building any UI

Grep for the concept first. If a second implementation exists, reconcile to the canonical one; never add a third. `frontend/ui.jsx` is the registry. This repo's parent has a documented history of three separate implementations of one composer — do not repeat it.

## The docs

| File | What |
|---|---|
| `GOAL.md` | acceptance contract, the 10 gates |
| `docs/01_CANON.md` | the laws, and why each exists |
| `docs/02_DATA_MODEL.md` | collections, field types, views, subtables, on-disk shape |
| `docs/03_MEMORY.md` | identity, goals, territory, playbook, learnings, decay, **the hot cache** |
| `docs/04_AGENT_CONTRACT.md` | the three doors, the tools, agent-built schemas, the gate |
| `docs/05_UI_SPEC.md` | shell, screens, view types, light/dark, whiteboard, file browser |
| `docs/06_REUSE.md` | file-by-file steal map |
| `docs/07_BUILD_ORDER.md` | milestones and their exit criteria |
| `tasks/` | one file per task, smallest shippable slice first |

## Working method

Build milestone by milestone. After each, **demonstrate the exit criterion in `GOAL.md` §9 before moving on.** Record every decision made where the docs were ambiguous in `docs/decisions.md`. The job is done when all ten gates pass — not when the code runs.
