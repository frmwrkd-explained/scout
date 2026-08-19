# START — the build agent's first prompt

> Paste everything below the line into Claude Code, opened in this folder
> (`/Volumes/SSD/New Coding Projects/Scout`).

---

You are building **Scout**, a local-first desktop app. This folder already contains the complete spec. Your job is to bring in the two source materials, plan, and then build — in that order.

## Read first, in this order. Do not skip.

1. `GOAL.md` — the acceptance contract and the ten gates. **It wins every conflict.**
2. `CLAUDE.md` — the build contract: source-of-truth table, hard rules, ports.
3. `docs/01_CANON.md` — the ten laws and the specific failure each prevents.
4. `docs/06_REUSE.md` — the file-by-file steal map. **Re-implementing anything in it is a defect.**
5. `docs/07_BUILD_ORDER.md` — the milestones and their exit criteria.

Then read `docs/02_DATA_MODEL.md` and `docs/05_UI_SPEC.md`. Skim `03_MEMORY.md` and `04_AGENT_CONTRACT.md` now; read them properly at M3 and M4.

## Phase 0 — get the two source materials into the repo

**Nothing else happens until both are here.**

### 0a · The design

Use the `claude_design` MCP (`https://api.anthropic.com/v1/design/mcp`, auth via `/design-login`) to import this project:

```
https://claude.ai/design/p/f84bb492-1fc3-4729-8597-dc87f6c41485?file=Scout.dc.html
```

Pull every file into `design/`:

```
design/Scout.dc.html · Today.dc.html · Decide.dc.html · Project.dc.html
       Territory.dc.html · Record Detail.dc.html · Review Deck.dc.html
       Pipeline.dc.html · support.js
```

Then read them and write `design/EXTRACT.md` recording:
- the exact `:root` token block the design uses
- the components it implies, with the name each should take in `frontend/`
- the layout contract — rail widths, panel behaviour, tab shapes
- anything the design does that contradicts `docs/05_UI_SPEC.md`, listed as a question

**Do not build UI from a screenshot. These files are the visual truth.**

### 0b · The code spine

Scout is a **fork of FrameForge**. Follow `tasks/T01-fork-and-strip.md` exactly:

```
source: /Volumes/SSD/New Coding Projects/FAL HACKATON
```

Copy the repo in without `workspace/`, `.env`, `node_modules/`, `dist/`, `release/`, `landingpage/`. Read that repo's own `CLAUDE.md` before touching anything — it documents traps that have already cost days.

Also available to read, never to copy wholesale:
```
/Volumes/SSD/New Coding Projects/Hermes Assitants     ← skillSuggestions, requests, /intake, budgets
```

### 0c · Reconcile the tokens

The design was built on FrameForge's design system. Diff `design/EXTRACT.md`'s `:root` against `frontend/styles.css` `:root`. They should agree. Where the design adds a token, add it deliberately to `styles.css` + `tokens.js` + `docs/DESIGN.md` **in one commit**. Where they conflict, **`styles.css` wins** and you note it as a question. Never write a raw hex in component code.

## Phase 1 — plan, then stop

Write `PLAN.md` covering **M0 and M1 only**. Not the whole build.

- The task order, with what each touches
- Every place `docs/06_REUSE.md` says port-don't-write, and where each ported thing will live
- The open questions from `design/EXTRACT.md`
- Anything in the spec you think is wrong — say so now, with your reasoning

**Then stop and show me `PLAN.md`.** Do not write application code before it is reviewed.

## Phase 2 — M0

Execute `tasks/T01-fork-and-strip.md`. This task **removes**; it does not improve. Do not refactor while you are in it.

**Exit:** `npm ci && npm test` green with the film modules gone, and `npm start` opens an empty Scout window with the tokens intact. Show me both.

## Phase 3 — M1, one task at a time

`T02` → `T03` → `T04` → `T05`. For each:

1. Backend and its tests first, driven by `curl`. UI second. **A screen built before its route is a screen built against a guess.**
2. Perform the task's **Demonstrate** section and show me the result.
3. Then move on. Do not batch tasks.

## Hard rules — the ones most likely to be broken

- `writeMd` uses the `{content}` form of `matter.stringify`, **never** the bare-string form. The string form re-parses the body and silently eats a leading `---` rule.
- `readMd` passes `cache: false`. gray-matter caches by content and stores an EMPTY result on the error path.
- Every write is tmp + rename. A half-written `.md` does not error — it *vanishes*.
- Only `records.mjs` writes document files.
- Field types come from `docs/02_DATA_MODEL.md` §2 and nowhere else.
- Frontmatter always wins over any computed cache.
- **Grep before you build.** If a second implementation of a concept exists, reconcile to the canonical one. Never add a third.
- A zero-hit search is a claim to verify, not a fact. FrameForge's `CLAUDE.md` documents two cases where a lying search cost hours.

## How to work

- **Demonstrate, don't describe.** A task is done when its Demonstrate section can be performed.
- Record every ambiguity you resolve in `docs/decisions.md`: the question, the choice, the reason.
- If the spec and the design disagree, ask. Do not pick silently.
- If something in the spec is wrong, say so — I would rather change the spec than have you build around it.
- Keep commits small and on `feat/` `fix/` `chore/` branches.

Start with Phase 0.
