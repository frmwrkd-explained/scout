# Kickoff prompt — hand this to the implementing model

Copy everything below the line into a fresh session in this repo.

---

Implement the **filmmaker-chat** feature for FrameForge.

**Before anything else:** read `CLAUDE.md` at the repo root in full and obey it —
especially: plain ESM JavaScript only (no TypeScript), search with `grep -a` or
`rg --text` (plain grep silently lies about `backend/store.mjs`), ports/proxy rules
(127.0.0.1, never localhost), never touch `workspace/**` by hand, never read or
paste `workspace/settings.md` or `.env`.

**The work is fully specified.** Read, in order:

1. `docs/specs/filmmaker-chat/spec.md` — the spec (problem, solution, decisions,
   testing conventions, out-of-scope).
2. `docs/specs/filmmaker-chat/issues/` — 24 tickets, numbered in dependency order.
   Each ticket declares `Blocked by:` and acceptance criteria.

**How to work:**

- Work the **frontier**: any ticket whose blockers are all complete. Tickets
  01, 03, 04, 06, 07, 08 have no blockers and can start immediately.
- **One ticket per session**, using the installed `/implement` skill; clear context
  between tickets. Mark progress by checking off acceptance criteria and setting the
  ticket's `Status:` line to `done` when complete.
- Tickets 01–03 are prefactors and are sacred: ONE shared media component trio and
  ONE shared set of generation controls. If you find yourself writing a second
  `<video>/<img>` branch or a second model picker anywhere, stop — you are doing it
  wrong.
- `backend/skills/frameforge-router/SKILL.md` is **already written**. It is the
  system router skill and the contract for tickets 10, 12, 14, 16, 17, 22, 23: the
  Manifest shape, directive grammar, gates, and the storyboard workflow are defined
  there. Wire it; do not rewrite it. Where a ticket needs the skill extended (e.g.
  a new directive type a tool adds), extend via the manifest's tool entries, not by
  editing the skill's core sections.
- Tests: plain `node --test` scripts in `tests/`, temp `FRFG_DATA` root, no
  framework — follow the existing `phase*.test.mjs` style. The agent CLI is always
  faked/stubbed in tests.
- Verify UI tickets by actually driving the dev server (`npm run dev` +
  `npm run server`) before calling them done.
- Git: this repo is local-only (no remote, no `gh`). Branch `feat/filmmaker-chat`,
  one commit per ticket, message `feat(chat): <ticket NN> — <title>`. Run
  `/code-review` after substantial tickets.
- If you find a stale claim in `ISSUES.md` or a doc contradicted by source, fix the
  non-canonical side in the same change (CLAUDE.md hard rule).

**Hackathon posture (do not "helpfully" change it):** all chat *tools* default OFF;
the chat module itself defaults ON only when the agent integration is on. The demo
target is ticket 23's storyboard workflow running clean.

Start now: report which frontier ticket you're taking, then take it.
