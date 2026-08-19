# Domain Docs

How the engineering skills should consume this repo's domain documentation when
exploring the codebase.

This is a **single-context** repo. One `CONTEXT.md` at the root, one `docs/adr/`.

## Before exploring, read these

- **`CLAUDE.md`** at the repo root — the project's agent instructions and the
  source-of-truth table. **Always read this first.** It overrides the user-global
  `~/.claude/CLAUDE.md`, which is written for a different ecosystem.
- **`CONTEXT.md`** at the repo root, if it exists — the domain glossary.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

If `CONTEXT.md` or `docs/adr/` don't exist, **proceed silently**. Don't flag their
absence; don't suggest creating them upfront. `/domain-modeling` creates them lazily
when terms or decisions actually get resolved.

## File structure

```
/
├── CLAUDE.md          ← agent instructions + source-of-truth table (read first)
├── CONTEXT.md         ← domain glossary (created lazily)
├── docs/
│   ├── agents/        ← this config
│   ├── adr/           ← architectural decision records (created lazily)
│   └── specs/         ← specs and tickets (the issue tracker)
├── backend/           ← Express API, ESM .mjs
├── frontend/          ← React UI, .jsx
├── shared/            ← code imported by both sides
├── desktop/           ← Electron wrapper, .cjs
├── scripts/           ← one-off generation scripts, not app code
└── tests/             ← plain node --test
```

## Use the glossary's vocabulary

When your output names a domain concept (in a ticket title, a refactor proposal, a
hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to
synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're
inventing language the project doesn't use (reconsider) or there's a real gap.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently
overriding:

> _Contradicts ADR-0007 — but worth reopening because…_

## Flag CLAUDE.md conflicts

Same rule, higher stakes. If what you're about to do contradicts the source-of-truth
table in `CLAUDE.md`, **stop and say so**. That table exists because this repo has a
documented history of parallel agents each picking a different implementation of the
same concept. Do not silently pick a side.
