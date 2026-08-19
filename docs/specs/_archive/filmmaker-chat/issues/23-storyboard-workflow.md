# 23 — The blessed storyboard-first workflow

**What to build:** The end-to-end cheap-preview playbook, shipped as a **default
skill pack** (a normal Index entry with its own SKILL.md, mounted/toggled like
any user pack — NOT router-skill content; the router stays domain-free) and
verified as one continuous chat session: (1) the
agent gathers the story (conversation or attachment) and proposes a shot breakdown
(ticket 17); (2) it offers the cheap storyboard preview, explicitly framed to the
user as "storyboard, not final look"; (3) it batches 3×3 storyboard sheets on the
project's preview model with placeholder characters, prompts action-and-framing
only, watermark/framing note "STORYBOARD" composed at generate time; (4) sheets are
split (ticket 16) and cells attach to shots as storyboard candidates; (5) the user
reviews (ticket 21); (6) look development follows — the agent helps produce a look
sheet, the user locks it as the project style (ticket 12/13); (7) kept shots
re-render on a render-tier model with the locked style, cast, and location refs
composed in by id. Every step is a directive/card the user confirms — the agent
proposes, the user disposes. Includes prompt-budget discipline: the storyboard
batch's per-shot prompts contain no style prose (spot-checkable in the generation
records).

**Blocked by:** 13 — Production Panel; 16 — Grid split in chat; 17 — Shot board in chat; 21 — Review integration; 22 — Cost surfacing.

**Status:** done

- [~] A single real session goes story → breakdown → estimate/confirm → storyboard sheets → split → shots populated → review → style lock → re-render of kept shots, without leaving the chat
      — LIVE-ONLY (needs a Claude subscription + FAL spend; not run in CI). The playbook is authored in
      the pack (`backend/skills/storyboard-workflow/SKILL.md`) and every seam it rides is covered
      hermetically. The exact human runbook is `docs/specs/filmmaker-chat/DEMO.md`.
- [x] Storyboard generations are visibly framed as previews in the UI and in the composed prompt
      — the pack composes the literal `STORYBOARD …` framing note via the batch `styleLockFragment`
      suffix seam (`backend/batches.mjs`: `composedPrompt = prompt + ' ' + styleLockFragment`), so it
      lands in every candidate's stored prompt. Asserted at the record level in
      `tests/phase-storyboard-workflow.test.mjs`. The card's visual preview framing is the ticket-14
      generation card (live-only).
- [x] Generation records for the batch show action-only prompts with style/cast/loc referenced by id
      — the pack teaches action-and-framing-only prompts (economy law, `references/prompts.md`); the
      test asserts each candidate prompt leads with the action text and carries no grade/lens/stock
      prose, with the framing note riding in via the suffix. Style/cast/loc compose in by id at
      generate time (styleLockFragment fragment / refs), never restated.
- [~] The re-render step uses the locked style automatically; changing the lock and re-rendering one shot shows the new look
      — MECHANISM verified: the pack reads `GET /api/stylelocks`, finds the record whose id equals the
      Index `locks: style=<id>`, and passes its `.fragment` as `styleLockFragment` so the locked look
      composes onto every render candidate by id (same suffix seam, covered by phase7-batches +
      phase10-styles). The visible "swap lock → new look on re-render" is LIVE-ONLY (DEMO.md step G).
- [x] The workflow lives entirely in its own pack; the router skill contains no reference to it, and disabling the pack removes it from the next session's Index
      — the router skill was NOT edited. The workflow is a built-in pack mounted/toggled like any pack;
      disabling it (`enabledSkillPacks[storyboard-workflow]=false`) drops it from the home + Index.
      Asserted in `tests/phase-storyboard-workflow.test.mjs` (mount/Index/toggle + tamper-reset).
- [~] The full run works with all involved chat tools enabled
      — LIVE-ONLY. DEMO.md §1 lists the exact toggles the run needs ON: the built-in pack (default ON)
      plus the shot-board, grid-splitter, and style-locks tools (chat tools default OFF).

## Implementation notes (2026-07-19)

- **Built-in pack mechanism (additive in `backend/agentHome.mjs`).** New `BUILTIN_PACKS` list points at
  source dirs under `backend/skills/`; `listSkillPacks()` enumerates built-ins FIRST (flag `builtin:true`,
  `repo:'built-in'`), then repo packs — built-ins win an id collision. Enablement resolves like any pack
  (explicit `enabledSkillPacks` toggle wins, else the pack's own `enabledByDefault`). The storyboard pack
  defaults **ON** (the demo vehicle; every step it drives is confirm-gated). `mountPack()` COPIES built-ins
  fresh from source on every prepare — like the router — so a tamper of the mounted copy never persists and
  can't reach the source tree (a repo pack is symlinked; a built-in is copied). `chatSkillsSurface()` carries
  the `builtin` flag so the Skills page can badge it.
- **Pack files:** `backend/skills/storyboard-workflow/SKILL.md` (the 7-stage playbook + guardrails) and
  `references/prompts.md` (the action-and-framing prompt discipline + the STORYBOARD suffix mechanism).
  Index line comes from the pack's own `description`/`triggers` frontmatter (per `packFrontmatter`).
- **STORYBOARD framing** rides the existing `styleLockFragment` suffix — the only suffix `POST /api/batches`
  forwards and the same field `confirm.batch` carries — so no `backend/batches.mjs` edit was needed.
- **Tests:** `tests/phase-storyboard-workflow.test.mjs` (5 new tests). Updated the isolation exact-mounted-set
  assertion in `tests/phase-agent-home.test.mjs` to include the default-ON built-in (global-leak guard intact).
  Full suite `node --test tests/phase*.test.mjs` green (189); `npm run build` green.
