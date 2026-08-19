# 10 — Router skill, session Index, and the isolated agent home

**What to build:** The orchestration layer of the chat. Three parts, none of which
contains domain knowledge:

1. **The isolated agent home.** The backend manages a dedicated agent home/config
   directory inside the workspace. Chat sessions spawn the CLI pointed at it, so
   the user's global skill library never loads. It contains exactly: the router
   skill (system copy), the mounted skill packs, the house-rules skill, and the
   generated Index — nothing else.
2. **The Index generator.** At session start the backend renders the Index the
   router skill consumes: API base + project id + mode + current lock ids; one
   line per mounted skill pack (derived from the pack's own frontmatter
   description/triggers, plus its path); one line per enabled tool (capability +
   invocation pointer + registered directive types); and a pointer to a generated
   Core API route reference file. Disabled entries are omitted entirely. Adding a
   capability must never require editing the router skill — only a new Index line.
3. **Skill-pack mounting.** Packs are the plug-in unit: existing large skills
   (own reference files, scripts, workspaces) pointed at via the skill-repos
   setting, individually toggleable. Enabled packs are mounted (linked/copied)
   into the isolated home with their file trees intact; their Index lines come
   from their own descriptions. Pack workspaces and scripts are never modified by
   FrameForge.

The router skill is a **system skill and is not user-editable**. Its canonical
source is already authored in the backend source tree under
`backend/skills/frameforge-router/` (a pure orchestrator: classify → route →
delegate → sync, the Loading Ladder token discipline, non-waivable gates — do not
rewrite it; wire it). On every session start it is copied fresh from source into
the isolated home, so tampering never persists. The Skills page shows it
read-only with a "system" badge. The optional `house-rules` skill (seeded empty,
fully editable in the Skills page) is the user's extension point.

**Blocked by:** 09 — Streaming agent runner.

**Status:** done

Implemented in `backend/agentHome.mjs` (new), wired via `backend/agentRunner.mjs`
(`cliExecutor` → `prepareAgentHome`) and `backend/index.mjs`
(`registerAgentHomeRoutes` + `chatSkills` in `/api/state` + `FRFG_SELF_PORT`).
Tests: `tests/phase-agent-home.test.mjs` (14 cases). Full suite `node --test
tests/phase*.test.mjs` green (106/106). `npm run build` green.

- [x] Chat sessions run with the isolated home; a skill present only in the user's global skill dir is demonstrably not loaded — `CLAUDE_CONFIG_DIR=<home>` relocates the config dir (confirmed the flag is honored by the installed claude); the home's `skills/` dir contains exactly `frameforge-router` + `house-rules` + enabled packs (test `isolation: the home skills dir excludes global skills`). LIVE: an actual "which skills do you see" run needs a subscription.
- [x] A large multi-file pack mounted via the skill-repos setting appears as one Index line, its file tree intact — test `prepareAgentHome mounts only enabled packs`. LIVE: the agent routing into it + running its scripts needs a subscription run (tools also ship OFF by default per hackathon compliance).
- [x] Enabling/disabling a pack or tool changes the next session's Index; disabled entries are absent, not refused — tests (pack mount/unmount, tools registry seam, HTTP toggle route).
- [x] The Core API route reference is generated (not hand-maintained) and reachable from the Index pointer — `renderCoreApiRef` from declared `CORE_API_ROUTES`; `<home>/core-api.md` written + Index `## Core API` points to it (tests).
- [x] The router skill renders read-only (system badge) in the Skills page; edits to its session copy are overwritten on next session start — backend `chatSkillsSurface()` exposes `router{system,readOnly}` via `/api/chat/skills` + `/api/state.chatSkills`; tamper-reset proven by test. NOTE: the Skills page lives in `frontend/App.jsx` (owned by another agent) — the read-only/system-badge rendering is a small App.jsx change, deliberately NOT made here (see report).
- [x] The house-rules skill is seeded, editable, and demonstrably loaded when non-empty — seeded empty (inactive), `PUT /api/chat/house-rules`, active only after the placeholder is replaced, then listed in the Index + mounted (tests).
- [ ] In a real session the agent performs a plain Core-API operation (e.g. list shots) using only the Index's route reference — REQUIRES a live subscription CLI run; not verifiable hermetically.
- [x] node --test coverage: Index rendering (packs, tools, locks, omission of disabled), pack mounting, tamper-reset of the system copy — `tests/phase-agent-home.test.mjs`.
