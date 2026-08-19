# Handover prompt — derived-index family

Paste the block below as the **first message** of a fresh Claude Code session. Change the two
`NN` references to the ticket you want. One ticket per session — do not batch them.

Recommended order: `01` → `02` → `03` → `04` → `08`. Park `05`–`07` until
`scripts/bench-store.mjs` (ticket 01) says they are needed.

---

```
Implement exactly one ticket: docs/specs/derived-index/issues/NN-<slug>.md

Read first, in this order, and do not skip any:
1. CLAUDE.md (repo root) — search traps, source-of-truth table, ports, hard rules
2. docs/specs/derived-index/spec.md — architecture and the Invariants section
3. docs/specs/derived-index/issues/NN-<slug>.md — your ticket
4. Every source file the ticket names, before editing any of them

The spec is already researched and grounded in source with file:line pointers. Do NOT
re-plan, re-scope, or write a new design. Implement what the ticket says. If you believe
the ticket is wrong, say so and stop — do not silently do something different.

SCOPE
- This ticket only. If you spot something else broken, note it at the end; do not fix it.
- Set `**Status:** claimed` in the ticket file and save BEFORE you write any code.
- On completion set `**Status:** resolved` and append what you did under `## Comments`.
- Work on a branch named `feat/`, `fix/`, or `chore/` per CLAUDE.md. It lands on main; no PR.

TRAPS THAT WILL WASTE YOUR SESSION IF YOU IGNORE THEM
- `backend/store.mjs` contains a literal NUL byte, so plain `grep` reports it as binary and
  SILENTLY RETURNS NOTHING (exit 1). Always use `grep -a` or `rg --text`. A zero-hit search
  in this repo is a claim to verify, not a fact. CLAUDE.md calls this the single largest
  cause of agents contradicting each other here.
- Run tests as `node --test tests/*.test.mjs`. A bare `node --test tests/` fails with
  `Cannot find module .../tests` on this Node build — that is the runner, not your code.
- Parse failures on `._phase*.test.mjs` are exFAT AppleDouble junk being collected as tests.
  Sweep with `find . -name "._*" -not -path "./node_modules/*" -delete` and re-run.
- Do NOT start from ISSUES.md. It is a reading list, not a work queue, and its tags may be
  stale.

HARD CONSTRAINTS
- No TypeScript. No test framework. No new npm dependency. No new env-var scheme beyond
  what the ticket explicitly specifies.
- Markdown under the storage root stays the source of truth. Anything you add must be
  derived, and deleting it must change nothing but latency.
- Do not add a second implementation of anything. Grep for the concept first; if a canonical
  one exists, adopt it. Everything in this family lands in existing modules — chiefly
  `backend/indexer.mjs` and `backend/store.mjs` — never a new `cache.mjs`.
- Never commit or paste `workspace/` or `.env` — both are gitignored and hold live API keys.
  Verify they are still absent from history before any push.
- Do not "fix" 127.0.0.1 to localhost.

DONE MEANS
- Every acceptance-criteria checkbox in the ticket is ticked because you ran it, not because
  it looks right. Tests you were told to write exist and pass.
- `node --test tests/*.test.mjs` is green.
- If any file:line pointer or factual claim in the spec or ticket turned out to be wrong,
  fix it in the same change and say so. A stale pointer causes the next session to
  re-implement working code.

Start by reading. Tell me your plan for this ticket before you edit anything.
```

---

## Notes on using this

- **Commit the spec before the first session** so the agent is not editing untracked files:
  `git add docs/specs/derived-index docs/MAP.md && git commit -m "docs: derived-index spec"`
- Ticket 06 says "Blocked by: 05" and 07 says "Blocked by: 06". Respect that — they share a
  memoisation helper and doing them out of order produces two of it.
- If a session runs long, it is better to stop with `Status: claimed` and a note under
  `## Comments` than to half-land a ticket. The next session picks it up from the note.
- After each ticket, run `npm run bench` (once ticket 01 exists) and paste the table into the
  ticket's `## Comments`. That is the record of whether the family is actually working.
