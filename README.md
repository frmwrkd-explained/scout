# Scout

A desktop app where a non-technical person **orchestrates AI agents** that work all day on their behalf, and **curates the memory those agents run on**. Local-first. Plain markdown on disk. React + Express + Electron.

## Quick start

```bash
npm ci
find . -name "._*" -not -path "./node_modules/*" -delete   # exFAT sidecars, see HANDOVER.md §3
npm test                     # the suite
npm run demonstrate          # GOAL.md's ten gates, against a throwaway copy of the workspace
npm run demo                 # workspace-demo/ → workspace/  (refuses to overwrite an existing one)
npm start                    # build + serve the whole app on 5177 — then press D
```

`npm run demonstrate` uses your own `workspace/` when you have one and the checked-in
`workspace-demo/` fixture when you do not; it prints which. `npm run demo` is what gives a fresh
clone something to look at — Crystal, her guests, her ground and a queue of decisions.
`workspace/` is gitignored, so it is yours from that moment on and nothing in this repo will
overwrite it.

## Read in this order

1. **`GOAL.md`** — the acceptance contract and the ten gates. It wins every conflict.
2. **`CLAUDE.md`** — the build contract: source-of-truth table, hard rules, ports.
3. **`docs/01_CANON.md`** — the laws, and the failure each one prevents.
4. Then the doc for whatever you are building: `02_DATA_MODEL` · `03_MEMORY` · `04_AGENT_CONTRACT` · `05_UI_SPEC` · `06_REUSE` · `07_BUILD_ORDER`.
5. **`tasks/`** — one file per task, in order.

## The shape, in five lines

- Every record, memory and schema is a `.md` file. The index is derived and disposable.
- Every surface opens at a **decision**; reasoning is one click, evidence is two.
- Memory **decays on purpose** and shows its age.
- Agents propose; humans dispose. The gate lives in the pipeline, never in a prompt.
- The agent wakes, reads **one file under 2,000 tokens**, and already knows everything it needs.

## Where the code comes from

A fork of FrameForge with the film domain removed, plus specific patterns from Tesseract MD, Hermes Fleet and TencentDB-Agent-Memory. `docs/06_REUSE.md` is the file-by-file map. **Re-implementing anything in that map is a defect.**

FrameForge's own agent docs are preserved verbatim as `docs/FRAMEFORGE_CLAUDE.md`, `docs/FRAMEFORGE_README.md` and `docs/FRAMEFORGE_ISSUES.md`.

## Design

Claude Design project `f84bb492-1fc3-4729-8597-dc87f6c41485`, imported to `design/` with the token and component audit in `design/EXTRACT.md`. Tokens, density and the accent rules are inherited from FrameForge's `docs/DESIGN.md` verbatim. `docs/05_UI_SPEC.md` §2 lists what the current design is still missing.
