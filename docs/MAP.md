# Map of content

One page. Read this before opening anything else in `docs/`.
**Statuses verified against source: 2026-08-02.**

> **What changed on 2026-08-02.** Every spec family's status was re-checked by running its
> own acceptance criteria against current source. Several were wrong, and wrong in the
> expensive direction — they described work as unstarted that had shipped:
>
> - `component-unification/` said "planned, not started; all 9 tickets open". **Five of
>   the nine had shipped**, including the composer extraction itself.
> - `animatic/SPEC.md` said "PROPOSED — not started" while the whole Timeline was live.
> - `beta-feedback/spec.md` said "planned" while all 11 of its own tickets said "resolved".
>
> A ticket's `Status:` line is a claim, not a fact. Re-check before you implement.

- **board** — `docs/specs/board/SPEC.md` · **SHIPPED** 2026-08-18. The per-project infinite canvas: node model, the four auto-align layouts, the plan-vs-takes toggle, the shot inspector, PNG export and the agent tool. Design record, not a work queue.

## Read first, always

| File | What it is |
|---|---|
| `CLAUDE.md` (root) | Agent instructions: source-of-truth table, shared UI, ports, hard rules |
| `docs/DESIGN.md` | The design system. `frontend/styles.css` `:root` is the machine copy; DESIGN.md explains it |
| `docs/RELEASE.md` | Building, signing and shipping the desktop app + the R2 auto-update feed. **Read before any packaging work** — the build cannot run on this exFAT volume and needs a pinned python, and both failures name the wrong cause |

Everything else below is **read on demand** — open it only when your task touches it.

## Active work

| Spec family | State | What is actually left |
|---|---|---|
| `docs/specs/component-unification/` | **5 of 9 shipped, 1 superseded, 3 remain** | Shipped: **01** (COMPONENTS.md), **03** (`frontend/Composer.jsx`), **05** (ShotWorkspace adopted it), **06** (`chat/ManualComposer.jsx` deleted outright), **07** (`OUTPUT_KINDS` moved into `modelCatalog.js`). **02 is SUPERSEDED** — it specified one component with three densities, and the shipped Composer is deliberately *zero* variants; do not implement it. Remaining: **04** (10 sites still hardcode `aspect: '16:9'`), **08** (no `ResultCard` exists), **09** (`Chip` and `MONO` landed 2026-08-02; `Switch`/`Select`/`TextArea`/`NumberInput`/`ProgressBar`/`Cost` have not). `CENSUS.md` is the inventory that motivated the family and is **stale** — it predates the Composer |
| `docs/specs/design-reconciliation/` | 8 of 10 resolved | **07** (resizable panels) and **09** (design-lint ratchet) are the only open tickets |
| `docs/specs/derived-index/` | 1 of 8 resolved | **01 resolved** (`npm run bench` + committed baseline); 02–08 open. Finishes `backend/indexer.mjs` — it already has fs.watch, a reconcile sweep, a per-file stat pass and a revision/SSE bus, but caches nothing. Markdown stays the source of truth throughout. `HANDOVER.md` is this family's working notes |

## Shipped — design records, not work queues

These describe **live subsystems**. They are kept in place rather than moved to
`_archive/` precisely because each is the reasoning behind code you may be about to
change, and because `beta-feedback/spec.md` is cited by eight source files.

| Spec family | Read it before touching |
|---|---|
| `docs/specs/animatic/SPEC.md` | `backend/reel.mjs`, `reelExport/reelPack/reelRender`, `shared/timecode.mjs`, `frontend/Timeline.jsx`. The Timeline: a project TAB with V2/V1/A1/A2, freely positioned clips (`track` + `offset` + `in` + `frames`), gaps legal, magnetic trim/delete on by default (`M` toggles). A clip may LINK a shot — position and length are its own, PICTURE follows `shot.selectedCandidate`. `layDownShots` is an explicit action, not a derivation. **Caveat still true: neither exported XML has been opened in a real NLE.** |
| `docs/specs/beta-feedback/spec.md` | `shared/redact.mjs`, `frontend/feedbackCapture.js`, `backend/feedback.mjs` — all three are source-of-truth files in CLAUDE.md. **§2 is the privacy contract; read it first.** All 11 tickets resolved and the Convex half is deployed (`landingpage/js/data.js` `FF.CONVEX`) |
| `docs/specs/manual-roundtrip/SPEC.md` | `backend/manual.mjs` and the two `Manual*` surfaces. The BYO-render loop: hand prompts out with their order recorded, file the downloads back onto shots (filename → handoff order → agent) |

## Archived (done — do not re-implement)

`docs/specs/_archive/` holds completed spec families. Kept for git history and rationale;
nothing in there is a work queue.

- `filmmaker-chat/` — all 25 tickets shipped and verified in source.
- `source-of-truth-reconciliation/` — **all 8 tickets shipped.** `issues/08` was the last
  remnant and closed 2026-08-02: `CONTROL_FILES` moved to `backend/store.mjs` (one
  declaration, re-exported by `memory.mjs`) and both `deleteContextFile` and
  `contextFilePath` now consult it. Gated by `tests/phase-regressions.test.mjs`.

## Reference (rarely needed)

- `ISSUES.md` (root) — codebase health reading list, each item tagged [DONE]/[OPEN]/[STALE].
  A reading list, **not** a work queue.
- `docs/COMPONENTS.md` — the component registry. **Read its staleness banner first**: it
  was written before the Composer landed and still describes deleted files.
- `docs/agents/issue-tracker.md` — how specs/tickets work here (local markdown; the repo
  does have a GitHub remote, but the tracker is still files).
- `docs/agents/domain.md` — `CONTEXT.md` / `docs/adr/` conventions (both created lazily;
  neither exists yet).
- `landingpage/MAP.md` — the marketing site is a **separate** static project with its own
  map and its own archive. Nothing in `docs/` covers it.

## Rules for this map

- New spec family → add a row under Active work.
- Family fully shipped → move its row to "Shipped", or `git mv` to `_archive/` if nothing
  in the tree cites it. **Check for citations first** — several source files reference a
  spec path directly.
- If a status here disagrees with source, source wins — fix this file in the same change.
- Do not record a status you have not personally checked against code. Every wrong status
  found on 2026-08-02 pointed the same way: it made shipped work look unstarted.
