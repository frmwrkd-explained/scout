# Spec: Source-of-truth reconciliation

**Status:** ready-for-agent
**Feature slug:** `source-of-truth-reconciliation`
**Created:** 2026-07-19

## Problem Statement

A cross-agent conflict audit (71 agents, 48 verified findings) established that parallel
agents working on FrameForge kept contradicting each other because several concepts are
declared in two places with different values, and nothing said which one wins.

The mechanical half of that cleanup already landed (commit `986ee02`): `ISSUES.md` per-item
status, `launch.json` 7→2 configs, 19 ghost `src/`+`server/` paths corrected, one `safeScope`
unification, and `CLAUDE.md` as the standing source-of-truth table.

What remains are the findings that **change runtime behavior or cost accounting**. Those are
deliberately not silent edits — each needs a decision, so each is a ticket.

## Scope

In scope: the seven divergences below, all verified against source on 2026-07-19.

Out of scope: `filmmaker-chat` (separate spec, concurrent work). Architectural items still
marked `[OPEN]` in `ISSUES.md` (App.jsx monolith, index.mjs router size, frontend test
coverage) — those are refactors, not conflicts.

## A note on the audit's own reliability

Two audit findings **did not survive** re-verification and were dropped rather than ticketed:

- *"Two Groq price tables, ~5× apart."* They are not 5× apart. `enhance.mjs`'s flat rate is
  **identical** to `groq.mjs`'s `llama-3.3-70b-versatile` entry. The real defect is narrower
  (ticket 02). The "5×" figure appears to have been misattributed from the preview-model cost
  gap in ticket 01 ($0.003 vs $0.015).
- *"Staged-trash `kind` vs `itemKind` conflict."* `kind` on `paths[]` (`dir`|`file`) and
  `itemKind` on the entry are different fields by design. The real defect is three producers
  using the wrong one (ticket 06).

Treat every finding below as a claim with evidence attached, not as settled fact. Re-verify
before acting. Do not mark a ticket resolved on a zero-hit search — see `CLAUDE.md` on
`grep -a` / `rg --text`.

## Tickets

| # | Title | Risk |
|---|---|---|
| 01 | Two app-wide preview-model defaults; one is unreachable | Cost — 5× per preview |
| 02 | `enhance.mjs` prices every model at llama-3.3-70b rates | Cost accuracy |
| 03 | Video `duration` is collected by the UI and dropped | Correctness — UI lies |
| 04 | `memory.mjs` pid sanitizer is weaker than `safeScope` | Security, defense-in-depth |
| 05 | `_folders.md` control file may be exposed as a user asset | Data integrity |
| 06 | Three `stageTrash` producers pass `kind` instead of `itemKind` | Correctness |
| 07 | `ledger.mjs` documented `op` vocabulary is incomplete | Docs |

## Success Criteria

- Every ticket either lands a fix or is closed with a recorded decision and a one-line
  rationale in `CLAUDE.md`'s source-of-truth table.
- No new second source of truth is introduced.
- `node --test tests/` stays at 63/63.
- After each ticket, grep for stray literals of any changed value.
